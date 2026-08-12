# Video Use

Editing a video you already have — by saying what should be different about it.

`/agents:video-use` is the only runtime agent that also **selects itself**: attach
a video to a chat message that asks for it to be changed, and the edit runs
without anybody choosing an agent first. What comes back is a video artifact, and
opening that artifact opens a **studio** where further prompts keep changing the
same video.

The clone is [browser-use/video-use](https://github.com/browser-use/video-use),
at `video-use/` beside the dashboard.

---

## What it is (shape 2)

By the liveness test in `docs/ADDING_AN_AGENT.md`, video-use is a
**Breadboard-driven loop**: a `SKILL.md` and six Python helpers with no runtime,
no loop, and no way to report progress. Breadboard drives it.

What the clone actually contributes is the part that is easy to get subtly wrong:

| Clone helper | Used for | Dependencies |
| --- | --- | --- |
| `helpers/render.py` | per-segment extract → lossless concat → overlays → subtitles last → two-pass loudness | **stdlib only** |
| `helpers/grade.py` | the per-clip auto-grade analysis and the shipped presets | **stdlib only** |
| `helpers/pack_transcripts.py` | the packed phrase-level transcript the planner reads | **stdlib only** |
| `helpers/timeline_view.py` | filmstrip + waveform PNG (visual QC) | numpy, Pillow — optional |
| `helpers/transcribe.py` | ElevenLabs Scribe | `requests` — **not used**; see below |

That the render path is standard library is the fact the whole integration is
designed around: **there is no environment to build.** A Python and the ffmpeg
this repository already ships are the entire requirement, so the first edit works
on a fresh checkout with no install step and no first-run download.

`transcribe.py` is the one helper Breadboard replaces. It needs `requests`, which
would reintroduce a virtualenv for twenty lines of HTTP, so `lib/video-use/
transcript.ts` makes the identical request — same endpoint, same model, same four
options — and writes the response to the same path in the same shape. The clone's
own `pack_transcripts.py` and `render.py --build-subtitles` then read it without
knowing the difference.

**ChatMock is the model layer.** The clone's "LLM reasons" step is a Claude Code
session upstream; here it is one ChatMock call whose system prompt is read out of
the clone's own `SKILL.md` at run time, so the editing standard tracks the
checkout rather than a copy of it.

---

## The idea that makes the studio work

An edit is **a program, not a filter stack.**

Every pass replays the whole program against a retained, untouched original:

```
video-use/<userId>/<artifactId>/
  source/source.mp4          the original, written once, never replaced
  edit/
    transcripts/source.json  Scribe output, cached forever (Hard Rule 9)
    takes_packed.md          the phrase-level view the planner reads
    edl.json                 regenerated every pass
    clips_graded/            per-segment extracts
    final.mp4                what becomes the next artifact version
```

Six prompts one at a time therefore cost **one** generation of encoding rather
than six, "actually, put the intro back" is something the planner can do, and
"revert" is just an older version that still exists. A filter stack could do none
of those.

The program lives in the artifact's metadata (`videoUseProgram`), which is what
lets any surface pick the video up later:

```ts
{
  ranges: [{ start, end, reason }],   // seconds into the ORIGINAL, always
  grade: null | "auto" | "warm_cinematic" | "<validated ffmpeg chain>",
  aspect: "original" | "16:9" | "9:16" | "1:1" | "4:5",
  subtitles: "none" | "burn",
  transform: { speed, mute, volumeDb, fadeInSeconds, fadeOutSeconds, reverse },
  history: [{ version, prompt, summary, at }],
}
```

`ranges`, `grade` and `subtitles` become the clone's EDL exactly as `SKILL.md`
documents it. `transform` is applied by Breadboard in one pass afterwards,
because the clone's renderer has no field for properties of a finished piece.
`aspect` is folded **into** the grade chain rather than applied after, because
the renderer burns captions last and a later crop would cut them off.

---

## One pass

```
adopt source → probe → transcribe (cached) → pack → plan → render → publish
```

1. **Adopt.** An artifact already has a session. A video attached to a message
   becomes an artifact first, with the original as version 1 — so "revert to the
   original" is not a special case and every later prompt has a durable id to
   address. Version 1 is a byte-copy of the input, so the artifact is adopted as
   `generating` (a loading card under the turn that is producing it, not a
   finished result), and a run that ends without publishing deletes it along
   with its session. Otherwise a failed edit leaves a downloadable "result"
   identical to the video the person just attached.
2. **Probe.** ffprobe: duration, frame, fps, audio.
3. **Read.** With a key: ElevenLabs Scribe, word-level verbatim with audio events
   (Hard Rule 8), cached per source (Hard Rule 9), packed by the clone's own
   script. Without one: an ffmpeg `silencedetect` map at −30 dB over 400 ms,
   which is the clone's own guidance about where the cleanest cuts are.
4. **Plan.** One ChatMock call returning the whole revised program. A rejected
   answer gets exactly one corrected retry with the refusal quoted back. A
   *connection* that drops before the model answers is resent once, 1.5s later
   and announced on the stage line — this is the only step that leaves the
   machine and everything expensive has already happened by the time it runs.
   An HTTP error and the 3-minute timeout are not resent: both are the service
   having answered.
5. **Render.** The clone's `render.py`, called the way its own docs call it, then
   the finishing pass if the transform is not the identity.
6. **Publish.** A new version of the same artifact.

---

## Auto-use

The gate is `videoEditIntent` in `lib/video-use/identity.ts`, and it is
deliberately biased toward **no**.

- A video + "cut the dead air" → the edit runs.
- A video + "what's in this?" → an ordinary chat turn. A render nobody asked for
  costs minutes and replaces the answer they wanted.
- A video + "transcribe this and cut the filler" → the edit runs; the transcript
  is a step, the cut is the deliverable.
- `"cutting-edge"` does not contain `"cut"`. Single words match on word
  boundaries only.

**Two lists, not one.** Naming an operation ("cut", "trim", "add subtitles") is
enough on its own. Naming a *delivery format* only counts alongside a verb that
asks for one to be produced:

```
"please make this a reel format"   → make   + reel     → edit
"i want this as an instagram story"→ i want + story    → edit
"what happens in the reel?"        → reel, no verb     → question
"is this vertical?"                → vertical, no verb → question
```

That pairing exists because of a real miss. The first build knew `"for reels"`
but not `"reel"`, and knew no verb for *"make this a …"* — so "please make this
a reel format" fell through to the ordinary chat agent, which had the video in
its workspace and shell tools, spent twelve minutes reasoning its way through
ffmpeg by hand, and left the result in the user's Downloads folder. No artifact,
no studio. People name the platform, not the operation.

### Starting a run must not block the server

`videoUseHealth` gates every run, and it used to probe whether numpy and Pillow
import — a `spawnSync`, 2.4 seconds on this machine. `spawnSync` does not merely
make its caller wait; it stops the Node event loop, so for those seconds the
server could serve nothing at all, including the endpoint that stops the run.
The composer sat inert with no card and no Stop, because the run card does not
exist until the launch request resolves.

Health is now file checks only (73 ms cold, 0 ms cached). The numpy probe moved
to an async `probeVisualQc` that only the settings panel calls, and `where
python` — a spawn in its own right — is memoized. The launch request is also
bounded by a 60 s timeout, so a wedged runtime surfaces as a failed turn rather
than a composer that can never be used again.

### The selection is invisible

Every other agent renders its user turn as `<command> <task>`, because the
person typed the command. This one selects itself, so writing
`/agents:video-use …` into their message would put a command there that they
never typed — and in Super Agent mode, where no agent was chosen at all, would
misrepresent the turn outright. Each launcher passes `userContent` as the person
left it; `videoUseUserMessage` remains only as a fallback for a caller with
nothing better.

### Retry routes too

`retryMessage` re-routes a regenerated turn by parsing each agent's slash token
out of the stored message. Video Use has no token — it selects itself from the
wording — so a retry went straight past it and became an ordinary turn, and the
general agent did the edit by hand all over again. Both the composer's submit
and the retry now call one `videoUseTarget(text, attachments)` helper, so the
two cannot answer the question differently.

That helper must be declared above both callers. A `const` referenced above its
declaration throws while the component renders, which presents as a blank window
rather than an error; `tsc` catches it as TS2448 and the browser does not, so
the test asserts the ordering directly.

### Why mid-turn narration used to arrive in one lump

Not a Breadboard rendering bug, and worth writing down because the cause is
three layers away from the symptom.

`interruptible_streaming_api_call` in the Hermes agent deliberately suppresses
content streaming once a response carries tool calls — chatty "I'll use the
tool…" text interleaved with tool cards reads badly in a shared scrollback. The
CLI still receives that text through its own `stream_delta_callback`, so nothing
is lost there:

```python
if not tool_calls_acc:
    agent._fire_stream_delta(delta.content)   # both channels
elif agent.stream_delta_callback:
    agent.stream_delta_callback(delta.content)  # CLI only
```

The gateway — which is what Breadboard consumes — never registers
`stream_delta_callback`; `_agent_cbs` in `tui_gateway/server.py` does not set it.
So for a gateway consumer the second branch was a no-op: the deltas went
nowhere, `_current_streamed_assistant_text` stayed empty,
`_interim_content_was_streamed` returned false, and the commentary arrived
afterwards as `message.interim(already_streamed=False)` — one whole
`assistant.segment`, exactly the lump you see.

The suppression's reason does not apply to a gateway consumer: Breadboard seals
streamed text into its own segment at every tool boundary (that is what
`sealStreamedSegment` in `agent-runtime/hermes-events.ts` is for). So the clone
grew a third branch giving the gateway those deltas, and the three channels stay
mutually exclusive so no delta is ever emitted twice:

```python
elif agent._stream_callback:                    # gateway only
    agent._stream_callback(delta.content)
    agent._record_streamed_assistant_text(delta.content)
```

Recording it also matters: the interim that follows then reports
`already_streamed=True`, and the consumer seals its buffer instead of re-sending
the text — which is what keeps it from appearing twice. Covered by
`hermes-agent/tests/agent/test_gateway_tool_commentary_streaming.py`. Reapply
after a clone update, like the `grade.py` fix above.

### When the gate misses anyway

A phrase list will never be complete, so `renderWatchVideoContext` carries a
server-enforced output contract for turns that reach a model with a video in
play: a changed version of a video is written inside the authorized workspace
and attached with `artifact_import` (kind `video`), never to a user folder, and
is not reported as done until Breadboard returns a ready artifact. The wrong
route then costs a slower path to the same place — an artifact that opens in the
studio — rather than a loose file nobody can reopen.

The reroute happens in `dashboard-agent-terminal.tsx`, just before the ordinary
send, using the video the composer had already stored — nothing is uploaded
twice and no path ever comes from the page.

A model cannot launch this agent (`launchableByModel: false`): there is no way
for one to attach a video, so a delegated launch could only ever fail.

### A linked video is fetched by whoever needs it

Pasting a YouTube link is the commonest way to bring a video into a chat, and
neither thing that can happen next works from a URL — the Watch skill reads a
file, and the editor cuts one. So the link is fetched, once, into the same store
an attached video lives in.

**Sending is never blocked on it.** The composer hands the link over as a link
and the message goes immediately; the fetch happens where it has somewhere to be
shown:

```
"…youtu.be/abc  cut the dead air"  → the run fetches it, as its first stage,
                                      with a progress line and a stop button
"…youtu.be/abc  what's in this?"   → the turn fetches it, but only once Watch
                                      is actually selected, and only for as
                                      long as a 60s budget allows
"…youtu.be/abc  now make it 9:16"  → cache hit, nothing downloaded
```

An earlier version resolved the link in the composer, behind a "Fetching the
linked video…" status. That was wrong twice over: it made the send button lie
about what it does, and it put a progress report in the one place that cannot
show progress well. Fetching is work, and work belongs in the run.

Past the turn's budget the fetch is **not** cancelled — it keeps running and
fills the cache, so the next mention is instant; that turn simply stops waiting
and hands Watch the URL, which it already knows how to open. Both callers go
through `ensureVideoSource`, which keeps an in-flight map so two turns about the
same link at the same moment produce one download.

**Identity is the load-bearing part.** `lib/video-sources/identity.ts` reduces a
link to a source key — for YouTube the 11-character video id, via the same
`scriberr/youtube.ts` parser the Garden's video import already uses, so
`youtu.be/abc`, `youtube.com/watch?v=abc&list=…&index=7`, `/shorts/abc`,
`m.youtube.com`, and `?t=42` are **one** video. Without that, every rephrasing
would download again and an edit would work on a different file from the
question that preceded it.

A direct media link (`…/keynote.mp4`) is also a source, keyed without its query
string so a signed URL is not a second copy of the same file. Anything else — a
playlist, a channel, a page that merely mentions a video — is refused rather
than fetched on somebody's behalf.

**The download is a normal attachment.** `ensureVideoSource` puts the result in
the same per-user store an uploaded video lands in. Once the blob exists, Video
Use attaches its normal `{ type: "video", blobId, format, ... }` pointer to the
user turn that launched the run and refreshes the live transcript. The source is
therefore playable in the user message, appears in Uploads, is reused by retry,
and is protected by the ordinary attachment lifetime rules. The cache index
(`sources.json`, beside the blobs) maps source key → blob id and verifies the
file on every read, so an entry whose blob has been swept is dropped rather than
returned as a path to nothing.

yt-dlp comes from `YTDLP_PATH` first — the variable the desktop shell already
sets to its bundled copy, and the one Scriberr and Watch already read — then the
binaries in this repository, then PATH. The probe uses Scriberr's own
`buildYtdlpMetadataArgs`, so "a single video, never a playlist" has one
definition. Livestreams, videos over four hours and fetches over 2 GB are
refused before any bytes move, and the format selection caps at 1080p because
that is what gets watched and edited.

### It shares the attachment with Watch

The Watch skill also selects itself off a video attachment — for the opposite
request. The two gates partition the same input:

| Message | Takes it |
| --- | --- |
| "what's in this?", "summarise it", "describe what happens" | **Watch** — reads the video and answers |
| "cut the dead air", "trim it to 60s", "make it vertical" | **Video Use** — changes the video |

This works because Watch's own `HANDLING_ONLY` list already declines the verbs
that mean *do something to the file* (`trim`, `crop`, `cut`, `convert`, …) —
exactly the ones routed here. Video Use intercepts client-side, before the turn
is sent, so where both could fire the edit wins; that is right, because the edit
gate is the narrower of the two. `tests/video-use-agent.test.mjs` asserts the
partition directly against `watchCommandText`, so a widened list on either side
fails loudly instead of producing a render when someone asked a question.

---

## The studio

`artifact-video-studio.tsx` opens for **any** artifact whose kind is `video`,
whoever produced it — a Shorts clip, a ViMax film, a MoneyPrinter render, a video
someone attached last month. The gate is the kind, not the producer, which is
what makes it global. It is reachable from the artifact viewer, the Artifacts
panel and the inline chat cards.

It creates nothing. Generating a video is a different job with different agents
behind it; here the video exists and the only question is what changes.

In chat, a generated video remains the standard compact artifact placeholder;
it does not expand into a large player inside the assistant response. Opening
that placeholder reveals the full viewer and the Video Use editor. This is
deliberately different from a source video attachment, which stays playable in
the user message that supplied it.

Inside: the current version playing, a prompt box, live progress, what the
program currently does, and the version history with restore. Restoring brings
back that version's stored program too, so the next prompt continues from there.
`importArtifactVersion` numbers from the **highest** existing version rather than
the current one, so a new edit after a rollback cannot collide with the version
someone rolled back from.

---

## Security: a model's words become an ffmpeg filter

The EDL's `grade` is documented as "a preset name or a raw ffmpeg filter". Raw is
genuinely useful — a look *is* a filter chain — but an ffmpeg filter chain is not
inert: `metadata=print:file=…` writes a file, `movie=…` reads one, and bracket
labels rewire the graph. Handing a model's free text to `-vf` would make "make it
warmer" a file-write primitive.

`lib/video-use/filters.ts` parses the chain before it reaches the renderer:
allowlisted filter names only, no graph labels, no file arguments, a restricted
character set, and quote-aware splitting so a legitimate `curves=master='0/0 …'`
is not cut in half. A chain that fails is rejected outright, and the refusal is
shown to the planner as its one correction.

Everything in `transform` is a clamped number or a real boolean — never a string
that reaches a command line.

---

## Local patch to the clone

`helpers/grade.py` had one Windows-fatal bug. Its auto-grade analysis passes a
temp file to ffmpeg as `metadata=print:file=<abs path>`, and ffmpeg's filter
parser treats `:` and `\` as syntax — so `C:\Users\…` fails to parse and every
auto-graded render died before extracting a segment.

Fixed by passing a bare filename and running ffmpeg from that file's own
directory, which sidesteps the escaping on every platform. Three lines, in
`_sample_frame_stats`. Reapply after a `git pull` if it comes back.

Separately, the helpers print `→` in their progress lines, which raises
`UnicodeEncodeError` on a Windows console defaulting to cp1252 — so every spawn
goes through `videoUseEnv()`, which sets `PYTHONUTF8` and `PYTHONIOENCODING` and
puts ffmpeg's directory at the front of `PATH`.

---

## Setup

Nothing is required. The Agents tab → Video Use panel reports the toolchain and
takes the one optional key:

- **No key** — trims, pacing from the silence map, reframing, speed, fades,
  loudness, colour. Everything except speech.
- **ElevenLabs key** — plus filler-word and quote-level cuts, and burned-in
  captions. Stored at `.runtime/video-use/credentials.json`, outside the clone,
  never read back to the browser. The clone's own `.env` is also honoured, so a
  checkout configured by hand keeps working.

`uv sync` inside the clone additionally enables `timeline_view.py`, which is
visual QC only and never required by a run.

---

## Files

```
lib/video-sources/identity.ts  what counts as one linked video, and its key
lib/video-sources/store.ts     source key → blob id, verified on every read
lib/video-sources/download.ts  yt-dlp probe + fetch into the chat video store
lib/video-sources/resolve.ts   the one door in, with an in-flight map
lib/composer-links.ts          which characters in the composer are a link

lib/video-use/identity.ts    command, request shape, edit-intent detection
lib/video-use/filters.ts     the ffmpeg allowlist and aspect composition
lib/video-use/program.ts     the edit program, validation, EDL conversion
lib/video-use/runtime.ts     clone, python, ffmpeg, env, health
lib/video-use/session.ts     per-artifact workspace and the retained original
lib/video-use/media.ts       ffprobe and the silence map
lib/video-use/transcript.ts  Scribe, cached; packing via the clone
lib/video-use/plan.ts        the ChatMock planner, prompted from SKILL.md
lib/video-use/render.ts      render.py plus the finishing pass
lib/video-use/artifact.ts    create or version the video artifact
lib/video-use/studio.ts      what the studio reads
lib/video-use/run-manager.ts the run, its events, abort
lib/video-use/credentials.ts the optional speech key

api/video-use/runs                     POST  start an edit
api/video-use/runs/[runId]/events      GET   SSE, replays from ?since=
api/video-use/runs/[runId]/abort       POST  stop it
api/video-use/artifacts/[artifactId]   GET   studio state
api/video-use/artifacts/[artifactId]/revert  POST  restore a version
api/video-use/health                   GET   is it usable, and why not
api/video-use/setup                    POST  store or clear the speech key

components/hermes/artifact-video-studio.tsx  the studio
components/hermes/inline-video-use-run.tsx   the run card
components/agents/video-use-setup.tsx        the settings panel
```

---

## Verification status

- **Pipeline, end to end: verified.** Session, probe, silence map, plan
  validation, the clone's `render.py`, the finishing pass, and a second pass
  replaying the original — all exercised against a real 12-second source. The
  first pass produced a 1080×1920 8.03 s cut with the four-second gap removed,
  auto-graded and loudness-normalized; the second pass came back landscape,
  proving it replayed the original rather than the vertical render.
- **Linked-video fetch: verified against YouTube.** A real 10-minute video was
  probed, downloaded (148 MB in ~10 s, video and audio merged), stored as a chat
  video blob, found again through `findVideoBlob`, and resolved from the cache
  for every alternative spelling of its URL. Per-user isolation and stale-entry
  invalidation were exercised too. Separately, two concurrent `ensureVideoSource`
  calls for the same video were confirmed to produce one download and one file.
- **Model step: stub-verified.** ChatMock was not running on this machine, so the
  planner ran against a local server speaking the same `/v1/chat/completions`
  protocol. The prompt was asserted to carry the clone's own craft, the silence
  map and the instruction. A live ChatMock run has not been made.
- **Chat and studio UI: not yet exercised against a running dashboard.** The
  wiring is covered structurally by `tests/video-use-agent.test.mjs` and the
  shared `tests/external-agent-persistence.test.mjs`.
