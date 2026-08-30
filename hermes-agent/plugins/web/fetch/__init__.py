"""Direct-fetch extract plugin — bundled, auto-loaded.

Every other extract-capable backend in this tree (Firecrawl, Tavily, Exa,
Parallel) is a paid reader service behind an API key, so an install with no
keys has web *search* and no way to read any page it finds. This provider
closes that gap the plain way: it requests the URL itself and turns the HTML
into text. Search stays with whichever backend is configured for it.
"""

from __future__ import annotations

from plugins.web.fetch.provider import DirectFetchWebProvider


def register(ctx) -> None:
    """Register the direct-fetch provider with the plugin context."""
    ctx.register_web_search_provider(DirectFetchWebProvider())
