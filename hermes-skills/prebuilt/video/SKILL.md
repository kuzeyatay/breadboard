---
name: video
description: Make a video from a description and publish it as an MP4, with music, narration and sound effects when they help. The default way to make a video in Breadboard: flat 2D motion graphics built on Remotion (a 3D or cinematic piece goes to /film). Use for motion graphics, explainers, product and launch videos, announcements, animated charts and data stories, title sequences, kinetic typography, social clips, animated diagrams or logos, and for changing a video just made (new music from a pasted YouTube link, a different section of the song, narration, pacing). Not for filmed or photorealistic footage (use /veo) or for editing an existing recording.
license: MIT
allowed-tools:
  - video_render
---

# Video

Write one Remotion composition and render it with the `video_render` tool. The
tool bundles your source with a pinned Remotion install, fetches and cuts the
music, speaks the narration, renders at 30 or 60 fps, checks the MP4, and
attaches it to the response. Do not use the terminal, write files, download
anything yourself, or call `artifact_import`.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - video_render
  requiredArtifactKinds:
    - video
  requiredRuntimes:
    - remotion-runtime
  requiredMcpServers: []
  optionalMcpServers: []

## Workflow

1. Decide without interviewing the user. Pick the length, format, look, sound
   and structure yourself from the request and the conversation. Ask only when
   the subject itself is missing.
2. Plan the video as shots before writing code: what each shot shows, how long
   it lasts, how the camera moves, what is heard, and the one thing the viewer
   should take from it.
3. If the video has music and should move with it (a release, launch, promo or
   trailer, or any request that says the video should fit the song), call
   `video_render` with `mode: "analyze_music"` first and plan the shots on
   the times it returns. See Cutting to music.
4. Write the composition as a single TSX file that default-exports the video
   component.
5. Call `video_render` once. If it returns a source, style, audio or render
   error, fix exactly that and call it again. Stop after three failed attempts
   and report the last error.
6. Read the result. `notes` lists narration that overlaps or runs past the end;
   fix the timing and render again. `music.title` and `music.startSeconds` say
   what was used.
7. After success, say in one or two plain sentences what the video shows and
   what music it uses. Do not paste the source into chat. Mention any
   assumption the user might want changed, such as the length or the track.

A follow-up such as "use this song", "start at the chorus", "quieter music",
"add a voiceover" or "make it 60 fps" means render the same composition again
with that one thing changed. Write the source again in full; nothing is kept
between calls.

If the request needs filmed or photorealistic footage, say that this skill makes
designed motion graphics and that `/veo` generates footage. Otherwise this skill
is the answer to "make a video".

## Words on screen

The text in the video must read like a careful person wrote it. The renderer
rejects the first two of these; the rest are on you.

- No em dashes or en dashes anywhere. Use a comma, a period, or a line break.
- No all-caps text, and no `textTransform: "uppercase"`. Write sentence case:
  capitalise the first word and proper nouns only. Acronyms keep their capitals.
- Not title case either. "Faster builds for every team", not "Faster Builds For
  Every Team".
- Use very few words. A shot carries one idea in one to four words; ten is the
  ceiling, not the target. A 30 second video rarely needs more than 40 words in
  total. Do not explain what the picture already shows, do not restate the
  title in a subtitle, do not caption every element, and never add a line to
  fill space. If a shot works without text, leave the text out.
- No stock marketing vocabulary: unlock, elevate, seamless, effortless,
  revolutionize, game changer, supercharge, cutting edge, next level, reimagine,
  empower, delve, "in today's world", "say goodbye to", "meet X". Say the
  concrete thing instead: what it is, what it does, the number.
- No emoji, no hashtags, no exclamation marks, no rhetorical questions followed
  by their own answer, no "not just X, but Y", no lists of exactly three
  adjectives.
- Use the user's own words, names and numbers. Never invent a statistic, a
  quote, a customer, a price or a date. If a number is missing, leave it out.
- Numbers get units and plain formatting: "42 ms", "3 of 5", "12%".

The same rules apply to narration text.

## Look

A video that looks generated is a failed video. These are the marks of one, and
the renderer rejects the first three outright:

