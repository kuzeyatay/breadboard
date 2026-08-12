# ViMax film agent

`/agents:vimax` turns an idea into a film. It is a runtime agent in the Agents
palette, alongside Codex, HyperFrames, Parametric CAD and the rest, and it
answers on the model picked in chat.

```text
Terminal / Garden chat
        |
  /agents:vimax <idea>
        |
  POST /api/vimax/runs
        |
  story → screenplay → cast → storyboard → frames → imagery → encode
        |            (each stage validated before the next consumes it)
        |
  a ViMax production artifact  +  an MP4 you can play and download
```

## Why it is built this way

The cloned `vimax/` is a **complete Python runtime** — an agent loop, a TUI, a
web UI and three pipelines (Idea2Video, Script2Video, Novel2Video). Unusually
for a vendored clone, the thing that cannot be run here is not the code: it is
the *providers*. Every one of ViMax's renderers is hard-wired to a specific paid
API — Google Veo, Doubao Seedance, Yunwu, OpenRouter Images — and none of those
keys exists here, so `vimax tui` fails at the first frame however it is wrapped.
The drawing model Breadboard *does* have (Gemini, through CLIProxy, on a
subscription rather than a key) is not one upstream can be pointed at.

What ViMax is actually valuable for is its **method**, and that ports cleanly:

- the crew — screenwriter, character extractor, storyboard artist, visual
  analyst — each with a role prompt carrying real craft rules;
- the separation of a character's **static** features (what keeps a face the
  same face) from its **dynamic** ones (what a costume change may alter);
- camera reuse across shots, so a scene is shot from as few positions as
  possible;
- and the decomposition of every shot into **first frame → motion → last
  frame**, which is the seam a video model renders across.

So the pipeline is ported natively in TypeScript over ChatMock, with the prompts
kept close to the originals (`vimax/agents/*.py`) and the data model kept
structurally faithful to the pydantic interfaces (`vimax/interfaces/*.py`).

## Drawing the frames

Breadboard usually has more than one model that can draw, and they run on
different subscriptions. The agent asks the provider what it has, then draws
with the first thing that works:

1. a model named by `VIMAX_IMAGE_MODEL`, if one is set;
2. any image-capable model the provider advertises — on this machine that is
   `cliproxy/gemini-3.1-flash-image`, a Gemini image model reached through
   CLIProxy on a Google subscription;
3. the Responses `image_generation` tool on the chat model (the ChatGPT path).

**Pick one explicitly** with `--gemini` or `--chatgpt`, or set a default under
Settings → Agents → ViMax → *Frame generator*. This matters because the two
quotas are separate: when the ChatGPT limit is reached, Gemini still draws.

The first version of this agent knew only route 3, so when that quota ran out
every frame failed — and, worse, failed silently, because the drawing code
returned `null` for every kind of failure. It now reports the provider's own
reason, stops asking once a provider is exhausted rather than repeating the same
failure forty times, and carries the reason onto the run card and into the film.

## Making the video

Drawn frames are encoded into a real **MP4** with the ffmpeg this repository
already ships (the desktop shell's `ffmpeg-static`, or Agent Reach's portable
copy; override with `VIMAX_FFMPEG_PATH`). Each shot is held for the duration the
storyboard artist gave it and moves in the direction its motion description
implies — a push in, a pull out, a pan — and the dialogue rides along as a
subtitle track, so the words are in the file without any font handling.

The MP4 is its own artifact: it plays on the film's page, downloads, and can be
sent anywhere. Every shot also keeps `videoPrompt` — exactly what a video model
would be sent — so a production planned here stays renderable by upstream ViMax,
or by any video model, unchanged.

## Using it

Open the capability palette, choose **Agents**, then `/agents:vimax`. The command
carries the whole brief — no agent chip, no second message:

```text
/agents:vimax a lighthouse keeper who befriends a whale --scenes 3 --style "watercolour"
```

Flags, all optional:

| Flag | Effect |
| --- | --- |
| `--script` | The brief already is a screenplay; skip story development (Script2Video) |
| `--scenes N` | Ask the screenwriter for N scenes (1–12) |
| `--shots N` | Cap the shots the storyboard artist plans per scene (1–12) |
| `--style "…"` | The visual style every frame is drawn in |
| `--vertical`, `--square` | Change the frame from the 16:9 default |
| `--no-images` | Plan the film, but do not draw the storyboard |
| `--gemini`, `--chatgpt`, `--auto` | Which model draws the frames |
| `--for "…"` | Extra creative requirements, passed through verbatim |

