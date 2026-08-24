# Breadboard memory architecture

Breadboard keeps Electron, the standalone dashboard, ChatMock, the supervisor
control plane, and the lightweight Postiz coordinator as its core. Expensive
sidecars and jobs are admitted against Windows commit headroom and started only
for a real operation.

## Why commit is the primary signal

The incident was commit exhaustion, not simply a high working set. Windows had
38.4/41.3 GB committed, and stopping one Breadboard development supervisor tree
returned about 14.8 GB. A later live audit found a single Next development
server at roughly 9.5 GB private bytes. V8 heap, process working set, and free
physical RAM cannot describe either condition accurately.

The Electron lifecycle therefore samples `GetPerformanceInfo` through one
persistent local helper process. It derives free commit as `CommitLimit -
CommitTotal`; process-tree budgets remain a separate signal. The QA sampler in
`qa/memory/windows-sampler.ps1` uses the same API and also records private bytes,
working set, parent/descendant relationships, process count, and observable
Docker/WSL host processes.

## Ownership and admission flow

1. Electron resolves and validates one `MemoryPolicy` before starting services.
2. `MemoryGovernor` transitions through `normal`, `constrained`, `critical`,
   and `emergency` using absolute and percentage-of-commit reserves with
   recovery hysteresis.
3. The dashboard server asks the authenticated loopback control plane for a
   predefined service or capability lease. The per-launch bearer is available
   only in server environment variables.
4. The governor considers the cold-start estimate, required/optional status,
   priority, current headroom, active leases, and heavyweight concurrency group.
5. Admission either returns a lease or a structured non-retryable
   `BREADBOARD_RESOURCE_EXHAUSTED` result.
6. Concurrent first uses share one `ensureService()` promise. The active lease
   protects the complete request, stream, browser run, or job.
7. Releasing the final lease starts the service's idle TTL. The supervisor then
   stops the complete tree. A later use cold-starts it again.

The control plane binds `127.0.0.1`, accepts no command or argument payloads,
limits bodies to 8 KiB, has bounded request/header timeouts, compares bearer
tokens in constant time, and accepts only registered IDs. Status is
authenticated and contains sanitized state/PID/count data, never environment or
command lines.

## Service lifecycle policy

| Service/capability | Policy | Idle TTL | Group |
| --- | --- | ---: | --- |
| Electron, dashboard, ChatMock | eager | — | core |
| Postiz coordinator only | eager | — | core |
| CLIProxy when installed | eager | — | small gateway |
| Hermes | on-demand | 10 min | large-generation |
| Quartz | on-demand | 15 min | large-generation |
| GBrain | on-demand | 10 min | document-model |
| UI-TARS | on-demand | 10 min | browser-automation |
| CAD | on-demand | 10 min | local-model |
| ColPali | on-demand | 10 min | document-model |
| Humanizer | on-demand | 10 min | local-model |
| Voicebox | on-demand | 10 min | media-processing |
| Scriberr | on-demand | 10 min | media-processing |
| Postiz container stack | capability/on-demand | coordinator TTL | docker-stack |
| Learn worker | job/on-demand, concurrency 1 | exits after job | large-generation |
| ingestion | job admission | request/job lifetime | document-model |
| artifact rendering | job admission | render lifetime | media-processing |
| agent-browser | job admission | browser-run lifetime | browser-automation |

Quartz, Hermes, GBrain, and the optional model services are not hard dashboard
dependencies. Their absence, cold start, or admission denial is localized to
the feature that requested them.

## Soft and hard containment

A process-tree soft crossing first closes low-priority heavyweight admission
and stops idle optional trees. A hot dashboard waits for all heavyweight leases
to reach a safe boundary and for the system reserve plus its cold-start estimate
to be available; it may then recycle once, with a 30-minute anti-loop window.
Standalone/packaged dashboards are not recycled by this development policy.

A sustained hard crossing records a bounded diagnostic, terminates the whole
owned tree, marks that attempt failed, and does not run the ordinary automatic
restart policy. Required services emit a fatal classification. Durable workers
retain their checkpoints; a later user-initiated action may resume where the
domain supports it.

## Durable and streaming work

Learn plan/generate/rebuild/repair/humanizer operations run in a single fenced
worker with a 4096 MB V8 cap. Start and ready receipts, the SQLite job, progress,
heartbeats, page checkpoints, and focused repair state are durable. The worker
is detached from the Next process so a dashboard recycle does not lose the job;
Electron validates its exact ownership marker and kills its tree on normal,
crash, and last-resort exit paths.

Ingestion streams multipart bytes into a private random staging file with a
configured byte limit. Parsers that need random access materialize one shared
buffer, rather than retaining the multipart `File` plus repeated `ArrayBuffer`
and `Buffer` copies. Progress remains SSE, and the staging tree is removed on
success, error, cancellation, or disconnect. Scriberr already persists queued
jobs and paths; its service lease now spans submission through transcript
retrieval, while indexing proceeds without pinning the sidecar.

## Windows native helper

`native/runtime-supervisor` is a focused Rust stdio helper. Electron uses it on
Windows when the packaged binary is present and otherwise retains the tested
process-tree fallback. The helper creates stdout/stderr pipes, calls
`CreateProcessW` with `CREATE_SUSPENDED`, creates and configures a Job Object,
assigns the root before resuming it, and enables
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Optional job-wide hard memory limits are
applied before resume. The helper emits a classified hard-limit event and
terminates the job at 98% of that kernel ceiling, leaving enough margin to
persist the cause instead of first discovering it as a failed allocation. It
emits JSON-line started, stream, memory, soft-limit, hard-limit, exit, and error
events, including exact system commit from `GetPerformanceInfo`. EOF from
Electron terminates the job; graceful stop has a bounded window followed by
`TerminateJobObject`.

The helper has no listener, does not accept environment or arbitrary requests
over a network, and never serializes the inherited environment. The installer
stages it under `resources/bin`; preparation and verification fail when a new
Windows package has neither Cargo nor a previously verified binary.

## Docker and WSL

Only the lightweight coordinator is eager. Actual Postiz work acquires the
`docker-stack` capability before `compose up`. The generated override assigns
all nine containers configurable `mem_limit` and `mem_reservation` values and
sets `restart: 'no'`, leaving recovery to the bounded coordinator. Idle/exit
shutdown uses `compose down` with no `--volumes`, prune, or WSL shutdown.
Windows commit accounting already includes WSL/Docker pressure even when exact
attribution is unavailable.

## Evidence

`npm run qa:memory:smoke` writes samples and a summary without launching the
stack. `npm run qa:memory:burn-in` first requires enough headroom for the reserve
plus a cold-start estimate, then samples the integrated lean QA tree. Its
default `exploratory` inventory exercises every credential-free mixed-workload
path and records unavailable model/browser dependencies as blocked rather than
inventing results; `BREADBOARD_MEMORY_QA_PROJECT` may select `critical` or
`hermes` on a suitably configured machine. Crossing the reserve stops the exact
QA-owned tree and records an abort; it is never reported as a pass.
