use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;

pub const WIRE_PROTOCOL_VERSION: u32 = 1;
pub const RUNTIME_CONTROL_PROTOCOL_VERSION: u32 = 1;
pub const WORKER_MANIFEST_VERSION: u32 = 2;
pub const SERVICE_MANIFEST_VERSION: u32 = 4;
/// Compatibility alias for the first wire protocol. New code should use the
/// explicit wire/manifest constants so those versions can evolve separately.
pub const PROTOCOL_VERSION: u32 = WIRE_PROTOCOL_VERSION;
pub const MAX_PROTOCOL_LINE_BYTES: usize = 64 * 1024;
pub const MAX_REQUEST_BODY_BYTES: usize = 256 * 1024;
pub const MAX_IDEMPOTENCY_KEY_BYTES: usize = 256;
pub const MAX_SCOPE_ID_BYTES: usize = 256;
pub const MAX_RUNTIME_ROOT_BYTES: usize = 4096;
pub const MAX_LOOPBACK_URL_BYTES: usize = 2048;
pub const MIN_CONTROL_TOKEN_BYTES: usize = 32;
pub const MAX_CONTROL_TOKEN_BYTES: usize = 1024;
pub const MAX_LOG_LINE_BYTES: usize = 16 * 1024;
pub const MAX_BUFFERED_WORKER_OUTPUT_BYTES: usize = 1024 * 1024;
/// A worker receives one fixed, small argv entry naming this file beneath its
/// runtime-minted attempt directory. Request payloads, tokens, executable
/// arguments, and environment material are deliberately not part of the
/// start-manifest schema.
pub const WORKER_START_MANIFEST_FILE: &str = "start.json";
pub const MAX_WORKER_START_MANIFEST_BYTES: usize = 32 * 1024;
pub const MAX_IDENTIFIER_BYTES: usize = 128;
pub const MAX_STAGE_BYTES: usize = 256;
pub const MAX_FAILURE_MESSAGE_BYTES: usize = 8 * 1024;
pub const SANITIZED_RUNTIME_FAILURE_MESSAGE: &str = "Runtime job execution failed.";
pub const MAX_JOB_EVENT_REPLAY_RECORDS: usize = 256;
pub const MAX_MANIFEST_ENTRIES: usize = 256;
pub const MAX_JOB_TYPES_PER_WORKER: usize = 128;
pub const MAX_CAPABILITIES_PER_DEFINITION: usize = 256;
pub const MAX_DEPENDENCIES_PER_SERVICE: usize = 64;
pub const MAX_SERVICE_DEPENDENCIES_PER_WORKER: usize = 8;
pub const MAX_SERVICE_LAUNCH_PROFILES: usize = 3;
pub const MAX_SERVICE_LAUNCH_ARGUMENTS: usize = 64;
pub const MAX_SERVICE_INSTALL_PROBE_FILES: usize = 32;
pub const MAX_SERVICE_ARGUMENT_BYTES: usize = 4096;
pub const MAX_SERVICE_READINESS_MATCH_BYTES: usize = 1024;
pub const MAX_SERVICE_LEASE_REQUEST_BODY_BYTES: usize = 8 * 1024;
pub const MAX_SERVICE_LEASE_REASON_BYTES: usize = 256;
pub const MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES: usize = 96 * 1024;
pub const MAX_RECALL_EXCLUDED_WINDOWS: usize = 100;
pub const MAX_RECALL_EXCLUDED_WINDOW_UTF16_UNITS: usize = 200;
pub const MAX_RECALL_CONFIGURATION_TEXT_BYTES: usize = 80 * 1024;
pub const MAX_RECALL_LOG_LINES: usize = 40;
pub const MAX_RECALL_LOG_TAIL_BYTES: usize = 16 * 1024;
pub const MAX_JOB_INPUT_UPLOADS: usize = 16;
pub const MAX_JOB_INPUT_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_JOB_INPUT_DISPLAY_NAME_BYTES: usize = 512;
pub const MAX_JOB_INPUT_MEDIA_TYPE_BYTES: usize = 256;
pub const MAX_JOB_INPUT_RESERVATION_BODY_BYTES: usize = 16 * 1024;
pub const MAX_JOB_LOOKUP_BODY_BYTES: usize = 1024;
pub const MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES: usize = 1024;
pub const MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES: usize = 1024;
pub const MAX_CONCURRENCY: u32 = 256;
/// Service restart counters and manifest restart budgets are persisted in the
/// runtime service ledger, whose public/control contract is intentionally
/// narrower than worker or lease concurrency.
pub const MAX_SERVICE_RESTARTS: u32 = 64;
pub const MAX_COMMIT_LIMIT_MB: u64 = 1024 * 1024;
pub const MAX_TIMEOUT_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// A service may consume its complete manifest readiness budget before the
/// controller observes and settles the pending durable lease.
pub const SERVICE_LEASE_SETTLEMENT_GRACE_MS: u64 = 5_000;
/// Keeps the engine reply deadline strictly outside the pending-lease deadline
/// so a bounded timeout is delivered instead of racing the receiver itself.
pub const SERVICE_LEASE_RESPONSE_GRACE_MS: u64 = 5_000;
pub const MAX_SERVICE_LEASE_ACQUIRE_TIMEOUT_MS: u64 =
    MAX_TIMEOUT_MS + SERVICE_LEASE_SETTLEMENT_GRACE_MS + SERVICE_LEASE_RESPONSE_GRACE_MS;
pub const MAX_SQLITE_UNSIGNED: u64 = 9_223_372_036_854_775_807;
/// Largest integer that can cross the Rust/JavaScript control boundary without
/// losing precision in a JavaScript `number`.
pub const MAX_JSON_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("unsupported protocol version {0}")]
    UnsupportedProtocolVersion(u32),
    #[error("{field} is missing or invalid")]
    InvalidIdentifier { field: &'static str },
    #[error("{field} exceeds its bounded size")]
    OversizedField { field: &'static str },
    #[error("duplicate {kind} id {id}")]
    DuplicateId { kind: &'static str, id: String },
    #[error("{field} must be a relative path without traversal")]
    InvalidRelativePath { field: &'static str },
    #[error("{field} must not be empty")]
    EmptyField { field: &'static str },
    #[error("{field} is outside its allowed range")]
    InvalidRange { field: &'static str },
    #[error("finite worker {0} must exit after one job")]
    ReusableFiniteWorker(String),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceClass {
    Core,
    LargeGeneration,
    DocumentProcessing,
    DocumentModel,
    MediaProcessing,
    BrowserAutomation,
    LocalModel,
    DockerStack,
}

impl ResourceClass {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Core => "core",
            Self::LargeGeneration => "large-generation",
            Self::DocumentProcessing => "document-processing",
            Self::DocumentModel => "document-model",
            Self::MediaProcessing => "media-processing",
            Self::BrowserAutomation => "browser-automation",
            Self::LocalModel => "local-model",
            Self::DockerStack => "docker-stack",
        }
    }

    pub fn is_heavyweight(self) -> bool {
        self != Self::Core
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Admitted,
    Starting,
    Running,
    Checkpointing,
    Cancelling,
    Cancelled,
    Succeeded,
    Failed,
    ResourceExhausted,
    Interrupted,
    Uncertain,
}

impl JobState {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Cancelled
                | Self::Succeeded
                | Self::Failed
                | Self::ResourceExhausted
                | Self::Interrupted
                | Self::Uncertain
        )
    }
}

/// The complete renderer-visible job-stage vocabulary. Worker/provider stage
/// text is private input and must be projected onto one of these values before
/// it can cross the authenticated control boundary.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimePublicStage {
    Preparing,
    Working,
    Generating,
    WaitingExternal,
    Processing,
    Persisting,
    Finalizing,
    Cancelling,
}

impl RuntimePublicStage {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Preparing => "preparing",
            Self::Working => "working",
            Self::Generating => "generating",
            Self::WaitingExternal => "waiting-external",
            Self::Processing => "processing",
            Self::Persisting => "persisting",
            Self::Finalizing => "finalizing",
            Self::Cancelling => "cancelling",
        }
    }
}

/// Closed, runtime-owned artifact categories. Untrusted worker labels are
/// exact-mapped to this vocabulary and unknown labels become `artifact`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimePublicArtifactKind {
    Checkpoint,
    Artifact,
    Document,
    Image,
    Audio,
    Video,
    Model,
    Report,
    Archive,
    Page,
}

impl RuntimePublicArtifactKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Checkpoint => "checkpoint",
            Self::Artifact => "artifact",
            Self::Document => "document",
            Self::Image => "image",
            Self::Audio => "audio",
            Self::Video => "video",
            Self::Model => "model",
            Self::Report => "report",
            Self::Archive => "archive",
            Self::Page => "page",
        }
    }
}

/// Closed, runtime-owned public failure classes. Internal and worker-provided
/// failure identifiers never cross the control boundary verbatim.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum RuntimePublicFailureCode {
    #[serde(rename = "RUNTIME_JOB_FAILED")]
    RuntimeJobFailed,
    #[serde(rename = "WORKER_FAILED")]
    WorkerFailed,
    #[serde(rename = "BREADBOARD_RESOURCE_EXHAUSTED")]
    ResourceExhausted,
    #[serde(rename = "JOB_INTERRUPTED")]
    Interrupted,
    #[serde(rename = "JOB_UNCERTAIN")]
    Uncertain,
    /// A required Runtime service dependency could not be started or leased
    /// before any worker existed. Which service is never disclosed here.
    #[serde(rename = "SERVICE_DEPENDENCY_UNAVAILABLE")]
    ServiceDependencyUnavailable,
}

impl RuntimePublicFailureCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RuntimeJobFailed => "RUNTIME_JOB_FAILED",
            Self::WorkerFailed => "WORKER_FAILED",
            Self::ResourceExhausted => "BREADBOARD_RESOURCE_EXHAUSTED",
            Self::Interrupted => "JOB_INTERRUPTED",
            Self::Uncertain => "JOB_UNCERTAIN",
            Self::ServiceDependencyUnavailable => "SERVICE_DEPENDENCY_UNAVAILABLE",
        }
    }
}

/// The complete untrusted body accepted by the Runtime V2 job-submission
/// endpoint. Authentication and ownership are deliberately absent: the
/// server must derive those from its authenticated request context after this
/// bounded body has been parsed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobSubmissionPayload {
    pub job_type: String,
    pub garden_id: Option<String>,
    pub conversation_id: Option<String>,
    pub idempotency_key: String,
    #[serde(default)]
    pub input_uploads: Vec<RuntimeJobInputUploadReference>,
    pub request_payload: serde_json::Value,
}

/// Exact body for an ownership-scoped idempotency lookup. User and scope
/// authority remain exclusively in authenticated transport headers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobLookupRequest {
    pub idempotency_key: String,
}

impl RuntimeJobLookupRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_bounded_text(
            "idempotencyKey",
            &self.idempotency_key,
            MAX_IDEMPOTENCY_KEY_BYTES,
        )?;
        if self.idempotency_key.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "idempotencyKey",
            });
        }
        Ok(())
    }
}

/// Exact body for recording cancellation before a submission response exists.
/// User and scope authority remain exclusively in authenticated transport
/// headers and therefore cannot be supplied or widened by this body.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobIdempotencyCancellationRequest {
    pub idempotency_key: String,
}

impl RuntimeJobIdempotencyCancellationRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_bounded_text(
            "idempotencyKey",
            &self.idempotency_key,
            MAX_IDEMPOTENCY_KEY_BYTES,
        )?;
        if self.idempotency_key.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "idempotencyKey",
            });
        }
        Ok(())
    }
}

/// The only caller-controlled value on the fixed internal Learn recovery
/// route. Job type, authority, scope, request payload, and input count are
/// runtime constants and have no wire representation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeLearnRecoveryRequest {
    pub idempotency_key: String,
}

impl RuntimeLearnRecoveryRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        const PREFIX: &str = "learn-recovery-v2:";
        validate_bounded_text(
            "idempotencyKey",
            &self.idempotency_key,
            MAX_IDEMPOTENCY_KEY_BYTES,
        )?;
        let Some(generation) = self.idempotency_key.strip_prefix(PREFIX) else {
            return Err(ValidationError::InvalidIdentifier {
                field: "learn recovery idempotencyKey",
            });
        };
        if generation.is_empty()
            || !generation.bytes().all(|byte| byte.is_ascii_digit())
            || generation.len() > 16
            || generation
                .parse::<u64>()
                .map_or(true, |value| value > MAX_JSON_SAFE_INTEGER)
        {
            return Err(ValidationError::InvalidIdentifier {
                field: "learn recovery idempotencyKey",
            });
        }
        Ok(())
    }
}

/// An opaque reference to a previously sealed, ownership-scoped input upload.
/// No path, size, digest, display metadata, or lifecycle claim can be supplied
/// by the submission body; the runtime resolves all of those durably.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobInputUploadReference {
    pub upload_id: String,
}

impl RuntimeJobInputUploadReference {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("uploadId", &self.upload_id)
    }
}

/// Bounded, untrusted metadata for reserving one private upload. Ownership is
/// deliberately absent and is supplied by the authenticated control context.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobInputReservationRequest {
    pub garden_id: Option<String>,
    pub conversation_id: Option<String>,
    pub display_name: String,
    pub media_type: Option<String>,
    pub declared_size_bytes: u64,
}

impl RuntimeJobInputReservationRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if let Some(garden_id) = &self.garden_id {
            validate_scope_id("gardenId", garden_id)?;
        }
        if let Some(conversation_id) = &self.conversation_id {
            validate_scope_id("conversationId", conversation_id)?;
        }
        validate_job_input_display_name(&self.display_name)?;
        if let Some(media_type) = &self.media_type {
            validate_job_input_media_type(media_type)?;
        }
        if self.declared_size_bytes == 0
            || self.declared_size_bytes > MAX_JOB_INPUT_UPLOAD_BYTES
            || self.declared_size_bytes > MAX_JSON_SAFE_INTEGER
        {
            return Err(ValidationError::InvalidRange {
                field: "declaredSizeBytes",
            });
        }
        Ok(())
    }
}

/// Public reservation receipt. It exposes only the opaque upload id and
/// bounded lifecycle limits, never a host or relative filesystem path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobInputReservationResponse {
    pub upload_id: String,
    pub expires_at: i64,
    pub maximum_bytes: u64,
}

impl RuntimeJobInputReservationResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("uploadId", &self.upload_id)?;
        if self.expires_at <= 0
            || self.expires_at as u64 > MAX_JSON_SAFE_INTEGER
            || self.maximum_bytes == 0
            || self.maximum_bytes > MAX_JOB_INPUT_UPLOAD_BYTES
            || self.maximum_bytes > MAX_JSON_SAFE_INTEGER
        {
            return Err(ValidationError::InvalidRange {
                field: "input reservation",
            });
        }
        Ok(())
    }
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

impl JobSubmissionPayload {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("jobType", &self.job_type)?;
        if let Some(garden_id) = &self.garden_id {
            validate_scope_id("gardenId", garden_id)?;
        }
        if let Some(conversation_id) = &self.conversation_id {
            validate_scope_id("conversationId", conversation_id)?;
        }
        validate_bounded_text(
            "idempotencyKey",
            &self.idempotency_key,
            MAX_IDEMPOTENCY_KEY_BYTES,
        )?;
        if self.idempotency_key.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "idempotencyKey",
            });
        }
        if self.input_uploads.len() > MAX_JOB_INPUT_UPLOADS {
            return Err(ValidationError::InvalidRange {
                field: "inputUploads",
            });
        }
        let mut upload_ids = HashSet::with_capacity(self.input_uploads.len());
        for upload in &self.input_uploads {
            upload.validate()?;
            if !upload_ids.insert(upload.upload_id.as_str()) {
                return Err(ValidationError::DuplicateId {
                    kind: "input upload",
                    id: upload.upload_id.clone(),
                });
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeMode {
    Lean,
    Hot,
    Packaged,
}

/// Private parent-to-runtime bootstrap message. It contains roots and mode,
/// never a command, executable, argument vector, environment block, or
/// renderer-originated process authority.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RuntimeBootstrapMessage {
    RuntimeBootstrap {
        protocol_version: u32,
        mode: RuntimeMode,
        app_root: String,
        runtime_root: String,
        data_root: String,
        config_root: String,
    },
}

impl RuntimeBootstrapMessage {
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::RuntimeBootstrap {
            protocol_version,
            app_root,
            runtime_root,
            data_root,
            config_root,
            ..
        } = self;
        validate_runtime_control_version(*protocol_version)?;
        validate_root_text("appRoot", app_root)?;
        validate_root_text("runtimeRoot", runtime_root)?;
        validate_root_text("dataRoot", data_root)?;
        validate_root_text("configRoot", config_root)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeServiceState {
    AvailableButStopped,
    Starting,
    Ready,
    Busy,
    ResourceBlocked,
    InstallationUnavailable,
    Failed,
    Stopping,
}

/// Sanitized service state safe for Electron's existing startup presentation.
/// Requirement and startup policy remain separate manifest-derived axes. The
/// record intentionally carries no port, token, executable, arguments, cwd,
/// or environment material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeServiceStatus {
    pub id: String,
    pub display_name: String,
    pub required: bool,
    pub startup_policy: ServiceStartupPolicy,
    pub state: RuntimeServiceState,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub last_error: Option<String>,
    pub restarts: u32,
    pub adopted: bool,
}

impl RuntimeServiceStatus {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("service id", &self.id)?;
        validate_bounded_text("displayName", &self.display_name, MAX_STAGE_BYTES)?;
        if self.display_name.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "displayName",
            });
        }
        if let Some(last_error) = &self.last_error {
            validate_bounded_text("lastError", last_error, MAX_FAILURE_MESSAGE_BYTES)?;
        }
        if self.restarts > MAX_SERVICE_RESTARTS || self.adopted {
            return Err(ValidationError::InvalidRange {
                field: "service status",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RuntimeReadyMessage {
    RuntimeReady {
        protocol_version: u32,
        runtime_pid: u32,
        control_base_url: String,
        control_token: String,
        dashboard_url: String,
        services: Vec<RuntimeServiceStatus>,
    },
}

impl RuntimeReadyMessage {
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::RuntimeReady {
            protocol_version,
            runtime_pid,
            control_base_url,
            control_token,
            dashboard_url,
            services,
        } = self;
        validate_runtime_control_version(*protocol_version)?;
        if *runtime_pid == 0 {
            return Err(ValidationError::InvalidRange {
                field: "runtimePid",
            });
        }
        validate_loopback_http_url("controlBaseUrl", control_base_url)?;
        validate_loopback_http_url("dashboardUrl", dashboard_url)?;
        validate_bounded_text("controlToken", control_token, MAX_CONTROL_TOKEN_BYTES)?;
        if control_token.len() < MIN_CONTROL_TOKEN_BYTES
            || !control_token.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(ValidationError::InvalidIdentifier {
                field: "controlToken",
            });
        }
        validate_runtime_services(services)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RuntimeStatusMessage {
    RuntimeStatus {
        protocol_version: u32,
        runtime_pid: u32,
        accepting_work: bool,
        services: Vec<RuntimeServiceStatus>,
    },
}

impl RuntimeStatusMessage {
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::RuntimeStatus {
            protocol_version,
            runtime_pid,
            services,
            ..
        } = self;
        validate_runtime_control_version(*protocol_version)?;
        if *runtime_pid == 0 {
            return Err(ValidationError::InvalidRange {
                field: "runtimePid",
            });
        }
        validate_runtime_services(services)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeCommandAck {
    pub ok: bool,
}

/// The dashboard may request only a reason for one predefined service lease.
/// Service identity remains in the authenticated route and duration is fixed by
/// the trusted service registry rather than accepted from request JSON.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeServiceLeaseAcquireRequest {
    pub reason: String,
}

impl RuntimeServiceLeaseAcquireRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_bounded_text(
            "service lease reason",
            &self.reason,
            MAX_SERVICE_LEASE_REASON_BYTES,
        )?;
        if self.reason.trim().is_empty() || self.reason.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "service lease reason",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeServiceLeaseAcquireResponse {
    pub ok: bool,
    pub lease_id: String,
    pub service_id: String,
}

/// Passive, authenticated deadline metadata for one route-bound service.
/// The value is minted from the validated manifest; callers cannot submit or
/// override it in an acquire request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeServiceLeaseContractResponse {
    pub protocol_version: u32,
    pub service_id: String,
    pub acquire_timeout_ms: u64,
}

impl RuntimeServiceLeaseContractResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_runtime_control_version(self.protocol_version)?;
        validate_identifier("serviceId", &self.service_id)?;
        if self.acquire_timeout_ms
            <= SERVICE_LEASE_SETTLEMENT_GRACE_MS + SERVICE_LEASE_RESPONSE_GRACE_MS
            || self.acquire_timeout_ms > MAX_SERVICE_LEASE_ACQUIRE_TIMEOUT_MS
        {
            return Err(ValidationError::InvalidRange {
                field: "service lease acquire timeout",
            });
        }
        Ok(())
    }
}

impl RuntimeServiceLeaseAcquireResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if !self.ok {
            return Err(ValidationError::InvalidRange { field: "ok" });
        }
        validate_identifier("leaseId", &self.lease_id)?;
        validate_identifier("serviceId", &self.service_id)
    }
}

/// Direct release has an intentionally empty body. Owner-PID deferral belongs
/// to a separately fenced finite-worker contract and cannot be smuggled into a
/// service lease release.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeServiceLeaseReleaseRequest {}

impl RuntimeServiceLeaseReleaseRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeServiceLeaseReleaseResponse {
    pub ok: bool,
    pub released: bool,
}

impl RuntimeServiceLeaseReleaseResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.ok {
            Ok(())
        } else {
            Err(ValidationError::InvalidRange { field: "ok" })
        }
    }
}

