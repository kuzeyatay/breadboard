# OpenMontage production agent

`/agents:openmontage` turns a sentence into a produced video — not a rendered
animation, but a run through a real production pipeline: pick the pipeline,
write the brief and the script, plan the scenes, source or generate the assets,
cut the edit, render, and report what it chose along the way.

```text
Terminal / Garden chat
        |
  /agents:openmontage <brief>
        |
  POST /api/openmontage/runs
        |
  codex exec --json   (working directory = the OpenMontage clone)
        |                      |
  ChatMock /v1/responses       OPENMONTAGE_PROJECTS_DIR
                               = dashboard/openmontage-runs/<runId>/projects
                                       |
                        project.json · checkpoint_<stage>.json
                        decision_log.json · assets/ · renders/final.mp4
```

## Why it is built this way

The cloned `OpenMontage/` is **a production system with no orchestrator**.
Upstream is explicit about it: *"The AI agent IS the intelligence. Python exists
only for tools and persistence."* What ships is 102 Python tools, 13 pipeline
manifests in `pipeline_defs/`, and a library of stage-director and meta skills —
plus `AGENT_GUIDE.md`, which is written to be read by whatever coding assistant
you point at the repository. There is no `openmontage run` to wrap.

So Breadboard supplies the missing half — a Codex process pinned to ChatMock,
exactly as [`/agents:hyperframes`](HYPERFRAMES_INTEGRATION.md) does — and leaves
the production knowledge where upstream put it. The run prompt points at
`AGENT_GUIDE.md` and the agent reads it. Pulling the clone upgrades the agent.

This is the shape-2 answer from [ADDING_AN_AGENT.md](ADDING_AN_AGENT.md): the
clone has no entry point you can execute and no loop that runs without a human.

## Where a production lives

`lib/paths.py` reads **`OPENMONTAGE_PROJECTS_DIR`**, and upstream calls it "the
most load-bearing path in the system" — every checkpoint, artifact and project
marker follows it. Breadboard points it at a per-run directory, so:

- the agent's working directory is the clone, and it reads instructions by the
  relative paths the guide actually documents;
- nothing a production writes lands in the clone's working tree, which is shared
  with every other run.

`python` and `ffmpeg` are put on the front of the run's PATH so the bare names
every skill and tool docstring uses resolve to the interpreter that has the
dependencies and the ffmpeg that is actually on this machine.

## The one thing that would otherwise stall every run

OpenMontage's Decision Communication Contract is written for a person at a
terminal: present the options, **wait for explicit approval**, then continue. In
a Breadboard run the person wrote one brief and left.

Lifting that is not a matter of telling the agent to skip the wait, because the
gate is **enforced in Python**. `lib/checkpoint.py` refuses to write a stage with
`human_approval_default: true` as `completed` unless it is passed
`human_approved=True`, and the error it raises instructs the agent to write
`awaiting_human` and *end its turn*:

```text
GATE VIOLATION: stage 'idea' requires human approval … Correct protocol: write
status='awaiting_human', present the artifact summary to the user, END YOUR
TURN, and only after the user approves re-write with status='completed'.
```

An agent that obeys that stalls at the first stage with nothing to show. So the
run prompt tells it to pass `human_approved=True` together with
`metadata={"approved_by": "breadboard-autonomous-run"}` — the gate is lifted, and
the audit trail says who actually lifted it rather than claiming a person did.

**The approval gates are lifted; the approval record is not.** The agent still
logs every choice to `decision_log.json` with its real `options_considered` and
a `reason`, because in a chat run that log is the person's only account of which
provider, runtime and treatment were picked and why. The run card renders it.

## What the card shows, and where it comes from

Nothing in the card asks the agent to report progress. Every field is read from
files upstream already writes:

| Card element | Source |
| --- | --- |
| Title, pipeline | `project.json` (`title`, `pipeline_type`) |
| Stage rail | the pipeline's own `stages:` in `pipeline_defs/<type>.yaml` |
| Stages done | which `checkpoint_<stage>.json` files exist |
| The choices it made | `decision_log.json`, latest entry per (category, subject) |
| The video, the files | a scan of the run's projects directory |

The rail comes from the manifest rather than the canonical nine stages because
every pipeline uses a subset — `documentary-montage` runs `idea → scene_plan →
assets → edit → compose` and has no `research` stage at all, so a canonical rail
would promise steps the video never takes. Superseded decisions are marked, not
hidden, which is upstream's own rule: the log is append-only and the latest entry
for a (category, subject) pair is the current one.

## What it can actually make here

`video_compose` — the thing that turns a plan into a video — needs ffmpeg. The
tool registry is the honest measure, and the settings panel reads it live:

| Toolchain | Tools available |
| --- | --- |
| Python + dependencies only | 14 of 102 |
| **+ ffmpeg** | **34 of 102** — the whole edit/compose spine |
| + provider keys | more per key |

With no API keys OpenMontage still makes a real video: stock footage, free music,
local subtitle generation, ffmpeg composition. Keys in `OpenMontage/.env` unlock
AI image, video and voice generation. The prompt tells the agent up front which
keys exist, so it does not plan a Veo shoot it cannot execute.

