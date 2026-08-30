"""Direct page fetch + readable-text extraction — plugin form.

The extract capability in this tree is otherwise entirely third-party:
Firecrawl, Tavily, Exa and Parallel each want an API key, and an install
without one gets ``web_search`` results it can never open. That is the worst
possible shape for research — the model sees titles and snippets, cites them,
and never reads a page. This provider reads the page.

What it is: an HTTP GET with the same SSRF and website-policy gates the
Firecrawl provider applies, followed by boilerplate-stripped text extraction
with ``lxml``. What it is not: a rendering engine. Pages whose content is
assembled by client-side JavaScript come back thin or empty, and the honest
answer there is a browser (``browser_navigate``), not a better parser.

Config::

  web:
    search_backend: ddgs      # or any other search provider
    extract_backend: fetch    # this provider

Sync by design. :func:`tools.web_tools.web_extract_tool` runs sync providers
through ``asyncio.to_thread``, so the blocking HTTP calls never touch the
event loop and the per-URL loop stays readable.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from agent.web_search_provider import WebSearchProvider
from tools.url_safety import is_safe_url
from tools.website_policy import check_website_access

logger = logging.getLogger(__name__)

# Per-URL wall clock. Long enough for a slow institutional site, short enough
# that one dead host cannot stall a multi-URL research step.
_TIMEOUT_SECONDS = 30.0
# Hard cap on downloaded bytes. Read incrementally so an attacker-controlled
# (or merely enormous) response cannot exhaust memory before the check runs.
_MAX_BYTES = 5 * 1024 * 1024
_MAX_REDIRECTS = 5

# Presenting as a browser is not evasion here — many sites serve a bare
# challenge page or a 403 to an unrecognized agent, and the alternative is
# reporting "the page is empty" about a page that is not.
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

# Elements that never carry the page's substance. Dropped whole, with their
# subtrees, before any text is taken.
_STRIP_TAGS = (
    "script",
    "style",
    "noscript",
    "svg",
    "canvas",
    "template",
    "iframe",
    "form",
    "nav",
    "header",
    "footer",
    "aside",
)

# Tried in order for the main content region. A page that marks its own
# content is taken at its word; everything else falls back to <body>.
_CONTENT_XPATHS = (
    "//main",
    "//article",
    "//*[@role='main']",
    "//*[@id='content']",
    "//*[@id='main']",
    "//*[contains(@class, 'content')]",
)

# Tags whose end implies a line break in the text rendering.
_BLOCK_TAGS = {
    "address", "article", "aside", "blockquote", "div", "dd", "dl", "dt",
    "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4",
    "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
    "section", "table", "tbody", "td", "th", "thead", "tr", "ul",
}

_TEXTUAL_TYPES = {
    "application/atom+xml",
    "application/javascript",
    "application/json",
    "application/ld+json",
    "application/rss+xml",
    "application/x-ndjson",
    "application/x-yaml",
    "application/xml",
    "application/yaml",
}


def _is_html(content_type: str, body: str) -> bool:
    if content_type in ("text/html", "application/xhtml+xml"):
        return True
    if content_type:
        return False
    # A server that sent no content-type at all still usually sent HTML.
    return bool(re.search(r"<\s*(html|body|div|p|h1)\b", body[:2000], re.I))


def _is_textual(content_type: str) -> bool:
    return (
        not content_type
        or content_type.startswith("text/")
        or content_type in _TEXTUAL_TYPES
        or content_type.endswith("+json")
        or content_type.endswith("+xml")
    )


def _compact(text: str) -> str:
    """Collapse the whitespace an HTML-to-text pass leaves behind."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _element_text(element: Any) -> str:
    """Render an lxml element as text with block-level line breaks.

    ``itertext()`` alone runs every block together — a navigation list becomes
    one unreadable line and a table loses its rows. Walking the tree lets each
    block tag contribute the break it implies, which is most of what makes
    extracted text usable as evidence.
    """
    parts: List[str] = []

    def walk(node: Any) -> None:
        tag = node.tag if isinstance(node.tag, str) else ""
        lowered = tag.lower()
        if lowered == "br":
            parts.append("\n")
        elif lowered == "li":
            parts.append("\n- ")
        elif lowered in _BLOCK_TAGS:
            parts.append("\n")
        if node.text:
            parts.append(node.text)
        for child in node:
            walk(child)
            if child.tail:
                parts.append(child.tail)
        if lowered in _BLOCK_TAGS or lowered == "li":
            parts.append("\n")

    walk(element)
    return _compact("".join(parts))


