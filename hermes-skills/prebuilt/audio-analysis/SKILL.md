---
name: audio-analysis
description: Actually listen to a track attached to the chat — key, tempo, LUFS loudness, dynamics, frequency balance, stereo field, timbre, percussive character and section boundaries, measured from the waveform by the local Rust analyzer — and compare two mixes side by side.
license: MIT
allowed-tools:
  - audio_analyze
  - audio_compare
---

# Audio Analysis

Use this skill whenever someone attaches a piece of audio and asks anything
about how it sounds: what key it is in, how fast it is, whether the mix is
muddy, how loud it is for streaming, where the chorus starts, how their bounce
compares to a reference. The analysis runs locally on a Rust DSP binary —
Symphonia decodes the file, and the same techniques used in music information
retrieval produce the numbers. Nothing is uploaded anywhere.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - audio_analyze
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## Calling the tool

Call `audio_analyze`. Do not answer from the filename, from what you know about
the artist or the song, or from anything you remember about the recording — and
never say you cannot hear audio. This tool measures the file that is attached.

Arguments, all optional:

- `track` — the filename exactly as it appears in the
  `[Attached audio — real analysis available]` block in this turn's context.
  Omit it and the most recently attached track is used. Never pass a path or a
  URL: the tool resolves the stored file itself from a message in this
  conversation.
- `analysis` — `full` (the default) covers everything and adds section
  boundaries. `info` is duration and sample rate only, and is the cheap way to
  check a long file before committing to it. `spectral` is brightness,
  frequency band energy, dynamic range, LUFS and stereo field. `harmonic` is
  key and pitch classes. `rhythm` is tempo, beats and tempo stability.
- `resolution` — `low`, `medium`, `high`, or a number of rows per second. Omit
  it for a summary. This is the argument that decides how many tokens the answer
  costs.
- `startTime` / `endTime` — seconds, to analyse one section rather than the
  whole track.
- `minBpm` / `maxBpm` — only for `rhythm`, and only when tempo detection has
  already returned something you have reason to doubt.

### The workflow that actually works

1. Call once with `analysis: "full"` and **no** resolution. That returns the
   summary plus the section boundaries — the map of the track.
2. Pick the moments that matter from those boundaries, and call again with
   `startTime`/`endTime` and `resolution: "high"` on a **short** window (20
   seconds or less).

Asking for high resolution across a whole song is the one way to waste this
tool: it returns hundreds of rows that say what the summary already said. The
server auto-reduces past 800 rows, so an over-broad request comes back coarser
than you asked for rather than failing.

## Comparing two tracks

`audio_compare` takes `track` and `against`, both naming attached files, and
returns one table of deltas: loudness (LUFS, true peak, LRA), dynamics,
spectral balance across seven bands, stereo field, key and tempo. Use it for
"how does my mix differ from this reference" and for two versions of the same
song. It is summary-only by design — for time-series, analyse each track.

## Reading the numbers honestly

The measurements are real. What they *mean* depends on the material, and saying
so is more useful than reciting all of them:

- **Key detection** uses major/minor profiles only. For modal, atonal or
  non-Western music, read the pitch class distribution for the actual tonal
  centre instead of trusting the label, and say that is what you did.
- **Tempo** can land on half or double time for electronic music, solo
  instruments and rubato playing. Low tempo confidence plus a low beat count is
  the signal; say "around 85, possibly 170" rather than picking one silently.
- **Key, tempo and beat statistics are meaningless for speech, ambient
  recordings and field recordings.** Say so and move to what is physically real
  for that material — loudness, dynamic range, spectral balance, stereo field.
- **LUFS** is the number to quote for "is this loud enough": the report names
  the streaming targets. Loudness is not the same as dynamics, and a track that
  hits a target with a crest factor near 6 dB is squashed, which is worth
  saying.
- **Phase correlation below zero** means parts of the mix disappear in mono.
  That is a real fault worth flagging even when nobody asked.

Quote a handful of numbers with their units, then interpret them. A wall of
every metric is a worse answer than four numbers and what they imply.

## Production advice

When someone asks what to fix, ground each suggestion in a number from the
report — the band energy that is 8 dB above its neighbours, the correlation
that goes negative at 1:40, the crest factor that says the master is limited
flat. Do not invent EQ moves the measurements do not support, and do not claim
to hear things the analysis does not measure: it has no opinion about
performance, lyrics, or whether the song is any good.

## When the analyzer is not installed

The tool reports one missing thing at a time; relay that sentence rather than
guessing. If it says the analyzer is not installed, tell the person to run
`npm run setup:audio-analyzer` once — it downloads a single verified binary,
takes seconds, and needs no Python, no ffmpeg and no toolchain. Do not run it
yourself.

If someone wants the *words* out of a recording rather than its sound, that is
transcription, not this skill — the microphone menu's upload does it with the
local Whisper model. Say that rather than returning a key and a tempo for a
voice memo.
