# Runtime V2 host

This crate reserves the fixed `breadboard-runtime` binary and implements the
private bootstrap plus bounded loopback runtime control plane.

The production service engine must prove that the standalone dashboard is
ready, provide sanitized service status, and own bounded shutdown before the
host emits `runtime-ready`. Still missing from the wider product migration are
the remaining Electron/Next cutovers and parity-gated packaging evidence.
The source includes restart reconciliation plus authenticated job-input
reservation and streaming, job submission, inspection, snapshot-consistent
bounded event replay, ownership-scoped idempotency lookup with
`POST /v1/jobs/lookup`, and durable cancellation control. The lookup body
contains only the original idempotency key; authenticated user, garden, and
conversation authority remains in the private transport headers. Checkpoint and result reads are ownership-scoped and
bounded independently from the small control-message limit. Its one-thread
disposable-worker dispatcher is wired behind the shared admission gate: it
performs bounded FIFO admission, retains opaque launch/process authority
through exact tree exit, enforces ready, heartbeat, runtime, cancellation, and
shutdown deadlines, and publishes success only after the durable result is
re-opened and validated.

The dashboard-only bearer can reserve one opaque input ticket with
`POST /v1/job-inputs`, stream the exact bytes with
`PUT /v1/job-inputs/{uploadId}`, and explicitly clean it with
`POST /v1/job-inputs/{uploadId}/abandon`. Only the exact `PUT` route accepts
either one bounded `Content-Length` or exact HTTP chunked framing. Chunk
extensions, trailers, pipelining, `Expect`, mixed framing, decoded overflow,
scope changes, and lifecycle-bearer access fail closed. Incomplete streams drop
their one-shot core lease, removing the unpublished file and abandoning the
ticket. `GET /v1/jobs/{jobId}/checkpoint` and `/result` return a bounded parsed
JSON envelope without exposing a filesystem path.

Electron main supplies four private roots. `appRoot` remains the immutable code
and entrypoint root, `runtimeRoot` is the separately identity-pinned executable
and manifest root, and `dataRoot`/`configRoot` remain writable/private
authorities. The host reads manifests only from these fixed runtime-root paths:

- `runtime-v2/manifests/workers.json`
- `runtime-v2/manifests/services.json`

It opens the sole job store at `<dataRoot>/runtime-v2/runtime-v2.sqlite3` with
admission closed. No executable, argument vector, environment block, service
definition, or worker definition can arrive through bootstrap or HTTP.

Checked-in versioned source manifests live under
`desktop/runtime-v2/manifests/` and are byte-staged to
`desktop/build-resources/runtime-v2/manifests/`, which packages as
`resources/runtime-v2/manifests/`. Executables are resolved and pinned relative
to `runtimeRoot`; entrypoints are independently resolved and pinned relative to
`appRoot`. The service manifest truthfully covers the dashboard, ChatMock,
Hermes, and the on-demand GBrain retrieval adapter. GBrain uses its own closed
trusted environment profile, depends on ChatMock, and carries a positive idle
TTL; no executable path, environment value, or adapter secret is caller
supplied. The worker manifest registers finite one-job Learn,
document-ingestion, Quartz-publish, and office-artifact adapters. Each consumes
the fixed Runtime V2 `start.json`, reserves stdout for fenced worker events, and
uses stdin only for the supervisor's cooperative stop record.

The crate is a member of `native/Cargo.toml`'s workspace so authorized workspace
checks cannot omit it. Package the resulting fixed binary beside the Electron
runtime adapter only after the product-level parity and packaging gates pass;
there is no legacy runtime fallback.