/// Lifecycle-authority acknowledgement for one exact manifest service retry.
/// It contains only the sanitized state already exposed by `/v1/status`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeServiceRetryResponse {
    pub protocol_version: u32,
    pub ok: bool,
    pub service_id: String,
    pub accepted: bool,
    pub state: RuntimeServiceState,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeDesiredState {
    Running,
    Stopped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeGatewayId {
    Telegram,
    Whatsapp,
}

impl RuntimeGatewayId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Telegram => "telegram",
            Self::Whatsapp => "whatsapp",
        }
    }

    pub const fn service_id(self) -> &'static str {
        match self {
            Self::Telegram => "telegram-gateway",
            Self::Whatsapp => "whatsapp-gateway",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeDesiredStateRequest {
    pub desired_state: RuntimeDesiredState,
}

impl RuntimeDesiredStateRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeGatewayServiceState {
    Healthy,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeGatewayReconcileResponse {
    pub protocol_version: u32,
    pub ok: bool,
    pub gateway: RuntimeGatewayId,
    pub desired_state: RuntimeDesiredState,
    pub service_state: RuntimeGatewayServiceState,
}

impl RuntimeGatewayReconcileResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version == RUNTIME_CONTROL_PROTOCOL_VERSION && self.ok {
            Ok(())
        } else {
            Err(ValidationError::UnsupportedProtocolVersion(
                self.protocol_version,
            ))
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeScheduleControlState {
    Enabled,
    Disabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeScheduleReconcileResponse {
    pub protocol_version: u32,
    pub ok: bool,
    pub schedule_id: String,
    pub desired_state: RuntimeDesiredState,
    pub schedule_state: RuntimeScheduleControlState,
}

impl RuntimeScheduleReconcileResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != RUNTIME_CONTROL_PROTOCOL_VERSION || !self.ok {
            return Err(ValidationError::UnsupportedProtocolVersion(
                self.protocol_version,
            ));
        }
        validate_identifier("scheduleId", &self.schedule_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeScheduleStatusResponse {
    pub protocol_version: u32,
    pub ok: bool,
    pub schedule_id: String,
    pub enabled: bool,
}

/// Exact privacy-sensitive launch policy accepted by the one closed Recall
/// desired-state route. The dashboard sends the already-normalized values used
/// by its existing settings policy; Runtime validates that normalization again
/// before anything is persisted or translated to argv.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeRecallConfiguration {
    pub capture_audio: bool,
    pub excluded_windows: Vec<String>,
}

impl RuntimeRecallConfiguration {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.excluded_windows.len() > MAX_RECALL_EXCLUDED_WINDOWS {
            return Err(ValidationError::InvalidRange {
                field: "recall excludedWindows",
            });
        }
        let mut folded = HashSet::with_capacity(self.excluded_windows.len());
        let mut total_bytes = 0usize;
        for value in &self.excluded_windows {
            total_bytes = total_bytes.saturating_add(value.len());
            if value.is_empty()
                || value.trim() != value
                || value.encode_utf16().count() > MAX_RECALL_EXCLUDED_WINDOW_UTF16_UNITS
                || value.chars().any(|character| {
                    matches!(character, '\u{0000}'..='\u{001f}' | '\u{007f}' | '\'' | '"')
                })
                || !folded.insert(value.to_lowercase())
            {
                return Err(ValidationError::InvalidIdentifier {
                    field: "recall excludedWindows",
                });
            }
        }
        if total_bytes > MAX_RECALL_CONFIGURATION_TEXT_BYTES {
            return Err(ValidationError::OversizedField {
                field: "recall excludedWindows",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeRecallReconcileRequest {
    pub desired_state: RuntimeDesiredState,
    #[serde(default, deserialize_with = "deserialize_optional_non_null")]
    pub configuration: Option<RuntimeRecallConfiguration>,
}

impl RuntimeRecallReconcileRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        match (self.desired_state, &self.configuration) {
            (RuntimeDesiredState::Running, Some(configuration)) => configuration.validate(),
            (RuntimeDesiredState::Stopped, None) => Ok(()),
            _ => Err(ValidationError::InvalidRange {
                field: "recall desiredState configuration",
            }),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeRecallStatusRequest {}

impl RuntimeRecallStatusRequest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeRecallReconcileServiceState {
    Healthy,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeRecallReconcileResponse {
    pub protocol_version: u32,
    pub ok: bool,
    pub service_id: String,
    pub desired_state: RuntimeDesiredState,
    pub service_state: RuntimeRecallReconcileServiceState,
}

impl RuntimeRecallReconcileResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != RUNTIME_CONTROL_PROTOCOL_VERSION
            || !self.ok
            || self.service_id != "recall"
            || !matches!(
                (self.desired_state, self.service_state),
                (
                    RuntimeDesiredState::Running,
                    RuntimeRecallReconcileServiceState::Healthy
                ) | (
                    RuntimeDesiredState::Stopped,
                    RuntimeRecallReconcileServiceState::Stopped
                )
            )
        {
            return Err(ValidationError::InvalidRange {
                field: "recall reconciliation response",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeRecallStatusResponse {
    pub protocol_version: u32,
    pub ok: bool,
    pub service_id: String,
    pub desired_state: RuntimeDesiredState,
    pub service_state: RuntimeServiceState,
    pub owned_by_requester: bool,
    pub log_tail: Vec<String>,
}

impl RuntimeRecallStatusResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != RUNTIME_CONTROL_PROTOCOL_VERSION
            || !self.ok
            || self.service_id != "recall"
            || self.log_tail.len() > MAX_RECALL_LOG_LINES
            || self.log_tail.iter().any(|line| line.contains('\0'))
            || self.log_tail.iter().map(String::len).sum::<usize>() > MAX_RECALL_LOG_TAIL_BYTES
        {
            return Err(ValidationError::InvalidRange {
                field: "recall status response",
            });
        }
        Ok(())
    }
}

impl RuntimeScheduleStatusResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != RUNTIME_CONTROL_PROTOCOL_VERSION || !self.ok {
            return Err(ValidationError::UnsupportedProtocolVersion(
                self.protocol_version,
            ));
        }
        validate_identifier("scheduleId", &self.schedule_id)
    }
}

impl RuntimeServiceRetryResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != RUNTIME_CONTROL_PROTOCOL_VERSION || !self.ok {
            return Err(ValidationError::UnsupportedProtocolVersion(
                self.protocol_version,
            ));
        }
        validate_identifier("serviceId", &self.service_id)
    }
}

/// Closed event discriminator for the authenticated Runtime V2 replay API.
/// Each variant has one exact payload and one exact worker-attempt fence shape
/// enforced by `RuntimeJobEventRecord::validate`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeJobEventType {
    Queued,
    Admitted,
    WorkerAssigned,
    ReservationSettled,
    ReservationReleased,
    CancellationRequested,
    CompletionConfirmed,
    WorkerReady,
    WorkerHeartbeat,
    WorkerProgress,
    WorkerCheckpoint,
    WorkerArtifact,
    WorkerComplete,
    WorkerFailed,
    WorkerCancellationAcknowledged,
    JobStarting,
    JobRunning,
    JobCheckpointing,
    JobCancelling,
    JobCancelled,
    JobSucceeded,
    JobFailed,
    JobResourceExhausted,
    JobInterrupted,
    JobUncertain,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeJobEventFenceKind {
    RuntimeZero,
    RuntimeAttempt,
    RuntimeCurrent,
    Worker,
}

impl RuntimeJobEventType {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Admitted => "admitted",
            Self::WorkerAssigned => "worker-assigned",
            Self::ReservationSettled => "reservation-settled",
            Self::ReservationReleased => "reservation-released",
            Self::CancellationRequested => "cancellation-requested",
            Self::CompletionConfirmed => "completion-confirmed",
            Self::WorkerReady => "worker-ready",
            Self::WorkerHeartbeat => "worker-heartbeat",
            Self::WorkerProgress => "worker-progress",
            Self::WorkerCheckpoint => "worker-checkpoint",
            Self::WorkerArtifact => "worker-artifact",
            Self::WorkerComplete => "worker-complete",
            Self::WorkerFailed => "worker-failed",
            Self::WorkerCancellationAcknowledged => "worker-cancellation-acknowledged",
            Self::JobStarting => "job-starting",
            Self::JobRunning => "job-running",
            Self::JobCheckpointing => "job-checkpointing",
            Self::JobCancelling => "job-cancelling",
            Self::JobCancelled => "job-cancelled",
            Self::JobSucceeded => "job-succeeded",
            Self::JobFailed => "job-failed",
            Self::JobResourceExhausted => "job-resource-exhausted",
            Self::JobInterrupted => "job-interrupted",
            Self::JobUncertain => "job-uncertain",
        }
    }

    const fn fence_kind(self) -> RuntimeJobEventFenceKind {
        match self {
            Self::Queued | Self::Admitted => RuntimeJobEventFenceKind::RuntimeZero,
            Self::WorkerAssigned
            | Self::ReservationSettled
            | Self::CompletionConfirmed
            | Self::JobStarting
            | Self::JobRunning
            | Self::JobCheckpointing
            | Self::JobSucceeded
            | Self::JobFailed
            | Self::JobUncertain => RuntimeJobEventFenceKind::RuntimeAttempt,
            Self::ReservationReleased
            | Self::CancellationRequested
            | Self::JobCancelling
            | Self::JobCancelled
            | Self::JobResourceExhausted
            | Self::JobInterrupted => RuntimeJobEventFenceKind::RuntimeCurrent,
            Self::WorkerReady
            | Self::WorkerHeartbeat
            | Self::WorkerProgress
            | Self::WorkerCheckpoint
            | Self::WorkerArtifact
            | Self::WorkerComplete
            | Self::WorkerFailed
            | Self::WorkerCancellationAcknowledged => RuntimeJobEventFenceKind::Worker,
        }
    }
}

/// Sanitized durable job state returned only across the authenticated private
/// control plane. Filesystem paths, request payloads, executable details, and
/// owner principals are intentionally absent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobStatus {
    pub job_id: String,
    pub job_type: String,
    pub worker_kind: String,
    pub resource_class: ResourceClass,
    pub state: JobState,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub stage: Option<RuntimePublicStage>,
    pub attempt: u32,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub worker_instance_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub garden_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub conversation_id: Option<String>,
    pub created_at: i64,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub started_at: Option<i64>,
    pub updated_at: i64,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub finished_at: Option<i64>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub last_heartbeat_at: Option<i64>,
    pub last_worker_sequence: u64,
    pub progress_current: u64,
    pub progress_total: u64,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub failure_code: Option<RuntimePublicFailureCode>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub failure_message: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub resource_exhaustion: Option<RuntimeResourceExhaustion>,
    pub cancellation_requested: bool,
}

/// Closed, path-free evidence for a permanent Windows commit denial. Internal
/// policy labels and denial reasons deliberately have no wire representation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeResourceExhaustion {
    pub resource: String,
    pub required_headroom_mb: u64,
    pub available_headroom_mb: u64,
    pub retryable: bool,
}

impl RuntimeResourceExhaustion {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.resource != "windows_commit"
            || self.required_headroom_mb == 0
            || self.required_headroom_mb > MAX_COMMIT_LIMIT_MB
            || self.available_headroom_mb > MAX_COMMIT_LIMIT_MB
            || self.retryable
        {
            return Err(ValidationError::InvalidRange {
                field: "resource exhaustion evidence",
            });
        }
        Ok(())
    }
}

impl RuntimeJobStatus {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("jobId", &self.job_id)?;
        validate_identifier("jobType", &self.job_type)?;
        validate_identifier("workerKind", &self.worker_kind)?;
        if let Some(worker_instance_id) = &self.worker_instance_id {
            validate_identifier("workerInstanceId", worker_instance_id)?;
            if self.attempt == 0 {
                return Err(ValidationError::InvalidRange { field: "attempt" });
            }
        }
        if let Some(garden_id) = &self.garden_id {
            validate_scope_id("gardenId", garden_id)?;
        }
        if let Some(conversation_id) = &self.conversation_id {
            validate_scope_id("conversationId", conversation_id)?;
        }
        if self.created_at <= 0
            || self.updated_at <= 0
            || self.updated_at < self.created_at
            || self.started_at.is_some_and(|value| value <= 0)
            || self.finished_at.is_some_and(|value| value <= 0)
            || self.last_heartbeat_at.is_some_and(|value| value <= 0)
            || self.started_at.is_some_and(|value| {
                value < self.created_at
                    || value > self.updated_at
                    || value > MAX_JSON_SAFE_INTEGER as i64
            })
            || self.updated_at > MAX_JSON_SAFE_INTEGER as i64
            || self.finished_at.is_some_and(|value| {
                value < self.created_at
                    || value > self.updated_at
                    || value > MAX_JSON_SAFE_INTEGER as i64
            })
            || self.last_heartbeat_at.is_some_and(|value| {
                value < self.created_at
                    || value > self.updated_at
                    || value > MAX_JSON_SAFE_INTEGER as i64
            })
            || self.last_worker_sequence > MAX_JSON_SAFE_INTEGER
        {
            return Err(ValidationError::InvalidRange {
                field: "job timestamps or sequence",
            });
        }
        if self.progress_current > MAX_JSON_SAFE_INTEGER
            || self.progress_total > MAX_JSON_SAFE_INTEGER
            || (self.progress_total == 0 && self.progress_current != 0)
            || (self.progress_total > 0 && self.progress_current > self.progress_total)
        {
            return Err(ValidationError::InvalidRange { field: "progress" });
        }
        let failure_valid = match (self.failure_code, self.failure_message.as_deref()) {
            (None, None) => true,
            (Some(code), Some(SANITIZED_RUNTIME_FAILURE_MESSAGE)) => matches!(
                (self.state, code),
                (JobState::Failed, RuntimePublicFailureCode::RuntimeJobFailed)
                    | (JobState::Failed, RuntimePublicFailureCode::WorkerFailed)
                    | (
                        JobState::ResourceExhausted,
                        RuntimePublicFailureCode::ResourceExhausted
                    )
                    | (JobState::Interrupted, RuntimePublicFailureCode::Interrupted)
                    | (JobState::Uncertain, RuntimePublicFailureCode::Uncertain)
                    | (
                        JobState::Failed,
                        RuntimePublicFailureCode::ServiceDependencyUnavailable
                    )
            ),
            _ => false,
        };
        if !failure_valid {
            return Err(ValidationError::InvalidRange {
                field: "job failure",
            });
        }
        if let Some(resource_exhaustion) = &self.resource_exhaustion {
            resource_exhaustion.validate()?;
            if self.state != JobState::ResourceExhausted
                || self.failure_code != Some(RuntimePublicFailureCode::ResourceExhausted)
            {
                return Err(ValidationError::InvalidRange {
                    field: "job resource exhaustion evidence",
                });
            }
        } else if self.state != JobState::ResourceExhausted
            && self.failure_code == Some(RuntimePublicFailureCode::ResourceExhausted)
        {
            return Err(ValidationError::InvalidRange {
                field: "job resource exhaustion evidence",
            });
        }
        Ok(())
    }
}

/// Path-free event detail safe for the authenticated Next compatibility
/// adapter. Every allowed field is scalar and bounded; worker identities,
/// result/checkpoint/artifact paths, hashes, request data, and provider details
/// have no representation in this type.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobEventPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<JobState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stage: Option<RuntimePublicStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_current: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress_total: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact_kind: Option<RuntimePublicArtifactKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_code: Option<RuntimePublicFailureCode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_exhaustion: Option<RuntimeResourceExhaustion>,
}

impl RuntimeJobEventPayload {
    pub fn validate_for(&self, event_type: RuntimeJobEventType) -> Result<(), ValidationError> {
        use RuntimeJobEventType as Event;

        let valid = match event_type {
            Event::Queued => self.is_exact_state(JobState::Queued),
            Event::Admitted => self.is_exact_state(JobState::Admitted),
            Event::WorkerAssigned | Event::JobStarting => self.is_exact_state(JobState::Starting),
            Event::CancellationRequested
            | Event::WorkerCancellationAcknowledged
            | Event::JobCancelling => self.is_exact_state(JobState::Cancelling),
            Event::CompletionConfirmed | Event::JobSucceeded => {
                self.is_exact_state(JobState::Succeeded)
            }
            Event::WorkerReady => {
                self.is_exact_state(JobState::Running) || self.is_exact_state(JobState::Cancelling)
            }
            Event::JobRunning => self.is_exact_state(JobState::Running),
            Event::JobCheckpointing => self.is_exact_state(JobState::Checkpointing),
            Event::JobCancelled => self.is_exact_state(JobState::Cancelled),
            Event::JobFailed => self.is_exact_state(JobState::Failed),
            Event::JobResourceExhausted => {
                self.is_exact_state(JobState::ResourceExhausted)
                    || self.is_exact_resource_exhaustion()
            }
            Event::JobInterrupted => self.is_exact_state(JobState::Interrupted),
            Event::JobUncertain => self.is_exact_state(JobState::Uncertain),
            Event::ReservationSettled | Event::ReservationReleased | Event::WorkerComplete => {
                self == &Self::default()
            }
            Event::WorkerHeartbeat => {
                self.stage.is_some()
                    && self.state.is_none()
                    && self.progress_current.is_none()
                    && self.progress_total.is_none()
                    && self.artifact_kind.is_none()
                    && self.failure_code.is_none()
                    && self.failure_message.is_none()
                    && self.resource_exhaustion.is_none()
            }
            Event::WorkerProgress => {
                self.stage.is_some()
                    && matches!(
                        (self.progress_current, self.progress_total),
                        (Some(current), Some(total))
                            if total > 0
                                && current <= total
                                && total <= MAX_JSON_SAFE_INTEGER
                    )
                    && self.state.is_none()
                    && self.artifact_kind.is_none()
                    && self.failure_code.is_none()
                    && self.failure_message.is_none()
                    && self.resource_exhaustion.is_none()
            }
            Event::WorkerCheckpoint | Event::WorkerArtifact => {
                self.artifact_kind.is_some()
                    && self.state.is_none()
                    && self.stage.is_none()
                    && self.progress_current.is_none()
                    && self.progress_total.is_none()
                    && self.failure_code.is_none()
                    && self.failure_message.is_none()
                    && self.resource_exhaustion.is_none()
            }
            Event::WorkerFailed => {
                (self.state == Some(JobState::Failed)
                    && self.failure_code == Some(RuntimePublicFailureCode::WorkerFailed)
                    && self.failure_message.as_deref() == Some(SANITIZED_RUNTIME_FAILURE_MESSAGE)
                    && self.stage.is_none()
                    && self.progress_current.is_none()
                    && self.progress_total.is_none()
                    && self.artifact_kind.is_none()
                    && self.resource_exhaustion.is_none())
                    || self.is_exact_state(JobState::Cancelling)
            }
        };
        if valid {
            Ok(())
        } else {
            Err(ValidationError::InvalidRange {
                field: "event payload",
            })
        }
    }

    fn is_exact_state(&self, state: JobState) -> bool {
        self.state == Some(state)
            && self.stage.is_none()
            && self.progress_current.is_none()
            && self.progress_total.is_none()
            && self.artifact_kind.is_none()
            && self.failure_code.is_none()
            && self.failure_message.is_none()
            && self.resource_exhaustion.is_none()
    }

    fn is_exact_resource_exhaustion(&self) -> bool {
        self.state == Some(JobState::ResourceExhausted)
            && self.stage.is_none()
            && self.progress_current.is_none()
            && self.progress_total.is_none()
            && self.artifact_kind.is_none()
            && self.failure_code.is_none()
            && self.failure_message.is_none()
            && self
                .resource_exhaustion
                .as_ref()
                .is_some_and(|evidence| evidence.validate().is_ok())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeJobEventRecord {
    pub sequence: u64,
    pub job_id: String,
    pub attempt: u32,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub worker_instance_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub worker_sequence: Option<u64>,
    pub event_type: RuntimeJobEventType,
    pub payload: RuntimeJobEventPayload,
    pub created_at: i64,
}

impl RuntimeJobEventRecord {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.sequence == 0 || self.sequence > MAX_JSON_SAFE_INTEGER {
            return Err(ValidationError::InvalidRange {
                field: "event sequence",
            });
        }
        validate_identifier("jobId", &self.job_id)?;
        if let Some(worker_instance_id) = &self.worker_instance_id {
            validate_identifier("workerInstanceId", worker_instance_id)?;
        }
        let worker_sequence_valid = match self.worker_sequence {
            None => true,
            Some(value) => value > 0 && value <= MAX_JSON_SAFE_INTEGER,
        };
        let fence_valid = match self.event_type.fence_kind() {
            RuntimeJobEventFenceKind::RuntimeZero => {
                self.attempt == 0
                    && self.worker_instance_id.is_none()
                    && self.worker_sequence.is_none()
            }
            RuntimeJobEventFenceKind::RuntimeAttempt => {
                self.attempt > 0
                    && self.worker_instance_id.is_some()
                    && self.worker_sequence.is_none()
            }
            RuntimeJobEventFenceKind::RuntimeCurrent => {
                self.worker_sequence.is_none()
                    && ((self.attempt == 0 && self.worker_instance_id.is_none())
                        || (self.attempt > 0 && self.worker_instance_id.is_some()))
            }
            RuntimeJobEventFenceKind::Worker => {
                self.attempt > 0
                    && self.worker_instance_id.is_some()
                    && self.worker_sequence.is_some()
            }
        };
        if !worker_sequence_valid || !fence_valid {
            return Err(ValidationError::InvalidRange {
                field: "job event fence",
            });
        }
        self.payload.validate_for(self.event_type)?;
        if self.created_at <= 0 || self.created_at > MAX_JSON_SAFE_INTEGER as i64 {
            return Err(ValidationError::InvalidRange { field: "createdAt" });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RuntimeJobResponse {
    RuntimeJob {
        protocol_version: u32,
        job: RuntimeJobStatus,
    },
}

impl RuntimeJobResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::RuntimeJob {
            protocol_version,
            job,
        } = self;
        validate_runtime_control_version(*protocol_version)?;
        job.validate()
    }
}

/// Closed state domain for cancellation by idempotency key. `pending` is not a
/// job state: it means a durable, exact-scope cancellation tombstone exists and
/// will win a later submission transaction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeJobIdempotencyCancellationState {
    Pending,
    Queued,
    Admitted,
    Starting,
    Running,
    Checkpointing,
    Cancelling,
    Cancelled,
    Succeeded,
    Failed,
    ResourceExhausted,
    Interrupted,
    Uncertain,
}

impl From<JobState> for RuntimeJobIdempotencyCancellationState {
    fn from(state: JobState) -> Self {
        match state {
            JobState::Queued => Self::Queued,
            JobState::Admitted => Self::Admitted,
            JobState::Starting => Self::Starting,
            JobState::Running => Self::Running,
            JobState::Checkpointing => Self::Checkpointing,
            JobState::Cancelling => Self::Cancelling,
            JobState::Cancelled => Self::Cancelled,
            JobState::Succeeded => Self::Succeeded,
            JobState::Failed => Self::Failed,
            JobState::ResourceExhausted => Self::ResourceExhausted,
            JobState::Interrupted => Self::Interrupted,
            JobState::Uncertain => Self::Uncertain,
        }
    }
}

/// Bounded cancellation disposition. No idempotency key, owner principal,
/// payload digest, tombstone expiry, or filesystem detail crosses the control
/// boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RuntimeJobIdempotencyCancellationResponse {
    RuntimeJobIdempotencyCancellation {
        protocol_version: u32,
        #[serde(deserialize_with = "deserialize_required_nullable")]
        job_id: Option<String>,
        state: RuntimeJobIdempotencyCancellationState,
        accepted: bool,
    },
}

impl RuntimeJobIdempotencyCancellationResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::RuntimeJobIdempotencyCancellation {
            protocol_version,
            job_id,
            state,
            accepted,
        } = self;
        validate_runtime_control_version(*protocol_version)?;
        if let Some(job_id) = job_id {
            validate_identifier("jobId", job_id)?;
        }
        let exact = match state {
            RuntimeJobIdempotencyCancellationState::Pending => job_id.is_none() && *accepted,
            RuntimeJobIdempotencyCancellationState::Cancelling
            | RuntimeJobIdempotencyCancellationState::Cancelled => job_id.is_some() && *accepted,
            RuntimeJobIdempotencyCancellationState::Succeeded
            | RuntimeJobIdempotencyCancellationState::Failed
            | RuntimeJobIdempotencyCancellationState::ResourceExhausted
            | RuntimeJobIdempotencyCancellationState::Interrupted
            | RuntimeJobIdempotencyCancellationState::Uncertain => job_id.is_some() && !*accepted,
            RuntimeJobIdempotencyCancellationState::Queued
            | RuntimeJobIdempotencyCancellationState::Admitted
            | RuntimeJobIdempotencyCancellationState::Starting
            | RuntimeJobIdempotencyCancellationState::Running
            | RuntimeJobIdempotencyCancellationState::Checkpointing => false,
        };
        if exact {
            Ok(())
        } else {
            Err(ValidationError::InvalidRange {
                field: "idempotency cancellation disposition",
            })
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RuntimeJobEventsResponse {
    RuntimeJobEvents {
        protocol_version: u32,
        job_id: String,
        after: u64,
        next_after: u64,
        /// True only when durable job state is terminal and no pending or
        /// resident job reservation can append another public event.
        terminal: bool,
        has_more: bool,
        events: Vec<RuntimeJobEventRecord>,
    },
}

impl RuntimeJobEventsResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::RuntimeJobEvents {
            protocol_version,
            job_id,
            after,
            next_after,
            has_more,
            events,
            ..
        } = self;
        validate_runtime_control_version(*protocol_version)?;
        validate_identifier("jobId", job_id)?;
        if *after > MAX_JSON_SAFE_INTEGER
            || *next_after > MAX_JSON_SAFE_INTEGER
            || *next_after < *after
            || events.len() > MAX_JOB_EVENT_REPLAY_RECORDS
            || (*has_more && events.is_empty())
        {
            return Err(ValidationError::InvalidRange {
                field: "event replay",
            });
        }
        let mut previous = *after;
        for event in events {
            event.validate()?;
            if event.job_id.as_str() != job_id.as_str() || event.sequence <= previous {
                return Err(ValidationError::InvalidRange {
                    field: "event replay ordering",
                });
            }
            previous = event.sequence;
        }
        if previous != *next_after {
            return Err(ValidationError::InvalidRange { field: "nextAfter" });
        }
        Ok(())
    }
}

