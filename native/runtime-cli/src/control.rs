use crate::shutdown::ShutdownCoordinator;
use breadboard_runtime_core::{AuthenticatedJobContext, ControlPlaneAuthority};
use breadboard_runtime_protocol::{
    parse_job_submission_payload, validate_identifier, validate_scope_id, JobSubmissionPayload, RuntimeCommandAck,
    RuntimeControlErrorResponse, RuntimeJobEventsResponse, RuntimeJobResponse, RuntimeServiceStatus,
    RuntimeStatusMessage, RUNTIME_CONTROL_PROTOCOL_VERSION, MAX_CONTROL_TOKEN_BYTES,
    MAX_JOB_EVENT_REPLAY_RECORDS, MAX_JSON_SAFE_INTEGER, MAX_PROTOCOL_LINE_BYTES,
    MAX_REQUEST_BODY_BYTES, MAX_SCOPE_ID_BYTES,
};
use serde::Serialize;
use std::io::{self, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream};
use std::ops::Deref;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use thiserror::Error;

const MAX_REQUEST_LINE_BYTES: usize = 4 * 1024;
const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_HEADER_COUNT: usize = 64;
const MAX_ACTIVE_CONNECTIONS: usize = 1;
const REQUEST_DEADLINE: Duration = Duration::from_secs(2);
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(20);

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

/// The control server performs transport authentication and creates the
/// opaque owner context. A concrete runtime engine implements only these
/// already-authorized operations; it never receives raw HTTP headers or the
/// control bearer.
pub(crate) trait RuntimeJobControl: Send + Sync {
    fn submit_job(
        &self,
        context: &AuthenticatedJobContext,
        payload: &JobSubmissionPayload,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError>;

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
}

/// Sanitized job-control failures. Implementations cannot attach arbitrary
/// error strings, paths, commands, environments, or provider secrets.
pub(crate) enum RuntimeJobControlError {
    InvalidRequest,
    Forbidden,
    NotFound,
    Conflict,
    ResourceExhausted {
        required_headroom_mb: u64,
        available_headroom_mb: u64,
    },
    Unavailable,
    Internal,
}

enum JobRoute {
    Submit,
    Inspect { job_id: String },
    Events {
        job_id: String,
        after: u64,
        limit: usize,
    },
    Cancel { job_id: String },
}

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

pub(crate) struct BoundControlListener {
    listener: TcpListener,
    authority: String,
    base_url: String,
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

    /// Connections are deliberately served serially. The active-connection
    /// bound is therefore one, and every connection has an absolute deadline.
    pub(crate) fn serve_with_jobs<F>(
        self,
        authority: &ControlPlaneAuthority,
        runtime_pid: u32,
        shutdown: &Arc<ShutdownCoordinator>,
        service_statuses: F,
        job_control: &dyn RuntimeJobControl,
    ) -> Result<(), ControlError>
    where
        F: Fn() -> Result<Vec<RuntimeServiceStatus>, String>,
    {
        self.serve_loop(
            authority,
            runtime_pid,
            shutdown,
            &service_statuses,
            job_control,
        )
    }

