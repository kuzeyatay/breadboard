use crate::shutdown::ShutdownCoordinator;
use crate::streaming_body::{StreamingBody, StreamingBodyFraming};
use breadboard_runtime_core::{
    AuthenticatedJobContext, ControlPlaneAuthority, MAX_OWNED_JOB_CHECKPOINT_BYTES,
    MAX_OWNED_JOB_RESULT_BYTES,
};
use breadboard_runtime_protocol::{
    parse_job_submission_payload, parse_runtime_desired_state_request,
    parse_runtime_job_idempotency_cancellation_request,
    parse_runtime_job_input_reservation_request, parse_runtime_job_lookup_request,
    parse_runtime_learn_recovery_request, parse_runtime_recall_reconcile_request,
    parse_runtime_recall_status_request, parse_runtime_service_lease_acquire_request,
    parse_runtime_service_lease_release_request, validate_capability_id, validate_identifier,
    validate_scope_id, JobSubmissionPayload, RuntimeCommandAck, RuntimeControlErrorResponse,
    RuntimeDesiredState, RuntimeGatewayId, RuntimeGatewayReconcileResponse,
    RuntimeJobEventsResponse, RuntimeJobIdempotencyCancellationResponse,
    RuntimeJobInputReservationRequest, RuntimeJobInputReservationResponse, RuntimeJobResponse,
    RuntimeMode, RuntimeRecallReconcileRequest, RuntimeRecallReconcileResponse,
    RuntimeRecallStatusResponse, RuntimeScheduleReconcileResponse, RuntimeScheduleStatusResponse,
    RuntimeServiceLeaseAcquireResponse, RuntimeServiceLeaseContractResponse,
    RuntimeServiceLeaseReleaseResponse, RuntimeServiceRetryResponse, RuntimeServiceStatus,
    RuntimeStatusMessage, MAX_CONTROL_TOKEN_BYTES, MAX_JOB_EVENT_REPLAY_RECORDS,
    MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES, MAX_JOB_INPUT_RESERVATION_BODY_BYTES,
    MAX_JOB_INPUT_UPLOAD_BYTES, MAX_JOB_LOOKUP_BODY_BYTES, MAX_JSON_SAFE_INTEGER,
    MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES, MAX_PROTOCOL_LINE_BYTES,
    MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES, MAX_REQUEST_BODY_BYTES, MAX_SCOPE_ID_BYTES,
    MAX_SERVICE_LEASE_REQUEST_BODY_BYTES, RUNTIME_CONTROL_PROTOCOL_VERSION,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::ops::Deref;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;

const MAX_REQUEST_LINE_BYTES: usize = 4 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_HEADER_COUNT: usize = 64;
// One dashboard JavaScript realm can occupy its 24-request client pool. Keep
// eight more authenticated dashboard handlers for other local realms, then an
// independent eight-handler outer reserve for lifecycle control.
const DASHBOARD_CLIENT_POOL_CEILING: usize = 24;
const MIN_CROSS_REALM_DASHBOARD_RESERVE: usize = 8;
const MAX_ACTIVE_DASHBOARD_CONNECTIONS: usize =
    DASHBOARD_CLIENT_POOL_CEILING + MIN_CROSS_REALM_DASHBOARD_RESERVE;
const MIN_LIFECYCLE_CONNECTION_RESERVE: usize = 8;
const MAX_ACTIVE_CONNECTIONS: usize =
    MAX_ACTIVE_DASHBOARD_CONNECTIONS + MIN_LIFECYCLE_CONNECTION_RESERVE;
// A development compiler can pause its Node event loop after Undici connects
// but before it writes the first request byte. Both development modes get a
// bounded compiler-stall allowance; Packaged retains the strict two-second
// prelude. Once headers arrive, every mode uses the strict body deadline.
const REQUEST_PRELUDE_DEADLINE: Duration = Duration::from_secs(2);
const DEVELOPMENT_REQUEST_PRELUDE_DEADLINE: Duration = Duration::from_secs(60);
const REQUEST_DEADLINE: Duration = Duration::from_secs(2);
const RESPONSE_WRITE_DEADLINE: Duration = Duration::from_secs(2);
const UPLOAD_READ_STALL_DEADLINE: Duration = Duration::from_secs(30);
const UPLOAD_ABSOLUTE_DEADLINE: Duration = Duration::from_secs(15 * 60);
const UPLOAD_SHUTDOWN_POLL_INTERVAL: Duration = Duration::from_millis(250);
const MAX_JOB_OUTPUT_CONTENT_BYTES: usize =
    if MAX_OWNED_JOB_RESULT_BYTES > MAX_OWNED_JOB_CHECKPOINT_BYTES {
        MAX_OWNED_JOB_RESULT_BYTES
    } else {
        MAX_OWNED_JOB_CHECKPOINT_BYTES
    };
const MAX_JOB_OUTPUT_RESPONSE_BYTES: usize = MAX_JOB_OUTPUT_CONTENT_BYTES + MAX_PROTOCOL_LINE_BYTES;
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(20);

// These coalesced diagnostics carry no authority, route, address, or payload.
// They distinguish the two bounded admission gates in field failures without
// turning a burst into unbounded stderr output.
static OUTER_SATURATION_REPORTED: AtomicBool = AtomicBool::new(false);
static DASHBOARD_SATURATION_REPORTED: AtomicBool = AtomicBool::new(false);
static CONNECTION_DIAGNOSTICS_REPORTED: AtomicUsize = AtomicUsize::new(0);
const MAX_CONNECTION_DIAGNOSTICS: usize = 32;

const fn request_prelude_deadline(mode: RuntimeMode) -> Duration {
    match mode {
        RuntimeMode::Lean | RuntimeMode::Hot => DEVELOPMENT_REQUEST_PRELUDE_DEADLINE,
        RuntimeMode::Packaged => REQUEST_PRELUDE_DEADLINE,
    }
}

const USER_ID_HEADER: &str = "x-breadboard-user-id";
const GARDEN_ID_HEADER: &str = "x-breadboard-garden-id";
const CONVERSATION_ID_HEADER: &str = "x-breadboard-conversation-id";

#[derive(Debug, Error)]
pub(crate) enum ControlError {
    #[error("binding the private loopback control listener failed: {0}")]
    Bind(io::Error),
    #[error("reading the private control listener address failed: {0}")]
    LocalAddress(io::Error),
    #[error("configuring the private control listener failed: {0}")]
    ListenerConfiguration(io::Error),
    #[error("accepting a private control connection failed: {0}")]
    Accept(io::Error),
    #[error("serving a private control connection failed: {0}")]
    Connection(io::Error),
    #[error("runtime status provider failed")]
    Status,
    #[error("runtime generated an invalid status response: {0}")]
    InvalidStatus(String),
    #[error("runtime control response exceeded its protocol bound")]
    OversizedResponse,
}

#[derive(Debug)]
enum RequestError {
    Io(io::Error),
    Deadline,
    Closed,
    Oversized,
    Malformed,
}

struct ControlRequest {
    method: String,
    path: String,
    authorization: Option<SensitiveHeaderValue>,
    user_id: Option<i64>,
    garden_id: Option<String>,
    conversation_id: Option<String>,
    body: SensitiveRequestBuffer,
}

struct ControlRequestPrelude {
    head: ParsedRequestHead,
    body_prefix: SensitiveRequestBuffer,
}

/// The control server performs transport authentication and creates the
/// opaque owner context. A concrete runtime engine implements only these
/// already-authorized operations; it never receives raw HTTP headers or the
/// control bearer.
pub(crate) trait RuntimeJobControl: Send + Sync {
    fn reserve_job_input(
        &self,
        context: &AuthenticatedJobContext,
        request: &RuntimeJobInputReservationRequest,
    ) -> Result<RuntimeJobInputReservationResponse, RuntimeJobControlError>;

    fn upload_job_input(
        &self,
        context: &AuthenticatedJobContext,
        upload_id: &str,
        body: &mut dyn Read,
    ) -> Result<RuntimeJobInputSeal, RuntimeJobControlError>;

    fn abandon_job_input(
        &self,
        context: &AuthenticatedJobContext,
        upload_id: &str,
    ) -> Result<(), RuntimeJobControlError>;

    fn submit_job(
        &self,
        context: &AuthenticatedJobContext,
        payload: &JobSubmissionPayload,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError>;

    fn lookup_job(
        &self,
        context: &AuthenticatedJobContext,
        idempotency_key: &str,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError>;

    fn cancel_job_by_idempotency_key(
        &self,
        context: &AuthenticatedJobContext,
        idempotency_key: &str,
    ) -> Result<RuntimeJobIdempotencyCancellationResponse, RuntimeJobControlError>;

    fn inspect_job(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError>;

    fn replay_job_events(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
        after: u64,
        limit: usize,
    ) -> Result<RuntimeJobEventsResponse, RuntimeJobControlError>;

    fn cancel_job(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError>;

    fn read_job_checkpoint(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<Vec<u8>, RuntimeJobControlError>;

    fn read_job_result(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<Vec<u8>, RuntimeJobControlError>;
}

pub(crate) struct RuntimeJobInputSeal {
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

/// Authenticated service control is deliberately separate from job control.
/// Implementations receive only route-bound validated identifiers and payloads;
/// durable lease claims and process authority remain inside the service engine.
pub(crate) trait RuntimeServiceControl: Send + Sync {
    /// Returns passive deadline metadata derived from the trusted manifest.
    /// This must not acquire a lease, poll health, or start a process.
    fn service_lease_contract(
        &self,
        service_id: &str,
    ) -> Result<RuntimeServiceLeaseContractResponse, RuntimeServiceControlError>;

    fn acquire_service_lease(
        &self,
        service_id: &str,
        reason: &str,
    ) -> Result<RuntimeServiceLeaseAcquireResponse, RuntimeServiceControlError>;

    fn release_service_lease(
        &self,
        lease_id: &str,
    ) -> Result<RuntimeServiceLeaseReleaseResponse, RuntimeServiceControlError>;

    fn retry_service(
        &self,
        service_id: &str,
    ) -> Result<RuntimeServiceRetryResponse, RuntimeServiceControlError>;

    fn reconcile_gateway(
        &self,
        context: &AuthenticatedJobContext,
        gateway: RuntimeGatewayId,
        desired_state: RuntimeDesiredState,
    ) -> Result<RuntimeGatewayReconcileResponse, RuntimeServiceControlError>;

    fn reconcile_schedule(
        &self,
        context: &AuthenticatedJobContext,
        schedule_id: &str,
        desired_state: RuntimeDesiredState,
    ) -> Result<RuntimeScheduleReconcileResponse, RuntimeServiceControlError>;

    fn schedule_status(
        &self,
        context: &AuthenticatedJobContext,
        schedule_id: &str,
    ) -> Result<RuntimeScheduleStatusResponse, RuntimeServiceControlError>;

    fn reconcile_recall(
        &self,
        context: &AuthenticatedJobContext,
        request: RuntimeRecallReconcileRequest,
    ) -> Result<RuntimeRecallReconcileResponse, RuntimeServiceControlError>;

    fn recall_status(
        &self,
        context: &AuthenticatedJobContext,
    ) -> Result<RuntimeRecallStatusResponse, RuntimeServiceControlError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeServiceControlError {
    InvalidRequest,
    NotFound,
    Conflict,
    ResourceExhausted {
        required_headroom_mb: u64,
        available_headroom_mb: u64,
    },
    Unavailable,
    Internal,
}

/// Sanitized job-control failures. Implementations cannot attach arbitrary
/// error strings, paths, commands, environments, or provider secrets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeJobControlError {
    InvalidRequest,
    PayloadTooLarge,
    InputQuotaExceeded,
    CancellationQuotaExceeded,
    CancelledBeforeSubmission,
    Forbidden,
    NotFound,
    Conflict,
    OutputNotReady,
    Unavailable,
    Internal,
}

enum JobRoute {
    Submit,
    Lookup,
    CancelByIdempotency,
    Inspect {
        job_id: String,
    },
    Events {
        job_id: String,
        after: u64,
        limit: usize,
    },
    Cancel {
        job_id: String,
    },
    Checkpoint {
        job_id: String,
    },
    Result {
        job_id: String,
    },
}

enum JobInputRoute {
    Reserve,
    Upload { upload_id: String },
    Abandon { upload_id: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeJobInputSealResponse<'a> {
    #[serde(rename = "type")]
    message_type: &'static str,
    protocol_version: u32,
    upload_id: &'a str,
    state: &'static str,
    size_bytes: u64,
    sha256: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeJobOutputResponse<'a> {
    #[serde(rename = "type")]
    message_type: &'static str,
    protocol_version: u32,
    job_id: &'a str,
    kind: &'static str,
    content: Value,
}

enum ServiceRoute {
    Contract { service_id: String },
    Acquire { service_id: String },
    Release { lease_id: String },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeServiceRetryRequest {}

/// Owns the complete untrusted request buffer so that a bearer token is
/// erased on every success and error path instead of remaining in freed heap
/// storage after parsing.
struct SensitiveRequestBuffer(Vec<u8>);

impl SensitiveRequestBuffer {
    fn with_capacity(capacity: usize) -> Self {
        Self(Vec::with_capacity(capacity))
    }

    fn extend_from_slice(&mut self, bytes: &[u8]) {
        self.0.extend_from_slice(bytes);
    }

    fn take(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.0)
    }
}

impl Deref for SensitiveRequestBuffer {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for SensitiveRequestBuffer {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

struct SensitiveHeaderValue(Vec<u8>);

impl SensitiveHeaderValue {
    fn new(value: &str) -> Self {
        Self(value.as_bytes().to_vec())
    }
}

impl Deref for SensitiveHeaderValue {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        // Constructed only from a validated UTF-8 request-head slice.
        std::str::from_utf8(&self.0).expect("authorization header must remain UTF-8")
    }
}

impl Drop for SensitiveHeaderValue {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

struct UploadSocketReader<'a> {
    stream: &'a mut TcpStream,
    shutdown: &'a ShutdownCoordinator,
    absolute_deadline: Instant,
    stall_deadline: Instant,
    prior_read_timeout: Option<Duration>,
}

impl UploadSocketReader<'_> {
    fn new<'a>(
        stream: &'a mut TcpStream,
        shutdown: &'a ShutdownCoordinator,
    ) -> io::Result<UploadSocketReader<'a>> {
        let prior_read_timeout = stream.read_timeout()?;
        // Windows blocking socket reads did not reliably wake when a timeout
        // was shortened after the request head had already been consumed.
        // Nonblocking reads plus the coordinator condition variable make
        // shutdown wakeups deterministic without polling the CPU.
        stream.set_nonblocking(true)?;
        Ok(UploadSocketReader {
            stream,
            shutdown,
            absolute_deadline: Instant::now() + UPLOAD_ABSOLUTE_DEADLINE,
            stall_deadline: Instant::now() + UPLOAD_READ_STALL_DEADLINE,
            prior_read_timeout,
        })
    }

    fn next_wait(&self) -> io::Result<Duration> {
        if self.shutdown.is_requested() {
            return Err(upload_shutdown_error());
        }
        let absolute_remaining = self
            .absolute_deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "upload deadline elapsed"))?;
        let stall_remaining = self
            .stall_deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "upload read stalled"))?;
        Ok(absolute_remaining
            .min(stall_remaining)
            .min(UPLOAD_SHUTDOWN_POLL_INTERVAL))
    }
}

impl Drop for UploadSocketReader<'_> {
    fn drop(&mut self) {
        // The connection writes its terminal response after this reader is
        // dropped, so restore the socket mode established by request parsing.
        let _ = self.stream.set_nonblocking(false);
        let _ = self.stream.set_read_timeout(self.prior_read_timeout);
    }
}

impl Read for UploadSocketReader<'_> {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        // Sink backpressure happens between calls to `read`; it must count
        // toward the absolute upload deadline but not toward a socket stall.
        // Start the no-progress budget only when the consumer asks for bytes.
        self.stall_deadline = Instant::now() + UPLOAD_READ_STALL_DEADLINE;
        loop {
            let wait = self.next_wait()?;
            match self.stream.read(output) {
                Ok(received) => return Ok(received),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if self.shutdown.wait_for_shutdown(wait) {
                        return Err(upload_shutdown_error());
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                    // Windows can report an interrupted nonblocking read
                    // repeatedly while the socket is still open. Apply the
                    // same coordinator-backed wait as WouldBlock so an EINTR
                    // cannot turn one stalled upload into a CPU spin.
                    if self.shutdown.wait_for_shutdown(wait) {
                        return Err(upload_shutdown_error());
                    }
                }
                Err(error) => return Err(error),
            }
        }
    }
}

fn upload_shutdown_error() -> io::Error {
    // `Read::read_to_end` and `io::copy` are required to retry Interrupted.
    // Runtime shutdown is terminal for this request, so use a non-retryable
    // transport kind that every ordinary Read consumer will propagate.
    io::Error::new(
        io::ErrorKind::ConnectionAborted,
        "runtime shutdown interrupted upload",
    )
}

pub(crate) struct BoundControlListener {
    listener: TcpListener,
    authority: String,
    base_url: String,
}

/// Lifetime-bound inputs shared by every connection accepted by one control
/// server. Keeping the scoped authorities and mutation owners together makes
/// the server boundary explicit without copying either bearer or owner.
pub(crate) struct ControlServerConfig<'a> {
    pub(crate) authorities: &'a ControlAuthorities,
    pub(crate) mode: RuntimeMode,
    pub(crate) runtime_pid: u32,
    pub(crate) shutdown: &'a Arc<ShutdownCoordinator>,
    pub(crate) job_control: &'a dyn RuntimeJobControl,
    pub(crate) service_control: &'a dyn RuntimeServiceControl,
}

struct ActiveConnectionGuard(Arc<AtomicUsize>);

impl Drop for ActiveConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

struct DashboardConnectionGuard(Arc<AtomicUsize>);

impl DashboardConnectionGuard {
    fn try_acquire(active: &Arc<AtomicUsize>) -> Option<Self> {
        active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                (current < MAX_ACTIVE_DASHBOARD_CONNECTIONS).then_some(current + 1)
            })
            .ok()?;
        Some(Self(Arc::clone(active)))
    }
}

impl Drop for DashboardConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Distinct, non-serializable authorities for the two private control-plane
/// callers. The Electron lifecycle bridge may observe status and request
/// shutdown; the dashboard compatibility server may submit user-scoped work.
/// Neither bearer can be used in place of the other.
pub(crate) struct ControlAuthorities {
    lifecycle: ControlPlaneAuthority,
    dashboard: ControlPlaneAuthority,
}

impl ControlAuthorities {
    pub(crate) fn new(lifecycle: ControlPlaneAuthority, dashboard: ControlPlaneAuthority) -> Self {
        Self {
            lifecycle,
            dashboard,
        }
    }

    fn authenticate(&self, authorization: Option<&str>) -> Option<ControlAuthorityRole> {
        // Always evaluate both comparisons. Apart from avoiding a role-based
        // timing shortcut, this fails closed if two authorities are ever
        // accidentally configured with the same bearer.
        let lifecycle = self.lifecycle.verify_bearer(authorization).is_ok();
        let dashboard = self.dashboard.verify_bearer(authorization).is_ok();
        match (lifecycle, dashboard) {
            (true, false) => Some(ControlAuthorityRole::Lifecycle),
            (false, true) => Some(ControlAuthorityRole::Dashboard),
            _ => None,
        }
    }

