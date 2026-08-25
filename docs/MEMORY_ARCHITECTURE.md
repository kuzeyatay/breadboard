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

The dashboard also samples its own `process.memoryUsage()`, V8 heap/space/code
statistics, resource usage, CPU, and event-loop utilization. Those samples
explain *where* the server process is growing; they do not replace the
supervisor's descendant-tree private-byte limit or system commit admission.
History is a fixed-size ring and is exposed only through a bearer-gated
loopback diagnostic route.

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

Admission is serialized through service readiness, so parallel startup waves
cannot each spend the same stale headroom sample. Background work preserves the
normal 20% reserve. Explicit bounded foreground work such as the fenced Learn
worker may consume that soft reserve only while projected commit still leaves
the critical reserve intact; no optional work starts once the system is already
critical or emergency. A failed capability admission may synchronously reclaim
only manager-owned services explicitly marked pressure-sheddable, sample once
more after confirmed reclamation, and restore those services when the lease is
released. It never loops or stops adopted, required, or leased trees.

The dashboard is never externally adopted. Adoption provides no child PID or
Windows job handle, so presenting an existing multi-GiB compiler as supervised
would bypass both its tree budget and shutdown. An identified dashboard already
on port 3000 now blocks startup with an explicit instruction to stop it; an
unrelated port occupant can still be relocated around.

The control plane binds `127.0.0.1`, accepts no command or argument payloads,
limits bodies to 8 KiB, has bounded request/header timeouts, compares bearer
tokens in constant time, and accepts only registered IDs. Status is
authenticated and contains sanitized state/PID/count data, never environment or
command lines.

## Service lifecycle policy

| Service/capability | Policy | Idle TTL | Group |
| --- | --- | ---: | --- |
| Electron, dashboard, ChatMock, Hermes, GBrain | eager | — | core |
| Postiz coordinator only | eager | — | core |
| CLIProxy when installed | eager | — | small gateway |
| Quartz | on-demand | 15 min | large-generation |
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

Next 16 development uses its default Turbopack compiler. Webpack remains an
explicit diagnostic option for A/B measurements and production builds, whose
custom configuration still enables the audited build-time memory controls.
Webpack filesystem caching remains enabled; it is measured rather than being
disabled as a speculative fix.

Next instrumentation contains only bounded memory telemetry and a small child
launcher. Schedulers, recovery sweepers, channel gateways, and optional
autostarts load in a 1024 MB coordinator child inside the owned dashboard tree,
so Next does not retain that entire server module graph. On the client, the
large Terminal graph and its startup API fan-out compile only when the user
opens it, unless a route explicitly requested a Terminal panel or the renderer
is restoring an already-open Terminal.

A sustained hard crossing records a bounded diagnostic, terminates the whole
owned tree, marks that attempt failed, and does not run the ordinary automatic
restart policy. Required services emit a fatal classification. Durable workers
retain their checkpoints; a later user-initiated action may resume where the
domain supports it.

## Durable and streaming work

Learn plan/generate/rebuild/repair/humanizer operations run in a single fenced
worker with a 4096 MB V8 cap and a conservative 6144 MB commit-admission
estimate: old-space plus 50% for other V8 spaces, native buffers, loaded
modules, and child-process overhead. It is a planning envelope, not a measured
peak or hard process-tree cap. Start and ready receipts, the SQLite job, progress,
heartbeats, page checkpoints, and focused repair state are durable. The worker
is detached from the Next process so a dashboard recycle does not lose the job;
Electron validates its exact ownership marker and kills its tree on normal,
crash, and last-resort exit paths.
The worker's JavaScript `finally` requests release immediately, but within the
existing bounded lease lifetime Electron keeps the hold until recorded-PID
liveness observes process exit, so pressure-shed services cannot return during
native/runtime teardown.

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

`npm run qa:memory:dashboard -- --cycles=30` launches an isolated Turbopack dev
server, disables background side effects, performs 30 real source
invalidations, waits until the diagnostic route observes each rebuild, and
writes `qa/memory/latest-dashboard-compiler.json`. Pass `--bundler=both` for a
sequential, reserve-gated Turbopack/webpack comparison. The receipt separates
RSS, heap total/used, external memory, ArrayBuffers, heap spaces, and code
metadata at every cycle, reports warm-to-last-rebuild and warm-to-settled deltas
separately, and restores both the source probe and `tsconfig.json` after each
run. It intentionally measures the compiler process while the integrated
burn-in remains authoritative for descendants and system commit.

The desktop standalone build preloads a narrow filesystem/trace guard. Next
applies its documented trace exclusions only after build plugins evaluate
dynamic filesystem expressions, so a broad inferred glob could otherwise
descend into live Chromium profiles and fail on locked SQLite files. Mutable
runtime directories appear empty only inside the dedicated build child; the
guard also rejects NFT globs broad enough to overlap those directories.
Concrete dependencies and source/package reads continue through normal tracing.
