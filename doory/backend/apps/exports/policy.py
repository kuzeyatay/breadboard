"""Network policy for the print browser.

Standard library only: this module is also imported by the sandboxed worker process, which must not
need Django. Chromium may load `data:` URLs and plain GET requests to a short list of origins and
path prefixes (our own `/media/` and `/static/`); every other request is blocked and counted.

The image export opens the frontend's headless render page instead of printing static HTML. Its policy adds
that one page and the bundle it loads (`/assets/`), on the render page's own origin only.

The video export needs the browser's encoders (WebCodecs), which exist only in a secure context: a render
page at a plain `http://` address (Docker's `http://doory-web:8080`) is opened at `secure_alias` instead, and
the worker serves every request to the alias from the real address (`unaliased`).
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import unquote, urlsplit, urlunsplit

DEFAULT_PORTS = {"http": 80, "https": 443}
RENDER_PAGE_PREFIXES = ("/assets/",)


def normalize_origin(value: str) -> str | None:
    """`scheme://host:port` with default ports spelled out, or None when `value` is not an http(s) origin."""
    try:
        parts = urlsplit(value.strip())
        port = parts.port
    except ValueError:
        return None
    if parts.scheme not in DEFAULT_PORTS or not parts.hostname:
        return None
    return f"{parts.scheme}://{parts.hostname.lower()}:{port or DEFAULT_PORTS[parts.scheme]}"


def secure_alias(page_url: str) -> str | None:
    """`http://<host>.localhost:<port>/...` for a render page at a plain `http://` address, or None when the
    page is in a secure context already (https, localhost) or has no name to put in front of `.localhost`
    (IPv6). Chromium treats every `*.localhost` origin as secure and never resolves the alias: the worker's
    route serves it, so it reaches nothing of its own. A loopback IP gets one too, though it is secure as it
    is: the alias costs nothing there."""
    try:
        parts = urlsplit(page_url)
        port = parts.port or DEFAULT_PORTS["http"]
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if parts.scheme != "http" or not host or ":" in host:
        return None
    if host == "localhost" or host.endswith(".localhost"):
        return None
    return urlunsplit(("http", f"{host}.localhost:{port}", parts.path, parts.query, ""))


def unaliased(url: str, alias: str, page_url: str) -> str:
    """`url` on the render page's real address when it is on the `alias` one (`secure_alias`), else as is."""
    origin = normalize_origin(url)
    if origin is None or origin != normalize_origin(alias):
        return url
    parts, real = urlsplit(url), urlsplit(page_url)
    return urlunsplit((real.scheme, real.netloc, parts.path, parts.query, parts.fragment))


@dataclass(frozen=True)
class Decision:
    allowed: bool
    reason: str
    fetch: bool = False  # True: the worker must fetch it itself (no redirects) instead of letting Chromium


@dataclass(frozen=True)
class RequestPolicy:
    allowed_origins: frozenset[str]
    path_prefixes: tuple[str, ...]
    # Image mode only: the render page's origin (allowed like the others, since relative `/media/` URLs in
    # the design resolve against it) and the extra paths it serves there: the page itself and its bundle.
    page_origin: str | None = None
    page_path: str = ""
    page_prefixes: tuple[str, ...] = ()

    @classmethod
    def build(
        cls,
        origins: list[str] | tuple[str, ...],
        path_prefixes: list[str] | tuple[str, ...],
        *,
        page_url: str | None = None,
    ) -> RequestPolicy:
        normalized = {origin for origin in map(normalize_origin, origins) if origin}
        prefixes = tuple(
            prefix if prefix.endswith("/") else prefix + "/" for prefix in path_prefixes if prefix
        )
        if not page_url:
            return cls(frozenset(normalized), prefixes)
        page_origin = normalize_origin(page_url)
        page_path = unquote(urlsplit(page_url).path)
        if page_origin is None or not page_path.endswith(".html"):
            raise ValueError(f"not a render page URL: {page_url!r}")
        return cls(
            frozenset(normalized | {page_origin}), prefixes, page_origin, page_path, RENDER_PAGE_PREFIXES
        )

    def evaluate(self, url: str, method: str = "GET") -> Decision:
        scheme = url[:5].lower()
        if scheme == "data:":
            return Decision(True, "data-url")
        if url == "about:blank":
            return Decision(True, "blank")
        try:
            parts = urlsplit(url)
            parts.port  # noqa: B018 - raises ValueError on a malformed port
        except ValueError:
            return Decision(False, "malformed-url")
        if parts.scheme not in DEFAULT_PORTS:
            return Decision(False, f"scheme-{parts.scheme or 'none'}")
        if method.upper() != "GET":
            return Decision(False, "method")
        if parts.username is not None or parts.password is not None:
            return Decision(False, "credentials-in-url")
        origin = normalize_origin(url)
        if origin is None or origin not in self.allowed_origins:
            return Decision(False, "origin")
        path = unquote(parts.path)
        if "\\" in path or "\x00" in path or any(segment in {".", ".."} for segment in path.split("/")):
            return Decision(False, "path-traversal")
        if any(path.startswith(prefix) for prefix in self.path_prefixes):
            return Decision(True, "same-origin", fetch=True)
        if origin == self.page_origin and (
            path == self.page_path or any(path.startswith(prefix) for prefix in self.page_prefixes)
        ):
            return Decision(True, "render-page", fetch=True)
        return Decision(False, "path")