    fn dashboard(&self) -> &ControlPlaneAuthority {
        &self.dashboard
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ControlAuthorityRole {
    Lifecycle,
    Dashboard,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ControlRouteAuthority {
    Deny,
    Either,
    Lifecycle,
    Dashboard,
}

fn route_authority(path: &str) -> ControlRouteAuthority {
    if path == "/v1/status" {
        ControlRouteAuthority::Either
    } else if path == "/v1/shutdown" || path.starts_with("/v1/lifecycle/services/") {
        ControlRouteAuthority::Lifecycle
    } else if path == "/v1/internal/jobs/learn-recovery"
        || path == "/v1/jobs"
        || path.starts_with("/v1/jobs/")
        || path == "/v1/job-inputs"
        || path.starts_with("/v1/job-inputs/")
        || path.starts_with("/v1/services/")
        || path.starts_with("/v1/gateways/")
        || path.starts_with("/v1/schedules/")
        || path.starts_with("/v1/capabilities/")
        || path.starts_with("/v1/leases/")
    {
        ControlRouteAuthority::Dashboard
    } else {
        // New routes are closed until their required authority is explicitly
        // classified. This prevents a future handler from inheriting access
        // from whichever private bearer happened to call it first.
        ControlRouteAuthority::Deny
    }
}

fn role_allows(role: ControlAuthorityRole, required: ControlRouteAuthority) -> bool {
    matches!(
        (role, required),
        (_, ControlRouteAuthority::Either)
            | (
                ControlAuthorityRole::Lifecycle,
                ControlRouteAuthority::Lifecycle
            )
            | (
                ControlAuthorityRole::Dashboard,
                ControlRouteAuthority::Dashboard
            )
    )
}

impl BoundControlListener {
    /// The address is a literal IPv4 loopback and the OS chooses the port.
    pub(crate) fn bind_ephemeral_loopback() -> Result<Self, ControlError> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(ControlError::Bind)?;
        let address = listener.local_addr().map_err(ControlError::LocalAddress)?;
        if address.ip() != IpAddr::V4(std::net::Ipv4Addr::LOCALHOST) || address.port() == 0 {
            return Err(ControlError::Bind(io::Error::new(
                io::ErrorKind::AddrNotAvailable,
                "listener did not bind literal IPv4 loopback",
            )));
        }
        listener
            .set_nonblocking(true)
            .map_err(ControlError::ListenerConfiguration)?;
        let authority = format!("127.0.0.1:{}", address.port());
        let base_url = format!("http://{authority}");
        Ok(Self {
            listener,
            authority,
            base_url,
        })
    }

    pub(crate) fn base_url(&self) -> &str {
        &self.base_url
    }

    /// A small bounded set of scoped connection handlers keeps lifecycle and
    /// status requests responsive while a real service acquire waits through a
    /// manifest-bounded cold start. Every request read and response write still
    /// has its own short absolute deadline.
    pub(crate) fn serve_with_jobs<F>(
        self,
        config: ControlServerConfig<'_>,
        service_statuses: F,
    ) -> Result<(), ControlError>
    where
        F: Fn() -> Result<Vec<RuntimeServiceStatus>, String> + Sync,
    {
        self.serve_loop(config, &service_statuses)
    }

    fn serve_loop<F>(
        self,
        config: ControlServerConfig<'_>,
        service_statuses: &F,
    ) -> Result<(), ControlError>
    where
        F: Fn() -> Result<Vec<RuntimeServiceStatus>, String> + Sync,
    {
        let ControlServerConfig {
            authorities,
            mode,
            runtime_pid,
            shutdown,
            job_control,
            service_control,
        } = config;
        let request_prelude_deadline = request_prelude_deadline(mode);
        let active = Arc::new(AtomicUsize::new(0));
        let active_dashboard = Arc::new(AtomicUsize::new(0));
        let (fatal_sender, fatal_receiver) = mpsc::channel::<ControlError>();
        let listener = &self.listener;
        let authority = self.authority.as_str();
        eprintln!(
            "[runtime-control] bounded admission configured preludeDeadlineMs={} bodyDeadlineMs={} dashboardHandlers={} outerHandlers={}",
            request_prelude_deadline.as_millis(),
            REQUEST_DEADLINE.as_millis(),
            MAX_ACTIVE_DASHBOARD_CONNECTIONS,
            MAX_ACTIVE_CONNECTIONS
        );
        thread::scope(|scope| {
            while !shutdown.is_requested() {
                if let Ok(error) = fatal_receiver.try_recv() {
                    return Err(error);
                }
                if active.load(Ordering::Acquire) >= MAX_ACTIVE_CONNECTIONS {
                    if !OUTER_SATURATION_REPORTED.swap(true, Ordering::AcqRel) {
                        eprintln!(
                            "[runtime-control] outer admission saturated active={MAX_ACTIVE_CONNECTIONS}"
                        );
                    }
                    // Keep the handler/thread budget hard-bounded without
                    // resetting an already-connected dashboard request. The
                    // listener backlog provides bounded transport pressure;
                    // request deadlines reclaim every admitted handler.
                    thread::sleep(ACCEPT_POLL_INTERVAL);
                    continue;
                }
                match listener.accept() {
                    Ok((mut stream, peer)) => {
                        if !peer.ip().is_loopback() {
                            continue;
                        }
                        // The listener must remain nonblocking so shutdown and
                        // fatal events are polled. On Windows an accepted
                        // socket can retain nonblocking behavior; normalize it
                        // before applying per-request read/write deadlines.
                        // Otherwise an ordinary first-byte race is surfaced as
                        // WouldBlock and mistaken for an expired deadline.
                        if let Err(error) = stream.set_nonblocking(false) {
                            report_connection_io("accepted-blocking", &error);
                            continue;
                        }
                        let previous = active.fetch_add(1, Ordering::AcqRel);
                        debug_assert!(previous < MAX_ACTIVE_CONNECTIONS);
                        let guard = ActiveConnectionGuard(Arc::clone(&active));
                        let active_dashboard = Arc::clone(&active_dashboard);
                        let fatal_sender = fatal_sender.clone();
                        scope.spawn(move || {
                            let _guard = guard;
                            let result = serve_connection(
                                &mut stream,
                                authority,
                                authorities,
                                request_prelude_deadline,
                                &active_dashboard,
                                runtime_pid,
                                shutdown,
                                service_statuses,
                                job_control,
                                service_control,
                            );
                            // A peer reset or response timeout belongs to that
                            // bounded connection. Contract/status failures are
                            // runtime-fatal and return to the accept owner.
                            if let Err(error) = result {
                                match error {
                                    ControlError::Connection(error) => {
                                        report_connection_io("handler", &error);
                                    }
                                    fatal => {
                                        let _ = fatal_sender.send(fatal);
                                    }
                                }
                            }
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(ACCEPT_POLL_INTERVAL);
                    }
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                    Err(error) => return Err(ControlError::Accept(error)),
                }
            }
            if let Ok(error) = fatal_receiver.try_recv() {
                Err(error)
            } else {
                Ok(())
            }
        })
    }
}

// Keep the distinct authenticated control roles and mutation owners explicit
// at the one socket-dispatch boundary instead of hiding them in an untyped
// request context that could be copied into a handler.
#[allow(clippy::too_many_arguments)]
fn serve_connection<F>(
    stream: &mut TcpStream,
    expected_authority: &str,
    authorities: &ControlAuthorities,
    request_prelude_deadline: Duration,
    active_dashboard: &Arc<AtomicUsize>,
    runtime_pid: u32,
    shutdown: &Arc<ShutdownCoordinator>,
    service_statuses: &F,
    job_control: &dyn RuntimeJobControl,
    service_control: &dyn RuntimeServiceControl,
) -> Result<(), ControlError>
where
    F: Fn() -> Result<Vec<RuntimeServiceStatus>, String>,
{
    let prelude_deadline = Instant::now() + request_prelude_deadline;
    let mut prelude = match read_request_prelude(stream, expected_authority, prelude_deadline) {
        Ok(prelude) => prelude,
        Err(error) => {
            report_request_failure("prelude", &error);
            if let RequestError::Io(error) = error {
                return Err(ControlError::Connection(error));
            }
            let _ =
                write_control_response(stream, 400, "Bad Request", b"{\"error\":\"bad-request\"}");
            return Ok(());
        }
    };
    let request_deadline = Instant::now() + REQUEST_DEADLINE;

    let Some(role) = authorities.authenticate(prelude.head.authorization.as_deref()) else {
        write_control_response(stream, 401, "Unauthorized", b"{\"error\":\"unauthorized\"}")?;
        return Ok(());
    };

    // Count only authenticated dashboard peers. Lifecycle authority bypasses
    // this gate and remains able to use the outer handler reserve while all
    // dashboard slots are occupied.
    let _dashboard_guard = match role {
        ControlAuthorityRole::Dashboard => {
            let Some(guard) = DashboardConnectionGuard::try_acquire(active_dashboard) else {
                if !DASHBOARD_SATURATION_REPORTED.swap(true, Ordering::AcqRel) {
                    eprintln!(
                        "[runtime-control] dashboard admission saturated active={MAX_ACTIVE_DASHBOARD_CONNECTIONS}"
                    );
                }
                return reject_saturated_dashboard_request(stream, prelude, request_deadline);
            };
            Some(guard)
        }
        ControlAuthorityRole::Lifecycle => None,
    };

    if !role_allows(role, route_authority(&prelude.head.path)) {
        write_control_response(stream, 403, "Forbidden", b"{\"error\":\"forbidden\"}")?;
        return Ok(());
    }

    if let Ok(JobInputRoute::Upload { upload_id }) =
        parse_job_input_route(&prelude.head.method, &prelude.head.path)
    {
        return serve_job_input_upload(
            stream,
            authorities.dashboard(),
            shutdown,
            job_control,
            &mut prelude,
            &upload_id,
        );
    }

    let request = match complete_buffered_request(stream, prelude, request_deadline) {
        Ok(request) => request,
        Err(RequestError::Io(error)) => return Err(ControlError::Connection(error)),
        Err(
            RequestError::Deadline
            | RequestError::Closed
            | RequestError::Oversized
            | RequestError::Malformed,
        ) => {
            let _ =
                write_control_response(stream, 400, "Bad Request", b"{\"error\":\"bad-request\"}");
            return Ok(());
        }
    };

    if request.path == "/v1/job-inputs" || request.path.starts_with("/v1/job-inputs/") {
        return serve_job_input_request(
            stream,
            authorities.dashboard(),
            shutdown,
            job_control,
            &request,
        );
    }

    if request.path == "/v1/internal/jobs/learn-recovery" {
        return serve_learn_recovery_request(
            stream,
            authorities.dashboard(),
            shutdown,
            job_control,
            &request,
        );
    }

    if request.path == "/v1/jobs" || request.path.starts_with("/v1/jobs/") {
        return serve_job_request(
            stream,
            authorities.dashboard(),
            shutdown,
            job_control,
            &request,
        );
    }

    if request.path.starts_with("/v1/lifecycle/services/") {
        return serve_lifecycle_service_request(stream, service_control, &request);
    }

    if request.path.starts_with("/v1/gateways/") || request.path.starts_with("/v1/schedules/") {
        return serve_schedule_gateway_request(
            stream,
            authorities.dashboard(),
            service_control,
            &request,
        );
    }

    if matches!(
        request.path.as_str(),
        "/v1/services/recall/reconcile" | "/v1/services/recall/status"
    ) {
        return serve_recall_service_request(
            stream,
            authorities.dashboard(),
            service_control,
            &request,
        );
    }

    if request.path.starts_with("/v1/services/") || request.path.starts_with("/v1/leases/") {
        return serve_service_request(stream, service_control, &request);
    }

    match (request.method.as_str(), request.path.as_str()) {
        ("GET", "/v1/status") => {
            let services = service_statuses().map_err(|_| ControlError::Status)?;
            let status = RuntimeStatusMessage::RuntimeStatus {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                runtime_pid,
                accepting_work: shutdown.is_accepting_work(),
                services,
            };
            status
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            let body = bounded_json(&status)?;
            write_control_response(stream, 200, "OK", &body)?;
        }
        ("POST", "/v1/shutdown") => {
            shutdown.request_shutdown();
            let acknowledgement = RuntimeCommandAck { ok: true };
            acknowledgement
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            let body = bounded_json(&acknowledgement)?;
            write_control_response(stream, 200, "OK", &body)?;
        }
        (_, "/v1/status" | "/v1/shutdown") => {
            write_control_response(
                stream,
                405,
                "Method Not Allowed",
                b"{\"error\":\"method-not-allowed\"}",
            )?;
        }
        _ => {
            write_control_response(stream, 404, "Not Found", b"{\"error\":\"not-found\"}")?;
        }
    }
    Ok(())
}

fn reject_saturated_dashboard_request(
    stream: &mut TcpStream,
    prelude: ControlRequestPrelude,
    request_deadline: Instant,
) -> Result<(), ControlError> {
    // Draining a declared JSON entity prevents Windows from replacing the 503
    // with TCP RST when this stream closes. Only routes whose ordinary parser
    // already assigns a small fixed body limit are eligible. In particular,
    // raw job-input uploads are never drained here: their streaming bound is
    // intentionally far larger and overload must not turn it into discard IO.
    let bounded_json_body = prelude.head.transfer_encoding.is_none()
        && prelude.head.content_length.is_some_and(|length| length > 0)
        && accepts_json_request_body(&prelude.head.method, &prelude.head.path)
        && prelude.head.content_length.is_some_and(|length| {
            length <= request_body_limit(&prelude.head.method, &prelude.head.path) as u64
        })
        && prelude
            .head
            .content_type
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("application/json"));

    if bounded_json_body {
        match complete_buffered_request(stream, prelude, request_deadline) {
            Ok(request) => drop(request),
            Err(RequestError::Io(error)) => return Err(ControlError::Connection(error)),
            Err(
                RequestError::Deadline
                | RequestError::Closed
                | RequestError::Oversized
                | RequestError::Malformed,
            ) => {
                let _ = write_control_response(
                    stream,
                    400,
                    "Bad Request",
                    b"{\"error\":\"bad-request\"}",
                );
                return Ok(());
            }
        }
    }

    write_control_response(
        stream,
        503,
        "Service Unavailable",
        b"{\"error\":\"dashboard-control-saturated\"}",
    )
}

fn serve_recall_service_request(
    stream: &mut TcpStream,
    authority: &ControlPlaneAuthority,
    service_control: &dyn RuntimeServiceControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    if request.method != "POST" {
        return write_control_response(
            stream,
            405,
            "Method Not Allowed",
            b"{\"error\":\"method-not-allowed\"}",
        );
    }
    if request.path.contains('%')
        || request.path.contains('?')
        || request.path.contains('#')
        || request.garden_id.is_some()
        || request.conversation_id.is_some()
    {
        return write_service_control_error(stream, RuntimeServiceControlError::InvalidRequest);
    }
    let context = match authenticate_job_context(
        authority,
        request.authorization.as_deref(),
        request.user_id,
        None,
        None,
    ) {
        Ok(context) => context,
        Err(_) => {
            return write_service_control_error(stream, RuntimeServiceControlError::InvalidRequest)
        }
    };
    match request.path.as_str() {
        "/v1/services/recall/reconcile" => {
            let payload = match parse_runtime_recall_reconcile_request(&request.body) {
                Ok(payload) => payload,
                Err(_) => {
                    return write_service_control_error(
                        stream,
                        RuntimeServiceControlError::InvalidRequest,
                    )
                }
            };
            let desired_state = payload.desired_state;
            let response = match service_control.reconcile_recall(&context, payload) {
                Ok(response) => response,
                Err(error) => return write_service_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            if response.service_id != "recall" || response.desired_state != desired_state {
                return Err(ControlError::InvalidStatus(
                    "Recall reconciliation escaped its route binding".into(),
                ));
            }
            write_bounded_protocol_response(stream, 200, "OK", &response)
        }
        "/v1/services/recall/status" => {
            if parse_runtime_recall_status_request(&request.body).is_err() {
                return write_service_control_error(
                    stream,
                    RuntimeServiceControlError::InvalidRequest,
                );
            }
            let response = match service_control.recall_status(&context) {
                Ok(response) => response,
                Err(error) => return write_service_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            if response.service_id != "recall" {
                return Err(ControlError::InvalidStatus(
                    "Recall status escaped its route binding".into(),
                ));
            }
            write_bounded_protocol_response(stream, 200, "OK", &response)
        }
        _ => write_control_response(stream, 404, "Not Found", b"{\"error\":\"not-found\"}"),
    }
}

fn serve_schedule_gateway_request(
    stream: &mut TcpStream,
    authority: &ControlPlaneAuthority,
    service_control: &dyn RuntimeServiceControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    if request.path.contains('%') || request.path.contains('?') || request.path.contains('#') {
        return write_control_response(stream, 400, "Bad Request", b"{\"error\":\"bad-request\"}");
    }
    if request.method != "POST" {
        return write_control_response(
            stream,
            405,
            "Method Not Allowed",
            b"{\"error\":\"method-not-allowed\"}",
        );
    }
    if request.garden_id.is_some() || request.conversation_id.is_some() {
        return write_service_control_error(stream, RuntimeServiceControlError::InvalidRequest);
    }
    let context = match authenticate_job_context(
        authority,
        request.authorization.as_deref(),
        request.user_id,
        None,
        None,
    ) {
        Ok(context) => context,
        Err(_) => {
            return write_service_control_error(stream, RuntimeServiceControlError::InvalidRequest)
        }
    };

    if let Some(gateway) = request
        .path
        .strip_prefix("/v1/gateways/")
        .and_then(|rest| rest.strip_suffix("/reconcile"))
    {
        let gateway = match gateway {
            "telegram" => RuntimeGatewayId::Telegram,
            "whatsapp" => RuntimeGatewayId::Whatsapp,
            _ => {
                return write_control_response(
                    stream,
                    404,
                    "Not Found",
                    b"{\"error\":\"not-found\"}",
                )
            }
        };
        let payload = match parse_runtime_desired_state_request(&request.body) {
            Ok(payload) => payload,
            Err(_) => {
                return write_service_control_error(
                    stream,
                    RuntimeServiceControlError::InvalidRequest,
                )
            }
        };
        let response =
            match service_control.reconcile_gateway(&context, gateway, payload.desired_state) {
                Ok(response) => response,
                Err(error) => return write_service_control_error(stream, error),
            };
        response
            .validate()
            .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
        if response.gateway != gateway || response.desired_state != payload.desired_state {
            return Err(ControlError::InvalidStatus(
                "runtime gateway reconciliation escaped its route binding".into(),
            ));
        }
        return write_bounded_protocol_response(
            stream,
            200,
            "OK",
            &serde_json::json!({
                "ok": true,
                "result": response,
            }),
        );
    }

    if request.path == "/v1/schedules/email-poll/reconcile" {
        let payload = match parse_runtime_desired_state_request(&request.body) {
            Ok(payload) => payload,
            Err(_) => {
                return write_service_control_error(
                    stream,
                    RuntimeServiceControlError::InvalidRequest,
                )
            }
        };
        let response =
            match service_control.reconcile_schedule(&context, "email-poll", payload.desired_state)
            {
                Ok(response) => response,
                Err(error) => return write_service_control_error(stream, error),
            };
        response
            .validate()
            .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
        if response.schedule_id != "email-poll" || response.desired_state != payload.desired_state {
            return Err(ControlError::InvalidStatus(
                "runtime schedule reconciliation escaped its route binding".into(),
            ));
        }
        return write_bounded_protocol_response(
            stream,
            200,
            "OK",
            &serde_json::json!({
                "ok": true,
                "result": response,
            }),
        );
    }

    if request.path == "/v1/schedules/email-poll/status" {
        if serde_json::from_slice::<RuntimeServiceRetryRequest>(&request.body).is_err() {
            return write_service_control_error(stream, RuntimeServiceControlError::InvalidRequest);
        }
        let response = match service_control.schedule_status(&context, "email-poll") {
            Ok(response) => response,
            Err(error) => return write_service_control_error(stream, error),
        };
        response
            .validate()
            .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
        if response.schedule_id != "email-poll" {
            return Err(ControlError::InvalidStatus(
                "runtime schedule status escaped its route binding".into(),
            ));
        }
        return write_bounded_protocol_response(
            stream,
            200,
            "OK",
            &serde_json::json!({
                "ok": true,
                "result": response,
            }),
        );
    }
    write_control_response(stream, 404, "Not Found", b"{\"error\":\"not-found\"}")
}

fn serve_lifecycle_service_request(
    stream: &mut TcpStream,
    service_control: &dyn RuntimeServiceControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    if request.path.contains('%') || request.path.contains('?') || request.path.contains('#') {
        return write_control_response(stream, 400, "Bad Request", b"{\"error\":\"bad-request\"}");
    }
    let Some(service_id) = request
        .path
        .strip_prefix("/v1/lifecycle/services/")
        .and_then(|rest| rest.strip_suffix("/retry"))
    else {
        return write_control_response(stream, 404, "Not Found", b"{\"error\":\"not-found\"}");
    };
    if service_id.is_empty()
        || service_id.contains('/')
        || validate_identifier("serviceId", service_id).is_err()
    {
        return write_control_response(stream, 400, "Bad Request", b"{\"error\":\"bad-request\"}");
    }
    if request.method != "POST" {
        return write_control_response(
            stream,
            405,
            "Method Not Allowed",
            b"{\"error\":\"method-not-allowed\"}",
        );
    }
    if serde_json::from_slice::<RuntimeServiceRetryRequest>(&request.body).is_err() {
        return write_service_control_error(stream, RuntimeServiceControlError::InvalidRequest);
    }
    let response = match service_control.retry_service(service_id) {
        Ok(response) => response,
        Err(error) => return write_service_control_error(stream, error),
    };
    response
        .validate()
        .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
    if response.service_id != service_id {
        return Err(ControlError::InvalidStatus(
            "runtime service retry escaped its requested service binding".into(),
        ));
    }
    write_bounded_protocol_response(stream, 200, "OK", &response)
}

fn serve_learn_recovery_request(
    stream: &mut TcpStream,
    authority: &ControlPlaneAuthority,
    shutdown: &Arc<ShutdownCoordinator>,
    job_control: &dyn RuntimeJobControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    if request.method != "POST" {
        return write_control_response(
            stream,
            405,
            "Method Not Allowed",
            b"{\"error\":\"method-not-allowed\"}",
        );
    }
    if request.user_id.is_some()
        || request.garden_id.is_some()
        || request.conversation_id.is_some()
        || authority
            .verify_bearer(request.authorization.as_deref())
            .is_err()
    {
        return write_job_control_error(stream, RuntimeJobControlError::Forbidden);
    }
    if !shutdown.is_accepting_work() {
        return write_job_control_error(stream, RuntimeJobControlError::Unavailable);
    }
    let recovery = match parse_runtime_learn_recovery_request(&request.body) {
        Ok(recovery) => recovery,
        Err(_) => return write_job_control_error(stream, RuntimeJobControlError::InvalidRequest),
    };
    let context = authority
        .trusted_internal_context("learn-recovery", None, None)
        .map_err(|_| ControlError::InvalidStatus("internal recovery authority failed".into()))?;
    let payload = JobSubmissionPayload {
        job_type: "learn".into(),
        garden_id: None,
        conversation_id: None,
        idempotency_key: recovery.idempotency_key,
        input_uploads: Vec::new(),
        request_payload: serde_json::json!({ "operation": "recovery" }),
    };
    let response = match job_control.submit_job(&context, &payload) {
        Ok(response) => response,
        Err(error) => return write_job_control_error(stream, error),
    };
    response
        .validate()
        .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
    validate_job_response_binding(&response, request, None, Some("learn"))?;
    write_bounded_job_success(stream, 202, "Accepted", &response)
}

fn serve_job_request(
    stream: &mut TcpStream,
    authority: &ControlPlaneAuthority,
    shutdown: &Arc<ShutdownCoordinator>,
    job_control: &dyn RuntimeJobControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    let route = match parse_job_route(&request.method, &request.path) {
        Ok(route) => route,
        Err(JobRouteError::MethodNotAllowed) => {
            return write_control_response(
                stream,
                405,
                "Method Not Allowed",
                b"{\"error\":\"method-not-allowed\"}",
            )
        }
        Err(JobRouteError::Malformed) => {
            return write_control_response(
                stream,
                400,
                "Bad Request",
                b"{\"error\":\"bad-request\"}",
            )
        }
        Err(JobRouteError::NotFound) => {
            return write_control_response(stream, 404, "Not Found", b"{\"error\":\"not-found\"}")
        }
    };

    let context = match authenticate_job_context(
        authority,
        request.authorization.as_deref(),
        request.user_id,
        request.garden_id.as_deref(),
        request.conversation_id.as_deref(),
    ) {
        Ok(context) => context,
        Err(error) => return write_job_control_error(stream, error),
    };

    match route {
        JobRoute::Submit => {
            if !shutdown.is_accepting_work() {
                return write_job_control_error(stream, RuntimeJobControlError::Unavailable);
            }
            let payload = match parse_job_submission_payload(&request.body) {
                Ok(payload) => payload,
                Err(_) => {
                    return write_job_control_error(stream, RuntimeJobControlError::InvalidRequest)
                }
            };
            if payload.garden_id.as_deref() != request.garden_id.as_deref()
                || payload.conversation_id.as_deref() != request.conversation_id.as_deref()
            {
                return write_job_control_error(stream, RuntimeJobControlError::Forbidden);
            }
            let response = match job_control.submit_job(&context, &payload) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_job_response_binding(
                &response,
                request,
                None,
                Some(payload.job_type.as_str()),
            )?;
            write_bounded_job_success(stream, 202, "Accepted", &response)
        }
        JobRoute::Lookup => {
            let lookup = match parse_runtime_job_lookup_request(&request.body) {
                Ok(lookup) => lookup,
                Err(_) => {
                    return write_job_control_error(stream, RuntimeJobControlError::InvalidRequest)
                }
            };
            let response = match job_control.lookup_job(&context, &lookup.idempotency_key) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_job_response_binding(&response, request, None, None)?;
            write_bounded_job_success(stream, 200, "OK", &response)
        }
        JobRoute::CancelByIdempotency => {
            let cancellation =
                match parse_runtime_job_idempotency_cancellation_request(&request.body) {
                    Ok(cancellation) => cancellation,
                    Err(_) => {
                        return write_job_control_error(
                            stream,
                            RuntimeJobControlError::InvalidRequest,
                        )
                    }
                };
            let response = match job_control
                .cancel_job_by_idempotency_key(&context, &cancellation.idempotency_key)
            {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            write_bounded_job_success(stream, 200, "OK", &response)
        }
        JobRoute::Inspect { job_id } => {
            let response = match job_control.inspect_job(&context, &job_id) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_job_response_binding(&response, request, Some(&job_id), None)?;
            write_bounded_job_success(stream, 200, "OK", &response)
        }
        JobRoute::Events {
            job_id,
            after,
            limit,
        } => {
            let response = match job_control.replay_job_events(&context, &job_id, after, limit) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_event_response_binding(&response, &job_id, after, limit)?;
            write_bounded_job_success(stream, 200, "OK", &response)
        }
        JobRoute::Cancel { job_id } => {
            let response = match job_control.cancel_job(&context, &job_id) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_job_response_binding(&response, request, Some(&job_id), None)?;
            write_bounded_job_success(stream, 200, "OK", &response)
        }
        JobRoute::Checkpoint { job_id } => {
            let bytes = match job_control.read_job_checkpoint(&context, &job_id) {
                Ok(bytes) => bytes,
                Err(error) => return write_job_control_error(stream, error),
            };
            write_job_output(stream, &job_id, "checkpoint", &bytes)
        }
        JobRoute::Result { job_id } => {
            let bytes = match job_control.read_job_result(&context, &job_id) {
                Ok(bytes) => bytes,
                Err(error) => return write_job_control_error(stream, error),
            };
            write_job_output(stream, &job_id, "result", &bytes)
        }
    }
}

fn authenticate_job_context(
    authority: &ControlPlaneAuthority,
    authorization: Option<&str>,
    user_id: Option<i64>,
    garden_id: Option<&str>,
    conversation_id: Option<&str>,
) -> Result<AuthenticatedJobContext, RuntimeJobControlError> {
    let user_id = user_id.ok_or(RuntimeJobControlError::InvalidRequest)?;
    authority
        .authenticate_user(authorization, user_id, garden_id, conversation_id)
        .map_err(|_| RuntimeJobControlError::Forbidden)
}

fn serve_job_input_request(
    stream: &mut TcpStream,
    authority: &ControlPlaneAuthority,
    shutdown: &Arc<ShutdownCoordinator>,
    job_control: &dyn RuntimeJobControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    let route = match parse_job_input_route(&request.method, &request.path) {
        Ok(route) => route,
        Err(JobRouteError::MethodNotAllowed) => {
            return write_control_response(
                stream,
                405,
                "Method Not Allowed",
                b"{\"error\":\"method-not-allowed\"}",
            )
        }
        Err(JobRouteError::Malformed) => {
            return write_control_response(
                stream,
                400,
                "Bad Request",
                b"{\"error\":\"bad-request\"}",
            )
        }
        Err(JobRouteError::NotFound) => {
            return write_control_response(stream, 404, "Not Found", b"{\"error\":\"not-found\"}")
        }
    };
    if matches!(route, JobInputRoute::Upload { .. }) {
        return Err(ControlError::InvalidStatus(
            "streaming upload escaped its dedicated request path".into(),
        ));
    }
    let context = match authenticate_job_context(
        authority,
        request.authorization.as_deref(),
        request.user_id,
        request.garden_id.as_deref(),
        request.conversation_id.as_deref(),
    ) {
        Ok(context) => context,
        Err(error) => return write_job_control_error(stream, error),
    };

    match route {
        JobInputRoute::Reserve => {
            if !shutdown.is_accepting_work() {
                return write_job_control_error(stream, RuntimeJobControlError::Unavailable);
            }
            let reservation: RuntimeJobInputReservationRequest =
                match parse_runtime_job_input_reservation_request(&request.body) {
                    Ok(reservation) => reservation,
                    Err(_) => {
                        return write_job_control_error(
                            stream,
                            RuntimeJobControlError::InvalidRequest,
                        )
                    }
                };
            if reservation.garden_id.as_deref() != request.garden_id.as_deref()
                || reservation.conversation_id.as_deref() != request.conversation_id.as_deref()
            {
                return write_job_control_error(stream, RuntimeJobControlError::Forbidden);
            }
            let response = match job_control.reserve_job_input(&context, &reservation) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, error),
            };
            if let Err(error) = response.validate() {
                if validate_identifier("uploadId", &response.upload_id).is_ok() {
                    let _ = job_control.abandon_job_input(&context, &response.upload_id);
                }
                return Err(ControlError::InvalidStatus(error.to_string()));
            }
            if response.maximum_bytes > MAX_JOB_INPUT_UPLOAD_BYTES
                || response.maximum_bytes < reservation.declared_size_bytes
                || response.expires_at <= control_now_ms()
            {
                let _ = job_control.abandon_job_input(&context, &response.upload_id);
                return Err(ControlError::InvalidStatus(
                    "runtime upload reservation violated its request or transport binding".into(),
                ));
            }
            let result = write_bounded_job_success(stream, 201, "Created", &response);
            if result.is_err() {
                let _ = job_control.abandon_job_input(&context, &response.upload_id);
            }
            result
        }
        JobInputRoute::Abandon { upload_id } => {
            match job_control.abandon_job_input(&context, &upload_id) {
                Ok(()) => {}
                Err(error) => return write_job_control_error(stream, error),
            }
            let response = RuntimeCommandAck { ok: true };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            write_bounded_job_success(stream, 200, "OK", &response)
        }
        JobInputRoute::Upload { .. } => unreachable!("upload route was handled above"),
    }
}

fn control_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(i64::MAX)
}

fn serve_job_input_upload(
    stream: &mut TcpStream,
    authority: &ControlPlaneAuthority,
    shutdown: &Arc<ShutdownCoordinator>,
    job_control: &dyn RuntimeJobControl,
    prelude: &mut ControlRequestPrelude,
    upload_id: &str,
) -> Result<(), ControlError> {
    let context = match authenticate_job_context(
        authority,
        prelude.head.authorization.as_deref(),
        prelude.head.user_id,
        prelude.head.garden_id.as_deref(),
        prelude.head.conversation_id.as_deref(),
    ) {
        Ok(context) => context,
        Err(error) => return write_job_control_error(stream, error),
    };
    if !shutdown.is_accepting_work() {
        return write_job_control_error(stream, RuntimeJobControlError::Unavailable);
    }
    let framing = match streaming_upload_framing(&prelude.head) {
        Ok(framing) => framing,
        Err(RequestError::Oversized) => {
            let _ = job_control.abandon_job_input(&context, upload_id);
            return write_job_control_error(stream, RuntimeJobControlError::PayloadTooLarge);
        }
        Err(_) => {
            let _ = job_control.abandon_job_input(&context, upload_id);
            return write_job_control_error(stream, RuntimeJobControlError::InvalidRequest);
        }
    };
    let prefix = prelude.body_prefix.take();
    let prefix_length = match u64::try_from(prefix.len()) {
        Ok(length) => length,
        Err(_) => {
            let _ = job_control.abandon_job_input(&context, upload_id);
            return write_job_control_error(stream, RuntimeJobControlError::InvalidRequest);
        }
    };
    if matches!(
        framing,
        StreamingBodyFraming::ContentLength(length) if prefix_length > length
    ) {
        let _ = job_control.abandon_job_input(&context, upload_id);
        return write_job_control_error(stream, RuntimeJobControlError::InvalidRequest);
    }
    let source = match UploadSocketReader::new(stream, shutdown) {
        Ok(source) => source,
        Err(error) => {
            let _ = job_control.abandon_job_input(&context, upload_id);
            return Err(ControlError::Connection(error));
        }
    };
    let mut body = match StreamingBody::new(source, prefix, framing, MAX_JOB_INPUT_UPLOAD_BYTES) {
        Ok(body) => body,
        Err(_) => {
            let _ = job_control.abandon_job_input(&context, upload_id);
            return Err(ControlError::InvalidStatus(
                "validated streaming upload framing was rejected".into(),
            ));
        }
    };
    let seal = match job_control.upload_job_input(&context, upload_id, &mut body) {
        Ok(seal) => seal,
        Err(error) => {
            drop(body);
            if matches!(
                error,
                RuntimeJobControlError::InvalidRequest
                    | RuntimeJobControlError::PayloadTooLarge
                    | RuntimeJobControlError::Unavailable
            ) {
                let _ = job_control.abandon_job_input(&context, upload_id);
            }
            return write_job_control_error(stream, error);
        }
    };
    let received = match body.finish() {
        Ok(received) => received,
        Err(_) => {
            let _ = job_control.abandon_job_input(&context, upload_id);
            return write_job_control_error(stream, RuntimeJobControlError::InvalidRequest);
        }
    };
    if seal.size_bytes != received {
        let _ = job_control.abandon_job_input(&context, upload_id);
        return Err(ControlError::InvalidStatus(
            "runtime upload seal escaped its decoded byte binding".into(),
        ));
    }
    if let Err(error) = validate_job_input_seal(&seal) {
        let _ = job_control.abandon_job_input(&context, upload_id);
        return Err(error);
    }
    let response = RuntimeJobInputSealResponse {
        message_type: "runtime-job-input",
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        upload_id,
        state: "sealed",
        size_bytes: seal.size_bytes,
        sha256: &seal.sha256,
    };
    let result = write_bounded_job_success(stream, 200, "OK", &response);
    if result.is_err() {
        let _ = job_control.abandon_job_input(&context, upload_id);
    }
    result
}

fn validate_job_input_seal(seal: &RuntimeJobInputSeal) -> Result<(), ControlError> {
    if seal.size_bytes == 0
        || seal.size_bytes > MAX_JOB_INPUT_UPLOAD_BYTES
        || seal.sha256.len() != 64
        || !seal
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(ControlError::InvalidStatus(
            "runtime generated an invalid upload seal".into(),
        ));
    }
    Ok(())
}

fn serve_service_request(
    stream: &mut TcpStream,
    service_control: &dyn RuntimeServiceControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    let route = match parse_service_route(&request.method, &request.path) {
        Ok(route) => route,
        Err(ServiceRouteError::MethodNotAllowed) => {
            return write_control_response(
                stream,
                405,
                "Method Not Allowed",
                b"{\"error\":\"method-not-allowed\"}",
            )
        }
        Err(ServiceRouteError::Malformed) => {
            return write_control_response(
                stream,
                400,
                "Bad Request",
                b"{\"error\":\"bad-request\"}",
            )
        }
        Err(ServiceRouteError::NotFound) => {
            return write_control_response(stream, 404, "Not Found", b"{\"error\":\"not-found\"}")
        }
    };

    match route {
        ServiceRoute::Contract { service_id } => {
            let response = match service_control.service_lease_contract(&service_id) {
                Ok(response) => response,
                Err(error) => return write_service_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            if response.service_id != service_id {
                return Err(ControlError::InvalidStatus(
                    "runtime service lease contract escaped its requested service binding".into(),
                ));
            }
            write_bounded_protocol_response(stream, 200, "OK", &response)
        }
        ServiceRoute::Acquire { service_id } => {
            let payload = match parse_runtime_service_lease_acquire_request(&request.body) {
                Ok(payload) => payload,
                Err(_) => {
                    return write_service_control_error(
                        stream,
                        RuntimeServiceControlError::InvalidRequest,
                    )
                }
            };
            let response = match service_control.acquire_service_lease(&service_id, &payload.reason)
            {
                Ok(response) => response,
                Err(error) => return write_service_control_error(stream, error),
            };
            deliver_service_lease(response, &service_id, service_control, |response| {
                write_bounded_protocol_response(stream, 200, "OK", response)
            })
        }
        ServiceRoute::Release { lease_id } => {
            if parse_runtime_service_lease_release_request(&request.body).is_err() {
                return write_service_control_error(
                    stream,
                    RuntimeServiceControlError::InvalidRequest,
                );
            }
            let response = match service_control.release_service_lease(&lease_id) {
                Ok(response) => response,
                Err(error) => return write_service_control_error(stream, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            write_bounded_protocol_response(stream, 200, "OK", &response)
        }
    }
}

fn deliver_service_lease(
    response: RuntimeServiceLeaseAcquireResponse,
    expected_service_id: &str,
    service_control: &dyn RuntimeServiceControl,
    deliver: impl FnOnce(&RuntimeServiceLeaseAcquireResponse) -> Result<(), ControlError>,
) -> Result<(), ControlError> {
    if let Err(error) = response.validate() {
        // A malformed engine response is runtime-fatal, but a syntactically
        // valid opaque lease ID can still be reclaimed without widening the
        // release controller's input authority.
        if validate_identifier("leaseId", &response.lease_id).is_ok() {
            let _ = service_control.release_service_lease(&response.lease_id);
        }
        return Err(ControlError::InvalidStatus(error.to_string()));
    }
    if response.service_id != expected_service_id {
        let _ = service_control.release_service_lease(&response.lease_id);
        return Err(ControlError::InvalidStatus(
            "runtime service lease escaped its requested service binding".into(),
        ));
    }
    let result = deliver(&response);
    if result.is_err() {
        // Once the peer cannot receive the opaque ID, no caller can release
        // the durable lease. Reclaim it immediately.
        let _ = service_control.release_service_lease(&response.lease_id);
    }
    result
}

fn response_write_deadline() -> Instant {
    Instant::now() + RESPONSE_WRITE_DEADLINE
}

fn validate_job_response_binding(
    response: &RuntimeJobResponse,
    request: &ControlRequest,
    expected_job_id: Option<&str>,
    expected_job_type: Option<&str>,
) -> Result<(), ControlError> {
    let RuntimeJobResponse::RuntimeJob { job, .. } = response;
    let matches_request = expected_job_id.is_none_or(|value| job.job_id == value)
        && expected_job_type.is_none_or(|value| job.job_type == value)
        && job.garden_id.as_deref() == request.garden_id.as_deref()
        && job.conversation_id.as_deref() == request.conversation_id.as_deref();
    if !matches_request {
        return Err(ControlError::InvalidStatus(
            "runtime job response escaped its authenticated request binding".into(),
        ));
    }
    Ok(())
}

fn validate_event_response_binding(
    response: &RuntimeJobEventsResponse,
    expected_job_id: &str,
    expected_after: u64,
    requested_limit: usize,
) -> Result<(), ControlError> {
    let RuntimeJobEventsResponse::RuntimeJobEvents {
        job_id,
        after,
        events,
        ..
    } = response;
    if job_id != expected_job_id || *after != expected_after || events.len() > requested_limit {
        return Err(ControlError::InvalidStatus(
            "runtime event response escaped its requested job or cursor binding".into(),
        ));
    }
    Ok(())
}

enum JobRouteError {
    MethodNotAllowed,
    Malformed,
    NotFound,
}

enum ServiceRouteError {
    MethodNotAllowed,
    Malformed,
    NotFound,
}

fn parse_service_route(method: &str, path: &str) -> Result<ServiceRoute, ServiceRouteError> {
    if path.contains('%') || path.contains('?') || path.contains('#') {
        return Err(ServiceRouteError::Malformed);
    }
    if let Some(service_id) = path
        .strip_prefix("/v1/services/")
        .and_then(|rest| rest.strip_suffix("/lease-contract"))
    {
        if service_id.is_empty()
            || service_id.contains('/')
            || validate_identifier("serviceId", service_id).is_err()
        {
            return Err(ServiceRouteError::Malformed);
        }
        return if method == "GET" {
            Ok(ServiceRoute::Contract {
                service_id: service_id.into(),
            })
        } else {
            Err(ServiceRouteError::MethodNotAllowed)
        };
    }
    if let Some(service_id) = path
        .strip_prefix("/v1/services/")
        .and_then(|rest| rest.strip_suffix("/lease"))
    {
        if service_id.is_empty()
            || service_id.contains('/')
            || validate_identifier("serviceId", service_id).is_err()
        {
            return Err(ServiceRouteError::Malformed);
        }
        return if method == "POST" {
            Ok(ServiceRoute::Acquire {
                service_id: service_id.into(),
            })
        } else {
            Err(ServiceRouteError::MethodNotAllowed)
        };
    }
    if let Some(lease_id) = path
        .strip_prefix("/v1/leases/")
        .and_then(|rest| rest.strip_suffix("/release"))
    {
        if lease_id.is_empty()
            || lease_id.contains('/')
            || validate_identifier("leaseId", lease_id).is_err()
        {
            return Err(ServiceRouteError::Malformed);
        }
        return if method == "POST" {
            Ok(ServiceRoute::Release {
                lease_id: lease_id.into(),
            })
        } else {
            Err(ServiceRouteError::MethodNotAllowed)
        };
    }
    Err(ServiceRouteError::NotFound)
}

fn parse_job_route(method: &str, path: &str) -> Result<JobRoute, JobRouteError> {
    if path == "/v1/jobs" {
        return if method == "POST" {
            Ok(JobRoute::Submit)
        } else {
            Err(JobRouteError::MethodNotAllowed)
        };
    }
    if path == "/v1/jobs/lookup" {
        return if method == "POST" {
            Ok(JobRoute::Lookup)
        } else {
            Err(JobRouteError::MethodNotAllowed)
        };
    }
    if path == "/v1/jobs/cancel-by-idempotency" {
        return if method == "POST" {
            Ok(JobRoute::CancelByIdempotency)
        } else {
            Err(JobRouteError::MethodNotAllowed)
        };
    }
    let Some(suffix) = path.strip_prefix("/v1/jobs/") else {
        return Err(JobRouteError::NotFound);
    };
    if suffix.is_empty() || suffix.contains('%') || suffix.contains('#') {
        return Err(JobRouteError::Malformed);
    }
    let (path_part, query) = suffix
        .split_once('?')
        .map_or((suffix, None), |(path, query)| (path, Some(query)));
    let segments = path_part.split('/').collect::<Vec<_>>();
    let Some(job_id) = segments.first().copied() else {
        return Err(JobRouteError::Malformed);
    };
    validate_identifier("jobId", job_id).map_err(|_| JobRouteError::Malformed)?;

    match segments.as_slice() {
        [_] => {
            if query.is_some() {
                return Err(JobRouteError::Malformed);
            }
            if method == "GET" {
                Ok(JobRoute::Inspect {
                    job_id: job_id.to_string(),
                })
            } else {
                Err(JobRouteError::MethodNotAllowed)
            }
        }
        [_, "cancel"] => {
            if query.is_some() {
                return Err(JobRouteError::Malformed);
            }
            if method == "POST" {
                Ok(JobRoute::Cancel {
                    job_id: job_id.to_string(),
                })
            } else {
                Err(JobRouteError::MethodNotAllowed)
            }
        }
        [_, "events"] => {
            if method != "GET" {
                return Err(JobRouteError::MethodNotAllowed);
            }
            let (after, limit) = parse_event_query(query.ok_or(JobRouteError::Malformed)?)?;
            Ok(JobRoute::Events {
                job_id: job_id.to_string(),
                after,
                limit,
            })
        }
        [_, "checkpoint"] | [_, "result"] => {
            if query.is_some() {
                return Err(JobRouteError::Malformed);
            }
            if method != "GET" {
                return Err(JobRouteError::MethodNotAllowed);
            }
            if segments[1] == "checkpoint" {
                Ok(JobRoute::Checkpoint {
                    job_id: job_id.to_string(),
                })
            } else {
                Ok(JobRoute::Result {
                    job_id: job_id.to_string(),
                })
            }
        }
        _ => Err(JobRouteError::NotFound),
    }
}

fn parse_job_input_route(method: &str, path: &str) -> Result<JobInputRoute, JobRouteError> {
    if path == "/v1/job-inputs" {
        return if method == "POST" {
            Ok(JobInputRoute::Reserve)
        } else {
            Err(JobRouteError::MethodNotAllowed)
        };
    }
    let Some(suffix) = path.strip_prefix("/v1/job-inputs/") else {
        return Err(JobRouteError::NotFound);
    };
    if suffix.is_empty()
        || suffix
            .chars()
            .any(|character| matches!(character, '%' | '?' | '#'))
    {
        return Err(JobRouteError::Malformed);
    }
    let segments = suffix.split('/').collect::<Vec<_>>();
    validate_identifier("uploadId", segments[0]).map_err(|_| JobRouteError::Malformed)?;
    match segments.as_slice() {
        [upload_id] => {
            if method == "PUT" {
                Ok(JobInputRoute::Upload {
                    upload_id: (*upload_id).to_owned(),
                })
            } else {
                Err(JobRouteError::MethodNotAllowed)
            }
        }
        [upload_id, "abandon"] => {
            if method == "POST" {
                Ok(JobInputRoute::Abandon {
                    upload_id: (*upload_id).to_owned(),
                })
            } else {
                Err(JobRouteError::MethodNotAllowed)
            }
        }
        _ => Err(JobRouteError::NotFound),
    }
}

fn parse_event_query(query: &str) -> Result<(u64, usize), JobRouteError> {
    let mut after = None;
    let mut limit = None;
    for pair in query.split('&') {
        let (name, value) = pair.split_once('=').ok_or(JobRouteError::Malformed)?;
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(JobRouteError::Malformed);
        }
        match name {
            "after" => {
                let value = value.parse::<u64>().map_err(|_| JobRouteError::Malformed)?;
                if value > MAX_JSON_SAFE_INTEGER || after.replace(value).is_some() {
                    return Err(JobRouteError::Malformed);
                }
            }
            "limit" => {
                let value = value
                    .parse::<usize>()
                    .map_err(|_| JobRouteError::Malformed)?;
                if value == 0
                    || value > MAX_JOB_EVENT_REPLAY_RECORDS
                    || limit.replace(value).is_some()
                {
                    return Err(JobRouteError::Malformed);
                }
            }
            _ => return Err(JobRouteError::Malformed),
        }
    }
    Ok((
        after.ok_or(JobRouteError::Malformed)?,
        limit.ok_or(JobRouteError::Malformed)?,
    ))
}

fn write_job_control_error(
    stream: &mut TcpStream,
    error: RuntimeJobControlError,
) -> Result<(), ControlError> {
    let (status, reason, code, message, resource, required, available) = match error {
        RuntimeJobControlError::InvalidRequest => (
            400,
            "Bad Request",
            "INVALID_JOB_REQUEST",
            "The runtime job request is invalid.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::PayloadTooLarge => (
            413,
            "Payload Too Large",
            "JOB_INPUT_TOO_LARGE",
            "The runtime job input exceeds its bounded upload limit.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::InputQuotaExceeded => (
            429,
            "Too Many Requests",
            "JOB_INPUT_QUOTA_EXCEEDED",
            "The runtime job input quota is exhausted.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::CancellationQuotaExceeded => (
            429,
            "Too Many Requests",
            "JOB_CANCELLATION_QUOTA_EXCEEDED",
            "The bounded pending job-cancellation quota is exhausted.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::CancelledBeforeSubmission => (
            409,
            "Conflict",
            "JOB_CANCELLED_BEFORE_SUBMISSION",
            "The runtime job was durably cancelled before submission.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::Forbidden => (
            403,
            "Forbidden",
            "JOB_SCOPE_FORBIDDEN",
            "The authenticated job scope is not permitted.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::NotFound => (
            404,
            "Not Found",
            "JOB_NOT_FOUND",
            "The requested job was not found.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::Conflict => (
            409,
            "Conflict",
            "JOB_CONFLICT",
            "The job request conflicts with durable runtime state.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::OutputNotReady => (
            409,
            "Conflict",
            "JOB_OUTPUT_NOT_READY",
            "The requested durable job output is not ready.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::Unavailable => (
            503,
            "Service Unavailable",
            "RUNTIME_UNAVAILABLE",
            "Runtime job control is unavailable.",
            None,
            None,
            None,
        ),
        RuntimeJobControlError::Internal => (
            500,
            "Internal Server Error",
            "RUNTIME_INTERNAL_ERROR",
            "Runtime job control failed.",
            None,
            None,
            None,
        ),
    };
    let response = RuntimeControlErrorResponse::RuntimeError {
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        code: code.to_string(),
        message: message.to_string(),
        retryable: false,
        resource,
        required_headroom_mb: required,
        available_headroom_mb: available,
    };
    response
        .validate()
        .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
    write_bounded_protocol_response(stream, status, reason, &response)
}

fn write_service_control_error(
    stream: &mut TcpStream,
    error: RuntimeServiceControlError,
) -> Result<(), ControlError> {
    let (status, reason, code, message, resource, required, available) = match error {
        RuntimeServiceControlError::InvalidRequest => (
            400,
            "Bad Request",
            "INVALID_SERVICE_REQUEST",
            "The runtime service request is invalid.",
            None,
            None,
            None,
        ),
        RuntimeServiceControlError::NotFound => (
            404,
            "Not Found",
            "SERVICE_NOT_FOUND",
            "The requested runtime service or lease was not found.",
            None,
            None,
            None,
        ),
        RuntimeServiceControlError::Conflict => (
            409,
            "Conflict",
            "SERVICE_LEASE_CONFLICT",
            "The service lease conflicts with durable runtime state.",
            None,
            None,
            None,
        ),
        RuntimeServiceControlError::ResourceExhausted {
            required_headroom_mb,
            available_headroom_mb,
        } => (
            503,
            "Service Unavailable",
            "BREADBOARD_RESOURCE_EXHAUSTED",
            "The runtime cannot safely start this service.",
            Some("windows_commit".to_owned()),
            Some(required_headroom_mb),
            Some(available_headroom_mb),
        ),
        RuntimeServiceControlError::Unavailable => (
            503,
            "Service Unavailable",
            "RUNTIME_UNAVAILABLE",
            "Runtime service control is unavailable.",
            None,
            None,
            None,
        ),
        RuntimeServiceControlError::Internal => (
            500,
            "Internal Server Error",
            "RUNTIME_INTERNAL_ERROR",
            "Runtime service control failed.",
            None,
            None,
            None,
        ),
    };
    let response = RuntimeControlErrorResponse::RuntimeError {
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        code: code.to_owned(),
        message: message.to_owned(),
        retryable: false,
        resource,
        required_headroom_mb: required,
        available_headroom_mb: available,
    };
    response
        .validate()
        .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
    write_bounded_protocol_response(stream, status, reason, &response)
}

fn write_bounded_job_success(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    value: &impl Serialize,
) -> Result<(), ControlError> {
    match bounded_json(value) {
        Ok(body) => write_control_response(stream, status, reason, &body),
        Err(ControlError::OversizedResponse) => {
            write_job_control_error(stream, RuntimeJobControlError::Internal)
        }
        Err(error) => Err(error),
    }
}

fn write_job_output(
    stream: &mut TcpStream,
    job_id: &str,
    kind: &'static str,
    bytes: &[u8],
) -> Result<(), ControlError> {
    if bytes.is_empty() || bytes.len() > MAX_JOB_OUTPUT_CONTENT_BYTES {
        return write_job_control_error(stream, RuntimeJobControlError::Internal);
    }
    let content = match serde_json::from_slice::<Value>(bytes) {
        Ok(content) => content,
        Err(_) => return write_job_control_error(stream, RuntimeJobControlError::Internal),
    };
    let response = RuntimeJobOutputResponse {
        message_type: "runtime-job-output",
        protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
        job_id,
        kind,
        content,
    };
    let body = match bounded_json_with_limit(&response, MAX_JOB_OUTPUT_RESPONSE_BYTES) {
        Ok(body) => body,
        Err(ControlError::OversizedResponse) => {
            return write_job_control_error(stream, RuntimeJobControlError::Internal)
        }
        Err(error) => return Err(error),
    };
    write_control_response(stream, 200, "OK", &body)
}

fn write_bounded_protocol_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    value: &impl Serialize,
) -> Result<(), ControlError> {
    let body = bounded_json(value)?;
    write_control_response(stream, status, reason, &body)
}

#[cfg(test)]
fn read_request(
    stream: &mut TcpStream,
    expected_authority: &str,
    deadline: Instant,
) -> Result<ControlRequest, RequestError> {
    let prelude = read_request_prelude(stream, expected_authority, deadline)?;
    complete_buffered_request(stream, prelude, deadline)
}

fn read_request_prelude(
    stream: &mut TcpStream,
    expected_authority: &str,
    deadline: Instant,
) -> Result<ControlRequestPrelude, RequestError> {
    let mut received = SensitiveRequestBuffer::with_capacity(1024);
    let header_end = loop {
        if let Some(position) = find_header_end(&received) {
            break position + 4;
        }
        if received.len() >= MAX_HEADER_BYTES {
            return Err(RequestError::Oversized);
        }
        set_remaining_read_timeout(stream, deadline)?;
        let mut chunk = [0_u8; 1024];
        let count = stream.read(&mut chunk).map_err(map_read_error)?;
        if count == 0 {
            return Err(RequestError::Closed);
        }
        if received.len().saturating_add(count) > MAX_HEADER_BYTES + 1024 {
            return Err(RequestError::Oversized);
        }
        received.extend_from_slice(&chunk[..count]);
    };

    if header_end > MAX_HEADER_BYTES {
        return Err(RequestError::Oversized);
    }
    let head = std::str::from_utf8(&received[..header_end]).map_err(|_| RequestError::Malformed)?;
    let parsed = parse_request_head(head, expected_authority)?;
    let body_prefix = SensitiveRequestBuffer(received.0[header_end..].to_vec());
    Ok(ControlRequestPrelude {
        head: parsed,
        body_prefix,
    })
}

fn complete_buffered_request(
    stream: &mut TcpStream,
    mut prelude: ControlRequestPrelude,
    deadline: Instant,
) -> Result<ControlRequest, RequestError> {
    if prelude.head.transfer_encoding.is_some() {
        return Err(RequestError::Malformed);
    }
    let content_length = prelude.head.content_length.unwrap_or(0);
    let body_limit = request_body_limit(&prelude.head.method, &prelude.head.path) as u64;
    if content_length > body_limit {
        return Err(RequestError::Oversized);
    }
    let content_length = usize::try_from(content_length).map_err(|_| RequestError::Oversized)?;
    if prelude.body_prefix.len() > content_length {
        return Err(RequestError::Malformed);
    }
    while prelude.body_prefix.len() < content_length {
        set_remaining_read_timeout(stream, deadline)?;
        let remaining = content_length - prelude.body_prefix.len();
        let mut chunk = [0_u8; 4096];
        let take = remaining.min(chunk.len());
        let count = stream.read(&mut chunk[..take]).map_err(map_read_error)?;
        if count == 0 {
            return Err(RequestError::Closed);
        }
        prelude.body_prefix.extend_from_slice(&chunk[..count]);
    }
    if accepts_json_request_body(&prelude.head.method, &prelude.head.path)
        && (content_length == 0
            || !prelude
                .head
                .content_type
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case("application/json")))
    {
        return Err(RequestError::Malformed);
    }
    Ok(ControlRequest {
        method: prelude.head.method,
        path: prelude.head.path,
        authorization: prelude.head.authorization,
        user_id: prelude.head.user_id,
        garden_id: prelude.head.garden_id,
        conversation_id: prelude.head.conversation_id,
        body: prelude.body_prefix,
    })
}

fn request_body_limit(method: &str, path: &str) -> usize {
    if method == "POST" && path == "/v1/jobs" {
        MAX_REQUEST_BODY_BYTES
    } else if method == "POST" && path == "/v1/internal/jobs/learn-recovery" {
        MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES
    } else if method == "POST" && path == "/v1/jobs/lookup" {
        MAX_JOB_LOOKUP_BODY_BYTES
    } else if method == "POST" && path == "/v1/jobs/cancel-by-idempotency" {
        MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES
    } else if method == "POST" && path == "/v1/job-inputs" {
        MAX_JOB_INPUT_RESERVATION_BODY_BYTES
    } else if method == "POST" && path == "/v1/services/recall/reconcile" {
        MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES
    } else if (method == "POST" && path == "/v1/services/recall/status")
        || is_lease_mutation_route(method, path)
        || is_lifecycle_retry_route(method, path)
        || is_schedule_gateway_route(method, path)
    {
        MAX_SERVICE_LEASE_REQUEST_BODY_BYTES
    } else {
        0
    }
}

fn accepts_json_request_body(method: &str, path: &str) -> bool {
    (method == "POST"
        && matches!(
            path,
            "/v1/jobs"
                | "/v1/internal/jobs/learn-recovery"
                | "/v1/jobs/lookup"
                | "/v1/jobs/cancel-by-idempotency"
                | "/v1/job-inputs"
        ))
        || is_recall_service_route(method, path)
        || is_lease_mutation_route(method, path)
        || is_lifecycle_retry_route(method, path)
        || is_schedule_gateway_route(method, path)
}

fn is_recall_service_route(method: &str, path: &str) -> bool {
    method == "POST"
        && matches!(
            path,
            "/v1/services/recall/reconcile" | "/v1/services/recall/status"
        )
}

fn is_schedule_gateway_route(method: &str, path: &str) -> bool {
    method == "POST"
        && matches!(
            path,
            "/v1/gateways/telegram/reconcile"
                | "/v1/gateways/whatsapp/reconcile"
                | "/v1/schedules/email-poll/reconcile"
                | "/v1/schedules/email-poll/status"
        )
}

fn is_lifecycle_retry_route(method: &str, path: &str) -> bool {
    if method != "POST" || path.contains('%') || path.contains('?') || path.contains('#') {
        return false;
    }
    let Some(service_id) = path
        .strip_prefix("/v1/lifecycle/services/")
        .and_then(|rest| rest.strip_suffix("/retry"))
    else {
        return false;
    };
    !service_id.is_empty()
        && !service_id.contains('/')
        && validate_identifier("serviceId", service_id).is_ok()
}

/// Recognizes only the three exact Dashboard lease mutations. Encoded IDs,
/// extra path segments, queries, and fragments never gain a request body.
fn is_lease_mutation_route(method: &str, path: &str) -> bool {
    if method != "POST" || path.contains('?') || path.contains('#') {
        return false;
    }

    if let Some(service_id) = path
        .strip_prefix("/v1/services/")
        .and_then(|rest| rest.strip_suffix("/lease"))
    {
        return !service_id.is_empty()
            && !service_id.contains('/')
            && validate_identifier("serviceId", service_id).is_ok();
    }
    if let Some(capability_id) = path
        .strip_prefix("/v1/capabilities/")
        .and_then(|rest| rest.strip_suffix("/lease"))
    {
        return !capability_id.is_empty()
            && !capability_id.contains('/')
            && validate_capability_id("capabilityId", capability_id).is_ok();
    }
    if let Some(lease_id) = path
        .strip_prefix("/v1/leases/")
        .and_then(|rest| rest.strip_suffix("/release"))
    {
        return !lease_id.is_empty()
            && !lease_id.contains('/')
            && validate_identifier("leaseId", lease_id).is_ok();
    }
    false
}

struct ParsedRequestHead {
    method: String,
    path: String,
    authorization: Option<SensitiveHeaderValue>,
    user_id: Option<i64>,
    garden_id: Option<String>,
    conversation_id: Option<String>,
    content_type: Option<String>,
    content_length: Option<u64>,
    transfer_encoding: Option<String>,
}

fn parse_request_head(
    head: &str,
    expected_authority: &str,
) -> Result<ParsedRequestHead, RequestError> {
    if !head.ends_with("\r\n\r\n") || head.contains('\0') {
        return Err(RequestError::Malformed);
    }
    let mut lines = head[..head.len() - 4].split("\r\n");
    let request_line = lines.next().ok_or(RequestError::Malformed)?;
    if request_line.len() > MAX_REQUEST_LINE_BYTES {
        return Err(RequestError::Oversized);
    }
    let parts = request_line.split(' ').collect::<Vec<_>>();
    if parts.len() != 3
        || parts.iter().any(|part| part.is_empty())
        || parts[2] != "HTTP/1.1"
        || !is_header_name(parts[0])
        || !parts[1].starts_with('/')
        || request_line
            .bytes()
            .any(|byte| !(b' '..=b'~').contains(&byte))
    {
        return Err(RequestError::Malformed);
    }

    let mut authorization = None;
    let mut host = None;
    let mut content_length = None;
    let mut transfer_encoding = None;
    let mut content_type = None;
    let mut user_id = None;
    let mut garden_id = None;
    let mut conversation_id = None;
    let mut header_count = 0_usize;
    for line in lines {
        header_count += 1;
        if header_count > MAX_HEADER_COUNT
            || line
                .as_bytes()
                .first()
                .is_some_and(|byte| matches!(*byte, b' ' | b'\t'))
        {
            return Err(RequestError::Oversized);
        }
        let (name, value) = line.split_once(':').ok_or(RequestError::Malformed)?;
        if !is_header_name(name) || value.chars().any(invalid_header_value_character) {
            return Err(RequestError::Malformed);
        }
        let value = value.trim_matches(|character| matches!(character, ' ' | '\t'));
        if name.eq_ignore_ascii_case("authorization") {
            if value.len() > b"Bearer ".len() + MAX_CONTROL_TOKEN_BYTES {
                return Err(RequestError::Oversized);
            }
            set_once(&mut authorization, SensitiveHeaderValue::new(value))?;
        } else if name.eq_ignore_ascii_case("host") {
            set_once(&mut host, value.to_string())?;
        } else if name.eq_ignore_ascii_case("content-length") {
            if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
                return Err(RequestError::Malformed);
            }
            let length = value.parse::<u64>().map_err(|_| RequestError::Oversized)?;
            set_once(&mut content_length, length)?;
        } else if name.eq_ignore_ascii_case("content-type") {
            if value.len() > 128 {
                return Err(RequestError::Oversized);
            }
            set_once(&mut content_type, value.to_string())?;
        } else if name.eq_ignore_ascii_case(USER_ID_HEADER) {
            if value.is_empty()
                || value.len() > 19
                || !value.bytes().all(|byte| byte.is_ascii_digit())
            {
                return Err(RequestError::Malformed);
            }
            let parsed = value.parse::<i64>().map_err(|_| RequestError::Malformed)?;
            if parsed <= 0 || parsed as u64 > MAX_JSON_SAFE_INTEGER {
                return Err(RequestError::Malformed);
            }
            set_once(&mut user_id, parsed)?;
        } else if name.eq_ignore_ascii_case(GARDEN_ID_HEADER) {
            if value.len() > MAX_SCOPE_ID_BYTES || validate_scope_id("gardenId", value).is_err() {
                return Err(RequestError::Malformed);
            }
            set_once(&mut garden_id, value.to_string())?;
        } else if name.eq_ignore_ascii_case(CONVERSATION_ID_HEADER) {
            if value.len() > MAX_SCOPE_ID_BYTES
                || validate_scope_id("conversationId", value).is_err()
            {
                return Err(RequestError::Malformed);
            }
            set_once(&mut conversation_id, value.to_string())?;
        } else if name.eq_ignore_ascii_case("transfer-encoding") {
            if value.len() > 32 {
                return Err(RequestError::Oversized);
            }
            set_once(&mut transfer_encoding, value.to_owned())?;
        } else if name.eq_ignore_ascii_case("expect")
            || name.eq_ignore_ascii_case("trailer")
            || name.eq_ignore_ascii_case("content-encoding")
        {
            // This private single-request server never emits an interim 100
            // response. It also accepts neither transformed representations
            // nor announced trailers. Rejecting these headers avoids a body
            // interpretation that differs between the dashboard and runtime.
            return Err(RequestError::Malformed);
        }
    }

    if host.as_deref() != Some(expected_authority) {
        return Err(RequestError::Malformed);
    }
    let exact_streaming_upload = matches!(
        parse_job_input_route(parts[0], parts[1]),
        Ok(JobInputRoute::Upload { .. })
    );
    if transfer_encoding.is_some() && !exact_streaming_upload {
        return Err(RequestError::Malformed);
    }
    if content_length.is_some() && transfer_encoding.is_some() {
        return Err(RequestError::Malformed);
    }
    Ok(ParsedRequestHead {
        method: parts[0].to_string(),
        path: parts[1].to_string(),
        authorization,
        user_id,
        garden_id,
        conversation_id,
        content_type,
        content_length,
        transfer_encoding,
    })
}

fn streaming_upload_framing(
    head: &ParsedRequestHead,
) -> Result<StreamingBodyFraming, RequestError> {
    if !matches!(
        parse_job_input_route(&head.method, &head.path),
        Ok(JobInputRoute::Upload { .. })
    ) || !head
        .content_type
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("application/octet-stream"))
    {
        return Err(RequestError::Malformed);
    }
    match (head.content_length, head.transfer_encoding.as_deref()) {
        (Some(length), None) if length > MAX_JOB_INPUT_UPLOAD_BYTES => Err(RequestError::Oversized),
        (Some(0), None) => Err(RequestError::Malformed),
        (Some(length), None) => Ok(StreamingBodyFraming::ContentLength(length)),
        (None, Some(value)) if value.eq_ignore_ascii_case("chunked") => {
            Ok(StreamingBodyFraming::Chunked)
        }
        _ => Err(RequestError::Malformed),
    }
}

