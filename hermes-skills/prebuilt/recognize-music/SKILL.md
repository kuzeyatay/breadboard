---
name: recognize-music
description: Identify a commercially released song from a short microphone recording or attached audio sample by calling Breadboard's provider-backed recognition tool. Use for "what song is this?" requests, not waveform, mix, tempo, or transcription questions.
license: MIT
allowed-tools:
  - music_recognize
---

# Recognize Music

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - music_recognize
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

Identify music only by calling `music_recognize` with the exact short audio
reference Breadboard supplied for this conversation. Never infer a match from a
filename, lyrics, artist hints, or memory, and never pass raw/base64 audio, a
filesystem path, or a URL.

When the tool returns a match, report its title and artist plus album, release
date, timecode, and service links when present. Do not invent a confidence
score or fill in missing metadata. Treat `match: null` as a normal no-match
result and suggest another clean 10-15 second sample. Relay configuration or
provider failures as actionable errors; never turn them into a speculative
identification.

For key, tempo, loudness, mix, or structure questions, use Audio Analysis
instead. For spoken words, use transcription.
