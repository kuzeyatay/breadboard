"""Tool schemas and handlers for the MusicBrainz plugin.

Each handler trims the MusicBrainz payload down to the fields a model
actually reasons about. The raw responses are deeply nested (a release
lookup with recordings is routinely 100KB+ of artist-credit objects
repeated once per track) and spending that context buys nothing. The rule
applied throughout: keep every MBID, drop everything reconstructible by a
follow-up call.

Handlers return JSON strings and never raise, per the plugin tool contract.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from plugins.musicbrainz.client import (
    MusicBrainzConfigError,
    MusicBrainzError,
    MusicBrainzNotFoundError,
    MusicBrainzRateLimitError,
    caa_get,
    coerce_bool,
    coerce_limit,
    escape_lucene,
    mb_get,
    validate_mbid,
)
from tools.registry import tool_error, tool_result


def _tool_error(exc: Exception) -> str:
    """Map an exception to the JSON error shape, keeping the cause legible."""
    if isinstance(exc, MusicBrainzNotFoundError):
        return tool_error(str(exc), reason="not_found")
    if isinstance(exc, MusicBrainzRateLimitError):
        return tool_error(str(exc), reason="rate_limited", retryable=True)
    if isinstance(exc, MusicBrainzConfigError):
        return tool_error(str(exc), reason="not_configured")
    if isinstance(exc, MusicBrainzError):
        return tool_error(str(exc), reason="musicbrainz_error")
    return tool_error(f"MusicBrainz tool failed: {type(exc).__name__}: {exc}")


# ---------------------------------------------------------------------------
# Shared trimming helpers
# ---------------------------------------------------------------------------


def _artist_credit_name(credits: Any) -> str:
    """Flatten an artist-credit array into its display string.

    MusicBrainz models collaborations as a list of credits interleaved with
    join phrases ("Simon" + " & " + "Garfunkel"). Rebuilding that string is
    what almost every caller wants; the structured form stays available via
    ``_artist_credit_ids``.
    """
    if not isinstance(credits, list):
        return ""
    parts: List[str] = []
    for credit in credits:
        if not isinstance(credit, dict):
            continue
        name = credit.get("name") or (credit.get("artist") or {}).get("name") or ""
        parts.append(str(name))
        parts.append(str(credit.get("joinphrase") or ""))
    return "".join(parts).strip()


def _artist_credit_ids(credits: Any) -> List[Dict[str, str]]:
    """Keep the credited artists' MBIDs so the model can drill into them."""
    out: List[Dict[str, str]] = []
    if not isinstance(credits, list):
        return out
    for credit in credits:
        artist = (credit or {}).get("artist") or {}
        if artist.get("id"):
            out.append({"mbid": artist["id"], "name": artist.get("name") or ""})
    return out


def _format_length(ms: Any) -> Optional[str]:
    """Render a millisecond duration as m:ss, which reads better than 253000."""
    try:
        total = int(ms)
    except (TypeError, ValueError):
        return None
    if total <= 0:
        return None
    seconds = round(total / 1000)
    return f"{seconds // 60}:{seconds % 60:02d}"


def _release_track_count(release: Dict[str, Any]) -> Optional[int]:
    """Prefer the top-level count; fall back to summing the media."""
    if isinstance(release.get("track-count"), int):
        return release["track-count"]
    media = release.get("media")
    if isinstance(media, list):
        total = sum(m.get("track-count") or 0 for m in media if isinstance(m, dict))
        if total:
            return total
    return None


def _build_query(*clauses: Optional[str]) -> str:
    return " AND ".join(c for c in clauses if c)


# ---------------------------------------------------------------------------
# 1. search_artist
# ---------------------------------------------------------------------------

SEARCH_ARTIST_SCHEMA = {
    "name": "musicbrainz_search_artist",
    "description": (
        "Search MusicBrainz for ARTISTS (performers, bands, composers, labels' "
        "acts) by name, and get back their MBIDs. Use this first whenever you "
        "know a name but not an ID - almost every other MusicBrainz tool needs "
        "an MBID, and this is how you get an artist one. Returns mbid, name, "
        "disambiguation (the short parenthetical that separates same-named "
        "acts, e.g. 'UK rock band' vs 'US rapper'), country, type "
        "(Person/Group/Orchestra/...), and a relevance score 0-100. "
        "Use this when the subject of the question is a PERSON OR BAND. If you "
        "want an album use musicbrainz_search_release; if you want a single "
        "song use musicbrainz_search_recording. An empty results list means no "
        "artist matched, which is a valid answer, not an error."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Artist or band name to search for, e.g. 'Radiohead'.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results to return, 1-100. Default 10.",
            },
        },
        "required": ["name"],
    },
}


