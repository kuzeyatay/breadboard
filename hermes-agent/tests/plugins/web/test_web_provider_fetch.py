"""Tests for the keyless direct-fetch extract provider (plugins/web/fetch).

The provider exists because every other extract backend needs an API key, so
an install without one could search the web and never open a page. These tests
cover the three things that makes true: it registers and advertises extract
without a credential, it turns real HTML into readable text, and its per-URL
failures stay per-URL instead of taking the batch down.

No network: the HTTP layer is patched at ``_fetch``, which is the seam between
"getting bytes" and "making them readable".
"""
from __future__ import annotations

import pytest

from plugins.web.fetch.provider import DirectFetchWebProvider, _readable_text


PAGE = """
<html>
  <head><title>Student teams</title></head>
  <body>
    <nav><a href="/study">Study</a><a href="/live">Living</a></nav>
    <main>
      <h1>Student teams</h1>
      <ul><li>Solar Team</li><li>Aero Team</li></ul>
      <p>Thirty teams, about 550 members.</p>
      <script>var hidden = 1;</script>
    </main>
    <footer>Contact us</footer>
  </body>
</html>
"""


def _provider() -> DirectFetchWebProvider:
    return DirectFetchWebProvider()


# ---------------------------------------------------------------------------
# Capability shape
# ---------------------------------------------------------------------------


def test_provider_is_extract_only_and_needs_no_credential(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ("FIRECRAWL_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "PARALLEL_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    provider = _provider()
    assert provider.name == "fetch"
    assert provider.is_available() is True
    assert provider.supports_extract() is True
    assert provider.supports_search() is False
    # Being asked to search is a configuration mistake, not a crash.
    assert provider.search("anything")["success"] is False


def test_registry_resolves_fetch_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from hermes_cli.plugins import _ensure_plugins_discovered

    _ensure_plugins_discovered()
    from agent import web_search_registry

    monkeypatch.setattr(
        web_search_registry,
        "_read_config_key",
        lambda section, key: "fetch" if key == "extract_backend" else None,
    )
    provider = web_search_registry.get_active_extract_provider()
    assert provider is not None and provider.name == "fetch"


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------


def test_readable_text_keeps_content_and_drops_chrome() -> None:
    title, text = _readable_text(PAGE)
    assert title == "Student teams"
    assert "Solar Team" in text
    assert "about 550 members" in text
    # Navigation, footer and scripts are boilerplate at best and noise at worst.
    assert "Living" not in text
    assert "Contact us" not in text
    assert "var hidden" not in text


def test_extract_returns_the_legacy_per_url_shape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "plugins.web.fetch.provider._fetch",
        lambda url: ("https://example.org/teams", "text/html", PAGE),
    )
    results = _provider().extract(["https://example.org/teams"])
    assert len(results) == 1
    result = results[0]
    assert result["url"] == "https://example.org/teams"
    assert result["title"] == "Student teams"
    assert "Solar Team" in result["content"]
    assert result["content"] == result["raw_content"]
    assert "error" not in result


def test_html_format_returns_the_markup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "plugins.web.fetch.provider._fetch",
        lambda url: ("https://example.org/teams", "text/html", PAGE),
    )
    result = _provider().extract(["https://example.org/teams"], format="html")[0]
    assert "<main>" in result["content"]


def test_one_dead_url_does_not_take_down_the_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_fetch(url: str):
        if "dead" in url:
            raise RuntimeError("The page returned HTTP 404")
        return (url, "text/html", PAGE)

    monkeypatch.setattr("plugins.web.fetch.provider._fetch", fake_fetch)
    results = _provider().extract(
        ["https://example.org/dead", "https://example.org/teams"]
    )
    assert results[0]["error"] == "The page returned HTTP 404"
    assert results[0]["content"] == ""
    # Order is preserved and the live URL is unaffected.
    assert "Solar Team" in results[1]["content"]


def test_empty_render_points_at_the_browser(monkeypatch: pytest.MonkeyPatch) -> None:
    # A single-page app returns a shell with no text. Reporting that as an empty
    # page sends the model looking for another source; the fix is a browser.
    monkeypatch.setattr(
        "plugins.web.fetch.provider._fetch",
        lambda url: (url, "text/html", "<html><body><div id='root'></div></body></html>"),
    )
    result = _provider().extract(["https://example.org/app"])[0]
    assert "browser_navigate" in result["error"]


def test_pdf_is_refused_with_a_usable_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "plugins.web.fetch.provider._fetch",
        lambda url: (url, "application/pdf", "%PDF-1.7"),
    )
    result = _provider().extract(["https://example.org/paper.pdf"])[0]
    assert "PDF" in result["error"]


def test_policy_blocked_host_never_reaches_the_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def explode(url: str):  # pragma: no cover — must not run
        raise AssertionError("blocked URL was fetched")

    monkeypatch.setattr("plugins.web.fetch.provider._fetch", explode)
    monkeypatch.setattr(
        "plugins.web.fetch.provider.check_website_access",
        lambda url: {
            "host": "blocked.example",
            "rule": "denylist",
            "source": "config",
            "message": "Blocked by website policy",
        },
    )
    result = _provider().extract(["https://blocked.example/page"])[0]
    assert result["error"] == "Blocked by website policy"
    assert result["blocked_by_policy"]["rule"] == "denylist"
