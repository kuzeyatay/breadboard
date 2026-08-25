# Runtime V2 host scaffold

This crate reserves the fixed `breadboard-runtime` binary and implements the
private bootstrap plus bounded loopback status/shutdown control plane. It is
source-only and deliberately not active yet.

The production `UnavailableRuntimeEngine` fails before binding or emitting a
`runtime-ready` record. A real engine must first prove that the standalone
dashboard is ready, provide sanitized service status, and own bounded shutdown.
Until that exists, this crate cannot truthfully provide a dashboard URL.

Still missing by design: the dashboard/service engine, real worker adapters,
full service dispatch, Electron cutover, and parity-gated packaging evidence.
The source includes restart reconciliation plus authenticated job
submission, inspection, snapshot-consistent bounded event replay, and durable
cancellation control. Its one-thread disposable-worker dispatcher is wired
behind the shared admission gate: it performs bounded FIFO admission, retains
opaque launch/process authority through exact tree exit, enforces ready,
heartbeat, runtime, cancellation, and shutdown deadlines, and publishes
success only after the durable result is re-opened and validated. The checked-in
worker manifest remains empty, so no production worker can yet be selected.
The control listener and durable adapter remain unreachable from the current
production entry point because the dashboard/service engine still fails closed
before readiness.

Electron main supplies four private roots. `appRoot` remains the immutable code
and entrypoint root, `runtimeRoot` is the separately identity-pinned executable
and manifest root, and `dataRoot`/`configRoot` remain writable/private
authorities. The host reads manifests only from these fixed runtime-root paths:

- `runtime-v2/manifests/workers.json`
- `runtime-v2/manifests/services.json`

It opens the sole job store at `<dataRoot>/runtime-v2/runtime-v2.sqlite3` with
admission closed. No executable, argument vector, environment block, service
definition, or worker definition can arrive through bootstrap or HTTP.

Checked-in version-1 source manifests live under
`desktop/runtime-v2/manifests/` and are byte-staged to
`desktop/build-resources/runtime-v2/manifests/`, which packages as
`resources/runtime-v2/manifests/`. Executables are resolved and pinned relative
to `runtimeRoot`; entrypoints are independently resolved and pinned relative to
`appRoot`. The service manifest truthfully covers the dashboard, ChatMock, and
Hermes. The worker manifest remains empty and the source coverage validator
fails closed for both mandatory worker types: the existing Learn worker speaks
legacy Node IPC/start-file orchestration rather than the Runtime V2 ready/event
protocol, while ingestion is still an in-process API pipeline with no finite
worker entrypoint. Neither gap is hidden behind a mock launch definition.

The crate is a member of `native/Cargo.toml`'s workspace so later authorized
workspace checks cannot omit it. Package the resulting fixed binary beside the
Electron runtime adapter only after the real engine and manifests exist. Do not
wire Electron to this fail-closed scaffold; there is no legacy fallback.

No Cargo command, compiler, formatter, build, test, or runtime process was run
while creating this scaffold.
