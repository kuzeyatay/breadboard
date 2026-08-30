"""MusicBrainz metadata plugin.

Registers six read-only tools into the ``musicbrainz`` toolset, covering
artist/release/recording search, release and artist lookup, and Cover Art
Archive artwork.

MusicBrainz is open data and has no API key, so there is no auth gate and
no ``check_fn`` tied to credentials. The one required setting is a contact
address for the mandatory User-Agent header
(``plugins.entries.musicbrainz.contact_email``); when it is missing the
tools stay registered and return an actionable "not_configured" error
rather than disappearing, so the model can tell the user what to set.
"""

from __future__ import annotations

from plugins.musicbrainz.tools import (
    GET_COVER_ART_SCHEMA,
    LOOKUP_ARTIST_SCHEMA,
    LOOKUP_RELEASE_SCHEMA,
    SEARCH_ARTIST_SCHEMA,
    SEARCH_RECORDING_SCHEMA,
    SEARCH_RELEASE_SCHEMA,
    handle_get_cover_art,
    handle_lookup_artist,
    handle_lookup_release,
    handle_search_artist,
    handle_search_recording,
    handle_search_release,
)

_TOOLS = (
    ("musicbrainz_search_artist",    SEARCH_ARTIST_SCHEMA,    handle_search_artist,    "\U0001F3A4"),
    ("musicbrainz_search_release",   SEARCH_RELEASE_SCHEMA,   handle_search_release,   "\U0001F4BF"),
    ("musicbrainz_lookup_release",   LOOKUP_RELEASE_SCHEMA,   handle_lookup_release,   "\U0001F4C0"),
    ("musicbrainz_lookup_artist",    LOOKUP_ARTIST_SCHEMA,    handle_lookup_artist,    "\U0001F464"),
    ("musicbrainz_search_recording", SEARCH_RECORDING_SCHEMA, handle_search_recording, "\U0001F3B5"),
    ("musicbrainz_get_cover_art",    GET_COVER_ART_SCHEMA,    handle_get_cover_art,    "\U0001F5BC"),
)


def register(ctx) -> None:
    """Register all MusicBrainz tools. Called once by the plugin loader."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="musicbrainz",
            schema=schema,
            handler=handler,
            emoji=emoji,
        )