/// A bounded, renderer-safe error envelope. Detailed executable, path,
/// environment, and provider material must never be placed in `message`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RuntimeControlErrorResponse {
    RuntimeError {
        protocol_version: u32,
        code: String,
        message: String,
        retryable: bool,
        #[serde(deserialize_with = "deserialize_required_nullable")]
        resource: Option<String>,
        #[serde(deserialize_with = "deserialize_required_nullable")]
        required_headroom_mb: Option<u64>,
        #[serde(deserialize_with = "deserialize_required_nullable")]
        available_headroom_mb: Option<u64>,
    },
}

impl RuntimeControlErrorResponse {
    pub fn validate(&self) -> Result<(), ValidationError> {
        let Self::RuntimeError {
            protocol_version,
            code,
            message,
            resource,
            required_headroom_mb,
            available_headroom_mb,
            retryable,
        } = self;
        validate_runtime_control_version(*protocol_version)?;
        if !matches!(
            code.as_str(),
            "INVALID_JOB_REQUEST"
                | "JOB_SCOPE_FORBIDDEN"
                | "JOB_NOT_FOUND"
                | "JOB_CONFLICT"
                | "INVALID_SERVICE_REQUEST"
                | "SERVICE_NOT_FOUND"
                | "SERVICE_LEASE_CONFLICT"
                | "JOB_OUTPUT_NOT_READY"
                | "JOB_INPUT_TOO_LARGE"
                | "JOB_INPUT_QUOTA_EXCEEDED"
                | "JOB_CANCELLATION_QUOTA_EXCEEDED"
                | "JOB_CANCELLED_BEFORE_SUBMISSION"
                | "BREADBOARD_RESOURCE_EXHAUSTED"
                | "RUNTIME_UNAVAILABLE"
                | "RUNTIME_INTERNAL_ERROR"
        ) {
            return Err(ValidationError::InvalidIdentifier {
                field: "error code",
            });
        }
        validate_bounded_text("error message", message, MAX_FAILURE_MESSAGE_BYTES)?;
        if *retryable {
            return Err(ValidationError::InvalidRange { field: "retryable" });
        }
        if code == "BREADBOARD_RESOURCE_EXHAUSTED" {
            if resource.as_deref() != Some("windows_commit")
                || !required_headroom_mb
                    .is_some_and(|value| value > 0 && value <= MAX_COMMIT_LIMIT_MB)
                || !available_headroom_mb.is_some_and(|value| value <= MAX_COMMIT_LIMIT_MB)
            {
                return Err(ValidationError::InvalidRange {
                    field: "resource exhaustion evidence",
                });
            }
        } else if resource.is_some()
            || required_headroom_mb.is_some()
            || available_headroom_mb.is_some()
        {
            return Err(ValidationError::InvalidRange {
                field: "non-resource error evidence",
            });
        }
        Ok(())
    }
}

impl RuntimeCommandAck {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if !self.ok {
            return Err(ValidationError::InvalidRange { field: "ok" });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerIdentity {
    pub job_id: String,
    pub attempt: u32,
    pub worker_instance_id: String,
}

impl WorkerIdentity {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("jobId", &self.job_id)?;
        validate_identifier("workerInstanceId", &self.worker_instance_id)?;
        if self.attempt == 0 {
            return Err(ValidationError::InvalidRange { field: "attempt" });
        }
        Ok(())
    }
}

/// Closed, runtime-authenticated ownership scope supplied to one finite
/// worker. These values are not request-payload claims: the authoritative
/// runtime derives them from the exact durable job record when consuming its
/// dispatch claim.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerExecutionScope {
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub user_id: Option<i64>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub garden_id: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub conversation_id: Option<String>,
}

impl WorkerExecutionScope {
    pub const fn unscoped() -> Self {
        Self {
            user_id: None,
            garden_id: None,
            conversation_id: None,
        }
    }

    pub fn new(
        user_id: Option<i64>,
        garden_id: Option<String>,
        conversation_id: Option<String>,
    ) -> Result<Self, ValidationError> {
        let scope = Self {
            user_id,
            garden_id,
            conversation_id,
        };
        scope.validate()?;
        Ok(scope)
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        if self
            .user_id
            .is_some_and(|value| value <= 0 || value > MAX_JSON_SAFE_INTEGER as i64)
        {
            return Err(ValidationError::InvalidRange { field: "userId" });
        }
        if let Some(garden_id) = &self.garden_id {
            validate_scope_id("gardenId", garden_id)?;
        }
        if let Some(conversation_id) = &self.conversation_id {
            validate_scope_id("conversationId", conversation_id)?;
        }
        Ok(())
    }
}

/// Closed runtime-to-worker launch contract. Every path is relative to the
/// pinned Runtime V2 data root and is derived exactly from the fenced worker
/// identity. The worker receives only the fixed `start.json` filename in argv;
/// no request payload, secret, executable, arbitrary argument, or environment
/// field can be represented here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerInputBlob {
    pub blob_id: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub display_name: String,
    pub media_type: Option<String>,
}