fn set_once<T>(slot: &mut Option<T>, value: T) -> Result<(), RequestError> {
    if slot.replace(value).is_some() {
        return Err(RequestError::Malformed);
    }
    Ok(())
}

fn is_header_name(name: &str) -> bool {
    !name.is_empty()
        && name.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'!' | b'#'
                        | b'$'
                        | b'%'
                        | b'&'
                        | b'\''
                        | b'*'
                        | b'+'
                        | b'-'
                        | b'.'
                        | b'^'
                        | b'_'
                        | b'`'
                        | b'|'
                        | b'~'
                )
        })
}

fn invalid_header_value_character(character: char) -> bool {
    !character.is_ascii() || character == '\u{7f}' || (character.is_control() && character != '\t')
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn set_remaining_read_timeout(stream: &TcpStream, deadline: Instant) -> Result<(), RequestError> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .filter(|duration| !duration.is_zero())
        .ok_or(RequestError::Deadline)?;
    stream
        .set_read_timeout(Some(remaining))
        .map_err(RequestError::Io)
}

fn map_read_error(error: io::Error) -> RequestError {
    if matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    ) {
        RequestError::Deadline
    } else {
        RequestError::Io(error)
    }
}

fn reserve_connection_diagnostic() -> bool {
    CONNECTION_DIAGNOSTICS_REPORTED
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            (current < MAX_CONNECTION_DIAGNOSTICS).then_some(current + 1)
        })
        .is_ok()
}

