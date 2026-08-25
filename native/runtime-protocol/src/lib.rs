use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;

pub const WIRE_PROTOCOL_VERSION: u32 = 1;
pub const RUNTIME_CONTROL_PROTOCOL_VERSION: u32 = 1;
pub const WORKER_MANIFEST_VERSION: u32 = 1;
pub const SERVICE_MANIFEST_VERSION: u32 = 1;
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
pub const MAX_CONCURRENCY: u32 = 64;
pub const MAX_COMMIT_LIMIT_MB: u64 = 1024 * 1024;
pub const MAX_TIMEOUT_MS: u64 = 7 * 24 * 60 * 60 * 1000;
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
}

impl RuntimePublicFailureCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::RuntimeJobFailed => "RUNTIME_JOB_FAILED",
            Self::WorkerFailed => "WORKER_FAILED",
            Self::ResourceExhausted => "BREADBOARD_RESOURCE_EXHAUSTED",
            Self::Interrupted => "JOB_INTERRUPTED",
            Self::Uncertain => "JOB_UNCERTAIN",
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
    pub request_payload: serde_json::Value,
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
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
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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
/// It intentionally carries no port, token, executable, arguments, cwd, or
/// environment material.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeServiceStatus {
    pub id: String,
    pub display_name: String,
    pub required: bool,
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
        if self.restarts > MAX_CONCURRENCY || self.adopted {
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
        validate_bounded_text(
            "controlToken",
            control_token,
            MAX_CONTROL_TOKEN_BYTES,
        )?;
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
    pub cancellation_requested: bool,
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
            || self
                .started_at
                .is_some_and(|value| {
                    value < self.created_at
                        || value > self.updated_at
                        || value > MAX_JSON_SAFE_INTEGER as i64
                })
            || self.updated_at > MAX_JSON_SAFE_INTEGER as i64
            || self
                .finished_at
                .is_some_and(|value| {
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
            ),
            _ => false,
        };
        if !failure_valid {
            return Err(ValidationError::InvalidRange {
                field: "job failure",
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
}

impl RuntimeJobEventPayload {
    pub fn validate_for(&self, event_type: RuntimeJobEventType) -> Result<(), ValidationError> {
        use RuntimeJobEventType as Event;

        let valid = match event_type {
            Event::Queued => self.is_exact_state(JobState::Queued),
            Event::Admitted => self.is_exact_state(JobState::Admitted),
            Event::WorkerAssigned | Event::JobStarting => {
                self.is_exact_state(JobState::Starting)
            }
            Event::CancellationRequested
            | Event::WorkerCancellationAcknowledged
            | Event::JobCancelling => self.is_exact_state(JobState::Cancelling),
            Event::CompletionConfirmed | Event::JobSucceeded => {
                self.is_exact_state(JobState::Succeeded)
            }
            Event::WorkerReady | Event::JobRunning => self.is_exact_state(JobState::Running),
            Event::JobCheckpointing => self.is_exact_state(JobState::Checkpointing),
            Event::JobCancelled => self.is_exact_state(JobState::Cancelled),
            Event::JobFailed => self.is_exact_state(JobState::Failed),
            Event::JobResourceExhausted => self.is_exact_state(JobState::ResourceExhausted),
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
            }
            Event::WorkerCheckpoint | Event::WorkerArtifact => {
                self.artifact_kind.is_some()
                    && self.state.is_none()
                    && self.stage.is_none()
                    && self.progress_current.is_none()
                    && self.progress_total.is_none()
                    && self.failure_code.is_none()
                    && self.failure_message.is_none()
            }
            Event::WorkerFailed => {
                self.state == Some(JobState::Failed)
                    && self.failure_code == Some(RuntimePublicFailureCode::WorkerFailed)
                    && self.failure_message.as_deref() == Some(SANITIZED_RUNTIME_FAILURE_MESSAGE)
                    && self.stage.is_none()
                    && self.progress_current.is_none()
                    && self.progress_total.is_none()
                    && self.artifact_kind.is_none()
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
            return Err(ValidationError::InvalidRange {
                field: "nextAfter",
            });
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
            return Err(ValidationError::InvalidRange {
                field: "retryable",
            });
        }
        if code == "BREADBOARD_RESOURCE_EXHAUSTED" {
            if resource.as_deref() != Some("windows_commit")
                || !required_headroom_mb
                    .is_some_and(|value| value > 0 && value <= MAX_COMMIT_LIMIT_MB)
                || !available_headroom_mb
                    .is_some_and(|value| value <= MAX_COMMIT_LIMIT_MB)
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

/// Closed runtime-to-worker launch contract. Every path is relative to the
/// pinned Runtime V2 data root and is derived exactly from the fenced worker
/// identity. The worker receives only the fixed `start.json` filename in argv;
/// no request payload, secret, executable, arbitrary argument, or environment
/// field can be represented here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerStartManifest {
    pub protocol_version: u32,
    pub identity: WorkerIdentity,
    pub input_manifest_path: String,
    pub workspace_path: String,
    pub checkpoint_path: String,
    pub result_path: String,
}

impl WorkerStartManifest {
    pub fn for_identity(identity: WorkerIdentity) -> Result<Self, ValidationError> {
        identity.validate()?;
        let job_root = format!("runtime/jobs/{}", identity.job_id);
        let attempt_root = format!(
            "{job_root}/attempts/{}/{}",
            identity.attempt, identity.worker_instance_id
        );
        let manifest = Self {
            protocol_version: WIRE_PROTOCOL_VERSION,
            identity,
            input_manifest_path: format!("{job_root}/input.json"),
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

        for (field, value) in [
            ("inputManifestPath", self.input_manifest_path.as_str()),
            ("workspacePath", self.workspace_path.as_str()),
            ("checkpointPath", self.checkpoint_path.as_str()),
            ("resultPath", self.result_path.as_str()),
        ] {
            validate_relative_path(field, value)?;
        }

        let expected = Self::for_identity_unchecked(&self.identity);
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

    fn for_identity_unchecked(identity: &WorkerIdentity) -> Self {
        let job_root = format!("runtime/jobs/{}", identity.job_id);
        let attempt_root = format!(
            "{job_root}/attempts/{}/{}",
            identity.attempt, identity.worker_instance_id
        );
        Self {
            protocol_version: WIRE_PROTOCOL_VERSION,
            identity: identity.clone(),
            input_manifest_path: format!("{job_root}/input.json"),
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkerDefinition {
    pub kind: String,
    pub job_types: Vec<String>,
    pub capability_ids: Vec<String>,
    pub allowed_executable: String,
    pub allowed_entrypoint: String,
    pub protocol_version: u32,
    pub resource_class: ResourceClass,
    pub estimated_cold_start_commit_mb: u64,
    pub soft_commit_limit_mb: u64,
    pub hard_commit_limit_mb: u64,
    pub maximum_concurrency: u32,
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
            return Err(ValidationError::InvalidRange {
                field: "jobTypes",
            });
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
        if self.hard_commit_limit_mb > 0
            && self.soft_commit_limit_mb >= self.hard_commit_limit_mb
        {
            return Err(ValidationError::InvalidRange {
                field: "worker commit limits",
            });
        }
        if self.hard_commit_limit_mb > 0
            && self.estimated_cold_start_commit_mb > self.hard_commit_limit_mb
        {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServiceDefinition {
    pub id: String,
    pub display_name: String,
    pub capability_ids: Vec<String>,
    pub allowed_executable: String,
    pub allowed_entrypoint: Option<String>,
    pub startup_policy: ServiceStartupPolicy,
    pub resource_class: ResourceClass,
    pub dependencies: Vec<String>,
    pub estimated_cold_start_commit_mb: u64,
    pub soft_commit_limit_mb: u64,
    pub hard_commit_limit_mb: u64,
    pub idle_ttl_ms: Option<u64>,
    pub graceful_shutdown_ms: u64,
    pub restart_policy: RestartPolicy,
}

impl ServiceDefinition {
    pub fn validate(&self) -> Result<(), ValidationError> {
        validate_identifier("service id", &self.id)?;
        if self.display_name.trim().is_empty() {
            return Err(ValidationError::EmptyField {
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
        validate_relative_path("allowedExecutable", &self.allowed_executable)?;
        if let Some(entrypoint) = &self.allowed_entrypoint {
            validate_relative_path("allowedEntrypoint", entrypoint)?;
        }
        if self.dependencies.len() > MAX_DEPENDENCIES_PER_SERVICE {
            return Err(ValidationError::InvalidRange {
                field: "service dependencies",
            });
        }
        validate_unique_identifiers("dependency", &self.dependencies)?;
        if self.estimated_cold_start_commit_mb == 0
            || self.estimated_cold_start_commit_mb > MAX_COMMIT_LIMIT_MB
            || self.soft_commit_limit_mb > MAX_COMMIT_LIMIT_MB
            || self.hard_commit_limit_mb > MAX_COMMIT_LIMIT_MB
            || self.graceful_shutdown_ms == 0
            || self.graceful_shutdown_ms > MAX_TIMEOUT_MS
        {
            return Err(ValidationError::InvalidRange {
                field: "service limits",
            });
        }
        if self.hard_commit_limit_mb > 0
            && self.soft_commit_limit_mb >= self.hard_commit_limit_mb
        {
            return Err(ValidationError::InvalidRange {
                field: "service commit limits",
            });
        }
        if self.hard_commit_limit_mb > 0
            && self.estimated_cold_start_commit_mb > self.hard_commit_limit_mb
        {
            return Err(ValidationError::InvalidRange {
                field: "service cold-start estimate",
            });
        }
        if matches!(
            self.startup_policy,
            ServiceStartupPolicy::OnDemand | ServiceStartupPolicy::Scheduled
        ) {
            match self.idle_ttl_ms {
                Some(value) if value > 0 && value <= MAX_TIMEOUT_MS => {}
                Some(_) => {
                    return Err(ValidationError::InvalidRange {
                        field: "idleTtlMs",
                    })
                }
                None => return Err(ValidationError::EmptyField { field: "idleTtlMs" }),
            }
        }
        Ok(())
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

pub fn parse_worker_start_manifest(
    bytes: &[u8],
) -> Result<WorkerStartManifest, ProtocolError> {
    if bytes.len() > MAX_WORKER_START_MANIFEST_BYTES {
        return Err(ProtocolError::OversizedBody(bytes.len()));
    }
    let manifest: WorkerStartManifest =
        serde_json::from_slice(bytes).map_err(ProtocolError::MalformedJson)?;
    manifest
        .validate()
        .map_err(ProtocolError::InvalidPayload)?;
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

pub fn parse_runtime_job_response(bytes: &[u8]) -> Result<RuntimeJobResponse, ProtocolError> {
    parse_bounded_control_json(bytes, RuntimeJobResponse::validate)
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
pub fn parse_job_submission_payload(
    bytes: &[u8],
) -> Result<JobSubmissionPayload, ProtocolError> {
    parse_bounded_json(bytes, JobSubmissionPayload::validate)
}

fn parse_bounded_json<T>(
    bytes: &[u8],
    validate: impl FnOnce(&T) -> Result<(), ValidationError>,
) -> Result<T, ProtocolError>
where
    T: for<'de> Deserialize<'de>,
{
    if bytes.len() > MAX_REQUEST_BODY_BYTES {
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
pub fn validate_capability_id(
    field: &'static str,
    value: &str,
) -> Result<(), ValidationError> {
    let valid_segment = |segment: &str| {
        segment
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
            && segment
                .as_bytes()
                .last()
                .is_some_and(u8::is_ascii_alphanumeric)
            && segment.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.')
            })
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
    let has_windows_drive_prefix = bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':';
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
        .trim_end_matches(|character: char| character == '.' || character == ' ')
        .to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
        || stem
            .strip_prefix("LPT")
            .is_some_and(|suffix| matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
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

fn validate_loopback_http_url(
    field: &'static str,
    value: &str,
) -> Result<(), ValidationError> {
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
    let valid_port = port
        .parse::<u16>()
        .ok()
        .is_some_and(|port| port > 0);
    if !valid_port || !suffix.is_empty() || value.chars().any(char::is_control) {
        return Err(ValidationError::InvalidIdentifier { field });
    }
    Ok(())
}

fn validate_runtime_services(
    services: &[RuntimeServiceStatus],
) -> Result<(), ValidationError> {
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
        let manifest = WorkerStartManifest::for_identity(identity()).unwrap();
        assert_eq!(manifest.protocol_version, WIRE_PROTOCOL_VERSION);
        assert_eq!(
            manifest.input_manifest_path,
            "runtime/jobs/job_1/input.json"
        );
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
                "inputManifestPath",
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
        wrong_attempt.workspace_path =
            "runtime/jobs/job_1/attempts/2/worker_1/workspace".into();
        assert!(matches!(
            wrong_attempt.validate(),
            Err(ValidationError::InvalidRelativePath {
                field: "workspacePath"
            })
        ));
    }

    #[test]
    fn worker_start_manifest_cannot_carry_payload_secrets_or_argv() {
        let manifest = WorkerStartManifest::for_identity(identity()).unwrap();
        for (field, value) in [
            ("requestPayload", serde_json::json!({"prompt": "private"})),
            ("controlToken", serde_json::json!("private-token")),
            (
                "argv",
                serde_json::json!(["--arbitrary", "large-or-untrusted-value"]),
            ),
            ("environment", serde_json::json!({"SECRET": "private"})),
        ] {
            let mut encoded = serde_json::to_value(&manifest).unwrap();
            encoded
                .as_object_mut()
                .unwrap()
                .insert(field.into(), value);
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
                "cancellationRequested":false
            }
        }"#;
        assert!(parse_runtime_job_response(valid).is_ok());

        let leaked_path = String::from_utf8(valid.to_vec())
            .unwrap()
            .replace(
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

        let wrong_job = String::from_utf8(valid.to_vec())
            .unwrap()
            .replacen("\"jobId\":\"job_1\"", "\"jobId\":\"job_2\"", 1);
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

        let leaked_path = String::from_utf8(valid.to_vec())
            .unwrap()
            .replacen(
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
                Event::ReservationSettled
                | Event::ReservationReleased
                | Event::WorkerComplete => RuntimeJobEventPayload::default(),
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
                | RuntimeJobEventFenceKind::RuntimeCurrent => {
                    (1, Some("worker_1".into()), None)
                }
                RuntimeJobEventFenceKind::Worker => {
                    (1, Some("worker_1".into()), Some(1))
                }
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

        for encoded in [private_stage.as_slice(), private_artifact.as_slice(), private_failure.as_slice()] {
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
    }

    #[test]
    fn runtime_status_rejects_duplicate_or_adopted_service_owners() {
        let duplicate = br#"{
            "type":"runtime-status",
            "protocolVersion":1,
            "runtimePid":42,
            "acceptingWork":true,
            "services":[
                {"id":"dashboard","displayName":"Workspace","required":true,"state":"ready","lastError":null,"restarts":0,"adopted":false},
                {"id":"dashboard","displayName":"Workspace","required":true,"state":"ready","lastError":null,"restarts":0,"adopted":false}
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
                {"id":"dashboard","displayName":"Workspace","required":true,"state":"ready","lastError":null,"restarts":0,"adopted":true}
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
        assert_eq!(
            ResourceClass::LargeGeneration.as_str(),
            "large-generation"
        );
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
    fn reusable_finite_workers_are_rejected() {
        let worker = WorkerDefinition {
            kind: "learn".into(),
            job_types: vec!["learn".into()],
            capability_ids: vec!["learn".into()],
            allowed_executable: "runtimes/node/node.exe".into(),
            allowed_entrypoint: "workers/learn-worker.mjs".into(),
            protocol_version: PROTOCOL_VERSION,
            resource_class: ResourceClass::LargeGeneration,
            estimated_cold_start_commit_mb: 1024,
            soft_commit_limit_mb: 4096,
            hard_commit_limit_mb: 6144,
            maximum_concurrency: 1,
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
    fn checked_in_launch_manifests_match_the_typed_versioned_schema() {
        let workers = include_bytes!("../../../desktop/runtime-v2/manifests/workers.json");
        let services = include_bytes!("../../../desktop/runtime-v2/manifests/services.json");
        let workers = parse_worker_manifest(workers).unwrap();
        let services = parse_service_manifest(services).unwrap();
        assert_eq!(workers.version, WORKER_MANIFEST_VERSION);
        assert_eq!(services.version, SERVICE_MANIFEST_VERSION);
        // Source-only coverage validation deliberately remains red until the
        // legacy IPC Learn worker and in-process ingestion route have finite
        // Runtime V2 protocol adapters. An empty manifest is safer than a
        // launch definition that would hang waiting for the wrong transport.
        assert!(workers.workers.is_empty());
        assert!(services.services.iter().any(|service| service.id == "dashboard"));
    }
}
