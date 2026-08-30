"""Tests for the TokenJuice compression stage.

The properties that matter are not "does it compress" — that is easy — but
the ones a lossy stage in front of a model has to hold: it never exceeds the
budget it was given, it never silently loses anything, every marker resolves
back to exactly the lines it replaced, and every failure mode degrades to the
caller's previous behaviour rather than to an exception.
"""

from __future__ import annotations

import json

import pytest

from tools.tokenjuice import compress, expand
from tools.tokenjuice import cache, savings
from tools.tokenjuice.config import reset_config_cache
from tools.tokenjuice.detect import CODE, DIFF, HTML, JSON, LOGS, SEARCH, TEXT, detect_format
from tools.tokenjuice.segments import Elide, Keep, fill_gaps, normalise


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Point the cache and ledger at a temp dir for every test."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(cache, "cache_root", lambda: tmp_path / "tokenjuice")
    reset_config_cache()
    yield
    reset_config_cache()


# ── fixtures that look like real tool output ──────────────────────────


def json_payload(count: int = 4000) -> str:
    return json.dumps(
        {
            "query": "centrifugal pumps",
            "total": count,
            "results": [
                {"id": i, "title": f"Result {i}", "url": f"https://example.com/{i}"}
                for i in range(count)
            ],
        }
    )


def log_payload(lines: int = 3000) -> str:
    out = [
        f"2026-08-24T10:{i // 60 % 60:02d}:{i % 60:02d}.001Z INFO worker[{i % 4}] "
        f"processed batch {i} in {i % 90}ms"
        for i in range(lines)
    ]
    out[lines // 2] = (
        "2026-08-24T10:25:00.000Z ERROR worker[2] failed to flush: disk quota exceeded"
    )
    return "\n".join(out)


def code_payload(functions: int = 60) -> str:
    out = []
    for i in range(functions):
        out.append(f"def function_{i}(alpha, beta):")
        out.append(f'    """Documented behaviour {i}."""')
        out.extend(f"    value_{j} = alpha * {j} + beta" for j in range(25))
        out.append("    if alpha > beta:")
        out.append("        return value_24")
        out.append("")
    return "\n".join(out)


# ── segment model ─────────────────────────────────────────────────────


class TestSegments:
    def test_fill_gaps_keeps_everything_not_dropped(self):
        segments = fill_gaps([Elide(10, 20, "x")], 100)
        assert segments == [Keep(0, 10), Elide(10, 20, "x"), Keep(20, 100)]

    def test_normalise_clips_overlaps_earliest_wins(self):
        segments = normalise([Elide(0, 50, "a"), Elide(20, 80, "b")], 100)
        assert segments == [Elide(0, 50, "a"), Elide(50, 80, "b")]

    def test_normalise_drops_empty_and_out_of_range(self):
        assert normalise([Keep(5, 5), Keep(200, 300)], 100) == []

    def test_normalise_merges_adjacent_keeps(self):
        assert normalise([Keep(0, 10), Keep(10, 20)], 100) == [Keep(0, 20)]


# ── detection ─────────────────────────────────────────────────────────


class TestDetection:
    def test_json_is_confirmed_by_parsing(self):
        assert detect_format(json_payload(10)) == JSON

    def test_almost_json_is_not_json(self):
        assert detect_format('{"a": 1, "b": ') != JSON

    def test_logs(self):
        assert detect_format(log_payload(200)) == LOGS

    def test_code(self):
        assert detect_format(code_payload(20)) == CODE

    def test_prose_is_never_code(self):
        prose = (
            "The pump moves fluid through the volute. If the impeller wears, "
            "efficiency drops. Return the unit for service.\n"
        ) * 200
        assert detect_format(prose) == TEXT

    def test_diff(self):
        diff = "diff --git a/x.py b/x.py\n--- a/x.py\n+++ b/x.py\n@@ -1,3 +1,3 @@\n context\n-old\n+new\n"
        assert detect_format(diff) == DIFF

    def test_html(self):
        assert detect_format("<!doctype html><html><body><p>hi</p></body></html>") == HTML

    def test_grep_hits(self):
        hits = "\n".join(f"src/file_{i}.py:{i}:    matched here" for i in range(50))
        assert detect_format(hits) == SEARCH

    def test_detection_never_raises(self):
        for payload in ("", "\x00\x01\x02", "{" * 5000, "<" * 5000):
            assert detect_format(payload) in {
                JSON, DIFF, HTML, CODE, LOGS, SEARCH, TEXT,
            }


# ── the budget contract ───────────────────────────────────────────────