impl WorkerInputBlob {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("blobId", &self.blob_id)?;
        validate_relative_path("input blob path", &self.relative_path)?;
        if self.size_bytes == 0
            || self.size_bytes > MAX_JOB_INPUT_UPLOAD_BYTES
            || self.size_bytes > MAX_JSON_SAFE_INTEGER
        {
            return Err(ValidationError::InvalidRange {
                field: "input blob size",
            });
        }
        if self.sha256.len() != 64
            || !self
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Err(ValidationError::InvalidIdentifier {
                field: "input blob SHA-256",
            });
        }
        validate_job_input_display_name(&self.display_name)?;
        if let Some(media_type) = &self.media_type {
            validate_job_input_media_type(media_type)?;
        }
        Ok(())
    }

    fn validate_for_job(&self, job_id: &str) -> Result<(), ValidationError> {
        self.validate()?;
        if self.relative_path != format!("runtime/jobs/{job_id}/inputs/{}/payload", self.blob_id) {
            return Err(ValidationError::InvalidRelativePath {
                field: "input blob path",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerStartManifest {
    pub protocol_version: u32,
    pub identity: WorkerIdentity,
    pub execution_scope: WorkerExecutionScope,
    pub input_manifest_path: String,
    pub input_blobs: Vec<WorkerInputBlob>,
    pub workspace_path: String,
    pub checkpoint_path: String,
    pub result_path: String,
}

impl WorkerStartManifest {
    pub fn for_identity(identity: WorkerIdentity) -> Result<Self, ValidationError> {
        Self::for_identity_and_scope(identity, WorkerExecutionScope::unscoped())
    }

    pub fn for_identity_and_scope(
        identity: WorkerIdentity,
        execution_scope: WorkerExecutionScope,
    ) -> Result<Self, ValidationError> {
        Self::for_identity_scope_and_inputs(identity, execution_scope, Vec::new())
    }

    pub fn for_identity_scope_and_inputs(
        identity: WorkerIdentity,
        execution_scope: WorkerExecutionScope,
        input_blobs: Vec<WorkerInputBlob>,
    ) -> Result<Self, ValidationError> {
        identity.validate()?;
        execution_scope.validate()?;
        let job_root = format!("runtime/jobs/{}", identity.job_id);
        let attempt_root = format!(
            "{job_root}/attempts/{}/{}",
            identity.attempt, identity.worker_instance_id
        );
        let manifest = Self {
            protocol_version: WIRE_PROTOCOL_VERSION,
            identity,
            execution_scope,
            input_manifest_path: format!("{job_root}/input.json"),
            input_blobs,
            workspace_path: format!("{attempt_root}/workspace"),
            checkpoint_path: format!("{job_root}/checkpoint.json"),
            result_path: format!("{job_root}/result.json"),
        };
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.protocol_version != WIRE_PROTOCOL_VERSION {
            return Err(ValidationError::UnsupportedProtocolVersion(
                self.protocol_version,
            ));
        }
        self.identity.validate()?;
        self.execution_scope.validate()?;
        if self.input_blobs.len() > MAX_JOB_INPUT_UPLOADS {
            return Err(ValidationError::InvalidRange {
                field: "inputBlobs",
            });
        }
        let mut blob_ids = HashSet::with_capacity(self.input_blobs.len());
        for blob in &self.input_blobs {
            blob.validate_for_job(&self.identity.job_id)?;
            if !blob_ids.insert(blob.blob_id.as_str()) {
                return Err(ValidationError::DuplicateId {
                    kind: "worker input blob",
                    id: blob.blob_id.clone(),
                });
            }
        }

        for (field, value) in [
            ("inputManifestPath", self.input_manifest_path.as_str()),
            ("workspacePath", self.workspace_path.as_str()),
            ("checkpointPath", self.checkpoint_path.as_str()),
            ("resultPath", self.result_path.as_str()),
        ] {
            validate_relative_path(field, value)?;
        }

        let expected = Self::for_identity_unchecked(
            &self.identity,
            &self.execution_scope,
            self.input_blobs.clone(),
        );
        if self.input_manifest_path != expected.input_manifest_path {
            return Err(ValidationError::InvalidRelativePath {
                field: "inputManifestPath",
            });
        }
        if self.workspace_path != expected.workspace_path {
            return Err(ValidationError::InvalidRelativePath {
                field: "workspacePath",
            });
        }
        if self.checkpoint_path != expected.checkpoint_path {
            return Err(ValidationError::InvalidRelativePath {
                field: "checkpointPath",
            });
        }
        if self.result_path != expected.result_path {
            return Err(ValidationError::InvalidRelativePath {
                field: "resultPath",
            });
        }
        Ok(())
    }

    fn for_identity_unchecked(
        identity: &WorkerIdentity,
        execution_scope: &WorkerExecutionScope,
        input_blobs: Vec<WorkerInputBlob>,
    ) -> Self {
        let job_root = format!("runtime/jobs/{}", identity.job_id);
        let attempt_root = format!(
            "{job_root}/attempts/{}/{}",
            identity.attempt, identity.worker_instance_id
        );
        Self {
            protocol_version: WIRE_PROTOCOL_VERSION,
            identity: identity.clone(),
            execution_scope: execution_scope.clone(),
            input_manifest_path: format!("{job_root}/input.json"),
            input_blobs,
            workspace_path: format!("{attempt_root}/workspace"),
            checkpoint_path: format!("{job_root}/checkpoint.json"),
            result_path: format!("{job_root}/result.json"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspacePolicy {
    PrivatePerJob,
    ReadOnlyInputs,
}

/// Closed submission boundary for a finite worker. User workers can be
/// reached through the authenticated Dashboard job API; runtime workers can
/// only be submitted by the native scheduler/reconciliation authority.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkerSubmissionAuthority {
    #[default]
    User,
    Runtime,
}

/// Closed environment builders available to finite workers. `Minimal` keeps
/// the historical SystemRoot-only worker environment. `Background` is the
/// native Runtime-owned scheduler profile and cannot be selected by a request.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TrustedWorkerEnvironmentSource {
    #[default]
    Minimal,
    Background,
    DocumentIngestion,
    AudioAnalyzer,
    ImageSearchGoogle,
    InteractiveVisualizer,
    QuartzPublish,
    ManagedSetup,
    Terminal,
    CodeIndex,
    AgentEdits,
    OuterCodex,
    OuterRuflo,
    OuterDeepTutor,
    #[serde(rename = "outer-openplanter")]
    OuterOpenPlanter,
    Manim,
    DeepTutorMaintenance,
    Premortem,
    AgentLoop,
    Omh,
    Factcheck,
    WatchMedia,
    Loopx,
    #[serde(rename = "resource2skill")]
    Resource2Skill,
    OuterOpencode,
    TradingAgent,
    OuterCareerOps,
    #[serde(rename = "outer-openexecutive")]
    OuterOpenExecutive,
    SystemLocation,
    Chatmock,
    Vimax,
    VoxDirector,
    OuterShorts,
    OuterOpenGym,
    AgentReachSetup,
    GbrainSync,
    OuterAgentReach,
    AgentBrowserProfile,
    AgentTars,
    OuterLegal,
    Sf3d,
    OuterMatraix,
    Formsmith,
    Hyperframes,
    #[serde(rename = "openmontage")]
    OpenMontage,
    OuterBoltSlides,
    Subsai,
    SpeechMedia,
    GeneratedVisualBrowser,
    ScriberrGarden,
    Watermark,
    OuterHardwareBlueprint,
    MusicProducer,
    GetDoc,
    GetDocDownload,
    MeetingNotes,
    OuterInboxZero,
    OuterSocialsManager,
    OuterMaxResearch,
    OuterWardrobe,
    OuterParametricCad,
    OuterStockAnalyst,
    OuterVibeTrading,
    OuterDeerFlow,
    OuterMoneyPrinter,
    OuterVideoUse,
    OuterDeepResearch,
    OuterOpenscience,
    OuterOpenwork,
}

/// Closed predicates that may activate a predeclared worker service
/// dependency. These predicates are evaluated only by the trusted Registry
/// against the canonical request stored for the selected worker; callers can
/// never submit a service identifier or a JSON path.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum WorkerServiceDependencyCondition {
    DocumentIngestionParseWithVlm,
    GbrainSyncAlways,
    Always,
    ScriberrGardenTranscriptionAlways,
    MeetingNotesEngineScriberr,
    MeetingNotesEngineVoicebox,
    MeetingNotesNeedsChatmock,
    MaxResearchOpenscienceEnabled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerServiceDependency {
    pub service_id: String,
    pub condition: WorkerServiceDependencyCondition,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerDefinition {
    pub kind: String,
    pub job_types: Vec<String>,
    pub capability_ids: Vec<String>,
    #[serde(default)]
    pub submission_authority: WorkerSubmissionAuthority,
    #[serde(default)]
    pub environment_source: TrustedWorkerEnvironmentSource,
    #[serde(default)]
    pub service_dependencies: Vec<WorkerServiceDependency>,
    pub allowed_executable: String,
    pub allowed_entrypoint: String,
    pub protocol_version: u32,
    pub resource_class: ResourceClass,
    pub estimated_cold_start_commit_mb: u64,
    pub soft_commit_limit_mb: u64,
    pub hard_commit_limit_mb: u64,
    pub maximum_concurrency: u32,
    pub minimum_input_blobs: u32,
    pub maximum_input_blobs: u32,
    pub workspace_policy: WorkspacePolicy,
    pub ready_timeout_ms: u64,
    pub heartbeat_timeout_ms: u64,
    pub graceful_cancellation_ms: u64,
    pub maximum_runtime_ms: u64,
    pub exit_after_job: bool,
}

impl WorkerDefinition {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("worker kind", &self.kind)?;
        if self.job_types.is_empty() {
            return Err(ValidationError::EmptyField { field: "jobTypes" });
        }
        if self.job_types.len() > MAX_JOB_TYPES_PER_WORKER {
            return Err(ValidationError::InvalidRange { field: "jobTypes" });
        }
        validate_unique_identifiers("jobType", &self.job_types)?;
        if self.capability_ids.is_empty() {
            return Err(ValidationError::EmptyField {
                field: "capabilityIds",
            });
        }
        if self.capability_ids.len() > MAX_CAPABILITIES_PER_DEFINITION {
            return Err(ValidationError::InvalidRange {
                field: "capabilityIds",
            });
        }
        validate_unique_capability_ids("capabilityId", &self.capability_ids)?;
        if self.service_dependencies.len() > MAX_SERVICE_DEPENDENCIES_PER_WORKER {
            return Err(ValidationError::InvalidRange {
                field: "worker service dependencies",
            });
        }
        let mut service_dependencies = HashSet::new();
        for dependency in &self.service_dependencies {
            validate_identifier("worker service dependency", &dependency.service_id)?;
            if !service_dependencies.insert(dependency.service_id.as_str()) {
                return Err(ValidationError::DuplicateId {
                    kind: "worker service dependency",
                    id: dependency.service_id.clone(),
                });
            }
        }
        validate_relative_path("allowedExecutable", &self.allowed_executable)?;
        validate_relative_path("allowedEntrypoint", &self.allowed_entrypoint)?;
        if self.protocol_version != WIRE_PROTOCOL_VERSION {
            return Err(ValidationError::UnsupportedProtocolVersion(
                self.protocol_version,
            ));
        }
        if !self.exit_after_job {
            return Err(ValidationError::ReusableFiniteWorker(self.kind.clone()));
        }
        if self.maximum_concurrency == 0
            || self.maximum_concurrency > MAX_CONCURRENCY
            || self.minimum_input_blobs > self.maximum_input_blobs
            || self.maximum_input_blobs as usize > MAX_JOB_INPUT_UPLOADS
            || self.estimated_cold_start_commit_mb == 0
            || self.estimated_cold_start_commit_mb > MAX_COMMIT_LIMIT_MB
            || self.soft_commit_limit_mb > MAX_COMMIT_LIMIT_MB
            || self.hard_commit_limit_mb > MAX_COMMIT_LIMIT_MB
            || self.ready_timeout_ms == 0
            || self.ready_timeout_ms > MAX_TIMEOUT_MS
            || self.heartbeat_timeout_ms == 0
            || self.heartbeat_timeout_ms > MAX_TIMEOUT_MS
            || self.graceful_cancellation_ms == 0
            || self.graceful_cancellation_ms > MAX_TIMEOUT_MS
            || self.maximum_runtime_ms == 0
            || self.maximum_runtime_ms > MAX_TIMEOUT_MS
        {
            return Err(ValidationError::InvalidRange {
                field: "worker limits",
            });
        }
        if self.hard_commit_limit_mb > 0 && self.soft_commit_limit_mb >= self.hard_commit_limit_mb {
            return Err(ValidationError::InvalidRange {
                field: "worker commit limits",
            });
        }
        if self.estimated_cold_start_commit_mb >= self.hard_commit_limit_mb {
            return Err(ValidationError::InvalidRange {
                field: "worker cold-start estimate",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerManifest {
    pub version: u32,
    pub workers: Vec<WorkerDefinition>,
}

impl WorkerManifest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.version != WORKER_MANIFEST_VERSION {
            return Err(ValidationError::UnsupportedProtocolVersion(self.version));
        }
        if self.workers.len() > MAX_MANIFEST_ENTRIES {
            return Err(ValidationError::InvalidRange {
                field: "worker count",
            });
        }
        let mut ids = HashSet::new();
        let mut job_types = HashSet::new();
        for worker in &self.workers {
            worker.validate()?;
            if !ids.insert(worker.kind.clone()) {
                return Err(ValidationError::DuplicateId {
                    kind: "worker",
                    id: worker.kind.clone(),
                });
            }
            for job_type in &worker.job_types {
                if !job_types.insert(job_type.clone()) {
                    return Err(ValidationError::DuplicateId {
                        kind: "job type",
                        id: job_type.clone(),
                    });
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceStartupPolicy {
    Eager,
    OnDemand,
    Scheduled,
    External,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RestartPolicy {
    Never,
    OnFailure,
}

/// Registration criticality for a manifest service. `Required` makes the
/// service a mandatory product capability; `Optional` permits failure
/// isolation without omitting, hiding, or silently substituting it. This is
/// deliberately independent from `ServiceStartupPolicy`: a required on-demand
/// service remains registered and available-but-stopped until its first lease.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceRequirement {
    Required,
    Optional,
}

impl ServiceRequirement {
    pub const fn is_required(self) -> bool {
        matches!(self, Self::Required)
    }
}

/// Closed selectors for runtime-owned environment builders. A manifest can
/// select one of these trusted builders, but cannot carry environment keys,
/// values, inherited-variable names, or secrets itself.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TrustedServiceEnvironmentSource {
    Chatmock,
    Acestep,
    Comfyui,
    Dashboard,
    Gbrain,
    Hermes,
    TelegramGateway,
    WhatsappGateway,
    Openwork,
    Openscience,
    MoneyPrinter,
    Wardrobe,
    Penecho,
    VlmOcr,
    Recall,
    Mem0SemanticEngine,
    LocalMcpBroker,
    PostizCoordinator,
    InboxZeroStack,
    SpotifyPlayback,
    Cliproxy,
    Quartz,
    UiTars,
    Cad,
    Colpali,
    Humanizer,
    Voicebox,
    Scriberr,
    DeepResearch,
    DeerFlow,
    VibeTrading,
    StockAnalyst,
    SolidworksMcp,
}

impl TrustedServiceEnvironmentSource {
    /// Closed iteration/index order used by endpoint allocation. Adding a
    /// service environment is therefore one compile-visible change rather
    /// than another hand-maintained field in every reservation table.
    pub const ALL: [Self; 33] = [
        Self::Chatmock,
        Self::Comfyui,
        Self::Dashboard,
        Self::Gbrain,
        Self::Hermes,
        Self::TelegramGateway,
        Self::WhatsappGateway,
        Self::Openwork,
        Self::Openscience,
        Self::MoneyPrinter,
        Self::Wardrobe,
        Self::Penecho,
        Self::VlmOcr,
        Self::Recall,
        Self::Mem0SemanticEngine,
        Self::LocalMcpBroker,
        Self::PostizCoordinator,
        Self::InboxZeroStack,
        Self::SpotifyPlayback,
        Self::Cliproxy,
        Self::Quartz,
        Self::UiTars,
        Self::Cad,
        Self::Colpali,
        Self::Humanizer,
        Self::Voicebox,
        Self::Scriberr,
        Self::DeepResearch,
        Self::DeerFlow,
        Self::VibeTrading,
        Self::StockAnalyst,
        Self::SolidworksMcp,
        Self::Acestep,
    ];
    pub const COUNT: usize = Self::ALL.len();

    pub const fn index(self) -> usize {
        match self {
            Self::Chatmock => 0,
            Self::Comfyui => 1,
            Self::Acestep => 32,
            Self::Dashboard => 2,
            Self::Gbrain => 3,
            Self::Hermes => 4,
            Self::TelegramGateway => 5,
            Self::WhatsappGateway => 6,
            Self::Openwork => 7,
            Self::Openscience => 8,
            Self::MoneyPrinter => 9,
            Self::Wardrobe => 10,
            Self::Penecho => 11,
            Self::VlmOcr => 12,
            Self::Recall => 13,
            Self::Mem0SemanticEngine => 14,
            Self::LocalMcpBroker => 15,
            Self::PostizCoordinator => 16,
            Self::InboxZeroStack => 17,
            Self::SpotifyPlayback => 18,
            Self::Cliproxy => 19,
            Self::Quartz => 20,
            Self::UiTars => 21,
            Self::Cad => 22,
            Self::Colpali => 23,
            Self::Humanizer => 24,
            Self::Voicebox => 25,
            Self::Scriberr => 26,
            Self::DeepResearch => 27,
            Self::DeerFlow => 28,
            Self::VibeTrading => 29,
            Self::StockAnalyst => 30,
            Self::SolidworksMcp => 31,
        }
    }
}

/// The only launch values that may be minted after the checked-in manifest is
/// validated. They are resolved by the runtime from its private bootstrap and
/// service allocation state, never supplied by an HTTP/Electron caller.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceRuntimeValue {
    ServicePort,
}

/// A manifest may request one closed, variable-length argument expansion. The
/// values themselves are never present in the manifest or accepted by a
/// generic service route; Runtime resolves them from its durable typed policy.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceRuntimeArgumentList {
    RecallCapture,
}

/// One fixed argv item. App paths remain relative to the immutable app root;
/// runtime substitutions use the closed vocabulary above. There is no raw
/// placeholder or caller-provided argument variant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ServiceLaunchArgument {
    Literal {
        value: String,
    },
    AppPath {
        path: String,
    },
    /// A fixed path beneath the runtime's pinned mutable data root. The
    /// manifest carries only a validated relative suffix; callers cannot
    /// supply or widen it.
    DataPath {
        path: String,
    },
    RuntimeValue {
        value: ServiceRuntimeValue,
    },
    RuntimeArguments {
        value: ServiceRuntimeArgumentList,
    },
}

impl ServiceLaunchArgument {
    fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::Literal { value } => {
                validate_bounded_text("service launch literal", value, MAX_SERVICE_ARGUMENT_BYTES)?;
                // Substitution-looking text is reserved. Values that vary per
                // launch must use the typed RuntimeValue variant instead.
                if value.chars().any(char::is_control)
                    || value.contains("${")
                    || value.contains("{{")
                    || value.contains("}}")
                {
                    return Err(ValidationError::InvalidIdentifier {
                        field: "service launch literal",
                    });
                }
                Ok(())
            }
            Self::AppPath { path } => validate_relative_path("service argv app path", path),
            Self::DataPath { path } => validate_relative_path("service argv data path", path),
            Self::RuntimeValue { .. } => Ok(()),
            Self::RuntimeArguments { .. } => Ok(()),
        }
    }
}

/// A service launch may work from one manifest-selected directory beneath the
/// immutable app root or the pinned mutable data root. Hot development may
/// additionally select a manifest-declared isolated data workspace when the
/// trusted bootstrap has separated its data and application roots (as Electron
/// QA does). The path remains closed manifest policy; request payloads cannot
/// select or override it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ServiceWorkingDirectoryPolicy {
    AppRoot,
    AppSubdirectory {
        path: String,
    },
    DataSubdirectory {
        path: String,
    },
    HotDevelopmentWorkspace {
        app_path: String,
        isolated_data_path: String,
    },
}

impl ServiceWorkingDirectoryPolicy {
    fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::AppRoot => Ok(()),
            Self::AppSubdirectory { path } | Self::DataSubdirectory { path } => {
                validate_relative_path("service working directory", path)
            }
            Self::HotDevelopmentWorkspace {
                app_path,
                isolated_data_path,
            } => {
                validate_relative_path("service hot workspace app path", app_path)?;
                validate_relative_path(
                    "service hot workspace isolated data path",
                    isolated_data_path,
                )
            }
        }
    }

    fn is_hot_development_workspace(&self) -> bool {
        matches!(self, Self::HotDevelopmentWorkspace { .. })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceInstallProbeAuthority {
    RuntimeRoot,
    AppRoot,
    DataRoot,
}

/// The executable itself may come only from immutable runtime resources or a
/// fixed, setup-produced path beneath the pinned mutable data root. Application
/// source remains an argv entrypoint behind a trusted interpreter.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceExecutableAuthority {
    RuntimeRoot,
    DataRoot,
}

impl ServiceExecutableAuthority {
    const fn install_probe_authority(self) -> ServiceInstallProbeAuthority {
        match self {
            Self::RuntimeRoot => ServiceInstallProbeAuthority::RuntimeRoot,
            Self::DataRoot => ServiceInstallProbeAuthority::DataRoot,
        }
    }
}

/// A regular file whose presence must be proven beneath one fixed immutable
/// authority root before a launch can be considered installed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceInstallProbeFile {
    pub authority: ServiceInstallProbeAuthority,
    pub path: String,
}

impl ServiceInstallProbeFile {
    fn validate(&self) -> Result<(), ValidationError> {
        validate_relative_path("service install probe path", &self.path)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ServiceInstallProbe {
    FilesPresent { files: Vec<ServiceInstallProbeFile> },
}

impl ServiceInstallProbe {
    pub fn files(&self) -> &[ServiceInstallProbeFile] {
        match self {
            Self::FilesPresent { files } => files,
        }
    }

    fn validate(&self) -> Result<(), ValidationError> {
        let files = self.files();
        if files.is_empty() || files.len() > MAX_SERVICE_INSTALL_PROBE_FILES {
            return Err(ValidationError::InvalidRange {
                field: "service install probe files",
            });
        }
        let mut unique = HashSet::with_capacity(files.len());
        for file in files {
            file.validate()?;
            if !unique.insert((file.authority, file.path.as_str())) {
                return Err(ValidationError::DuplicateId {
                    kind: "service install probe file",
                    id: file.path.clone(),
                });
            }
        }
        Ok(())
    }

    fn contains(&self, authority: ServiceInstallProbeAuthority, path: &str) -> bool {
        self.files()
            .iter()
            .any(|file| file.authority == authority && file.path == path)
    }
}

/// Commit admission and containment bounds for one concrete launch mode. Hot
/// development can therefore carry its measured compiler-tree limits without
/// weakening lean or packaged launches.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceResourceLimits {
    pub estimated_cold_start_commit_mb: u64,
    pub soft_commit_limit_mb: u64,
    pub hard_commit_limit_mb: u64,
}

impl ServiceResourceLimits {
    fn validate(&self) -> Result<(), ValidationError> {
        if self.estimated_cold_start_commit_mb == 0
            || self.estimated_cold_start_commit_mb > MAX_COMMIT_LIMIT_MB
            || self.soft_commit_limit_mb > MAX_COMMIT_LIMIT_MB
            || self.hard_commit_limit_mb > MAX_COMMIT_LIMIT_MB
        {
            return Err(ValidationError::InvalidRange {
                field: "service profile resource limits",
            });
        }
        if self.hard_commit_limit_mb > 0 && self.soft_commit_limit_mb >= self.hard_commit_limit_mb {
            return Err(ValidationError::InvalidRange {
                field: "service profile commit limits",
            });
        }
        if self.estimated_cold_start_commit_mb >= self.hard_commit_limit_mb {
            return Err(ValidationError::InvalidRange {
                field: "service profile cold-start estimate",
            });
        }
        Ok(())
    }
}

/// One fixed launch recipe may cover one or more runtime modes. Overlapping
/// recipes are rejected by ServiceDefinition, so mode selection is exact.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceLaunchProfile {
    pub modes: Vec<RuntimeMode>,
    pub executable_authority: ServiceExecutableAuthority,
    pub allowed_executable: String,
    pub arguments: Vec<ServiceLaunchArgument>,
    pub environment_source: TrustedServiceEnvironmentSource,
    pub working_directory: ServiceWorkingDirectoryPolicy,
    pub install_probe: ServiceInstallProbe,
    pub resource_limits: ServiceResourceLimits,
}

impl ServiceLaunchProfile {
    fn validate(&self) -> Result<(), ValidationError> {
        if self.modes.is_empty() || self.modes.len() > MAX_SERVICE_LAUNCH_PROFILES {
            return Err(ValidationError::InvalidRange {
                field: "service launch profile modes",
            });
        }
        let mut modes = HashSet::with_capacity(self.modes.len());
        for mode in &self.modes {
            if !modes.insert(*mode) {
                return Err(ValidationError::InvalidRange {
                    field: "duplicate service launch mode",
                });
            }
        }
        validate_relative_path("service profile executable", &self.allowed_executable)?;
        if self.arguments.len() > MAX_SERVICE_LAUNCH_ARGUMENTS {
            return Err(ValidationError::InvalidRange {
                field: "service launch arguments",
            });
        }
        for argument in &self.arguments {
            argument.validate()?;
        }
        self.working_directory.validate()?;
        if self.working_directory.is_hot_development_workspace()
            && (self.modes.len() != 1 || self.modes[0] != RuntimeMode::Hot)
        {
            return Err(ValidationError::InvalidRange {
                field: "service hot workspace mode",
            });
        }
        self.install_probe.validate()?;
        self.resource_limits.validate()?;
        if !self.install_probe.contains(
            self.executable_authority.install_probe_authority(),
            &self.allowed_executable,
        ) {
            return Err(ValidationError::InvalidIdentifier {
                field: "service executable install probe",
            });
        }
        for argument in &self.arguments {
            if let ServiceLaunchArgument::AppPath { path } = argument {
                if !self
                    .install_probe
                    .contains(ServiceInstallProbeAuthority::AppRoot, path)
                {
                    return Err(ValidationError::InvalidIdentifier {
                        field: "service argv app-path install probe",
                    });
                }
            }
        }
        Ok(())
    }

    pub fn applies_to(&self, mode: RuntimeMode) -> bool {
        self.modes.contains(&mode)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceHttpReadiness {
    pub path: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub expected_body_contains: Option<String>,
    pub request_timeout_ms: u64,
    pub poll_interval_ms: u64,
    pub startup_timeout_ms: u64,
}

impl ServiceHttpReadiness {
    fn validate(&self) -> Result<(), ValidationError> {
        validate_bounded_text("service readiness path", &self.path, MAX_LOOPBACK_URL_BYTES)?;
        if !self.path.starts_with('/')
            || self.path.starts_with("//")
            || self.path.contains('?')
            || self.path.contains('#')
            || self.path.chars().any(char::is_control)
        {
            return Err(ValidationError::InvalidIdentifier {
                field: "service readiness path",
            });
        }
        if let Some(expected) = &self.expected_body_contains {
            validate_bounded_text(
                "service readiness body match",
                expected,
                MAX_SERVICE_READINESS_MATCH_BYTES,
            )?;
            if expected.chars().any(char::is_control) {
                return Err(ValidationError::InvalidIdentifier {
                    field: "service readiness body match",
                });
            }
        }
        if self.request_timeout_ms == 0
            || self.request_timeout_ms > MAX_TIMEOUT_MS
            || self.poll_interval_ms == 0
            || self.poll_interval_ms > MAX_TIMEOUT_MS
            || self.startup_timeout_ms == 0
            || self.startup_timeout_ms > MAX_TIMEOUT_MS
            || self.request_timeout_ms > self.startup_timeout_ms
            || self.poll_interval_ms > self.startup_timeout_ms
        {
            return Err(ValidationError::InvalidRange {
                field: "service readiness timeouts",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceRestartBounds {
    pub maximum_restarts: u32,
    pub window_ms: u64,
    pub initial_backoff_ms: u64,
    pub maximum_backoff_ms: u64,
}

impl ServiceRestartBounds {
    fn validate(&self) -> Result<(), ValidationError> {
        if self.maximum_restarts == 0
            || self.maximum_restarts > MAX_SERVICE_RESTARTS
            || self.window_ms == 0
            || self.window_ms > MAX_TIMEOUT_MS
            || self.initial_backoff_ms == 0
            || self.initial_backoff_ms > MAX_TIMEOUT_MS
            || self.maximum_backoff_ms == 0
            || self.maximum_backoff_ms > MAX_TIMEOUT_MS
            || self.initial_backoff_ms > self.maximum_backoff_ms
            || self.maximum_backoff_ms > self.window_ms
        {
            return Err(ValidationError::InvalidRange {
                field: "service restart bounds",
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceDefinition {
    pub id: String,
    pub display_name: String,
    pub capability_ids: Vec<String>,
    pub requirement: ServiceRequirement,
    pub launch_profiles: Vec<ServiceLaunchProfile>,
    pub readiness: ServiceHttpReadiness,
    pub startup_policy: ServiceStartupPolicy,
    pub resource_class: ResourceClass,
    pub dependencies: Vec<String>,
    pub maximum_concurrent_leases: u32,
    pub maximum_lease_ms: u64,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub idle_ttl_ms: Option<u64>,
    pub graceful_shutdown_ms: u64,
    pub restart_policy: RestartPolicy,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub restart_bounds: Option<ServiceRestartBounds>,
}

impl ServiceDefinition {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("service id", &self.id)?;
        validate_bounded_text("displayName", &self.display_name, MAX_STAGE_BYTES)?;
        if self.display_name.trim().is_empty() || self.display_name.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "displayName",
            });
        }
        if self.capability_ids.is_empty() {
            return Err(ValidationError::EmptyField {
                field: "capabilityIds",
            });
        }
        if self.capability_ids.len() > MAX_CAPABILITIES_PER_DEFINITION {
            return Err(ValidationError::InvalidRange {
                field: "capabilityIds",
            });
        }
        validate_unique_capability_ids("capabilityId", &self.capability_ids)?;
        if self.launch_profiles.is_empty()
            || self.launch_profiles.len() > MAX_SERVICE_LAUNCH_PROFILES
        {
            return Err(ValidationError::InvalidRange {
                field: "service launch profiles",
            });
        }
        let mut launch_modes = HashSet::with_capacity(MAX_SERVICE_LAUNCH_PROFILES);
        for profile in &self.launch_profiles {
            profile.validate()?;
            for argument in &profile.arguments {
                if matches!(
                    argument,
                    ServiceLaunchArgument::RuntimeArguments {
                        value: ServiceRuntimeArgumentList::RecallCapture
                    }
                ) && (self.id != "recall"
                    || profile.environment_source != TrustedServiceEnvironmentSource::Recall)
                {
                    return Err(ValidationError::InvalidIdentifier {
                        field: "service runtime arguments",
                    });
                }
            }
            for mode in &profile.modes {
                if !launch_modes.insert(*mode) {
                    return Err(ValidationError::InvalidRange {
                        field: "overlapping service launch mode",
                    });
                }
            }
        }
        if launch_modes.len() != MAX_SERVICE_LAUNCH_PROFILES {
            return Err(ValidationError::InvalidRange {
                field: "service launch mode coverage",
            });
        }
        self.readiness.validate()?;
        if self.dependencies.len() > MAX_DEPENDENCIES_PER_SERVICE {
            return Err(ValidationError::InvalidRange {
                field: "service dependencies",
            });
        }
        validate_unique_identifiers("dependency", &self.dependencies)?;
        if self.maximum_concurrent_leases == 0
            || self.maximum_concurrent_leases > MAX_CONCURRENCY
            || self.maximum_lease_ms == 0
            || self.maximum_lease_ms > MAX_TIMEOUT_MS
            || self.graceful_shutdown_ms == 0
            || self.graceful_shutdown_ms > MAX_TIMEOUT_MS
        {
            return Err(ValidationError::InvalidRange {
                field: "service limits",
            });
        }
        if matches!(
            self.startup_policy,
            ServiceStartupPolicy::OnDemand | ServiceStartupPolicy::Scheduled
        ) {
            match self.idle_ttl_ms {
                Some(value) if value > 0 && value <= MAX_TIMEOUT_MS => {}
                Some(_) => return Err(ValidationError::InvalidRange { field: "idleTtlMs" }),
                None => return Err(ValidationError::EmptyField { field: "idleTtlMs" }),
            }
        } else if self.idle_ttl_ms.is_some() {
            return Err(ValidationError::InvalidRange { field: "idleTtlMs" });
        }
        if self
            .idle_ttl_ms
            .is_some_and(|idle_ttl_ms| idle_ttl_ms > self.maximum_lease_ms)
        {
            return Err(ValidationError::InvalidRange {
                field: "service lease/idle bounds",
            });
        }
        match (self.restart_policy, &self.restart_bounds) {
            (RestartPolicy::Never, None) => {}
            (RestartPolicy::OnFailure, Some(bounds)) => bounds.validate()?,
            (RestartPolicy::Never, Some(_)) | (RestartPolicy::OnFailure, None) => {
                return Err(ValidationError::InvalidRange {
                    field: "service restart policy",
                });
            }
        }
        Ok(())
    }

    /// Returns the one non-overlapping checked-in launch recipe for a runtime
    /// mode. The caller can select only a mode established by private bootstrap.
    pub fn launch_profile(&self, mode: RuntimeMode) -> Option<&ServiceLaunchProfile> {
        self.launch_profiles
            .iter()
            .find(|profile| profile.applies_to(mode))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceManifest {
    pub version: u32,
    pub services: Vec<ServiceDefinition>,
}

impl ServiceManifest {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.version != SERVICE_MANIFEST_VERSION {
            return Err(ValidationError::UnsupportedProtocolVersion(self.version));
        }
        if self.services.len() > MAX_MANIFEST_ENTRIES {
            return Err(ValidationError::InvalidRange {
                field: "service count",
            });
        }
        let known: HashSet<&str> = self.services.iter().map(|item| item.id.as_str()).collect();
        if known.len() != self.services.len() {
            let mut seen = HashSet::new();
            let duplicate = self
                .services
                .iter()
                .find(|item| !seen.insert(item.id.as_str()))
                .expect("length mismatch guarantees duplicate");
            return Err(ValidationError::DuplicateId {
                kind: "service",
                id: duplicate.id.clone(),
            });
        }
        for service in &self.services {
            service.validate()?;
            for dependency in &service.dependencies {
                if !known.contains(dependency.as_str()) {
                    return Err(ValidationError::InvalidIdentifier {
                        field: "unknown service dependency",
                    });
                }
                if dependency == &service.id {
                    return Err(ValidationError::InvalidIdentifier {
                        field: "self service dependency",
                    });
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkerEvent {
    Ready {
        identity: WorkerIdentity,
        sequence: u64,
        protocol_version: u32,
    },
    Heartbeat {
        identity: WorkerIdentity,
        sequence: u64,
        stage: String,
    },
    Progress {
        identity: WorkerIdentity,
        sequence: u64,
        stage: String,
        current: u64,
        total: u64,
    },
    Checkpoint {
        identity: WorkerIdentity,
        sequence: u64,
        kind: String,
        path: String,
    },
    Artifact {
        identity: WorkerIdentity,
        sequence: u64,
        kind: String,
        path: String,
    },
    Complete {
        identity: WorkerIdentity,
        sequence: u64,
        result_path: String,
    },
    Failed {
        identity: WorkerIdentity,
        sequence: u64,
        code: String,
        message: String,
    },
    CancellationAcknowledged {
        identity: WorkerIdentity,
        sequence: u64,
    },
}

impl WorkerEvent {
    pub fn identity(&self) -> &WorkerIdentity {
        match self {
            Self::Ready { identity, .. }
            | Self::Heartbeat { identity, .. }
            | Self::Progress { identity, .. }
            | Self::Checkpoint { identity, .. }
            | Self::Artifact { identity, .. }
            | Self::Complete { identity, .. }
            | Self::Failed { identity, .. }
            | Self::CancellationAcknowledged { identity, .. } => identity,
        }
    }

    pub fn sequence(&self) -> u64 {
        match self {
            Self::Ready { sequence, .. }
            | Self::Heartbeat { sequence, .. }
            | Self::Progress { sequence, .. }
            | Self::Checkpoint { sequence, .. }
            | Self::Artifact { sequence, .. }
            | Self::Complete { sequence, .. }
            | Self::Failed { sequence, .. }
            | Self::CancellationAcknowledged { sequence, .. } => *sequence,
        }
    }

    pub fn validate(&self) -> Result<(), ValidationError> {
        self.identity().validate()?;
        if self.sequence() == 0 || self.sequence() > MAX_SQLITE_UNSIGNED {
            return Err(ValidationError::InvalidRange {
                field: "event sequence",
            });
        }
        match self {
            Self::Ready {
                protocol_version, ..
            } if *protocol_version != WIRE_PROTOCOL_VERSION => {
                return Err(ValidationError::UnsupportedProtocolVersion(
                    *protocol_version,
                ));
            }
            Self::Heartbeat { stage, .. } => {
                validate_bounded_text("stage", stage, MAX_STAGE_BYTES)?;
            }
            Self::Progress {
                stage,
                current,
                total,
                ..
            } => {
                validate_bounded_text("stage", stage, MAX_STAGE_BYTES)?;
                if *total == 0
                    || current > total
                    || *current > MAX_SQLITE_UNSIGNED
                    || *total > MAX_SQLITE_UNSIGNED
                {
                    return Err(ValidationError::InvalidRange { field: "progress" });
                }
            }
            Self::Checkpoint { kind, path, .. } | Self::Artifact { kind, path, .. } => {
                validate_identifier("event kind", kind)?;
                validate_relative_path("event path", path)?;
            }
            Self::Complete { result_path, .. } => {
                validate_relative_path("resultPath", result_path)?;
            }
            Self::Failed { code, message, .. } => {
                validate_identifier("failure code", code)?;
                validate_bounded_text("failure message", message, MAX_FAILURE_MESSAGE_BYTES)?;
            }
            _ => {}
        }
        Ok(())
    }
}

pub fn parse_worker_event(line: &[u8]) -> Result<WorkerEvent, ProtocolError> {
    if line.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(ProtocolError::OversizedLine(line.len()));
    }
    let event: WorkerEvent = serde_json::from_slice(line).map_err(ProtocolError::MalformedJson)?;
    event.validate().map_err(ProtocolError::InvalidEvent)?;
    Ok(event)
}

pub fn parse_worker_start_manifest(bytes: &[u8]) -> Result<WorkerStartManifest, ProtocolError> {
    if bytes.len() > MAX_WORKER_START_MANIFEST_BYTES {
        return Err(ProtocolError::OversizedBody(bytes.len()));
    }
    let manifest: WorkerStartManifest =
        serde_json::from_slice(bytes).map_err(ProtocolError::MalformedJson)?;
    manifest.validate().map_err(ProtocolError::InvalidPayload)?;
    Ok(manifest)
}

pub fn parse_worker_manifest(bytes: &[u8]) -> Result<WorkerManifest, ProtocolError> {
    parse_bounded_json(bytes, |manifest: &WorkerManifest| manifest.validate())
}

pub fn parse_service_manifest(bytes: &[u8]) -> Result<ServiceManifest, ProtocolError> {
    parse_bounded_json(bytes, |manifest: &ServiceManifest| manifest.validate())
}

pub fn parse_runtime_bootstrap_message(
    bytes: &[u8],
) -> Result<RuntimeBootstrapMessage, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeBootstrapMessage::validate)
}

pub fn parse_runtime_ready_message(bytes: &[u8]) -> Result<RuntimeReadyMessage, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeReadyMessage::validate)
}

pub fn parse_runtime_status_message(bytes: &[u8]) -> Result<RuntimeStatusMessage, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeStatusMessage::validate)
}

pub fn parse_runtime_command_ack(bytes: &[u8]) -> Result<RuntimeCommandAck, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeCommandAck::validate)
}

pub fn parse_runtime_service_lease_acquire_request(
    bytes: &[u8],
) -> Result<RuntimeServiceLeaseAcquireRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_SERVICE_LEASE_REQUEST_BODY_BYTES,
        RuntimeServiceLeaseAcquireRequest::validate,
    )
}

pub fn parse_runtime_service_lease_acquire_response(
    bytes: &[u8],
) -> Result<RuntimeServiceLeaseAcquireResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeServiceLeaseAcquireResponse::validate)
}

pub fn parse_runtime_service_lease_contract_response(
    bytes: &[u8],
) -> Result<RuntimeServiceLeaseContractResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeServiceLeaseContractResponse::validate)
}

pub fn parse_runtime_service_lease_release_request(
    bytes: &[u8],
) -> Result<RuntimeServiceLeaseReleaseRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_SERVICE_LEASE_REQUEST_BODY_BYTES,
        RuntimeServiceLeaseReleaseRequest::validate,
    )
}

pub fn parse_runtime_service_lease_release_response(
    bytes: &[u8],
) -> Result<RuntimeServiceLeaseReleaseResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeServiceLeaseReleaseResponse::validate)
}

pub fn parse_runtime_desired_state_request(
    bytes: &[u8],
) -> Result<RuntimeDesiredStateRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_SERVICE_LEASE_REQUEST_BODY_BYTES,
        RuntimeDesiredStateRequest::validate,
    )
}