def _readable_text(html: str) -> tuple[str, str]:
    """Return ``(title, text)`` for an HTML document.

    Boilerplate is removed by element, not by regex, so a ``<footer>`` inside
    the article and a stray ``</script>`` in a string literal both behave.
    """
    from lxml import html as lxml_html

    try:
        document = lxml_html.fromstring(html)
    except Exception as exc:  # noqa: BLE001 — malformed markup is routine
        logger.debug("lxml could not parse the document: %s", exc)
        stripped = re.sub(r"<[^>]+>", " ", html)
        return "", _compact(stripped)

    title = ""
    title_nodes = document.xpath("//title")
    if title_nodes:
        title = _compact(title_nodes[0].text_content())

    for tag in _STRIP_TAGS:
        for node in document.xpath(f"//{tag}"):
            parent = node.getparent()
            if parent is not None:
                parent.remove(node)

    # Comments carry no text a reader wants and often carry build noise.
    for node in document.xpath("//comment()"):
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)

    region = None
    for xpath in _CONTENT_XPATHS:
        candidates = document.xpath(xpath)
        if candidates:
            # The longest match wins: `.content` matches wrappers as well as
            # the article, and the wrapper is usually the one worth reading.
            region = max(candidates, key=lambda node: len(node.text_content()))
            break
    if region is None:
        body = document.xpath("//body")
        region = body[0] if body else document

    text = _element_text(region)
    # A content-region guess that produced almost nothing is a wrong guess,
    # not an empty page — fall back to the whole document before giving up.
    if len(text) < 200:
        body = document.xpath("//body")
        whole = _element_text(body[0] if body else document)
        if len(whole) > len(text):
            text = whole
    return title, text