class TestBudget:
    @pytest.mark.parametrize("budget", [2_000, 8_000, 20_000])
    def test_never_exceeds_budget(self, budget):
        for payload in (json_payload(), log_payload(), code_payload()):
            result = compress(payload, "tool", budget=budget)
            if result is not None:
                assert len(result.text) <= budget

    def test_returns_none_below_the_minimum(self):
        assert compress("small output", "tool", budget=100) is None

    def test_returns_none_when_disabled(self, monkeypatch):
        from tools.tokenjuice import engine
        from tools.tokenjuice.config import JuiceConfig

        monkeypatch.setattr(engine, "get_config", lambda: JuiceConfig(enabled=False))
        assert compress(log_payload(), "tool", budget=5_000) is None

    def test_a_broken_compressor_falls_through_rather_than_raising(self, monkeypatch):
        from tools.tokenjuice import engine

        def explode(*_args, **_kwargs):
            raise RuntimeError("compressor is broken")

        monkeypatch.setattr(engine, "_line_drops", explode)
        assert compress(log_payload(), "tool", budget=5_000) is None


# ── the invariant that makes the whole thing safe ─────────────────────


class TestNothingIsLost:
    """Every source line is either shown or covered by a recoverable span.

    This is the property the rest of the design rests on. A compressor that
    quietly drops lines is indistinguishable from truncation, and the model
    has no way to know it should ask for more.
    """

    @pytest.mark.parametrize("budget", [2_000, 6_000, 20_000])
    def test_every_line_is_shown_or_marked(self, budget):
        payloads = {
            "json": json_payload(2000),
            "logs": log_payload(),
            "code": code_payload(),
            "text": "\n".join(f"paragraph {i} of prose about pumps" for i in range(4000)),
            "long_lines": "\n".join("y" * 9_000 for _ in range(40)),
        }
        for name, payload in payloads.items():
            result = compress(payload, "tool", budget=budget)
            if result is None:
                continue
            entry = cache.load(result.handle)
            source = cache.load_source(result.handle)
            assert entry is not None and source is not None, name

            total = len(source.split("\n"))
            covered = set()
            for span in entry.spans:
                covered.update(range(span["start"], span["end"]))

            shown = sum(
                1
                for line in source.split("\n")
                if line and line[:200] in result.text
            )
            unaccounted = [
                index
                for index in range(total)
                if index not in covered
                and source.split("\n")[index]
                and source.split("\n")[index][:200] not in result.text
            ]
            assert not unaccounted, (
                f"{name} at budget {budget}: {len(unaccounted)} lines vanished "
                f"without a marker (first: {unaccounted[:3]})"
            )
            assert shown or covered, name

    def test_a_clipped_long_line_says_it_was_clipped(self):
        result = compress("x" * 250_000, "tool", budget=8_000)
        assert result is not None
        assert "line continues for" in result.text
        # and the whole line is still readable
        recovered = expand(result.handle, offset=1, limit=1)
        assert len(recovered) > 50_000


# ── what survives ─────────────────────────────────────────────────────


class TestWhatSurvives:
    def test_error_lines_survive_log_compression(self):
        result = compress(log_payload(), "terminal", budget=8_000)
        assert result is not None
        assert "disk quota exceeded" in result.text

    def test_json_stays_recognisable_and_counts_what_it_dropped(self):
        result = compress(json_payload(4000), "web_search", budget=6_000)
        assert result is not None
        assert result.fmt == JSON
        assert '"query": "centrifugal pumps"' in result.text
        assert '"id": 0' in result.text
        markers = [
            line for line in result.text.splitlines() if line.strip().startswith("[[juice:")
        ]
        assert markers, "an elided array must leave a marker"
        assert "3,997" in markers[0]

    def test_code_keeps_signatures(self):
        result = compress(code_payload(60), "read_file", budget=10_000)
        assert result is not None
        assert result.fmt == CODE
        signatures = [
            line for line in result.text.splitlines() if line.startswith("def function_")
        ]
        assert len(signatures) >= 20

    def test_html_keeps_links_and_title_and_drops_markup(self):
        page = (
            "<!doctype html><html><head><title>Pumps</title>"
            "<style>" + "a{color:red}" * 2000 + "</style></head><body>"
            "<h1>Centrifugal</h1>"
            + "".join(f"<p>Paragraph {i}.</p>" for i in range(300))
            + '<a href="https://example.com/spec">Spec sheet</a></body></html>'
        )
        result = compress(page, "web_fetch", budget=8_000)
        assert result is not None
        assert "Pumps" in result.text
        assert "https://example.com/spec" in result.text
        assert "color:red" not in result.text

    def test_diff_keeps_changed_lines(self):
        lines = ["diff --git a/x.py b/x.py", "--- a/x.py", "+++ b/x.py", "@@ -1,400 +1,400 @@"]
        changed = []
        for i in range(400):
            if i % 40 == 0:
                lines.append(f"+added line {i}")
                changed.append(f"+added line {i}")
            else:
                lines.append(f" context line {i}")
        result = compress("\n".join(lines), "terminal", budget=4_000)
        assert result is not None
        for line in changed:
            assert line in result.text


# ── recovery ──────────────────────────────────────────────────────────


