# Shorts agent

`/agents:shorts` turns a long video into short vertical clips of its best
moments. It is a runtime agent in the Agents palette, alongside Codex, Trading
Agent, ViMax and the rest — but it is one of only two agents that **takes no
prompt at all**: selecting it replaces the message field with a form that asks
for a video.

```text
Terminal / Garden chat
        |
  select /agents:shorts  ->  the composer collects a video, not a sentence
        |
  POST /api/shorts/runs           { request: { source, clipCount, aspectRatio, … } }
        |
  scripts/shorts-bridge.py        (inside AI-Youtube-Shorts-Generator/.venv)
        |
  the clone's own local pipeline
    yt-dlp  ->  faster-whisper  ->  highlight ranking  ->  ffmpeg + OpenCV
                                          |
                                    ChatMock /v1
        |
  each cut clip becomes a video artifact of the conversation
```

## Why it is built this way

The clone **is** a runtime: `main.py` runs the whole pipeline headlessly and
every stage is a plain function. So Breadboard wraps it rather than
reimplementing it — the bridge calls the clone's own `download_youtube_local`,
`transcribe_local`, `get_highlights` and `crop_clip_local`, in the clone's own
order, and only adds an event per transition so the chat card can show where a
run actually is. `main.py` cannot do that: it runs everything behind one call
and prints a report at the end.

Three decisions are worth knowing about.

**Local mode only.** The clone's default `--mode api` routes every stage through
MuAPI, a paid third-party account. Local mode does the same work on this machine
with yt-dlp, faster-whisper and ffmpeg, and needs only an OpenAI-compatible
endpoint for the ranking step — which Breadboard already has in ChatMock. The
clone builds its OpenAI client with no explicit base URL, so the SDK reads
`OPENAI_BASE_URL`; pointing that at ChatMock needs no change to the checkout.
Nothing reaches for MuAPI, and no second model layer exists.

**The video never leaves the machine.** The download, the transcription and
every cut happen locally. Only the transcript is sent to a model, to decide
which moments are worth clipping.

**ffmpeg comes from this repository.** The clone shells out to a bare `ffmpeg`
for the cut and the audio mux. Rather than requiring one on PATH, the run
manager resolves the copy already here (the desktop shell's ffmpeg-static, or
Agent Reach's portable one — the same resolver ViMax uses) and puts its
directory at the front of the child's PATH.

## Using it

Open the capability palette, choose **Agents**, then `/agents:shorts`. The
composer's message field is replaced by a form:

- **a video link** (`https://…`, whatever yt-dlp can fetch), **or a file** from
  this machine, uploaded first so the run addresses it by an id;
- **clips** — how many to cut, highest-scoring first;
- **shape** — 9:16, 1:1, or the original framing;
- **quality** — how large a copy of the source to download;
- **language** — a two-letter code, or blank to let Whisper detect one.

There is no message box while the agent is selected, and dictation is disabled,
because there is nowhere in the pipeline for a sentence to go. Clear the agent
to write normally.

Typing or pasting `/agents:shorts https://youtu.be/… · 3 clips · 9:16` selects
the agent and pre-fills the form from whatever it recognises. It never starts a
run on its own, and prose in it is dropped rather than forwarded.

Defaults for every field, plus the Whisper size, live in the agent's settings
(the gear beside its palette row).

## What a run produces

Each clip is imported as a **video artifact of the conversation** — playable and
downloadable in chat, and still there after a reload — carrying what the ranker
said about it: its window, its score, the hook line, and why it thought the clip
would travel. The chat reply is a short list pointing at them.

A clip that will not encode is reported and skipped; the others still land.

## Setup

The clone's local mode needs a Python environment (yt-dlp, faster-whisper,
opencv), which is a few hundred megabytes. **A run never installs it** — the
agent's settings panel asks, and the environment lands in
`AI-Youtube-Shorts-Generator/.venv`, which the clone's own `.gitignore` already
covers and which "Remove environment" deletes again. The first run additionally
downloads a Whisper model.

Selecting the agent checks all of this first, so an unbuilt environment is said
before a video is chosen rather than after.

## Where things live

| Piece | Path |
| --- | --- |
| Request model, validation, command parsing | `dashboard/src/lib/shorts/identity.ts` |
| Clone/venv/ffmpeg discovery and health | `dashboard/src/lib/shorts/runtime.ts` |
| Environment build, repair, removal | `dashboard/src/lib/shorts/setup.ts` |
| Run manager (spawn, events, publish) | `dashboard/src/lib/shorts/run-manager.ts` |
| Uploaded videos | `dashboard/src/lib/shorts/uploads.ts` |
| Clip artifacts | `dashboard/src/lib/shorts/artifact.ts` |
| The bridge | `scripts/shorts-bridge.py` |
| Composer form | `dashboard/src/app/components/hermes/shorts-request-form.tsx` |
| Run card | `dashboard/src/app/components/hermes/inline-shorts-run.tsx` |
| Settings panel | `dashboard/src/app/components/agents/shorts-setup.tsx` |
| Downloads, cached transcripts, per-run clips | `dashboard/shorts-work/` (git-ignored) |
| Videos chosen in the composer | `dashboard/shorts-uploads/` (git-ignored) |

## Safety notes

- **A page never hands the server a path.** The form takes an `http`/`https` URL
  or an upload id; `file://` and local paths are refused, because yt-dlp would
  happily read them and that would turn the composer into a way to open anything
  the server can reach. An uploaded file is stored under the uploading user's own
  directory and resolved only from there.
- Uploads are pruned after a day. They are the input to a run; the artifacts a
  run produces are what stays.