The card lamps the production stage by stage and counts frames as they are
drawn. When it finishes, the **film's own artifact card** sits directly beneath
the reply.

## The artifact

The whole production is the artifact's source, so reopening a film never calls a
model again. It has five sections:

- **Film** — the encoded MP4, with a download link. Productions that have no
  video file fall back to the animatic here: play, pause, step by shot, jump to
  any shot on the duration-weighted spine, 0.5×/1×/2×.
- **Storyboard** — every shot as a card: drawn frame, camera index, variation
  grade, first-frame description, motion, and a *Copy render prompt* button.
- **Screenplay** — the story and every scene's script.
- **Cast** — each character with their reference portrait and their static and
  dynamic features.
- **Production** — pipeline, style, frame, runtime, counts, how it was rendered,
  and the brief history.

A follow-up in the same conversation **forks the same artifact** rather than
creating a second one, and the brief history records what was asked each time.

Drawn frames and portraits are stored as ordinary image artifacts referenced by
id, so each is independently viewable, downloadable and reusable.

## What a run costs

Model calls scale with the film: one for the story, one for the screenplay, one
for the cast, one per scene for the storyboard, and one per shot for the frame
decomposition. Drawing is the slow part — a portrait per visible character
(max 8) and a first frame per shot (max 14), each an image generation.

`--no-images` skips drawing entirely, which turns a multi-minute run into a
fast one and is the right flag when you only want the writing. Encoding is
cheap by comparison — a few seconds per shot, no model involved.

A long film costs more than it looks: 3 scenes at ~14 shots each is 42 shots,
which is 42 decomposition calls and a 4-minute runtime. `--shots 5` keeps a run
short.

## Failure behaviour

- **A stage that will not fit its schema** is shown its own errors and asked
  once more. A second failure ends the run naming the stage, rather than letting
  a half-formed scene into the film.
- **A frame that cannot be drawn** costs that frame and nothing else. The shot
  falls back to a title card built from its own first-frame description, so the
  film still plays for its full runtime.
- **A drawing provider that has run out** (a quota, an expired login) stops the
  drawing stage immediately instead of failing once per frame, and the run card
  and the film both say what the provider said — including when the quota
  resets. Try the other generator: `--gemini` or `--chatgpt`.
- **No ffmpeg** means no MP4. The film, its storyboard and its animatic are
  unaffected; the Production tab says why there is no file.
- **No conversation to store the artifact in** ends the run with the film
  produced and the fact reported, never a claim of a film that was not stored.

## Where things are

| Path | What it is |
| --- | --- |
| `vimax/` | The upstream clone, kept as the reference for prompts and interfaces |
| `dashboard/src/lib/vimax/prompts.ts` | The crew, ported from `vimax/agents/*.py` |
| `dashboard/src/lib/vimax/types.ts` | The production, ported from `vimax/interfaces/*.py` |
| `dashboard/src/lib/vimax/schemas.ts` | Every model output and the stored-artifact contract |
| `dashboard/src/lib/vimax/model-client.ts` | The forced tool calls through ChatMock |
| `dashboard/src/lib/vimax/pipeline.ts` | The staged production |
| `dashboard/src/lib/vimax/image-backend.ts` | Which model draws, and what happens when it cannot |
| `dashboard/src/lib/vimax/video.ts` | Encoding the shots into an MP4 with ffmpeg |
| `dashboard/src/lib/vimax/artifact.ts` | Publication, image drawing, video storage, revision forking |
| `dashboard/src/lib/vimax/run-manager.ts` | Run state and the events the card streams |
| `dashboard/src/app/api/vimax/runs/` | Start, stream (SSE), abort |
| `dashboard/src/app/components/vimax/vimax-film-artifact.tsx` | The film, and the animatic player |
| `dashboard/src/app/components/hermes/inline-vimax-run.tsx` | The run card |
| `dashboard/tests/vimax-*.test.mjs` | Identity, pipeline, run and artifact tests |

## Adding a video *model* later

The encoder produces a real film from stills. A generative video model would
animate each shot instead, and the seam for it is already in place:
`renderPlan.videoBackend` names what produced the video, and every shot carries
both the prompt (`shot.videoPrompt`) and the first frame a video model needs.

Adding one means a backend that consumes those two, stores the clip per shot,
and concatenates with the existing ffmpeg step — nothing about the writing, the
storyboard, or the artifact has to change. No video model is reachable from this
machine today (none of the providers in `/v1/models` generates video), which is
why the shipped backend is the encoder.
