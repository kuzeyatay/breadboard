# Image to 3D — Stable Fast 3D

Attach a picture to a chat, ask for a 3D model, and get one: a textured GLB
mesh, reconstructed locally, attached to the response as an artifact that opens
in the chat's 3D viewer.

The reconstruction runs on [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d),
vendored at `stable-fast-3d/`. Nothing about the picture leaves the machine.

## What makes it innate

There is no form, no `/agents:` command, and no mode to switch on. A turn that
carries a reconstructable picture *and* asks for a three-dimensional thing
selects the first-party `image-to-3d` skill on its own, the same way an attached
video selects Watch:

```
turn-service.ts  premortem → factcheck → patent disclosure → visualizer → agent-loop → watch → image-to-3d → Spotify → audio-analysis → diagram → GitHub Explorer → humanize → messaging → Goal
```

Two rules keep that from firing on every screenshot:

- A picture alone never selects the skill. Unlike a video, an attached picture is
  usually *not* the subject of the turn — people paste screenshots to ask what is
  wrong with them. The request has to name a 3D thing.
- Talking *about* 3D is not asking for one. "How do I make a 3D model from a
  photo?" and "which 3D printer should I buy" are ordinary conversation, and
  `image-3d-intent.ts` excludes them explicitly.

A picture from an earlier message still counts, so "now make it a quad mesh" —
which arrives with no attachment at all — reaches the same picture.

If the runtime turns out to be unavailable, the automatic selection must not cost
the turn: `startConversationTurn` resolves the message again without it, and the
person gets an ordinary answer instead of an error.

## The pieces

| Path | What it is |
| --- | --- |
| `stable-fast-3d/` | The Stability checkout. Never modified. |
| `dashboard/scripts/sf3d-bridge.py` | One image in, one GLB out, one JSON object on stdout. Also `--probe`. |
| `scripts/setup-sf3d.mjs` | `npm run setup:sf3d` — provisions the pinned Python 3.12 environment. |
| `dashboard/src/lib/sf3d/config.ts` | Paths and bounded run options. |
| `dashboard/src/lib/sf3d/runtime.ts` | `sf3dStatus()` — a pure read that never installs. |
| `dashboard/src/lib/sf3d/service.ts` | Argument bounds, the process, the GLB signature check. |
| `dashboard/src/lib/sf3d/images.ts` | Which attached picture the request means, and the context block. |
| `dashboard/src/lib/sf3d/artifact.ts` | Publishes the mesh as a `model` artifact. |
| `dashboard/src/lib/hermes/image-3d-intent.ts` | When the skill selects itself. |
| `dashboard/src/app/api/hermes/tools/image-to-3d/route.ts` | The `image_to_3d` implementation. |
| `hermes-skills/prebuilt/image-to-3d/SKILL.md` | The skill the model actually reads. |

Nothing new was needed to *show* a mesh. The `model` artifact kind, the
`model-file` renderer and the three.js artifact panel already existed for the
Formsmith/ShapeR agent, and a second way to store a mesh is how the two would
slowly stop behaving alike.

## The tool

`image_to_3d` is authorized on Garden Chat and the Terminal, never on Quartz, and
only when the skill is selected for the turn.

It has **no argument that carries image data**. The model names a picture; the
route resolves the bytes from a message in the caller's own conversation. A
path, a URL or a data URL written by the model is never read — which is what
makes the tool safe to expose on a surface with no filesystem grant at all.

| Argument | Meaning |
| --- | --- |
| `image` | Filename of the attached picture. Omitted → the most recent one. |
| `textureResolution` | 256 / 512 / 1024 (default) / 2048. |
| `remesh` | `none` (default), `triangle`, `quad`. |
| `targetVertexCount` | Rough vertex budget. Implies `triangle` if no remesher was chosen. |
| `removeBackground` | Default true. False only for a clean cutout. |

It returns the artifact, the source filename, the device, the duration, and the
mesh summary (triangles, vertices, materials) read back out of the GLB.

## Installing the runtime

```sh
npm run setup:sf3d
```

Run it once, from a shell that has a C++ compiler on PATH. It creates
`.runtime/sf3d-venv` on a pinned Python 3.12, installs torch (the CUDA build when
an NVIDIA GPU is present), then installs Stable Fast 3D itself.

Three prerequisites, and the setup script checks each before downloading
anything:

- **A C++ toolchain.** SF3D's `requirements.txt` ends with two local source
  directories — `texture_baker/` and `uv_unwrapper/` — which are torch C++
  extensions compiled at install time. On Windows that means MSVC: install the
  free [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/downloads/)
  with the "Desktop development with C++" workload and run the setup from an
  *x64 Native Tools Command Prompt for VS*. MinGW is not a substitute — torch's
  `cpp_extension` shells out to `cl.exe`.
- **A CUDA or Apple Metal device.** The texture baker has kernels for those two
  and no CPU path. A machine without either cannot run this at all; that is a
  first-class status (`no_gpu`), not a slow case. Roughly 6 GB of VRAM at the
  default texture resolution.
- **Access to the gated weights.** Request it at
  [huggingface.co/stabilityai/stable-fast-3d](https://huggingface.co/stabilityai/stable-fast-3d),
  create a read token, and put it in the repository `.env`:

  ```
  HUGGINGFACE_TOKEN=hf_…
  ```

Nothing installs as a side effect of a chat turn or of reading the status.
`sf3dStatus()` runs the bridge's `--probe`, which import-checks by specification
rather than by importing, so it neither loads torch nor opens a CUDA context.

## Configuration

| Variable | Default |
| --- | --- |
| `SF3D_ROOT` | `<repo>/stable-fast-3d` |
| `SF3D_VENV` | `<repo>/.runtime/sf3d-venv` |
| `SF3D_PYTHON` | the venv interpreter |
| `SF3D_DEVICE` | best available (`cuda` → `mps` → `cpu`) |
| `SF3D_TEXTURE_RESOLUTION` | `1024` |
| `SF3D_REMESH` | `none` |
| `SF3D_TIMEOUT_MS` | `300000` |
| `SF3D_PRETRAINED_MODEL` | `stabilityai/stable-fast-3d` |

## Status states

`sf3dStatus()` reports exactly one thing at a time, ordered by what a person
would have to do about it. Naming three problems at once when fixing the first
would reveal the second is worse than naming the first.

- `clone_missing` — the Stability checkout is not where it should be.
- `not_installed` — `npm run setup:sf3d` has never been run.
- `incomplete` — the environment exists but does not import; usually the
  compiled extensions, which means the C++ toolchain.
- `no_gpu` — torch sees neither CUDA nor Metal.
- `ready`.

## Limits worth stating to the person

Stable Fast 3D reconstructs **shape, not scale**: the mesh has no real-world
units, so any measurement is an invention. It reconstructs a **single
foreground object** from **one view**, so the back and the underside are the
model's best guess — the skill is written to say that once, plainly, rather than
bury it. Scenes, people, text, thin wires and reflective surfaces are the usual
sources of disappointment.

## Tests

```sh
npm --prefix dashboard test -- tests/image-to-3d.test.mjs
```

Covers the skill resolving `ready` on both chat surfaces and not on Quartz, the
tool being registered in every place the runtime actually reads, the intent
rules in both directions, attachment resolution, argument bounds, and the fact
that no data URL ever reaches the prompt.

The tests do **not** run a real reconstruction — that needs the GPU, the
compiler and the gated weights. Everything up to the process launch is exercised;
the process itself is not.
