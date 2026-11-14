---
name: math-animation
description: Explain a mathematical or scientific idea as an animated video made with Manim and publish it as an MP4, with spoken narration and background music when they help. Use for derivatives, integrals, limits, proofs, geometric constructions, equation transformations, function plots, linear algebra, probability, algorithms, physical processes, and any request that names Manim, and for changing an animation just made (add narration, add or change music, retime, shorten). Not for motion graphics, product or launch videos (use /video), cinematic 3D (use /film), or filmed footage.
---

# Math Animation

Turn what the user asked for into one focused explanatory animation with the
guarded `manim_create` tool. The tool renders in a pinned, network-disabled
Manim Community container, speaks the narration, fetches and cuts the music,
mixes the sound into the MP4, verifies it, and attaches it to the response. Do
not use the terminal, write files, or call `artifact_import` yourself.

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
   Split it into beats of a few seconds each: what appears, what changes, what
   the viewer should now see.
2. Decide the sound (see Sound). If there is narration, write one line per beat
   first, then give each beat enough screen time for its line.
3. Write a complete Manim Community v0.20 scene named `BreadboardScene`.
4. Call `manim_create` once with the title, a one-sentence accessible
   description, scene source, the smallest suitable quality, and `narration`
   and `music` when used.
5. Read the result. `videoSeconds` is the real length and `narration` the real
   length of each spoken line. `notes` lists lines that overlap or run past the
   end: fix the waits or the start times and render again, once.
6. If validation returns a precise source error, repair only that error and
   retry. If the runtime is missing, relay its setup instruction. If narration
   is unavailable, render without it and tell the user what the tool said.
7. After success, say in one short sentence what the math animation shows, and
   name the music if any. Do not paste the source into chat.

A follow-up such as "add narration", "add music", "use this song <link>",
"quieter music" or "slow down the second part" means: send the same scene again
with that change. The source is not stored, so resend the whole call.

## Scene contract

- Start with `from manim import *`. You may also import `math` or NumPy. No
  other libraries, file access, subprocesses, sockets, or network clients.
- Define `class BreadboardScene(Scene)` or use a relevant built-in Scene
  subtype such as `ThreeDScene`, `MovingCameraScene`, or `ZoomedScene`.
- Keep the animation self-contained. Use generated Manim objects, not local or
  remote assets, custom fonts, or data files. Sound never goes in the scene:
  do not call `add_sound`; pass `narration` and `music` to the tool.
- Prefer `Text` for prose and `MathTex`/`Tex` for notation. Keep labels large,
  short, and inside the frame. Use high contrast and a restrained palette.
- Build continuity: introduce objects before transforming them, keep semantic
  colors stable, and end on the result long enough to read it.
- Aim for 15–60 seconds. Use `draft` when explicitly asked for a quick preview,
  `standard` by default, and `high` only when the user requests 1080p output.
- A render may take as long as it needs (the limit is two hours), and the user
  would rather wait than get no video. 3D is slow: a 45 second `ThreeDScene`
  can take ten minutes or more, so say that it may take a while. Do not burn
  time for nothing: use `Surface` resolutions near `(5, 14)` and flat `Arrow`
  rather than `Arrow3D` for field arrows unless the scene needs more.
- Avoid decorative motion, crowded simultaneous animations, camera movement
  without explanatory value, and claims unsupported by the user's material.

The container has no network and only its temporary job directory is writable.
The renderer rejects dynamic imports, dunder access, dangerous built-ins, and
imports outside Manim, NumPy, and the Python math module.

## Sound

- Narration. Add it when the user asks for a voice, a voice-over, narration or
  "explain it to me" as a video; a plain "animate X" gets none unless the idea
  cannot be followed without words. Pass lines with a start time:
  `"narration": [{ "text": "The slope of this line is the derivative.", "atSeconds": 4 }]`.
  It is spoken by the user's read-aloud voice. Up to 12 lines, each one or two
  short sentences, written for the ear: say "x squared", not "x^2".
- Timing. You control the clock: every `self.play(..., run_time=t)` and
  `self.wait(t)` adds `t` seconds (`play` defaults to 1). Keep a running total
  in comments (`# t = 4.0`) and start each line at the beat it describes.
  Budget about 2.5 words per second, plus half a second of air, and make the
  beat at least that long with `self.wait`. End with a wait that covers the
  last line.
- Music. Add it only when the user asks for music, or names or links a song.
  - A pasted YouTube link: `"music": { "url": "<that link>" }`.
  - A named song or artist: `"music": { "search": "<artist> <title>" }`.
  - "Add background music" with nothing named: search for something calm and
    free to use, such as `"calm ambient piano no copyright music"`.
  The track is cut to the video's length, faded in and out, and played lower
  under narration. `volume` (0 to 1) and `startSeconds` override the defaults.
  Name the track (`music.title` in the result) in your reply.

## Tool input

Call `manim_create` with this object shape. Only `title`, `description` and
`code` are required.

```json
{
  "title": "What a derivative is",
  "description": "A secant line on a parabola turns into the tangent as the two points meet.",
  "code": "from manim import *\n\nclass BreadboardScene(Scene):\n    ...",
  "sceneName": "BreadboardScene",
  "quality": "standard",
  "narration": [
    { "text": "Pick two points on the curve and join them.", "atSeconds": 1 },
    { "text": "Slide them together, and the line settles on the tangent.", "atSeconds": 6 }
  ],
  "music": { "search": "calm ambient piano no copyright music" }
}
```

`sceneName` defaults to `BreadboardScene`. `quality` must be `draft`,
`standard`, or `high`. `music` takes exactly one of `url` (a single YouTube
video) or `search`.
