# Vox Director explainer agent

`/agents:vox-director` turns a topic into a narrated paper-collage explainer and
renders it, locally, into an MP4. It is a runtime agent in the Agents palette,
alongside HyperFrames, ViMax, Codex and the rest, and it plans on the model
picked in chat.

```text
Terminal / Garden chat
        |
  /agents:vox-director <topic>
        |
  POST /api/vox-director/runs
        |
  beat map → look → poster prompts → posters → element plan → motion
           → narration → music → assembly
        |            (each stage validated before the next consumes it)
        |
  a Vox Director production artifact  +  an MP4 you can play and download
```

## Why the upstream workflow is not used

The cloned `vox-director/` is an **agent skill**: `SKILL.md`, a reference
library, and a pile of stage scripts. Its automated path runs end to end on one
vendor — `ATLASCLOUD_API_KEY`, with `google/nano-banana-2` drawing the posters,
`google/gemini-omni-flash` animating them, `xai/tts-v1` narrating and
`minimax/music-2.6` scoring. There is no such key here and there is no reason to
want one: Breadboard already has a local diffusion server, a local speech
service, a model layer and an ffmpeg.

So the hosted half is replaced and the valuable half is kept. What upstream
really contributes is the craft, and all of it ports:

- the **narrative layer** — arcs, the ≤3s hook, the beat-count and pacing table,
  shot sizes, the hard-constrained flat-safe camera vocabulary, the
  anti-monotony rule (`references/beat-layer.md`);
- the **look layer** — the five-part collage prompt structure, the vocabulary
  that fills it, and nine theme presets (`references/prompt-guide.md`,
  `scripts/styles.py`);
- the **local keyframe engine** — layers with keyframe tracks, the
  fly-in / slap / drop / pop-settle entrances with their paper overshoot, sway
  and pulse breathing, procedural confetti and starburst, and a camera that
  pushes and takes an impact shake on each entrance (`scripts/motion.py`);
- the **assembly** — normalise, concatenate, lay each beat's narration at its
  own start, duck the music beneath it with a sidechain compressor, burn the
  captions, write an H.264 MP4 (`scripts/assemble.py`, `scripts/text_overlay.py`).

Everything that reaches `api.atlascloud.ai` lives behind `scripts/provider.py`,
and nothing in this integration imports it. `tests/vox-director-agent.test.mjs`
asserts that, in code, for every file the agent owns.

### What Breadboard adds

Upstream's own note on the local engine is the honest one: *"the per-video layout
is manual (until an LLM auto-layout layer exists)"*. Somebody has to overlay a
labelled grid on each poster and read off the boxes. That layer is what
Breadboard supplies — ChatMock plans the pieces, their entrances and their
timings per poster, the plan is validated, and the clone's engine renders it.
Breadboard also owns the model access, the lifecycle, the progress events, the
artifacts, the configuration and the UI.

## Using it

Open the capability palette, choose **Agents**, then `/agents:vox-director`. The
command carries the whole topic — no agent chip, no second message:

```text
/agents:vox-director explain why the Concorde disappeared --duration 20
```

Flags, all optional:

| Flag | Effect |
| --- | --- |
| `--duration N` | Target runtime in seconds. Clamped to 5–90 |
| `--vertical`, `--square`, `--landscape` | Change the frame from the 16:9 default |
| `--style "…"` | A theme preset (`punk-zine`, `chinese-ink`, `newsprint-editorial`, …) or a look in words |
| `--motion local\|scrapbook\|kenburns\|auto` | Which local renderer animates a poster |
| `--no-images` | Use the deterministic paper title cards; never ask ComfyUI |
| `--no-music` | Assemble with no music bed |
| `--seed N` | Fix the poster seed so a film renders identically twice |

The same values can be set ahead of time under **Settings → Agents → Vox
Director**, including the ComfyUI checkpoint. A flag in the message always beats
a stored default.

## Architecture

