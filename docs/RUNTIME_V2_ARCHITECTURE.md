# Breadboard Runtime V2 architecture

Status: source process-ownership cutover implemented; native/package/live
verification remains incomplete. Electron AppLifecycle selects Runtime V2 as
the sole application-managed process owner, and the checked-in service and
worker manifests are the launch authority. This document does not claim an
installed migration or memory pass where the corresponding receipt is NOT RUN.

## Current active path (source audit, 2026-08-26)

The current checked-in source path is:

- Electron `AppLifecycle` constructs `RuntimeProcess`; the source-owner gate
  rejects an active `ServiceManager` owner or a direct Electron service launch.
- Runtime V2 loads versioned service and worker manifests, resolves closed
  launch profiles, assigns supported trees before execution, and owns status,
  leases, cancellation, schedules, recovery fencing, and shutdown.
- GBrain and every other Breadboard service remain mandatory capabilities.
  Persistent work is registered as core, leased, scheduled, or explicitly
  external; finite work uses one registered disposable worker per attempt.
- Learn, ingestion, code indexing, Office/artifact leaves, audio, speech/media,
  terminal commands, generated-visual browsers, managed setup, and exact health
  probes have source-registered Runtime V2 worker paths. Aggregate legacy rows
  are not treated as extra runtime owners.
- Managed ComfyUI is a leased Runtime V2 service with a registered disposable
  setup job. Explicit external ComfyUI remains a no-ownership external branch.
- Ordinary Agent Browser runs and the explicit profile sign-in window are
  separate registered Runtime V2 jobs. Each owns an attached Chromium tree;
  the profile job is finite when its window closes, is cancelled, or reaches
  its maximum bound.
- Local stdio MCP launch requests name immutable digest-addressed approved
  profiles rather than executable, argv, cwd, or environment values. Remote or
  independently managed MCP endpoints remain explicit external boundaries.

The migration is not declared complete: native compilation, packaged Ruflo,
the complete lean installed baseline, per-entry memory/process-tree receipts,
and restart evidence are still pending. A source
validator or focused unit test is never substituted for an installed receipt.

## Outcome

Breadboard keeps its Electron shell, Next.js dashboard, React UI, and existing
domain implementations. The checked-in source selects a single packaged Rust
process as the only owner of Breadboard-managed processes:

```text
Electron main
  `-- breadboard-runtime.exe
        |-- dashboard (Next standalone)
        |-- leased/scheduled services
        |-- Postiz coordinator and its explicitly managed stack
        `-- one-process-per-attempt finite workers
```

Electron owns only the runtime process. The runtime owns every managed service,
worker, browser, compiler, and descendant through a Windows Job Object. Next.js
remains an authenticated compatibility layer, but it submits work and relays
events instead of spawning or retaining heavyweight work.

There must never be two active lifecycle authorities. The active source path
fails closed on Runtime startup and does not fall back to Electron-owned service
launches; installed/package proof of that path remains NOT RUN.

## Ownership invariants

1. Only the Rust runtime may start a registered service or worker executable.
2. A renderer or HTTP request may name a registered service or job type, never
   an executable, command line, environment block, or arbitrary path.
3. Every managed process is assigned to the runtime's Job Object before its
   first instruction executes. Assignment failure terminates and reaps the
   suspended process before returning an error.
4. Finite work gets a fresh process for one attempt. The process and its entire
   descendant tree exit after the terminal result has been persisted.
5. Persistent processes are limited to core, external, and registered leased or
   scheduled services. An on-demand service with no live lease reaches its idle
   deadline and exits.
6. The Rust runtime is the sole writer for job state, service lease state,
   admission decisions, worker fencing, and terminal classifications.
7. Memory limits are a last-resort safety boundary. Normal memory reclamation
   comes from worker or idle-service process exit.
8. An ambiguous attempt is never silently retried. Recovery exposes an
   `interrupted` or `uncertain` result and requires an explicit policy or user
   action.
9. The pre-migration capability registry is an immutable parity baseline. A
   service being stopped changes lifecycle state, never agent visibility,
   command routing, selection semantics, or capability availability.

## Same-product parity gate