**ChatMock cannot stand in for the image and video providers.** Those tools call
`client.images.generate` and the like; ChatMock serves no `/v1/images` endpoint.
This is the same finding as [ViMax](../dashboard/src/lib/vimax): the model layer
is shared, the media providers are not.

## The toolchain

| Piece | Resolution order | Blocking |
| --- | --- | --- |
| Clone | `OPENMONTAGE_ROOT` → `OpenMontage/` beside the dashboard | yes |
| Python | `OPENMONTAGE_PYTHON` → the clone's `.venv` → PATH | yes — the panel builds the venv and installs `requirements.txt` |
| ffmpeg/ffprobe | `OPENMONTAGE_FFMPEG_PATH` → `agent-reach/.tools/bin` → `desktop/node_modules/ffmpeg-static` → PATH | yes |
| Remotion | `remotion-composer/node_modules` | no — the panel installs it; the ffmpeg path renders without it |
| Coding runtime | `CODEX_BIN` → built `codex/` clone → `codex` on PATH | yes |

Reusing Agent Reach's portable ffmpeg is deliberate: a working install needs no
admin rights and no second copy of anything. The venv is created with `uv` when
present (with `UV_LINK_MODE=copy`, which is not optional — the repository sits in
a OneDrive folder where uv's default hardlinking fails), and plain `venv` + `pip`
otherwise.

Every spawn carries `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`. The tool
registry ships its own ASCII scrubber for cp1252 consoles; asking for UTF-8 is
the fix rather than the workaround.

## Files

| Path | What it is |
| --- | --- |
| `dashboard/src/lib/openmontage/runtime.ts` | Resolving the clone, Python, ffmpeg, Node, Remotion; the spawn environment |
| `dashboard/src/lib/openmontage/workspace.ts` | Per-run projects directory, ownership, reading the production's own state, containment-checked artifact reads |
| `dashboard/src/lib/openmontage/prompt.ts` | The operating rules — the non-interactive override and the decision-log obligation |
| `dashboard/src/lib/openmontage/run-manager.ts` | The Codex process, its event stream, production polling, artifacts |
| `dashboard/src/lib/openmontage/setup.ts` | Toolchain status, the live tool count, the two installs |
| `dashboard/src/app/api/openmontage/*` | `health`, `runs`, `runs/[id]/events`, `abort`, `artifacts`, `setup` |
| `dashboard/src/app/components/hermes/inline-openmontage-run.tsx` | The run card: stage rail, decisions, inline player |
| `dashboard/src/app/components/hermes/openmontage-settings-dialog.tsx` | The setup panel |
| `dashboard/tests/openmontage-agent.test.mjs` | Command grammar, prompt rules, workspace containment, state reading, wiring |

## Storage and safety

- Workspaces live in `dashboard/openmontage-runs/<runId>/` and are **not**
  deleted when the run ends — the video is the deliverable. Gitignored, along
  with the clone's `.venv`, `projects/` and Remotion install.
- Ownership is recorded in `owner.json` inside the workspace, so the artifact
  routes still authorise a run whose in-memory state is gone after a restart.
- Artifact ids encode a relative path and are re-checked for containment before
  a file is opened.
- Video is served with byte ranges so the player can seek. Everything that is
  not video, image or audio — and SVG, which is an image by extension and a
  script host by capability — is served as `text/plain` with `nosniff`: those
  files are model-authored, and serving them as themselves on the dashboard's
  origin would let generated markup run against the signed-in session.
- Setup installs are user-triggered only, with a fixed argv and an action name
  matched against a closed set. A run never installs anything.
- On Windows the Codex process runs with `danger-full-access`, for the same
  reason the Codex and HyperFrames agents do: the native CLI exposes
  `workspace-write` as read-only unless its elevated sandbox is installed. The
  working directory is the clone, and writes are steered out of it by
  `OPENMONTAGE_PROJECTS_DIR` and by the prompt — but a working directory is not
  an OS boundary.

## Verification status

Verified live on 2026-08-06, against the real cloned code:

- the venv builds and `requirements.txt` installs; the registry reports **34 of
  102** tools available with ffmpeg resolved, 14 without;
- upstream's `lib/paths.py` honours the run's `OPENMONTAGE_PROJECTS_DIR`;
  `init_project` and `write_checkpoint` write into the per-run workspace;
- the approval gate rejects a completed stage without `human_approved=True`, and
  accepts it with the metadata the prompt specifies — this is how the stall was
  found and fixed;
- the resolved ffmpeg renders a real MP4, and the card's reader picks
  `renders/final.mp4` over the larger clips in `assets/`;
- the production reader parses the real `project.json`, checkpoints and
  `decision_log.json`, and reads the stage rail out of the real manifest;
- the run manager creates the workspace, records ownership, emits `run.started`
  with the resolved toolchain, spawns, handles a non-zero exit as `run.failed`,
  fires the terminal handler once, refuses a second abort, and refuses a
  cross-user read.

**Not verified:** a full live production, because Codex is not installed or
built on this machine (no binary, no Rust toolchain) — the same gap blocks
`/agents:hyperframes`. The Codex spawn arguments, the ChatMock provider block and
the JSONL ingest are copied verbatim from the HyperFrames agent, which was
verified live. Install Codex or set `CODEX_BIN` and the run completes the loop.