def _fetch(url: str) -> tuple[str, str, str]:
    """GET *url* and return ``(final_url, content_type, body_text)``.

    Redirects are followed manually so every hop can be re-checked against the
    SSRF and website-access gates: a public URL that redirects to ``127.0.0.1``
    must not become a read of the user's own machine.
    """
    import httpx

    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        with httpx.Client(
            follow_redirects=False,
            timeout=_TIMEOUT_SECONDS,
            headers={
                "User-Agent": _USER_AGENT,
                "Accept": (
                    "text/html,application/xhtml+xml,application/xml;q=0.9,"
                    "text/plain;q=0.8,*/*;q=0.5"
                ),
                "Accept-Language": "en-US,en;q=0.9",
            },
        ) as client:
            with client.stream("GET", current) as response:
                if response.is_redirect:
                    location = response.headers.get("location", "")
                    if not location:
                        raise RuntimeError(
                            f"HTTP {response.status_code} with no redirect target"
                        )
                    following = str(httpx.URL(current).join(location))
                    if not is_safe_url(following):
                        raise RuntimeError(
                            "Blocked: redirect targets a private or internal "
                            "network address"
                        )
                    blocked = check_website_access(following)
                    if blocked:
                        raise RuntimeError(str(blocked["message"]))
                    current = following
                    continue

                if response.status_code >= 400:
                    raise RuntimeError(
                        f"The page returned HTTP {response.status_code}"
                    )

                declared = response.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > _MAX_BYTES:
                    raise RuntimeError(
                        f"Page is larger than {_MAX_BYTES // (1024 * 1024)} MB"
                    )

                chunks: List[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > _MAX_BYTES:
                        # Truncation beats failure: the head of a huge page is
                        # still evidence, and the dispatcher truncates anyway.
                        logger.info("Truncating oversized page at %s", current)
                        break
                    chunks.append(chunk)

                raw = b"".join(chunks)
                content_type = (
                    response.headers.get("content-type", "").split(";")[0].strip().lower()
                )
                encoding = response.encoding or "utf-8"
                try:
                    body = raw.decode(encoding, errors="replace")
                except LookupError:
                    body = raw.decode("utf-8", errors="replace")
                return str(response.url), content_type, body

    raise RuntimeError(f"Too many redirects (over {_MAX_REDIRECTS})")


class DirectFetchWebProvider(WebSearchProvider):
    """Keyless ``web_extract`` backend: fetch the URL, return its text.

    Extract-only. It never registers as a search backend, so pairing it with
    ddgs, SearXNG, Brave or any paid search provider is the expected setup
    rather than a compromise.
    """

    @property
    def name(self) -> str:
        return "fetch"

    @property
    def display_name(self) -> str:
        return "Direct fetch"

    def is_available(self) -> bool:
        """True when ``httpx`` and ``lxml`` are importable.

        Both are Hermes dependencies rather than optional extras, so this is
        effectively always true — the probe exists because a stripped install
        must fail the availability gate instead of the first extract call.
        """
        try:
            import httpx  # noqa: F401
            import lxml  # noqa: F401

            return True
        except ImportError:
            return False

    def supports_search(self) -> bool:
        return False

    def supports_extract(self) -> bool:
        return True

    def search(self, query: str, limit: int = 5) -> Dict[str, Any]:
        return {
            "success": False,
            "error": (
                "Direct fetch is an extract-only backend. Set web.search_backend "
                "to a search provider (ddgs needs no API key)."
            ),
        }

    def extract(
        self, urls: List[str], **kwargs: Any
    ) -> List[Dict[str, Any]]:
        """Read each URL and return the legacy per-URL result list.

        Per-URL failures become an ``error`` entry rather than raising, so one
        dead link in a research batch never costs the other nine.
        """
        from tools.interrupt import is_interrupted as _is_interrupted

        want_html = str(kwargs.get("format") or "").lower() == "html"
        results: List[Dict[str, Any]] = []

        for url in urls:
            if _is_interrupted():
                results.append({"url": url, "title": "", "content": "", "error": "Interrupted"})
                continue

            blocked = check_website_access(url)
            if blocked:
                logger.info(
                    "Blocked web_extract for %s by rule %s",
                    blocked["host"],
                    blocked["rule"],
                )
                results.append(
                    {
                        "url": url,
                        "title": "",
                        "content": "",
                        "error": blocked["message"],
                        "blocked_by_policy": {
                            "host": blocked["host"],
                            "rule": blocked["rule"],
                            "source": blocked["source"],
                        },
                    }
                )
                continue

            try:
                final_url, content_type, body = _fetch(url)
            except Exception as exc:  # noqa: BLE001 — network errors are per-URL
                logger.info("Direct fetch failed for %s: %s", url, exc)
                results.append(
                    {
                        "url": url,
                        "title": "",
                        "content": "",
                        "raw_content": "",
                        "error": str(exc),
                    }
                )
                continue

            if content_type == "application/pdf" or final_url.lower().endswith(".pdf"):
                results.append(
                    {
                        "url": final_url,
                        "title": "",
                        "content": "",
                        "raw_content": "",
                        "error": (
                            "This URL is a PDF. Direct fetch reads web pages, not "
                            "PDFs — download it and read the file instead."
                        ),
                    }
                )
                continue

            if _is_html(content_type, body):
                title, text = _readable_text(body)
                content = body if want_html else text
            elif _is_textual(content_type):
                title, content = "", _compact(body)
            else:
                results.append(
                    {
                        "url": final_url,
                        "title": "",
                        "content": "",
                        "raw_content": "",
                        "error": f"Unsupported content type: {content_type or 'unknown'}",
                    }
                )
                continue

            if not content.strip():
                # Saying "empty" about a page that rendered client-side sends
                # the model looking for another source when the fix is a browser.
                results.append(
                    {
                        "url": final_url,
                        "title": title,
                        "content": "",
                        "raw_content": "",
                        "error": (
                            "The page returned no readable text — its content is "
                            "likely rendered by JavaScript. Try browser_navigate."
                        ),
                    }
                )
                continue

            results.append(
                {
                    "url": final_url,
                    "title": title,
                    "content": content,
                    "raw_content": content,
                    "metadata": {
                        "sourceURL": final_url,
                        "title": title,
                        "contentType": content_type,
                    },
                }
            )

        return results

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": "Direct fetch",
            "badge": "free · no key · extract only",
            "tag": (
                "Reads pages over plain HTTP and strips them to text — no reader "
                "service, no API key (pair with any search provider)"
            ),
            "env_vars": [],
        }