def handle_search_artist(args: dict, **kwargs) -> str:
    try:
        name = str(args.get("name") or "").strip()
        if not name:
            return tool_error("name is required and cannot be empty.")
        limit = coerce_limit(args.get("limit"), default=10)

        payload = mb_get(
            "artist",
            {"query": f'artist:"{escape_lucene(name)}"', "limit": limit},
            entity_hint="artist",
        )

        artists = []
        for item in payload.get("artists") or []:
            artists.append(
                {
                    "mbid": item.get("id"),
                    "name": item.get("name"),
                    "disambiguation": item.get("disambiguation") or "",
                    "country": item.get("country") or item.get("area", {}).get("name") or "",
                    "type": item.get("type") or "",
                    "score": item.get("score"),
                }
            )

        return tool_result(
            {
                "success": True,
                "query": name,
                "count": len(artists),
                "total_available": payload.get("count", len(artists)),
                "artists": artists,
                **(
                    {"message": f"No artist found matching {name!r}."}
                    if not artists
                    else {}
                ),
            }
        )
    except Exception as exc:
        return _tool_error(exc)


# ---------------------------------------------------------------------------
# 2. search_release
# ---------------------------------------------------------------------------

SEARCH_RELEASE_SCHEMA = {
    "name": "musicbrainz_search_release",
    "description": (
        "Search MusicBrainz for RELEASES - a specific issue of an album, EP, or "
        "single (a particular pressing, country, and year). Use this when the "
        "question is about an ALBUM as a product: which year it came out, which "
        "country an edition is from, how many tracks it has, or to get a release "
        "MBID to feed into musicbrainz_lookup_release for a tracklist. "
        "Choose this over musicbrainz_search_recording when the user names an "
        "album; choose search_recording when they name a single song. Note that "
        "popular albums have many releases (original, remaster, vinyl, Japanese "
        "edition), so expect near-duplicate titles differing by date/country - "
        "pass the artist to narrow them. Returns mbid, title, artist, date, "
        "country, track_count. Empty results are a valid answer, not an error."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Release/album title, e.g. 'OK Computer'.",
            },
            "artist": {
                "type": "string",
                "description": (
                    "Optional artist name to disambiguate. Strongly recommended "
                    "for common titles like 'Greatest Hits'."
                ),
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results to return, 1-100. Default 10.",
            },
        },
        "required": ["title"],
    },
}


def handle_search_release(args: dict, **kwargs) -> str:
    try:
        title = str(args.get("title") or "").strip()
        if not title:
            return tool_error("title is required and cannot be empty.")
        artist = str(args.get("artist") or "").strip()
        limit = coerce_limit(args.get("limit"), default=10)

        query = _build_query(
            f'release:"{escape_lucene(title)}"',
            f'artist:"{escape_lucene(artist)}"' if artist else None,
        )
        payload = mb_get("release", {"query": query, "limit": limit}, entity_hint="release")

        releases = []
        for item in payload.get("releases") or []:
            releases.append(
                {
                    "mbid": item.get("id"),
                    "title": item.get("title"),
                    "artist": _artist_credit_name(item.get("artist-credit")),
                    "date": item.get("date") or "",
                    "country": item.get("country") or "",
                    "track_count": _release_track_count(item),
                    "status": item.get("status") or "",
                    "score": item.get("score"),
                }
            )

        return tool_result(
            {
                "success": True,
                "query": {"title": title, "artist": artist or None},
                "count": len(releases),
                "total_available": payload.get("count", len(releases)),
                "releases": releases,
                **(
                    {
                        "message": (
                            f"No release found matching {title!r}"
                            + (f" by {artist!r}" if artist else "")
                            + "."
                        )
                    }
                    if not releases
                    else {}
                ),
            }
        )
    except Exception as exc:
        return _tool_error(exc)


# ---------------------------------------------------------------------------
# 3. lookup_release
# ---------------------------------------------------------------------------

LOOKUP_RELEASE_SCHEMA = {
    "name": "musicbrainz_lookup_release",
    "description": (
        "Fetch one RELEASE by its MBID, including the full TRACKLIST: track "
        "number, title, length, and each track's recording MBID. This is the "
        "tool that answers 'what songs are on this album and in what order'. "
        "It needs an MBID, so call musicbrainz_search_release first unless you "
        "already have one. Unlike search_release (which returns many shallow "
        "candidates), this returns one release in depth. Multi-disc releases "
        "come back as a list of media, each with its own tracks. The recording "
        "MBID on each track is the handle for per-song detail such as ISRCs."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "mbid": {
                "type": "string",
                "description": (
                    "The release MBID (36-character UUID) from "
                    "musicbrainz_search_release. Must be a RELEASE id - an "
                    "artist or release-group id will 404."
                ),
            }
        },
        "required": ["mbid"],
    },
}


