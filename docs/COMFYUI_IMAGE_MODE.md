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

Desktop Runtime V2 has two deliberately separate modes:

1. **Managed local**: ComfyUI is a registered, mandatory, failure-isolated
   on-demand service. It is absent at startup. The first render or explicit
   Start action acquires its native lease; Rust single-flights a cold start and
   owns the complete Python/GPU descendant tree. There is no Next or Electron
   spawn fallback while Runtime V2 is active.
2. **Explicit external**: an independently managed `http`/`https` endpoint is
   health-checked and used as-is. Breadboard never claims or changes that
   process. This is configured as `comfyUiMode: "external"` with a validated,
   credential-free `comfyUiExternalUrl`, not inferred from an answering port.

Bare-dashboard development can use an explicitly external ComfyUI through
`COMFYUI_MANAGED=false`. It has no managed local process-launch fallback: a
managed render without the native Runtime owner returns a truthful unavailable
result.

Nothing installs or starts as a side effect of opening the tab. Asking for the
status is a read; `tests/comfyui-image.test.mjs` enforces that.

## Starting on first use

Breadboard does not start ComfyUI with the app. A local diffusion process can
retain several gigabytes of model state, so merely opening Breadboard leaves it
stopped. The first real Advanced render automatically starts an installed,
managed server behind the existing loading flow; the existing explicit Start
action does the same. Status reads never start it, setup remains explicit, and
an explicitly configured independently managed ComfyUI is still used as-is.

The render lease stays active through capability discovery, prompt submission,
completion polling, and the final image read. Cancellation and every error path
release it. The final release starts a bounded ten-minute idle TTL; later work
restarts the same service. Admission denial remains the structured
`BREADBOARD_RESOURCE_EXHAUSTED` response used elsewhere in the UI.

Packaged desktop builds stage reviewed ComfyUI source and its license only.
Models, environments, caches, inputs, outputs, and user data are forbidden from
the package. The setup-produced Python interpreter and readiness marker live
under the pinned desktop data root and must both exist before Runtime V2 will
launch the service.

## Setup

The existing setup action submits one authenticated `managed-setup-node`
Runtime V2 job. That fresh worker copies only reviewed ComfyUI program files to
`<Data>/runtime-v2/toolchains/comfyui`, creates the Python environment at
`<Data>/runtime-v2/services/comfyui/.venv`, streams bounded durable setup
progress, verifies the interpreter, writes the readiness marker, and exits.
Every installer child remains attached to the Runtime-owned worker tree, so
cancellation or shutdown reclaims it instead of leaving a detached download.
It needs [`uv`](https://docs.astral.sh/uv/) on PATH.

Models, custom nodes, inputs, outputs and user state remain separately under
`<Data>/comfyui`; setup never stages them into the program tree or deletes them.
The service manifest accepts only the fixed verified interpreter and fixed
staged entrypoint, while status reads remain observational and never launch
either setup or the model service.

**Models are never downloaded for you.** A checkpoint is several gigabytes and
often a licence decision. In development, put `.safetensors` files in
`comfyui/models/checkpoints`; packaged desktop uses
`<userData>/Data/comfyui/models/checkpoints`. The panel lists whatever
`/object_info` reports.

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

Desktop mode is persisted in `desktop-config.json`. Managed URL, port, checkout,
environment, runtime-data paths, and start timeout are sealed native Runtime V2
launch values; dashboard environment overrides cannot redirect them. Bare-dashboard
development supports only the explicit external variables below. In the service manifest,
`requirement: "optional"` means startup-failure isolation only. It does not
permit omitting or hiding Advanced image generation: first use must attempt the
service and return a truthful setup/unavailable/resource result.

| Variable | Default | Notes |
| --- | --- | --- |
| `COMFYUI_ENABLED` | `true` | `false` removes the tab and the routes |
| `COMFYUI_URL` | required in external mode | Credential-free HTTP(S) endpoint |
| `COMFYUI_MANAGED` | `true` | Set `false` for bare-dashboard external mode; `true` never enables a dashboard launcher |
| `COMFYUI_GENERATE_TIMEOUT_MS` | `600000` | One render |

## Files

- `dashboard/src/lib/comfyui/` — config, HTTP client, workflow, process
  management, service (the state machine)
- `dashboard/src/app/api/comfyui/route.ts` — status, and the two explicit
  actions (`setup`, `start`)
- `dashboard/src/app/components/hermes/comfyui-image-panel.tsx` — the tab
- `scripts/setup-comfyui.mjs` — the detached installer
- `dashboard/tests/comfyui-image.test.mjs` — graph shape, clamping, wiring
- `dashboard/tests/comfyui-runtime-v2-cutover.test.mjs` — cold lease, full-render
  lease lifetime, explicit Start/idle release, cancellation, external mode,
  resource errors, and no-direct-spawn guard
