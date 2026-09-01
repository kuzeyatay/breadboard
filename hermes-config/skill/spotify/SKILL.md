---
name: spotify
description: Find music, create playlists, and control Spotify playback on the user's phone.
license: MIT
allowed-tools:
  - spotify_search
  - spotify_play
  - spotify_create_playlist
---

# Spotify

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools: [spotify_search, spotify_play, spotify_create_playlist]
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

Use `spotify_search`, `spotify_play`, and `spotify_create_playlist`, which use Breadboard's Connections OAuth, Spotify's live catalog, and Spotify Connect. Never invent a track, album, artist, playlist, queue, or device identifier.

For music discovery, recommendations, and catalog questions about tracks, artists, or albums, call `spotify_search` before answering. Ground names, artists, albums, and available recordings in its results. Searching never starts playback; use `spotify_play` only for an explicit play or playback-control request.

For direct play requests, call `spotify_play` with `query`. The phone is the only playback target: the tool transfers playback to an available Spotify phone, starts the resolved queue itself, and returns `status: playing` only after Spotify confirms that phone is playing it. Never tell the user to press Play and never substitute Breadboard playback when the phone is unavailable. Respond naturally; there is no required sentence or response template.

For playback controls, call `spotify_play` with `action` and no query. `pause`, `resume`, `next`, and `previous` need no other argument. `seek` also needs `positionMs`, `shuffle` needs `enabled`, `volume` needs `volumePercent`, and `repeat` needs `repeatState` (`off`, `track`, or `context`). Controls target the user's available phone. If Spotify reports `spotify_phone_unavailable`, explain that Spotify must be available on the phone before a remote control can be sent.

For playlist requests, call `spotify_create_playlist` once with a concise name and 2 to 4 complementary track-search queries. Use Spotify's `year:YYYY-YYYY` filter for decade requests and vary genre or mood terms across the queries. Set `play: true` only when the user asks to play the playlist. The tool creates a private Spotify playlist, adds the resolved tracks, and, when requested, starts the same ordered tracks on an available phone. Requested playback must fail visibly instead of falling back to Breadboard when no phone is available. Use the returned name, track count, `status`, `playbackStarted`, and device as facts, but phrase the response freely in a way that fits the conversation.

If authentication is missing, direct the user to **Settings → Connections → Spotify → Connect**. Never request an access token, refresh token, client secret, or developer credential in chat. Spotify playback control requires an eligible Premium account; state that limitation only when Spotify returns it.