| Stage | What runs | Where |
| --- | --- | --- |
| Beat map | ChatMock, one forced tool call, validated | `lib/vox-director/model-client.ts` |
| Look | ChatMock, choosing from the clone's own `THEME_PRESETS` | same |
| Poster prompts | the clone's `styles.compose_collage_prompt`, called through the driver | `scripts/vox_local.py` |
| Posters | Breadboard's ComfyUI, or local title cards | `lib/vox-director/image-backend.ts` |
| Element plan | ChatMock, in batches of four posters | `lib/vox-director/model-client.ts` |
| Motion | the clone's `motion.py`, driven from the validated plan | `lib/vox-director/motion-backend.ts` |
| Narration | Voicebox, on 127.0.0.1, measured with ffprobe | `lib/vox-director/audio-backend.ts` |
| Music | a local track, or silence | same |
| Assembly | the clone's `assemble.py` | `scripts/vox_local.py` |

The seam that makes this a *use* of upstream rather than a rewrite is
`beats.json`. Breadboard writes it in the clone's own schema into the run
workspace, and `assemble.py` and `kenburns.py` open that file unmodified. A
production made here can be copied to `vox-director/out/<project>/` and driven by
hand exactly as `SKILL.md` documents.

## Local dependencies

Nothing is installed by a run. Each piece is discovered, and health reports what
is missing.

| Piece | Resolution order | Blocking |
| --- | --- | --- |
| The clone | `VOX_DIRECTOR_ROOT` → `./vox-director` next to the dashboard | yes |
| Python + Pillow | `VOX_DIRECTOR_PYTHON` → a `.venv` in the clone → PATH | yes |
| ffmpeg / ffprobe | the desktop shell's `ffmpeg-static` and `resources/bin` → Agent Reach's portable copy → PATH | yes |
| ChatMock | `resolveChatmockBaseUrl(request)` | yes |
| Voicebox | `VOICEBOX_BASE_URL`, default `http://127.0.0.1:17493` | yes — narration does not degrade |
| ComfyUI | the existing `COMFYUI_*` configuration | no — posters fall back to title cards |
| Music | `VOX_DIRECTOR_MUSIC_DIR`, or `music/` in the clone | no — a film without music is a film |

`GET /api/vox-director/health` reports all of them as `ready`, `degraded` or
`unavailable`. Degraded means a film still comes out, but not as asked — no
ComfyUI, so the posters are title cards. Unavailable means no film comes out at
all. A cloned directory existing is never on its own a reason to report healthy:
the clone is only recognised when `SKILL.md`, `styles.py`, `motion.py`,
`assemble.py` and `references/prompt-guide.md` are all present.

## Artifacts

Two things come out of a run, and both belong to the chat that asked for them:

- **the film** — an ordinary Breadboard **video** artifact, so it plays in the
  transcript, downloads, opens in the existing video studio, and can be edited by
  Video Use like any other video. There is no Vox-only player;
- **the production** — a data artifact holding the beat map, every resolved
  poster prompt, the element and camera plan each shot was animated from, and
  which backend actually produced each piece. Opening it calls no model.

Posters are separate image artifacts referenced by id, so each is independently
viewable and reusable.

Every production is its own artifact. An earlier film in the same chat is shown
to the story editor as context — so "make that one shorter" has something to be
shorter than — but it is never overwritten. Folding a second brief into a new
version of the first is how a film about Concorde became version 3 of a film
about the sky, carrying the wrong title with no way back to its own cut.

## Failure behaviour

Everything degrades except the voice, and every step down is recorded on the shot
and reported in the reply.

- **Posters**: ComfyUI → deterministic paper title cards. The card and the reply
  say which, and why. `--no-images` asks for the cards on purpose.
- **Motion**: element-level `motion.py` → the scrapbook assembler → the
  pure-ffmpeg Ken Burns → a held frame. Asking for a named backend only ever
  degrades downward: `--motion kenburns` never waits for a frame loop first.
