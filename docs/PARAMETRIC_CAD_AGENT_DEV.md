# Parametric CAD Agent — developer documentation

The agent turns a described physical part into a dimensionally accurate,
editable, 3D-printable solid. The model reads intent and writes parametric
CadQuery source; a local Python service executes that source through
OpenCascade; deterministic validation measures the resulting solid; only a
validated solid is exported and published.

STL is an export. The CadQuery program plus its parameter set is the design.

---

## 1. Architecture

```
chat surface                    dashboard/src/app/components/hermes/
  /agents:parametric-cad          inline-parametric-cad-run.tsx   (run card, SSE)
        │
        ▼
POST /api/cad/runs              dashboard/src/app/api/cad/…
        │
        ▼
run-manager.ts ── designCadPart() ── model-client.ts ──► ChatMock (any provider)
                        │                  ▲
                        │                  │  OpenAI-style function tools
                        ▼                  │
                    tools.ts ──────────────┘   the seven CAD tools; Breadboard
                        │                      executes every one of them
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  project-store.ts  blob-store.ts   service.ts ──HTTP──► cad-service (Python)
  (SQLite: projects,  (files on disk,    loopback +          │
   revisions, files)   sha256, atomic)   bearer              ▼
        │                                          executor.py ──spawn──► worker.py
        ▼                                          (timeout, tree kill)      │
   artifact.ts ──► Breadboard's artifact store                               ▼
        │           (manifest is the artifact source)             cadquery_engine.py
        ▼                                                          + validation.py
  parametric-cad-artifact.tsx  (three.js viewer, panels)
```

### Why not MCP

`unified-tool-registry.ts` resolves *installed MCP servers and brokered
connected apps* — third-party surfaces with OAuth, approval flows and
credentials Breadboard does not own. The CAD tools are first-party,
deterministic, and belong to one agent's own pipeline, exactly like the Hardware
Blueprint compiler. Wrapping them in MCP would add a protocol hop and a second
authorization surface for a capability that never leaves the machine. They are
typed tool functions executed by Breadboard's own server; authorization comes
from the route's `requireUserId` and the project's `user_id`, and the audit
trail from the existing runtime-run and artifact-provenance records.

### The CAD engine seam

`cad-service/breadboard_cad/engine.py` defines `CadEngine` and `BuiltModel` in
terms of *named solids* and *measurements* — never CadQuery objects. Adding
build123d means implementing that protocol and calling `register_engine`;
nothing in the executor, the validator, the tool contracts, or the artifact
renderer changes. See §9.

---

## 2. Python environment setup

CadQuery's kernel binding (`cadquery-ocp`) publishes wheels for CPython
3.10–3.12 only. Breadboard's default interpreter is newer, so the CAD service
gets its own environment rather than sharing ChatMock's.

```bash
npm run setup:cad     # provisions .runtime/cad-venv on Python 3.12 via uv
npm run dev:cad       # runs the service on 127.0.0.1:7731
npm run test:cad      # the Python suite (add `-- fast` to skip the geometry builds)
```