def handle_lookup_release(args: dict, **kwargs) -> str:
    try:
        mbid = validate_mbid(args.get("mbid"), field="mbid")

        payload = mb_get(
            f"release/{mbid}",
            {"inc": "recordings+artist-credits+labels+release-groups"},
            entity_hint="release",
        )

        media_out = []
        total_tracks = 0
        for medium in payload.get("media") or []:
            tracks = []
            for track in medium.get("tracks") or []:
                recording = track.get("recording") or {}
                length = track.get("length") or recording.get("length")
                tracks.append(
                    {
                        "number": track.get("number"),
                        "position": track.get("position"),
                        "title": track.get("title") or recording.get("title"),
                        "length_ms": length,
                        "length": _format_length(length),
                        "recording_mbid": recording.get("id"),
                    }
                )
            total_tracks += len(tracks)
            media_out.append(
                {
                    "position": medium.get("position"),
                    "format": medium.get("format") or "",
                    "title": medium.get("title") or "",
                    "track_count": medium.get("track-count", len(tracks)),
                    "tracks": tracks,
                }
            )

        labels = []
        for info in payload.get("label-info") or []:
            label = (info or {}).get("label") or {}
            if label.get("name"):
                labels.append(
                    {
                        "name": label.get("name"),
                        "mbid": label.get("id"),
                        "catalog_number": (info or {}).get("catalog-number") or "",
                    }
                )

        release_group = payload.get("release-group") or {}

        return tool_result(
            {
                "success": True,
                "release": {
                    "mbid": payload.get("id"),
                    "title": payload.get("title"),
                    "artist": _artist_credit_name(payload.get("artist-credit")),
                    "artists": _artist_credit_ids(payload.get("artist-credit")),
                    "date": payload.get("date") or "",
                    "country": payload.get("country") or "",
                    "status": payload.get("status") or "",
                    "packaging": payload.get("packaging") or "",
                    "barcode": payload.get("barcode") or "",
                    "disambiguation": payload.get("disambiguation") or "",
                    "release_group": {
                        "mbid": release_group.get("id"),
                        "title": release_group.get("title"),
                        "primary_type": release_group.get("primary-type") or "",
                        "first_release_date": release_group.get("first-release-date") or "",
                    }
                    if release_group
                    else None,
                    "labels": labels,
                    "track_count": total_tracks,
                    "disc_count": len(media_out),
                    "media": media_out,
                },
            }
        )
    except Exception as exc:
        return _tool_error(exc)


# ---------------------------------------------------------------------------
# 4. lookup_artist
# ---------------------------------------------------------------------------

LOOKUP_ARTIST_SCHEMA = {
    "name": "musicbrainz_lookup_artist",
    "description": (
        "Fetch one ARTIST by MBID: full name, sort name, type, gender, country, "
        "area, active years (life-span), aliases, and optionally their "
        "discography as release GROUPS. Use this after musicbrainz_search_artist "
        "when you need biography-style facts about the act itself, or to list "
        "what they have put out. "
        "Set include_releases=true to get release groups - the abstract 'album' "
        "(one entry for OK Computer) rather than every physical edition of it. "
        "That is usually what a person means by 'their albums'; use "
        "musicbrainz_search_release when you need a specific pressing instead."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "mbid": {
                "type": "string",
                "description": "The artist MBID (36-character UUID) from musicbrainz_search_artist.",
            },
            "include_releases": {
                "type": "boolean",
                "description": (
                    "When true, also return the artist's release groups "
                    "(albums/EPs/singles) with their MBIDs, types, and first "
                    "release dates. Default false."
                ),
            },
        },
        "required": ["mbid"],
    },
}


