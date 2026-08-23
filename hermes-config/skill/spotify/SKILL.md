---
name: spotify
description: Find music, create playlists, and prepare it in Breadboard's inline Spotify player.
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

Use `spotify_search`, `spotify_play`, and `spotify_create_playlist`, which use Breadboard's Connections OAuth and Spotify's live catalog. Never invent a track, album, artist, playlist, queue, or device identifier.

For music discovery, recommendations, and catalog questions about tracks, artists, or albums, call `spotify_search` before answering. Ground names, artists, albums, and available recordings in its results. Searching never starts playback: do not call `spotify_play` unless the user asks to hear, play, queue, or start something.

For direct play requests, call `spotify_play` with the user's request. It prepares a native player directly in the chat and does not open the Spotify app. The player renders automatically, so respond naturally to the request instead of repeating a fixed announcement or always explaining how to press play. There is no required sentence or response template. Stay truthful about the structured result: `status: ready` means the track is prepared but audio has not started, while `status: playing` means playback has started.

For playlist requests, call `spotify_create_playlist` once with a concise name and 2 to 4 complementary track-search queries. Use Spotify's `year:YYYY-YYYY` filter for decade requests and vary genre or mood terms across the queries. Set `play: true` only when the user asks to play the playlist. The tool creates a private Spotify playlist, adds the resolved tracks, and, when requested, starts the same ordered tracks in Breadboard's inline player. Use the returned name, track count, `status`, and `playbackStarted` as facts, but phrase the response freely in a way that fits the conversation.

If authentication is missing, direct the user to **Settings → Connections → Spotify → Connect**. Never ask the user to open Spotify on another device and never request an access token, refresh token, client secret, or developer credential in chat. Spotify browser playback requires an eligible Premium account; state that limitation only when Spotify returns it.