The Runtime V2 migration is gated by stable capability IDs rather than by a
small set of representative demos. The baseline captures every visible agent,
slash command, implicit route, skill, connection, MCP surface, provider/model
choice, approval path, chat surface, artifact type, and recovery contract.

Each worker and service definition declares the capability IDs it serves. Before
an adapter can cut over, the parity harness must prove that those IDs retain the
same display name, ordering, entry point, routing, input/output type, progress,
streaming, cancellation, approval, follow-up, artifact, and restart behavior.
The old direct-spawn path is removed only after that focused before/after gate
passes. A missing credential or external program is recorded as `BLOCKED` on
both sides; it is never omitted or converted to `PASS`.

## Trust boundary and registries

Versioned worker and service manifests are packaged with the application. The
runtime validates them before accepting requests and fails closed on:

- an unsupported manifest or protocol version;
- duplicate service, worker, or job-type ownership;
- an unknown dependency or dependency cycle;
- an absolute, traversing, or otherwise untrusted executable/entrypoint path;
- an invalid memory, timeout, concurrency, or idle policy;
- a finite worker configured to serve more than one job.

Electron derives four roots and supplies them over the private bootstrap
boundary. In development `appRoot` is the repository while `runtimeRoot` is
`desktop/build-resources`; in an installed app they are respectively
`resources/app-services` and `process.resourcesPath`. The runtime identity-pins
both independently. It reads only
`runtimeRoot/runtime-v2/manifests/{workers,services}.json`, resolves and pins
`allowedExecutable` beneath `runtimeRoot`, and separately resolves and pins
`allowedEntrypoint` beneath `appRoot`. Requests cannot add or override either
path. Worker input, checkpoints, artifacts, and results use job-relative paths
beneath the runtime data root.
The source core also owns a non-serializable `ControlPlaneAuthority`: it checks
the bounded per-launch bearer before it can mint an opaque user job context,
redacts the secret from diagnostics, and keeps raw context constructors
crate-private. The source path authority now canonicalizes and identity-pins
existing roots, rejects symlink/junction/reparse components, verifies the final
path from each opened handle, bounds reads before materialization, and pins
manifest, launch, and database paths across their trusted consumer's open.
The checked-in source service manifest covers the real dashboard, ChatMock,
Hermes, GBrain, and ComfyUI paths. The checked-in worker manifest registers finite Learn,
document-ingestion, Quartz-publish, and office-artifact adapters. The protocol
test validates those exact source entries. The existing build-resources mirror
was intentionally not refreshed during this no-build audit, so staged/package
parity remains a separate red gate until the normal resource-preparation and
installed-package verification run.
These source guarantees remain inactive until the runtime host is wired and the
packaged path is verified.

## Runtime data layout

Runtime V2 uses a dedicated namespace and database. It does not repurpose the
dashboard database or any garden database.

```text
<userData>/runtime-v2/
  runtime-v2.sqlite3
  jobs/<job-id>/
    input.json
    input/
    workspace/
    checkpoints/
    artifacts/
    result.json
  logs/
```

Inputs are staged before admission by streaming into the private job directory.
The input manifest contains bounded metadata and relative paths, not whole-file
base64 payloads. Results are written to a temporary sibling and atomically
renamed before the terminal event is accepted.

## Durable job state

The lifecycle is explicit:

```text
queued -> admitted -> starting -> running <-> checkpointing
   |          |          |           |
   `----------+----------+-----------+-> cancelling -> cancelled
                         |           |
                         +-----------+-> succeeded
                         +-----------+-> failed
                         +-----------+-> resource_exhausted
                         `-----------+-> interrupted
                         `-----------+-> uncertain
