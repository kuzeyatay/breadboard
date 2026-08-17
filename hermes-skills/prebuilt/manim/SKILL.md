---
name: manim
description: Create a polished Manim Community animation and publish it as a durable MP4 artifact. Use for animated mathematical explanations, geometric constructions, equation transformations, plots, algorithms, physical processes, and other concepts that benefit from a narrated visual sequence rather than a static diagram or interactive control.
---

# Manim

Create one focused explanatory animation with the guarded `manim_create` tool.
The tool renders in a pinned, network-disabled Manim Community container,
verifies the MP4, and attaches it to the response. Do not use the terminal,
write files, or call `artifact_import` yourself.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - manim_create
  requiredArtifactKinds:
    - video
  requiredRuntimes:
    - manim-runtime
  requiredBinaries:
    - docker
  requiredMcpServers: []
  optionalMcpServers: []

## Workflow

1. Plan one visual argument with a beginning, transformation, and conclusion.
2. Write a complete Manim Community v0.20 scene named `BreadboardScene`.
3. Call `manim_create` exactly once with the title, a one-sentence accessible
   description, scene source, scene name, and the smallest suitable quality.
4. If validation returns a precise source error, repair only that error and
   retry. If the runtime is missing, relay its setup instruction.
5. After success, summarize the visual lesson in one short sentence and point
   to the video artifact. Do not paste the source into chat.

## Scene contract

- Start with `from manim import *`. You may also import `math` or NumPy. No
  other libraries, file access, subprocesses, sockets, or network clients.
- Define `class BreadboardScene(Scene)` or use a relevant built-in Scene
  subtype such as `ThreeDScene`, `MovingCameraScene`, or `ZoomedScene`.
- Keep the animation self-contained. Use generated Manim objects, not local or
  remote assets, custom fonts, audio, or data files.
- Prefer `Text` for prose and `MathTex`/`Tex` for notation. Keep labels large,
  short, and inside the frame. Use high contrast and a restrained palette.
- Build continuity: introduce objects before transforming them, keep semantic
  colors stable, and end on the result long enough to read it.
- Aim for 15–45 seconds. Use `draft` while explicitly asked for a quick preview,
  `standard` by default, and `high` only when the user requests 1080p output.
- Avoid decorative motion, crowded simultaneous animations, camera movement
  without explanatory value, and claims unsupported by the user’s material.

The container has no network and only its temporary job directory is writable.
The renderer rejects dynamic imports, dunder access, dangerous built-ins, and
imports outside Manim, NumPy, and the Python math module.

## Tool input

Call `manim_create` with this exact object shape:

```json
{
  "title": "Short video title",
  "description": "One-sentence accessible description.",
  "code": "from manim import *\n\nclass BreadboardScene(Scene):\n    ...",
  "sceneName": "BreadboardScene",
  "quality": "standard"
}
```

`sceneName` defaults to `BreadboardScene`. `quality` must be `draft`,
`standard`, or `high`.