    fn serve_loop<F>(
        self,
        authority: &ControlPlaneAuthority,
        runtime_pid: u32,
        shutdown: &Arc<ShutdownCoordinator>,
        service_statuses: &F,
        job_control: &dyn RuntimeJobControl,
    ) -> Result<(), ControlError>
    where
        F: Fn() -> Result<Vec<RuntimeServiceStatus>, String>,
    {
        debug_assert_eq!(MAX_ACTIVE_CONNECTIONS, 1);
        while !shutdown.is_requested() {
            match self.listener.accept() {
                Ok((mut stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    let result = serve_connection(
                        &mut stream,
                        &self.authority,
                        authority,
                        runtime_pid,
                        shutdown,
                        service_statuses,
                        job_control,
                    );
                    // A peer reset or response timeout belongs to that bounded
                    // connection. It must not take down the runtime authority.
                    if let Err(error) = result {
                        if !matches!(&error, ControlError::Connection(_)) {
                            return Err(error);
                        }
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(ACCEPT_POLL_INTERVAL);
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(ControlError::Accept(error)),
            }
        }
        Ok(())
    }
}

fn serve_connection<F>(
    stream: &mut TcpStream,
    expected_authority: &str,
    authority: &ControlPlaneAuthority,
    runtime_pid: u32,
    shutdown: &Arc<ShutdownCoordinator>,
    service_statuses: &F,
    job_control: &dyn RuntimeJobControl,
) -> Result<(), ControlError>
where
    F: Fn() -> Result<Vec<RuntimeServiceStatus>, String>,
{
    let deadline = Instant::now() + REQUEST_DEADLINE;
    let request = match read_request(stream, expected_authority, deadline) {
        Ok(request) => request,
        Err(RequestError::Io(error)) => return Err(ControlError::Connection(error)),
        Err(RequestError::Deadline | RequestError::Closed | RequestError::Oversized | RequestError::Malformed) => {
            let _ = write_response(stream, deadline, 400, "Bad Request", b"{\"error\":\"bad-request\"}");
            return Ok(());
        }
    };

    if authority
        .verify_bearer(request.authorization.as_deref())
        .is_err()
    {
        write_response(
            stream,
            deadline,
            401,
            "Unauthorized",
            b"{\"error\":\"unauthorized\"}",
        )?;
        return Ok(());
    }

    if request.path == "/v1/jobs" || request.path.starts_with("/v1/jobs/") {
        return serve_job_request(
            stream,
            deadline,
            authority,
            shutdown,
            job_control,
            &request,
        );
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
            write_response(stream, deadline, 200, "OK", &body)?;
        }
        ("POST", "/v1/shutdown") => {
            shutdown.request_shutdown();
            let acknowledgement = RuntimeCommandAck { ok: true };
            acknowledgement
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            let body = bounded_json(&acknowledgement)?;
            write_response(stream, deadline, 200, "OK", &body)?;
        }
        (_, "/v1/status" | "/v1/shutdown") => {
            write_response(
                stream,
                deadline,
                405,
                "Method Not Allowed",
                b"{\"error\":\"method-not-allowed\"}",
            )?;
        }
        _ => {
            write_response(
                stream,
                deadline,
                404,
                "Not Found",
                b"{\"error\":\"not-found\"}",
            )?;
        }
    }
    Ok(())
}

fn serve_job_request(
    stream: &mut TcpStream,
    deadline: Instant,
    authority: &ControlPlaneAuthority,
    shutdown: &Arc<ShutdownCoordinator>,
    job_control: &dyn RuntimeJobControl,
    request: &ControlRequest,
) -> Result<(), ControlError> {
    let route = match parse_job_route(&request.method, &request.path) {
        Ok(route) => route,
        Err(JobRouteError::MethodNotAllowed) => {
            return write_response(
                stream,
                deadline,
                405,
                "Method Not Allowed",
                b"{\"error\":\"method-not-allowed\"}",
            )
        }
        Err(JobRouteError::Malformed) => {
            return write_response(
                stream,
                deadline,
                400,
                "Bad Request",
                b"{\"error\":\"bad-request\"}",
            )
        }
        Err(JobRouteError::NotFound) => {
            return write_response(
                stream,
                deadline,
                404,
                "Not Found",
                b"{\"error\":\"not-found\"}",
            )
        }
    };

    let Some(user_id) = request.user_id else {
        return write_job_control_error(
            stream,
            deadline,
            RuntimeJobControlError::InvalidRequest,
        );
    };
    let context = match authority.authenticate_user(
        request.authorization.as_deref(),
        user_id,
        request.garden_id.as_deref(),
        request.conversation_id.as_deref(),
    ) {
        Ok(context) => context,
        Err(_) => {
            return write_job_control_error(
                stream,
                deadline,
                RuntimeJobControlError::Forbidden,
            )
        }
    };

    match route {
        JobRoute::Submit => {
            if !shutdown.is_accepting_work() {
                return write_job_control_error(
                    stream,
                    deadline,
                    RuntimeJobControlError::Unavailable,
                );
            }
            let payload = match parse_job_submission_payload(&request.body) {
                Ok(payload) => payload,
                Err(_) => {
                    return write_job_control_error(
                        stream,
                        deadline,
                        RuntimeJobControlError::InvalidRequest,
                    )
                }
            };
            if payload.garden_id.as_deref() != request.garden_id.as_deref()
                || payload.conversation_id.as_deref() != request.conversation_id.as_deref()
            {
                return write_job_control_error(
                    stream,
                    deadline,
                    RuntimeJobControlError::Forbidden,
                );
            }
            let response = match job_control.submit_job(&context, &payload) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, deadline, error),
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
            write_bounded_job_success(stream, deadline, 202, "Accepted", &response)
        }
        JobRoute::Inspect { job_id } => {
            let response = match job_control.inspect_job(&context, &job_id) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, deadline, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_job_response_binding(&response, request, Some(&job_id), None)?;
            write_bounded_job_success(stream, deadline, 200, "OK", &response)
        }
        JobRoute::Events {
            job_id,
            after,
            limit,
        } => {
            let response = match job_control.replay_job_events(&context, &job_id, after, limit) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, deadline, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_event_response_binding(&response, &job_id, after, limit)?;
            write_bounded_job_success(stream, deadline, 200, "OK", &response)
        }
        JobRoute::Cancel { job_id } => {
            let response = match job_control.cancel_job(&context, &job_id) {
                Ok(response) => response,
                Err(error) => return write_job_control_error(stream, deadline, error),
            };
            response
                .validate()
                .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
            validate_job_response_binding(&response, request, Some(&job_id), None)?;
            write_bounded_job_success(stream, deadline, 200, "OK", &response)
        }
    }
}

fn validate_job_response_binding(
    response: &RuntimeJobResponse,
    request: &ControlRequest,
    expected_job_id: Option<&str>,
    expected_job_type: Option<&str>,
) -> Result<(), ControlError> {
    let RuntimeJobResponse::RuntimeJob { job, .. } = response;
    let matches_request = expected_job_id.map_or(true, |value| job.job_id == value)
        && expected_job_type.map_or(true, |value| job.job_type == value)
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

fn parse_job_route(method: &str, path: &str) -> Result<JobRoute, JobRouteError> {
    if path == "/v1/jobs" {
        return if method == "POST" {
            Ok(JobRoute::Submit)
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
                let value = value.parse::<usize>().map_err(|_| JobRouteError::Malformed)?;
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
    deadline: Instant,
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
        RuntimeJobControlError::ResourceExhausted {
            required_headroom_mb,
            available_headroom_mb,
        } => (
            503,
            "Service Unavailable",
            "BREADBOARD_RESOURCE_EXHAUSTED",
            "Windows commit reserve cannot be preserved.",
            Some("windows_commit".to_string()),
            Some(required_headroom_mb),
            Some(available_headroom_mb),
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
    write_bounded_protocol_response(stream, deadline, status, reason, &response)
}

fn write_bounded_job_success(
    stream: &mut TcpStream,
    deadline: Instant,
    status: u16,
    reason: &str,
    value: &impl Serialize,
) -> Result<(), ControlError> {
    match bounded_json(value) {
        Ok(body) => write_response(stream, deadline, status, reason, &body),
        Err(ControlError::OversizedResponse) => {
            write_job_control_error(stream, deadline, RuntimeJobControlError::Internal)
        }
        Err(error) => Err(error),
    }
}

fn write_bounded_protocol_response(
    stream: &mut TcpStream,
    deadline: Instant,
    status: u16,
    reason: &str,
    value: &impl Serialize,
) -> Result<(), ControlError> {
    let body = bounded_json(value)?;
    write_response(stream, deadline, status, reason, &body)
}

fn read_request(
    stream: &mut TcpStream,
    expected_authority: &str,
    deadline: Instant,
) -> Result<ControlRequest, RequestError> {
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
        if received.len().saturating_add(count) > MAX_HEADER_BYTES + MAX_REQUEST_BODY_BYTES {
            return Err(RequestError::Oversized);
        }
        received.extend_from_slice(&chunk[..count]);
    };

    if header_end > MAX_HEADER_BYTES {
        return Err(RequestError::Oversized);
    }
    let trailing_bytes = received.len() - header_end;
    let head = std::str::from_utf8(&received[..header_end]).map_err(|_| RequestError::Malformed)?;
    let parsed = parse_request_head(head, expected_authority)?;
    let body_limit = request_body_limit(&parsed.method, &parsed.path);
    if parsed.content_length > body_limit {
        return Err(RequestError::Oversized);
    }
    if trailing_bytes > parsed.content_length {
        return Err(RequestError::Malformed);
    }
    let expected_total = header_end
        .checked_add(parsed.content_length)
        .ok_or(RequestError::Oversized)?;
    while received.len() < expected_total {
        set_remaining_read_timeout(stream, deadline)?;
        let remaining = expected_total - received.len();
        let mut chunk = [0_u8; 4096];
        let take = remaining.min(chunk.len());
        let count = stream
            .read(&mut chunk[..take])
            .map_err(map_read_error)?;
        if count == 0 {
            return Err(RequestError::Closed);
        }
        received.extend_from_slice(&chunk[..count]);
    }
    if parsed.path == "/v1/jobs"
        && parsed.method == "POST"
        && (parsed.content_length == 0
            || !parsed
                .content_type
                .as_deref()
                .is_some_and(|value| value.eq_ignore_ascii_case("application/json")))
    {
        return Err(RequestError::Malformed);
    }
    let body = SensitiveRequestBuffer(received[header_end..expected_total].to_vec());
    Ok(ControlRequest {
        method: parsed.method,
        path: parsed.path,
        authorization: parsed.authorization,
        user_id: parsed.user_id,
        garden_id: parsed.garden_id,
        conversation_id: parsed.conversation_id,
        body,
    })
}

fn request_body_limit(method: &str, path: &str) -> usize {
    if method == "POST" && path == "/v1/jobs" {
        MAX_REQUEST_BODY_BYTES
    } else {
        0
    }
}

struct ParsedRequestHead {
    method: String,
    path: String,
    authorization: Option<SensitiveHeaderValue>,
    user_id: Option<i64>,
    garden_id: Option<String>,
    conversation_id: Option<String>,
    content_type: Option<String>,
    content_length: usize,
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
            let length = value.parse::<usize>().map_err(|_| RequestError::Oversized)?;
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
            if value.len() > MAX_SCOPE_ID_BYTES
                || validate_scope_id("gardenId", value).is_err()
            {
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
            return Err(RequestError::Malformed);
        }
    }

    if host.as_deref() != Some(expected_authority) {
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
        content_length: content_length.unwrap_or(0),
    })
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
                    b'!' | b'#' | b'$' | b'%' | b'&' | b'\'' | b'*' | b'+' | b'-' | b'.'
                        | b'^' | b'_' | b'`' | b'|' | b'~'
                )
        })
}