`setup:cad` uses [`uv`](https://docs.astral.sh/uv/), which downloads Python 3.12
if the machine does not have it. Without `uv` the script prints the two manual
commands instead of failing silently.

### Windows

This is the primary target and needs nothing special beyond the above. Two
Windows-specific details are handled in code:

- The process tree is killed with `taskkill /PID <pid> /T /F` on timeout;
  POSIX uses `killpg`.
- Parts of CadQuery's import chain refuse to load without a resolvable home
  directory, so the worker is given a throwaway one inside its own workspace
  (`executor.py: _child_environment`). It is deleted with the workspace.

### Pinned versions

`cad-service/requirements.txt`:

| Package | Version | Role |
| --- | --- | --- |
| `cadquery` | 2.6.0 | Parametric CAD API |
| `cadquery-ocp` | 7.8.1.1.post1 | OpenCascade 7.8.1 binding — the solid-modelling kernel |
| `pydantic` | 2.13.4 | Validation at both process boundaries |

Every artifact records the engine, kernel and interpreter versions in
`provenance`, so a design can be reproduced against the versions that built it.

### How the dashboard finds the service

Nothing has to be configured, and nothing is passed between processes.
`dashboard/src/lib/cad/config.ts` resolves the address (loopback port 7731) and
a secret held in a file under Breadboard's data directory — created on first
use, `0600`, read by both the launcher and the dashboard. That is the same
arrangement `cliproxy/config.ts` uses, and it exists for the same reason:
Breadboard has several ways to start, and only some of them can hand the
dashboard an environment.

Every startup path therefore works:

| Started with | CAD service |
| --- | --- |
| `npm run dev` | started by `scripts/dev-all.mjs`, port passed explicitly |
| `start.bat` | started in its own window when the venv exists |
| desktop app | supervised; per-install secret and allocated port passed via env |
| `npm run dev:dashboard` + `npm run dev:cad` | both resolve the same file |

The environment still wins where it is set, which is what keeps the desktop
supervisor's per-install secret and dynamically allocated port authoritative:

```
CAD_SERVICE_URL=http://127.0.0.1:7731   # override the address
CAD_SERVICE_SECRET=…                    # override the shared secret
BREADBOARD_CAD_PORT=7731                # override the port only
BREADBOARD_CAD_HOME=…                   # where the secret and workspaces live
CAD_MODE=disabled                       # stop the dev stack starting it
```

Neither the address nor the secret ever reaches the browser.

A run checks that something is listening (a TCP connect, not a `/health`
request, which would import OpenCascade) before spending any model time, so a
service that is down is reported in a second rather than after a two-minute
design.

Optional overrides, all editable defaults rather than facts:
`CAD_WALL_THICKNESS`, `CAD_GENERAL_CLEARANCE`, `CAD_PRESS_FIT_CLEARANCE`,
`CAD_SLIDING_FIT_CLEARANCE`, `CAD_MINIMUM_FEATURE_SIZE`,
`CAD_MAXIMUM_OVERHANG_DEGREES`, `CAD_PRINTER_BED` (`250x250x300`).

---

## 3. Tool contracts

All seven live in `dashboard/src/lib/cad/tools.ts`. Arguments are Zod-validated
before anything happens; results are typed objects, never prose.

| Tool | Input | Output |
| --- | --- | --- |
| `cad_create_project` | `name`, `units`, `design_spec`, `parameters` | `projectId`, `revision: 0`, `expectedSolidCount`, `defaults`, `disclaimers` |
| `cad_generate_model` | `projectId`, `source`, `entrypoint`, `parameters`, `timeoutMs`, `note`, `constraints?`, `assembly?` | `revision`, `status`, `validationPassed`, `measurements`, `issues[]`, `attemptsRemaining` — or a typed failure with `repairHint` and `line` |
| `cad_validate_model` | `projectId`, `revision?` | `passed`, `status`, `issues[]`, `revalidated` (false when the recorded answer still applies) |
| `cad_export_model` | `projectId`, `revision?`, `formats[]` | `exports[]` with `byteSize`, `sha256` and tessellation tolerances |
| `cad_get_project` | `projectId`, `includeSource` | specification, parameters, source, measurements, last validation, revision history |
| `cad_update_parameters` | `projectId`, `parameters`, `note` | new `revision`, `changed[]` diff, measurements, issues |
| `cad_render_views` | `projectId`, `revision?` | seven camera directions, framing distance, preview format |

Two refusals are enforced in code rather than trusted to the prompt:

- `attempt_budget_exhausted` after three model-driven builds in a turn
  (`MAX_BUILD_ATTEMPTS` in `design-service.ts`).
- `unknown_parameters` / `parameter_out_of_range` before any build.

---

## 4. Artifact schema

Renderer id `parametric-cad`, MIME type
`application/vnd.breadboard.parametric-cad+json`, kind `data`. The artifact's
**source is the whole manifest**, so reopening a design needs neither the model
nor the CAD service. The TypeScript types are in `dashboard/src/lib/cad/types.ts`
and the Zod schema in `schemas.ts`; `parseStoredCadArtifact` runs before the
renderer publishes and again before the viewer draws.

```ts
{
  schemaVersion: 1,
  artifactType: "parametric-cad",
  projectId, revision, title,
  status: "draft" | "valid" | "valid-with-warnings" | "invalid",
  designSpec: CADDesignSpec,      // parameters, components, constraints, assumptions, assembly
  source, entrypoint, parameters, // the CadQuery program and what it ran with
  previewFile: CADFileReference | null,
  exports: CADFileReference[],
  measurements,                   // kernel-measured; never model-authored
  validation: { passed, checkedAt, issues: CADValidationIssue[] },
  assumptions: string[], disclaimers: string[],
  revisionHistory: CADRevisionSummary[],
  generationLog: { at, stage, detail }[],
  provenance: { engine, engineVersion, kernel, kernelVersion, pythonVersion,
                geometryAuthor: "model" | "deterministic-template", … },
}
```

Export bytes are **not** inlined. Breadboard's artifact store keeps one text
source plus one rendered output per version, and a CAD revision has seven files,
four of them binary. They live under Breadboard-controlled application storage
(`<data>/cad-projects/<projectId>/revisions/0001/…`) and the manifest refers to
them by `(projectId, revision, format)`, which the authenticated download route
resolves against the database. Deleting the artifact deletes the project and its
files (`artifact-store.ts: deleteArtifact`).

---

## 5. Revision lifecycle

Every accepted build is an immutable row in `cad_revisions` plus an immutable
file set, and forks a new artifact version.

- `latest_revision` always advances, so a revision number is never reused.
- `current_revision` advances **only** for `valid` or `valid-with-warnings`.
  A failed regeneration is recorded — the agent needs to see what it tried — but
  it never becomes the design the user opens.
- `parameterDiff` is computed against the parent revision. A first revision has
  no diff: the starting point of a design is not a change to it.

### Acceptance, repair, and honest failure

A caller may hand `designCadPart` an `acceptance` callback: requirements the
kernel cannot check, measured against the manifest that was actually built. The
Hardware Blueprint agent passes `physicalDesignCoverageIssues`, so the two gates
now run in one place:

1. The source phase builds and OpenCascade validates.
2. Acceptance runs on the built design. If a required feature is missing, the
   unmet requirements go back to the model **with a build attempt left**, and it
   rewrites the program — sending `constraints` (and `assembly`) with the same
   `cad_generate_model` call, since the source phase cannot otherwise touch the
   specification.
3. If those repairs are exhausted, the run ends without a CAD artifact. No
   canned enclosure, mount, or product template is substituted for the model's
   answer. Invalid revisions remain in project history for diagnosis but never
   become the current or published design.

New revisions always set `geometryAuthor: "model"`. The
`"deterministic-template"` schema value is read-only compatibility for artifacts
saved before deterministic CAD substitution was removed; the viewer labels
those legacy artifacts explicitly.

A parameter edit from the artifact panel posts to
`POST /api/cad/projects/[projectId]/parameters`, which rebuilds the existing
program with the new values, re-validates, and publishes a new artifact version.
No CAD code runs in the browser.

---

## 6. Security model

Generated Python never runs in the Next.js server, the Electron renderer, or the
CAD HTTP server. Each execution:

1. is AST-checked in the service process (`guard.py`) — an import allowlist, a
   denylist of process/filesystem/network/dynamic-evaluation names, and a
   refusal of dunder attribute traversal;
2. is written into a fresh temp directory that is the child's only writable area
   and its `TEMP`, `HOME` and `APPDATA`;
3. runs in a separate `python -m breadboard_cad.worker` process with a scrubbed
   environment — no API keys, no session tokens, no database paths;
4. sees a restricted `__builtins__` and a `__import__` that re-checks the same
   allowlist at runtime;
5. is killed as a whole process tree on timeout;
6. has its stdout, stderr, result document and each export size-capped;
7. produces only files inside its workspace, each re-normalized and
   containment-checked before the service reads it, and hash-verified against
   what the worker reported.

The HTTP surface binds 127.0.0.1 only, refuses to serve without a shared secret,
compares that secret with `hmac.compare_digest`, and refuses a non-loopback
`--host` outright. The server process never imports the kernel, so an
OpenCascade crash costs one request.

### What this is not

**This is a defence-in-depth boundary, not a sandbox.** It removes the obvious
escapes from a program a language model wrote for us. It is not a defence
against an adversary who controls the source. Specifically:

- The worker runs as the same OS user as Breadboard, with that user's file
  permissions. Nothing prevents it reading a file it can name — only the import
  allowlist and the restricted builtins make naming one hard.
- There is no seccomp, AppContainer, job object, or container. A CPython escape
  from the restricted namespace (they are found periodically) would reach the
  user's account.
- Memory is not capped. A program can make the machine swap before the timeout
  fires; the timeout and the single-threaded OCCT settings bound it in practice,
  not by enforcement.
- Network access is not blocked at the OS level. It is blocked by the import
  allowlist and the guarded importer, which is a language-level control.
- The AST guard is a denylist over a language designed for dynamic behaviour.
  New escapes are found in such guards regularly.

`executor.py` is structured so a stronger boundary can replace the process spawn
without touching anything above it: everything crosses as a JSON job file plus a
JSON result file in one directory. A container, a Windows job object with a
memory cap, or a Firecracker microVM would slot in at `execute()`.

Residual risks worth stating plainly: a malicious *model* (not a mistaken one)
is out of scope; a compromised CAD service could return fabricated measurements,
which Breadboard would believe; and the shared secret is only as private as the
process environment on a single-user machine.

---

## 7. Error handling

Every failure mode returns a typed code. No caller parses a terminal string.
`dashboard/src/lib/cad/errors.ts` maps each to a user sentence plus an agent
repair hint:

`forbidden_source`, `syntax_error`, `missing_entrypoint`, `empty_result`,
`unsupported_result`, `execution_error`, `recursion_error`, `out_of_memory`,
`execution_timeout`, `tessellation_failed`, `export_failed`, `export_empty`,
`export_hash_mismatch`, `export_escaped_workspace`, `worker_crashed`,
`engine_unavailable`, `cad_service_unavailable`, `cad_service_unconfigured`,
`cad_service_busy`, `cad_service_error`, `invalid_request`, `result_too_large`,
`export_too_large`.

Artifact persistence failure, revision conflict, parameter schema mismatch and
user cancellation are handled at their own layers (`artifact-store.ts`,
`project-store.ts`, `parameter-action.ts`, `run-manager.ts: abortRun`). A run
always reaches a terminal event (`run.completed`, `run.failed`, `run.aborted`),
so the UI can never stick in a generating state.

---

## 8. Lifecycle events

Emitted by `tools.ts` and `run-manager.ts`, replayed by the SSE route, consumed
by the run card:

```
cad.spec.created         cad.validation.started    cad.export.started
cad.source.generated     cad.validation.completed  cad.export.completed
cad.execution.started    cad.validation.failed     cad.artifact.created
cad.execution.completed  cad.repair.started        cad.artifact.updated
cad.execution.failed     cad.acceptance.failed
```

`cad.acceptance.failed` comes from `design-service.ts` rather than the two files
above: it is emitted when a built, kernel-valid design still misses a required
feature after every repair attempt. The run then ends without publishing CAD.

They ride the existing `id:/event:/data:` envelope, so no existing consumer
changes.

---

## 9. Adding another CAD engine

1. Implement `CadEngine` and `BuiltModel` in a new module under
   `cad-service/breadboard_cad/`.
2. Call `register_engine(YourEngine())` at import time.
3. Import it from `worker.py` alongside `cadquery_engine`.
4. Add the engine name to the health response's `engines` list.

`build(source, entrypoint, parameters) -> BuiltModel` is the whole contract. The
model returns named solids; measuring, validating, tessellating and exporting
are the engine's, and everything above the seam works in millimetres and names.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "The local CAD service is not running" | Nothing is listening on the port. Start the whole stack with `npm run dev`, or `npm run dev:cad` alongside a hand-started dashboard. |
| "Breadboard could not create the CAD service's local secret" | The data directory is not writable. Check `BREADBOARD_CAD_HOME`, or set `CAD_SERVICE_SECRET` explicitly. |
| `/api/cad/health` returns `status: "degraded"` | The Python environment exists but CadQuery does not import. The `detail` field carries the exception. Re-run `npm run setup:cad`. |
| `npm run setup:cad` says `uv` is required | Install uv, or create the venv by hand on Python 3.12 as the message shows. |
| The first health check takes ~15 s | Importing OpenCascade on a cold filesystem cache. Subsequent builds are ~2–4 s. |
| `worker_crashed` | An OpenCascade crash rather than an exception. The operation immediately before it is the one to change; the STEP/STL of the previous revision is unaffected. |
| Builds are slow | OCCT is pinned single-threaded so the timeout means something. A 45 s default covers everything in §20 of the MVP scope. |
| The preview is blank but the STL downloads | WebGL is unavailable in that browser/session; the viewer says so explicitly. |

---

## 11. Running the tests

```bash
npm run test:cad                 # 60 Python tests (guard, execution, validation, server)
npm run test:cad -- fast         # guard + validation only, no geometry builds

npm --prefix dashboard test      # the whole dashboard suite, including:
#   tests/parametric-cad-agent.test.mjs        registration, tools, schemas, safety, wiring
#   tests/parametric-cad-store.test.mjs        revisions, diffs, storage containment
#   tests/parametric-cad-integration.test.mjs  seven fixtures against the real kernel
```

The integration suite starts the CAD service itself on a free loopback port with
a throwaway secret, and skips with a specific message when
`.runtime/cad-venv` is absent — a checkout that has not run `setup:cad` still
has a green suite.