class TestExpansion:
    def test_a_span_expands_to_exactly_the_lines_it_replaced(self):
        payload = log_payload()
        result = compress(payload, "terminal", budget=8_000)
        assert result is not None and result.elisions >= 1

        entry = cache.load(result.handle)
        source = cache.load_source(result.handle)
        assert entry is not None and source is not None

        span = entry.spans[0]
        expected = source.split("\n")[span["start"] : span["end"]]
        recovered = expand(result.handle, span=span["index"]).splitlines()

        # The expander frames what it returns and clips a very large span, so
        # the contract is that the returned lines are a prefix of the elided
        # ones — exactly those lines, in order, starting from the first.
        assert expected[0] in recovered
        body = recovered[recovered.index(expected[0]) :]
        if "</expanded>" in body:
            body = body[: body.index("</expanded>")]
        assert body, "an expanded span must return lines"
        assert body == expected[: len(body)]

    def test_offset_and_limit_read_any_window(self):
        result = compress(log_payload(), "terminal", budget=8_000)
        assert result is not None
        window = expand(result.handle, offset=1, limit=3)
        assert "worker[0] processed batch 0" in window
        assert 'lines="1-3"' in window

    def test_short_prefix_resolves(self):
        result = compress(log_payload(), "terminal", budget=8_000)
        assert result is not None
        assert "<expanded" in expand(result.handle[:6], offset=1, limit=2)

    def test_unknown_handle_explains_itself(self):
        message = expand("ffffffffffff", span=1)
        assert "No cached output" in message

    def test_missing_span_lists_what_exists(self):
        result = compress(log_payload(), "terminal", budget=8_000)
        assert result is not None
        message = expand(result.handle, span=999)
        assert "no span 999" in message
        assert "Available spans" in message

    def test_expansion_is_clipped_so_it_cannot_flood_context(self):
        result = compress(json_payload(20_000), "web_search", budget=6_000)
        assert result is not None
        recovered = expand(result.handle, span=1)
        assert len(recovered) < 70_000


# ── the cache ─────────────────────────────────────────────────────────


class TestCache:
    def test_identical_content_reuses_one_entry(self):
        payload = log_payload()
        first = compress(payload, "terminal", budget=8_000)
        second = compress(payload, "terminal", budget=8_000)
        assert first is not None and second is not None
        assert first.handle == second.handle
        assert first.text == second.text

    def test_ambiguous_prefix_is_reported_not_guessed(self, monkeypatch):
        compress(log_payload(), "terminal", budget=8_000)
        compress(json_payload(), "web_search", budget=8_000)

        real_resolve = cache.resolve
        monkeypatch.setattr(
            cache, "resolve", lambda prefix: (None, ["aaaaaaaaaaaa", "aaaaaaaaaaab"])
        )
        message = expand("aaaa", span=1)
        assert "ambiguous" in message
        monkeypatch.setattr(cache, "resolve", real_resolve)

    def test_a_cache_failure_does_not_fail_compression(self, monkeypatch):
        monkeypatch.setattr(cache, "store", lambda *a, **k: False)
        result = compress(log_payload(), "terminal", budget=8_000)
        assert result is not None


# ── savings ───────────────────────────────────────────────────────────


class TestSavings:
    def test_a_compression_is_recorded(self):
        savings.reset()
        result = compress(log_payload(), "terminal", budget=8_000)
        assert result is not None
        summary = savings.summary()
        assert summary["compressions"] == 1
        assert summary["savedChars"] == result.saved_chars
        assert summary["savedTokens"] > 0
        assert summary["byTool"]["terminal"]["compressions"] == 1
        assert summary["byFormat"]["logs"]["compressions"] == 1

    def test_totals_accumulate_across_calls(self):
        savings.reset()
        compress(log_payload(), "terminal", budget=8_000)
        compress(json_payload(), "web_search", budget=8_000)
        summary = savings.summary()
        assert summary["compressions"] == 2
        assert set(summary["byTool"]) == {"terminal", "web_search"}

    def test_summary_is_empty_before_anything_happens(self):
        savings.reset()
        assert savings.summary()["compressions"] == 0


# ── the seam it plugs into ────────────────────────────────────────────


class TestStorageIntegration:
    def test_oversized_results_are_compressed_instead_of_persisted(self):
        from tools.tool_result_storage import PERSISTED_OUTPUT_TAG, maybe_persist_tool_result

        out = maybe_persist_tool_result(
            content=log_payload(),
            tool_name="terminal",
            tool_use_id="call_1",
            env=None,
            threshold=8_000,
        )
        assert "<juiced " in out
        assert PERSISTED_OUTPUT_TAG not in out
        assert len(out) <= 8_000

    def test_small_results_are_untouched(self):
        from tools.tool_result_storage import maybe_persist_tool_result

        content = "a short result"
        assert (
            maybe_persist_tool_result(
                content=content, tool_name="terminal", tool_use_id="c", env=None
            )
            == content
        )

    def test_incompressible_output_still_falls_back_to_truncation(self, monkeypatch):
        from tools import tool_result_storage

        monkeypatch.setattr(tool_result_storage, "_try_compress", lambda *a, **k: None)
        out = tool_result_storage.maybe_persist_tool_result(
            content="x" * 200_000,
            tool_name="terminal",
            tool_use_id="call_2",
            env=None,
            threshold=8_000,
        )
        assert "Truncated" in out or tool_result_storage.PERSISTED_OUTPUT_TAG in out
