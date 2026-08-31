# Classroom (OpenMAIC)

`/agents:classroom` turns a topic — or the documents attached to the message —
into an interactive classroom: a lesson outline, then slides taught by an AI
teacher with peers, quizzes with grading, HTML simulations, and project-based
activities, opened as a live lesson in the chat and filed as an artifact of it.

The runtime is [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC),
cloned at `openmaic/`. Breadboard drives it; it does not reimplement it.

---

## What shape this is, and why

`docs/ADDING_AN_AGENT.md` names three shapes. This is a **wrapped runtime**,
and the liveness test is clear-cut: OpenMAIC is one Next.js app in which the
generation pipeline, the classroom player and the editor are the same program,
and it already exposes the generation headlessly:

```
POST /api/generate-classroom          → 202 { jobId, pollUrl, pollIntervalMs }
GET  /api/generate-classroom/[jobId]  → { status, step, progress, message,
                                          scenesGenerated, totalScenes, result, error, done }
GET  /api/classroom?id=               → { id, stage, scenes, createdAt }
GET  /classroom/[id]                  → the player
```

`result.classroomId` names a JSON file under the server's own `data/classrooms/`,
and the player reads it from there. Nothing in the clone knows about Breadboard.

It also speaks OpenAI-compatible HTTP. `OPENAI_BASE_URL` + `OPENAI_API_KEY` +
`OPENAI_MODELS` + `DEFAULT_MODEL=openai:<model>` point it at ChatMock, with
`OPENAI_COMPAT_USE_STREAMING_CHAT=true` keeping it on `/v1/chat/completions`,
which every ChatMock provider serves. ChatMock is the only model layer: the
server's environment is built from a short allowlist rather than inherited, so a
vendor key in the dashboard's `.env.local` cannot quietly enable a provider
inside OpenMAIC.

One consequence worth stating plainly: **the runtime is the whole app.** A
classroom link is a page on that server, so it is started lazily on the first
run and then left up, and a saved link goes through Breadboard
(`/api/classroom/classrooms/<id>`) which finds the running server — or restarts
it on its last settings — and redirects there. The port is chosen at start, so a
link straight to it would die with the next restart.

---

## Setup: a Breadboard-owned copy, and one fix

Nothing runs from the checkout. Setup (`lib/classroom/setup.ts`, from the
button in the settings dialog only) copies the source into
`<data>/runtime-v2/toolchains/openmaic/`, installs its dependencies with pnpm
through corepack, builds the app, and swaps the copy into place. The checkout
stays exactly as cloned, which is what keeps `git pull` a fast-forward.

Two things about that took reading the clone and the machine to establish:

1. **pnpm is not on PATH here, and the clone's postinstall calls a bare
   `pnpm`** for every workspace package. corepack is next to Node, so setup
   writes a `pnpm` shim into `<toolchains>/openmaic-tools/` that forwards to
   `node corepack.js pnpm`, and puts that directory first on the install's PATH.
   The install and build themselves also run through corepack's JavaScript entry
   with `process.execPath`, never a `.cmd` shim — a `.cmd` cannot be spawned
   without a shell on current Node, and a shell is a quoting hazard an install
   does not need.

2. **The `@openmaic/importer` build fails on this machine.** Its rollup config
   uses `rollup-plugin-node-globals`, which inlines each module's `__dirname` as
   a path relative to `/`. Here that is `\Users\20252082\...`, and `\2` is an
   octal escape the parser refuses ("Octal literal in strict mode"). The fix is
   one option — `globals({ baseDir: process.cwd() })` — which keeps the inlined
   paths relative and digit-free. It is applied to the copy, on Windows only,
   by `applyImporterBuildFix`, and it is worth sending upstream. A `subst`
   drive letter does **not** work around it: pnpm's junctions resolve back to
   the real path.

OpenMAIC keeps its state — classrooms, jobs, usage — under `process.cwd()/data`,
and the server runs with the runtime copy as its cwd. The copy is replaced
wholesale by a rebuild, so `data` inside it is a **junction** to
`<data>/openmaic-data/` (`OPENMAIC_DATA_DIR`), made by setup and re-made at
start. The first rebuild deleted the only classroom along with the old runtime,
which is how that rule was learned.

Two more, learned building it: pnpm lays out `node_modules` with junctions
whose targets are absolute, so a tree installed in staging and renamed into
place points at a directory that no longer exists — the install and build run at
the final path, with the previous runtime kept beside it until the new one has
built. And the standalone trace copy warns about `[externals]_node:*` chunk
names on Windows; `next start` does not use the standalone output, so it is
noise.

`corepack` is found next to `process.execPath`; in the packaged desktop app that
is Electron's binary, so setup there needs a Node on the machine and reports so.

---

## Driving a run

`lib/classroom/run-manager.ts` owns what the clone cannot know by itself:

- **the model** — the chat's, through ChatMock (`resolveChatmockBaseUrl`);
- **the material** — document and pasted-text attachments become
  `pdfContent.text` (up to 400k characters, each under its own heading) and
  image attachments become `pdfContent.images`. The field is the clone's name
  for it; it reads it the same way whatever the file was;
- **the chat** — the brief is `promptWithContext(brief, conversation)` so "make
  a lesson out of that" resolves;
- **the conversation** — captured at launch, so the finished classroom is filed
  as an artifact (kind `data`, the classroom JSON) of the chat that asked, under
  the assistant turn that ran it.

The run is one job: POST, then poll on the server's own `pollIntervalMs`
(clamped to 2–15 s), turning each change of step/progress/scene count into a
`classroom.progress` event. Five consecutive failed polls fail the run; 45
minutes fails it. **A stop ends the polling and says so** — OpenMAIC has no
route to cancel a job — and a classroom that finishes anyway stays on disk where
the link route can still find it; it is simply not filed.

Flags typed in the message win over stored defaults, and every toggle has both
spellings (`--tts`/`--no-tts`, `--images`/`--no-images`,
`--search`/`--no-search`, `--mode default|generate`) because a stored
"narrate everything" needs to be sayable off in one message.

---

## What the chat gets

- A card that names the phase — starting the server, writing the outline,
  building the scenes, recording narration — with a progress bar and the
  scene count, and a Stop.
- The classroom framed in the card once it is ready, on OpenMAIC's own origin
  with scripts and its own player, reached through the link route so a
  reopened card still finds it. The server's CSP is opened to loopback origins
  (`ALLOWED_FRAME_ANCESTORS=http://127.0.0.1:* http://localhost:*`) because the
  dashboard's port is chosen per launch.
- A summary linking the classroom, which is also how a reopened card learns
  which classroom it was: `classroomIdFromText` reads the id back out of the
  saved link.
- The lesson JSON as an artifact of the conversation.

---

## Not wired, and why

- **Narration and images** need a TTS or image provider OpenMAIC can reach.
  Voicebox has no OpenAI `/v1/audio/speech` yet and ChatMock has no
  `/v1/images/generations`, so both are off by default; a loopback bridge like
  `lib/wardrobe/bridge.ts` would turn them on. OpenMAIC's `/api/health` still
  reports `imageGeneration: true`, because an `OPENAI_API_KEY` alone counts as
  an image provider there; its image base URL falls back to `OPENAI_BASE_URL`,
  so a run with `--images` fails against ChatMock locally rather than calling
  api.openai.com with the placeholder key.
- **Transient provider failures** surface as OpenMAIC retrying scene content
  ("Retrying scene 1/2 content (4/6): undefined") and, after six tries, a run
  that fails with "No scenes were generated". Seen once between two clean
  runs on the same model; the retry is OpenMAIC's, the run card reports the
  final failure, and running the lesson again is the fix.
- **Web search** needs one of OpenMAIC's search providers (Tavily, Brave,
  SearXNG…); off by default.
- **Runtime V2.** The run executes in the dashboard process — the shape
  `docs/ADDING_AN_AGENT.md` documents — rather than in a fixed Runtime V2
  worker. `run-manager.ts` already exposes the worker entrypoints
  (`startRuntimeWorkerRun`, `getRuntimeWorkerEventsSince`, …); the cutover is
  a facade change plus the worker manifests in `native/`.

---

## Files

```
lib/classroom/identity.ts    command, id, name, parser, flags, open path
lib/classroom/runtime.ts     clone and toolchain discovery, availability
lib/classroom/client.ts      typed access to the clone's three routes
lib/classroom/service.ts     the supervised `next start`, its environment
lib/classroom/run-manager.ts the job loop, events, summary, artifact filing
lib/classroom/artifact.ts    the classroom JSON as an artifact
lib/classroom/setup.ts       copy, fix, install, build, swap
api/classroom/{runs, runs/[runId]/{events,abort}, health, setup, classrooms/[classroomId]}
components/hermes/inline-classroom-run.tsx
components/hermes/classroom-settings-dialog.tsx
tests/classroom-agent.test.mjs
```

Registry entries: `EXTERNAL_AGENT_RUN_KINDS`, `EXTERNAL_AGENT_ABORT_BY_KIND`,
`RUNTIME_AGENT_PROFILES` (`acceptsAttachments`), `RUNTIME_AGENT_BRIEFS`,
`CONFIGURABLE_AGENTS`.

---

## Drift

Neither half imports the other, so nothing would fail to compile if upstream
renamed a route or a field — the run would simply stop working.
`tests/classroom-agent.test.mjs` reads the clone and asserts the parts this
integration stands on: the three routes and the fields read off them, the
classroom's storage path and URL, the environment variables the model layer
rides on, and that the importer's rollup config still has the `globals()` call
the Windows fix rewrites.