```

The native dispatcher keeps FIFO admission in one coordinator but drives each
admitted attempt in an independent, bounded process-owner lane. Jobs from
different worker definitions may therefore run together when live Windows
commit headroom permits; each definition's `maximumConcurrency` remains an
independent ceiling. A job waiting for its definition's slot stays queued while
an eligible job behind it may start. If any owner lane encounters an ambiguous
process or persistence transition, admission closes, every lane is stopped and
joined, and all opaque authorities are retained until generation teardown.

Terminal states never transition. Cancellation is first persisted as
`cancelling`; `cancelled` is persisted only after the process owner confirms
that the complete worker tree is gone. Restart recovery uses durable
checkpoints and provider receipts: an attempt known not to have completed is
`interrupted`, while a provider or external side effect whose completion cannot
be determined is `uncertain`. Neither state is retried automatically. The
source store now distinguishes cancellation, pre-ready interruption, a latest
durable checkpoint, activity after a checkpoint, completion intent, and
unclassified external effects. A newly started host can enumerate completion
intents for trusted result validation before reconciliation. Durable
provider-receipt writing is still absent, so post-checkpoint or otherwise
ambiguous external effects remain `uncertain`.

The dedicated SQLite store records:

- generic job identity and type;
- user, garden, and conversation ownership where applicable;
- worker kind, resource class, attempt, and worker-instance fence;
- input, workspace, checkpoint, artifact, and result paths;
- stage, progress, heartbeat, timestamps, and cancellation intent;
- structured failure or resource-exhaustion information;
- an idempotency key;
- an append-only replay stream and durable checkpoints.

The runtime is the only writer. Readers use bounded event replay with a sequence
cursor. Each replay page reads the ownership-scoped job row, the requested
limit plus one events, and the active job reservation state from one SQLite
read transaction. The replay `terminal` bit is true only when durable job state
is terminal and no pending or resident job reservation remains. A failed worker
whose process tree has not yet been confirmed gone therefore remains unsealed
for replay even though job inspection reports `failed`; releasing the tree
reservation seals the stream, and the live-tree release path appends its final
public lifecycle event in that same transaction. A consumer is fully drained
only when `terminal` is true and `hasMore` is false. Once sealed, authoritative
store APIs permit and expect no later public event. Unknown persisted state or
malformed stored events are corruption errors, never silently coerced to
another state.

## Worker protocol and fencing

Each attempt has the tuple:

```text
(jobId, attempt, workerInstanceId)
```

Every worker event carries that tuple. An event from an earlier process or
attempt is rejected even if it refers to the same job. Protocol lines, request
bodies, identifiers, stages, failure messages, log lines, and buffered output
all have explicit byte limits.

Required worker events are:

- `ready`
- `heartbeat`
- `progress`
- `checkpoint`
- `artifact`
- `complete`
- `failed`

The authenticated status/replay boundary has a separate closed public contract
in source. Rust uses typed event, stage, artifact-kind, and failure-code enums;
the bounded Next client parses the same contract as a discriminated union. It
accepts exactly 25 public event types:

- runtime-origin: `queued`, `admitted`, `worker-assigned`,
  `reservation-settled`, `reservation-released`, `cancellation-requested`,
  `completion-confirmed`, `job-starting`, `job-running`, `job-checkpointing`,
  `job-cancelling`, `job-cancelled`, `job-succeeded`, `job-failed`,
  `job-resource-exhausted`, `job-interrupted`, and `job-uncertain`;
- worker-origin: `worker-ready`, `worker-heartbeat`, `worker-progress`,
  `worker-checkpoint`, `worker-artifact`, `worker-complete`, `worker-failed`,
  and `worker-cancellation-acknowledged`.

Each event has exactly one payload shape and one fence class; missing or extra
payload fields, wrong fixed values, and mismatched fences fail closed. The
fence assignment is:

- `runtime-zero` (`attempt=0`, null worker identity and sequence): `queued` and
  `admitted`;
- `runtime-attempt` (positive attempt, runtime-owned worker identity, null
  worker sequence): `worker-assigned`, `reservation-settled`,
  `completion-confirmed`, `job-starting`, `job-running`, `job-checkpointing`,
  `job-succeeded`, `job-failed`, and `job-uncertain`;
- `runtime-current` (either valid runtime-zero or runtime-attempt):
  `reservation-released`, `cancellation-requested`, `job-cancelling`,
  `job-cancelled`, `job-resource-exhausted`, and `job-interrupted`;
- `worker` (positive attempt, matching worker identity, and positive worker
  sequence): all eight worker-origin events.

Payloads are likewise exact. `reservation-settled`, `reservation-released`, and
`worker-complete` use `{}`. `worker-heartbeat` has only `stage`;
`worker-progress` has only `stage`, `progressCurrent`, and `progressTotal`;
`worker-checkpoint` and `worker-artifact` have only `artifactKind`; and
`worker-failed` is fixed to `state=failed`, `failureCode=WORKER_FAILED`, and the
sanitized message `Runtime job execution failed.` The remaining state-only
events are fixed as follows: `queued`/`admitted` preserve those states,
`worker-assigned` and `job-starting` use `starting`, `completion-confirmed` and
`job-succeeded` use `succeeded`, `worker-ready` and `job-running` use `running`,
`cancellation-requested`, `worker-cancellation-acknowledged`, and
`job-cancelling` use `cancelling`, and the remaining mappings are
`job-checkpointing` to `checkpointing`, `job-cancelled` to `cancelled`,
`job-failed` to `failed`, `job-resource-exhausted` to `resource_exhausted`,
`job-interrupted` to `interrupted`, and `job-uncertain` to `uncertain`.

The public stage vocabulary is exactly `preparing`, `working`, `generating`,
`waiting-external`, `processing`, `persisting`, `finalizing`, and `cancelling`.
The public artifact kinds are exactly `checkpoint`, `artifact`, `document`,
`image`, `audio`, `video`, `model`, `report`, `archive`, and `page`. The public
failure codes are exactly `RUNTIME_JOB_FAILED`, `WORKER_FAILED`,
`BREADBOARD_RESOURCE_EXHAUSTED`, `JOB_INTERRUPTED`, and `JOB_UNCERTAIN`.
Runtime-owned exact mappings use `working` and `artifact` for unknown private
stage/artifact tokens; raw worker or durable failure identifiers and messages
never cross this boundary.

Workers never mutate the job database. They write only inside their private
workspace and emit bounded events. A completion event is accepted only for the
currently fenced attempt and exact result path. It records completion intent;
it does not by itself publish `succeeded`. The runtime verifies that the result
was durably written through the trusted path and that the complete fenced
process tree exited before publishing terminal success and releasing the
admission hold. `JobStore` now accepts only an opaque, non-serializable
`WorkerCompletionProof`. Only the unconstructable core process-owner capability
can mint it after tree exit, an exact handle-backed reopen, a 1 MiB ceiling,
fenced envelope/sequence validation, structural validation, and SHA-256 hashing.
The checked-in process owner drives the native Windows supervisor through
pinned runtime/application/data authorities and mints that capability only
after a matching root receipt, zero Job Object residents, complete final
accounting, no cleanup errors, and matching supervisor exit. AppLifecycle and
the registered dispatcher select this path in source; native/package execution
evidence remains NOT RUN.

`qa/runtime-v2/validate-runtime-control-contract.mjs` performs a source-only
drift check across the machine-readable control contract, Rust protocol source,
Electron adapter source, and the bounded Next compatibility client. It is not a
substitute for the unrun compiled, integration, Electron, parity, or memory
suites. The source validator currently passes, and the focused plain-Node
supervisor-control suite passes 26/26 for the matching parser and request
boundary. Rust/native compilation, installed integration, Electron parity, and
memory execution remain NOT RUN.

## Windows process containment

The runtime creates each root process suspended, attaches it to a Job Object,
and resumes it only after successful assignment. The Job Object provides:

- kill-on-close containment for descendants;
- aggregate job memory accounting;
- a hard job-wide commit ceiling as a final backstop;
- completion notifications used to distinguish root exit from full-tree exit;
- deterministic forced cancellation after a bounded graceful interval.

Only the child's intended standard handles are inherited. Parent disconnect,
runtime shutdown, assignment failure, readiness timeout, heartbeat timeout,
maximum runtime, and hard-limit termination all have explicit terminal
classification and reaping behavior.

The Runtime V2 admission governor reads the system-wide Windows
`CommitTotal`, `CommitLimit`, and page size through `GetPerformanceInfo`. It
retains exact byte counters, rounds committed bytes up and the limit down for
conservative MiB admission, and samples once inside the serialized durable
admission transaction. Packaged mode preserves the fixed 8 GiB reserve.
Development modes preserve the larger of 2 GiB or 5% of the current commit
limit (bounded to 1-4 GiB), plus a 256 MiB guard band. Their supervised process trees receive
the matching live system-commit guard and retain their manifest hard ceilings;
all trees may tighten their ceiling as pressure rises, but only the sealed
dashboard profile may expand after launch or terminate solely because the
global reserve is crossed. Other trees retain their manifest hard caps and
never independently race to sacrifice themselves against the same shared
system sample. The adaptive reserve therefore changes usable headroom, not
process ownership or leak containment, without letting independent worker
trees each claim the same newly released slack or trigger a multi-service
termination storm.

Workers that deliberately use `CREATE_BREAKAWAY_FROM_JOB`, detached/unref
browser processes, shell backgrounding, or equivalent ownership escape hatches
are incompatible with Runtime V2. Source validation must reject any active
Breadboard launch that reintroduces one.

## Admission and memory policy

Admission uses Windows commit, not only process RSS. For a request, the runtime
requires strictly more than:

```text
mode-selected reserve + estimated cold-start commit
```

The decision also accounts for pending reservation estimates and
per-definition concurrency. Admission is serialized with durable reservation
creation, so two cold starts cannot both spend the same sampled headroom.
Resource classes select containment profiles but do not impose a product-wide
one-heavyweight-at-a-time exhaustion limit; independently bounded work may
overlap whenever live commit headroom fits.

A denial is structured and non-retryable by default. It reports the resource,
required headroom, available headroom, and reason. An HTTP retry loop must not
turn an admission denial into a memory storm.

Soft limits emit telemetry and may request a checkpoint or graceful release.
Hard limits terminate the complete Job Object and persist
`resource_exhausted`. Neither limit is considered successful completion.

## Services and leases

Service definitions declare startup policy (`eager`, `on-demand`, `scheduled`,
or `external`), dependencies, resource class, commit estimates, limits, idle
TTL, shutdown timeout, and restart policy.

An authenticated caller acquires a bounded lease by registered service ID. The
runtime starts dependencies in order, waits for readiness, and returns an opaque
lease ID. Lease renewal and release are runtime operations. When the final lease
expires or is released, an on-demand service begins its idle timer and the
runtime shuts down and reaps the full tree at expiry.

Service restarts are bounded and observable. Restart-on-failure never applies
to deliberate shutdown, admission denial, or a hard memory-limit event. Eager
startup is reserved for measured core requirements; failure-isolated compilers,
model servers, browser runtimes, Docker stacks, and media services are not eager.
Failure isolation never means capability omission or hiding.

Postiz is governed as one scheduled/on-demand capability: the coordinator,
Docker/WSL command, containers, health checks, leases, idle deadline, and stack
shutdown are represented under the same Rust authority. Existing Docker volumes
and user data are preserved.

## Electron and Next.js compatibility boundary

Electron launches Runtime V2 with private bootstrap material and waits for a
versioned readiness response. Renderer IPC exposes only allow-listed operations
such as submit, cancel, subscribe, acquire lease, release lease, and status.
Secrets and capability tokens remain in the main process/private control plane.

The private bootstrap is one bounded NDJSON message containing only protocol
version, runtime mode, and the application/data/config/runtime roots. The
runtime root identifies packaged launch assets independently from application
source and mutable data. Bootstrap cannot carry a command, argument vector,
cwd, or environment block. The runtime replies once
with a bounded `runtime-ready` message containing its PID, loopback control
origin, private control token, dashboard URL, and sanitized service states.
Electron validates the protocol version, PID, loopback origins, status schema,
and service IDs before leaving the existing startup presentation. Runtime V2
control uses authenticated `GET /v1/status`, `POST /v1/shutdown`, and bounded
job submission/inspection/event-replay/cancellation endpoints under `/v1/jobs`;
the token is never forwarded to the renderer. Registered job submissions enter
the source dispatcher and its durable fenced execution path; installed
dispatcher evidence remains NOT RUN.

Next.js routes preserve their current authentication, status codes, SSE event
shape, and terminal payloads. During migration they become thin adapters:

1. authenticate and authorize;
2. stream/stage input into the runtime-owned job directory;
3. submit a registered job type with an idempotency key;
4. replay bounded runtime events to the existing client contract;
5. propagate cancellation once, then wait for confirmed terminal state.

The untrusted submission body is byte-limited before JSON deserialization and
contains job type, scopes, idempotency key, and bounded request data only. The
job owner comes from an opaque authenticated server context; a body cannot
assert a user or internal principal. The transitional Next control client also
caps authenticated status and command responses at 64 KiB before strict UTF-8
and JSON decoding; this source contract has a focused Node test but is not yet
present in built output.

Routes must not import heavyweight model libraries, spawn children, open
browsers, start Docker, or retain whole large documents after staging.

## Dashboard modes

Production and normal development use a built standalone dashboard supervised
by Runtime V2. A separate explicit hot-development mode may run the Next
compiler/watch server. Hot mode is never selected implicitly by the packaged
application or by lean development, and it reports its compiler memory as an
external development cost.

Quartz and other compiler-backed product features remain available, but their
builds run as disposable jobs when requested. No product compiler/watch service
starts merely because the application opened.

## Shutdown and recovery order

Normal shutdown is coordinated in this order:

1. stop accepting submissions and leases;
2. persist cancellation intent for finite workers;
3. request graceful worker/service shutdown;
4. wait bounded deadlines while continuing to drain events;
5. terminate remaining Job Objects and confirm complete-tree exit;
6. persist final classifications and flush the database;
7. close the root Job Object and exit the runtime;
8. allow Electron to exit.

On startup, the runtime verifies manifests and schema before opening admission,
reconciles uncertain attempts without blind retry, restores replayable terminal
state, and leaves optional services stopped until demand.

## Packaging and cutover

The packaged Rust binary and packaged manifests are one versioned unit. Builds
must fail if Cargo is unavailable, if the binary cannot be rebuilt, if the
manifest/protocol version disagrees, or if a staged binary cannot be verified.
A previously existing executable is not proof that the current source was
built.

Cutover is allowed only when:

- every Electron service definition has a Runtime V2 service definition;
- every pre-migration capability ID remains in the parity registry;
- every qualifying execution path has an inventory disposition;
- direct-spawn and breakaway paths are removed from the active mode;
- Electron launches only one lifecycle authority;
- shutdown, cancellation, recovery, and renderer cleanup tests pass;
- the real Electron workflow and memory burn-in complete with inspected
  receipts.

The checked-in source already selects Runtime V2 and fails closed instead of
competing with a legacy Electron owner. The criteria above govern when the
installed migration may be declared complete, not whether source may retain a
second lifecycle authority.

## Evidence and current limitations

The first installed-app baseline is preserved under
`qa/runtime-v2/evidence/baseline-installed-2026-08-24T20-09-33-083Z/`. It is an
aborted result, not a pass. Opening the old installed application eagerly
started Quartz build/watch and `esbuild`; the QA-owned tree peaked at 3,634.2 MB
private bytes, including 2,894.4 MB in the Quartz Node process and 270.7 MB in
`esbuild`. The tree was immediately stopped and all captured PIDs were verified
gone.

A complete before/after workflow is still required. It must cover visible
Electron startup, dashboard navigation, Garden, Learn setup/start/progress/
completion/cancellation, ingestion, artifact/media/browser work, idle service
reclamation, restart recovery, and repeated burn-in. Each receipt must record
process-tree memory and Windows commit before, peak, after completion, and after
idle TTL.

Rust and production-dashboard compilation were not performed by this
source-reconciliation pass. Permission does not substitute for execution, so
the native, packaging, installed, and memory receipts remain explicitly NOT RUN.

The machine-readable command ledger is
`qa/runtime-v2/verification-status.json`. It preserves historical source-only
passes, failures, the aborted installed baseline, and every required command
still `NOT RUN` without rewriting history into a pass. Current source validators
are reported separately and never stand in for a compiler, bundler, service,
worker, application, or live memory receipt.
Renderer lifecycle work has focused plain-Node evidence for stream reader
release, duplicate terminal-probe suppression, terminal-rail and garden-card
drag teardown, reference-counted history-request cancellation, Garden proposal
request cancellation, and speech media/blob disposal. The focused renderer
command passes 23/23 and the adjacent history/caching command passes 28/28.
Those are source/runtime-unit results only: TypeScript compilation, actual
renderer GPU/canvas reclamation, Electron behavior, and memory return remain
unverified. A broader Hermes source-contract sample remains an honest FAIL at
41/44 because three current dirty Terminal/Skills assertions disagree with the
source.
The canonical parity generator hashes its source inputs and the inventory-only
validator rejects drift. Regeneration is allowed only as an explicit source
reconciliation and does not change any historical live-evidence receipt.