def handle_lookup_artist(args: dict, **kwargs) -> str:
    try:
        mbid = validate_mbid(args.get("mbid"), field="mbid")
        include_releases = coerce_bool(args.get("include_releases"), default=False)

        inc = ["aliases"]
        if include_releases:
            inc.append("release-groups")

        payload = mb_get(f"artist/{mbid}", {"inc": "+".join(inc)}, entity_hint="artist")

        life_span = payload.get("life-span") or {}
        area = payload.get("area") or {}
        begin_area = payload.get("begin-area") or {}

        artist: Dict[str, Any] = {
            "mbid": payload.get("id"),
            "name": payload.get("name"),
            "sort_name": payload.get("sort-name") or "",
            "disambiguation": payload.get("disambiguation") or "",
            "type": payload.get("type") or "",
            "gender": payload.get("gender") or "",
            "country": payload.get("country") or "",
            "area": area.get("name") or "",
            "begin_area": begin_area.get("name") or "",
            "life_span": {
                "begin": life_span.get("begin") or "",
                "end": life_span.get("end") or "",
                "ended": bool(life_span.get("ended")),
            },
            "aliases": [
                a.get("name")
                for a in (payload.get("aliases") or [])
                if isinstance(a, dict) and a.get("name")
            ][:15],
        }

        result: Dict[str, Any] = {"success": True, "artist": artist}

        if include_releases:
            groups = []
            for group in payload.get("release-groups") or []:
                groups.append(
                    {
                        "mbid": group.get("id"),
                        "title": group.get("title"),
                        "primary_type": group.get("primary-type") or "",
                        "secondary_types": group.get("secondary-types") or [],
                        "first_release_date": group.get("first-release-date") or "",
                    }
                )
            groups.sort(key=lambda g: g["first_release_date"] or "9999")
            result["release_groups"] = groups
            result["release_group_count"] = len(groups)

        return tool_result(result)
    except Exception as exc:
        return _tool_error(exc)


# ---------------------------------------------------------------------------
# 5. search_recording
# ---------------------------------------------------------------------------

SEARCH_RECORDING_SCHEMA = {
    "name": "musicbrainz_search_recording",
    "description": (
        "Search MusicBrainz for RECORDINGS - individual tracks/songs, i.e. one "
        "specific performance of a piece. Use this when the user names a SONG "
        "rather than an album: 'who recorded Paranoid Android', 'how long is "
        "this track', 'find the ISRC for this song'. "
        "The difference from musicbrainz_search_release: a release is a whole "
        "album, a recording is one track. If the user says 'the song X' use "
        "this; if they say 'the album X' use search_release. Results include "
        "which releases each recording appears on, so you can go from a song "
        "back to its albums. "
        "IMPORTANT: live, karaoke, and remix versions are indexed as separate "
        "recordings and routinely tie the studio version on score, so the top "
        "hit is often a bootleg. Read the 'disambiguation' field on each result "
        "to pick the right one - an empty disambiguation usually means the "
        "studio recording, while 'live, 1985-07-13: ...' does not. "
        "Set include_isrcs=true to attach ISRC codes; that costs one extra "
        "throttled request per result (about 1 second each), so keep limit "
        "small when you enable it. Empty results are a valid answer."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Song/track title, e.g. 'Paranoid Android'.",
            },
            "artist": {
                "type": "string",
                "description": "Optional performing artist name to narrow the search.",
            },
            "limit": {
                "type": "integer",
                "description": "Maximum results to return, 1-100. Default 10.",
            },
            "include_isrcs": {
                "type": "boolean",
                "description": (
                    "Fetch ISRC codes for each result. Requires one additional "
                    "rate-limited request per recording, so use a small limit. "
                    "Default false."
                ),
            },
        },
        "required": ["title"],
    },
}

# Enriching every result would serialise behind the 1 req/sec throttle, so
# the fan-out is capped even when the caller asks for a larger limit.
_MAX_ISRC_ENRICHMENTS = 10