fn invalid_header_value_character(character: char) -> bool {
    !character.is_ascii()
        || character == '\u{7f}'
        || (character.is_control() && character != '\t')
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn set_remaining_read_timeout(
    stream: &TcpStream,
    deadline: Instant,
) -> Result<(), RequestError> {
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
    let bytes = serde_json::to_vec(value)
        .map_err(|error| ControlError::InvalidStatus(error.to_string()))?;
    if bytes.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(ControlError::OversizedResponse);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_authority_rejects_prefixes_suffixes_and_differences() {
        let authority = ControlPlaneAuthority::new("0123456789abcdef0123456789abcdef").unwrap();
        assert!(authority
            .verify_bearer(Some(
                "Bearer 0123456789abcdef0123456789abcdef"
            ))
            .is_ok());
        assert!(authority.verify_bearer(Some("Bearer 0123456789abcdef")).is_err());
        assert!(authority
            .verify_bearer(Some(
                "Bearer 0123456789abcdef0123456789abcdef-extra"
            ))
            .is_err());
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
        assert_eq!(parsed.content_length, 0);

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
    fn request_head_rejects_transfer_encoding_and_nonzero_control_bodies() {
        assert!(parse_request_head(
            "POST /v1/shutdown HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nTransfer-Encoding: chunked\r\n\r\n",
            "127.0.0.1:43121",
        )
        .is_err());
        let parsed = parse_request_head(
            "POST /v1/shutdown HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nAuthorization: Bearer token\r\nContent-Length: 1\r\n\r\n",
            "127.0.0.1:43121",
        )
        .unwrap();
        assert_eq!(parsed.content_length, 1);
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
        assert_eq!(
            parsed.conversation_id.as_deref(),
            Some("conversation-1")
        );
        assert_eq!(parsed.content_type.as_deref(), Some("application/json"));

        assert!(parse_request_head(
            "POST /v1/jobs HTTP/1.1\r\nHost: 127.0.0.1:43121\r\nX-Breadboard-User-Id: 42\r\nx-breadboard-user-id: 43\r\n\r\n",
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
    fn job_routes_do_not_accept_encoded_ids_or_ambiguous_queries() {
        assert!(matches!(
            parse_job_route("POST", "/v1/jobs"),
            Ok(JobRoute::Submit)
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
        assert!(parse_job_route("GET", "/v1/jobs/job%5f1").is_err());
        assert!(parse_job_route(
            "GET",
            "/v1/jobs/job_1/events?after=0&after=1&limit=2"
        )
        .is_err());
        assert!(parse_job_route("GET", "/v1/jobs/job_1/events?limit=2").is_err());
        assert!(parse_job_route("GET", "/v1/jobs/job_1/events?after=0&limit=257").is_err());
    }

    #[test]
    fn only_submission_accepts_a_bounded_request_body() {
        assert_eq!(request_body_limit("POST", "/v1/jobs"), MAX_REQUEST_BODY_BYTES);
        assert_eq!(request_body_limit("GET", "/v1/jobs/job_1"), 0);
        assert_eq!(request_body_limit("POST", "/v1/jobs/job_1/cancel"), 0);
        assert_eq!(request_body_limit("POST", "/v1/shutdown"), 0);
    }
}
