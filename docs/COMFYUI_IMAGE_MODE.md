# ComfyUI — the Advanced image mode

The Socials Manager's post studio can make a picture four ways: pick one from
your archive, ask the configured AI provider to draw one, upload a file, or —
**Advanced** — render it locally with [ComfyUI](https://github.com/comfyanonymous/ComfyUI),
vendored at `./comfyui`.

Advanced exists for the cases the hosted generator cannot serve: a picture that
must not leave the machine, a picture that has to be reproducible from a seed,
or a picture that has to come from one specific checkpoint or LoRA-tuned model.

## What the tab shows

The panel renders a state the *server* decided (`lib/comfyui/service.ts`), not
one it infers from parts. Each state has one sentence and one button:

| State | What it means | The button |
| --- | --- | --- |
| `ready` | A ComfyUI is answering and has at least one checkpoint | Render |
| `no_models` | Answering, but `models/checkpoints` is empty | Look again |
| `stopped` | The vendored clone is installed but not running | Start ComfyUI |
| `installing` | The Python environment is being built right now | (progress) |
| `not_installed` | No environment yet, and Breadboard could build one | Set up ComfyUI |
| `unavailable` | Nothing answers, and there is nothing here to start | Check again |
| `disabled` | `COMFYUI_ENABLED=false` | — the tab is removed |

## How Breadboard reaches ComfyUI

In this order, and the order is the point:

1. **Anything already answering at `COMFYUI_URL`** is used as-is. If you run
   your own ComfyUI — your models, your custom nodes, your launch flags — it is
   never restarted, replaced, or duplicated behind your back.
2. Otherwise the **vendored `./comfyui`** is started, but only when
   `COMFYUI_MANAGED` is on *and* its Python environment has already been built.
3. Otherwise the panel says what is missing. Setup is always an explicit click.

Nothing installs or starts as a side effect of opening the tab. Asking for the
status is a read; `tests/comfyui-image.test.mjs` enforces that.

## Starting with the app

`lib/comfyui/autostart.ts` runs from `instrumentation-node.ts`, alongside the
chat scheduler and the messaging gateways, so it happens whether or not a page
is open — in `npm run dev` and in the packaged desktop build alike. Without it
the first Advanced render pays for the whole cold start: a Python process, then
several gigabytes of checkpoint off disk.

It acts on exactly one state, `stopped`, which already means *installed,
managed, enabled, and nothing else answering*. So it will not install anything
(setup stays an explicit click), will not start a second server next to a
ComfyUI you run yourself, and does nothing at all on a fresh checkout. It is
delayed 12 seconds and never blocks boot; if it fails, the first render starts
the server itself. `COMFYUI_AUTOSTART=false` turns it off.

Note for packaged desktop builds: the `comfyui/` checkout is not staged into
the app resources, so there is nothing there to autostart. Advanced works
against a ComfyUI you point `COMFYUI_URL` at.

## Setup

`scripts/setup-comfyui.mjs` builds `.runtime/comfyui-venv` — PyTorch (CUDA
wheels when `nvidia-smi` reports a GPU, CPU wheels otherwise) plus ComfyUI's
own `requirements.txt`. It needs [`uv`](https://docs.astral.sh/uv/) on PATH.

It runs **detached**, and reports through a heartbeated status file
(`.runtime/comfyui/startup-status.json`) that records the writer's pid — the
same protocol the local speech service uses, and for the same reason: over a
multi-gigabyte download, a single phase string cannot distinguish "still
downloading torch" from "was killed an hour ago". The panel polls it and shows
the step, the package and the byte count.

**Models are never downloaded for you.** A checkpoint is several gigabytes and
often a licence decision. Put `.safetensors` files in
`comfyui/models/checkpoints`; the panel lists whatever `/object_info` reports.

## The workflow

One stock text-to-image graph (`lib/comfyui/workflow.ts`):

```
CheckpointLoaderSimple ─┬─ CLIPTextEncode (positive) ─┐
                        ├─ CLIPTextEncode (negative) ─┤
EmptyLatentImage ───────┴──────────────────────────── KSampler ─ VAEDecode ─ SaveImage
```

The exposed controls are ComfyUI's own vocabulary — checkpoint, sampler,
scheduler, steps, CFG, seed, size — deliberately not renamed, so settings stay
portable to and from a ComfyUI the user drives directly.

Values are **clamped, not rejected**: a step count that arrives at 900 is a
mistake worth correcting, not a request worth failing. Sizes are rounded to
ComfyUI's latent step of 8, because the graph would round them silently and the
studio would then be lying about the size it delivered.

## Where the picture goes

Exactly where Generate and Upload put theirs: through
`POST /api/hermes/artifacts/images` with `operation: "comfyui"`, into an
ordinary image artifact in your archive, then *staged* onto the post until you
press Save. The full render — checkpoint, prompt, negative prompt, sampler,
scheduler, steps, CFG, size and the resolved seed — is kept in the artifact's
metadata, which is the only thing that makes the picture reproducible later.

There is one route that turns bytes into an image artifact, on purpose. Two
would drift.

## Configuration

All optional; see `dashboard/.env.example`.

| Variable | Default | Notes |
| --- | --- | --- |
| `COMFYUI_ENABLED` | `true` | `false` removes the tab and the routes |
| `COMFYUI_URL` | `http://127.0.0.1:8188` | Point at any ComfyUI |
| `COMFYUI_MANAGED` | `true` | `false` = connect only, never install or start |
| `COMFYUI_AUTOSTART` | `true` | Start it with the app when it is installed and idle |
| `COMFYUI_PORT` | `8188` | Used when Breadboard starts the clone |
| `COMFYUI_ROOT` | `<repo>/comfyui` | The checkout |
| `COMFYUI_ENV_DIR` | `<repo>/.runtime/comfyui-venv` | The Python environment |
| `COMFYUI_START_TIMEOUT_MS` | `180000` | A cold start loads the model too |
| `COMFYUI_GENERATE_TIMEOUT_MS` | `600000` | One render |

## Files

- `dashboard/src/lib/comfyui/` — config, HTTP client, workflow, process
  management, service (the state machine)
- `dashboard/src/app/api/comfyui/route.ts` — status, and the two explicit
  actions (`setup`, `start`)
- `dashboard/src/app/components/hermes/comfyui-image-panel.tsx` — the tab
- `dashboard/src/lib/comfyui/autostart.ts` — booted from `instrumentation-node.ts`
- `scripts/setup-comfyui.mjs` — the detached installer
- `dashboard/tests/comfyui-image.test.mjs` — graph shape, clamping, wiring
