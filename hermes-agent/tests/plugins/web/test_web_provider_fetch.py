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


# ---------------------------------------------------------------------------
# NCBI page URLs are served from E-utilities, not from the page front end
# ---------------------------------------------------------------------------

PUBMED_RECORD = (
    "1. Commun Biol. 2024 Oct 23;7(1):1376. doi: 10.1038/s42003-024-07026-3.\n\n"
    "Rapid modulation in music supports attention in listeners with attentional \n"
    "difficulties.\n\n"
    "Woods KJP(1), Sampaio G(2).\n\n"
    "Background music is widely used to sustain attention.\n\n"
    "DOI: 10.1038/s42003-024-07026-3\nPMID: 39443657\n"
)

PMC_ARTICLE = (
    '<?xml version="1.0"?><pmc-articleset><article><front><journal-meta>'
    "<journal-title>Commun Biol</journal-title></journal-meta><article-meta>"
    "<title-group><article-title>Rapid <italic>modulation</italic> in music</article-title>"
    "</title-group></article-meta></front>"
    "<abstract><p>Background music is widely used.</p></abstract>"
    "<body><sec><title>Results</title><p>Modulated music improved SART scores.</p>"
    "<table-wrap><table><tr><td>cell noise</td></tr></table></table-wrap></sec></body>"
    "<back><ref-list><ref>Reference noise</ref></ref-list></back>"
    "</article></pmc-articleset>"
)


class _Reply:
    def __init__(self, text: str, status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code


def _eutils(monkeypatch: pytest.MonkeyPatch, replies: dict[str, _Reply]) -> list[dict]:
    """Patch ``httpx.get`` to answer efetch by ``db`` and record the calls."""
    import httpx

    calls: list[dict] = []

    def fake_get(url: str, params: dict | None = None, **kwargs):
        assert url.startswith("https://eutils.ncbi.nlm.nih.gov/")
        calls.append(dict(params or {}))
        return replies[(params or {})["db"]]

    monkeypatch.setattr(httpx, "get", fake_get)
    return calls


def test_pubmed_page_url_is_read_through_eutils(monkeypatch: pytest.MonkeyPatch) -> None:
    """PubMed's HTML front answers every non-browser client with a bare 403."""

    def forbidden(url: str):  # pragma: no cover — the front end must not be asked
        raise AssertionError("PubMed page was fetched directly")

    monkeypatch.setattr("plugins.web.fetch.provider._fetch", forbidden)
    calls = _eutils(monkeypatch, {"pubmed": _Reply(PUBMED_RECORD)})

    result = _provider().extract(["https://pubmed.ncbi.nlm.nih.gov/39443657/"])[0]

    assert calls == [
        {"db": "pubmed", "id": "39443657", "rettype": "abstract", "retmode": "text"}
    ]
    assert result["title"] == (
        "Rapid modulation in music supports attention in listeners with attentional difficulties."
    )
    assert "Background music is widely used" in result["content"]
    assert result["metadata"]["via"] == "ncbi-eutils"
    assert "error" not in result


def test_pmc_article_url_is_read_as_full_text_jats(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both PMC URL spellings resolve to the same efetch call, and the JATS
    apparatus (tables, references) is left out of the readable text."""
    monkeypatch.setattr("plugins.web.fetch.provider._fetch", lambda url: (_ for _ in ()).throw(AssertionError(url)))
    calls = _eutils(monkeypatch, {"pmc": _Reply(PMC_ARTICLE)})

    results = _provider().extract(
        [
            "https://pmc.ncbi.nlm.nih.gov/articles/PMC11499863/",
            "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11499863",
        ]
    )

    assert calls == [{"db": "pmc", "id": "11499863", "retmode": "xml"}] * 2
    for result in results:
        assert result["title"] == "Rapid modulation in music"
        assert "Modulated music improved SART scores." in result["content"]
        assert "Background music is widely used." in result["content"]
        assert "cell noise" not in result["content"]
        assert "Reference noise" not in result["content"]


def test_unknown_ncbi_id_falls_through_to_the_page_and_reports_its_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _eutils(monkeypatch, {"pubmed": _Reply("1. \n")})

    def forbidden(url: str):
        raise RuntimeError("The page returned HTTP 403")

    monkeypatch.setattr("plugins.web.fetch.provider._fetch", forbidden)

    result = _provider().extract(["https://pubmed.ncbi.nlm.nih.gov/999999999999/"])[0]
    assert result["error"] == "The page returned HTTP 403"


def test_other_ncbi_pages_still_use_the_plain_fetch(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setattr(httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("eutils asked")))
    monkeypatch.setattr(
        "plugins.web.fetch.provider._fetch",
        lambda url: (url, "text/html", PAGE),
    )
    result = _provider().extract(["https://www.ncbi.nlm.nih.gov/books/NBK1234/"])[0]
    assert result["title"] == "Student teams"
