---
name: image-to-3d
description: Turn a picture attached to the conversation into a real 3D model — a textured GLB mesh reconstructed by the local Stable Fast 3D runtime — and attach it to the chat as a durable artifact that opens in the 3D viewer.
license: MIT
allowed-tools:
  - image_to_3d
  - artifact_list
metadata:
  openclaw:
    requires:
      bins:
        - python
---

# Image to 3D

Use this skill when someone attaches a picture and asks for a three-dimensional
thing from it: a 3D model, a mesh, a GLB, something to 3D print, a game asset,
or "make this 3D". One picture is the entire input. The reconstruction runs
locally on Stability AI's Stable Fast 3D; nothing is uploaded anywhere.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - image_to_3d
  requiredArtifactKinds:
    - model
  requiredRuntimes:
    - image-to-3d-runtime
  requiredMcpServers: []
  optionalMcpServers: []

## Calling the tool

Call `image_to_3d`. Do not describe how the person could make a model
themselves, do not offer to write a script that would do it, and never answer
that you cannot produce 3D files — this tool produces one.

Arguments, all optional:

- `image` — the filename of the picture to reconstruct, exactly as it appears
  in the `[Attached picture — 3D reconstruction available]` block in this turn's
  context. Omit it and the most recently attached picture is used. Never pass a
  path, a URL, or image data: the tool resolves the bytes itself from a message
  in this conversation.
- `textureResolution` — 256, 512, 1024 or 2048. Default 1024, which is what the
  model was tuned for. Ask for 2048 only when the person asks for a high-detail
  texture, and expect roughly double the GPU memory.
- `remesh` — `none` (default), `triangle`, or `quad`. `none` keeps the raw
  reconstruction and costs nothing extra. Choose `quad` when the person says
  the mesh is for sculpting, animation, subdivision, or a DCC package such as
  Blender or Maya; choose `triangle` for a clean uniform triangle mesh, which is
  the safer choice for 3D printing and game engines.
- `targetVertexCount` — a rough vertex budget, not a hard limit. Use it when
  someone names a poly budget. It only means something alongside a remesher, so
  passing it with `remesh: none` selects `triangle` automatically.
- `removeBackground` — defaults to true, and should stay true for a photograph.
  Set it to false only when the picture is already a clean cutout on
  transparency, where matting it again can eat thin geometry such as handles,
  antennae or chair legs.

When the person asks for a variation — a different texture size, a quad mesh, a
lower poly count — call the tool again with the same `image` and the changed
option. Each call produces its own artifact, so the earlier one is not lost.

## What comes back, and what to say about it

The tool returns a GLB artifact that is already attached to this response and
opens in the chat's 3D viewer. Say what was produced: the artifact's title, the
triangle count when it is reported, and how long the reconstruction took.

Say once, plainly, that the geometry is inferred from a single view — the back
and the underside of the object were never photographed and are the model's best
guess. That is not a disclaimer to bury; it is the single most useful thing to
know before someone prints the result or drops it into a scene.

Do not claim measurements. Stable Fast 3D reconstructs shape, not scale: the
mesh has no real-world units, so "about 30 cm tall" is an invention unless the
person supplies the size themselves.

## Choosing a good input

A reconstruction is only as good as what the picture shows. When the result is
likely to disappoint, say so before running rather than after:

- One object, roughly centred, mostly unoccluded, is the case this model handles
  well. A single product photo is close to ideal.
- A photograph of a *scene* — several objects, a room, a landscape — reconstructs
  as one confused blob. Ask which object is wanted, or ask for a cropped picture.
- People and faces work poorly. Say so rather than producing something unkind.
- Text, thin wires, and transparent or highly reflective surfaces are the usual
  sources of artefacts.
- Heavy motion blur, extreme close-up crops, and images where the subject is cut
  off at the frame edge all lose geometry that cannot be recovered.

## When the runtime is not ready

The tool reports exactly one missing thing at a time; relay that sentence rather
than guessing at a cause. The three that actually happen:

- **Not installed** — the environment has never been provisioned. Tell the
  person to run `npm run setup:sf3d` once. Do not run it yourself: it compiles
  C++ extensions and downloads several gigabytes of PyTorch.
- **No GPU** — Stable Fast 3D's texture baker has CUDA and Apple Metal kernels
  and no CPU path, so a machine without either cannot run it at all. This is not
  a slow case; it is an impossible one. Say that plainly instead of suggesting
  they wait.
- **Gated weights** — the model is access-gated on Hugging Face. The person has
  to request access at `huggingface.co/stabilityai/stable-fast-3d`, then put a
  read token in the repository `.env` as `HUGGINGFACE_TOKEN`.

A first successful reconstruction is slower than the ones after it because it
also downloads the weights. If a run times out on its first attempt, say that
and offer to try again rather than reporting the feature as broken.