pub fn parse_runtime_recall_reconcile_request(
    bytes: &[u8],
) -> Result<RuntimeRecallReconcileRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_RECALL_RECONCILE_REQUEST_BODY_BYTES,
        RuntimeRecallReconcileRequest::validate,
    )
}

pub fn parse_runtime_recall_status_request(
    bytes: &[u8],
) -> Result<RuntimeRecallStatusRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_SERVICE_LEASE_REQUEST_BODY_BYTES,
        RuntimeRecallStatusRequest::validate,
    )
}

pub fn parse_runtime_job_response(bytes: &[u8]) -> Result<RuntimeJobResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeJobResponse::validate)
}

pub fn parse_runtime_job_idempotency_cancellation_response(
    bytes: &[u8],
) -> Result<RuntimeJobIdempotencyCancellationResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeJobIdempotencyCancellationResponse::validate)
}

pub fn parse_runtime_job_events_response(
    bytes: &[u8],
) -> Result<RuntimeJobEventsResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeJobEventsResponse::validate)
}

pub fn parse_runtime_control_error_response(
    bytes: &[u8],
) -> Result<RuntimeControlErrorResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeControlErrorResponse::validate)
}

/// Rejects an oversized HTTP/IPC body before serde can allocate its object
/// graph. The returned value contains request data only and cannot assert a
/// user or internal principal.
pub fn parse_job_submission_payload(bytes: &[u8]) -> Result<JobSubmissionPayload, ProtocolError> {
    parse_bounded_json(bytes, JobSubmissionPayload::validate)
}

pub fn parse_runtime_job_lookup_request(
    bytes: &[u8],
) -> Result<RuntimeJobLookupRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_JOB_LOOKUP_BODY_BYTES,
        RuntimeJobLookupRequest::validate,
    )
}

pub fn parse_runtime_job_idempotency_cancellation_request(
    bytes: &[u8],
) -> Result<RuntimeJobIdempotencyCancellationRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES,
        RuntimeJobIdempotencyCancellationRequest::validate,
    )
}

pub fn parse_runtime_learn_recovery_request(
    bytes: &[u8],
) -> Result<RuntimeLearnRecoveryRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES,
        RuntimeLearnRecoveryRequest::validate,
    )
}

pub fn parse_runtime_job_input_reservation_request(
    bytes: &[u8],
) -> Result<RuntimeJobInputReservationRequest, ProtocolError> {
    parse_bounded_json_with_limit(
        bytes,
        MAX_JOB_INPUT_RESERVATION_BODY_BYTES,
        RuntimeJobInputReservationRequest::validate,
    )
}

pub fn parse_runtime_job_input_reservation_response(
    bytes: &[u8],
) -> Result<RuntimeJobInputReservationResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeJobInputReservationResponse::validate)
}

fn parse_bounded_json<T>(
    bytes: &[u8],
    validate: impl FnOnce(&T) -> Result<(), ValidationError>,
) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    parse_bounded_json_with_limit(bytes, MAX_REQUEST_BODY_BYTES, validate)
}

fn parse_bounded_json_with_limit<T>(
    bytes: &[u8],
    maximum_body_bytes: usize,
    validate: impl FnOnce(&T) -> Result<(), ValidationError>,
) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    if bytes.len() > maximum_body_bytes {
        return Err(ProtocolError::OversizedBody(bytes.len()));
    }
    let value: T = serde_json::from_slice(bytes).map_err(ProtocolError::MalformedJson)?;
    validate(&value).map_err(ProtocolError::InvalidPayload)?;
    Ok(value)
}

fn parse_bounded_control_json<T>(
    bytes: &[u8],
    validate: impl FnOnce(&T) -> Result<(), ValidationError>,
) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    if bytes.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(ProtocolError::OversizedLine(bytes.len()));
    }
    let value: T = serde_json::from_slice(bytes).map_err(ProtocolError::MalformedJson)?;
    validate(&value).map_err(ProtocolError::InvalidPayload)?;
    Ok(value)
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("protocol line has {0} bytes and exceeds the limit")]
    OversizedLine(usize),
    #[error("protocol body has {0} bytes and exceeds the limit")]
    OversizedBody(usize),
    #[error("malformed protocol JSON: {0}")]
    MalformedJson(serde_json::Error),
    #[error("invalid worker event: {0}")]
    InvalidEvent(ValidationError),
    #[error("invalid protocol payload: {0}")]
    InvalidPayload(ValidationError),
}

pub fn validate_identifier(field: &'static str, value: &str) -> Result<(), ValidationError> {
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ValidationError::InvalidIdentifier { field });
    }
    Ok(())
}

fn validate_unique_identifiers(
    field: &'static str,
    values: &[String],
) -> Result<(), ValidationError> {
    let mut seen = HashSet::with_capacity(values.len());
    for value in values {
        validate_identifier(field, value)?;
        if !seen.insert(value.as_str()) {
            return Err(ValidationError::DuplicateId {
                kind: field,
                id: value.clone(),
            });
        }
    }
    Ok(())
}

fn validate_unique_capability_ids(
    field: &'static str,
    values: &[String],
) -> Result<(), ValidationError> {
    let mut seen = HashSet::with_capacity(values.len());
    for value in values {
        validate_capability_id(field, value)?;
        if !seen.insert(value.as_str()) {
            return Err(ValidationError::DuplicateId {
                kind: field,
                id: value.clone(),
            });
        }
    }
    Ok(())
}

/// Capability IDs are stable, namespaced product identifiers rather than
/// executable names. Preserve the inventory's `family:slug[:slug]` form while
/// rejecting whitespace, paths, empty namespace segments, and control bytes.
pub fn validate_capability_id(field: &'static str, value: &str) -> Result<(), ValidationError> {
    let valid_segment = |segment: &str| {
        segment
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
            && segment
                .as_bytes()
                .last()
                .is_some_and(u8::is_ascii_alphanumeric)
            && segment
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    if value.is_empty()
        || value.len() > MAX_IDENTIFIER_BYTES
        || !value.split(':').all(valid_segment)
    {
        return Err(ValidationError::InvalidIdentifier { field });
    }
    Ok(())
}

pub fn validate_relative_path(field: &'static str, value: &str) -> Result<(), ValidationError> {
    let bytes = value.as_bytes();
    let has_windows_drive_prefix =
        bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    let has_root_prefix = matches!(bytes.first().copied(), Some(b'/') | Some(b'\\'));
    let invalid_component = value.split(['/', '\\']).any(|component| {
        component.is_empty()
            || component == "."
            || component == ".."
            || component.ends_with('.')
            || component.ends_with(' ')
            || is_windows_device_component(component)
    });
    if value.is_empty()
        || value.len() > 4096
        || value.contains('\0')
        || value.contains(':')
        || value.chars().any(char::is_control)
        || has_windows_drive_prefix
        || has_root_prefix
        || invalid_component
    {
        return Err(ValidationError::InvalidRelativePath { field });
    }
    Ok(())
}

fn is_windows_device_component(component: &str) -> bool {
    let stem = component
        .split_once('.')
        .map_or(component, |(value, _)| value)
        .trim_end_matches(['.', ' '])
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || stem.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
}

pub fn validate_bounded_text(
    field: &'static str,
    value: &str,
    maximum_bytes: usize,
) -> Result<(), ValidationError> {
    if value.is_empty() {
        return Err(ValidationError::EmptyField { field });
    }
    if value.len() > maximum_bytes {
        return Err(ValidationError::OversizedField { field });
    }
    Ok(())
}

fn validate_job_input_display_name(value: &str) -> Result<(), ValidationError> {
    validate_bounded_text(
        "input display name",
        value,
        MAX_JOB_INPUT_DISPLAY_NAME_BYTES,
    )?;
    if value == "."
        || value == ".."
        || value.contains(['/', '\\', '\0'])
        || value.chars().any(char::is_control)
    {
        return Err(ValidationError::InvalidIdentifier {
            field: "input display name",
        });
    }
    Ok(())
}

fn validate_job_input_media_type(value: &str) -> Result<(), ValidationError> {
    validate_bounded_text("input media type", value, MAX_JOB_INPUT_MEDIA_TYPE_BYTES)?;
    let Some((kind, subtype)) = value.split_once('/') else {
        return Err(ValidationError::InvalidIdentifier {
            field: "input media type",
        });
    };
    let valid_token = |token: &str| {
        !token.is_empty()
            && token.bytes().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(
                        byte,
                        b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
                    )
            })
    };
    if !valid_token(kind) || !valid_token(subtype) {
        return Err(ValidationError::InvalidIdentifier {
            field: "input media type",
        });
    }
    Ok(())
}

pub fn validate_scope_id(field: &'static str, value: &str) -> Result<(), ValidationError> {
    if value.is_empty()
        || value.len() > MAX_SCOPE_ID_BYTES
        || !value.bytes().all(|byte| (b'!'..=b'~').contains(&byte))
    {
        return Err(ValidationError::InvalidIdentifier { field });
    }
    Ok(())
}

fn validate_runtime_control_version(version: u32) -> Result<(), ValidationError> {
    if version != RUNTIME_CONTROL_PROTOCOL_VERSION {
        return Err(ValidationError::UnsupportedProtocolVersion(version));
    }
    Ok(())
}

fn validate_root_text(field: &'static str, value: &str) -> Result<(), ValidationError> {
    validate_bounded_text(field, value, MAX_RUNTIME_ROOT_BYTES)?;
    let bytes = value.as_bytes();
    let windows_drive_root = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    let unc_root = value.starts_with("\\\\") || value.starts_with("//");
    let unix_root = value.starts_with('/');
    if (!windows_drive_root && !unc_root && !unix_root)
        || value.contains('\0')
        || value.chars().any(char::is_control)
    {
        return Err(ValidationError::InvalidIdentifier { field });
    }
    Ok(())
}

fn validate_loopback_http_url(field: &'static str, value: &str) -> Result<(), ValidationError> {
    validate_bounded_text(field, value, MAX_LOOPBACK_URL_BYTES)?;
    let port_and_suffix = value
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| value.strip_prefix("http://[::1]:"));
    let Some(port_and_suffix) = port_and_suffix else {
        return Err(ValidationError::InvalidIdentifier { field });
    };
    let (port, suffix) = port_and_suffix
        .split_once('/')
        .unwrap_or((port_and_suffix, ""));
    let valid_port = port.parse::<u16>().ok().is_some_and(|port| port > 0);
    if !valid_port || !suffix.is_empty() || value.chars().any(char::is_control) {
        return Err(ValidationError::InvalidIdentifier { field });
    }
    Ok(())
}

