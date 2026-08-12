# Audio Analysis — Breadboard can hear

Attach a song to a chat, ask about it, and get an answer measured from the
waveform: key, tempo and beat stability, LUFS loudness and true peak, dynamic
range, energy across seven frequency bands, spectral contrast, stereo field and
mono compatibility, timbre, percussive character, and the section boundaries
where the music actually changes.

The analysis runs on [audio-analyzer-rs](https://github.com/JuzzyDee/audio-analyzer-rs),
a pure-Rust MCP server vendored at `audio-analyzer-rs/`. No Python, no ffmpeg, no
network: Symphonia decodes the file locally and nothing about it leaves the
machine.

## What makes it innate

There is no form, no `/agents:` command, and no mode to switch on. A turn that
carries an audio attachment selects the first-party `audio-analysis` skill on its
own, the same way an attached video selects Watch:

```
turn-service.ts  premortem → visualizer → agent-loop → watch → image-to-3d → audio-analysis → messaging
```

The rule is Watch-shaped rather than Image-to-3D-shaped, because an attached
*song* is nearly always the subject of the turn while an attached picture often
is not. Two exclusions keep it honest:

- **Handling the file is not listening to it.** "Just save this", "send this to
  my phone", "upload this for me" leave the turn alone.
- **Words are not sound.** "Transcribe this", "what does he say", "add captions"
  are Whisper's job, not the analyzer's — returning a key and a tempo for a voice
  memo answers a question about language with a measurement of air.

A track from an earlier message still counts, so "and how does the chorus
compare?" — which arrives with no attachment at all — reaches the same file. That
follow-up has to still be about the music; "thanks, that's all" does not select
anything.

If the analyzer turns out to be missing, the automatic selection must not cost
the turn: the message is resolved again without it and the person gets an
ordinary answer rather than an error.

## The pieces

| Path | What it is |
| --- | --- |
| `audio-analyzer-rs/` | The upstream checkout. Never modified. |
| `scripts/setup-audio-analyzer.mjs` | `npm run setup:audio-analyzer` — builds from source when cargo exists, otherwise installs the pinned release, verified by SHA-256. |
| `dashboard/src/lib/audio-analyzer/config.ts` | Paths, analysis kinds, bounds, timeouts. |
| `dashboard/src/lib/audio-analyzer/runtime.ts` | `audioAnalyzerStatus()` — a pure read that never installs. |
| `dashboard/src/lib/audio-analyzer/mcp-client.ts` | One analysis, one process: JSON-RPC over stdio. |
| `dashboard/src/lib/audio-analyzer/service.ts` | Argument bounds and the two run entry points. |
| `dashboard/src/lib/audio-analyzer/tracks.ts` | Which attached track the request means, and the context block. |
| `dashboard/src/lib/hermes/audio-intent.ts` | When the skill selects itself. |
| `dashboard/src/app/api/hermes/tools/audio/route.ts` | `audio_analyze` and `audio_compare`. |
| `hermes-skills/prebuilt/audio-analysis/SKILL.md` | The skill the model actually reads. |
| `dashboard/src/lib/audio-attachments.ts` | The formats a chat attachment may be. |
| `dashboard/src/lib/conversations/audio-blob-store.ts` | Where the bytes live; `audio-uploads.ts` is their lifetime. |

## Audio became an attachment kind

Before this, a song dropped into the composer went to `/api/extract-text`, which
decoded an mp3 as mojibake and refused it — the file was read as text and then
dropped. Audio is now the fourth attachment kind whose bytes are the point,
alongside videos, meshes and documents:

- `.mp3 .wav .flac .ogg .oga .m4a .aac .mp4a`, up to 512 MB, streamed straight to
  disk rather than parsed into memory as a form.
- Stored under one directory per uploader, so ownership is a property of the path
  and a blob nobody here uploaded is not there to find.
- The message keeps a pointer, so the transcript plays it back, the Uploads list
  shows it, a regenerated turn runs against the same file, and deleting the chat
  deletes the audio.

Unlike video, audio is accepted on **every** chat surface, not just the Terminal:
nothing about analysing a track needs a workspace, because the route resolves the
stored file server-side.

## The tools

`audio_analyze` and `audio_compare` are authorized on Garden Chat and the
Terminal, never on Quartz, and only when the skill is selected for the turn.

Neither has an argument that carries or points at a file. The model names a
*track* by the filename it was shown, and the route resolves it from a message in
the caller's own conversation — so a path, a URL or a directory the model wrote
is never opened, which is what makes the tools safe on a surface with no
filesystem grant at all.

| Argument | Meaning |
| --- | --- |
| `track` | Filename of the attached track. Omitted → the most recent one. |
| `analysis` | `full` (default), `info`, `spectral`, `harmonic`, `rhythm`. |
| `resolution` | `low`, `medium`, `high`, or rows per second. Omitted → summary only. |
| `startTime` / `endTime` | Seconds, to analyse one section. |
| `minBpm` / `maxBpm` | Tempo search bounds; `rhythm` only. |

`audio_compare` takes `track` and `against` and returns one table of deltas —
loudness, dynamics, spectral balance, stereo field, key, tempo.

### Summary first, then zoom

The workflow the skill enforces is the one the upstream tool is designed around:
call `full` with no resolution to get the summary and the section map, then call
again with a short `startTime`/`endTime` window at high resolution. High
resolution over a whole song returns hundreds of rows that repeat what the
summary said; the server auto-reduces past 800 rows rather than failing.

## Provisioning

```bash
npm run setup:audio-analyzer          # build from source, or install the pinned release
npm run setup:audio-analyzer -- --check   # report, install nothing
```

The binaries land in `.runtime/audio-analyzer/bin`. With a Rust toolchain present
the script builds `audio-analyzer-rs` itself; without one it downloads the
release archive for the platform and refuses to install anything whose SHA-256
does not match the pinned digest. The archive is unpacked in-process rather than
by shelling out to `tar`, because Windows ships bsdtar (which reads zip) while a
Git Bash `PATH` finds GNU tar (which does not, and reads `C:\` as a remote host)
— so the archiver that ran would otherwise depend on the terminal.

Nothing provisions itself as a side effect of a turn. When the analyzer is
missing the tool says so in one sentence naming the command, and the skill relays
it.

## Reading the results honestly

The numbers are real; what they mean depends on the material, and the skill is
written to say so rather than recite everything:

- Key detection uses major/minor profiles only — for modal or non-Western music
  the pitch class distribution is the honest answer.
- Tempo can land on half or double time; low confidence plus a low beat count is
  the tell.
- Key, tempo and beat statistics are meaningless for speech and field
  recordings, and saying that is more useful than quoting them.
- Phase correlation below zero means parts of the mix vanish in mono — worth
  flagging even unasked.

One thing the analyzer genuinely cannot do is tell you what was *said*. That is
the microphone menu's upload, which runs the local Whisper model.

## Tests

```bash
npm --prefix dashboard test -- tests/audio-analysis.test.mjs
```

Thirteen tests, and they are not stubs: the last one synthesises an A-minor triad
over a 120 BPM click, runs it through the real binary, and asserts the analyzer
reported A minor at 120 BPM. It also proves the two failure modes are separated —
a file the decoder cannot read fails as an unreadable file rather than reaching
the model as a successful analysis whose text happens to begin with `Error:`,
which is exactly what the pinned server returns and what `mcp-client.ts` has to
catch.