- No italic text, and no display serif of any kind: never Instrument Serif,
  Playfair Display, DM Serif Display, Fraunces, Cormorant, Bodoni Moda, Abril
  Fatface, Gloock, Lora, Georgia, Times or anything that looks like them. The
  high-contrast "elegant" serif title is the most recognisable generated look
  there is. Do not flip one word of a headline into an italic serif for emphasis. Emphasis comes from weight,
  size, position, or a solid block of colour behind the words.
- No scene numbers or chapter labels on screen: no "01", "02 / Setup", no small
  monospace caption in a corner, no eyebrow line above a heading.
- No orange, terracotta or purple accent, and no cream or beige paper
  background paired with a warm accent. Pick colour from the subject: the
  brand's own colour if there is one, otherwise a colour with a reason.
- No gradient text, no purple to blue gradients, no glowing blobs, orbs or
  aurora backgrounds, no soft radial spotlight behind the title, no glass
  panels.
- No rounded white card with a soft drop shadow floating in the middle of the
  frame. No row of three equal cards. No ticked checklist of three items. No
  icon in a coloured circle.
- Do not centre everything. Bias the layout to an edge, use the full frame,
  and let type run large enough to be cropped by intent rather than floating
  in the middle with equal margins.
- Do not use Inter, Roboto or Space Grotesk as the only typeface. Choose a
  display face with character for headlines and a plain one for small text,
  and vary the choice between videos. See Typefaces.
- Do not repeat one entrance. If every line fades up 40 px, the video reads as
  a template. Use the motion vocabulary below.
