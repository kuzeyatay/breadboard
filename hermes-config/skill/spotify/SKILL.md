---
name: spotify
description: Find music, create playlists, and control Breadboard's inline Spotify player.
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

For direct play requests, call `spotify_play` with `query`. Breadboard's inline player is the default playback target. Always choose and send `target` by interpreting the user's request. Use `target: inline` for here, in Breadboard, on this computer, or a new request without a destination. Use `target: phone` for on my phone, on my iPhone, or on my Android phone. Interpret meaning and negation: a phone in a song title, or 'not on my phone', is not a phone destination. Never infer a phone target from available devices. The tool starts the resolved queue itself and returns `status: playing` only after Spotify confirms the selected device is playing the requested track. Never tell the user to press Play instead of attempting playback. Respond naturally; there is no required sentence or response template.

For playback controls, call `spotify_play` with `action` and no query. `pause`, `resume`, `next`, and `previous` need no other argument. `seek` also needs `positionMs`, `shuffle` needs `enabled`, `volume` needs `volumePercent`, and `repeat` needs `repeatState` (`off`, `track`, or `context`). For contextual follow-ups such as pause it, resume, or another song there, keep the destination the user previously chose in this conversation. An explicit new destination overrides it; without a previous choice use `target: inline`.

For playlist requests, call `spotify_create_playlist` once with a concise name and 2 to 4 complementary track-search queries. Use Spotify's `year:YYYY-YYYY` filter for decade requests and vary genre or mood terms across the queries. Set `play: true` only when the user asks to play the playlist. The tool creates a private Spotify playlist, adds the resolved tracks, and, when requested, starts the same ordered tracks in Breadboard's inline player. Always send the chosen `target` using the same prompt-based rules; use `target: inline` when `play: false`. Use the returned name, track count, `status`, `playbackStarted`, and device as facts, but phrase the response freely in a way that fits the conversation.

If `status: playback_failed`, explain the returned `playbackError`. The resolved track or playlist remains available in the inline controls, but playback did not succeed. Do not claim music is playing or invent a phone requirement. A phone-only failure applies only when `target: phone` was explicitly requested.

If authentication is missing, direct the user to **Settings → Connections → Spotify → Connect**. Never request an access token, refresh token, client secret, or developer credential in chat. Spotify playback control requires an eligible Premium account; state that limitation only when Spotify returns it.