- **The element plan**: a batch that fails costs its own four posters, which fall
  through to whole-poster motion, and the run says how many.
- **Music**: a local track → silence.
- **Narration** does not degrade. A narrated explainer with no narration is not a
  lesser film, it is the wrong one, so a run that cannot speak fails and says why.
- **A render is only reported when ffprobe can read a real H.264 stream of real
  length back out of the file.**
- **Storage**: if the film renders but cannot be attached to the conversation,
  the reply says so and says where the file is. It never claims an artifact that
  does not exist.

## Compared to the other video agents

| | Reach for it when |
| --- | --- |
| **Vox Director** | An editorial explainer: a narrator carries one idea, the pacing is fast, the look is graphic collage, one poster per beat |
| **HyperFrames** | The content has to be exact — data, diagrams, text, timed motion. It draws by writing code |
| **ViMax** | The footage has to be invented and the piece is a story — characters, scenes, a screenplay |

## Storage and safety

- Workspaces live in `dashboard/vox-director-runs/<runId>/` and are **not**
  deleted when the run ends — the MP4 is the deliverable. The directory and the
  clone are both gitignored.
- Ownership is recorded in `owner.json`, so a finished film is still
  authorisable after the in-memory run state is gone.
- Every path is containment-checked twice: once in TypeScript on the way into a
  spec, and again in the Python driver on the way out of one. A spec file crosses
  a process boundary, and the second check is what makes tampering with one
  between the two useless.
- **No model output ever reaches a command line.** The driver is spawned with an
  argument array of exactly `[script, operation, specPath]`, and everything a
  model produced is inside a JSON file written into the run's own workspace.
- Element names are restricted at the schema to letters, digits, dashes and
  underscores, because a name becomes a file name.
- Boxes, durations, seeds, zooms and start times are all bounded in
  `schemas.ts` before anything acts on them.
- An abort kills the driver and its process tree, so the ffmpeg a frame loop was
  piping into does not outlive it.
- The local path makes no network requests at all.

## Files

| Path | What it is |
| --- | --- |
| `vox-director/` | The upstream clone, kept as the source of the method and the engine |
| `dashboard/scripts/vox_local.py` | Breadboard's driver: imports the clone's modules, never its provider |
| `dashboard/src/lib/vox-director/identity.ts` | Command, id, name, flag parsing |
| `dashboard/src/lib/vox-director/types.ts` | The production, structurally faithful to upstream's `beats.json` |
| `dashboard/src/lib/vox-director/schemas.ts` | Every model output, and the stored-artifact contract |
| `dashboard/src/lib/vox-director/prompts.ts` | The stage prompts, quoting the clone's reference files at run time |
| `dashboard/src/lib/vox-director/model-client.ts` | The forced tool calls through ChatMock |
| `dashboard/src/lib/vox-director/runtime.ts` | Clone, Python, ffmpeg resolution; the bounded driver spawn; health levels |
| `dashboard/src/lib/vox-director/workspace.ts` | The run directory, ownership, containment |
| `dashboard/src/lib/vox-director/image-backend.ts` | ComfyUI, and the title-card fallback |
| `dashboard/src/lib/vox-director/motion-backend.ts` | The element cut and the motion render, with the fallback chain |
| `dashboard/src/lib/vox-director/audio-backend.ts` | Voicebox narration, ffprobe durations, the music bed |
| `dashboard/src/lib/vox-director/beats-document.ts` | The `beats.json` the clone's own stages read |
| `dashboard/src/lib/vox-director/pipeline.ts` | The staged production |
| `dashboard/src/lib/vox-director/artifact.ts` | The video artifact, the production artifact, the posters |
| `dashboard/src/lib/vox-director/run-manager.ts` | Run state and the events the card streams |
| `dashboard/src/app/api/vox-director/` | `runs`, `runs/[runId]/events`, `runs/[runId]/abort`, `health` |
| `dashboard/src/app/components/hermes/inline-vox-director-run.tsx` | The run card |
| `dashboard/src/app/components/vox-director/vox-production-artifact.tsx` | The production artifact's page |
| `dashboard/tests/vox-director-agent.test.mjs` | Grammar, settings, containment, fallbacks, the event protocol |
| `dashboard/tests/vox-director-card-render.test.mjs` | The card rendered for real, in all four states |