fn report_connection_io(stage: &'static str, error: &io::Error) {
    if reserve_connection_diagnostic() {
        eprintln!(
            "[runtime-control] connection io failure stage={stage} kind={:?}",
            error.kind()
        );
    }
}

fn report_request_failure(stage: &'static str, error: &RequestError) {
    if !reserve_connection_diagnostic() {
        return;
    }
    match error {
        RequestError::Io(error) => eprintln!(
            "[runtime-control] request failure stage={stage} class=io kind={:?}",
            error.kind()
        ),
        RequestError::Deadline => {
            eprintln!("[runtime-control] request failure stage={stage} class=deadline")
        }
        RequestError::Closed => {
            eprintln!("[runtime-control] request failure stage={stage} class=closed")
        }
        RequestError::Oversized => {
            eprintln!("[runtime-control] request failure stage={stage} class=oversized")
        }
        RequestError::Malformed => {
            eprintln!("[runtime-control] request failure stage={stage} class=malformed")
        }
    }
}

/// Response time is budgeted independently from request ingestion and engine
/// work. In particular, a manifest-bounded service cold start may legitimately
/// outlive either bounded request-read deadline.
fn write_control_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    body: &[u8],
) -> Result<(), ControlError> {
    write_response(stream, response_write_deadline(), status, reason, body)
}

fn write_response(
    stream: &mut TcpStream,
    deadline: Instant,
    status: u16,
    reason: &str,
    body: &[u8],
) -> Result<(), ControlError> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .filter(|duration| !duration.is_zero())
        .unwrap_or(Duration::from_millis(1));
    stream
        .set_write_timeout(Some(remaining))
        .map_err(ControlError::Connection)?;
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(body))
        .and_then(|_| stream.flush())
        .map_err(ControlError::Connection)
}

fn bounded_json(value: &impl Serialize) -> Result<Vec<u8>, ControlError> {
    bounded_json_with_limit(value, MAX_PROTOCOL_LINE_BYTES)
}