def handle_search_recording(args: dict, **kwargs) -> str:
    try:
        title = str(args.get("title") or "").strip()
        if not title:
            return tool_error("title is required and cannot be empty.")
        artist = str(args.get("artist") or "").strip()
        limit = coerce_limit(args.get("limit"), default=10)
        include_isrcs = coerce_bool(args.get("include_isrcs"), default=False)

        query = _build_query(
            f'recording:"{escape_lucene(title)}"',
            f'artist:"{escape_lucene(artist)}"' if artist else None,
        )
        payload = mb_get("recording", {"query": query, "limit": limit}, entity_hint="recording")

        recordings = []
        for item in payload.get("recordings") or []:
            length = item.get("length")
            appears_on = []
            for release in (item.get("releases") or [])[:5]:
                appears_on.append(
                    {
                        "mbid": release.get("id"),
                        "title": release.get("title"),
                        "date": release.get("date") or "",
                    }
                )
            recordings.append(
                {
                    "mbid": item.get("id"),
                    "title": item.get("title"),
                    "artist": _artist_credit_name(item.get("artist-credit")),
                    "artists": _artist_credit_ids(item.get("artist-credit")),
                    "length_ms": length,
                    "length": _format_length(length),
                    "disambiguation": item.get("disambiguation") or "",
                    "video": bool(item.get("video")),
                    "isrcs": [],
                    "appears_on": appears_on,
                    "release_count": len(item.get("releases") or []),
                    "score": item.get("score"),
                }
            )

        isrc_note = None
        if include_isrcs and recordings:
            # The search index does not carry ISRCs, so they need a lookup each.
            enriched = 0
            for record in recordings:
                if enriched >= _MAX_ISRC_ENRICHMENTS:
                    isrc_note = (
                        f"ISRCs fetched for the first {_MAX_ISRC_ENRICHMENTS} results only; "
                        "each one costs a rate-limited request."
                    )
                    break
                try:
                    detail = mb_get(
                        f"recording/{record['mbid']}", {"inc": "isrcs"}, entity_hint="recording"
                    )
                    record["isrcs"] = detail.get("isrcs") or []
                except MusicBrainzError:
                    # A single failed enrichment must not sink the whole search.
                    record["isrcs"] = []
                enriched += 1
        elif not include_isrcs:
            isrc_note = "ISRCs omitted. Set include_isrcs=true to fetch them."

        result = {
            "success": True,
            "query": {"title": title, "artist": artist or None},
            "count": len(recordings),
            "total_available": payload.get("count", len(recordings)),
            "recordings": recordings,
        }
        if isrc_note:
            result["note"] = isrc_note
        if not recordings:
            result["message"] = (
                f"No recording found matching {title!r}"
                + (f" by {artist!r}" if artist else "")
                + "."
            )
        return tool_result(result)
    except Exception as exc:
        return _tool_error(exc)


# ---------------------------------------------------------------------------
# 6. get_cover_art
# ---------------------------------------------------------------------------

GET_COVER_ART_SCHEMA = {
    "name": "musicbrainz_get_cover_art",
    "description": (
        "Get Cover Art Archive image URLs (front cover, back cover, and any "
        "other scans) for a RELEASE MBID. Use this only when the user wants "
        "artwork or an image URL for an album - none of the other MusicBrainz "
        "tools return images. Get the release MBID from "
        "musicbrainz_search_release or musicbrainz_lookup_release first. "
        "Plenty of releases have no artwork uploaded; that comes back as a "
        "clear has_artwork=false result and is a normal answer, not a failure. "
        "If one edition has no art, another edition of the same album often does."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "release_mbid": {
                "type": "string",
                "description": "The release MBID (36-character UUID) to fetch artwork for.",
            }
        },
        "required": ["release_mbid"],
    },
}


def handle_get_cover_art(args: dict, **kwargs) -> str:
    try:
        mbid = validate_mbid(args.get("release_mbid"), field="release_mbid")

        try:
            payload = caa_get(f"release/{mbid}")
        except MusicBrainzNotFoundError:
            # CAA answers 404 for "no art for this release", which is an
            # answer rather than an error. It is also what a bad MBID gives,
            # so the message covers both without guessing.
            return tool_result(
                {
                    "success": True,
                    "release_mbid": mbid,
                    "has_artwork": False,
                    "front": None,
                    "back": None,
                    "images": [],
                    "message": (
                        "No artwork in the Cover Art Archive for this release. "
                        "Another edition of the same album may still have art - "
                        "try other release MBIDs from musicbrainz_search_release. "
                        "(This response also occurs if the MBID is not a valid "
                        "release.)"
                    ),
                }
            )

        images = []
        front_url = None
        back_url = None
        for image in payload.get("images") or []:
            thumbnails = image.get("thumbnails") or {}
            entry = {
                "url": image.get("image"),
                "types": image.get("types") or [],
                "front": bool(image.get("front")),
                "back": bool(image.get("back")),
                "comment": image.get("comment") or "",
                "thumbnail_250": thumbnails.get("250") or thumbnails.get("small") or "",
                "thumbnail_500": thumbnails.get("500") or thumbnails.get("large") or "",
            }
            if entry["front"] and not front_url:
                front_url = entry["url"]
            if entry["back"] and not back_url:
                back_url = entry["url"]
            images.append(entry)

        return tool_result(
            {
                "success": True,
                "release_mbid": mbid,
                "has_artwork": bool(images),
                "front": front_url,
                "back": back_url,
                "image_count": len(images),
                "images": images,
                **(
                    {}
                    if images
                    else {"message": "No artwork in the Cover Art Archive for this release."}
                ),
            }
        )
    except Exception as exc:
        return _tool_error(exc)
