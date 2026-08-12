# HyperFrames video agent

`/agents:hyperframes` turns a sentence into a rendered MP4. It is a runtime
agent in the Agents palette, alongside Codex, Agent Browser, Deep Research,
Parametric CAD and the rest, and it answers on the model picked in chat.

```text
Terminal / Garden chat
        |
  /agents:hyperframes <brief>
        |
  POST /api/hyperframes/runs
        |
  scaffolded HyperFrames project  (dashboard/hyperframes-runs/<runId>/project)
        |
  codex exec --json  (working directory = that project)
        |
  ChatMock /v1/responses      +      hyperframes CLI → ffmpeg → MP4
```

## Why it is built this way

The cloned `hyperframes/` is **a rendering framework, not an agent**. It ships a
CLI (`init`, `lint`, `check`, `render`) and 19 markdown skills that teach a
coding agent how to author a composition. There is no process to wrap, so
Breadboard supplies the missing half — a Codex process pinned to ChatMock — and
leaves the video knowledge where upstream put it: the run prompt points at
`hyperframes/skills/hyperframes/SKILL.md` by absolute path and the agent reads
it. Pulling the clone upgrades the agent.

## Using it

Open the capability palette, choose **Agents**, then `/agents:hyperframes`. The
command carries the whole brief — no agent chip, no second message:

```text
/agents:hyperframes a 15-second explainer of how a heat pump moves heat, dark background, one idea per beat
```

The card shows the build stage by stage, then plays the rendered video inline
with a download link. The composition source and every other file the project
produced are listed underneath. A finished video keeps playing in the transcript
after a restart: the workspace stays on disk and the card re-reads it.

## What the agent may and may not do

The run prompt (`src/lib/hyperframes/prompt.ts`) owns the rules the skills
cannot know:

- **No interview.** The skills' intent layer asks the person questions; nobody
  is there. The agent decides instead and lists its assumptions in the answer.
- **No `npx hyperframes@latest`.** A `hyperframes` shim is written into the run
  directory and put first on PATH, so the pinned CLI is the one a model can
  reach by name. The scaffold's own `package.json` scripts are rewritten to the
  same binary — `hyperframes init` writes them as `npx --yes hyperframes@0.7.94
  …`, and the first real run showed the agent reaching for `npm run check`
  before a bare command. `dev` (`preview`) and `publish` are dropped from that
  file: one never exits, the other uploads the video to a hosted service.
- **Nothing long-running.** `preview`, `play`, `present` and `studio` never
  exit; one of them would end the run with nothing to show.
- **Deterministic and offline.** No render-time fetches, no `Date.now()`, no
  unseeded `Math.random()` — the renderer seeks frame by frame.
- **Done means rendered.** `lint`, then `check`, then `render --output
  out/video.mp4`, then a plain-language answer.

The same text is appended to the project's own `AGENTS.md`, under upstream's.

## The toolchain

Three things are not bundled. Each resolves from an environment variable first,
then from something already installed. The gear beside the palette entry opens a
panel that reports all of them.

| Piece | Resolution order | Blocking |
| --- | --- | --- |
| HyperFrames CLI | `HYPERFRAMES_BIN` → built clone (`packages/cli/dist`) → Breadboard's npm prefix (`dashboard/hyperframes-cli`) → `hyperframes` on PATH | yes — the panel installs it, pinned to the clone's own version |
| ffmpeg / ffprobe | `HYPERFRAMES_FFMPEG_PATH` → `agent-reach/.tools/bin` → PATH | yes — the CLI has no install path for it |
| Chromium | `HYPERFRAMES_BROWSER_PATH` → installed Chrome or Edge | no — the CLI downloads a headless shell on first render |
| Coding runtime | `CODEX_BIN` → built `codex/` clone → `codex` on PATH | yes |

Reusing Agent Reach's portable ffmpeg and the system Edge is deliberate: a
working install needs no admin rights and no second copy of anything.