- Two videos for two subjects should not look alike. Before writing, name the
  look in one line (for example "flat blue and white, heavy grotesque, hard
  cuts") and make it different from the last video in this conversation.

If the user asks for one of these by name (their brand is orange, they want a
serif italic), do it and set `asRequested: true`. Never set it for your own
choices.

Type is large: on a 1920 by 1080 frame, headlines sit between 120 and 320 px
and supporting text is never below 40 px. Text stays on screen at least 1.5
seconds after it stops moving, about 0.3 seconds per word for longer lines.
Hold the last frame at least 1.5 seconds and end on the result or the name.
Default length is 15 to 30 seconds. Use `landscape` unless the user names a
vertical platform (`portrait`) or a feed post (`square`).

## Typefaces

Every Google Font is installed (about 1,800 families). Import one as
`@remotion/google-fonts/<Name>`, where the name is the family in PascalCase
with no spaces: "Archivo Black" is `ArchivoBlack`, "Plus Jakarta Sans"
is `PlusJakartaSans`. Pick for the subject, not from habit. A starting map:

- Heavy grotesques for product and launch work: Bricolage Grotesque, Archivo,
  Archivo Black, Schibsted Grotesk, Familjen Grotesk, Hanken Grotesk, Onest,
  Sora, Outfit, Urbanist, Plus Jakarta Sans, Manrope, Figtree, Geologica.
- Wide and technical: Unbounded, Syne, Michroma, Orbitron, Chakra Petch,
  Rajdhani, Exo 2, Oxanium, Red Hat Display, Lexend Giga.
- Condensed, poster and sport: Anton, Bebas Neue, Oswald, Big Shoulders,
  Barlow Condensed, Fjalla One, League Gothic, Saira Condensed,
  Antonio, Alumni Sans.
- Slab and editorial: Roboto Slab, Zilla Slab, Bitter, Arvo, Alfa Slab One,
  Rokkitt, Crete Round.
- Rounded and friendly: Nunito, Quicksand, Baloo 2, Fredoka, Comfortaa,
  Varela Round, M PLUS Rounded 1c.
- Monospace and code: JetBrains Mono, IBM Plex Mono, Space Mono, Fira Code,
  DM Mono, Martian Mono.
- Hand, brush and script, for a word or two: Caveat, Permanent Marker,
  Kalam, Rock Salt, Pacifico, Sacramento, Homemade Apple.
- Expressive display: Climate Crisis, Rubik Mono One, Bungee, Monoton,
  Righteous, Dela Gothic One, Titan One, Shrikhand, Rampart One.
- Plain text companions: Instrument Sans, IBM Plex Sans, DM Sans, Work Sans,
  Public Sans, Source Sans 3, Albert Sans, Be Vietnam Pro.

Load only the weights you use and the `latin` subset. Wide faces such as
Unbounded need about 0.8 em per letter: check that the longest line fits the
frame before choosing the size.

## Motion and camera

Think like an editor with a camera, not like a slide deck.

- Camera. Put each shot's content in one wrapper and move the wrapper: a slow
  push in (`scale` 1 to 1.06 over the whole shot), a punch in on the detail
  that matters (`scale` to 1.6 to 2.5 with `transformOrigin` on the target), a
  pan along a wide layout, a pull back to reveal the whole. Something should
  be moving a little in every frame, even during a hold.
- Depth. Move background shapes slower than the subject and foreground
  elements faster, so a pan has parallax.
- Cuts. Prefer hard cuts and cuts carried by an object (a block of colour
  wipes across and the next shot is behind it, a shape scales up to become the
  next background, a word stays in place while everything around it changes).
  Use a cross fade rarely. `@remotion/transitions` has `wipe`, `slide`, `flip`,
  `clockWipe`, `iris` and others.
- Text. Reveal lines from behind a mask (a parent with `overflow: hidden` and
  the line translating up from 100%), set words one at a time on the beat,
  swap a word in place, scale a number while it counts. Not everything fades.
- Timing. Fast in, slow settle: `Easing.bezier(0.16, 1, 0.3, 1)` for
  entrances, `Easing.in(Easing.cubic)` for exits, `Easing.inOut(Easing.cubic)`
  for camera moves. Entrances take 0.3 to 0.7 seconds. Stagger related items by
  2 to 5 frames. Overlap actions: the next thing starts before the last one
  finishes. No bounce, no wobble, no camera shake.
- Speed. Fast moves look sharper with motion blur: wrap the moving layer in
  `<CameraMotionBlur shutterAngle={180} samples={8}>` or `<Trail>` from
  `@remotion/motion-blur`. It multiplies render time, so use it on the few
  shots that need it.
- Frame rate. `fps: 30` is the default. Use `fps: 60` when the video is mostly
  fast camera moves, scrolling interfaces or kinetic type, or when the user
  asks for smooth or 60 fps. It doubles render time. Never hard-code 30:
  express every duration as seconds times `fps` from `useVideoConfig()`.
- Texture. A flat colour field can carry a fine grain: an absolutely
  positioned SVG `feTurbulence` at 4 to 8 percent opacity. Use it or do not;
  never add glow instead.
- Show the thing instead of describing it: draw the chart, the interface, the
  diagram or the sequence with HTML, CSS and SVG, and animate its real states.

## Sound

Sound is part of the video. Decide it the way you decide the look.

- Music. Pass `music` to the tool and it is downloaded, converted to MP3, cut
  to the video's length, faded in and out, and lowered under narration.
  - The user pasted a YouTube link, or named a link earlier in the
    conversation: `music: { "url": "<that link>" }`.
  - The user named a song or artist: `music: { "search": "<artist> <title>" }`.
  - The user asked for music without naming any, or you judge the video
    needs it: write a search for free-to-use music that fits the mood and
    tempo, such as `"upbeat funk instrumental no copyright music"`. A product
    or launch video usually wants music; a short diagram explainer with
    narration may not. If the user says no music, send none.
  - Which part of the song: leave `startSeconds` out and the tool picks the
    strongest stretch and starts on its first beat. Set `startSeconds` when
    the user asks for a place ("from 1:05", "the intro" is 0) or when the
    result says the pick was wrong.
  - `volume` is 0 to 1. Leave it out normally; use it for "quieter" or
    "louder".
  - `fadeInSeconds` and `fadeOutSeconds` default to 0.4 and 1.5. When the
    excerpt starts on a hit, use a fade in of 0.05 so the hit is not softened.
    When it ends on the song's own stop, use a fade out of 0.2 and let the
    last sound ring into silence.
  - The user gives a range ("between 1:16 and 1:58"): that range is the outer
    limit. Start on the first clean hit inside it and end on a natural stop
    inside it, even if that trims a second from either end, and make
    `durationSeconds` the exact length between them. Decimals are fine.
  - Tracks longer than 15 minutes are refused. Mention the track title in
    your reply so the user knows what was used, and say once that music from
    YouTube may be copyrighted if the user plans to publish the video.
- Narration. Pass `narration` as lines with a start time:
  `[{ "text": "Builds now finish in 40 seconds.", "atSeconds": 1.2 }]`. Each
  line is spoken with the voice the user set up for read-aloud. Budget 2.5
  words per second plus half a second of air, keep lines under 20 words, and
  time each shot to the line it carries. The result returns each line's real
  length. If narration is unavailable the tool says why; render without it and
  tell the user. Add narration when the user asks for a voice or an explainer,
  not by default.
- Sound effects. Inside the composition, `<Audio>` from `remotion` plays a
  short effect at the frame of its `<Sequence>`. These are available:
  `https://remotion.media/whoosh.wav`, `whip.wav`, `page-turn.wav`,
  `switch.wav`, `mouse-click.wav`, `shutter-modern.wav`, `ding.wav` (same
  host). Put a quiet whoosh (`volume={0.25}`) on a big wipe or a click on a
  pressed button. A few, low in the mix. None is better than many.

## Cutting to music

A video that ignores its music feels like two things playing at once. When
music matters, measure it before you write a frame:

```json
{ "mode": "analyze_music", "music": { "url": "<link>", "startSeconds": 70 }, "durationSeconds": 60 }
```

`startSeconds` and `durationSeconds` choose the stretch to measure (the whole
track, up to four minutes, if left out). Nothing is rendered. All times in the
result are seconds into the track:

- `bpm` and `beatSeconds`: the pulse. Four beats make a bar; most music turns
  a corner every 8 or 16 beats.
- `hits`: the strongest low-end hits with their strength. Shot changes belong
  on these, preferably the strong ones a whole number of bars apart.
- `changes`: where the energy rises or falls. A big `rise` is a drop or a
  section starting: put the reveal, the title or the logo there. A `fall` to
  near silence is a break or the place the music stops: a good place to end,
  or for one held frame before the next rise.
- `rolls`: runs of fast even hits. Give each hit its own image: a flash cut,
  a word, a colour change, one per hit.
- `loudness`: one value per second. Quiet stretches get calm, sparse shots;
  loud stretches get large type, fast cuts and big camera moves.
- `character`, when present, is Breadboard's audio analyzer on the same
  stretch: key and tonal balance, useful for mood and colour.

Then build the video on that grid:

- Choose the excerpt first: start on a hit, end on a `fall` or just after a
  strong hit. Convert every time to video time by subtracting the excerpt's
  `startSeconds`, and keep those numbers as constants at the top of the file.
- Put every cut on a hit. Never cut a few frames early or late; a cut that
  lands 0.1 seconds off the beat is worse than no sync at all.
- Let things arrive on the beat, not start on it: an element that slams into
  place should finish its move at the hit, so begin it 0.2 to 0.3 seconds
  earlier with an accelerating ease.
- Give the picture a pulse: a function that is 1 on each beat and decays
  (`Math.exp(-7 * ((t - firstBeat) % beatSeconds))`) can drive a 1 percent
  scale bump, a brightness lift or a background shimmer.
- Match the shape of the music. Build during a build (things assemble, the
  camera creeps in), release on the drop (a flash, a hard cut to the brightest
  frame, the biggest type), strip back in a break, and stop when the music
  stops.
- Without an analysis, place shot changes at regular intervals so they have a
  chance of landing on the beat.

## Remotion rules

- All motion derives from `useCurrentFrame()`. CSS `transition`, CSS
  `animation`, `setTimeout`, `requestAnimationFrame` and `Date.now()` do not
  render correctly and must not be used. A frame must look the same every time
  it is rendered: no `Math.random()` (use `random("seed")` from `remotion`).
- Get `fps`, `width`, `height` and `durationInFrames` from `useVideoConfig()`.
- Animate with `interpolate(frame, [from, to], [a, b], { extrapolateLeft:
  "clamp", extrapolateRight: "clamp", easing })`. Always clamp. Use `spring({
  frame, fps, config: { damping: 200 } })` for a push with no bounce.
- Prefer the `scale`, `translate` and `rotate` CSS properties and `opacity`.
  Do not animate layout properties that reflow text.
- Structure shots with `<Sequence from durationInFrames>` or, for transitions,
  `<TransitionSeries>` from `@remotion/transitions`. Inside a sequence
  `useCurrentFrame()` starts at 0. A transition overlaps its two shots, so the
  total is the sum of the sequences minus the sum of the transitions; make
  that equal `durationSeconds * fps`.
- Use `<AbsoluteFill>` for full-frame layers.
- Load fonts with `@remotion/google-fonts/<FontName>` at module scope and pass
  only the weights and the `latin` subset you use.
- There is no asset folder. Build visuals from HTML, CSS, inline SVG,
  `@remotion/shapes` and `@remotion/paths`. `<Img>` accepts an `https` image
  URL the user provided; never guess a URL.
- Allowed imports: `react`, `remotion`, `@remotion/transitions` (and its
  presentations such as `/wipe`, `/slide`, `/fade`), `@remotion/shapes`,
  `@remotion/paths`, `@remotion/noise`, `@remotion/layout-utils`,
  `@remotion/motion-blur`, `@remotion/google-fonts/<FontName>`. Nothing else
  resolves. No network calls, no `staticFile`, no dynamic imports.

## Shape of a composition

```tsx
import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Archivo";

const { fontFamily } = loadFont("normal", { weights: ["500", "800"], subsets: ["latin"] });
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const out = Easing.bezier(0.16, 1, 0.3, 1);

// A line that rises from behind a mask.
const Line: React.FC<{ at: number; children: React.ReactNode }> = ({ at, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = interpolate(frame, [at, at + 0.5 * fps], [0, 1], { ...clamp, easing: out });
  return (
    <div style={{ overflow: "hidden" }}>
      <div style={{ translate: `0px ${(1 - t) * 105}%` }}>{children}</div>
    </div>
  );
};

// Every shot sits in a camera that keeps drifting in.
const Camera: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const push = interpolate(frame, [0, durationInFrames], [1, 1.06], clamp);
  return <AbsoluteFill style={{ scale: String(push), transformOrigin: "20% 70%" }}>{children}</AbsoluteFill>;
};

const Shot: React.FC<{ background: string; color: string; lines: string[] }> = ({ background, color, lines }) => (
  <AbsoluteFill style={{ backgroundColor: background, color, fontFamily }}>
    <Camera>
      <AbsoluteFill style={{ padding: 110, justifyContent: "flex-end" }}>
        {lines.map((line, index) => (
          <Line key={line} at={4 + index * 4}>
            <div style={{ fontSize: 210, fontWeight: 800, letterSpacing: -8, lineHeight: 0.98 }}>{line}</div>
          </Line>
        ))}
      </AbsoluteFill>
    </Camera>
  </AbsoluteFill>
);

// Two 3 second shots with a hard cut: durationSeconds is 6 at any fps.
const Video: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Sequence durationInFrames={3 * fps}>
        <Shot background="#1D4ED8" color="#F4F6FA" lines={["Builds finish", "in 40 seconds"]} />
      </Sequence>
      <Sequence from={3 * fps} durationInFrames={3 * fps}>
        <Shot background="#E7E9ED" color="#0E1014" lines={["Nothing", "to configure"]} />
      </Sequence>
    </>
  );
};

export default Video;
```

This is a skeleton for structure, not a look to copy. Design each video for its
subject.

## Tool input

```json
{
  "title": "Short video title",
  "description": "One sentence saying what the video shows.",
  "code": "import React from \"react\";\n...\nexport default Video;",
  "durationSeconds": 20,
  "fps": 30,
  "format": "landscape",
  "quality": "standard",
  "music": { "search": "upbeat funk instrumental no copyright music" },
  "narration": [{ "text": "Builds now finish in 40 seconds.", "atSeconds": 1.2 }]
}
```

- `durationSeconds` is 1 to 180, may be fractional, and must match the length
  your shots add up to.
- `fps` is 30 (default) or 60.
- `format` is `landscape` (1920 by 1080, the default), `portrait` (1080 by
  1920) or `square` (1080 by 1080).
- `quality` is `standard` by default. Use `draft` (half resolution, faster)
  only when the user asks for a quick preview.
- `music` takes exactly one of `url` (a single YouTube video) or `search`, and
  optionally `startSeconds`, `volume`, `fadeInSeconds` and `fadeOutSeconds`.
  Leave it out for a silent video.
- `mode` is `render` by default. `analyze_music` needs only `music` and
  returns the measurements described under Cutting to music.
- `narration` is up to 12 lines. Leave it out for no voice.
- `asRequested` is described under Look.

A 20 second video takes one to three minutes to render at 30 fps, about twice
that at 60. A render error quotes the bundler or browser message; the usual
causes are a wrong import path, a hook called outside a component, and shot
lengths that do not add up.

Remotion is free for individuals and for companies of up to three people.
Larger companies need a Remotion company license; say so once if the user
mentions making videos for such a company.