## Verified

On Windows 11, with the clone at `vox-director/`, Python 3.14 + Pillow 12.3,
the desktop shell's ffmpeg and ffprobe, ChatMock on `gpt-5.6-sol`, and Voicebox
answering on 17493 with its Kokoro preset voices.

**Health** reports `degraded` with one line: ComfyUI is not set up on this
machine, so posters fall back to title cards. Everything else — clone, Python,
Pillow, ffmpeg, ffprobe, ChatMock, TTS — reports ready.

**Four full productions** ran end to end through `POST /api/vox-director/runs`
in a real Terminal conversation. The last, `explain why the Concorde disappeared
--duration 20`: a 5-beat / 6-shot `timeline` arc, the `newsprint-editorial`
theme chosen for the topic, 6 posters, 6 element plans, **all six shots rendered
by the local element engine**, 5 narrations by Kokoro measured at 4.7–5.5s each,
and a **28.1s 1920×1080 H.264 MP4 of 3.2 MB**, validated by ffprobe and stored
as a video artifact plus a production artifact under the launching conversation.
Extracted frames show the headline slapped in as one sharp piece, drifting
confetti, the torn band, and burned captions.

**The film serves as an ordinary video artifact**: `GET
/api/hermes/artifacts/<id>/preview?conversationId=…` with a `Range` header
answers `206 video/mp4`, which is what makes it play and seek inline.

**Reload persistence** was verified through the real save path: the launch turn
was written with `POST …/external-turns`, finished with `PATCH`, and read back —
the assistant turn carries `voxDirectorRun` and `externalAgentOutcome:
"completed"` with the saved summary, which is what a reloaded card renders from
instead of reopening a dead stream.

**Abort** was verified mid-render: `POST …/abort` returned `{ok:true}`, the run
emitted `run.aborted`, the driver and its ffmpeg were both gone afterwards, and a
second abort correctly reported nothing left to stop.

**The card** was rendered with `react-dom/server` in all four states — running,
completed, failed, aborted — and reads its saved content in each.

### Not verified

- **The ComfyUI poster path.** ComfyUI has no Python environment and no
  checkpoint on this machine, so every run so far used the title-card fallback.
  The ComfyUI call goes through `renderComfyUiImage`, the same function the image
  studio and the Socials Manager already use in production, but this integration
  has not drawn a poster with it. Nothing here reports otherwise: the run card,
  the reply and the stored production all name `title-card` as the backend and
  say why.
- **Music.** No local track was present, so every run assembled with the silent
  bed. The mix path through `assemble.py` is the same one either way.
- **The Garden surface.** The Garden launcher is wired identically to the
  Terminal's and covered by the shared persistence tests, but the live runs were
  all started from a Terminal conversation.

## Known limits

- **A local render costs real time.** Every frame of the element-level path is
  drawn by Pillow: about 5 fps at 1920×1080 on this machine, so a 30-second film
  is a few minutes of rendering. `--motion kenburns` is much faster and is a
  reasonable default on a slow machine.
- **Cutouts are approximate.** Upstream cuts elements with a hosted
  background-removal model. Offline, the driver flood-fills the flat paper ground
  from the corners, which works on the bold flat backgrounds this look is built
  from and is reported and downgraded to a plain crop when it does not.
- **Workspaces are never pruned.** Deleting `dashboard/vox-director-runs/<runId>/`
  is safe: the artifacts are stored independently, and only the production page's
  poster thumbnails would stop resolving.
- **One run at a time is not enforced.** Two concurrent productions get their own
  workspaces but share one CPU, and a frame loop will use it.