fn validate_runtime_services(services: &[RuntimeServiceStatus]) -> Result<(), ValidationError> {
    if services.len() > MAX_MANIFEST_ENTRIES {
        return Err(ValidationError::InvalidRange {
            field: "runtime service count",
        });
    }
    let mut ids = HashSet::with_capacity(services.len());
    for service in services {
        service.validate()?;
        if !ids.insert(service.id.as_str()) {
            return Err(ValidationError::DuplicateId {
                kind: "runtime service",
                id: service.id.clone(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> WorkerIdentity {
        WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        }
    }

    fn execution_scope() -> WorkerExecutionScope {
        WorkerExecutionScope::new(
            Some(42),
            Some("garden-1".into()),
            Some("conversation-1".into()),
        )
        .unwrap()
    }

    #[test]
    fn oversized_protocol_is_rejected_before_json_parsing() {
        let line = vec![b' '; MAX_PROTOCOL_LINE_BYTES + 1];
        assert!(matches!(
            parse_worker_event(&line),
            Err(ProtocolError::OversizedLine(_))
        ));
    }

    #[test]
    fn submission_body_is_bounded_and_cannot_assert_ownership() {
        let valid = br#"{
            "jobType":"learn",
            "gardenId":"garden-1",
            "conversationId":null,
            "idempotencyKey":"request-1",
            "requestPayload":{"sourceIds":["source-1"]}
        }"#;
        let parsed = parse_job_submission_payload(valid).unwrap();
        assert_eq!(parsed.job_type, "learn");
        assert_eq!(parsed.garden_id.as_deref(), Some("garden-1"));

        let forged_owner = br#"{
            "jobType":"learn",
            "gardenId":"garden-1",
            "conversationId":null,
            "idempotencyKey":"request-1",
            "requestPayload":{},
            "owner":{"principal":"internal:runtime"}
        }"#;
        assert!(matches!(
            parse_job_submission_payload(forged_owner),
            Err(ProtocolError::MalformedJson(_))
        ));

        let oversized = vec![b' '; MAX_REQUEST_BODY_BYTES + 1];
        assert!(matches!(
            parse_job_submission_payload(&oversized),
            Err(ProtocolError::OversizedBody(_))
        ));
    }

    #[test]
    fn input_reservation_receipts_require_a_positive_bounded_expiry() {
        let valid = br#"{"uploadId":"upload_1","expiresAt":1,"maximumBytes":7}"#;
        assert!(parse_runtime_job_input_reservation_response(valid).is_ok());

        let zero_expiry = br#"{"uploadId":"upload_1","expiresAt":0,"maximumBytes":7}"#;
        assert!(matches!(
            parse_runtime_job_input_reservation_response(zero_expiry),
            Err(ProtocolError::InvalidPayload(_))
        ));
    }

    #[test]
    fn idempotency_lookup_body_is_exact_bounded_and_contains_no_authority() {
        assert_eq!(
            parse_runtime_job_lookup_request(br#"{"idempotencyKey":"request-1"}"#)
                .unwrap()
                .idempotency_key,
            "request-1"
        );
        assert!(
            parse_runtime_job_lookup_request(br#"{"idempotencyKey":"request-1","userId":7}"#)
                .is_err()
        );
        assert!(parse_runtime_job_lookup_request(br#"{"idempotencyKey":"\n"}"#).is_err());
        assert!(matches!(
            parse_runtime_job_lookup_request(&vec![b' '; MAX_JOB_LOOKUP_BODY_BYTES + 1]),
            Err(ProtocolError::OversizedBody(_))
        ));
    }

    #[test]
    fn idempotency_cancellation_is_exact_bounded_and_has_a_closed_disposition() {
        assert_eq!(
            parse_runtime_job_idempotency_cancellation_request(
                br#"{"idempotencyKey":"request-1"}"#
            )
            .unwrap()
            .idempotency_key,
            "request-1"
        );
        assert!(parse_runtime_job_idempotency_cancellation_request(
            br#"{"idempotencyKey":"request-1","gardenId":"forged"}"#
        )
        .is_err());
        assert!(
            parse_runtime_job_idempotency_cancellation_request(br#"{"idempotencyKey":"\n"}"#)
                .is_err()
        );
        assert!(matches!(
            parse_runtime_job_idempotency_cancellation_request(&vec![
                b' ';
                MAX_JOB_IDEMPOTENCY_CANCELLATION_BODY_BYTES
                    + 1
            ]),
            Err(ProtocolError::OversizedBody(_))
        ));

        let pending =
            RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                job_id: None,
                state: RuntimeJobIdempotencyCancellationState::Pending,
                accepted: true,
            };
        pending.validate().unwrap();
        assert_eq!(
            serde_json::to_value(&pending).unwrap(),
            serde_json::json!({
                "type": "runtime-job-idempotency-cancellation",
                "protocolVersion": 1,
                "jobId": null,
                "state": "pending",
                "accepted": true
            })
        );

        let cancelled =
            RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                job_id: Some("job_1".into()),
                state: RuntimeJobIdempotencyCancellationState::Cancelled,
                accepted: true,
            };
        cancelled.validate().unwrap();
        let completed =
            RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                job_id: Some("job_1".into()),
                state: RuntimeJobIdempotencyCancellationState::Succeeded,
                accepted: false,
            };
        completed.validate().unwrap();

        for invalid in [
            RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                job_id: Some("job_1".into()),
                state: RuntimeJobIdempotencyCancellationState::Pending,
                accepted: true,
            },
            RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                job_id: None,
                state: RuntimeJobIdempotencyCancellationState::Cancelled,
                accepted: true,
            },
            RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                job_id: Some("job_1".into()),
                state: RuntimeJobIdempotencyCancellationState::Running,
                accepted: true,
            },
        ] {
            assert!(invalid.validate().is_err());
        }
    }

    #[test]
    fn learn_recovery_request_controls_only_a_bounded_generation_key() {
        let request = parse_runtime_learn_recovery_request(
            br#"{"idempotencyKey":"learn-recovery-v2:123456"}"#,
        )
        .unwrap();
        assert_eq!(request.idempotency_key, "learn-recovery-v2:123456");
        for invalid in [
            br#"{"idempotencyKey":"other:123"}"#.as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:"}"#.as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:abc"}"#.as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:1","jobType":"document-ingestion"}"#
                .as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:1","requestPayload":{}}"#.as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:1","ownerPrincipal":"internal:other"}"#
                .as_slice(),
            br#"{"idempotencyKey":"learn-recovery-v2:1","gardenId":"garden-1"}"#.as_slice(),
        ] {
            assert!(parse_runtime_learn_recovery_request(invalid).is_err());
        }
        assert!(matches!(
            parse_runtime_learn_recovery_request(&vec![
                b' ';
                MAX_LEARN_RECOVERY_REQUEST_BODY_BYTES + 1
            ]),
            Err(ProtocolError::OversizedBody(_))
        ));
    }

    #[test]
    fn service_lease_payloads_are_closed_bounded_and_route_bound() {
        let acquire =
            parse_runtime_service_lease_acquire_request(br#"{"reason":"conversation-turn"}"#)
                .unwrap();
        assert_eq!(acquire.reason, "conversation-turn");
        assert!(parse_runtime_service_lease_acquire_request(
            br#"{"reason":"conversation-turn","serviceId":"hermes"}"#
        )
        .is_err());
        assert!(parse_runtime_service_lease_acquire_request(br#"{"reason":"\n"}"#).is_err());
        assert!(parse_runtime_service_lease_acquire_request(br#"{"reason":"   "}"#).is_err());
        let oversized_reason = serde_json::to_vec(&serde_json::json!({
            "reason": "r".repeat(MAX_SERVICE_LEASE_REASON_BYTES + 1)
        }))
        .unwrap();
        assert!(matches!(
            parse_runtime_service_lease_acquire_request(&oversized_reason),
            Err(ProtocolError::InvalidPayload(
                ValidationError::OversizedField {
                    field: "service lease reason"
                }
            ))
        ));
        assert!(matches!(
            parse_runtime_service_lease_acquire_request(&vec![
                b' ';
                MAX_SERVICE_LEASE_REQUEST_BODY_BYTES
                    + 1
            ]),
            Err(ProtocolError::OversizedBody(_))
        ));

        let release = parse_runtime_service_lease_release_request(br#"{}"#).unwrap();
        release.validate().unwrap();
        assert!(
            parse_runtime_service_lease_release_request(br#"{"afterOwnerPidExit":42}"#).is_err()
        );

        let acquired = RuntimeServiceLeaseAcquireResponse {
            ok: true,
            lease_id: "01234567-89ab-cdef-0123-456789abcdef".into(),
            service_id: "hermes".into(),
        };
        acquired.validate().unwrap();
        let acquired_bytes = serde_json::to_vec(&acquired).unwrap();
        assert_eq!(
            parse_runtime_service_lease_acquire_response(&acquired_bytes).unwrap(),
            acquired
        );
        assert!(parse_runtime_service_lease_acquire_response(
            br#"{"ok":true,"leaseId":"lease_1","serviceId":"hermes","token":"secret"}"#
        )
        .is_err());
        assert!(parse_runtime_service_lease_acquire_response(
            br#"{"ok":false,"leaseId":"lease_1","serviceId":"hermes"}"#
        )
        .is_err());
        let contract = RuntimeServiceLeaseContractResponse {
            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
            service_id: "voicebox".into(),
            acquire_timeout_ms: 1_800_000
                + SERVICE_LEASE_SETTLEMENT_GRACE_MS
                + SERVICE_LEASE_RESPONSE_GRACE_MS,
        };
        contract.validate().unwrap();
        let contract_bytes = serde_json::to_vec(&contract).unwrap();
        assert_eq!(
            parse_runtime_service_lease_contract_response(&contract_bytes).unwrap(),
            contract
        );
        assert!(parse_runtime_service_lease_contract_response(
            br#"{"protocolVersion":1,"serviceId":"voicebox","acquireTimeoutMs":1810000,"startupTimeoutMs":1800000}"#
        )
        .is_err());
        assert!(RuntimeServiceLeaseContractResponse {
            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
            service_id: "voicebox".into(),
            acquire_timeout_ms: MAX_SERVICE_LEASE_ACQUIRE_TIMEOUT_MS + 1,
        }
        .validate()
        .is_err());
        let released = RuntimeServiceLeaseReleaseResponse {
            ok: true,
            released: false,
        };
        released.validate().unwrap();
        let released_bytes = serde_json::to_vec(&released).unwrap();
        assert_eq!(
            parse_runtime_service_lease_release_response(&released_bytes).unwrap(),
            released
        );
        assert!(
            parse_runtime_service_lease_release_response(br#"{"ok":false,"released":false}"#)
                .is_err()
        );
    }

    #[test]
    fn submission_scope_and_idempotency_fields_are_validated() {
        let invalid_job_type = br#"{
            "jobType":"../learn",
            "gardenId":null,
            "conversationId":null,
            "idempotencyKey":"request-1",
            "requestPayload":{}
        }"#;
        assert!(matches!(
            parse_job_submission_payload(invalid_job_type),
            Err(ProtocolError::InvalidPayload(_))
        ));

        let empty_key = br#"{
            "jobType":"learn",
            "gardenId":null,
            "conversationId":null,
            "idempotencyKey":"",
            "requestPayload":{}
        }"#;
        assert!(matches!(
            parse_job_submission_payload(empty_key),
            Err(ProtocolError::InvalidPayload(_))
        ));
    }

    #[test]
    fn worker_start_manifest_is_closed_fenced_and_exactly_job_scoped() {
        let manifest =
            WorkerStartManifest::for_identity_and_scope(identity(), execution_scope()).unwrap();
        assert_eq!(manifest.protocol_version, WIRE_PROTOCOL_VERSION);
        assert_eq!(manifest.execution_scope, execution_scope());
        assert_eq!(
            manifest.input_manifest_path,
            "runtime/jobs/job_1/input.json"
        );
        assert!(manifest.input_blobs.is_empty());
        assert_eq!(
            manifest.workspace_path,
            "runtime/jobs/job_1/attempts/1/worker_1/workspace"
        );
        assert_eq!(
            manifest.checkpoint_path,
            "runtime/jobs/job_1/checkpoint.json"
        );
        assert_eq!(manifest.result_path, "runtime/jobs/job_1/result.json");

        let encoded = serde_json::to_vec(&manifest).unwrap();
        assert!(encoded.len() <= MAX_WORKER_START_MANIFEST_BYTES);
        assert_eq!(parse_worker_start_manifest(&encoded).unwrap(), manifest);

        let fields = serde_json::to_value(&manifest)
            .unwrap()
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<HashSet<_>>();
        assert_eq!(
            fields,
            [
                "protocolVersion",
                "identity",
                "executionScope",
                "inputManifestPath",
                "inputBlobs",
                "workspacePath",
                "checkpointPath",
                "resultPath",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect()
        );

        let mut wrong_job = manifest.clone();
        wrong_job.result_path = "runtime/jobs/job_2/result.json".into();
        assert!(matches!(
            wrong_job.validate(),
            Err(ValidationError::InvalidRelativePath {
                field: "resultPath"
            })
        ));

        let mut wrong_attempt = manifest.clone();
        wrong_attempt.workspace_path = "runtime/jobs/job_1/attempts/2/worker_1/workspace".into();
        assert!(matches!(
            wrong_attempt.validate(),
            Err(ValidationError::InvalidRelativePath {
                field: "workspacePath"
            })
        ));
    }

    #[test]
    fn worker_execution_scope_requires_closed_nullable_safe_fields() {
        let manifest =
            WorkerStartManifest::for_identity_and_scope(identity(), execution_scope()).unwrap();
        let encoded = serde_json::to_value(&manifest).unwrap();
        assert_eq!(
            encoded.get("executionScope"),
            Some(&serde_json::json!({
                "userId": 42,
                "gardenId": "garden-1",
                "conversationId": "conversation-1",
            }))
        );

        let mut missing_nullable = encoded.clone();
        missing_nullable["executionScope"]
            .as_object_mut()
            .unwrap()
            .remove("conversationId");
        assert!(matches!(
            parse_worker_start_manifest(&serde_json::to_vec(&missing_nullable).unwrap()),
            Err(ProtocolError::MalformedJson(_))
        ));

        let mut forged_principal = encoded.clone();
        forged_principal["executionScope"]
            .as_object_mut()
            .unwrap()
            .insert("ownerPrincipal".into(), serde_json::json!("user:999"));
        assert!(matches!(
            parse_worker_start_manifest(&serde_json::to_vec(&forged_principal).unwrap()),
            Err(ProtocolError::MalformedJson(_))
        ));

        for invalid_user_id in [0, -1, MAX_JSON_SAFE_INTEGER as i64 + 1] {
            let mut invalid = encoded.clone();
            invalid["executionScope"]["userId"] = serde_json::json!(invalid_user_id);
            assert!(matches!(
                parse_worker_start_manifest(&serde_json::to_vec(&invalid).unwrap()),
                Err(ProtocolError::InvalidPayload(
                    ValidationError::InvalidRange { field: "userId" }
                ))
            ));
        }

        let unscoped = WorkerStartManifest::for_identity(identity()).unwrap();
        assert_eq!(
            serde_json::to_value(unscoped).unwrap()["executionScope"],
            serde_json::json!({
                "userId": null,
                "gardenId": null,
                "conversationId": null,
            })
        );
    }

    #[test]
    fn worker_start_manifest_cannot_carry_payload_secrets_or_argv() {
        let manifest = WorkerStartManifest::for_identity(identity()).unwrap();
        for (field, value) in [
            ("requestPayload", serde_json::json!({"prompt": "private"})),
            ("controlToken", serde_json::json!("private-token")),
            ("ownerPrincipal", serde_json::json!("user:42")),
            (
                "argv",
                serde_json::json!(["--arbitrary", "large-or-untrusted-value"]),
            ),
            ("environment", serde_json::json!({"SECRET": "private"})),
        ] {
            let mut encoded = serde_json::to_value(&manifest).unwrap();
            encoded.as_object_mut().unwrap().insert(field.into(), value);
            let encoded = serde_json::to_vec(&encoded).unwrap();
            assert!(matches!(
                parse_worker_start_manifest(&encoded),
                Err(ProtocolError::MalformedJson(_))
            ));
        }

        let oversized = vec![b' '; MAX_WORKER_START_MANIFEST_BYTES + 1];
        assert!(matches!(
            parse_worker_start_manifest(&oversized),
            Err(ProtocolError::OversizedBody(_))
        ));
    }

    #[test]
    fn every_worker_event_carries_a_valid_fence() {
        let line = serde_json::to_vec(&WorkerEvent::Heartbeat {
            identity: identity(),
            sequence: 1,
            stage: "generate".into(),
        })
        .unwrap();
        assert_eq!(parse_worker_event(&line).unwrap().identity(), &identity());

        let missing_attempt = br#"{"type":"heartbeat","identity":{"jobId":"job_1","attempt":0,"workerInstanceId":"worker_1"},"sequence":1,"stage":"generate"}"#;
        assert!(matches!(
            parse_worker_event(missing_attempt),
            Err(ProtocolError::InvalidEvent(_))
        ));

        let ready = br#"{
            "type":"ready",
            "identity":{"jobId":"job_1","attempt":1,"workerInstanceId":"worker_1"},
            "sequence":1,
            "protocolVersion":1
        }"#;
        assert!(matches!(
            parse_worker_event(ready),
            Ok(WorkerEvent::Ready { .. })
        ));
    }

    #[test]
    fn private_runtime_bootstrap_has_no_process_launch_authority() {
        let valid = br#"{
            "type":"runtime-bootstrap",
            "protocolVersion":1,
            "mode":"lean",
            "appRoot":"C:\\Breadboard\\resources\\app-services",
            "runtimeRoot":"C:\\Breadboard\\resources",
            "dataRoot":"C:\\Breadboard\\data",
            "configRoot":"C:\\Breadboard\\config"
        }"#;
        assert!(parse_runtime_bootstrap_message(valid).is_ok());

        let arbitrary_command = br#"{
            "type":"runtime-bootstrap",
            "protocolVersion":1,
            "mode":"lean",
            "appRoot":"C:\\Breadboard\\resources\\app-services",
            "runtimeRoot":"C:\\Breadboard\\resources",
            "dataRoot":"C:\\Breadboard\\data",
            "configRoot":"C:\\Breadboard\\config",
            "command":"cmd.exe"
        }"#;
        assert!(matches!(
            parse_runtime_bootstrap_message(arbitrary_command),
            Err(ProtocolError::MalformedJson(_))
        ));

        let missing_runtime_root = br#"{
            "type":"runtime-bootstrap",
            "protocolVersion":1,
            "mode":"lean",
            "appRoot":"C:\\Breadboard\\resources\\app-services",
            "dataRoot":"C:\\Breadboard\\data",
            "configRoot":"C:\\Breadboard\\config"
        }"#;
        assert!(matches!(
            parse_runtime_bootstrap_message(missing_runtime_root),
            Err(ProtocolError::MalformedJson(_))
        ));

        let oversized = vec![b' '; MAX_PROTOCOL_LINE_BYTES + 1];
        assert!(matches!(
            parse_runtime_bootstrap_message(&oversized),
            Err(ProtocolError::OversizedLine(_))
        ));
    }

    #[test]
    fn runtime_ready_requires_loopback_control_and_sanitized_status() {
        let valid = br#"{
            "type":"runtime-ready",
            "protocolVersion":1,
            "runtimePid":42,
            "controlBaseUrl":"http://127.0.0.1:43120",
            "controlToken":"0123456789abcdef0123456789abcdef",
            "dashboardUrl":"http://127.0.0.1:3210",
            "services":[{
                "id":"dashboard",
                "displayName":"Workspace",
                "required":true,
                "startupPolicy":"eager",
                "state":"ready",
                "lastError":null,
                "restarts":0,
                "adopted":false
            }]
        }"#;
        assert!(parse_runtime_ready_message(valid).is_ok());

        let remote_control = valid
            .windows(b"http://127.0.0.1:43120".len())
            .position(|window| window == b"http://127.0.0.1:43120")
            .expect("fixture contains control URL");
        let mut invalid = valid.to_vec();
        invalid.splice(
            remote_control..remote_control + b"http://127.0.0.1:43120".len(),
            b"https://example.invalid:43120".iter().copied(),
        );
        assert!(matches!(
            parse_runtime_ready_message(&invalid),
            Err(ProtocolError::InvalidPayload(_))
        ));
    }

    #[test]
    fn runtime_service_status_requires_explicit_nullable_last_error() {
        let explicit_null = br#"{
            "type":"runtime-status",
            "protocolVersion":1,
            "runtimePid":42,
            "acceptingWork":true,
            "services":[{
                "id":"dashboard",
                "displayName":"Workspace",
                "required":true,
                "startupPolicy":"eager",
                "state":"ready",
                "lastError":null,
                "restarts":0,
                "adopted":false
            }]
        }"#;
        assert!(parse_runtime_status_message(explicit_null).is_ok());

        let omitted = br#"{
            "type":"runtime-status",
            "protocolVersion":1,
            "runtimePid":42,
            "acceptingWork":true,
            "services":[{
                "id":"dashboard",
                "displayName":"Workspace",
                "required":true,
                "startupPolicy":"eager",
                "state":"ready",
                "restarts":0,
                "adopted":false
            }]
        }"#;
        assert!(matches!(
            parse_runtime_status_message(omitted),
            Err(ProtocolError::MalformedJson(_))
        ));
    }

    #[test]
    fn runtime_command_ack_requires_literal_true_and_exact_fields() {
        assert!(parse_runtime_command_ack(br#"{"ok":true}"#).is_ok());
        assert!(matches!(
            parse_runtime_command_ack(br#"{"ok":false}"#),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange { field: "ok" }
            ))
        ));
        assert!(matches!(
            parse_runtime_command_ack(br#"{"ok":true,"extra":false}"#),
            Err(ProtocolError::MalformedJson(_))
        ));
        assert!(matches!(
            parse_runtime_command_ack(br#"{}"#),
            Err(ProtocolError::MalformedJson(_))
        ));
    }

    #[test]
    fn runtime_job_status_is_bounded_sanitized_and_exact() {
        let valid = br#"{
            "type":"runtime-job",
            "protocolVersion":1,
            "job":{
                "jobId":"job_1",
                "jobType":"learn",
                "workerKind":"learn-node",
                "resourceClass":"large-generation",
                "state":"running",
                "stage":"generating",
                "attempt":1,
                "workerInstanceId":"worker_1",
                "gardenId":"garden-1",
                "conversationId":null,
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
        }"#;
        assert!(parse_runtime_job_response(valid).is_ok());

        let leaked_path = String::from_utf8(valid.to_vec()).unwrap().replace(
            "\"cancellationRequested\":false",
            "\"cancellationRequested\":false,\"workspacePath\":\"runtime/jobs/job_1\"",
        );
        assert!(matches!(
            parse_runtime_job_response(leaked_path.as_bytes()),
            Err(ProtocolError::MalformedJson(_))
        ));

        let missing_nullable = String::from_utf8(valid.to_vec())
            .unwrap()
            .replace("\n                \"failureMessage\":null,", "");
        assert!(matches!(
            parse_runtime_job_response(missing_nullable.as_bytes()),
            Err(ProtocolError::MalformedJson(_))
        ));
    }

    #[test]
    fn runtime_event_replay_requires_one_job_and_strict_order() {
        let valid = br#"{
            "type":"runtime-job-events",
            "protocolVersion":1,
            "jobId":"job_1",
            "after":3,
            "nextAfter":5,
            "terminal":false,
            "hasMore":false,
            "events":[
                {"sequence":4,"jobId":"job_1","attempt":1,"workerInstanceId":"worker_1","workerSequence":1,"eventType":"worker-ready","payload":{"state":"running"},"createdAt":101},
                {"sequence":5,"jobId":"job_1","attempt":1,"workerInstanceId":"worker_1","workerSequence":2,"eventType":"worker-progress","payload":{"stage":"working","progressCurrent":1,"progressTotal":2},"createdAt":102}
            ]
        }"#;
        assert!(parse_runtime_job_events_response(valid).is_ok());

        // An unsealed stream may be caught up for this snapshot. Flipping the
        // bit represents the distinct, permanently drained state when there is
        // also no next page.
        let sealed = String::from_utf8(valid.to_vec())
            .unwrap()
            .replace("\"terminal\":false", "\"terminal\":true");
        assert!(parse_runtime_job_events_response(sealed.as_bytes()).is_ok());

        let wrong_job = String::from_utf8(valid.to_vec()).unwrap().replacen(
            "\"jobId\":\"job_1\"",
            "\"jobId\":\"job_2\"",
            1,
        );
        assert!(matches!(
            parse_runtime_job_events_response(wrong_job.as_bytes()),
            Err(ProtocolError::InvalidPayload(_))
        ));

        let wrong_cursor = String::from_utf8(valid.to_vec())
            .unwrap()
            .replace("\"nextAfter\":5", "\"nextAfter\":4");
        assert!(matches!(
            parse_runtime_job_events_response(wrong_cursor.as_bytes()),
            Err(ProtocolError::InvalidPayload(_))
        ));

        let leaked_path = String::from_utf8(valid.to_vec()).unwrap().replacen(
            "\"payload\":{\"state\":\"running\"}",
            "\"payload\":{\"state\":\"running\",\"path\":\"runtime/jobs/job_1/result.json\"}",
            1,
        );
        assert!(matches!(
            parse_runtime_job_events_response(leaked_path.as_bytes()),
            Err(ProtocolError::MalformedJson(_))
        ));
    }

    #[test]
    fn every_public_job_event_has_one_exact_payload_and_fence_shape() {
        use RuntimeJobEventType as Event;

        let event_types = [
            Event::Queued,
            Event::Admitted,
            Event::WorkerAssigned,
            Event::ReservationSettled,
            Event::ReservationReleased,
            Event::CancellationRequested,
            Event::CompletionConfirmed,
            Event::WorkerReady,
            Event::WorkerHeartbeat,
            Event::WorkerProgress,
            Event::WorkerCheckpoint,
            Event::WorkerArtifact,
            Event::WorkerComplete,
            Event::WorkerFailed,
            Event::WorkerCancellationAcknowledged,
            Event::JobStarting,
            Event::JobRunning,
            Event::JobCheckpointing,
            Event::JobCancelling,
            Event::JobCancelled,
            Event::JobSucceeded,
            Event::JobFailed,
            Event::JobResourceExhausted,
            Event::JobInterrupted,
            Event::JobUncertain,
        ];

        for (index, event_type) in event_types.into_iter().enumerate() {
            let payload = match event_type {
                Event::Queued => RuntimeJobEventPayload {
                    state: Some(JobState::Queued),
                    ..RuntimeJobEventPayload::default()
                },
                Event::Admitted => RuntimeJobEventPayload {
                    state: Some(JobState::Admitted),
                    ..RuntimeJobEventPayload::default()
                },
                Event::WorkerAssigned | Event::JobStarting => RuntimeJobEventPayload {
                    state: Some(JobState::Starting),
                    ..RuntimeJobEventPayload::default()
                },
                Event::CancellationRequested
                | Event::WorkerCancellationAcknowledged
                | Event::JobCancelling => RuntimeJobEventPayload {
                    state: Some(JobState::Cancelling),
                    ..RuntimeJobEventPayload::default()
                },
                Event::CompletionConfirmed | Event::JobSucceeded => RuntimeJobEventPayload {
                    state: Some(JobState::Succeeded),
                    ..RuntimeJobEventPayload::default()
                },
                Event::WorkerReady | Event::JobRunning => RuntimeJobEventPayload {
                    state: Some(JobState::Running),
                    ..RuntimeJobEventPayload::default()
                },
                Event::JobCheckpointing => RuntimeJobEventPayload {
                    state: Some(JobState::Checkpointing),
                    ..RuntimeJobEventPayload::default()
                },
                Event::JobCancelled => RuntimeJobEventPayload {
                    state: Some(JobState::Cancelled),
                    ..RuntimeJobEventPayload::default()
                },
                Event::JobFailed => RuntimeJobEventPayload {
                    state: Some(JobState::Failed),
                    ..RuntimeJobEventPayload::default()
                },
                Event::JobResourceExhausted => RuntimeJobEventPayload {
                    state: Some(JobState::ResourceExhausted),
                    ..RuntimeJobEventPayload::default()
                },
                Event::JobInterrupted => RuntimeJobEventPayload {
                    state: Some(JobState::Interrupted),
                    ..RuntimeJobEventPayload::default()
                },
                Event::JobUncertain => RuntimeJobEventPayload {
                    state: Some(JobState::Uncertain),
                    ..RuntimeJobEventPayload::default()
                },
                Event::ReservationSettled | Event::ReservationReleased | Event::WorkerComplete => {
                    RuntimeJobEventPayload::default()
                }
                Event::WorkerHeartbeat => RuntimeJobEventPayload {
                    stage: Some(RuntimePublicStage::Working),
                    ..RuntimeJobEventPayload::default()
                },
                Event::WorkerProgress => RuntimeJobEventPayload {
                    stage: Some(RuntimePublicStage::Generating),
                    progress_current: Some(1),
                    progress_total: Some(2),
                    ..RuntimeJobEventPayload::default()
                },
                Event::WorkerCheckpoint => RuntimeJobEventPayload {
                    artifact_kind: Some(RuntimePublicArtifactKind::Checkpoint),
                    ..RuntimeJobEventPayload::default()
                },
                Event::WorkerArtifact => RuntimeJobEventPayload {
                    artifact_kind: Some(RuntimePublicArtifactKind::Document),
                    ..RuntimeJobEventPayload::default()
                },
                Event::WorkerFailed => RuntimeJobEventPayload {
                    state: Some(JobState::Failed),
                    failure_code: Some(RuntimePublicFailureCode::WorkerFailed),
                    failure_message: Some(SANITIZED_RUNTIME_FAILURE_MESSAGE.into()),
                    ..RuntimeJobEventPayload::default()
                },
            };
            let (attempt, worker_instance_id, worker_sequence) = match event_type.fence_kind() {
                RuntimeJobEventFenceKind::RuntimeZero => (0, None, None),
                RuntimeJobEventFenceKind::RuntimeAttempt
                | RuntimeJobEventFenceKind::RuntimeCurrent => (1, Some("worker_1".into()), None),
                RuntimeJobEventFenceKind::Worker => (1, Some("worker_1".into()), Some(1)),
            };
            let record = RuntimeJobEventRecord {
                sequence: u64::try_from(index + 1).unwrap(),
                job_id: "job_1".into(),
                attempt,
                worker_instance_id,
                worker_sequence,
                event_type,
                payload,
                created_at: 100,
            };
            assert!(record.validate().is_ok(), "{}", event_type.as_str());

            let mut extra_payload = record.clone();
            if matches!(event_type, Event::WorkerHeartbeat | Event::WorkerProgress) {
                extra_payload.payload.state = Some(JobState::Running);
            } else {
                extra_payload.payload.stage = Some(RuntimePublicStage::Working);
            }
            assert!(extra_payload.validate().is_err(), "{}", event_type.as_str());

            let mut wrong_fence = record;
            match event_type.fence_kind() {
                RuntimeJobEventFenceKind::Worker => wrong_fence.worker_sequence = None,
                _ => wrong_fence.worker_sequence = Some(1),
            }
            assert!(wrong_fence.validate().is_err(), "{}", event_type.as_str());
        }

        for current in [Event::ReservationReleased, Event::CancellationRequested] {
            let mut zero_fence = RuntimeJobEventRecord {
                sequence: 1,
                job_id: "job_1".into(),
                attempt: 0,
                worker_instance_id: None,
                worker_sequence: None,
                event_type: current,
                payload: RuntimeJobEventPayload::default(),
                created_at: 100,
            };
            if current == Event::CancellationRequested {
                zero_fence.payload.state = Some(JobState::Cancelling);
            }
            assert!(zero_fence.validate().is_ok());
        }
    }

    #[test]
    fn cancellation_won_worker_observations_cannot_republish_running_or_failed_state() {
        let cancelling = RuntimeJobEventPayload {
            state: Some(JobState::Cancelling),
            ..RuntimeJobEventPayload::default()
        };
        assert!(cancelling
            .validate_for(RuntimeJobEventType::WorkerReady)
            .is_ok());
        assert!(cancelling
            .validate_for(RuntimeJobEventType::WorkerFailed)
            .is_ok());

        let contradictory_failure = RuntimeJobEventPayload {
            state: Some(JobState::Cancelling),
            failure_code: Some(RuntimePublicFailureCode::WorkerFailed),
            failure_message: Some(SANITIZED_RUNTIME_FAILURE_MESSAGE.into()),
            ..RuntimeJobEventPayload::default()
        };
        assert!(contradictory_failure
            .validate_for(RuntimeJobEventType::WorkerFailed)
            .is_err());

        for (sequence, event_type) in [
            (1, RuntimeJobEventType::WorkerReady),
            (2, RuntimeJobEventType::WorkerFailed),
        ] {
            let fixture = RuntimeJobEventRecord {
                sequence,
                job_id: "job_1".into(),
                attempt: 1,
                worker_instance_id: Some("worker_1".into()),
                worker_sequence: Some(sequence),
                event_type,
                payload: cancelling.clone(),
                created_at: 100,
            };
            fixture.validate().unwrap();
            let encoded = serde_json::to_value(&fixture).unwrap();
            assert_eq!(
                encoded["payload"],
                serde_json::json!({"state": "cancelling"})
            );
            let decoded: RuntimeJobEventRecord = serde_json::from_value(encoded).unwrap();
            decoded.validate().unwrap();
        }
    }

    #[test]
    fn public_job_events_reject_private_stage_artifact_and_failure_tokens() {
        let private_stage = br#"{
            "sequence":1,"jobId":"job_1","attempt":1,
            "workerInstanceId":"worker_1","workerSequence":1,
            "eventType":"worker-heartbeat",
            "payload":{"stage":"provider-secret-detail"},"createdAt":100
        }"#;
        let private_artifact = br#"{
            "sequence":1,"jobId":"job_1","attempt":1,
            "workerInstanceId":"worker_1","workerSequence":1,
            "eventType":"worker-artifact",
            "payload":{"artifactKind":"provider-private-kind"},"createdAt":100
        }"#;
        let private_failure = br#"{
            "sequence":1,"jobId":"job_1","attempt":1,
            "workerInstanceId":"worker_1","workerSequence":1,
            "eventType":"worker-failed",
            "payload":{"state":"failed","failureCode":"VENDOR_PRIVATE_FAILURE",
                "failureMessage":"Runtime job execution failed."},"createdAt":100
        }"#;

        for encoded in [
            private_stage.as_slice(),
            private_artifact.as_slice(),
            private_failure.as_slice(),
        ] {
            assert!(serde_json::from_slice::<RuntimeJobEventRecord>(encoded).is_err());
        }

        let private_failure_message = br#"{
            "type":"runtime-job-events","protocolVersion":1,"jobId":"job_1",
            "after":0,"nextAfter":1,"terminal":false,"hasMore":false,
            "events":[{
                "sequence":1,"jobId":"job_1","attempt":1,
                "workerInstanceId":"worker_1","workerSequence":1,
                "eventType":"worker-failed",
                "payload":{"state":"failed","failureCode":"WORKER_FAILED",
                    "failureMessage":"provider account and secret detail"},
                "createdAt":100
            }]
        }"#;
        assert!(matches!(
            parse_runtime_job_events_response(private_failure_message),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "event payload"
                }
            ))
        ));

        let private_artifact_path = br#"{
            "type":"runtime-job-events","protocolVersion":1,"jobId":"job_1",
            "after":0,"nextAfter":1,"terminal":false,"hasMore":false,
            "events":[{
                "sequence":1,"jobId":"job_1","attempt":1,
                "workerInstanceId":"worker_1","workerSequence":1,
                "eventType":"worker-artifact",
                "payload":{"artifactKind":"document",
                    "path":"runtime/jobs/job_1/workspace/private-output.pdf"},
                "createdAt":100
            }]
        }"#;
        assert!(matches!(
            parse_runtime_job_events_response(private_artifact_path),
            Err(ProtocolError::MalformedJson(_))
        ));
    }

    #[test]
    fn runtime_control_errors_keep_headroom_evidence_atomic() {
        let valid = br#"{
            "type":"runtime-error",
            "protocolVersion":1,
            "code":"BREADBOARD_RESOURCE_EXHAUSTED",
            "message":"Windows commit reserve cannot be preserved.",
            "retryable":false,
            "resource":"windows_commit",
            "requiredHeadroomMb":8192,
            "availableHeadroomMb":5632
        }"#;
        assert!(parse_runtime_control_error_response(valid).is_ok());

        let incomplete = String::from_utf8(valid.to_vec())
            .unwrap()
            .replace("\n            \"availableHeadroomMb\":5632", "");
        assert!(matches!(
            parse_runtime_control_error_response(incomplete.as_bytes()),
            Err(ProtocolError::MalformedJson(_))
        ));

        let forged_non_resource = br#"{
            "type":"runtime-error",
            "protocolVersion":1,
            "code":"JOB_NOT_FOUND",
            "message":"The requested job was not found.",
            "retryable":false,
            "resource":"windows_commit",
            "requiredHeadroomMb":8192,
            "availableHeadroomMb":5632
        }"#;
        assert!(matches!(
            parse_runtime_control_error_response(forged_non_resource),
            Err(ProtocolError::InvalidPayload(_))
        ));

        let retry_loop = br#"{
            "type":"runtime-error",
            "protocolVersion":1,
            "code":"RUNTIME_UNAVAILABLE",
            "message":"Runtime job control is unavailable.",
            "retryable":true,
            "resource":null,
            "requiredHeadroomMb":null,
            "availableHeadroomMb":null
        }"#;
        assert!(matches!(
            parse_runtime_control_error_response(retry_loop),
            Err(ProtocolError::InvalidPayload(_))
        ));

        let service_conflict = br#"{
            "type":"runtime-error",
            "protocolVersion":1,
            "code":"SERVICE_LEASE_CONFLICT",
            "message":"The service lease conflicts with durable runtime state.",
            "retryable":false,
            "resource":null,
            "requiredHeadroomMb":null,
            "availableHeadroomMb":null
        }"#;
        assert!(parse_runtime_control_error_response(service_conflict).is_ok());

        let input_quota = br#"{
            "type":"runtime-error",
            "protocolVersion":1,
            "code":"JOB_INPUT_QUOTA_EXCEEDED",
            "message":"The active job input quota is exhausted.",
            "retryable":false,
            "resource":null,
            "requiredHeadroomMb":null,
            "availableHeadroomMb":null
        }"#;
        assert!(parse_runtime_control_error_response(input_quota).is_ok());
    }

    #[test]
    fn runtime_status_rejects_duplicate_or_adopted_service_owners() {
        let duplicate = br#"{
            "type":"runtime-status",
            "protocolVersion":1,
            "runtimePid":42,
            "acceptingWork":true,
            "services":[
                {"id":"dashboard","displayName":"Workspace","required":true,"startupPolicy":"eager","state":"ready","lastError":null,"restarts":0,"adopted":false},
                {"id":"dashboard","displayName":"Workspace","required":true,"startupPolicy":"eager","state":"ready","lastError":null,"restarts":0,"adopted":false}
            ]
        }"#;
        assert!(matches!(
            parse_runtime_status_message(duplicate),
            Err(ProtocolError::InvalidPayload(_))
        ));

        let adopted = br#"{
            "type":"runtime-status",
            "protocolVersion":1,
            "runtimePid":42,
            "acceptingWork":true,
            "services":[
                {"id":"dashboard","displayName":"Workspace","required":true,"startupPolicy":"eager","state":"ready","lastError":null,"restarts":0,"adopted":true}
            ]
        }"#;
        assert!(matches!(
            parse_runtime_status_message(adopted),
            Err(ProtocolError::InvalidPayload(_))
        ));
    }

    #[test]
    fn resource_class_names_are_stable_for_persistence() {
        assert_eq!(ResourceClass::Core.as_str(), "core");
        assert_eq!(ResourceClass::LargeGeneration.as_str(), "large-generation");
        assert_eq!(ResourceClass::DockerStack.as_str(), "docker-stack");
    }

    #[test]
    fn paths_cannot_escape_the_configured_root() {
        assert!(validate_relative_path("path", "jobs/job_1/input.json").is_ok());
        assert!(validate_relative_path("path", "../brain.db").is_err());
        assert!(validate_relative_path("path", "C:\\Windows\\System32\\cmd.exe").is_err());
        assert!(validate_relative_path("path", "\\\\server\\share\\input.json").is_err());
        assert!(validate_relative_path("path", "jobs\\..\\brain.db").is_err());
        assert!(validate_relative_path("path", "jobs/NUL/output.json").is_err());
        assert!(validate_relative_path("path", "jobs/job_1/file.txt:secret").is_err());
    }

    #[test]
    fn progress_bounds_are_enforced() {
        let zero_total = WorkerEvent::Progress {
            identity: identity(),
            sequence: 1,
            stage: "generate".into(),
            current: 0,
            total: 0,
        };
        assert!(matches!(
            zero_total.validate(),
            Err(ValidationError::InvalidRange { field: "progress" })
        ));

        let beyond_total = WorkerEvent::Progress {
            identity: identity(),
            sequence: 1,
            stage: "generate".into(),
            current: 2,
            total: 1,
        };
        assert!(matches!(
            beyond_total.validate(),
            Err(ValidationError::InvalidRange { field: "progress" })
        ));
    }

    #[test]
    fn namespaced_capability_ids_match_the_parity_registry() {
        assert!(validate_capability_id("capabilityId", "runtime-agent:codex").is_ok());
        assert!(validate_capability_id("capabilityId", "model:gpt-5.6-sol").is_ok());
        assert!(validate_capability_id("capabilityId", "persona:agency:backend-architect").is_ok());
        assert!(validate_capability_id("capabilityId", "runtime-agent::codex").is_err());
        assert!(validate_capability_id("capabilityId", "workflow:..").is_err());
        assert!(validate_capability_id("capabilityId", "workflow:../learn").is_err());
    }

    #[test]
    fn recall_policy_is_exact_normalized_and_utf16_bounded() {
        let accepted = parse_runtime_recall_reconcile_request(
            br#"{"desiredState":"running","configuration":{"captureAudio":true,"excludedWindows":["Private Window","Discord"]}}"#,
        )
        .unwrap();
        assert_eq!(
            accepted.configuration.unwrap().excluded_windows,
            ["Private Window", "Discord"]
        );
        assert!(parse_runtime_recall_reconcile_request(br#"{"desiredState":"stopped"}"#).is_ok());
        for invalid in [
            br#"{"desiredState":"running"}"#.as_slice(),
            br#"{"desiredState":"stopped","configuration":{"captureAudio":true,"excludedWindows":[]}}"#.as_slice(),
            br#"{"desiredState":"running","configuration":null}"#.as_slice(),
            br#"{"desiredState":"running","configuration":{"captureAudio":true,"excludedWindows":["Discord","discord"]}}"#.as_slice(),
            br#"{"desiredState":"running","configuration":{"captureAudio":true,"excludedWindows":[" quoted\""]}}"#.as_slice(),
            br#"{"desiredState":"running","configuration":{"captureAudio":true,"excludedWindows":[]},"extra":true}"#.as_slice(),
        ] {
            assert!(parse_runtime_recall_reconcile_request(invalid).is_err());
        }
        let exact_limit = "😀".repeat(MAX_RECALL_EXCLUDED_WINDOW_UTF16_UNITS / 2);
        assert!(RuntimeRecallConfiguration {
            capture_audio: false,
            excluded_windows: vec![exact_limit.clone()],
        }
        .validate()
        .is_ok());
        assert!(RuntimeRecallConfiguration {
            capture_audio: false,
            excluded_windows: vec![format!("{exact_limit}😀")],
        }
        .validate()
        .is_err());
        assert!(parse_runtime_recall_status_request(br#"{}"#).is_ok());
        assert!(parse_runtime_recall_status_request(br#"{"extra":true}"#).is_err());
    }

    #[test]
    fn reusable_finite_workers_are_rejected() {
        let worker = WorkerDefinition {
            kind: "learn".into(),
            job_types: vec!["learn".into()],
            capability_ids: vec!["learn".into()],
            submission_authority: WorkerSubmissionAuthority::User,
            environment_source: TrustedWorkerEnvironmentSource::Minimal,
            service_dependencies: Vec::new(),
            allowed_executable: "runtimes/node/node.exe".into(),
            allowed_entrypoint: "workers/learn-worker.mjs".into(),
            protocol_version: PROTOCOL_VERSION,
            resource_class: ResourceClass::LargeGeneration,
            estimated_cold_start_commit_mb: 1024,
            soft_commit_limit_mb: 4096,
            hard_commit_limit_mb: 6144,
            maximum_concurrency: 1,
            minimum_input_blobs: 0,
            maximum_input_blobs: 0,
            workspace_policy: WorkspacePolicy::PrivatePerJob,
            ready_timeout_ms: 30_000,
            heartbeat_timeout_ms: 60_000,
            graceful_cancellation_ms: 10_000,
            maximum_runtime_ms: 6 * 60 * 60 * 1000,
            exit_after_job: false,
        };
        assert!(matches!(
            worker.validate(),
            Err(ValidationError::ReusableFiniteWorker(_))
        ));
    }

    #[test]
    fn launch_manifests_require_commit_headroom_above_the_cold_start_estimate() {
        let workers = include_bytes!("../../../desktop/runtime-v2/manifests/workers.json");
        let mut worker_manifest: serde_json::Value = serde_json::from_slice(workers).unwrap();
        let worker_hard_limit = worker_manifest["workers"][0]["hardCommitLimitMb"].clone();
        worker_manifest["workers"][0]["estimatedColdStartCommitMb"] = worker_hard_limit;
        assert!(matches!(
            parse_worker_manifest(&serde_json::to_vec(&worker_manifest).unwrap()),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "worker cold-start estimate"
                }
            ))
        ));

        let services = include_bytes!("../../../desktop/runtime-v2/manifests/services.json");
        let mut service_manifest: serde_json::Value = serde_json::from_slice(services).unwrap();
        let service_hard_limit = service_manifest["services"][0]["launchProfiles"][0]
            ["resourceLimits"]["hardCommitLimitMb"]
            .clone();
        service_manifest["services"][0]["launchProfiles"][0]["resourceLimits"]
            ["estimatedColdStartCommitMb"] = service_hard_limit;
        assert!(matches!(
            parse_service_manifest(&serde_json::to_vec(&service_manifest).unwrap()),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "service profile cold-start estimate"
                }
            ))
        ));
    }

    #[test]
    fn checked_in_launch_manifests_match_the_typed_versioned_schema() {
        let workers = include_bytes!("../../../desktop/runtime-v2/manifests/workers.json");
        let services = include_bytes!("../../../desktop/runtime-v2/manifests/services.json");
        let workers = parse_worker_manifest(workers).unwrap();
        let services = parse_service_manifest(services).unwrap();
        assert_eq!(workers.version, WORKER_MANIFEST_VERSION);
        assert_eq!(services.version, SERVICE_MANIFEST_VERSION);
        // Every migrated workload has a distinct finite one-job adapter in the
        // same trusted registry. Keep these assertions explicit so a removed
        // adapter or an unexpected reusable fallback cannot hide behind
        // schema-only validation.
        assert_eq!(
            workers
                .workers
                .iter()
                .map(|worker| worker.kind.as_str())
                .collect::<Vec<_>>(),
            [
                "learn-node",
                "document-ingestion-node",
                "quartz-publish-node",
                "office-artifact-node",
                "agent-browser-node",
                "agent-browser-profile-node",
                "background-task-node",
                "recall-install",
                "audio-analyzer-node",
                "image-search-node",
                "interactive-visualizer-node",
                "managed-setup-node",
                "terminal-command-node",
                "graft-index-node",
                "agent-edits-node",
                "outer-opencode-node",
                "outer-trading-agent-node",
                "outer-career-ops-node",
                "outer-openexecutive-node",
                "system-location-node",
                "claude-account-node",
                "chatmock-login-node",
                "vimax-node",
                "vox-director-node",
                "outer-shorts-node",
                "outer-open-gym-node",
                "agent-reach-setup-node",
                "gbrain-sync-node",
                "thought-topology-node",
                "outer-agent-reach-node",
                "outer-praxist-node",
                "outer-agent-tars-node",
                "outer-legal-node",
                "sf3d-node",
                "outer-codex-node",
                "codex-probe-node",
                "outer-ruflo-node",
                "outer-deep-tutor-node",
                "outer-openplanter-node",
                "manim-node",
                "deep-tutor-probe-node",
                "deep-tutor-index-node",
                "premortem-node",
                "agent-loop-node",
                "omh-node",
                "factcheck-node",
                "watch-media-node",
                "loopx-node",
                "outer-resource2skill-node",
                "career-ops-probe-node",
                "outer-matraix-node",
                "matraix-probe-node",
                "formsmith-node",
                "formsmith-probe-node",
                "outer-hyperframes-node",
                "outer-openmontage-node",
                "openmontage-probe-node",
                "outer-bolt-slides-node",
                "legal-probe-node",
                "shorts-probe-node",
                "tradingagents-probe-node",
                "subsai-transcription-node",
                "subsai-probe-node",
                "speech-media-node",
                "generated-visual-compiler-node",
                "generated-visual-browser-node",
                "scriberr-garden-transcription-node",
                "scriberr-garden-probe-node",
                "watermark-operation-node",
                "outer-hardware-blueprint-node",
                "outer-get-doc-node",
                "get-doc-download-node",
                "outer-meeting-notes-node",
                "outer-inbox-zero-node",
                "outer-socials-manager-node",
                "outer-max-research-node",
                "outer-wardrobe-node",
                "outer-parametric-cad-node",
                "outer-stock-analyst-node",
                "outer-vibe-trading-node",
                "outer-deer-flow-node",
                "outer-money-printer-node",
                "outer-video-use-node",
                "outer-deep-research-node",
                "outer-openscience-node",
                "outer-openwork-node",
                "outer-music-producer-node",
            ]
        );
        let learn = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "learn-node")
            .unwrap();
        assert_eq!(learn.kind, "learn-node");
        assert_eq!(learn.job_types, ["learn"]);
        assert_eq!(
            (learn.minimum_input_blobs, learn.maximum_input_blobs),
            (0, 0)
        );
        assert!(learn.exit_after_job);
        let ingestion = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "document-ingestion-node")
            .unwrap();
        assert_eq!(ingestion.kind, "document-ingestion-node");
        assert_eq!(ingestion.job_types, ["document-ingestion"]);
        assert_eq!(
            (ingestion.minimum_input_blobs, ingestion.maximum_input_blobs),
            (1, 1)
        );
        assert!(ingestion.exit_after_job);
        assert_eq!(
            ingestion.service_dependencies,
            [WorkerServiceDependency {
                service_id: "vlm-ocr".into(),
                condition: WorkerServiceDependencyCondition::DocumentIngestionParseWithVlm,
            }]
        );
        assert_eq!(
            ingestion.environment_source,
            TrustedWorkerEnvironmentSource::DocumentIngestion
        );
        let quartz = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "quartz-publish-node")
            .unwrap();
        assert_eq!(quartz.job_types, ["quartz-publish"]);
        assert_eq!(
            quartz.environment_source,
            TrustedWorkerEnvironmentSource::QuartzPublish
        );
        assert_eq!(
            (quartz.minimum_input_blobs, quartz.maximum_input_blobs),
            (0, 0)
        );
        assert!(quartz.exit_after_job);
        let office = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "office-artifact-node")
            .unwrap();
        assert_eq!(office.job_types, ["office-artifact"]);
        assert_eq!(
            (office.minimum_input_blobs, office.maximum_input_blobs),
            (0, 2)
        );
        assert!(office.exit_after_job);
        let browser = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "agent-browser-node")
            .unwrap();
        assert_eq!(browser.job_types, ["agent-browser-run"]);
        assert_eq!(
            (browser.minimum_input_blobs, browser.maximum_input_blobs),
            (0, 0)
        );
        assert!(browser.exit_after_job);
        let background = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "background-task-node")
            .unwrap();
        assert_eq!(background.job_types, ["background-task"]);
        assert_eq!(
            background.submission_authority,
            WorkerSubmissionAuthority::Runtime
        );
        assert_eq!(
            background.environment_source,
            TrustedWorkerEnvironmentSource::Background
        );
        assert!(background.exit_after_job);
        let recall_install = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "recall-install")
            .unwrap();
        assert_eq!(recall_install.job_types, ["recall-install"]);
        assert_eq!(
            recall_install.submission_authority,
            WorkerSubmissionAuthority::User
        );
        assert_eq!(
            recall_install.environment_source,
            TrustedWorkerEnvironmentSource::Minimal
        );
        assert_eq!(
            (
                recall_install.minimum_input_blobs,
                recall_install.maximum_input_blobs
            ),
            (0, 0)
        );
        assert_eq!(recall_install.maximum_concurrency, 1);
        assert!(recall_install.exit_after_job);
        for (kind, job_type, source, blobs) in [
            (
                "audio-analyzer-node",
                "audio-analysis",
                TrustedWorkerEnvironmentSource::AudioAnalyzer,
                (1, 2),
            ),
            (
                "image-search-node",
                "image-search-google",
                TrustedWorkerEnvironmentSource::ImageSearchGoogle,
                (1, 1),
            ),
            (
                "interactive-visualizer-node",
                "interactive-visualizer",
                TrustedWorkerEnvironmentSource::InteractiveVisualizer,
                (1, 1),
            ),
            (
                "managed-setup-node",
                "managed-setup",
                TrustedWorkerEnvironmentSource::ManagedSetup,
                (0, 0),
            ),
            (
                "terminal-command-node",
                "terminal-command",
                TrustedWorkerEnvironmentSource::Terminal,
                (0, 0),
            ),
            (
                "graft-index-node",
                "graft-index-build",
                TrustedWorkerEnvironmentSource::CodeIndex,
                (0, 0),
            ),
            (
                "agent-edits-node",
                "agent-edits",
                TrustedWorkerEnvironmentSource::AgentEdits,
                (0, 0),
            ),
            (
                "outer-opencode-node",
                "opencode-run",
                TrustedWorkerEnvironmentSource::OuterOpencode,
                (0, 4),
            ),
            (
                "outer-trading-agent-node",
                "trading-agent-run",
                TrustedWorkerEnvironmentSource::TradingAgent,
                (0, 0),
            ),
            (
                "outer-career-ops-node",
                "career-ops-run",
                TrustedWorkerEnvironmentSource::OuterCareerOps,
                (0, 0),
            ),
            (
                "outer-openexecutive-node",
                "openexecutive-run",
                TrustedWorkerEnvironmentSource::OuterOpenExecutive,
                (0, 0),
            ),
            (
                "system-location-node",
                "system-location",
                TrustedWorkerEnvironmentSource::SystemLocation,
                (0, 0),
            ),
            (
                "claude-account-node",
                "claude-account",
                TrustedWorkerEnvironmentSource::ManagedSetup,
                (0, 0),
            ),
            (
                "chatmock-login-node",
                "chatmock-login",
                TrustedWorkerEnvironmentSource::Chatmock,
                (0, 0),
            ),
            (
                "vimax-node",
                "vimax-run",
                TrustedWorkerEnvironmentSource::Vimax,
                (0, 0),
            ),
            (
                "vox-director-node",
                "vox-director-run",
                TrustedWorkerEnvironmentSource::VoxDirector,
                (0, 0),
            ),
            (
                "outer-shorts-node",
                "shorts-run",
                TrustedWorkerEnvironmentSource::OuterShorts,
                (0, 0),
            ),
            (
                "outer-open-gym-node",
                "open-gym-run",
                TrustedWorkerEnvironmentSource::OuterOpenGym,
                (0, 0),
            ),
            (
                "agent-reach-setup-node",
                "agent-reach-setup",
                TrustedWorkerEnvironmentSource::AgentReachSetup,
                (0, 1),
            ),
            (
                "gbrain-sync-node",
                "gbrain-sync",
                TrustedWorkerEnvironmentSource::GbrainSync,
                (0, 0),
            ),
            (
                "outer-agent-reach-node",
                "agent-reach-run",
                TrustedWorkerEnvironmentSource::OuterAgentReach,
                (0, 0),
            ),
            (
                "outer-praxist-node",
                "praxist-run",
                TrustedWorkerEnvironmentSource::OuterAgentReach,
                (0, 0),
            ),
            (
                "outer-agent-tars-node",
                "agent-tars-run",
                TrustedWorkerEnvironmentSource::AgentTars,
                (0, 0),
            ),
            (
                "outer-legal-node",
                "legal-run",
                TrustedWorkerEnvironmentSource::OuterLegal,
                (1, 11),
            ),
            (
                "sf3d-node",
                "sf3d-reconstruct",
                TrustedWorkerEnvironmentSource::Sf3d,
                (1, 1),
            ),
            (
                "outer-codex-node",
                "codex-run",
                TrustedWorkerEnvironmentSource::OuterCodex,
                (0, 4),
            ),
            (
                "codex-probe-node",
                "codex-probe",
                TrustedWorkerEnvironmentSource::OuterCodex,
                (0, 0),
            ),
            (
                "outer-ruflo-node",
                "ruflo-run",
                TrustedWorkerEnvironmentSource::OuterRuflo,
                (0, 4),
            ),
            (
                "outer-deep-tutor-node",
                "deep-tutor-run",
                TrustedWorkerEnvironmentSource::OuterDeepTutor,
                (0, 0),
            ),
            (
                "outer-openplanter-node",
                "openplanter-run",
                TrustedWorkerEnvironmentSource::OuterOpenPlanter,
                (0, 0),
            ),
            (
                "manim-node",
                "manim-render",
                TrustedWorkerEnvironmentSource::Manim,
                (0, 0),
            ),
            (
                "deep-tutor-probe-node",
                "deep-tutor-probe",
                TrustedWorkerEnvironmentSource::DeepTutorMaintenance,
                (0, 0),
            ),
            (
                "deep-tutor-index-node",
                "deep-tutor-index",
                TrustedWorkerEnvironmentSource::DeepTutorMaintenance,
                (0, 0),
            ),
            (
                "premortem-node",
                "premortem-command",
                TrustedWorkerEnvironmentSource::Premortem,
                (0, 0),
            ),
            (
                "agent-loop-node",
                "agent-loop-command",
                TrustedWorkerEnvironmentSource::AgentLoop,
                (0, 0),
            ),
            (
                "omh-node",
                "omh-command",
                TrustedWorkerEnvironmentSource::Omh,
                (0, 0),
            ),
            (
                "factcheck-node",
                "factcheck-command",
                TrustedWorkerEnvironmentSource::Factcheck,
                (0, 0),
            ),
            (
                "watch-media-node",
                "watch-run",
                TrustedWorkerEnvironmentSource::WatchMedia,
                (0, 1),
            ),
            (
                "loopx-node",
                "loopx-tick",
                TrustedWorkerEnvironmentSource::Loopx,
                (0, 0),
            ),
            (
                "outer-resource2skill-node",
                "resource2skill-run",
                TrustedWorkerEnvironmentSource::Resource2Skill,
                (0, 0),
            ),
            (
                "career-ops-probe-node",
                "career-ops-probe",
                TrustedWorkerEnvironmentSource::OuterCareerOps,
                (0, 0),
            ),
            (
                "outer-matraix-node",
                "matraix-run",
                TrustedWorkerEnvironmentSource::OuterMatraix,
                (0, 0),
            ),
            (
                "matraix-probe-node",
                "matraix-probe",
                TrustedWorkerEnvironmentSource::OuterMatraix,
                (0, 0),
            ),
            (
                "formsmith-node",
                "formsmith",
                TrustedWorkerEnvironmentSource::Formsmith,
                (1, 1),
            ),
            (
                "formsmith-probe-node",
                "formsmith-probe",
                TrustedWorkerEnvironmentSource::Formsmith,
                (0, 0),
            ),
            (
                "outer-hyperframes-node",
                "hyperframes-run",
                TrustedWorkerEnvironmentSource::Hyperframes,
                (0, 0),
            ),
            (
                "outer-openmontage-node",
                "openmontage-run",
                TrustedWorkerEnvironmentSource::OpenMontage,
                (0, 0),
            ),
            (
                "openmontage-probe-node",
                "openmontage-probe",
                TrustedWorkerEnvironmentSource::OpenMontage,
                (0, 0),
            ),
            (
                "outer-bolt-slides-node",
                "bolt-slides-run",
                TrustedWorkerEnvironmentSource::OuterBoltSlides,
                (0, 0),
            ),
            (
                "legal-probe-node",
                "legal-probe",
                TrustedWorkerEnvironmentSource::OuterLegal,
                (0, 0),
            ),
            (
                "shorts-probe-node",
                "shorts-probe",
                TrustedWorkerEnvironmentSource::OuterShorts,
                (0, 0),
            ),
            (
                "tradingagents-probe-node",
                "tradingagents-probe",
                TrustedWorkerEnvironmentSource::TradingAgent,
                (0, 0),
            ),
            (
                "subsai-transcription-node",
                "subsai-transcription",
                TrustedWorkerEnvironmentSource::Subsai,
                (1, 1),
            ),
            (
                "subsai-probe-node",
                "subsai-probe",
                TrustedWorkerEnvironmentSource::Subsai,
                (0, 0),
            ),
            (
                "speech-media-node",
                "speech-media",
                TrustedWorkerEnvironmentSource::SpeechMedia,
                (0, 1),
            ),
            (
                "agent-browser-profile-node",
                "agent-browser-profile",
                TrustedWorkerEnvironmentSource::AgentBrowserProfile,
                (0, 0),
            ),
            (
                "generated-visual-browser-node",
                "generated-visual-browser",
                TrustedWorkerEnvironmentSource::GeneratedVisualBrowser,
                (1, 1),
            ),
            (
                "scriberr-garden-transcription-node",
                "scriberr-garden-transcription",
                TrustedWorkerEnvironmentSource::ScriberrGarden,
                (0, 1),
            ),
            (
                "watermark-operation-node",
                "watermark-operation",
                TrustedWorkerEnvironmentSource::Watermark,
                (1, 1),
            ),
            (
                "outer-hardware-blueprint-node",
                "hardware-blueprint-run",
                TrustedWorkerEnvironmentSource::OuterHardwareBlueprint,
                (0, 0),
            ),
            (
                "outer-get-doc-node",
                "get-doc-run",
                TrustedWorkerEnvironmentSource::GetDoc,
                (0, 0),
            ),
            (
                "get-doc-download-node",
                "get-doc-download",
                TrustedWorkerEnvironmentSource::GetDocDownload,
                (0, 0),
            ),
            (
                "outer-meeting-notes-node",
                "meeting-notes-run",
                TrustedWorkerEnvironmentSource::MeetingNotes,
                (1, 1),
            ),
            (
                "outer-inbox-zero-node",
                "inbox-zero-run",
                TrustedWorkerEnvironmentSource::OuterInboxZero,
                (0, 0),
            ),
            (
                "outer-socials-manager-node",
                "socials-manager-run",
                TrustedWorkerEnvironmentSource::OuterSocialsManager,
                (0, 0),
            ),
            (
                "outer-max-research-node",
                "max-research-run",
                TrustedWorkerEnvironmentSource::OuterMaxResearch,
                (0, 0),
            ),
            (
                "outer-video-use-node",
                "video-use-run",
                TrustedWorkerEnvironmentSource::OuterVideoUse,
                (0, 0),
            ),
            (
                "outer-openwork-node",
                "openwork-run",
                TrustedWorkerEnvironmentSource::OuterOpenwork,
                (0, 0),
            ),
        ] {
            let worker = workers
                .workers
                .iter()
                .find(|worker| worker.kind == kind)
                .unwrap();
            assert_eq!(worker.job_types, [job_type]);
            assert_eq!(worker.environment_source, source);
            assert_eq!(
                (worker.minimum_input_blobs, worker.maximum_input_blobs),
                blobs
            );
            assert!(worker.exit_after_job);
        }
        let speech_media = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "speech-media-node")
            .unwrap();
        assert_eq!(speech_media.resource_class, ResourceClass::MediaProcessing);
        assert_eq!(
            (
                speech_media.estimated_cold_start_commit_mb,
                speech_media.soft_commit_limit_mb,
                speech_media.hard_commit_limit_mb,
            ),
            (2_048, 4_096, 6_144)
        );
        assert_eq!(speech_media.maximum_runtime_ms, 7_320_000);
        assert_eq!(speech_media.graceful_cancellation_ms, 60_000);
        assert!(speech_media.service_dependencies.is_empty());
        let gbrain_sync = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "gbrain-sync-node")
            .unwrap();
        assert_eq!(
            gbrain_sync.service_dependencies,
            [WorkerServiceDependency {
                service_id: "gbrain".into(),
                condition: WorkerServiceDependencyCondition::GbrainSyncAlways,
            }]
        );
        let scriberr_garden = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "scriberr-garden-transcription-node")
            .unwrap();
        assert_eq!(
            scriberr_garden.service_dependencies,
            [WorkerServiceDependency {
                service_id: "scriberr".into(),
                condition: WorkerServiceDependencyCondition::ScriberrGardenTranscriptionAlways,
            }]
        );
        let scriberr_probe = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "scriberr-garden-probe-node")
            .unwrap();
        assert_eq!(
            scriberr_probe.job_types,
            ["scriberr-garden-health", "scriberr-garden-inspect-youtube"]
        );
        assert_eq!(
            scriberr_probe.environment_source,
            TrustedWorkerEnvironmentSource::ScriberrGarden
        );
        assert_eq!(
            (
                scriberr_probe.minimum_input_blobs,
                scriberr_probe.maximum_input_blobs
            ),
            (0, 0)
        );
        assert!(scriberr_probe.service_dependencies.is_empty());
        assert!(scriberr_probe.exit_after_job);
        for kind in [
            "outer-hyperframes-node",
            "outer-openmontage-node",
            "outer-bolt-slides-node",
            "outer-hardware-blueprint-node",
            "outer-get-doc-node",
        ] {
            let worker = workers
                .workers
                .iter()
                .find(|worker| worker.kind == kind)
                .unwrap();
            assert_eq!(
                worker.service_dependencies,
                [WorkerServiceDependency {
                    service_id: "chatmock".into(),
                    condition: WorkerServiceDependencyCondition::Always,
                }]
            );
        }
        let meeting_notes = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "outer-meeting-notes-node")
            .unwrap();
        assert_eq!(
            meeting_notes.service_dependencies,
            [
                WorkerServiceDependency {
                    service_id: "scriberr".into(),
                    condition: WorkerServiceDependencyCondition::MeetingNotesEngineScriberr,
                },
                WorkerServiceDependency {
                    service_id: "voicebox".into(),
                    condition: WorkerServiceDependencyCondition::MeetingNotesEngineVoicebox,
                },
                WorkerServiceDependency {
                    service_id: "chatmock".into(),
                    condition: WorkerServiceDependencyCondition::MeetingNotesNeedsChatmock,
                },
            ]
        );
        let inbox_zero = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "outer-inbox-zero-node")
            .unwrap();
        assert_eq!(
            inbox_zero.service_dependencies,
            [WorkerServiceDependency {
                service_id: "inbox-zero-stack".into(),
                condition: WorkerServiceDependencyCondition::Always,
            }]
        );
        let agent_tars = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "outer-agent-tars-node")
            .unwrap();
        assert_eq!(agent_tars.resource_class, ResourceClass::Core);
        assert_eq!(agent_tars.maximum_runtime_ms, 1_920_000);
        assert_eq!(agent_tars.graceful_cancellation_ms, 60_000);
        assert_eq!(
            agent_tars.service_dependencies,
            [WorkerServiceDependency {
                service_id: "ui-tars".into(),
                condition: WorkerServiceDependencyCondition::Always,
            }]
        );
        let openwork = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "outer-openwork-node")
            .unwrap();
        assert_eq!(openwork.resource_class, ResourceClass::Core);
        assert_eq!(openwork.maximum_runtime_ms, 21_600_000);
        assert_eq!(openwork.graceful_cancellation_ms, 60_000);
        assert_eq!(
            openwork.service_dependencies,
            [WorkerServiceDependency {
                service_id: "openwork".into(),
                condition: WorkerServiceDependencyCondition::Always,
            }]
        );
        let socials_manager = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "outer-socials-manager-node")
            .unwrap();
        assert_eq!(
            socials_manager.service_dependencies,
            [
                WorkerServiceDependency {
                    service_id: "postiz-coordinator".into(),
                    condition: WorkerServiceDependencyCondition::Always,
                },
                WorkerServiceDependency {
                    service_id: "chatmock".into(),
                    condition: WorkerServiceDependencyCondition::Always,
                },
            ]
        );
        let max_research = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "outer-max-research-node")
            .unwrap();
        assert_eq!(
            max_research.service_dependencies,
            [
                WorkerServiceDependency {
                    service_id: "chatmock".into(),
                    condition: WorkerServiceDependencyCondition::Always,
                },
                WorkerServiceDependency {
                    service_id: "deep-research".into(),
                    condition: WorkerServiceDependencyCondition::Always,
                },
                WorkerServiceDependency {
                    service_id: "openscience".into(),
                    condition: WorkerServiceDependencyCondition::MaxResearchOpenscienceEnabled,
                },
            ]
        );
        let video_use = workers
            .workers
            .iter()
            .find(|worker| worker.kind == "outer-video-use-node")
            .unwrap();
        assert_eq!(video_use.resource_class, ResourceClass::Core);
        assert_eq!(video_use.graceful_cancellation_ms, 120_000);
        assert_eq!(video_use.maximum_runtime_ms, 43_200_000);
        assert_eq!(
            video_use.service_dependencies,
            [
                WorkerServiceDependency {
                    service_id: "chatmock".into(),
                    condition: WorkerServiceDependencyCondition::Always,
                },
                WorkerServiceDependency {
                    service_id: "scriberr".into(),
                    condition: WorkerServiceDependencyCondition::Always,
                },
            ]
        );
        assert_eq!(
            services
                .services
                .iter()
                .map(|service| service.id.as_str())
                .collect::<Vec<_>>(),
            [
                "chatmock",
                "dashboard",
                "hermes",
                "gbrain",
                "comfyui",
                "telegram-gateway",
                "whatsapp-gateway",
                "openwork",
                "openscience",
                "money-printer",
                "wardrobe",
                "penecho",
                "vlm-ocr",
                "recall",
                "mem0-semantic-engine",
                "local-mcp-broker",
                "postiz-coordinator",
                "inbox-zero-stack",
                "spotify-playback",
                "cliproxy",
                "quartz",
                "ui-tars",
                "cad",
                "solidworks-mcp",
                "colpali",
                "humanizer",
                "voicebox",
                "scriberr",
                "deep-research",
                "deer-flow",
                "vibe-trading",
                "stock-analyst",
                "acestep",
            ]
        );
        for service in &services.services {
            for mode in [RuntimeMode::Lean, RuntimeMode::Hot, RuntimeMode::Packaged] {
                assert_eq!(
                    service
                        .launch_profiles
                        .iter()
                        .filter(|profile| profile.applies_to(mode))
                        .count(),
                    1,
                    "{} must have exactly one {mode:?} launch profile",
                    service.id
                );
                assert!(!service
                    .launch_profile(mode)
                    .unwrap()
                    .allowed_executable
                    .is_empty());
            }
        }

        let dashboard = services
            .services
            .iter()
            .find(|service| service.id == "dashboard")
            .unwrap();
        let hermes = services
            .services
            .iter()
            .find(|service| service.id == "hermes")
            .unwrap();
        let gbrain = services
            .services
            .iter()
            .find(|service| service.id == "gbrain")
            .unwrap();
        let comfyui = services
            .services
            .iter()
            .find(|service| service.id == "comfyui")
            .unwrap();
        let ui_tars = services
            .services
            .iter()
            .find(|service| service.id == "ui-tars")
            .unwrap();
        assert!(
            services
                .services
                .iter()
                .all(|service| service.requirement.is_required()),
            "every checked-in service must remain a mandatory product capability"
        );
        assert_eq!(
            services
                .services
                .iter()
                .filter(|service| service.startup_policy == ServiceStartupPolicy::Eager)
                .map(|service| service.id.as_str())
                .collect::<Vec<_>>(),
            ["chatmock", "dashboard"],
            "mandatory on-demand and scheduled services must not become eager"
        );
        assert_eq!(ui_tars.maximum_lease_ms, 2_100_000);
        assert_ne!(
            dashboard
                .launch_profile(RuntimeMode::Lean)
                .unwrap()
                .arguments,
            dashboard
                .launch_profile(RuntimeMode::Hot)
                .unwrap()
                .arguments
        );
        let lean_dashboard = dashboard.launch_profile(RuntimeMode::Lean).unwrap();
        let hot_dashboard = dashboard.launch_profile(RuntimeMode::Hot).unwrap();
        let packaged_dashboard = dashboard.launch_profile(RuntimeMode::Packaged).unwrap();
        assert_eq!(
            hot_dashboard.resource_limits,
            ServiceResourceLimits {
                estimated_cold_start_commit_mb: 3_072,
                soft_commit_limit_mb: 9_216,
                hard_commit_limit_mb: 11_264,
            }
        );
        assert_eq!(
            hot_dashboard.working_directory,
            ServiceWorkingDirectoryPolicy::AppSubdirectory {
                path: "dashboard".into(),
            }
        );
        assert!(lean_dashboard.install_probe.contains(
            ServiceInstallProbeAuthority::AppRoot,
            "dashboard/.next-desktop/standalone/server.js",
        ));
        assert!(packaged_dashboard.install_probe.contains(
            ServiceInstallProbeAuthority::AppRoot,
            "dashboard-standalone/dashboard/server.js",
        ));
        for service_id in ["cad", "colpali", "humanizer"] {
            let service = services
                .services
                .iter()
                .find(|service| service.id == service_id)
                .unwrap();
            let receipt = format!("{service_id}-service/runtime-artifact.json");
            assert_eq!(service.launch_profiles.len(), 2);
            assert!(!service
                .launch_profile(RuntimeMode::Hot)
                .unwrap()
                .install_probe
                .contains(ServiceInstallProbeAuthority::AppRoot, &receipt));
            assert!(service
                .launch_profile(RuntimeMode::Packaged)
                .unwrap()
                .install_probe
                .contains(ServiceInstallProbeAuthority::AppRoot, &receipt));
        }
        assert_eq!(hermes.startup_policy, ServiceStartupPolicy::OnDemand);
        assert_eq!(hermes.idle_ttl_ms, Some(600_000));
        assert_eq!(gbrain.startup_policy, ServiceStartupPolicy::OnDemand);
        assert_eq!(gbrain.dependencies, ["chatmock"]);
        assert_eq!(gbrain.idle_ttl_ms, Some(600_000));
        assert_eq!(gbrain.maximum_concurrent_leases, 32);
        assert_eq!(gbrain.maximum_lease_ms, 1_800_000);
        assert_eq!(gbrain.readiness.path, "/ready");
        assert_eq!(
            gbrain.readiness.expected_body_contains.as_deref(),
            Some("\"backend\":\"gbrain\"")
        );
        assert_eq!(gbrain.launch_profiles.len(), 1);
        let gbrain_profile = gbrain.launch_profile(RuntimeMode::Packaged).unwrap();
        assert_eq!(
            gbrain_profile.executable_authority,
            ServiceExecutableAuthority::RuntimeRoot
        );
        assert_eq!(gbrain_profile.allowed_executable, "runtimes/node/node.exe");
        assert_eq!(
            gbrain_profile.arguments,
            vec![
                ServiceLaunchArgument::Literal {
                    value: "--no-warnings".into(),
                },
                ServiceLaunchArgument::Literal {
                    value: "--experimental-transform-types".into(),
                },
                ServiceLaunchArgument::AppPath {
                    path: "gbrain-adapter/src/node-entrypoint.mjs".into(),
                },
            ]
        );
        assert_eq!(
            gbrain_profile.environment_source,
            TrustedServiceEnvironmentSource::Gbrain
        );
        assert_eq!(
            gbrain_profile.working_directory,
            ServiceWorkingDirectoryPolicy::AppSubdirectory {
                path: "gbrain-adapter".into(),
            }
        );
        assert!(gbrain_profile.install_probe.contains(
            ServiceInstallProbeAuthority::RuntimeRoot,
            "runtimes/node/node.exe",
        ));
        for app_path in [
            "gbrain-adapter/src/node-entrypoint.mjs",
            "gbrain-adapter/src/node-loader.mjs",
            "gbrain-adapter/src/node-server.ts",
            "gbrain-adapter/src/request-handler.ts",
            "gbrain/src/core/engine-factory.ts",
            "gbrain-adapter/node_modules/@electric-sql/pglite/package.json",
            "gbrain/node_modules/@electric-sql/pglite/package.json",
            "gbrain/node_modules/js-yaml/package.json",
            "gbrain/node_modules/@dqbd/tiktoken/package.json",
            "gbrain/node_modules/web-tree-sitter/package.json",
            "gbrain/runtime-artifact.json",
        ] {
            assert!(gbrain_profile
                .install_probe
                .contains(ServiceInstallProbeAuthority::AppRoot, app_path));
        }
        assert_eq!(comfyui.startup_policy, ServiceStartupPolicy::OnDemand);
        assert_eq!(comfyui.idle_ttl_ms, Some(600_000));
        assert_eq!(comfyui.maximum_concurrent_leases, 4);
        assert_eq!(comfyui.maximum_lease_ms, 900_000);
        let comfyui_profile = comfyui.launch_profile(RuntimeMode::Packaged).unwrap();
        assert_eq!(
            comfyui_profile.environment_source,
            TrustedServiceEnvironmentSource::Comfyui
        );
        assert_eq!(
            comfyui_profile.executable_authority,
            ServiceExecutableAuthority::RuntimeRoot
        );
        assert!(comfyui_profile.install_probe.contains(
            ServiceInstallProbeAuthority::RuntimeRoot,
            "runtimes/comfyui-python/python.exe",
        ));
        assert!(comfyui_profile.install_probe.contains(
            ServiceInstallProbeAuthority::RuntimeRoot,
            "runtimes/comfyui-python/runtime-artifact.json",
        ));
        for marker in [
            "runtime-artifact.json",
            "pylock.packaged.toml",
            "main.py",
            "folder_paths.py",
            "server.py",
        ] {
            assert!(comfyui_profile.install_probe.contains(
                ServiceInstallProbeAuthority::AppRoot,
                &format!("comfyui/{marker}"),
            ));
        }
        assert!(comfyui_profile
            .arguments
            .contains(&ServiceLaunchArgument::AppPath {
                path: "comfyui/main.py".into(),
            }));
        assert!(comfyui_profile
            .arguments
            .contains(&ServiceLaunchArgument::DataPath {
                path: "comfyui".into(),
            }));
        assert_eq!(
            comfyui_profile.working_directory,
            ServiceWorkingDirectoryPolicy::AppSubdirectory {
                path: "comfyui".into(),
            }
        );
    }

    #[test]
    fn service_manifest_denies_untyped_launch_authority() {
        let source = include_bytes!("../../../desktop/runtime-v2/manifests/services.json");
        for (path, field, value) in [
            (
                vec!["services", "0"],
                "command",
                serde_json::json!("cmd.exe"),
            ),
            (
                vec!["services", "0", "launchProfiles", "0"],
                "environment",
                serde_json::json!({"SECRET": "caller-value"}),
            ),
            (
                vec!["services", "0", "launchProfiles", "0"],
                "shell",
                serde_json::json!(true),
            ),
        ] {
            let mut manifest: serde_json::Value = serde_json::from_slice(source).unwrap();
            let mut target = &mut manifest;
            for component in path {
                target = if let Ok(index) = component.parse::<usize>() {
                    target.get_mut(index).unwrap()
                } else {
                    target.get_mut(component).unwrap()
                };
            }
            target.as_object_mut().unwrap().insert(field.into(), value);
            assert!(matches!(
                parse_service_manifest(&serde_json::to_vec(&manifest).unwrap()),
                Err(ProtocolError::MalformedJson(_))
            ));
        }

        let mut manifest: serde_json::Value = serde_json::from_slice(source).unwrap();
        manifest["services"][0]["launchProfiles"][0]["arguments"][3]["value"] =
            serde_json::json!("caller-port");
        assert!(matches!(
            parse_service_manifest(&serde_json::to_vec(&manifest).unwrap()),
            Err(ProtocolError::MalformedJson(_))
        ));
    }

    #[test]
    fn service_manifest_rejects_launch_gaps_placeholders_and_unbounded_policy() {
        let source = include_bytes!("../../../desktop/runtime-v2/manifests/services.json");
        let invalid_manifest = |mutate: fn(&mut serde_json::Value)| {
            let mut manifest: serde_json::Value = serde_json::from_slice(source).unwrap();
            mutate(&mut manifest);
            parse_service_manifest(&serde_json::to_vec(&manifest).unwrap())
        };

        assert!(matches!(
            invalid_manifest(|manifest| manifest["version"] = serde_json::json!(1)),
            Err(ProtocolError::InvalidPayload(
                ValidationError::UnsupportedProtocolVersion(1)
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][2]["launchProfiles"][0]["modes"] =
                    serde_json::json!(["lean", "hot"]);
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "service launch mode coverage"
                }
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][0]["launchProfiles"][0]["modes"] =
                    serde_json::json!(["lean", "lean", "packaged"]);
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "duplicate service launch mode"
                }
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][0]["launchProfiles"][0]["arguments"][1]["value"] =
                    serde_json::json!("${caller-argument}");
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidIdentifier {
                    field: "service launch literal"
                }
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][2]["maximumLeaseMs"] = serde_json::json!(0);
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "service limits"
                }
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][2]["restartBounds"]["maximumRestarts"] = serde_json::json!(0);
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "service restart bounds"
                }
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][1]["launchProfiles"][2]["resourceLimits"]
                    ["hardCommitLimitMb"] = serde_json::json!(6_000);
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "service profile commit limits"
                }
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][1]["launchProfiles"][2]["workingDirectory"]["path"] =
                    serde_json::json!("../dashboard");
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRelativePath {
                    field: "service working directory"
                }
            ))
        ));
        assert!(matches!(
            invalid_manifest(|manifest| {
                manifest["services"][1]["launchProfiles"][0]["workingDirectory"] = serde_json::json!({
                    "kind": "hot-development-workspace",
                    "appPath": "dashboard",
                    "isolatedDataPath": "dashboard-workspace"
                });
            }),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidRange {
                    field: "service hot workspace mode"
                }
            ))
        ));
    }

    #[test]
    fn service_manifest_requires_nullable_policy_fields_and_install_proofs() {
        let source = include_bytes!("../../../desktop/runtime-v2/manifests/services.json");
        for field in ["idleTtlMs", "restartBounds"] {
            let mut manifest: serde_json::Value = serde_json::from_slice(source).unwrap();
            manifest["services"][0]
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(matches!(
                parse_service_manifest(&serde_json::to_vec(&manifest).unwrap()),
                Err(ProtocolError::MalformedJson(_))
            ));
        }

        let mut manifest: serde_json::Value = serde_json::from_slice(source).unwrap();
        manifest["services"][0]["readiness"]
            .as_object_mut()
            .unwrap()
            .remove("expectedBodyContains");
        assert!(matches!(
            parse_service_manifest(&serde_json::to_vec(&manifest).unwrap()),
            Err(ProtocolError::MalformedJson(_))
        ));

        let mut manifest: serde_json::Value = serde_json::from_slice(source).unwrap();
        manifest["services"][0]["launchProfiles"][0]["installProbe"]["files"] = serde_json::json!([{
            "authority": "app-root",
            "path": "chatmock/chatmock.py"
        }]);
        assert!(matches!(
            parse_service_manifest(&serde_json::to_vec(&manifest).unwrap()),
            Err(ProtocolError::InvalidPayload(
                ValidationError::InvalidIdentifier {
                    field: "service executable install probe"
                }
            ))
        ));
    }
}