Every spawn also carries `HYPERFRAMES_SKIP_SKILLS=1`,
`HYPERFRAMES_NO_UPDATE_CHECK=1` and telemetry off. Without the first,
`hyperframes init` reaches GitHub and writes skills into the user's *global*
`~/.claude/skills`.

## Files

| Path | What it is |
| --- | --- |
| `dashboard/src/lib/hyperframes/runtime.ts` | Resolving the CLI, ffmpeg, browser and skills; the spawn environment; the PATH shim |
| `dashboard/src/lib/hyperframes/workspace.ts` | Scaffolding a project, scanning its outputs, containment-checked reads |
| `dashboard/src/lib/hyperframes/prompt.ts` | The operating rules and the pointer at the clone's skills |
| `dashboard/src/lib/hyperframes/run-manager.ts` | The Codex process, its event stream, stages and artifacts |
| `dashboard/src/lib/hyperframes/setup.ts` | Toolchain status and the pinned CLI install |
| `dashboard/src/app/api/hyperframes/*` | `health`, `runs`, `runs/[id]/events`, `abort`, `artifacts`, `setup` |
| `dashboard/src/app/components/hermes/inline-hyperframes-run.tsx` | The run card, including the inline player |
| `dashboard/src/app/components/hermes/hyperframes-settings-dialog.tsx` | The setup panel |
| `dashboard/tests/hyperframes-agent.test.mjs` | Command grammar, prompt rules, workspace containment, wiring |

## Storage and safety

- Workspaces live in `dashboard/hyperframes-runs/<runId>/` and are **not**
  deleted when the run ends — the video is the deliverable. Both that directory
  and `dashboard/hyperframes-cli/` are gitignored.
- Ownership is recorded in `owner.json` inside the workspace, so the artifact
  routes still authorise a run whose in-memory state is gone.
- Artifact ids encode a relative path and are re-checked for containment before
  a file is opened.
- Video is served with byte ranges so the player can seek. The composition HTML
  is served as `text/plain` with `nosniff`: it is model-authored markup, and
  serving it as HTML on the dashboard's origin would let a generated page run
  scripts against the signed-in session.
- On Windows the Codex process runs with `danger-full-access`, for the same
  reason the Codex agent does: the native CLI exposes `workspace-write` as
  read-only unless its elevated sandbox is installed, and an agent that cannot
  write the composition cannot make a video. It is launched in the run's own
  workspace, but the working directory is not an OS boundary.

## Verified

On Windows 11 with the clone at `hyperframes/` (CLI 0.7.94), Agent Reach's
ffmpeg and system Edge.

**Toolchain:** CLI install into Breadboard's prefix, project scaffold, `lint`,
`check`, and a real `render` — a 10-second 1920×1080 MP4 in 29 s.

**A full agent run**, `cliproxy/claude-sonnet-5` through ChatMock, brief "a
5-second title card: 'Breadboard' fades up in white on deep green with a thin
gold line sweeping in underneath", 204 s end to end. The agent read the router
skill out of the clone, routed itself to `/motion-graphics`, read that skill and
`/hyperframes-core`, wrote the composition, failed `check` on two motion issues,
fixed both, passed, rendered a 123 KB MP4, and answered in plain language with
the colours and timings it chose. The run manager reported every stage, the
artifact list, `render.completed`, and token usage.

Not yet exercised: the browser auto-download path (a Chromium was always
present), and the desktop build's service definitions.

## Known limits

- **Stop kills the agent, not its grandchildren.** `abortRun` kills the Codex
  process; a `hyperframes render` it had already started keeps its own Chrome
  workers until they finish. Same limitation as the Codex agent.
- **Workspaces are never pruned.** Every run keeps its project and its renders.
  Deleting `dashboard/hyperframes-runs/<runId>/` is safe — the transcript keeps
  the summary and the card simply stops offering the video.
- **One run at a time is not enforced.** Two concurrent builds each get their
  own workspace, but they share the machine's CPU, and a render uses all of it.