fn bounded_json_with_limit(
    value: &impl Serialize,
    maximum_bytes: usize,
) -> Result<Vec<u8>, ControlError> {
    let bytes = serde_json::to_vec(value)
        .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
    if bytes.len() > maximum_bytes {
        return Err(ControlError::OversizedResponse);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Shutdown;
    use std::sync::{Condvar, Mutex};

    const LIFECYCLE_TOKEN: &str = "0123456789abcdef0123456789abcdef";
    const DASHBOARD_TOKEN: &str = "fedcba9876543210fedcba9876543210";

    fn control_authorities() -> ControlAuthorities {
        ControlAuthorities::new(
            ControlPlaneAuthority::new(LIFECYCLE_TOKEN).unwrap(),
            ControlPlaneAuthority::new(DASHBOARD_TOKEN).unwrap(),
        )
    }

    fn issue_live_tcp_request(
        address: std::net::SocketAddr,
        authority: &str,
        method: &str,
        path: &str,
        token: &str,
        additional_headers: &str,
        body: &[u8],
    ) -> io::Result<String> {
        let mut client = TcpStream::connect(address)?;
        client.set_read_timeout(Some(Duration::from_secs(5)))?;
        client.set_write_timeout(Some(Duration::from_secs(5)))?;
        write!(
            client,
            "{method} {path} HTTP/1.1\r\nHost: {authority}\r\nAuthorization: Bearer {token}\r\n{additional_headers}Content-Length: {}\r\n\r\n",
            body.len()
        )?;
        client.write_all(body)?;
        client.shutdown(Shutdown::Write)?;
        let mut response = String::new();
        client.read_to_string(&mut response)?;
        Ok(response)
    }

    struct UnreachableJobControl;

    struct RecordingJobControl {
        reserve_calls: Mutex<Vec<RuntimeJobInputReservationRequest>>,
        upload_attempts: Mutex<usize>,
        upload_calls: Mutex<Vec<(String, Vec<u8>)>>,
        upload_failures: Mutex<usize>,
        abandon_calls: Mutex<Vec<String>>,
        submit_calls: Mutex<Vec<(AuthenticatedJobContext, JobSubmissionPayload)>>,
        submit_result: Result<RuntimeJobResponse, RuntimeJobControlError>,
        lookup_calls: Mutex<Vec<String>>,
        lookup_result: Result<RuntimeJobResponse, RuntimeJobControlError>,
        idempotency_cancellation_calls: Mutex<Vec<String>>,
        idempotency_cancellation_result:
            Result<RuntimeJobIdempotencyCancellationResponse, RuntimeJobControlError>,
        checkpoint: Result<Vec<u8>, RuntimeJobControlError>,
        result: Result<Vec<u8>, RuntimeJobControlError>,
    }

    impl RecordingJobControl {
        fn successful() -> Self {
            Self {
                reserve_calls: Mutex::new(Vec::new()),
                upload_attempts: Mutex::new(0),
                upload_calls: Mutex::new(Vec::new()),
                upload_failures: Mutex::new(0),
                abandon_calls: Mutex::new(Vec::new()),
                submit_calls: Mutex::new(Vec::new()),
                submit_result: Err(RuntimeJobControlError::Internal),
                lookup_calls: Mutex::new(Vec::new()),
                lookup_result: Err(RuntimeJobControlError::NotFound),
                idempotency_cancellation_calls: Mutex::new(Vec::new()),
                idempotency_cancellation_result: Ok(
                    RuntimeJobIdempotencyCancellationResponse::
                        RuntimeJobIdempotencyCancellation {
                            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                            job_id: None,
                            state: breadboard_runtime_protocol::
                                RuntimeJobIdempotencyCancellationState::Pending,
                            accepted: true,
                        },
                ),
                checkpoint: Ok(br#"{"stage":"parsing","current":1}"#.to_vec()),
                result: Ok(br#"{"ok":true,"documentId":"doc_1"}"#.to_vec()),
            }
        }

        fn with_outputs(
            checkpoint: Result<Vec<u8>, RuntimeJobControlError>,
            result: Result<Vec<u8>, RuntimeJobControlError>,
        ) -> Self {
            Self {
                checkpoint,
                result,
                ..Self::successful()
            }
        }

        fn with_lookup_result(
            lookup_result: Result<RuntimeJobResponse, RuntimeJobControlError>,
        ) -> Self {
            Self {
                lookup_result,
                ..Self::successful()
            }
        }

        fn with_submit_result(
            submit_result: Result<RuntimeJobResponse, RuntimeJobControlError>,
        ) -> Self {
            Self {
                submit_result,
                ..Self::successful()
            }
        }
    }

    struct UnreachableServiceControl;

    struct RecordingServiceControl {
        contract_result: Result<RuntimeServiceLeaseContractResponse, RuntimeServiceControlError>,
        acquire_result: Result<RuntimeServiceLeaseAcquireResponse, RuntimeServiceControlError>,
        release_result: Result<RuntimeServiceLeaseReleaseResponse, RuntimeServiceControlError>,
        retry_result: Result<RuntimeServiceRetryResponse, RuntimeServiceControlError>,
        contract_calls: Mutex<Vec<String>>,
        acquire_calls: Mutex<Vec<(String, String)>>,
        release_calls: Mutex<Vec<String>>,
        retry_calls: Mutex<Vec<String>>,
        gateway_calls: Mutex<Vec<(i64, RuntimeGatewayId, RuntimeDesiredState)>>,
        schedule_calls: Mutex<Vec<(i64, String, RuntimeDesiredState)>>,
        recall_calls: Mutex<Vec<(i64, RuntimeRecallReconcileRequest)>>,
        recall_status_calls: Mutex<Vec<i64>>,
    }

    impl RecordingServiceControl {
        fn successful(service_id: &str) -> Self {
            Self {
                contract_result: Ok(RuntimeServiceLeaseContractResponse {
                    protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                    service_id: service_id.into(),
                    acquire_timeout_ms: 100_000,
                }),
                acquire_result: Ok(RuntimeServiceLeaseAcquireResponse {
                    ok: true,
                    lease_id: "01234567-89ab-cdef-0123-456789abcdef".into(),
                    service_id: service_id.into(),
                }),
                release_result: Ok(RuntimeServiceLeaseReleaseResponse {
                    ok: true,
                    released: true,
                }),
                retry_result: Ok(RuntimeServiceRetryResponse {
                    protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                    ok: true,
                    service_id: service_id.into(),
                    accepted: true,
                    state: breadboard_runtime_protocol::RuntimeServiceState::Starting,
                }),
                contract_calls: Mutex::new(Vec::new()),
                acquire_calls: Mutex::new(Vec::new()),
                release_calls: Mutex::new(Vec::new()),
                retry_calls: Mutex::new(Vec::new()),
                gateway_calls: Mutex::new(Vec::new()),
                schedule_calls: Mutex::new(Vec::new()),
                recall_calls: Mutex::new(Vec::new()),
                recall_status_calls: Mutex::new(Vec::new()),
            }
        }

        fn with_acquire_result(
            result: Result<RuntimeServiceLeaseAcquireResponse, RuntimeServiceControlError>,
        ) -> Self {
            Self {
                acquire_result: result,
                ..Self::successful("hermes")
            }
        }
    }

    impl RuntimeServiceControl for RecordingServiceControl {
        fn service_lease_contract(
            &self,
            service_id: &str,
        ) -> Result<RuntimeServiceLeaseContractResponse, RuntimeServiceControlError> {
            self.contract_calls
                .lock()
                .unwrap()
                .push(service_id.to_owned());
            self.contract_result.clone()
        }

        fn acquire_service_lease(
            &self,
            service_id: &str,
            reason: &str,
        ) -> Result<RuntimeServiceLeaseAcquireResponse, RuntimeServiceControlError> {
            self.acquire_calls
                .lock()
                .unwrap()
                .push((service_id.to_owned(), reason.to_owned()));
            self.acquire_result.clone()
        }

        fn release_service_lease(
            &self,
            lease_id: &str,
        ) -> Result<RuntimeServiceLeaseReleaseResponse, RuntimeServiceControlError> {
            self.release_calls.lock().unwrap().push(lease_id.to_owned());
            self.release_result.clone()
        }

        fn retry_service(
            &self,
            service_id: &str,
        ) -> Result<RuntimeServiceRetryResponse, RuntimeServiceControlError> {
            self.retry_calls.lock().unwrap().push(service_id.to_owned());
            self.retry_result.clone()
        }

        fn reconcile_gateway(
            &self,
            context: &AuthenticatedJobContext,
            gateway: RuntimeGatewayId,
            desired_state: RuntimeDesiredState,
        ) -> Result<RuntimeGatewayReconcileResponse, RuntimeServiceControlError> {
            self.gateway_calls.lock().unwrap().push((
                context
                    .user_id()
                    .ok_or(RuntimeServiceControlError::InvalidRequest)?,
                gateway,
                desired_state,
            ));
            Ok(RuntimeGatewayReconcileResponse {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                ok: true,
                gateway,
                desired_state,
                service_state: match desired_state {
                    RuntimeDesiredState::Running => {
                        breadboard_runtime_protocol::RuntimeGatewayServiceState::Healthy
                    }
                    RuntimeDesiredState::Stopped => {
                        breadboard_runtime_protocol::RuntimeGatewayServiceState::Stopped
                    }
                },
            })
        }

        fn reconcile_schedule(
            &self,
            context: &AuthenticatedJobContext,
            schedule_id: &str,
            desired_state: RuntimeDesiredState,
        ) -> Result<RuntimeScheduleReconcileResponse, RuntimeServiceControlError> {
            self.schedule_calls.lock().unwrap().push((
                context
                    .user_id()
                    .ok_or(RuntimeServiceControlError::InvalidRequest)?,
                schedule_id.to_owned(),
                desired_state,
            ));
            Ok(RuntimeScheduleReconcileResponse {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                ok: true,
                schedule_id: schedule_id.to_owned(),
                desired_state,
                schedule_state: match desired_state {
                    RuntimeDesiredState::Running => {
                        breadboard_runtime_protocol::RuntimeScheduleControlState::Enabled
                    }
                    RuntimeDesiredState::Stopped => {
                        breadboard_runtime_protocol::RuntimeScheduleControlState::Disabled
                    }
                },
            })
        }

        fn schedule_status(
            &self,
            context: &AuthenticatedJobContext,
            schedule_id: &str,
        ) -> Result<RuntimeScheduleStatusResponse, RuntimeServiceControlError> {
            let _ = context
                .user_id()
                .ok_or(RuntimeServiceControlError::InvalidRequest)?;
            Ok(RuntimeScheduleStatusResponse {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                ok: true,
                schedule_id: schedule_id.to_owned(),
                enabled: true,
            })
        }

        fn reconcile_recall(
            &self,
            context: &AuthenticatedJobContext,
            request: RuntimeRecallReconcileRequest,
        ) -> Result<RuntimeRecallReconcileResponse, RuntimeServiceControlError> {
            let _ = context
                .user_id()
                .ok_or(RuntimeServiceControlError::InvalidRequest)?;
            request
                .validate()
                .map_err(|_| RuntimeServiceControlError::InvalidRequest)?;
            self.recall_calls.lock().unwrap().push((
                context
                    .user_id()
                    .ok_or(RuntimeServiceControlError::InvalidRequest)?,
                request.clone(),
            ));
            Ok(RuntimeRecallReconcileResponse {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                ok: true,
                service_id: "recall".into(),
                desired_state: request.desired_state,
                service_state: match request.desired_state {
                    RuntimeDesiredState::Running => {
                        breadboard_runtime_protocol::RuntimeRecallReconcileServiceState::Healthy
                    }
                    RuntimeDesiredState::Stopped => {
                        breadboard_runtime_protocol::RuntimeRecallReconcileServiceState::Stopped
                    }
                },
            })
        }

        fn recall_status(
            &self,
            context: &AuthenticatedJobContext,
        ) -> Result<RuntimeRecallStatusResponse, RuntimeServiceControlError> {
            let _ = context
                .user_id()
                .ok_or(RuntimeServiceControlError::InvalidRequest)?;
            self.recall_status_calls
                .lock()
                .unwrap()
                .push(context.user_id().expect("validated Recall status user"));
            Ok(RuntimeRecallStatusResponse {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                ok: true,
                service_id: "recall".into(),
                desired_state: RuntimeDesiredState::Running,
                service_state: breadboard_runtime_protocol::RuntimeServiceState::Ready,
                owned_by_requester: true,
                log_tail: Vec::new(),
            })
        }
    }

    impl RuntimeServiceControl for UnreachableServiceControl {
        fn service_lease_contract(
            &self,
            _service_id: &str,
        ) -> Result<RuntimeServiceLeaseContractResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn acquire_service_lease(
            &self,
            _service_id: &str,
            _reason: &str,
        ) -> Result<RuntimeServiceLeaseAcquireResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn release_service_lease(
            &self,
            _lease_id: &str,
        ) -> Result<RuntimeServiceLeaseReleaseResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn retry_service(
            &self,
            _service_id: &str,
        ) -> Result<RuntimeServiceRetryResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn reconcile_gateway(
            &self,
            _context: &AuthenticatedJobContext,
            _gateway: RuntimeGatewayId,
            _desired_state: RuntimeDesiredState,
        ) -> Result<RuntimeGatewayReconcileResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn reconcile_schedule(
            &self,
            _context: &AuthenticatedJobContext,
            _schedule_id: &str,
            _desired_state: RuntimeDesiredState,
        ) -> Result<RuntimeScheduleReconcileResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn schedule_status(
            &self,
            _context: &AuthenticatedJobContext,
            _schedule_id: &str,
        ) -> Result<RuntimeScheduleStatusResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn reconcile_recall(
            &self,
            _context: &AuthenticatedJobContext,
            _request: RuntimeRecallReconcileRequest,
        ) -> Result<RuntimeRecallReconcileResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }

        fn recall_status(
            &self,
            _context: &AuthenticatedJobContext,
        ) -> Result<RuntimeRecallStatusResponse, RuntimeServiceControlError> {
            Err(RuntimeServiceControlError::Internal)
        }
    }

    impl RuntimeJobControl for UnreachableJobControl {
        fn reserve_job_input(
            &self,
            _context: &AuthenticatedJobContext,
            _request: &RuntimeJobInputReservationRequest,
        ) -> Result<RuntimeJobInputReservationResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn upload_job_input(
            &self,
            _context: &AuthenticatedJobContext,
            _upload_id: &str,
            _body: &mut dyn Read,
        ) -> Result<RuntimeJobInputSeal, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn abandon_job_input(
            &self,
            _context: &AuthenticatedJobContext,
            _upload_id: &str,
        ) -> Result<(), RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn submit_job(
            &self,
            _context: &AuthenticatedJobContext,
            _payload: &JobSubmissionPayload,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn lookup_job(
            &self,
            _context: &AuthenticatedJobContext,
            _idempotency_key: &str,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn cancel_job_by_idempotency_key(
            &self,
            _context: &AuthenticatedJobContext,
            _idempotency_key: &str,
        ) -> Result<RuntimeJobIdempotencyCancellationResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn inspect_job(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn replay_job_events(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
            _after: u64,
            _limit: usize,
        ) -> Result<RuntimeJobEventsResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn cancel_job(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn read_job_checkpoint(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<Vec<u8>, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn read_job_result(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<Vec<u8>, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }
    }

    impl RuntimeJobControl for RecordingJobControl {
        fn reserve_job_input(
            &self,
            _context: &AuthenticatedJobContext,
            request: &RuntimeJobInputReservationRequest,
        ) -> Result<RuntimeJobInputReservationResponse, RuntimeJobControlError> {
            self.reserve_calls.lock().unwrap().push(request.clone());
            Ok(RuntimeJobInputReservationResponse {
                upload_id: "upload_1".into(),
                expires_at: 4_102_444_800_000,
                maximum_bytes: MAX_JOB_INPUT_UPLOAD_BYTES,
            })
        }

        fn upload_job_input(
            &self,
            _context: &AuthenticatedJobContext,
            upload_id: &str,
            body: &mut dyn Read,
        ) -> Result<RuntimeJobInputSeal, RuntimeJobControlError> {
            *self.upload_attempts.lock().unwrap() += 1;
            let mut bytes = Vec::new();
            if let Err(error) = body.read_to_end(&mut bytes) {
                *self.upload_failures.lock().unwrap() += 1;
                return Err(match error.kind() {
                    io::ErrorKind::FileTooLarge => RuntimeJobControlError::PayloadTooLarge,
                    io::ErrorKind::Interrupted | io::ErrorKind::ConnectionAborted => {
                        RuntimeJobControlError::Unavailable
                    }
                    _ => RuntimeJobControlError::InvalidRequest,
                });
            }
            self.upload_calls
                .lock()
                .unwrap()
                .push((upload_id.to_owned(), bytes.clone()));
            Ok(RuntimeJobInputSeal {
                size_bytes: bytes.len() as u64,
                sha256: "a".repeat(64),
            })
        }

        fn abandon_job_input(
            &self,
            _context: &AuthenticatedJobContext,
            upload_id: &str,
        ) -> Result<(), RuntimeJobControlError> {
            self.abandon_calls
                .lock()
                .unwrap()
                .push(upload_id.to_owned());
            Ok(())
        }

        fn submit_job(
            &self,
            context: &AuthenticatedJobContext,
            payload: &JobSubmissionPayload,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            self.submit_calls
                .lock()
                .unwrap()
                .push((context.clone(), payload.clone()));
            self.submit_result.clone()
        }

        fn lookup_job(
            &self,
            _context: &AuthenticatedJobContext,
            idempotency_key: &str,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            self.lookup_calls
                .lock()
                .unwrap()
                .push(idempotency_key.to_owned());
            self.lookup_result.clone()
        }

        fn cancel_job_by_idempotency_key(
            &self,
            _context: &AuthenticatedJobContext,
            idempotency_key: &str,
        ) -> Result<RuntimeJobIdempotencyCancellationResponse, RuntimeJobControlError> {
            self.idempotency_cancellation_calls
                .lock()
                .unwrap()
                .push(idempotency_key.to_owned());
            self.idempotency_cancellation_result.clone()
        }

        fn inspect_job(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn replay_job_events(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
            _after: u64,
            _limit: usize,
        ) -> Result<RuntimeJobEventsResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn cancel_job(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
            Err(RuntimeJobControlError::Internal)
        }

        fn read_job_checkpoint(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<Vec<u8>, RuntimeJobControlError> {
            self.checkpoint.clone()
        }

        fn read_job_result(
            &self,
            _context: &AuthenticatedJobContext,
            _job_id: &str,
        ) -> Result<Vec<u8>, RuntimeJobControlError> {
            self.result.clone()
        }
    }

    fn issue_control_request(method: &str, path: &str, token: &str) -> (String, bool) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write!(
            client,
            "{method} {path} HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {token}\r\n\r\n"
        )
        .unwrap();
        client.shutdown(Shutdown::Write).unwrap();

        let shutdown = Arc::new(ShutdownCoordinator::default());
        let active_dashboard = Arc::new(AtomicUsize::new(0));
        serve_connection(
            &mut server,
            &expected_authority,
            &control_authorities(),
            REQUEST_PRELUDE_DEADLINE,
            &active_dashboard,
            42,
            &shutdown,
            &|| Ok(Vec::new()),
            &UnreachableJobControl,
            &UnreachableServiceControl,
        )
        .unwrap();
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        (response, shutdown.is_requested())
    }

    fn issue_service_control_request(
        method: &str,
        path: &str,
        token: &str,
        service_control: &dyn RuntimeServiceControl,
    ) -> (Result<(), ControlError>, String) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write!(
            client,
            "{method} {path} HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {token}\r\n\r\n"
        )
        .unwrap();
        client.shutdown(Shutdown::Write).unwrap();

        let shutdown = Arc::new(ShutdownCoordinator::default());
        let active_dashboard = Arc::new(AtomicUsize::new(0));
        let result = serve_connection(
            &mut server,
            &expected_authority,
            &control_authorities(),
            REQUEST_PRELUDE_DEADLINE,
            &active_dashboard,
            42,
            &shutdown,
            &|| Ok(Vec::new()),
            &UnreachableJobControl,
            service_control,
        );
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        (result, response)
    }

    fn issue_json_control_request(
        method: &str,
        path: &str,
        token: &str,
        body: &[u8],
        service_control: &dyn RuntimeServiceControl,
    ) -> (Result<(), ControlError>, String) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write!(
            client,
            "{method} {path} HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .unwrap();
        client.write_all(body).unwrap();
        client.shutdown(Shutdown::Write).unwrap();

        let shutdown = Arc::new(ShutdownCoordinator::default());
        let active_dashboard = Arc::new(AtomicUsize::new(0));
        let result = serve_connection(
            &mut server,
            &expected_authority,
            &control_authorities(),
            REQUEST_PRELUDE_DEADLINE,
            &active_dashboard,
            42,
            &shutdown,
            &|| Ok(Vec::new()),
            &UnreachableJobControl,
            service_control,
        );
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        (result, response)
    }

    fn issue_user_json_control_request(
        method: &str,
        path: &str,
        token: &str,
        body: &[u8],
        service_control: &dyn RuntimeServiceControl,
    ) -> (Result<(), ControlError>, String) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write!(
            client,
            "{method} {path} HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {token}\r\nX-Breadboard-User-Id: 42\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .unwrap();
        client.write_all(body).unwrap();
        client.shutdown(Shutdown::Write).unwrap();

        let shutdown = Arc::new(ShutdownCoordinator::default());
        let active_dashboard = Arc::new(AtomicUsize::new(0));
        let result = serve_connection(
            &mut server,
            &expected_authority,
            &control_authorities(),
            REQUEST_PRELUDE_DEADLINE,
            &active_dashboard,
            42,
            &shutdown,
            &|| Ok(Vec::new()),
            &UnreachableJobControl,
            service_control,
        );
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        (result, response)
    }

    fn issue_raw_job_control_request(
        method: &str,
        path: &str,
        token: &str,
        include_scope_headers: bool,
        entity_headers: &str,
        body: &[u8],
        job_control: &dyn RuntimeJobControl,
    ) -> (Result<(), ControlError>, String) {
        issue_raw_job_control_request_with_admission(
            method,
            path,
            token,
            include_scope_headers,
            entity_headers,
            body,
            job_control,
            true,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn issue_raw_job_control_request_with_admission(
        method: &str,
        path: &str,
        token: &str,
        include_scope_headers: bool,
        entity_headers: &str,
        body: &[u8],
        job_control: &dyn RuntimeJobControl,
        accepting_work: bool,
    ) -> (Result<(), ControlError>, String) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write!(
            client,
            "{method} {path} HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {token}\r\n"
        )
        .unwrap();
        if include_scope_headers {
            client
                .write_all(
                    b"X-Breadboard-User-Id: 42\r\nX-Breadboard-Garden-Id: garden-1\r\nX-Breadboard-Conversation-Id: conversation-1\r\n",
                )
                .unwrap();
        }
        client.write_all(entity_headers.as_bytes()).unwrap();
        client.write_all(b"\r\n").unwrap();
        client.write_all(body).unwrap();
        client.shutdown(Shutdown::Write).unwrap();

        let shutdown = Arc::new(ShutdownCoordinator::default());
        if accepting_work {
            shutdown.open_admission_for_control_test();
        }
        let active_dashboard = Arc::new(AtomicUsize::new(0));
        let result = serve_connection(
            &mut server,
            &expected_authority,
            &control_authorities(),
            REQUEST_PRELUDE_DEADLINE,
            &active_dashboard,
            42,
            &shutdown,
            &|| Ok(Vec::new()),
            job_control,
            &UnreachableServiceControl,
        );
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        (result, response)
    }

    fn read_test_request(
        method: &str,
        path: &str,
        content_type: Option<&str>,
        body: &[u8],
    ) -> Result<ControlRequest, RequestError> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write!(
            client,
            "{method} {path} HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {DASHBOARD_TOKEN}\r\nContent-Length: {}\r\n",
            body.len()
        )
        .unwrap();
        if let Some(content_type) = content_type {
            write!(client, "Content-Type: {content_type}\r\n").unwrap();
        }
        client.write_all(b"\r\n").unwrap();
        client.write_all(body).unwrap();
        client.shutdown(Shutdown::Write).unwrap();
        read_request(
            &mut server,
            &expected_authority,
            Instant::now() + REQUEST_DEADLINE,
        )
    }

    #[test]
    fn core_authority_rejects_prefixes_suffixes_and_differences() {
        let authority = ControlPlaneAuthority::new(LIFECYCLE_TOKEN).unwrap();
        assert!(authority
            .verify_bearer(Some("Bearer 0123456789abcdef0123456789abcdef"))
            .is_ok());
        assert!(authority
            .verify_bearer(Some("Bearer 0123456789abcdef"))
            .is_err());
        assert!(authority
            .verify_bearer(Some("Bearer 0123456789abcdef0123456789abcdef-extra"))
            .is_err());
    }

    #[test]
    fn lifecycle_and_dashboard_bearers_have_disjoint_route_authority() {
        let authorities = control_authorities();
        let lifecycle = authorities
            .authenticate(Some(&format!("Bearer {LIFECYCLE_TOKEN}")))
            .unwrap();
        let dashboard = authorities
            .authenticate(Some(&format!("Bearer {DASHBOARD_TOKEN}")))
            .unwrap();

        assert_eq!(lifecycle, ControlAuthorityRole::Lifecycle);
        assert_eq!(dashboard, ControlAuthorityRole::Dashboard);
        assert!(role_allows(lifecycle, route_authority("/v1/status")));
        assert!(role_allows(dashboard, route_authority("/v1/status")));
        assert!(role_allows(lifecycle, route_authority("/v1/shutdown")));
        assert!(!role_allows(dashboard, route_authority("/v1/shutdown")));
        assert!(role_allows(
            lifecycle,
            route_authority("/v1/lifecycle/services/dashboard/retry")
        ));
        assert!(!role_allows(
            dashboard,
            route_authority("/v1/lifecycle/services/dashboard/retry")
        ));
        assert!(!role_allows(lifecycle, route_authority("/v1/future")));
        assert!(!role_allows(dashboard, route_authority("/v1/future")));
        for path in [
            "/v1/jobs",
            "/v1/jobs/job_1",
            "/v1/jobs/job_1/result",
            "/v1/internal/jobs/learn-recovery",
            "/v1/job-inputs",
            "/v1/job-inputs/upload_1",
            "/v1/services/hermes/lease-contract",
            "/v1/services/hermes/lease",
            "/v1/capabilities/learn/lease",
            "/v1/leases/lease_1/release",
            "/v1/gateways/telegram/reconcile",
            "/v1/gateways/whatsapp/reconcile",
            "/v1/schedules/email-poll/reconcile",
            "/v1/schedules/email-poll/status",
        ] {
            assert!(!role_allows(lifecycle, route_authority(path)));
            assert!(role_allows(dashboard, route_authority(path)));
        }
        assert!(authorities
            .authenticate(Some("Bearer unknown-unknown-unknown-unknown"))
            .is_none());
    }

    #[test]
    fn duplicate_bearers_fail_closed_instead_of_collapsing_roles() {
        let authorities = ControlAuthorities::new(
            ControlPlaneAuthority::new(LIFECYCLE_TOKEN).unwrap(),
            ControlPlaneAuthority::new(LIFECYCLE_TOKEN).unwrap(),
        );
        assert!(authorities
            .authenticate(Some(&format!("Bearer {LIFECYCLE_TOKEN}")))
            .is_none());
    }

    #[test]
    fn live_router_denies_cross_scope_bearers_before_dispatch() {
        let (response, stopped) = issue_control_request("POST", "/v1/shutdown", DASHBOARD_TOKEN);
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert!(!stopped);

        let (response, stopped) = issue_control_request("GET", "/v1/jobs/job_1", LIFECYCLE_TOKEN);
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert!(!stopped);

        let (response, stopped) = issue_control_request("GET", "/v1/status", DASHBOARD_TOKEN);
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(!stopped);

        let (response, stopped) = issue_control_request("POST", "/v1/shutdown", LIFECYCLE_TOKEN);
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(stopped);
    }

    #[test]
    fn request_head_accepts_only_the_literal_authority_and_one_bearer_header() {
        let parsed = parse_request_head(
            "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\n\r\n",
            "127.0.0.1:43121",
        )
        .unwrap();
        assert_eq!(parsed.method, "GET");
        assert_eq!(parsed.path, "/v1/status");
        assert_eq!(parsed.authorization.as_deref(), Some("Bearer token"));
        assert_eq!(parsed.content_length, None);
        assert_eq!(parsed.transfer_encoding, None);

        assert!(parse_request_head(
            "GET /v1/status HTTP/1.1\r\nHost: localhost:43121\r\nAuthorization: Bearer token\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
        assert!(parse_request_head(
            "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer one\r\nAuthorization: Bearer two\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
    }

    #[test]
    fn request_reader_rejects_transfer_encoding_and_nonzero_control_bodies() {
        assert!(parse_request_head(
            "POST /v1/shutdown HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nTransfer-Encoding: chunked\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
        assert!(matches!(
            read_test_request("POST", "/v1/shutdown", None, b"x"),
            Err(RequestError::Oversized)
        ));
    }

    #[test]
    fn only_the_exact_raw_upload_route_accepts_one_streaming_framing() {
        let fixed = parse_request_head(
            "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\nContent-Length: 7\r\n\r\n",
            "127.0.0.1:43121",
        )
        .unwrap();
        assert_eq!(
            streaming_upload_framing(&fixed).unwrap(),
            StreamingBodyFraming::ContentLength(7)
        );

        let chunked = parse_request_head(
            "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
            "127.0.0.1:43121",
        )
        .unwrap();
        assert_eq!(
            streaming_upload_framing(&chunked).unwrap(),
            StreamingBodyFraming::Chunked
        );

        for head in [
            "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\nContent-Length: 7\r\nTransfer-Encoding: chunked\r\n\r\n",
            "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: gzip\r\n\r\n",
            "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\n\r\n",
        ] {
            if let Ok(parsed) = parse_request_head(head, "127.0.0.1:43121") {
                assert!(streaming_upload_framing(&parsed).is_err());
            }
        }
        assert!(parse_request_head(
            "PUT /v1/job-inputs/upload_1/extra HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
        assert!(parse_request_head(
            "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\nContent-Length: 7\r\nExpect: 100-continue\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
        for disallowed in ["Trailer: X-Digest", "Content-Encoding: gzip"] {
            let head = format!(
                "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n{disallowed}\r\n\r\n"
            );
            assert!(parse_request_head(&head, "127.0.0.1:43121").is_err());
        }
    }

    #[test]
    fn job_authority_headers_are_exact_bounded_and_nonduplicated() {
        let parsed = parse_request_head(
            "POST /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Type: application/json\r\nContent-Length: 2\r\nX-Breadboard-User-Id: 42\r\nX-Breadboard-Garden-Id: garden-1\r\nX-Breadboard-Conversation-Id: conversation-1\r\n\r\n",
            "127.0.0.1:43121",
        )
        .unwrap();
        assert_eq!(parsed.user_id, Some(42));
        assert_eq!(parsed.garden_id.as_deref(), Some("garden-1"));
        assert_eq!(parsed.conversation_id.as_deref(), Some("conversation-1"));
        assert_eq!(parsed.content_type.as_deref(), Some("application/json"));

        assert!(parse_request_head(
            "POST /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nX-Breadboard-User-Id: 42\r\nx-breadboard-user-id: 43\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
        assert!(parse_request_head(
            "POST /v1/internal/jobs/learn-recovery HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nX-Breadboard-Garden-Id: garden-1\r\nx-breadboard-garden-id: garden-2\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
        assert!(parse_request_head(
            "POST /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nX-Breadboard-User-Id: 0\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
    }

    #[test]
    fn development_only_prelude_allowance_preserves_packaged_strictness() {
        assert_eq!(
            request_prelude_deadline(RuntimeMode::Lean),
            DEVELOPMENT_REQUEST_PRELUDE_DEADLINE
        );
        assert_eq!(
            request_prelude_deadline(RuntimeMode::Hot),
            DEVELOPMENT_REQUEST_PRELUDE_DEADLINE
        );
        assert_eq!(
            request_prelude_deadline(RuntimeMode::Packaged),
            REQUEST_PRELUDE_DEADLINE
        );
    }

    #[test]
    fn development_compiler_pause_before_first_byte_does_not_expire_private_prelude() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let shutdown = Arc::new(ShutdownCoordinator::default());
        let active_dashboard = Arc::new(AtomicUsize::new(0));

        thread::scope(|scope| {
            let server = scope.spawn(|| {
                let (mut stream, _) = listener.accept().unwrap();
                serve_connection(
                    &mut stream,
                    &expected_authority,
                    &control_authorities(),
                    DEVELOPMENT_REQUEST_PRELUDE_DEADLINE,
                    &active_dashboard,
                    42,
                    &shutdown,
                    &|| Ok(Vec::new()),
                    &UnreachableJobControl,
                    &UnreachableServiceControl,
                )
            });

            let mut client = TcpStream::connect(address).unwrap();
            client
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            // Reproduce a Hot compiler monopolizing Node after Undici has
            // connected but before it can put the request head on the wire.
            thread::sleep(REQUEST_DEADLINE + Duration::from_millis(250));
            write!(
                client,
                "GET /v1/status HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {DASHBOARD_TOKEN}\r\nContent-Length: 0\r\n\r\n"
            )
            .unwrap();
            client.shutdown(Shutdown::Write).unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            server.join().unwrap().unwrap();
            assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
        });
    }

    #[test]
    fn nonblocking_listener_normalizes_windows_stream_before_first_byte_wait() {
        let listener = BoundControlListener::bind_ephemeral_loopback().unwrap();
        let address = listener.listener.local_addr().unwrap();
        let expected_authority = address.to_string();
        let authorities = control_authorities();
        let shutdown = Arc::new(ShutdownCoordinator::default());

        thread::scope(|scope| {
            let server_shutdown = Arc::clone(&shutdown);
            let server = scope.spawn(move || {
                listener.serve_with_jobs(
                    ControlServerConfig {
                        authorities: &authorities,
                        mode: RuntimeMode::Packaged,
                        runtime_pid: 42,
                        shutdown: &server_shutdown,
                        job_control: &UnreachableJobControl,
                        service_control: &UnreachableServiceControl,
                    },
                    || Ok(Vec::new()),
                )
            });

            let mut client = TcpStream::connect(address).unwrap();
            client
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            // Leave the accepted socket temporarily empty. Windows must wait
            // for the request bytes instead of surfacing inherited WouldBlock
            // as an already-expired request deadline.
            thread::sleep(Duration::from_millis(250));
            write!(
                client,
                "GET /v1/status HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {DASHBOARD_TOKEN}\r\nContent-Length: 0\r\n\r\n"
            )
            .unwrap();
            client.shutdown(Shutdown::Write).unwrap();
            let mut response = String::new();
            client.read_to_string(&mut response).unwrap();
            assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");

            let shutdown_response = issue_live_tcp_request(
                address,
                &expected_authority,
                "POST",
                "/v1/shutdown",
                LIFECYCLE_TOKEN,
                "",
                b"",
            )
            .unwrap();
            assert!(
                shutdown_response.starts_with("HTTP/1.1 200 OK\r\n"),
                "{shutdown_response}"
            );
            server.join().unwrap().unwrap();
        });
    }

    #[test]
    fn job_routes_do_not_accept_encoded_ids_or_ambiguous_queries() {
        assert!(matches!(
            parse_job_route("POST", "/v1/jobs"),
            Ok(JobRoute::Submit)
        ));
        assert!(matches!(
            parse_job_route("POST", "/v1/jobs/lookup"),
            Ok(JobRoute::Lookup)
        ));
        assert!(matches!(
            parse_job_route("POST", "/v1/jobs/cancel-by-idempotency"),
            Ok(JobRoute::CancelByIdempotency)
        ));
        assert!(matches!(
            parse_job_route("GET", "/v1/jobs/job_1"),
            Ok(JobRoute::Inspect { job_id }) if job_id == "job_1"
        ));
        assert!(matches!(
            parse_job_route("POST", "/v1/jobs/job_1/cancel"),
            Ok(JobRoute::Cancel { job_id }) if job_id == "job_1"
        ));
        assert!(matches!(
            parse_job_route("GET", "/v1/jobs/job_1/events?after=0&limit=256"),
            Ok(JobRoute::Events { job_id, after: 0, limit: 256 }) if job_id == "job_1"
        ));
        assert!(matches!(
            parse_job_route("GET", "/v1/jobs/job_1/checkpoint"),
            Ok(JobRoute::Checkpoint { job_id }) if job_id == "job_1"
        ));
        assert!(matches!(
            parse_job_route("GET", "/v1/jobs/job_1/result"),
            Ok(JobRoute::Result { job_id }) if job_id == "job_1"
        ));
        assert!(parse_job_route("GET", "/v1/jobs/job%5f1").is_err());
        assert!(matches!(
            parse_job_route("GET", "/v1/jobs/lookup"),
            Err(JobRouteError::MethodNotAllowed)
        ));
        assert!(parse_job_route("POST", "/v1/jobs/lookup?scope=other").is_err());
        assert!(parse_job_route("POST", "/v1/jobs/cancel-by-idempotency?scope=other").is_err());
        assert!(parse_job_route("GET", "/v1/jobs/job_1/events?after=0&after=1&limit=2").is_err());
        assert!(parse_job_route("GET", "/v1/jobs/job_1/events?limit=2").is_err());
        assert!(parse_job_route("GET", "/v1/jobs/job_1/events?after=0&limit=257").is_err());
    }

    #[test]
    fn dashboard_job_lookup_is_bounded_exact_and_authority_scoped() {
        let lookup_response: RuntimeJobResponse = serde_json::from_slice(
            br#"{
            "type":"runtime-job",
            "protocolVersion":1,
            "job":{
                "jobId":"job_1",
                "jobType":"document-ingestion",
                "workerKind":"document-ingestion-node",
                "resourceClass":"large-generation",
                "state":"running",
                "stage":"processing",
                "attempt":1,
                "workerInstanceId":"worker_1",
                "gardenId":"garden-1",
                "conversationId":"conversation-1",
                "createdAt":100,
                "startedAt":101,
                "updatedAt":102,
                "finishedAt":null,
                "lastHeartbeatAt":102,
                "lastWorkerSequence":4,
                "progressCurrent":1,
                "progressTotal":4,
                "failureCode":null,
                "failureMessage":null,
                "resourceExhaustion":null,
                "cancellationRequested":false
            }
        }"#,
        )
        .unwrap();
        let control = RecordingJobControl::with_lookup_result(Ok(lookup_response));
        let body = br#"{"idempotencyKey":"ingest-request-1"}"#;
        let (result, response) = issue_raw_job_control_request(
            "POST",
            "/v1/jobs/lookup",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("\"type\":\"runtime-job\""));
        assert!(response.contains("\"jobId\":\"job_1\""));
        assert!(!response.contains("ingest-request-1"));
        assert_eq!(
            control.lookup_calls.lock().unwrap().as_slice(),
            &["ingest-request-1".to_owned()]
        );

        let unknown_field = br#"{"idempotencyKey":"ingest-request-2","userId":42}"#;
        let (_, response) = issue_raw_job_control_request(
            "POST",
            "/v1/jobs/lookup",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                unknown_field.len()
            ),
            unknown_field,
            &control,
        );
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert_eq!(control.lookup_calls.lock().unwrap().len(), 1);

        let (_, response) = issue_raw_job_control_request(
            "POST",
            "/v1/jobs/lookup",
            LIFECYCLE_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &control,
        );
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert_eq!(control.lookup_calls.lock().unwrap().len(), 1);

        let missing = RecordingJobControl::successful();
        let (_, response) = issue_raw_job_control_request(
            "POST",
            "/v1/jobs/lookup",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &missing,
        );
        assert!(response.starts_with("HTTP/1.1 404 Not Found\r\n"));
        assert!(response.contains("\"code\":\"JOB_NOT_FOUND\""));
    }

    #[test]
    fn dashboard_idempotency_cancellation_is_exact_authority_scoped_and_path_free() {
        let control = RecordingJobControl::successful();
        let body = br#"{"idempotencyKey":"ingest-request-1"}"#;
        let (result, response) = issue_raw_job_control_request(
            "POST",
            "/v1/jobs/cancel-by-idempotency",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("\"type\":\"runtime-job-idempotency-cancellation\""));
        assert!(response.contains("\"jobId\":null"));
        assert!(response.contains("\"state\":\"pending\""));
        assert!(response.contains("\"accepted\":true"));
        assert!(!response.contains("ingest-request-1"));
        assert_eq!(
            control
                .idempotency_cancellation_calls
                .lock()
                .unwrap()
                .as_slice(),
            &["ingest-request-1".to_owned()]
        );

        for (include_scope, invalid) in [
            (
                true,
                br#"{"idempotencyKey":"ingest-request-2","userId":42}"#.as_slice(),
            ),
            (
                false,
                br#"{"idempotencyKey":"ingest-request-2"}"#.as_slice(),
            ),
        ] {
            let (_, response) = issue_raw_job_control_request(
                "POST",
                "/v1/jobs/cancel-by-idempotency",
                DASHBOARD_TOKEN,
                include_scope,
                &format!(
                    "Content-Type: application/json\r\nContent-Length: {}\r\n",
                    invalid.len()
                ),
                invalid,
                &control,
            );
            assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        }
        let (_, response) = issue_raw_job_control_request(
            "POST",
            "/v1/jobs/cancel-by-idempotency",
            LIFECYCLE_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &control,
        );
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert_eq!(
            control.idempotency_cancellation_calls.lock().unwrap().len(),
            1
        );
    }

    #[test]
    fn learn_recovery_route_mints_only_its_fixed_internal_submission() {
        let response: RuntimeJobResponse = serde_json::from_slice(
            br#"{
                "type":"runtime-job",
                "protocolVersion":1,
                "job":{
                    "jobId":"job_recovery",
                    "jobType":"learn",
                    "workerKind":"learn-node",
                    "resourceClass":"large-generation",
                    "state":"queued",
                    "stage":null,
                    "attempt":0,
                    "workerInstanceId":null,
                    "gardenId":null,
                    "conversationId":null,
                    "createdAt":100,
                    "startedAt":null,
                    "updatedAt":100,
                    "finishedAt":null,
                    "lastHeartbeatAt":null,
                    "lastWorkerSequence":0,
                    "progressCurrent":0,
                    "progressTotal":0,
                    "failureCode":null,
                    "failureMessage":null,
                    "resourceExhaustion":null,
                    "cancellationRequested":false
                }
            }"#,
        )
        .unwrap();
        let control = RecordingJobControl::with_submit_result(Ok(response));
        let body = br#"{"idempotencyKey":"learn-recovery-v2:123"}"#;
        let (result, response) = issue_raw_job_control_request(
            "POST",
            "/v1/internal/jobs/learn-recovery",
            DASHBOARD_TOKEN,
            false,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 202 Accepted\r\n"));
        let calls = control.submit_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        let expected_context = control_authorities()
            .dashboard()
            .trusted_internal_context("learn-recovery", None, None)
            .unwrap();
        assert_eq!(calls[0].0, expected_context);
        assert_eq!(
            calls[0].1,
            JobSubmissionPayload {
                job_type: "learn".into(),
                garden_id: None,
                conversation_id: None,
                idempotency_key: "learn-recovery-v2:123".into(),
                input_uploads: Vec::new(),
                request_payload: serde_json::json!({ "operation": "recovery" }),
            }
        );
        drop(calls);

        for forged in [
            br#"{"idempotencyKey":"learn-recovery-v2:124","jobType":"document-ingestion"}"#
                .as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:124","requestPayload":{}}"#.as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:124","ownerPrincipal":"internal:other"}"#
                .as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:124","gardenId":"garden-1"}"#.as_slice(),
        ] {
            let (_, response) = issue_raw_job_control_request(
                "POST",
                "/v1/internal/jobs/learn-recovery",
                DASHBOARD_TOKEN,
                false,
                &format!(
                    "Content-Type: application/json\r\nContent-Length: {}\r\n",
                    forged.len()
                ),
                forged,
                &control,
            );
            assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        }
        let (_, response) = issue_raw_job_control_request(
            "POST",
            "/v1/internal/jobs/learn-recovery",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &control,
        );
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        let (_, response) = issue_raw_job_control_request_with_admission(
            "POST",
            "/v1/internal/jobs/learn-recovery",
            DASHBOARD_TOKEN,
            false,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                body.len()
            ),
            body,
            &control,
            false,
        );
        assert!(response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"));
        assert_eq!(control.submit_calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn input_quota_error_is_closed_rate_limit_without_private_evidence() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write_job_control_error(&mut server, RuntimeJobControlError::InputQuotaExceeded).unwrap();
        drop(server);

        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 429 Too Many Requests\r\n"));
        assert!(response.contains("\"code\":\"JOB_INPUT_QUOTA_EXCEEDED\""));
        assert!(response.contains("\"retryable\":false"));
        assert!(response.contains("\"resource\":null"));
        assert!(response.contains("\"requiredHeadroomMb\":null"));
        assert!(response.contains("\"availableHeadroomMb\":null"));
        assert!(!response.contains("owner"));
        assert!(!response.contains("global"));
        assert!(!response.contains("byte"));
        assert!(!response.contains("count"));

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write_job_control_error(
            &mut server,
            RuntimeJobControlError::CancellationQuotaExceeded,
        )
        .unwrap();
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 429 Too Many Requests\r\n"));
        assert!(response.contains("\"code\":\"JOB_CANCELLATION_QUOTA_EXCEEDED\""));
        assert!(response.contains("\"retryable\":false"));
        assert!(response.contains("\"resource\":null"));
        assert!(!response.contains("owner"));
        assert!(!response.contains("4096"));

        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write_job_control_error(
            &mut server,
            RuntimeJobControlError::CancelledBeforeSubmission,
        )
        .unwrap();
        drop(server);
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 409 Conflict\r\n"));
        assert!(response.contains("\"code\":\"JOB_CANCELLED_BEFORE_SUBMISSION\""));
        assert!(response.contains("\"retryable\":false"));
        assert!(response.contains("\"resource\":null"));
        assert!(!response.contains("idempotencyKey"));
        assert!(!response.contains("scope"));
    }

    #[test]
    fn job_input_routes_are_exact_unencoded_and_method_bound() {
        assert!(matches!(
            parse_job_input_route("POST", "/v1/job-inputs"),
            Ok(JobInputRoute::Reserve)
        ));
        assert!(matches!(
            parse_job_input_route("PUT", "/v1/job-inputs/upload_1"),
            Ok(JobInputRoute::Upload { upload_id }) if upload_id == "upload_1"
        ));
        assert!(matches!(
            parse_job_input_route("POST", "/v1/job-inputs/upload_1/abandon"),
            Ok(JobInputRoute::Abandon { upload_id }) if upload_id == "upload_1"
        ));
        for path in [
            "/v1/job-inputs/upload%5f1",
            "/v1/job-inputs/../upload_1",
            "/v1/job-inputs/upload_1?scope=other",
            "/v1/job-inputs/upload_1/abandon/extra",
        ] {
            assert!(parse_job_input_route("PUT", path).is_err(), "{path}");
        }
        assert!(matches!(
            parse_job_input_route("GET", "/v1/job-inputs/upload_1"),
            Err(JobRouteError::MethodNotAllowed)
        ));
    }

    #[test]
    fn dashboard_reserves_and_abandons_only_scope_bound_job_inputs() {
        let control = RecordingJobControl::successful();
        let request = br#"{"gardenId":"garden-1","conversationId":"conversation-1","displayName":"notes.txt","mediaType":"text/plain","declaredSizeBytes":7}"#;
        let (result, response) = issue_raw_job_control_request(
            "POST",
            "/v1/job-inputs",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                request.len()
            ),
            request,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 201 Created\r\n"));
        assert!(response.contains("\"uploadId\":\"upload_1\""));
        assert!(response.contains(&format!("\"maximumBytes\":{MAX_JOB_INPUT_UPLOAD_BYTES}")));
        assert_eq!(control.reserve_calls.lock().unwrap().len(), 1);

        let mismatched = br#"{"gardenId":"garden-other","conversationId":"conversation-1","displayName":"notes.txt","mediaType":"text/plain","declaredSizeBytes":7}"#;
        let (_, response) = issue_raw_job_control_request(
            "POST",
            "/v1/job-inputs",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                mismatched.len()
            ),
            mismatched,
            &control,
        );
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert_eq!(control.reserve_calls.lock().unwrap().len(), 1);

        let (result, response) = issue_raw_job_control_request(
            "POST",
            "/v1/job-inputs/upload_1/abandon",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert_eq!(
            control.abandon_calls.lock().unwrap().as_slice(),
            &["upload_1".to_owned()]
        );
    }

    #[test]
    fn shutdown_denies_reserve_and_upload_but_keeps_abandon_available() {
        let control = RecordingJobControl::successful();
        let request = br#"{"gardenId":"garden-1","conversationId":"conversation-1","displayName":"notes.txt","mediaType":"text/plain","declaredSizeBytes":7}"#;
        let (_, response) = issue_raw_job_control_request_with_admission(
            "POST",
            "/v1/job-inputs",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n",
                request.len()
            ),
            request,
            &control,
            false,
        );
        assert!(response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"));
        assert!(control.reserve_calls.lock().unwrap().is_empty());

        let (_, response) = issue_raw_job_control_request_with_admission(
            "PUT",
            "/v1/job-inputs/upload_1",
            DASHBOARD_TOKEN,
            true,
            "Content-Type: application/octet-stream\r\nContent-Length: 7\r\n",
            b"payload",
            &control,
            false,
        );
        assert!(response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"));
        assert!(control.upload_calls.lock().unwrap().is_empty());

        let (_, response) = issue_raw_job_control_request_with_admission(
            "POST",
            "/v1/job-inputs/upload_1/abandon",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &control,
            false,
        );
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert_eq!(
            control.abandon_calls.lock().unwrap().as_slice(),
            &["upload_1".to_owned()]
        );
    }

    #[test]
    fn in_flight_upload_observes_shutdown_and_releases_its_control_thread() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let expected_authority = format!("127.0.0.1:{}", address.port());
        let mut client = TcpStream::connect(address).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        write!(
            client,
            "PUT /v1/job-inputs/upload_1 HTTP/1.1\r\nHost: {expected_authority}\r\nAuthorization: Bearer {DASHBOARD_TOKEN}\r\nX-Breadboard-User-Id: 42\r\nX-Breadboard-Garden-Id: garden-1\r\nX-Breadboard-Conversation-Id: conversation-1\r\nContent-Type: application/octet-stream\r\nContent-Length: 7\r\n\r\n"
        )
        .unwrap();
        client.flush().unwrap();

        let shutdown = Arc::new(ShutdownCoordinator::default());
        shutdown.open_admission_for_control_test();
        let active_dashboard = Arc::new(AtomicUsize::new(0));
        let control = RecordingJobControl::successful();
        thread::scope(|scope| {
            let breaker = server.try_clone().unwrap();
            let (completed_sender, completed_receiver) = mpsc::channel();
            let watchdog = scope.spawn(move || {
                if completed_receiver
                    .recv_timeout(Duration::from_secs(3))
                    .is_err()
                {
                    let _ = breaker.shutdown(Shutdown::Both);
                }
            });
            let handle = scope.spawn(|| {
                serve_connection(
                    &mut server,
                    &expected_authority,
                    &control_authorities(),
                    REQUEST_PRELUDE_DEADLINE,
                    &active_dashboard,
                    42,
                    &shutdown,
                    &|| Ok(Vec::new()),
                    &control,
                    &UnreachableServiceControl,
                )
            });
            let wait_deadline = Instant::now() + Duration::from_secs(2);
            while *control.upload_attempts.lock().unwrap() == 0 {
                assert!(Instant::now() < wait_deadline, "upload did not start");
                thread::sleep(Duration::from_millis(10));
            }
            let requested_at = Instant::now();
            shutdown.request_shutdown();
            let result = handle.join().unwrap();
            let _ = completed_sender.send(());
            watchdog.join().unwrap();
            result.unwrap();
            assert!(requested_at.elapsed() < Duration::from_secs(2));
        });
        drop(server);
        client
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"));
        assert_eq!(*control.upload_failures.lock().unwrap(), 1);
        assert!(control.upload_calls.lock().unwrap().is_empty());
        assert_eq!(
            control.abandon_calls.lock().unwrap().as_slice(),
            &["upload_1".to_owned()]
        );
    }

    #[test]
    fn upload_shutdown_error_is_terminal_for_standard_read_consumers() {
        struct ShutdownReader {
            reads: usize,
        }

        impl Read for ShutdownReader {
            fn read(&mut self, _output: &mut [u8]) -> io::Result<usize> {
                self.reads += 1;
                assert_eq!(self.reads, 1, "shutdown error was automatically retried");
                Err(upload_shutdown_error())
            }
        }

        let mut read_to_end_source = ShutdownReader { reads: 0 };
        let mut bytes = Vec::new();
        assert_eq!(
            read_to_end_source
                .read_to_end(&mut bytes)
                .unwrap_err()
                .kind(),
            io::ErrorKind::ConnectionAborted
        );
        assert_eq!(read_to_end_source.reads, 1);

        let mut copy_source = ShutdownReader { reads: 0 };
        assert_eq!(
            io::copy(&mut copy_source, &mut io::sink())
                .unwrap_err()
                .kind(),
            io::ErrorKind::ConnectionAborted
        );
        assert_eq!(copy_source.reads, 1);
    }

    #[test]
    fn raw_job_input_upload_streams_fixed_and_chunked_bodies_to_control() {
        let fixed = RecordingJobControl::successful();
        let (result, response) = issue_raw_job_control_request(
            "PUT",
            "/v1/job-inputs/upload_1",
            DASHBOARD_TOKEN,
            true,
            "Content-Type: application/octet-stream\r\nContent-Length: 7\r\n",
            b"payload",
            &fixed,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("\"type\":\"runtime-job-input\""));
        assert!(response.contains("\"state\":\"sealed\""));
        assert!(response.contains("\"sizeBytes\":7"));
        assert_eq!(
            fixed.upload_calls.lock().unwrap().as_slice(),
            &[("upload_1".to_owned(), b"payload".to_vec())]
        );

        let chunked = RecordingJobControl::successful();
        let (result, response) = issue_raw_job_control_request(
            "PUT",
            "/v1/job-inputs/upload_2",
            DASHBOARD_TOKEN,
            true,
            "Content-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n",
            b"3\r\nabc\r\n4\r\ndefg\r\n0\r\n\r\n",
            &chunked,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert_eq!(
            chunked.upload_calls.lock().unwrap().as_slice(),
            &[("upload_2".to_owned(), b"abcdefg".to_vec())]
        );
    }

    #[test]
    fn dashboard_client_pool_ceiling_leaves_cross_realm_and_lifecycle_headroom() {
        const MUTATION_HEADERS: &str = "Content-Type: application/json\r\nX-Breadboard-User-Id: 42\r\nX-Breadboard-Garden-Id: garden-1\r\nX-Breadboard-Conversation-Id: conversation-1\r\n";

        let listener = BoundControlListener::bind_ephemeral_loopback().unwrap();
        let address = listener.listener.local_addr().unwrap();
        let expected_authority = address.to_string();
        let authorities = control_authorities();
        let shutdown = Arc::new(ShutdownCoordinator::default());
        shutdown.open_admission_for_control_test();
        let job_control = RecordingJobControl::successful();
        let service_control = UnreachableServiceControl;
        let status_gate = Arc::new((Mutex::new((0_usize, false)), Condvar::new()));

        thread::scope(|scope| {
            let server_gate = Arc::clone(&status_gate);
            let server_shutdown = Arc::clone(&shutdown);
            let server_authorities = &authorities;
            let server_job_control = &job_control;
            let server_service_control = &service_control;
            let server = scope.spawn(move || {
                listener.serve_with_jobs(
                    ControlServerConfig {
                        authorities: server_authorities,
                        mode: RuntimeMode::Packaged,
                        runtime_pid: 42,
                        shutdown: &server_shutdown,
                        job_control: server_job_control,
                        service_control: server_service_control,
                    },
                    || {
                        let (state, changed) = &*server_gate;
                        let mut state = state.lock().unwrap();
                        state.0 += 1;
                        changed.notify_all();
                        while !state.1 {
                            state = changed.wait(state).unwrap();
                        }
                        Ok(Vec::new())
                    },
                )
            });

            let mut status_clients = Vec::with_capacity(DASHBOARD_CLIENT_POOL_CEILING);
            for _ in 0..DASHBOARD_CLIENT_POOL_CEILING {
                let client_authority = expected_authority.clone();
                status_clients.push(scope.spawn(move || {
                    issue_live_tcp_request(
                        address,
                        &client_authority,
                        "GET",
                        "/v1/status",
                        DASHBOARD_TOKEN,
                        "",
                        b"",
                    )
                }));
            }

            let all_statuses_entered = {
                let deadline = Instant::now() + Duration::from_secs(5);
                let (state, changed) = &*status_gate;
                let mut state = state.lock().unwrap();
                while state.0 < DASHBOARD_CLIENT_POOL_CEILING {
                    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                        break;
                    };
                    let (next, timeout) = changed.wait_timeout(state, remaining).unwrap();
                    state = next;
                    if timeout.timed_out() {
                        break;
                    }
                }
                state.0 == DASHBOARD_CLIENT_POOL_CEILING
            };

            let mutation_bodies = [
                br#"{"gardenId":"garden-1","conversationId":"conversation-1","displayName":"notes-one.txt","mediaType":"text/plain","declaredSizeBytes":7}"#.as_slice(),
                br#"{"gardenId":"garden-1","conversationId":"conversation-1","displayName":"notes-two.txt","mediaType":"text/plain","declaredSizeBytes":9}"#.as_slice(),
            ];
            let mutation_clients = mutation_bodies.map(|body| {
                let client_authority = expected_authority.clone();
                scope.spawn(move || {
                    issue_live_tcp_request(
                        address,
                        &client_authority,
                        "POST",
                        "/v1/job-inputs",
                        DASHBOARD_TOKEN,
                        MUTATION_HEADERS,
                        body,
                    )
                })
            });
            let mutation_responses = mutation_clients.map(|client| client.join().unwrap());
            let lifecycle_response = issue_live_tcp_request(
                address,
                &expected_authority,
                "POST",
                "/v1/shutdown",
                LIFECYCLE_TOKEN,
                "",
                b"",
            );
            let shutdown_completed_before_dashboard_release = shutdown.is_requested();

            {
                let (state, changed) = &*status_gate;
                let mut state = state.lock().unwrap();
                state.1 = true;
                changed.notify_all();
            }
            let status_results = status_clients
                .into_iter()
                .map(|client| client.join().unwrap())
                .collect::<Vec<_>>();
            let server_result = server.join().unwrap();

            assert!(
                all_statuses_entered,
                "the dashboard client-pool ceiling was not held concurrently"
            );
            for response in mutation_responses {
                assert!(
                    response
                        .as_deref()
                        .unwrap_or_default()
                        .starts_with("HTTP/1.1 201 Created\r\n"),
                    "cross-realm dashboard mutation was reset or rejected: {response:?}"
                );
            }
            assert_eq!(job_control.reserve_calls.lock().unwrap().len(), 2);
            assert!(
                lifecycle_response
                    .as_deref()
                    .unwrap_or_default()
                    .starts_with("HTTP/1.1 200 OK\r\n"),
                "lifecycle shutdown could not use its independent reserve: {lifecycle_response:?}"
            );
            assert!(
                shutdown_completed_before_dashboard_release,
                "shutdown completed only after dashboard handlers were released"
            );
            for response in status_results {
                assert!(response
                    .unwrap_or_default()
                    .starts_with("HTTP/1.1 200 OK\r\n"));
            }
            server_result.unwrap();
        });
    }

    #[test]
    fn dashboard_overload_drains_bounded_json_before_503_and_preserves_lifecycle() {
        let listener = BoundControlListener::bind_ephemeral_loopback().unwrap();
        let address = listener.listener.local_addr().unwrap();
        let expected_authority = address.to_string();
        let authorities = control_authorities();
        let shutdown = Arc::new(ShutdownCoordinator::default());
        shutdown.open_admission_for_control_test();
        let job_control = RecordingJobControl::successful();
        let service_control = UnreachableServiceControl;
        let status_gate = Arc::new((Mutex::new((0_usize, false)), Condvar::new()));

        thread::scope(|scope| {
            let server_gate = Arc::clone(&status_gate);
            let server_shutdown = Arc::clone(&shutdown);
            let server_authorities = &authorities;
            let server_job_control = &job_control;
            let server_service_control = &service_control;
            let server = scope.spawn(move || {
                listener.serve_with_jobs(
                    ControlServerConfig {
                        authorities: server_authorities,
                        mode: RuntimeMode::Packaged,
                        runtime_pid: 42,
                        shutdown: &server_shutdown,
                        job_control: server_job_control,
                        service_control: server_service_control,
                    },
                    || {
                        let (state, changed) = &*server_gate;
                        let mut state = state.lock().unwrap();
                        state.0 += 1;
                        changed.notify_all();
                        while !state.1 {
                            state = changed.wait(state).unwrap();
                        }
                        Ok(Vec::new())
                    },
                )
            });

            let mut status_clients = Vec::with_capacity(MAX_ACTIVE_DASHBOARD_CONNECTIONS);
            for _ in 0..MAX_ACTIVE_DASHBOARD_CONNECTIONS {
                let client_authority = expected_authority.clone();
                status_clients.push(scope.spawn(move || {
                    issue_live_tcp_request(
                        address,
                        &client_authority,
                        "GET",
                        "/v1/status",
                        DASHBOARD_TOKEN,
                        "",
                        b"",
                    )
                }));
            }

            let all_statuses_entered = {
                let deadline = Instant::now() + Duration::from_secs(5);
                let (state, changed) = &*status_gate;
                let mut state = state.lock().unwrap();
                while state.0 < MAX_ACTIVE_DASHBOARD_CONNECTIONS {
                    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                        break;
                    };
                    let (next, timeout) = changed.wait_timeout(state, remaining).unwrap();
                    state = next;
                    if timeout.timed_out() {
                        break;
                    }
                }
                state.0 == MAX_ACTIVE_DASHBOARD_CONNECTIONS
            };

            let padding = "x".repeat(8 * 1024);
            let saturated_body = format!(
                "{{\"jobType\":\"document-ingestion\",\"gardenId\":\"garden-1\",\"conversationId\":\"conversation-1\",\"idempotencyKey\":\"saturated-post-1\",\"inputUploads\":[],\"requestPayload\":{{\"padding\":\"{padding}\"}}}}"
            );
            let saturated_dashboard_response = if all_statuses_entered {
                issue_live_tcp_request(
                    address,
                    &expected_authority,
                    "POST",
                    "/v1/jobs",
                    DASHBOARD_TOKEN,
                    "Content-Type: application/json\r\nX-Breadboard-User-Id: 42\r\nX-Breadboard-Garden-Id: garden-1\r\nX-Breadboard-Conversation-Id: conversation-1\r\n",
                    saturated_body.as_bytes(),
                )
            } else {
                Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "dashboard handlers did not reach the admission cap",
                ))
            };
            let lifecycle_response = issue_live_tcp_request(
                address,
                &expected_authority,
                "POST",
                "/v1/shutdown",
                LIFECYCLE_TOKEN,
                "",
                b"",
            );
            let shutdown_completed_before_dashboard_release = shutdown.is_requested();

            {
                let (state, changed) = &*status_gate;
                let mut state = state.lock().unwrap();
                state.1 = true;
                changed.notify_all();
            }
            let status_results = status_clients
                .into_iter()
                .map(|client| client.join().unwrap())
                .collect::<Vec<_>>();
            let server_result = server.join().unwrap();

            assert!(
                all_statuses_entered,
                "the authenticated dashboard requests did not occupy every dashboard slot"
            );
            for response in status_results {
                assert!(response
                    .unwrap_or_default()
                    .starts_with("HTTP/1.1 200 OK\r\n"));
            }
            assert!(
                saturated_dashboard_response
                    .as_deref()
                    .unwrap_or_default()
                    .starts_with("HTTP/1.1 503 Service Unavailable\r\n"),
                "excess authenticated dashboard request was reset or not rejected explicitly: {saturated_dashboard_response:?}"
            );
            assert!(
                lifecycle_response
                    .as_deref()
                    .unwrap_or_default()
                    .starts_with("HTTP/1.1 200 OK\r\n"),
                "lifecycle shutdown could not use its reserved handler capacity: {lifecycle_response:?}"
            );
            assert!(
                shutdown_completed_before_dashboard_release,
                "shutdown completed only after dashboard handlers were released"
            );
            server_result.unwrap();
        });
    }

    #[test]
    fn upload_authentication_and_role_checks_happen_before_core_reads_bytes() {
        for (token, include_scope, expected_status) in [
            (LIFECYCLE_TOKEN, true, "403 Forbidden"),
            ("invalid-invalid-invalid-invalid", true, "401 Unauthorized"),
            (DASHBOARD_TOKEN, false, "400 Bad Request"),
        ] {
            let control = RecordingJobControl::successful();
            let (result, response) = issue_raw_job_control_request(
                "PUT",
                "/v1/job-inputs/upload_1",
                token,
                include_scope,
                "Content-Type: application/octet-stream\r\nContent-Length: 7\r\n",
                b"payload",
                &control,
            );
            result.unwrap();
            assert!(
                response.starts_with(&format!("HTTP/1.1 {expected_status}\r\n")),
                "{response}"
            );
            assert!(control.upload_calls.lock().unwrap().is_empty());
            assert_eq!(*control.upload_failures.lock().unwrap(), 0);
        }
    }

    #[test]
    fn disconnected_oversized_and_pipelined_uploads_never_publish() {
        let disconnected = RecordingJobControl::successful();
        let (result, response) = issue_raw_job_control_request(
            "PUT",
            "/v1/job-inputs/upload_1",
            DASHBOARD_TOKEN,
            true,
            "Content-Type: application/octet-stream\r\nContent-Length: 8\r\n",
            b"abc",
            &disconnected,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(disconnected.upload_calls.lock().unwrap().is_empty());
        assert_eq!(*disconnected.upload_failures.lock().unwrap(), 1);
        assert_eq!(
            disconnected.abandon_calls.lock().unwrap().as_slice(),
            &["upload_1".to_owned()]
        );

        let oversized = RecordingJobControl::successful();
        let (result, response) = issue_raw_job_control_request(
            "PUT",
            "/v1/job-inputs/upload_1",
            DASHBOARD_TOKEN,
            true,
            &format!(
                "Content-Type: application/octet-stream\r\nContent-Length: {}\r\n",
                MAX_JOB_INPUT_UPLOAD_BYTES + 1
            ),
            b"",
            &oversized,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 413 Payload Too Large\r\n"));
        assert!(oversized.upload_calls.lock().unwrap().is_empty());
        assert_eq!(
            oversized.abandon_calls.lock().unwrap().as_slice(),
            &["upload_1".to_owned()]
        );

        let chunked_oversized = RecordingJobControl::successful();
        let (result, response) = issue_raw_job_control_request(
            "PUT",
            "/v1/job-inputs/upload_1",
            DASHBOARD_TOKEN,
            true,
            "Content-Type: application/octet-stream\r\nTransfer-Encoding: chunked\r\n",
            b"80000001\r\n",
            &chunked_oversized,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 413 Payload Too Large\r\n"));
        assert!(chunked_oversized.upload_calls.lock().unwrap().is_empty());
        assert_eq!(*chunked_oversized.upload_failures.lock().unwrap(), 1);
        assert_eq!(
            chunked_oversized.abandon_calls.lock().unwrap().as_slice(),
            &["upload_1".to_owned()]
        );

        let pipelined = RecordingJobControl::successful();
        let (result, response) = issue_raw_job_control_request(
            "PUT",
            "/v1/job-inputs/upload_1",
            DASHBOARD_TOKEN,
            true,
            "Content-Type: application/octet-stream\r\nContent-Length: 3\r\n",
            b"abcGET /v1/status HTTP/1.1\r\n\r\n",
            &pipelined,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(pipelined.upload_calls.lock().unwrap().is_empty());
        assert_eq!(
            pipelined.abandon_calls.lock().unwrap().as_slice(),
            &["upload_1".to_owned()]
        );
    }

    #[test]
    fn owned_job_outputs_use_their_separate_bound_and_typed_not_ready_error() {
        let control = RecordingJobControl::successful();
        let (_, checkpoint) = issue_raw_job_control_request(
            "GET",
            "/v1/jobs/job_1/checkpoint",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &control,
        );
        assert!(checkpoint.starts_with("HTTP/1.1 200 OK\r\n"));
        let checkpoint: serde_json::Value = serde_json::from_str(
            checkpoint
                .split_once("\r\n\r\n")
                .expect("checkpoint response head")
                .1,
        )
        .unwrap();
        assert_eq!(checkpoint["type"], "runtime-job-output");
        assert_eq!(checkpoint["kind"], "checkpoint");
        assert_eq!(
            checkpoint["content"],
            serde_json::json!({"stage": "parsing", "current": 1})
        );

        let (_, result) = issue_raw_job_control_request(
            "GET",
            "/v1/jobs/job_1/result",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &control,
        );
        assert!(result.starts_with("HTTP/1.1 200 OK\r\n"));
        let result: serde_json::Value = serde_json::from_str(
            result
                .split_once("\r\n\r\n")
                .expect("result response head")
                .1,
        )
        .unwrap();
        assert_eq!(result["kind"], "result");
        assert_eq!(
            result["content"],
            serde_json::json!({"ok": true, "documentId": "doc_1"})
        );

        let unavailable = RecordingJobControl::with_outputs(
            Err(RuntimeJobControlError::OutputNotReady),
            Err(RuntimeJobControlError::NotFound),
        );
        let (_, response) = issue_raw_job_control_request(
            "GET",
            "/v1/jobs/job_1/checkpoint",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &unavailable,
        );
        assert!(response.starts_with("HTTP/1.1 409 Conflict\r\n"));
        assert!(response.contains("\"code\":\"JOB_OUTPUT_NOT_READY\""));
        let (_, response) = issue_raw_job_control_request(
            "GET",
            "/v1/jobs/job_1/result",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &unavailable,
        );
        assert!(response.starts_with("HTTP/1.1 404 Not Found\r\n"));

        let oversized = RecordingJobControl::with_outputs(
            Ok(br#"{}"#.to_vec()),
            Ok(vec![b'x'; MAX_JOB_OUTPUT_CONTENT_BYTES + 1]),
        );
        let (_, response) = issue_raw_job_control_request(
            "GET",
            "/v1/jobs/job_1/result",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &oversized,
        );
        assert!(response.starts_with("HTTP/1.1 500 Internal Server Error\r\n"));

        let malformed = RecordingJobControl::with_outputs(
            Ok(br#"{}"#.to_vec()),
            Ok(br#"C:\private\runtime\jobs\job_1\result.json"#.to_vec()),
        );
        let (_, response) = issue_raw_job_control_request(
            "GET",
            "/v1/jobs/job_1/result",
            DASHBOARD_TOKEN,
            true,
            "",
            b"",
            &malformed,
        );
        assert!(response.starts_with("HTTP/1.1 500 Internal Server Error\r\n"));
        assert!(!response.contains("private"));
        assert!(!response.contains("result.json"));
    }

    #[test]
    fn larger_job_output_bound_does_not_widen_control_message_responses() {
        let value = "x".repeat(MAX_PROTOCOL_LINE_BYTES);
        assert!(matches!(
            bounded_json(&value),
            Err(ControlError::OversizedResponse)
        ));
        assert!(bounded_json_with_limit(&value, MAX_JOB_OUTPUT_RESPONSE_BYTES).is_ok());
    }

    #[test]
    fn service_routes_are_exact_unencoded_and_method_bound() {
        assert!(matches!(
            parse_service_route("GET", "/v1/services/voicebox/lease-contract"),
            Ok(ServiceRoute::Contract { service_id }) if service_id == "voicebox"
        ));
        assert!(matches!(
            parse_service_route("POST", "/v1/services/hermes/lease"),
            Ok(ServiceRoute::Acquire { service_id }) if service_id == "hermes"
        ));
        assert!(matches!(
            parse_service_route("POST", "/v1/leases/lease_1/release"),
            Ok(ServiceRoute::Release { lease_id }) if lease_id == "lease_1"
        ));
        assert!(matches!(
            parse_service_route("GET", "/v1/services/hermes/lease"),
            Err(ServiceRouteError::MethodNotAllowed)
        ));
        assert!(matches!(
            parse_service_route("POST", "/v1/services/hermes/lease-contract"),
            Err(ServiceRouteError::MethodNotAllowed)
        ));
        for path in [
            "/v1/services/hermes%2fother/lease-contract",
            "/v1/services/hermes/lease-contract?extra=1",
            "/v1/services/hermes%2fother/lease",
            "/v1/services/hermes/lease?reason=turn",
            "/v1/services/hermes/lease/extra",
            "/v1/leases/../release",
            "/v1/leases/lease_1/release#fragment",
        ] {
            assert!(parse_service_route("POST", path).is_err(), "{path}");
        }
    }

    #[test]
    fn dashboard_service_mutations_are_authenticated_strict_and_route_bound() {
        let control = RecordingServiceControl::successful("hermes");
        let (result, response) = issue_service_control_request(
            "GET",
            "/v1/services/hermes/lease-contract",
            DASHBOARD_TOKEN,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("\"protocolVersion\":1"));
        assert!(response.contains("\"serviceId\":\"hermes\""));
        assert!(response.contains("\"acquireTimeoutMs\":100000"));
        assert_eq!(
            control.contract_calls.lock().unwrap().as_slice(),
            &["hermes".to_owned()]
        );

        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/services/hermes/lease",
            DASHBOARD_TOKEN,
            br#"{"reason":"terminal-turn"}"#,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("\"ok\":true"));
        assert!(response.contains("\"serviceId\":\"hermes\""));
        assert_eq!(
            control.acquire_calls.lock().unwrap().as_slice(),
            &[("hermes".to_owned(), "terminal-turn".to_owned())]
        );

        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/leases/01234567-89ab-cdef-0123-456789abcdef/release",
            DASHBOARD_TOKEN,
            br#"{}"#,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("\"released\":true"));
        assert_eq!(
            control.release_calls.lock().unwrap().as_slice(),
            &["01234567-89ab-cdef-0123-456789abcdef".to_owned()]
        );

        let denied = RecordingServiceControl::successful("hermes");
        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/services/hermes/lease",
            LIFECYCLE_TOKEN,
            br#"{"reason":"terminal-turn"}"#,
            &denied,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert!(denied.acquire_calls.lock().unwrap().is_empty());

        let invalid = RecordingServiceControl::successful("hermes");
        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/services/hermes/lease",
            DASHBOARD_TOKEN,
            br#"{"reason":"terminal-turn","serviceId":"dashboard"}"#,
            &invalid,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(response.contains("\"code\":\"INVALID_SERVICE_REQUEST\""));
        assert!(invalid.acquire_calls.lock().unwrap().is_empty());

        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/leases/lease_1/release",
            DASHBOARD_TOKEN,
            br#"{"afterOwnerPidExit":42}"#,
            &invalid,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(invalid.release_calls.lock().unwrap().is_empty());
    }

    #[test]
    fn lifecycle_service_retry_is_exact_bounded_and_not_dashboard_authorized() {
        let control = RecordingServiceControl::successful("dashboard");
        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/lifecycle/services/dashboard/retry",
            LIFECYCLE_TOKEN,
            br#"{}"#,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(response.contains("\"serviceId\":\"dashboard\""));
        assert!(response.contains("\"accepted\":true"));
        assert_eq!(
            control.retry_calls.lock().unwrap().as_slice(),
            &["dashboard".to_owned()]
        );

        let denied = RecordingServiceControl::successful("dashboard");
        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/lifecycle/services/dashboard/retry",
            DASHBOARD_TOKEN,
            br#"{}"#,
            &denied,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert!(denied.retry_calls.lock().unwrap().is_empty());

        for (path, body) in [
            (
                "/v1/lifecycle/services/dashboard/retry?again=1",
                br#"{}"#.as_slice(),
            ),
            (
                "/v1/lifecycle/services/dashboard%2fother/retry",
                br#"{}"#.as_slice(),
            ),
            (
                "/v1/lifecycle/services/dashboard/retry/extra",
                br#"{}"#.as_slice(),
            ),
            (
                "/v1/lifecycle/services/dashboard/retry",
                br#"{\"force\":true}"#.as_slice(),
            ),
        ] {
            let invalid = RecordingServiceControl::successful("dashboard");
            let (result, response) =
                issue_json_control_request("POST", path, LIFECYCLE_TOKEN, body, &invalid);
            result.unwrap();
            assert!(
                response.starts_with("HTTP/1.1 400 Bad Request\r\n")
                    || response.starts_with("HTTP/1.1 404 Not Found\r\n"),
                "{path}: {response}"
            );
            assert!(invalid.retry_calls.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn gateway_and_schedule_routes_are_user_scoped_exact_and_role_sealed() {
        let control = RecordingServiceControl::successful("dashboard");
        for (path, body) in [
            (
                "/v1/gateways/telegram/reconcile",
                br#"{"desiredState":"running"}"#.as_slice(),
            ),
            (
                "/v1/gateways/whatsapp/reconcile",
                br#"{"desiredState":"stopped"}"#.as_slice(),
            ),
            (
                "/v1/schedules/email-poll/reconcile",
                br#"{"desiredState":"running"}"#.as_slice(),
            ),
            ("/v1/schedules/email-poll/status", br#"{}"#.as_slice()),
        ] {
            let (result, response) =
                issue_user_json_control_request("POST", path, DASHBOARD_TOKEN, body, &control);
            result.unwrap();
            assert!(
                response.starts_with("HTTP/1.1 200 OK\r\n"),
                "{path}: {response}"
            );
            assert!(response.contains("\"ok\":true"), "{path}: {response}");
        }
        assert_eq!(
            control.gateway_calls.lock().unwrap().as_slice(),
            &[
                (42, RuntimeGatewayId::Telegram, RuntimeDesiredState::Running),
                (42, RuntimeGatewayId::Whatsapp, RuntimeDesiredState::Stopped),
            ]
        );
        assert_eq!(
            control.schedule_calls.lock().unwrap().as_slice(),
            &[(42, "email-poll".to_owned(), RuntimeDesiredState::Running)]
        );

        let missing_owner = RecordingServiceControl::successful("dashboard");
        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/gateways/telegram/reconcile",
            DASHBOARD_TOKEN,
            br#"{"desiredState":"running"}"#,
            &missing_owner,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(missing_owner.gateway_calls.lock().unwrap().is_empty());

        let lifecycle = RecordingServiceControl::successful("dashboard");
        let (result, response) = issue_user_json_control_request(
            "POST",
            "/v1/gateways/telegram/reconcile",
            LIFECYCLE_TOKEN,
            br#"{"desiredState":"running"}"#,
            &lifecycle,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert!(lifecycle.gateway_calls.lock().unwrap().is_empty());

        for (path, body) in [
            (
                "/v1/gateways/telegram/reconcile?again=1",
                br#"{"desiredState":"running"}"#.as_slice(),
            ),
            (
                "/v1/gateways/unknown/reconcile",
                br#"{"desiredState":"running"}"#.as_slice(),
            ),
            (
                "/v1/schedules/email-poll/reconcile",
                br#"{"desiredState":"running","extra":true}"#.as_slice(),
            ),
            (
                "/v1/schedules/email-poll/status",
                br#"{"desiredState":"running"}"#.as_slice(),
            ),
        ] {
            let invalid = RecordingServiceControl::successful("dashboard");
            let (result, response) =
                issue_user_json_control_request("POST", path, DASHBOARD_TOKEN, body, &invalid);
            result.unwrap();
            assert!(
                response.starts_with("HTTP/1.1 400 Bad Request\r\n")
                    || response.starts_with("HTTP/1.1 404 Not Found\r\n"),
                "{path}: {response}"
            );
            assert!(invalid.gateway_calls.lock().unwrap().is_empty());
            assert!(invalid.schedule_calls.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn recall_routes_are_exact_owner_scoped_bounded_and_direct() {
        let control = RecordingServiceControl::successful("recall");
        let running = br#"{"desiredState":"running","configuration":{"captureAudio":false,"excludedWindows":["Private Window","Discord"]}}"#;
        let (result, response) = issue_user_json_control_request(
            "POST",
            "/v1/services/recall/reconcile",
            DASHBOARD_TOKEN,
            running,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
        assert!(response.contains("\"serviceId\":\"recall\""));
        assert!(response.contains("\"desiredState\":\"running\""));
        assert!(response.contains("\"serviceState\":\"healthy\""));
        assert!(!response.contains("\"result\""));
        let calls = control.recall_calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, 42);
        let configuration = calls[0].1.configuration.as_ref().unwrap();
        assert!(!configuration.capture_audio);
        assert_eq!(
            configuration.excluded_windows,
            ["Private Window", "Discord"]
        );
        drop(calls);

        let (result, response) = issue_user_json_control_request(
            "POST",
            "/v1/services/recall/status",
            DASHBOARD_TOKEN,
            br#"{}"#,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK\r\n"), "{response}");
        assert!(response.contains("\"ownedByRequester\":true"));
        assert!(response.contains("\"logTail\":[]"));
        assert!(!response.contains("\"result\""));
        assert_eq!(
            control.recall_status_calls.lock().unwrap().as_slice(),
            &[42]
        );

        let (result, response) = issue_user_json_control_request(
            "POST",
            "/v1/services/recall/reconcile",
            DASHBOARD_TOKEN,
            br#"{"desiredState":"stopped"}"#,
            &control,
        );
        result.unwrap();
        assert!(response.contains("\"serviceState\":\"stopped\""));

        let missing_owner = RecordingServiceControl::successful("recall");
        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/services/recall/reconcile",
            DASHBOARD_TOKEN,
            running,
            &missing_owner,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(missing_owner.recall_calls.lock().unwrap().is_empty());

        let lifecycle = RecordingServiceControl::successful("recall");
        let (result, response) = issue_user_json_control_request(
            "POST",
            "/v1/services/recall/status",
            LIFECYCLE_TOKEN,
            br#"{}"#,
            &lifecycle,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 403 Forbidden\r\n"));
        assert!(lifecycle.recall_status_calls.lock().unwrap().is_empty());

        for (path, body) in [
            (
                "/v1/services/recall/reconcile?again=1",
                running.as_slice(),
            ),
            (
                "/v1/services/recall/reconcile",
                br#"{"desiredState":"running"}"#.as_slice(),
            ),
            (
                "/v1/services/recall/reconcile",
                br#"{"desiredState":"stopped","configuration":{"captureAudio":true,"excludedWindows":[]}}"#.as_slice(),
            ),
            (
                "/v1/services/recall/reconcile",
                br#"{"desiredState":"running","configuration":{"captureAudio":true,"excludedWindows":["Discord","discord"]}}"#.as_slice(),
            ),
            (
                "/v1/services/recall/status",
                br#"{"extra":true}"#.as_slice(),
            ),
        ] {
            let invalid = RecordingServiceControl::successful("recall");
            let (result, response) = issue_user_json_control_request(
                "POST",
                path,
                DASHBOARD_TOKEN,
                body,
                &invalid,
            );
            result.unwrap();
            assert!(
                response.starts_with("HTTP/1.1 400 Bad Request\r\n")
                    || response.starts_with("HTTP/1.1 404 Not Found\r\n"),
                "{path}: {response}"
            );
            assert!(invalid.recall_calls.lock().unwrap().is_empty());
            assert!(invalid.recall_status_calls.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn service_acquire_errors_are_closed_and_include_only_bounded_resource_evidence() {
        for (error, status, code) in [
            (
                RuntimeServiceControlError::NotFound,
                "404 Not Found",
                "SERVICE_NOT_FOUND",
            ),
            (
                RuntimeServiceControlError::Conflict,
                "409 Conflict",
                "SERVICE_LEASE_CONFLICT",
            ),
            (
                RuntimeServiceControlError::Unavailable,
                "503 Service Unavailable",
                "RUNTIME_UNAVAILABLE",
            ),
            (
                RuntimeServiceControlError::Internal,
                "500 Internal Server Error",
                "RUNTIME_INTERNAL_ERROR",
            ),
        ] {
            let control = RecordingServiceControl::with_acquire_result(Err(error));
            let (result, response) = issue_json_control_request(
                "POST",
                "/v1/services/hermes/lease",
                DASHBOARD_TOKEN,
                br#"{"reason":"terminal-turn"}"#,
                &control,
            );
            result.unwrap();
            assert!(
                response.starts_with(&format!("HTTP/1.1 {status}\r\n")),
                "{response}"
            );
            assert!(response.contains(&format!("\"code\":\"{code}\"")));
            assert!(response.contains("\"retryable\":false"));
            assert!(response.contains("\"resource\":null"));
        }

        let control = RecordingServiceControl::with_acquire_result(Err(
            RuntimeServiceControlError::ResourceExhausted {
                required_headroom_mb: 8_456,
                available_headroom_mb: 6_144,
            },
        ));
        let (result, response) = issue_json_control_request(
            "POST",
            "/v1/services/hermes/lease",
            DASHBOARD_TOKEN,
            br#"{"reason":"terminal-turn"}"#,
            &control,
        );
        result.unwrap();
        assert!(response.starts_with("HTTP/1.1 503 Service Unavailable\r\n"));
        assert!(response.contains("\"code\":\"BREADBOARD_RESOURCE_EXHAUSTED\""));
        assert!(response.contains("\"resource\":\"windows_commit\""));
        assert!(response.contains("\"requiredHeadroomMb\":8456"));
        assert!(response.contains("\"availableHeadroomMb\":6144"));
        assert!(!response.contains("executable"));
        assert!(!response.contains("environment"));
        assert!(!response.contains("token"));
    }

    #[test]
    fn undeliverable_or_misbound_acquire_responses_reclaim_the_lease() {
        let undeliverable = RecordingServiceControl::successful("hermes");
        let response = undeliverable.acquire_result.clone().unwrap();
        let result = deliver_service_lease(response, "hermes", &undeliverable, |_| {
            Err(ControlError::Connection(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "test peer closed",
            )))
        });
        assert!(matches!(result, Err(ControlError::Connection(_))));
        assert_eq!(
            undeliverable.release_calls.lock().unwrap().as_slice(),
            &["01234567-89ab-cdef-0123-456789abcdef".to_owned()]
        );

        let misbound = RecordingServiceControl::successful("dashboard");
        let response = misbound.acquire_result.clone().unwrap();
        let result = deliver_service_lease(response, "hermes", &misbound, |_| Ok(()));
        assert!(matches!(result, Err(ControlError::InvalidStatus(_))));
        assert_eq!(
            misbound.release_calls.lock().unwrap().as_slice(),
            &["01234567-89ab-cdef-0123-456789abcdef".to_owned()]
        );
    }

    #[test]
    fn only_typed_mutations_accept_a_bounded_request_body() {
        assert_eq!(
            request_body_limit("POST", "/v1/jobs"),
            MAX_REQUEST_BODY_BYTES
        );
        assert_eq!(
            request_body_limit("POST", "/v1/jobs/lookup"),
            MAX_JOB_LOOKUP_BODY_BYTES
        );
        assert!(accepts_json_request_body("POST", "/v1/jobs/lookup"));
        assert_eq!(
            request_body_limit("POST", "/v1/jobs/cancel-by-idempotency"),
            MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES
        );
        assert!(accepts_json_request_body(
            "POST",
            "/v1/jobs/cancel-by-idempotency"
        ));
        for path in [
            "/v1/gateways/telegram/reconcile",
            "/v1/gateways/whatsapp/reconcile",
            "/v1/schedules/email-poll/reconcile",
            "/v1/schedules/email-poll/status",
        ] {
            assert_eq!(
                request_body_limit("POST", path),
                MAX_SERVICE_LEASE_REQUEST_BODY_BYTES
            );
            assert!(accepts_json_request_body("POST", path));
        }
        assert_eq!(
            request_body_limit("POST", "/v1/services/recall/reconcile"),
            MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES
        );
        assert_eq!(
            request_body_limit("POST", "/v1/services/recall/status"),
            MAX_SERVICE_LEASE_REQUEST_BODY_BYTES
        );
        assert!(accepts_json_request_body(
            "POST",
            "/v1/services/recall/reconcile"
        ));
        assert!(accepts_json_request_body(
            "POST",
            "/v1/services/recall/status"
        ));
        assert_eq!(
            request_body_limit("POST", "/v1/internal/jobs/learn-recovery"),
            MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES
        );
        assert!(accepts_json_request_body(
            "POST",
            "/v1/internal/jobs/learn-recovery"
        ));
        assert_eq!(
            request_body_limit("POST", "/v1/job-inputs"),
            MAX_JOB_INPUT_RESERVATION_BODY_BYTES
        );
        for path in [
            "/v1/services/hermes/lease",
            "/v1/capabilities/runtime-agent:codex/lease",
            "/v1/leases/lease_1/release",
        ] {
            assert_eq!(
                request_body_limit("POST", path),
                MAX_SERVICE_LEASE_REQUEST_BODY_BYTES
            );
            assert!(accepts_json_request_body("POST", path));
        }
        assert_eq!(
            request_body_limit("POST", "/v1/lifecycle/services/dashboard/retry"),
            MAX_SERVICE_LEASE_REQUEST_BODY_BYTES
        );
        assert!(accepts_json_request_body(
            "POST",
            "/v1/lifecycle/services/dashboard/retry"
        ));
        assert_eq!(request_body_limit("GET", "/v1/jobs/job_1"), 0);
        assert_eq!(request_body_limit("POST", "/v1/jobs/job_1/cancel"), 0);
        assert_eq!(request_body_limit("PUT", "/v1/job-inputs/upload_1"), 0);
        assert_eq!(request_body_limit("POST", "/v1/shutdown"), 0);
        let oversized_reservation = vec![b'x'; MAX_JOB_INPUT_RESERVATION_BODY_BYTES + 1];
        assert!(matches!(
            read_test_request(
                "POST",
                "/v1/job-inputs",
                Some("application/json"),
                &oversized_reservation,
            ),
            Err(RequestError::Oversized)
        ));
        let oversized_lookup = vec![b'x'; MAX_JOB_LOOKUP_BODY_BYTES + 1];
        assert!(matches!(
            read_test_request(
                "POST",
                "/v1/jobs/lookup",
                Some("application/json"),
                &oversized_lookup,
            ),
            Err(RequestError::Oversized)
        ));
        for path in [
            "/v1/services/hermes/lease/extra",
            "/v1/services/hermes/lease?reason=test",
            "/v1/services/hermes%2fother/lease",
            "/v1/capabilities/runtime-agent::codex/lease",
            "/v1/leases/../release",
        ] {
            assert_eq!(request_body_limit("POST", path), 0, "{path}");
            assert!(!accepts_json_request_body("POST", path), "{path}");
        }
    }

    #[test]
    fn exact_lease_mutations_accept_nonempty_json_and_reject_ambiguous_bodies() {
        for path in [
            "/v1/services/hermes/lease",
            "/v1/capabilities/runtime-agent:codex/lease",
            "/v1/leases/lease_1/release",
        ] {
            let request = read_test_request("POST", path, Some("application/json"), b"{}")
                .unwrap_or_else(|error| panic!("{path} failed: {error:?}"));
            assert_eq!(&*request.body, b"{}");
            assert_eq!(request.path, path);

            assert!(matches!(
                read_test_request("POST", path, Some("application/json"), b""),
                Err(RequestError::Malformed)
            ));
            assert!(matches!(
                read_test_request("POST", path, Some("text/plain"), b"{}"),
                Err(RequestError::Malformed)
            ));
        }
        assert!(matches!(
            read_test_request(
                "POST",
                "/v1/services/hermes/lease?reason=test",
                Some("application/json"),
                b"{}",
            ),
            Err(RequestError::Oversized)
        ));
    }
}
