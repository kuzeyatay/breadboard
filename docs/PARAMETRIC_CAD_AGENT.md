# Parametric CAD Agent — architecture and implementation plan

The Parametric CAD Agent turns a natural-language request for a physical part
into a **dimensionally accurate, editable, 3D-printable** solid: the model reads
intent, writes parametric CadQuery source, a local Python service executes that
source through OpenCascade, deterministic validation checks the resulting solid,
and only a validated solid is exported and published as a Breadboard artifact.

It is not a text-to-mesh generator. STL is an export, never the source of truth;
the CadQuery program plus its parameter set is the canonical design.

---

## 1. Repository audit (what already exists, and what this extends)

| Concern | Where Breadboard already solves it | How the CAD agent uses it |
| --- | --- | --- |
| Runtime-agent registration | `dashboard/src/lib/hermes/capability-combinations.ts` (`RUNTIME_AGENT_PROFILES`) | Adds a `parametric-cad` profile; combination conflicts are then reported by the existing shared rules |
| Slash-command identity | `dashboard/src/lib/<agent>/identity.ts` (e.g. `hardware/identity.ts`) | `dashboard/src/lib/cad/identity.ts`, `/agents:parametric-cad` |
| Capability palette | `dashboard/src/app/components/hermes/command-hub.tsx` | New `onSelectParametricCad` row, same shape as Hardware Blueprint |
| Composer token insert | `dashboard/src/app/components/assistant-composer.tsx` | `insertCommandToken(PARAMETRIC_CAD_COMMAND)` |
| Chat dispatch (Terminal) | `dashboard/src/app/components/hermes/dashboard-agent-terminal.tsx` | `routeParametricCadCommand` → `POST /api/cad/runs` |
| Chat dispatch (Garden) | `dashboard/src/app/gardens/[clusterSlug]/workspace-client.tsx` | `launchParametricCad`, same route |
| Durable transcript runs | `dashboard/src/lib/conversations/external-agent-runs.ts` | New `parametric_cad` run kind + `parametricCadRun` message field |
| Run + SSE contract | `dashboard/src/lib/hardware/run-manager.ts` + `api/hardware-blueprint/runs/[runId]/events` | Same in-memory run manager and `id:/event:/data:` SSE envelope |
| Artifacts | `dashboard/src/lib/hermes/artifact-store.ts`, `artifact-renderers.ts`, `artifact-types.ts` | New `parametric-cad` renderer id; the manifest JSON is the artifact source; `updateArtifactContent({mode:"fork"})` gives immutable revisions |
| Artifact rendering UI | `dashboard/src/app/components/hermes/artifact-viewer.tsx` | New branch → `ParametricCadArtifact` (three.js, already a dashboard dependency at `three@0.185.1`) |
| Authenticated downloads | `api/hermes/artifacts/[artifactId]/download` | Same auth helpers (`requireUserId`) for `api/cad/projects/.../files/...`; no client-supplied paths |
| SQLite schema | `dashboard/src/lib/db.ts` + per-feature `ensure*Schema` | `dashboard/src/lib/cad/schema.ts` → `ensureCadSchema(db)` |
| Model access | `dashboard/src/lib/hardware/model-client.ts`, `agent-browser/run-manager.ts` | ChatMock (OpenAI-compatible) tool loop; provider is never hardcoded — the caller passes the selected model |
| Loopback sidecars | `gbrain-adapter`, `ui-tars-adapter`, `voicebox` + `desktop/src/main/service-definitions.ts` | `cad-service/` is a supervised loopback Python sidecar with a per-launch secret |
| Dev launchers | `scripts/start-*.mjs`, `scripts/dev-all.mjs` | `scripts/start-cad.mjs`, `scripts/setup-cad.mjs` |
| Safety framing | `dashboard/src/lib/hardware/safety.ts` | `dashboard/src/lib/cad/safety.ts`, same three-level decision shape |
| Tests | `dashboard/tests/*.test.mjs` run by `node --test --experimental-strip-types` | `dashboard/tests/parametric-cad-*.test.mjs`; Python tests via `unittest` |

Deliberately **not** reused: the MCP path. `unified-tool-registry.ts` resolves
*installed MCP servers and brokered connected apps* — third-party surfaces with
OAuth and approval flows. The CAD tools are first-party, deterministic, and
belong to one agent's own pipeline, exactly like the Hardware Blueprint
compiler. They are typed tool functions executed by Breadboard's own server
(`dashboard/src/lib/cad/tools.ts`) and exposed to the model as OpenAI function
tools. That is the established local-runtime abstraction here; adding an MCP
server would introduce a competing protocol for a capability that never leaves
the machine.

## 2. Component map

```
cad-service/                       Python 3.12 loopback sidecar (CadQuery + OCP)
  breadboard_cad/
    server.py                      ThreadingHTTPServer on 127.0.0.1, bearer auth
    executor.py                    per-execution temp dir, timeout, tree kill, caps
    worker.py                      child process that actually runs generated code
    guard.py                       AST allowlist/denylist, checked before spawning
    cadquery_engine.py             the one engine implementation today
    engine.py                      CadEngine protocol (build123d can be added here)
    validation.py                  deterministic geometry/printability checks
    models.py                      pydantic request/response models

dashboard/src/lib/cad/
    identity.ts   types.ts   schemas.ts   defaults.ts   safety.ts   errors.ts
    schema.ts        SQLite: cad_projects, cad_revisions, cad_revision_files
    blob-store.ts    Breadboard-controlled file storage, atomic + sha256
    project-store.ts revisions, parameter diffs, restore
    service.ts       loopback client + health
    tools.ts         the seven CAD tool contracts
    prompts.ts       the agent's system prompt
    model-client.ts  ChatMock tool loop with the bounded repair budget
    artifact.ts      publish / fork a revision as an artifact
    run-manager.ts   the run pipeline and its lifecycle events
    board-enclosures.ts  Hardware Blueprint → CAD hand-off

dashboard/src/app/api/cad/…       runs, events, abort, health, files, parameters
dashboard/src/app/components/cad/ artifact renderer (three.js viewer, panels)
```

## 3. Execution boundary

Generated Python never runs inside Next.js, Electron, or the CAD HTTP server
process. Each execution:

1. is AST-checked in the server process (imports, calls, attributes, dunders),
2. is written into a fresh temp directory that is the process's only writable
   area,
3. runs in a **separate** `python -m breadboard_cad.worker` process with a
   scrubbed environment (`PATH`, `SystemRoot`, `TEMP` only — no secrets),
4. is killed as a whole process tree on timeout (`taskkill /T /F` on Windows,
   process group kill elsewhere),
5. has stdout/stderr and result size capped,
6. writes results only under its own workdir, and every produced path is
   re-normalized and containment-checked before the service reads it.

This is a defence-in-depth boundary, **not** a security sandbox. See
"Security model" in the developer documentation for the residual risks.

## 4. Agent loop

```
interpret request
  → design spec (structured, versioned)
  → create/load project
  → generate or update CadQuery source
  → execute (isolated)
  → validate (deterministic)
  → repair (bounded: at most 3 model generations per user turn)
  → export (STEP, STL, GLB, 3MF, source, spec, report)
  → publish artifact revision
```

The agent may call the part "validated" only after `cad_validate_model` returns
`passed`. A generated program is not a validated part, and the system prompt and
the run summary both say so.

## 5. Revisions

Every accepted build is an immutable revision row plus an immutable file set,
and forks a new artifact version. A failed regeneration never overwrites the
last valid revision: the project's `current_revision` only advances when the new
revision reaches `valid` or `valid-with-warnings`.

## 6. Out of scope for this MVP

Assemblies with mates, FEA, topology optimization, CAM, Fusion integration,
slicer profiles, involute gear engineering, production thread profiles, and any
cloud CAD service. The `CadEngine` protocol and the tool contracts are shaped so
these can be added without changing the artifact schema.
