use crate::admission::RegisteredJobAdmission;
use crate::state_machine::validate_completion_confirmation;
use crate::system_commit::SystemCommitReadError;
#[cfg(test)]
use crate::RuntimePaths;
use crate::{
    validate_transition, AdmissionDecision, AdmissionDenial, AdmissionPolicy, AdmissionRequest,
    OwnedWorkerEvent, PriorGenerationDrained, ProcessExitClassification, ProcessOwnerError,
    ProcessTreeAccounting, ProcessTreeExit, ProcessTreeResidency, ResidentWorkerProcess,
    RuntimeGenerationScope, RuntimeLoad, SystemCommit, WorkerCompletionProof,
    WorkerLaunchNotCreated, WorkerResidencyAuthority, WorkerTreeExitAuthority,
};
use breadboard_runtime_protocol::{
    validate_bounded_text, validate_identifier, validate_relative_path, validate_scope_id,
    JobState, ResourceClass, WorkerEvent, WorkerIdentity, MAX_COMMIT_LIMIT_MB, MAX_CONCURRENCY,
    MAX_FAILURE_MESSAGE_BYTES, MAX_IDEMPOTENCY_KEY_BYTES, MAX_JOB_EVENT_REPLAY_RECORDS,
    MAX_PROTOCOL_LINE_BYTES, MAX_REQUEST_BODY_BYTES,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;

const SCHEMA_VERSION: i64 = 4;
const JOB_COLUMNS: &str = "job_id, job_type, worker_kind, resource_class, owner_principal, user_id, garden_id, conversation_id, state, stage, attempt, worker_instance_id, input_manifest_path, workspace_path, checkpoint_path, result_path, created_at, started_at, updated_at, finished_at, last_heartbeat_at, last_worker_sequence, progress_current, progress_total, failure_code, failure_message, cancellation_requested, idempotency_key, request_digest";
const ADMISSION_RESOURCE_EXHAUSTED_FAILURE_CODE: &str = "BREADBOARD_RESOURCE_EXHAUSTED";
const ADMISSION_RESOURCE_EXHAUSTED_FAILURE_MESSAGE: &str =
    "Runtime resource admission was permanently denied";
pub const MAX_DISPATCH_CANDIDATES: usize = 32;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error("job {0} was not found")]
    JobNotFound(String),
    #[error("job id {0} is already bound to another request")]
    JobIdConflict(String),
    #[error("runtime is not accepting new work")]
    AdmissionClosed,
    #[error("idempotency key {key} was reused by {owner} with a different request")]
    IdempotencyConflict { owner: String, key: String },
    #[error("job {0} has corrupt persisted state")]
    CorruptState(String),
    #[error("stale worker identity for job {0}")]
    StaleWorker(String),
    #[error("worker event sequence {actual} for job {job_id} did not follow {expected}")]
    OutOfOrderWorkerEvent {
        job_id: String,
        expected: u64,
        actual: u64,
    },
    #[error("worker event sequence {sequence} for job {job_id} conflicts with persisted data")]
    ConflictingWorkerEvent { job_id: String, sequence: u64 },
    #[error("job {job_id} cannot accept a worker event while {state:?}")]
    WorkerEventInState { job_id: String, state: JobState },
    #[error("worker event failed bounded semantic validation")]
    WorkerEventRejected,
    #[error("job {0} cannot accept another worker event after completion intent")]
    WorkerEventAfterCompletionIntent(String),
    #[error("job {0} has no fenced worker completion intent")]
    MissingCompletionIntent(String),
    #[error("job {0} has a fenced completion intent that requires explicit result validation")]
    PendingCompletionIntent(String),
    #[error("job {0} has completion evidence that conflicts with the runtime confirmation")]
    ConflictingCompletionEvidence(String),
    #[error("job {0} does not have an active admission reservation")]
    MissingAdmissionReservation(String),
    #[error("job {job_id} has an admission reservation in invalid state {state}")]
    InvalidAdmissionReservationState { job_id: String, state: String },
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error(transparent)]
    SystemCommitRead(#[from] SystemCommitReadError),
    #[error(
        "runtime database has unsupported schema version {found}; this binary supports {supported}"
    )]
    UnsupportedSchemaVersion { found: i64, supported: i64 },
    #[error("runtime database has schema objects but no schema version; refusing an unsafe implicit migration")]
    UnversionedSchema,
    #[error("runtime database schema version {version} is missing or has invalid required element {column}")]
    SchemaMismatch { version: i64, column: String },
    #[error("prior-generation drain authority does not match this runtime data root")]
    GenerationAuthorityMismatch,
    #[error(
        "runtime database schema v2 contains {jobs} jobs whose canonical request inputs cannot be recovered; refusing a lossy migration"
    )]
    LegacyJobInputsUnavailable { jobs: i64 },
    #[error(transparent)]
    Transition(#[from] crate::StateTransitionError),
    #[error(transparent)]
    ProtocolValidation(#[from] breadboard_runtime_protocol::ValidationError),
}

impl StoreError {
    /// Classifies only deterministic semantic rejections at the worker-event
    /// persistence boundary. Database, fencing, sequencing, generation, and
    /// corrupt-state errors remain generation-fatal because their commit
    /// outcome or authority cannot safely be inferred by the dispatcher.
    pub fn is_deterministic_worker_event_rejection(&self) -> bool {
        matches!(
            self,
            Self::WorkerEventInState { .. }
                | Self::WorkerEventRejected
                | Self::WorkerEventAfterCompletionIntent(_)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct JobOwner {
    principal: String,
    user_id: Option<i64>,
}

impl JobOwner {
    fn user(user_id: i64) -> Result<Self, StoreError> {
        if user_id <= 0 {
            return Err(StoreError::InvalidInput(
                "user owner id must be a positive integer".into(),
            ));
        }
        Ok(Self {
            principal: format!("user:{user_id}"),
            user_id: Some(user_id),
        })
    }

    fn internal(id: &str) -> Result<Self, StoreError> {
        validate_identifier("internal owner", id)?;
        Ok(Self {
            principal: format!("internal:{id}"),
            user_id: None,
        })
    }

    pub(crate) fn user_id(&self) -> Option<i64> {
        self.user_id
    }

    pub(crate) fn principal(&self) -> &str {
        &self.principal
    }

    fn validate(&self) -> Result<(), StoreError> {
        match self.user_id {
            Some(user_id) if self.principal == format!("user:{user_id}") && user_id > 0 => Ok(()),
            None if self.principal.starts_with("internal:") => {
                validate_identifier("internal owner", &self.principal["internal:".len()..])?;
                Ok(())
            }
            _ => Err(StoreError::InvalidInput("invalid job owner proof".into())),
        }
    }
}

/// Opaque ownership proof constructed only after a server-side authentication
/// decision. It is intentionally not serializable or deserializable, so an
/// HTTP/IPC body cannot assert a user or internal principal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthenticatedJobContext {
    owner: JobOwner,
    garden_id: Option<String>,
    conversation_id: Option<String>,
}

impl AuthenticatedJobContext {
    /// This crate-private constructor is the handoff from the server-side
    /// authentication/authorization adapter. Keeping it out of the public API
    /// prevents downstream request handlers from minting their own authority.
    pub(crate) fn for_verified_user(
        user_id: i64,
        garden_id: Option<&str>,
        conversation_id: Option<&str>,
    ) -> Result<Self, StoreError> {
        Self::new(JobOwner::user(user_id)?, garden_id, conversation_id)
    }

    /// Creates an authority for a trusted runtime-owned scheduler or adapter,
    /// never from a renderer or ordinary request field.
    pub(crate) fn for_trusted_internal(
        id: &str,
        garden_id: Option<&str>,
        conversation_id: Option<&str>,
    ) -> Result<Self, StoreError> {
        Self::new(JobOwner::internal(id)?, garden_id, conversation_id)
    }

    fn new(
        owner: JobOwner,
        garden_id: Option<&str>,
        conversation_id: Option<&str>,
    ) -> Result<Self, StoreError> {
        if let Some(value) = garden_id {
            validate_scope_id("gardenId", value)?;
        }
        if let Some(value) = conversation_id {
            validate_scope_id("conversationId", value)?;
        }
        Ok(Self {
            owner,
            garden_id: garden_id.map(str::to_owned),
            conversation_id: conversation_id.map(str::to_owned),
        })
    }

    pub(crate) fn owner(&self) -> &JobOwner {
        &self.owner
    }

    #[cfg(test)]
    pub(crate) fn user_id(&self) -> Option<i64> {
        self.owner.user_id()
    }

    pub(crate) fn garden_id(&self) -> Option<&str> {
        self.garden_id.as_deref()
    }

    pub(crate) fn conversation_id(&self) -> Option<&str> {
        self.conversation_id.as_deref()
    }

    pub(crate) fn validate(&self) -> Result<(), StoreError> {
        self.owner.validate()?;
        if let Some(value) = &self.garden_id {
            validate_scope_id("gardenId", value)?;
        }
        if let Some(value) = &self.conversation_id {
            validate_scope_id("conversationId", value)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct NewJob {
    pub(crate) job_id: String,
    pub(crate) job_type: String,
    pub(crate) worker_kind: String,
    pub(crate) resource_class: String,
    pub(crate) owner: JobOwner,
    pub(crate) garden_id: Option<String>,
    pub(crate) conversation_id: Option<String>,
    pub(crate) input_manifest_path: String,
    pub(crate) workspace_path: String,
    pub(crate) checkpoint_path: String,
    pub(crate) result_path: String,
    pub(crate) idempotency_key: String,
    pub(crate) request_digest: String,
    pub(crate) canonical_request_payload: Vec<u8>,
}

impl NewJob {
    fn validate(&self) -> Result<(), StoreError> {
        validate_identifier("jobId", &self.job_id)?;
        validate_identifier("jobType", &self.job_type)?;
        validate_identifier("workerKind", &self.worker_kind)?;
        validate_identifier("resourceClass", &self.resource_class)?;
        self.owner.validate()?;
        if let Some(garden_id) = &self.garden_id {
            validate_scope_id("gardenId", garden_id)?;
        }
        if let Some(conversation_id) = &self.conversation_id {
            validate_scope_id("conversationId", conversation_id)?;
        }
        validate_relative_path("inputManifestPath", &self.input_manifest_path)?;
        validate_relative_path("workspacePath", &self.workspace_path)?;
        validate_relative_path("checkpointPath", &self.checkpoint_path)?;
        validate_relative_path("resultPath", &self.result_path)?;
        let job_root = format!("runtime/jobs/{}", self.job_id);
        for (field, actual, expected) in [
            (
                "input manifest",
                &self.input_manifest_path,
                format!("{job_root}/input.json"),
            ),
            (
                "workspace",
                &self.workspace_path,
                format!("{job_root}/workspace"),
            ),
            (
                "checkpoint",
                &self.checkpoint_path,
                format!("{job_root}/checkpoint.json"),
            ),
            (
                "result",
                &self.result_path,
                format!("{job_root}/result.json"),
            ),
        ] {
            if actual != &expected {
                return Err(StoreError::InvalidInput(format!(
                    "{field} path was not derived from the trusted job layout"
                )));
            }
        }
        validate_bounded_text(
            "idempotencyKey",
            &self.idempotency_key,
            MAX_IDEMPOTENCY_KEY_BYTES,
        )?;
        if !is_valid_request_digest(&self.request_digest) {
            return Err(StoreError::InvalidInput(
                "request digest must be a 64-character lowercase hexadecimal SHA-256 digest".into(),
            ));
        }
        validate_canonical_request_payload(&self.canonical_request_payload)?;
        let expected_digest = compute_submission_digest(
            &self.owner,
            &self.job_type,
            self.garden_id.as_deref(),
            self.conversation_id.as_deref(),
            &self.canonical_request_payload,
        )?;
        if self.request_digest != expected_digest {
            return Err(StoreError::InvalidInput(
                "request digest is not bound to the canonical request payload and trusted metadata"
                    .into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub job_id: String,
    pub job_type: String,
    pub worker_kind: String,
    pub resource_class: String,
    #[serde(skip)]
    owner_principal: String,
    pub user_id: Option<i64>,
    pub garden_id: Option<String>,
    pub conversation_id: Option<String>,
    pub state: JobState,
    pub stage: Option<String>,
    pub attempt: u32,
    pub worker_instance_id: Option<String>,
    #[serde(skip)]
    pub input_manifest_path: String,
    #[serde(skip)]
    pub workspace_path: String,
    #[serde(skip)]
    pub checkpoint_path: String,
    #[serde(skip)]
    pub result_path: String,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub updated_at: i64,
    pub finished_at: Option<i64>,
    pub last_heartbeat_at: Option<i64>,
    pub last_worker_sequence: u64,
    pub progress_current: u64,
    pub progress_total: u64,
    pub failure_code: Option<String>,
    pub failure_message: Option<String>,
    pub cancellation_requested: bool,
    pub idempotency_key: String,
    #[serde(skip)]
    request_digest: String,
}

impl JobRecord {
    pub fn is_owned_by(&self, context: &AuthenticatedJobContext) -> bool {
        self.owner_principal == context.owner.principal
            && self.garden_id.as_deref() == context.garden_id()
            && self.conversation_id.as_deref() == context.conversation_id()
    }

    pub fn identity(&self) -> Option<WorkerIdentity> {
        Some(WorkerIdentity {
            job_id: self.job_id.clone(),
            attempt: self.attempt,
            worker_instance_id: self.worker_instance_id.clone()?,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobEventRecord {
    pub sequence: i64,
    pub job_id: String,
    pub attempt: u32,
    pub worker_instance_id: Option<String>,
    pub worker_sequence: Option<u64>,
    pub event_type: String,
    pub payload: Value,
    pub created_at: i64,
}

/// One ownership-scoped replay view read from a single SQLite snapshot.
/// `public_event_stream_sealed` is stronger than terminal job state: it is
/// true only after no pending or resident process-tree reservation can append
/// another public lifecycle event.
#[derive(Debug, Clone, PartialEq)]
pub struct JobEventReplaySnapshot {
    pub job: JobRecord,
    pub events: Vec<JobEventRecord>,
    pub public_event_stream_sealed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointRecord {
    pub sequence: i64,
    pub job_id: String,
    pub attempt: u32,
    pub worker_instance_id: String,
    pub kind: String,
    pub path: String,
    pub created_at: i64,
}

/// Metadata produced by the authoritative runtime after it has reopened the
/// expected result through the trusted job path, validated its contents, and
/// confirmed the durable write. This type is intentionally not deserializable:
/// an HTTP/IPC request or worker protocol line must never be treated as this
/// evidence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedWorkerResult {
    result_path: String,
    sha256: String,
    size_bytes: u64,
}

impl ValidatedWorkerResult {
    pub(crate) fn from_trusted_validation(
        result_path: impl Into<String>,
        sha256: impl Into<String>,
        size_bytes: u64,
    ) -> Result<Self, StoreError> {
        let result = Self {
            result_path: result_path.into(),
            sha256: sha256.into(),
            size_bytes,
        };
        result.validate()?;
        Ok(result)
    }

    pub(crate) fn result_path(&self) -> &str {
        &self.result_path
    }

    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }

    pub(crate) fn size_bytes(&self) -> u64 {
        self.size_bytes
    }

    fn validate(&self) -> Result<(), StoreError> {
        validate_relative_path("validated result path", &self.result_path)?;
        if !is_valid_request_digest(&self.sha256) {
            return Err(StoreError::InvalidInput(
                "validated result digest must be a 64-character lowercase hexadecimal SHA-256 digest"
                    .into(),
            ));
        }
        if self.size_bytes == 0 || i64::try_from(self.size_bytes).is_err() {
            return Err(StoreError::InvalidInput(
                "validated result size must fit in a positive SQLite integer".into(),
            ));
        }
        Ok(())
    }
}

/// A durable, fenced worker completion intent awaiting authoritative result
/// validation and complete-tree exit confirmation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerCompletionIntent {
    pub(crate) identity: WorkerIdentity,
    pub(crate) sequence: u64,
    pub(crate) result_path: String,
}

impl WorkerCompletionIntent {
    pub fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    pub fn result_path(&self) -> &str {
        &self.result_path
    }
}

/// Result of one serialized admission attempt. `Denied` does not imply the job
/// is still queued: a non-shutdown, non-retryable denial is returned only
/// after the same transaction has made the job durably resource-exhausted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JobAdmissionResult {
    Admitted(Box<JobRecord>),
    Denied(AdmissionDenial),
}

/// Advisory FIFO work discovered by the dispatcher. This value deliberately
/// carries no launch authority: only `try_claim_admitted_worker` can mint the
/// non-cloneable claim required to continue a launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerDispatchCandidate {
    job_id: String,
    worker_kind: String,
    resource_class: String,
    created_at: i64,
}

/// Advisory queued work for the admission scheduler. This record carries no
/// admission reservation and no dispatch authority.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedAdmissionCandidate {
    job_id: String,
    job_type: String,
    worker_kind: String,
    resource_class: String,
    created_at: i64,
}

impl QueuedAdmissionCandidate {
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn job_type(&self) -> &str {
        &self.job_type
    }

    pub fn worker_kind(&self) -> &str {
        &self.worker_kind
    }

    pub fn resource_class(&self) -> &str {
        &self.resource_class
    }

    pub fn created_at(&self) -> i64 {
        self.created_at
    }
}

impl WorkerDispatchCandidate {
    pub fn job_id(&self) -> &str {
        &self.job_id
    }

    pub fn worker_kind(&self) -> &str {
        &self.worker_kind
    }

    pub fn resource_class(&self) -> &str {
        &self.resource_class
    }

    pub fn created_at(&self) -> i64 {
        self.created_at
    }
}

/// Single-use durable authority proving that one exact admitted job was
/// atomically bound to one exact worker attempt. It is intentionally neither
/// cloneable nor serializable; a candidate, job replay, or admission result is
/// never equivalent to this value.
#[must_use = "a dispatch claim must reach authoritative residency or be terminalized before residency"]
pub struct WorkerDispatchClaim {
    generation_scope: RuntimeGenerationScope,
    identity: WorkerIdentity,
    job: JobRecord,
}

impl std::fmt::Debug for WorkerDispatchClaim {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_tuple("WorkerDispatchClaim")
            .field(&"<opaque durable dispatch authority>")
            .finish()
    }
}

impl WorkerDispatchClaim {
    pub fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    pub fn job(&self) -> &JobRecord {
        &self.job
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.generation_scope == *scope
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        generation_scope: RuntimeGenerationScope,
        identity: WorkerIdentity,
    ) -> Self {
        let job_root = format!("runtime/jobs/{}", identity.job_id);
        Self {
            generation_scope,
            identity: identity.clone(),
            job: JobRecord {
                job_id: identity.job_id,
                job_type: "test-job".into(),
                worker_kind: "test-worker".into(),
                resource_class: "core".into(),
                owner_principal: "internal:test-runtime".into(),
                user_id: None,
                garden_id: None,
                conversation_id: None,
                state: JobState::Starting,
                stage: None,
                attempt: identity.attempt,
                worker_instance_id: Some(identity.worker_instance_id),
                input_manifest_path: format!("{job_root}/input.json"),
                workspace_path: format!("{job_root}/workspace"),
                checkpoint_path: format!("{job_root}/checkpoint.json"),
                result_path: format!("{job_root}/result.json"),
                created_at: 0,
                started_at: Some(0),
                updated_at: 0,
                finished_at: None,
                last_heartbeat_at: None,
                last_worker_sequence: 0,
                progress_current: 0,
                progress_total: 0,
                failure_code: None,
                failure_message: None,
                cancellation_requested: false,
                idempotency_key: "test-request".into(),
                request_digest: "0".repeat(64),
            },
        }
    }
}

/// Exact durable scheduler state for one fenced worker attempt. This is not an
/// authenticated UI view and accepts no job-id-only lookup: a stale or foreign
/// worker identity is rejected before any cancellation decision is returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkerDispatchSnapshot {
    identity: WorkerIdentity,
    state: JobState,
    cancellation_requested: bool,
    last_worker_sequence: u64,
}

impl WorkerDispatchSnapshot {
    pub fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    pub fn state(&self) -> JobState {
        self.state
    }

    pub fn cancellation_requested(&self) -> bool {
        self.cancellation_requested
    }

    pub fn last_worker_sequence(&self) -> u64 {
        self.last_worker_sequence
    }
}

/// Store failures never consume the only launch/residency/tree-exit authority.
/// The caller receives the complete opaque value back and may retry the exact
/// same transaction or retain it while initiating fatal runtime shutdown.
#[must_use = "store transition failures retain authority and must be retried or held through shutdown"]
pub struct WorkerStoreTransitionError<A> {
    authority: Box<A>,
    error: StoreError,
}

impl<A> std::fmt::Debug for WorkerStoreTransitionError<A> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("WorkerStoreTransitionError")
            .field("authority", &"<opaque retained authority>")
            .field("error", &self.error)
            .finish()
    }
}

impl<A> WorkerStoreTransitionError<A> {
    pub fn error(&self) -> &StoreError {
        &self.error
    }

    pub fn into_parts(self) -> (A, StoreError) {
        (*self.authority, self.error)
    }
}

#[derive(Debug)]
#[must_use = "a claim outcome must be handled; dropping Claimed can strand a pending attempt"]
pub enum WorkerClaimOutcome {
    Claimed(Box<WorkerDispatchClaim>),
    NotClaimable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreResidencyClaimDisposition {
    #[cfg(test)]
    Cancellation,
    SpawnFailed,
    SpawnResourceExhausted,
}

pub struct JobStore {
    connection: Mutex<Connection>,
    admission_open: Mutex<bool>,
    generation_scope: RuntimeGenerationScope,
}

/// Explicit test-only substitute for the non-forgeable kernel drain proof.
/// It is minted by a bound `JobStore`, consumed by reconciliation, and still
/// exercises the same exact-scope rejection as production authority.
#[cfg(test)]
pub(crate) struct RuntimeRestartProofForTest {
    scope: RuntimeGenerationScope,
}

impl JobStore {
    /// Opens the authoritative database bound to the opaque scope minted by
    /// the same pinned `RuntimePaths` data root. There is intentionally no
    /// production path-only opener.
    pub fn open_authoritative(
        path: impl AsRef<Path>,
        generation_scope: RuntimeGenerationScope,
    ) -> Result<Self, StoreError> {
        let mut connection = Connection::open(path)?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        initialize_schema(&mut connection)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        Ok(Self {
            connection: Mutex::new(connection),
            admission_open: Mutex::new(true),
            generation_scope,
        })
    }

    /// Opens a test database using the real filesystem identity of its parent
    /// directory. Production code cannot call this path-only helper.
    #[cfg(test)]
    pub(crate) fn open_for_test(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        let path = path.as_ref();
        let parent = path.parent().ok_or_else(|| {
            StoreError::InvalidInput("test store path must have an existing parent".into())
        })?;
        let paths = RuntimePaths::new(parent, parent, parent).map_err(|error| {
            StoreError::InvalidInput(format!(
                "test store parent could not mint generation scope: {error}"
            ))
        })?;
        Self::open_authoritative(path, paths.runtime_generation_scope())
    }

    /// Compatibility shim for crate-local unit tests outside this module.
    /// New store tests use the explicitly named helper above.
    #[cfg(test)]
    pub(crate) fn open(path: impl AsRef<Path>) -> Result<Self, StoreError> {
        Self::open_for_test(path)
    }

    pub(crate) fn submit_raw(&self, input: &NewJob) -> Result<JobRecord, StoreError> {
        input.validate()?;
        let now = now_ms();
        let admission_gate = self
            .admission_open
            .lock()
            .expect("job admission gate mutex poisoned");
        if !*admission_gate {
            return Err(StoreError::AdmissionClosed);
        }
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(existing) = query_job_by_idempotency_key(
            &transaction,
            input.owner.principal(),
            &input.idempotency_key,
        )? {
            if existing.request_digest != input.request_digest {
                return Err(StoreError::IdempotencyConflict {
                    owner: input.owner.principal().to_string(),
                    key: input.idempotency_key.clone(),
                });
            }
            let stored_payload = query_bound_job_input(&transaction, &existing)?;
            if stored_payload.as_slice() != input.canonical_request_payload.as_slice() {
                return Err(StoreError::IdempotencyConflict {
                    owner: input.owner.principal().to_string(),
                    key: input.idempotency_key.clone(),
                });
            }
            transaction.commit()?;
            return Ok(existing);
        }
        if query_job_optional(&transaction, &input.job_id)?.is_some() {
            return Err(StoreError::JobIdConflict(input.job_id.clone()));
        }
        transaction.execute(
            "INSERT INTO runtime_jobs (
                job_id, job_type, worker_kind, resource_class, owner_principal, user_id, garden_id,
                conversation_id, state, input_manifest_path, workspace_path,
                checkpoint_path, result_path, created_at, updated_at, idempotency_key, request_digest
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', ?9, ?10, ?11, ?12, ?13, ?13, ?14, ?15)",
            params![
                input.job_id,
                input.job_type,
                input.worker_kind,
                input.resource_class,
                input.owner.principal(),
                input.owner.user_id(),
                input.garden_id,
                input.conversation_id,
                input.input_manifest_path,
                input.workspace_path,
                input.checkpoint_path,
                input.result_path,
                now,
                input.idempotency_key,
                input.request_digest,
            ],
        )?;
        transaction.execute(
            "INSERT INTO runtime_job_inputs (
                job_id, request_digest, canonical_request_payload
             ) VALUES (?1, ?2, ?3)",
            params![
                input.job_id,
                input.request_digest,
                input.canonical_request_payload.as_slice(),
            ],
        )?;
        append_event_tx(
            &transaction,
            &input.job_id,
            0,
            None,
            "queued",
            &serde_json::json!({ "state": "queued" }),
            now,
        )?;
        let job = query_job(&transaction, &input.job_id)?;
        transaction.commit()?;
        Ok(job)
    }

    /// Loads the exact canonical request bytes for a trusted worker launcher.
    /// This is deliberately crate-private: renderer/HTTP callers receive job
    /// records, never the authority to launch work or read another job's input.
    #[cfg(test)]
    pub(crate) fn load_canonical_request_payload(
        &self,
        job_id: &str,
    ) -> Result<Vec<u8>, StoreError> {
        validate_identifier("jobId", job_id)?;
        let connection = self.connection.lock().expect("job store mutex poisoned");
        let job = query_job(&connection, job_id)?;
        query_bound_job_input(&connection, &job)
    }

    pub fn get(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<JobRecord, StoreError> {
        context.validate()?;
        let connection = self.connection.lock().expect("job store mutex poisoned");
        query_owned_job(
            &connection,
            context.owner(),
            context.garden_id(),
            context.conversation_id(),
            job_id,
        )
    }

    /// Changes whether new durable admission reservations may be created. This
    /// gate is held across the complete admission transaction, so shutdown and
    /// admission have a deterministic order.
    pub fn set_accepting_work(&self, accepting_work: bool) {
        let mut gate = self
            .admission_open
            .lock()
            .expect("job admission gate mutex poisoned");
        *gate = accepting_work;
    }

    /// Evaluates a commit sample and every active reservation while the same
    /// in-process mutex and SQLite IMMEDIATE transaction are held. Production
    /// access is exclusively through `AdmissionGovernor`, which supplies the
    /// exact native sampler; crate-local tests inject deterministic samples.
    /// The runtime-shutdown gate and any explicitly retryable future denial
    /// leave the job queued. Every other non-retryable denial atomically moves
    /// the exact queued job to `resource_exhausted`, persists private denial
    /// evidence, and creates no reservation, so a dispatcher cannot retry it
    /// as queued work. The sampler must not call back into this `JobStore`.
    pub(crate) fn try_admit_job<F>(
        &self,
        job_id: &str,
        admission: &RegisteredJobAdmission,
        policy: AdmissionPolicy,
        sample_commit: F,
    ) -> Result<JobAdmissionResult, StoreError>
    where
        F: FnOnce() -> Result<SystemCommit, StoreError>,
    {
        validate_identifier("jobId", job_id)?;
        validate_identifier("jobType", &admission.job_type)?;
        validate_identifier("definitionKey", &admission.definition_key)?;
        if admission.estimated_cold_start_commit_mb == 0
            || admission.estimated_cold_start_commit_mb > MAX_COMMIT_LIMIT_MB
            || admission.maximum_concurrency == 0
            || admission.maximum_concurrency > MAX_CONCURRENCY
        {
            return Err(StoreError::InvalidInput(
                "registered admission limits are outside their allowed range".into(),
            ));
        }

        let admission_gate = self
            .admission_open
            .lock()
            .expect("job admission gate mutex poisoned");
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, job_id)?;
        require_registered_admission_matches(&current, admission)?;

        if current.state == JobState::Admitted {
            require_matching_active_job_reservation_tx(&transaction, &current, admission)?;
            transaction.commit()?;
            return Ok(JobAdmissionResult::Admitted(Box::new(current)));
        }
        validate_transition(current.state, JobState::Admitted)?;
        if active_job_reservation_tx(&transaction, job_id)?.is_some() {
            return Err(StoreError::CorruptState(format!(
                "queued job {job_id} already has an active admission reservation"
            )));
        }
        if !*admission_gate {
            let denial = AdmissionDenial::runtime_shutdown_gate(
                policy
                    .minimum_reserve_mb
                    .saturating_add(admission.estimated_cold_start_commit_mb),
                0,
            );
            return finish_admission_denial_tx(transaction, &current, denial);
        }

        let sampled_commit = sample_commit()?;
        let reservations = active_reservation_summary_tx(&transaction)?;
        let effective_commit = SystemCommit {
            total_mb: sampled_commit
                .total_mb
                .saturating_add(reservations.pending_commit_mb),
            limit_mb: sampled_commit.limit_mb,
        };
        let active_definition_count = reservations
            .active_job_definitions
            .iter()
            .filter(|definition| definition.as_str() == admission.definition_key.as_str())
            .count();
        let load = RuntimeLoad {
            accepting_work: *admission_gate,
            active_job_classes: reservations.active_job_classes,
            active_service_classes: reservations.active_service_classes,
        };
        let request = AdmissionRequest {
            resource_class: admission.resource_class,
            estimated_cold_start_commit_mb: admission.estimated_cold_start_commit_mb,
            reserve_floor_mb: None,
        };
        let durable_policy = AdmissionPolicy {
            one_heavyweight_at_a_time: true,
            ..policy
        };
        if let AdmissionDecision::Denied(denial) =
            durable_policy.decide(request, effective_commit, &load)
        {
            return finish_admission_denial_tx(transaction, &current, denial);
        }

        if active_definition_count >= admission.maximum_concurrency as usize {
            let reserve = policy.minimum_reserve_mb;
            let denial = AdmissionDenial {
                code: "BREADBOARD_RESOURCE_EXHAUSTED".into(),
                resource: "worker_concurrency".into(),
                required_headroom_mb: reserve
                    .saturating_add(admission.estimated_cold_start_commit_mb),
                available_headroom_mb: effective_commit.free_mb(),
                retryable: false,
                reason: format!(
                    "worker {} reached maximum concurrency {}",
                    admission.definition_key, admission.maximum_concurrency
                ),
            };
            return finish_admission_denial_tx(transaction, &current, denial);
        }

        let now = now_ms();
        transaction.execute(
            "INSERT INTO runtime_admission_reservations (
                subject_kind, subject_id, definition_key, resource_class,
                estimated_pending_commit_mb, lifecycle_state, created_at, updated_at
             ) VALUES ('job', ?1, ?2, ?3, ?4, 'pending', ?5, ?5)",
            params![
                job_id,
                admission.definition_key,
                admission.resource_class.as_str(),
                u64_to_i64(
                    admission.estimated_cold_start_commit_mb,
                    "pending admission commit"
                )?,
                now,
            ],
        )?;
        let changed = transaction.execute(
            "UPDATE runtime_jobs SET state='admitted', updated_at=?2 WHERE job_id=?1 AND state='queued'",
            params![job_id, now],
        )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(format!(
                "job {job_id} changed while its admission reservation was being created"
            )));
        }
        append_event_tx(
            &transaction,
            job_id,
            current.attempt,
            current.worker_instance_id.as_deref(),
            "admitted",
            &serde_json::json!({
                "state": "admitted",
                "reservationState": "pending",
                "estimatedPendingCommitMb": admission.estimated_cold_start_commit_mb,
            }),
            now,
        )?;
        let admitted = query_job(&transaction, job_id)?;
        transaction.commit()?;
        Ok(JobAdmissionResult::Admitted(Box::new(admitted)))
    }

    /// Returns bounded FIFO queued work for the admission scheduler. This is a
    /// read-only snapshot and cannot create a reservation or claim authority.
    pub fn queued_admission_candidates(
        &self,
        limit: usize,
    ) -> Result<Vec<QueuedAdmissionCandidate>, StoreError> {
        if !(1..=MAX_DISPATCH_CANDIDATES).contains(&limit) {
            return Err(StoreError::InvalidInput(format!(
                "queued admission candidate limit must be between 1 and {MAX_DISPATCH_CANDIDATES}"
            )));
        }
        let connection = self.connection.lock().expect("job store mutex poisoned");
        let mut statement = connection.prepare(
            "SELECT jobs.job_id, jobs.job_type, jobs.worker_kind, jobs.resource_class,
                    jobs.created_at
             FROM runtime_jobs AS jobs INDEXED BY runtime_jobs_queued_fifo_idx
             WHERE jobs.state='queued'
             ORDER BY jobs.created_at ASC, jobs.job_id ASC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit as i64], |row| {
            Ok(QueuedAdmissionCandidate {
                job_id: row.get(0)?,
                job_type: row.get(1)?,
                worker_kind: row.get(2)?,
                resource_class: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    /// Returns a bounded FIFO snapshot of admitted jobs. Enumeration is
    /// advisory only and never changes durable state or creates launch
    /// authority. Queued jobs are intentionally excluded: the admission
    /// governor must first create their matching durable pending reservation.
    pub fn dispatch_candidates(
        &self,
        limit: usize,
    ) -> Result<Vec<WorkerDispatchCandidate>, StoreError> {
        if !(1..=MAX_DISPATCH_CANDIDATES).contains(&limit) {
            return Err(StoreError::InvalidInput(format!(
                "dispatch candidate limit must be between 1 and {MAX_DISPATCH_CANDIDATES}"
            )));
        }
        let connection = self.connection.lock().expect("job store mutex poisoned");
        let mut statement = connection.prepare(
            "SELECT jobs.job_id, jobs.worker_kind, jobs.resource_class, jobs.created_at
             FROM runtime_jobs AS jobs INDEXED BY runtime_jobs_admitted_fifo_idx
             WHERE jobs.state='admitted'
             ORDER BY jobs.created_at ASC, jobs.job_id ASC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit as i64], |row| {
            Ok(WorkerDispatchCandidate {
                job_id: row.get(0)?,
                worker_kind: row.get(1)?,
                resource_class: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    /// Atomically claims an admitted job for one fresh worker identity. The
    /// shutdown/admission gate is held before the SQLite IMMEDIATE transaction,
    /// giving shutdown and launch a deterministic order. Exactly one caller can
    /// change `admitted -> starting`; every later or stale caller receives no
    /// authority. The matching admission hold must still be pending.
    pub fn try_claim_admitted_worker(
        &self,
        job_id: &str,
        worker_instance_id: &str,
    ) -> Result<WorkerClaimOutcome, StoreError> {
        validate_identifier("jobId", job_id)?;
        validate_identifier("workerInstanceId", worker_instance_id)?;
        let admission_gate = self
            .admission_open
            .lock()
            .expect("job admission gate mutex poisoned");
        if !*admission_gate {
            return Ok(WorkerClaimOutcome::NotClaimable);
        }
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, job_id)?;
        if current.state != JobState::Admitted {
            transaction.commit()?;
            return Ok(WorkerClaimOutcome::NotClaimable);
        }
        if current.attempt != 0
            || current.worker_instance_id.is_some()
            || current.started_at.is_some()
            || current.cancellation_requested
            || normalized_relative_path(&current.workspace_path)
                != format!("runtime/jobs/{job_id}/workspace")
        {
            return Err(StoreError::CorruptState(format!(
                "admitted job {job_id} is not an unclaimed attempt-zero job"
            )));
        }
        validate_transition(current.state, JobState::Starting)?;
        require_pending_job_reservation_tx(&transaction, &current)?;
        let attempt = current.attempt.checked_add(1).ok_or_else(|| {
            StoreError::InvalidInput(format!("job {job_id} exhausted its attempt counter"))
        })?;
        let identity = WorkerIdentity {
            job_id: job_id.to_string(),
            attempt,
            worker_instance_id: worker_instance_id.to_string(),
        };
        identity.validate()?;
        let workspace_path = worker_attempt_workspace_path(&identity)?;
        let now = now_ms();
        let changed = transaction.execute(
            "UPDATE runtime_jobs SET state='starting', attempt=?2, worker_instance_id=?3,
             workspace_path=?4, started_at=COALESCE(started_at, ?5), updated_at=?5, finished_at=NULL,
             last_heartbeat_at=NULL, last_worker_sequence=0,
             failure_code=NULL, failure_message=NULL
             WHERE job_id=?1 AND state='admitted' AND attempt=0
               AND worker_instance_id IS NULL AND cancellation_requested=0",
            params![job_id, attempt, worker_instance_id, workspace_path, now],
        )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(format!(
                "admitted job {job_id} changed while its dispatch claim was being committed"
            )));
        }
        append_event_tx(
            &transaction,
            job_id,
            attempt,
            Some(worker_instance_id),
            "worker-assigned",
            &serde_json::json!({
                "state": "starting",
                "dispatchClaimed": true,
            }),
            now,
        )?;
        let job = query_job(&transaction, job_id)?;
        transaction.commit()?;
        Ok(WorkerClaimOutcome::Claimed(Box::new(WorkerDispatchClaim {
            generation_scope: self.generation_scope.clone(),
            identity,
            job,
        })))
    }

    pub fn worker_dispatch_snapshot(
        &self,
        identity: &WorkerIdentity,
    ) -> Result<WorkerDispatchSnapshot, StoreError> {
        identity.validate()?;
        let connection = self.connection.lock().expect("job store mutex poisoned");
        let current = query_job(&connection, &identity.job_id)?;
        require_identity(&current, identity)?;
        Ok(WorkerDispatchSnapshot {
            identity: identity.clone(),
            state: current.state,
            cancellation_requested: current.cancellation_requested,
            last_worker_sequence: current.last_worker_sequence,
        })
    }

    pub fn worker_completion_intent(
        &self,
        identity: &WorkerIdentity,
    ) -> Result<Option<WorkerCompletionIntent>, StoreError> {
        identity.validate()?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let current = query_job(&transaction, &identity.job_id)?;
        require_identity(&current, identity)?;
        let intent = completion_intent_tx(&transaction, identity)?;
        transaction.commit()?;
        Ok(intent)
    }

    /// Atomically consumes the coupled claim + accepted-started authority on
    /// success. Every failure, including a transaction/commit error, returns
    /// the complete authority so the exact operation can be retried.
    pub fn settle_worker_residency(
        &self,
        authority: WorkerResidencyAuthority,
    ) -> Result<ResidentWorkerProcess, WorkerStoreTransitionError<WorkerResidencyAuthority>> {
        let result = {
            let (claim, residency) = authority.parts();
            self.settle_job_reservation_inner(claim, residency)
        };
        match result {
            Ok(identity) => Ok(authority.into_resident(identity)),
            Err(error) => Err(WorkerStoreTransitionError {
                authority: Box::new(authority),
                error,
            }),
        }
    }

    #[cfg(test)]
    fn settle_job_reservation(
        &self,
        claim: WorkerDispatchClaim,
        residency: ProcessTreeResidency,
    ) -> Result<WorkerIdentity, StoreError> {
        self.settle_job_reservation_inner(&claim, &residency)
    }

    fn settle_job_reservation_inner(
        &self,
        claim: &WorkerDispatchClaim,
        residency: &ProcessTreeResidency,
    ) -> Result<WorkerIdentity, StoreError> {
        if claim.generation_scope != self.generation_scope
            || !residency.matches_generation_scope(&self.generation_scope)
        {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        claim.identity.validate()?;
        let resident_identity = residency.worker_identity().ok_or_else(|| {
            StoreError::InvalidInput(
                "service process-tree residency cannot settle a worker reservation".into(),
            )
        })?;
        if resident_identity != &claim.identity {
            return Err(StoreError::StaleWorker(claim.identity.job_id.clone()));
        }
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &claim.identity.job_id)?;
        require_identity(&current, &claim.identity)?;
        require_dispatch_claim_matches_job(claim, &current)?;
        require_worker_event_state(&current, &[JobState::Starting, JobState::Cancelling])?;
        let reservation = require_active_job_reservation_matches_job_tx(&transaction, &current)?;
        if reservation.lifecycle_state != "pending" {
            return Err(StoreError::InvalidAdmissionReservationState {
                job_id: claim.identity.job_id.clone(),
                state: reservation.lifecycle_state,
            });
        }
        let now = now_ms();
        let changed = transaction.execute(
            "UPDATE runtime_admission_reservations
             SET lifecycle_state='resident', settled_at=?2, updated_at=?2
             WHERE subject_kind='job' AND subject_id=?1 AND lifecycle_state='pending'",
            params![&claim.identity.job_id, now],
        )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(format!(
                "pending admission reservation for job {} changed while being settled",
                claim.identity.job_id
            )));
        }
        append_event_tx(
            &transaction,
            &claim.identity.job_id,
            claim.identity.attempt,
            Some(&claim.identity.worker_instance_id),
            "reservation-settled",
            &serde_json::json!({ "reservationState": "resident" }),
            now,
        )?;
        transaction.commit()?;
        Ok(claim.identity.clone())
    }

    /// Finalizes a worker-reported failure only after the exact resident tree
    /// has exited. A hard limit, supervisor/cleanup failure, or worker protocol
    /// fault is stronger evidence than the provisional worker-authored failure
    /// and replaces its public terminal classification in the same transaction
    /// that releases the resident admission hold.
    pub fn finalize_reported_worker_failure_after_tree_exit(
        &self,
        tree_exit: &ProcessTreeExit,
    ) -> Result<JobRecord, StoreError> {
        self.require_process_tree_exit_scope(tree_exit)?;
        let identity = tree_exit.worker_identity().cloned().ok_or_else(|| {
            StoreError::InvalidInput(
                "service process-tree exit cannot finalize a worker failure".into(),
            )
        })?;
        identity.validate()?;
        let authoritative_override = match tree_exit.classification() {
            ProcessExitClassification::ResourceExhausted => Some((
                JobState::ResourceExhausted,
                "WORKER_RESOURCE_EXHAUSTED",
                "Worker process tree exhausted its enforced resource limit",
            )),
            ProcessExitClassification::SupervisorFailure => Some((
                JobState::Failed,
                "WORKER_SUPERVISION_FAILED",
                "Worker process tree exited after authoritative supervision failed",
            )),
            ProcessExitClassification::WorkerProtocolFault => Some((
                JobState::Failed,
                "WORKER_PROTOCOL_FAULT",
                "Worker process tree exited after an invalid fenced event stream",
            )),
            ProcessExitClassification::TargetExit | ProcessExitClassification::Stopped => None,
        };

        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &identity.job_id)?;
        require_identity(&current, &identity)?;
        let reservation_state = latest_job_reservation_state_tx(&transaction, &identity.job_id)?
            .ok_or_else(|| StoreError::MissingAdmissionReservation(identity.job_id.clone()))?;
        if reservation_state == "released" {
            if let Some((target, code, message)) = authoritative_override {
                if current.state != target
                    || current.failure_code.as_deref() != Some(code)
                    || current.failure_message.as_deref() != Some(message)
                {
                    return Err(StoreError::CorruptState(identity.job_id.clone()));
                }
            } else if current.state != JobState::Failed || current.cancellation_requested {
                return Err(StoreError::CorruptState(identity.job_id.clone()));
            }
            transaction.commit()?;
            return Ok(current);
        }
        if reservation_state != "resident" {
            return Err(StoreError::InvalidAdmissionReservationState {
                job_id: identity.job_id.clone(),
                state: reservation_state,
            });
        }
        if current.state != JobState::Failed || current.cancellation_requested {
            return Err(StoreError::InvalidInput(format!(
                "job {} has no authoritative worker-reported failure to finalize",
                identity.job_id
            )));
        }
        if completion_intent_tx(&transaction, &identity)?.is_some() {
            return Err(StoreError::PendingCompletionIntent(identity.job_id.clone()));
        }

        let now = now_ms();
        if let Some((target, code, message)) = authoritative_override {
            transaction.execute(
                "UPDATE runtime_jobs SET state=?2, failure_code=?3, failure_message=?4,
                 updated_at=?5, finished_at=?5 WHERE job_id=?1",
                params![identity.job_id, state_name(target), code, message, now],
            )?;
            append_event_tx(
                &transaction,
                &identity.job_id,
                identity.attempt,
                Some(&identity.worker_instance_id),
                state_name(target),
                &serde_json::json!({
                    "code": code,
                    "message": message,
                    "processExitClassification": process_exit_classification_name(
                        tree_exit.classification()
                    )
                }),
                now,
            )?;
        }
        if !release_active_job_reservation_tx(&transaction, &identity.job_id, now)? {
            return Err(StoreError::MissingAdmissionReservation(
                identity.job_id.clone(),
            ));
        }
        append_event_tx(
            &transaction,
            &identity.job_id,
            identity.attempt,
            Some(&identity.worker_instance_id),
            "reservation-released",
            &serde_json::json!({ "reservationState": "released" }),
            now,
        )?;
        let updated = query_job(&transaction, &identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    /// Applies only an event minted by this generation's authoritative process
    /// owner. A protocol value plus a caller-known identity is not durable
    /// mutation authority.
    pub fn apply_owned_worker_event(
        &self,
        event: &OwnedWorkerEvent,
    ) -> Result<JobRecord, StoreError> {
        if !event.matches_generation_scope(&self.generation_scope) {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        self.apply_worker_event_inner(event.event())
    }

    /// Unit tests exercise raw event semantics without opening a public path
    /// around the process-owner authority required in production.
    #[cfg(test)]
    fn apply_worker_event(&self, event: &WorkerEvent) -> Result<JobRecord, StoreError> {
        self.apply_worker_event_inner(event)
    }

    fn apply_worker_event_inner(&self, event: &WorkerEvent) -> Result<JobRecord, StoreError> {
        event.validate()?;
        let identity = event.identity();
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &identity.job_id)?;
        require_identity(&current, identity)?;
        let now = now_ms();
        let payload = serde_json::to_value(event).map_err(|_| StoreError::WorkerEventRejected)?;
        let payload_json =
            canonical_json_string(&payload).map_err(|_| StoreError::WorkerEventRejected)?;
        if payload_json.len() > MAX_PROTOCOL_LINE_BYTES {
            return Err(StoreError::WorkerEventRejected);
        }
        let sequence = event.sequence();
        if sequence <= current.last_worker_sequence {
            let persisted = persisted_worker_event_tx(&transaction, identity, sequence)?;
            if persisted.as_deref() == Some(payload_json.as_str()) {
                transaction.commit()?;
                return Ok(current);
            }
            return Err(StoreError::ConflictingWorkerEvent {
                job_id: identity.job_id.clone(),
                sequence,
            });
        }
        let expected_sequence = current.last_worker_sequence.checked_add(1).ok_or_else(|| {
            StoreError::CorruptState(format!(
                "job {} exhausted its worker event sequence",
                current.job_id
            ))
        })?;
        if sequence != expected_sequence {
            return Err(StoreError::OutOfOrderWorkerEvent {
                job_id: identity.job_id.clone(),
                expected: expected_sequence,
                actual: sequence,
            });
        }
        let cancellation_wins = current.state == JobState::Cancelling;
        if cancellation_wins && !current.cancellation_requested {
            return Err(StoreError::CorruptState(identity.job_id.clone()));
        }
        if cancellation_wins {
            let ready_accepted = worker_ready_accepted_tx(&transaction, identity)?;
            if ready_accepted && current.last_worker_sequence == 0 {
                return Err(StoreError::CorruptState(identity.job_id.clone()));
            }
            if matches!(event, WorkerEvent::Ready { .. })
                && (ready_accepted || current.last_worker_sequence != 0)
            {
                return Err(StoreError::WorkerEventRejected);
            }
            if matches!(
                event,
                WorkerEvent::Heartbeat { .. }
                    | WorkerEvent::Progress { .. }
                    | WorkerEvent::Checkpoint { .. }
                    | WorkerEvent::Artifact { .. }
                    | WorkerEvent::Complete { .. }
            ) && !ready_accepted
            {
                return Err(StoreError::WorkerEventRejected);
            }
        }
        if !cancellation_wins {
            if let Some(intent) = completion_intent_tx(&transaction, identity)? {
                if intent.sequence != current.last_worker_sequence {
                    return Err(StoreError::CorruptState(identity.job_id.clone()));
                }
                return Err(StoreError::WorkerEventAfterCompletionIntent(
                    identity.job_id.clone(),
                ));
            }
        }

        match event {
            WorkerEvent::Ready { .. } => {
                require_worker_event_state(&current, &[JobState::Starting, JobState::Cancelling])?;
                let reservation =
                    require_active_job_reservation_matches_job_tx(&transaction, &current)?;
                if reservation.lifecycle_state != "resident" {
                    return Err(StoreError::InvalidAdmissionReservationState {
                        job_id: identity.job_id.clone(),
                        state: reservation.lifecycle_state,
                    });
                }
                if !cancellation_wins {
                    transition_worker_tx(&transaction, &current, JobState::Running, now)?;
                }
                transaction.execute(
                    "UPDATE runtime_jobs SET last_heartbeat_at=?2 WHERE job_id=?1",
                    params![identity.job_id, now],
                )?;
            }
            WorkerEvent::Heartbeat { stage, .. } => {
                require_worker_event_state(
                    &current,
                    &[
                        JobState::Running,
                        JobState::Checkpointing,
                        JobState::Cancelling,
                    ],
                )?;
                let state = if current.state == JobState::Checkpointing {
                    "running"
                } else {
                    state_name(current.state)
                };
                transaction.execute(
                    "UPDATE runtime_jobs SET state=?2, stage=?3, last_heartbeat_at=?4, updated_at=?4 WHERE job_id=?1",
                    params![identity.job_id, state, stage, now],
                )?;
            }
            WorkerEvent::Progress {
                stage,
                current: progress_current,
                total,
                ..
            } => {
                require_worker_event_state(
                    &current,
                    &[
                        JobState::Running,
                        JobState::Checkpointing,
                        JobState::Cancelling,
                    ],
                )?;
                let progress_current = u64_to_i64(*progress_current, "progress current")
                    .map_err(|_| StoreError::WorkerEventRejected)?;
                let total = u64_to_i64(*total, "progress total")
                    .map_err(|_| StoreError::WorkerEventRejected)?;
                transaction.execute(
                    "UPDATE runtime_jobs SET stage=?2, progress_current=?3, progress_total=?4,
                     last_heartbeat_at=?5, updated_at=?5 WHERE job_id=?1",
                    params![identity.job_id, stage, progress_current, total, now],
                )?;
            }
            WorkerEvent::Checkpoint { kind, path, .. } => {
                require_worker_event_state(
                    &current,
                    &[
                        JobState::Running,
                        JobState::Checkpointing,
                        JobState::Cancelling,
                    ],
                )?;
                require_path_in_job_namespace(&current.job_id, path)
                    .map_err(|_| StoreError::WorkerEventRejected)?;
                if current.state == JobState::Running {
                    validate_transition(current.state, JobState::Checkpointing)?;
                }
                transaction.execute(
                    "UPDATE runtime_jobs SET state=CASE WHEN state='running' THEN 'checkpointing' ELSE state END,
                     checkpoint_path=?2, last_heartbeat_at=?3, updated_at=?3 WHERE job_id=?1",
                    params![identity.job_id, path, now],
                )?;
                transaction.execute(
                    "INSERT INTO runtime_job_checkpoints
                     (job_id, attempt, worker_instance_id, kind, path, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        identity.job_id,
                        identity.attempt,
                        identity.worker_instance_id,
                        kind,
                        path,
                        now,
                    ],
                )?;
            }
            WorkerEvent::Artifact { path, .. } => {
                require_worker_event_state(
                    &current,
                    &[
                        JobState::Running,
                        JobState::Checkpointing,
                        JobState::Cancelling,
                    ],
                )?;
                require_path_in_job_namespace(&current.job_id, path)
                    .map_err(|_| StoreError::WorkerEventRejected)?;
                transaction.execute(
                    "UPDATE runtime_jobs SET last_heartbeat_at=?2, updated_at=?2 WHERE job_id=?1",
                    params![identity.job_id, now],
                )?;
            }
            WorkerEvent::Complete { result_path, .. } => {
                require_worker_event_state(
                    &current,
                    &[
                        JobState::Running,
                        JobState::Checkpointing,
                        JobState::Cancelling,
                    ],
                )?;
                require_exact_job_result_path(&current, result_path)
                    .map_err(|_| StoreError::WorkerEventRejected)?;
                transaction.execute(
                    "UPDATE runtime_jobs SET last_heartbeat_at=?2, updated_at=?2 WHERE job_id=?1",
                    params![identity.job_id, now],
                )?;
            }
            WorkerEvent::Failed { code, message, .. } => {
                require_worker_event_state(
                    &current,
                    &[
                        JobState::Starting,
                        JobState::Running,
                        JobState::Checkpointing,
                        JobState::Cancelling,
                    ],
                )?;
                if cancellation_wins {
                    transaction.execute(
                        "UPDATE runtime_jobs SET last_heartbeat_at=?2, updated_at=?2 WHERE job_id=?1",
                        params![identity.job_id, now],
                    )?;
                } else {
                    transition_worker_tx(&transaction, &current, JobState::Failed, now)?;
                    transaction.execute(
                        "UPDATE runtime_jobs SET failure_code=?2, failure_message=?3, finished_at=?4,
                         last_heartbeat_at=?4 WHERE job_id=?1",
                        params![identity.job_id, code, message, now],
                    )?;
                }
            }
            WorkerEvent::CancellationAcknowledged { .. } => {
                require_worker_event_state(&current, &[JobState::Cancelling])?;
                transaction.execute(
                    "UPDATE runtime_jobs SET last_heartbeat_at=?2, updated_at=?2 WHERE job_id=?1",
                    params![identity.job_id, now],
                )?;
            }
        }
        transaction.execute(
            "UPDATE runtime_jobs SET last_worker_sequence=?2 WHERE job_id=?1",
            params![
                identity.job_id,
                u64_to_i64(sequence, "worker event sequence")
                    .map_err(|_| StoreError::WorkerEventRejected)?
            ],
        )?;
        append_worker_event_tx(
            &transaction,
            identity,
            sequence,
            persisted_worker_event_name(event, cancellation_wins),
            &payload_json,
            now,
        )?;
        let updated = query_job(&transaction, &identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    /// Publishes success only from the opaque evidence minted inside the core
    /// process-owner boundary after complete-tree exit and an exact trusted-
    /// handle result reopen. Workers, routes, renderers, and downstream crates
    /// cannot construct or deserialize this proof.
    pub fn confirm_worker_completion(
        &self,
        proof: &WorkerCompletionProof,
    ) -> Result<JobRecord, StoreError> {
        if !proof.matches_generation_scope(&self.generation_scope) {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        let terminal_accounting = proof.terminal_accounting();
        self.confirm_validated_worker_completion(
            proof.identity(),
            proof.completion_sequence(),
            proof.result(),
            Some(terminal_accounting),
            Some(proof),
        )
    }

    /// Rejects a durable completion intent after the authoritative owner has
    /// proved the exact worker tree empty but result validation could not mint
    /// `WorkerCompletionProof`. The pending intent is fenced and the failed
    /// terminal transition and reservation release commit atomically.
    pub fn reject_worker_completion_after_tree_exit(
        &self,
        tree_exit: &ProcessTreeExit,
    ) -> Result<JobRecord, StoreError> {
        self.require_process_tree_exit_scope(tree_exit)?;
        let code = "WORKER_COMPLETION_VALIDATION_FAILED";
        let message = "Durable worker completion could not be validated after process-tree exit";
        let identity = tree_exit.worker_identity().cloned().ok_or_else(|| {
            StoreError::InvalidInput(
                "service process-tree exit cannot reject worker completion".into(),
            )
        })?;
        identity.validate()?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &identity.job_id)?;
        require_identity(&current, &identity)?;
        if matches!(current.state, JobState::Cancelling | JobState::Cancelled) {
            confirm_cancelled_tx(&transaction, &current, &identity)?;
            let updated = query_job(&transaction, &identity.job_id)?;
            transaction.commit()?;
            return Ok(updated);
        }
        if current.cancellation_requested {
            return Err(StoreError::CorruptState(identity.job_id.clone()));
        }
        if current.state == JobState::Failed
            && current.failure_code.as_deref() == Some(code)
            && current.failure_message.as_deref() == Some(message)
        {
            let intent = completion_intent_tx(&transaction, &identity)?
                .ok_or_else(|| StoreError::CorruptState(identity.job_id.clone()))?;
            if intent.sequence != current.last_worker_sequence
                || completion_confirmation_tx(&transaction, &identity)?.is_some()
                || latest_job_reservation_state_tx(&transaction, &identity.job_id)?.as_deref()
                    != Some("released")
            {
                return Err(StoreError::CorruptState(identity.job_id));
            }
            transaction.commit()?;
            return Ok(current);
        }
        validate_completion_confirmation(current.state)?;
        if completion_confirmation_tx(&transaction, &identity)?.is_some() {
            return Err(StoreError::CorruptState(identity.job_id));
        }
        let intent = completion_intent_tx(&transaction, &identity)?
            .ok_or_else(|| StoreError::MissingCompletionIntent(identity.job_id.clone()))?;
        if intent.sequence != current.last_worker_sequence {
            return Err(StoreError::CorruptState(identity.job_id));
        }
        require_exact_job_result_path(&current, intent.result_path())
            .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
        let reservation = require_active_job_reservation_matches_job_tx(&transaction, &current)?;
        if reservation.lifecycle_state != "resident" {
            return Err(StoreError::InvalidAdmissionReservationState {
                job_id: identity.job_id,
                state: reservation.lifecycle_state,
            });
        }

        let now = now_ms();
        transaction.execute(
            "UPDATE runtime_jobs SET state='failed', failure_code=?2, failure_message=?3,
             updated_at=?4, finished_at=?4 WHERE job_id=?1",
            params![identity.job_id, code, message, now],
        )?;
        append_event_tx(
            &transaction,
            &identity.job_id,
            identity.attempt,
            Some(&identity.worker_instance_id),
            "failed",
            &serde_json::json!({
                "code": code,
                "message": message,
                "completionSequence": intent.sequence,
                "treeExited": true
            }),
            now,
        )?;
        if !release_active_job_reservation_tx(&transaction, &identity.job_id, now)? {
            return Err(StoreError::MissingAdmissionReservation(
                identity.job_id.clone(),
            ));
        }
        append_event_tx(
            &transaction,
            &identity.job_id,
            identity.attempt,
            Some(&identity.worker_instance_id),
            "reservation-released",
            &serde_json::json!({
                "reservationState": "released",
                "reason": "completion-validation-failed"
            }),
            now,
        )?;
        let updated = query_job(&transaction, &identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    fn confirm_validated_worker_completion(
        &self,
        identity: &WorkerIdentity,
        completion_sequence: u64,
        result: &ValidatedWorkerResult,
        terminal_accounting: Option<(u32, u32, ProcessTreeAccounting)>,
        completion_proof: Option<&WorkerCompletionProof>,
    ) -> Result<JobRecord, StoreError> {
        identity.validate()?;
        result.validate()?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &identity.job_id)?;
        require_identity(&current, identity)?;
        require_exact_job_result_path(&current, result.result_path())?;

        if terminal_accounting.is_some()
            && matches!(current.state, JobState::Cancelling | JobState::Cancelled)
        {
            confirm_cancelled_tx(&transaction, &current, identity)?;
            let updated = query_job(&transaction, &identity.job_id)?;
            transaction.commit()?;
            return Ok(updated);
        }
        if current.cancellation_requested {
            return Err(StoreError::CorruptState(identity.job_id.clone()));
        }

        if current.state == JobState::Succeeded {
            let intent = completion_intent_tx(&transaction, identity)?
                .ok_or_else(|| StoreError::CorruptState(identity.job_id.clone()))?;
            if intent.sequence != current.last_worker_sequence
                || intent.sequence != completion_sequence
            {
                return Err(StoreError::CorruptState(identity.job_id.clone()));
            }
            require_exact_job_result_path(&current, intent.result_path())
                .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
            match completion_confirmation_tx(&transaction, identity)? {
                Some(existing)
                    if existing.completion_sequence == intent.sequence
                        && &existing.result == result
                        && existing.terminal_accounting == terminal_accounting =>
                {
                    revalidate_completion_result_before_commit(
                        completion_proof,
                        identity,
                        completion_sequence,
                        result,
                    )?;
                    transaction.commit()?;
                    return Ok(current);
                }
                _ => {
                    return Err(StoreError::ConflictingCompletionEvidence(
                        identity.job_id.clone(),
                    ))
                }
            }
        }
        if completion_confirmation_tx(&transaction, identity)?.is_some() {
            return Err(StoreError::CorruptState(identity.job_id.clone()));
        }

        validate_completion_confirmation(current.state)?;
        let intent = completion_intent_tx(&transaction, identity)?
            .ok_or_else(|| StoreError::MissingCompletionIntent(identity.job_id.clone()))?;
        if intent.sequence != current.last_worker_sequence || intent.sequence != completion_sequence
        {
            return Err(StoreError::CorruptState(identity.job_id.clone()));
        }
        if normalized_relative_path(&intent.result_path)
            != normalized_relative_path(result.result_path())
        {
            return Err(StoreError::ConflictingCompletionEvidence(
                identity.job_id.clone(),
            ));
        }
        let reservation = require_active_job_reservation_matches_job_tx(&transaction, &current)?;
        if reservation.lifecycle_state != "resident" {
            return Err(StoreError::InvalidAdmissionReservationState {
                job_id: identity.job_id.clone(),
                state: reservation.lifecycle_state,
            });
        }

        // Keep the exact no-share-write/no-share-delete result handle alive
        // while this IMMEDIATE transaction is open, and re-read that handle at
        // the last point before success is durably published. Cancellation is
        // deliberately settled above without consulting result bytes.
        revalidate_completion_result_before_commit(
            completion_proof,
            identity,
            completion_sequence,
            result,
        )?;
        let now = now_ms();
        transaction.execute(
            "UPDATE runtime_jobs SET state='succeeded', failure_code=NULL, failure_message=NULL,
             updated_at=?2, finished_at=?2 WHERE job_id=?1",
            params![identity.job_id, now],
        )?;
        append_event_tx(
            &transaction,
            &identity.job_id,
            identity.attempt,
            Some(&identity.worker_instance_id),
            "completion-confirmed",
            &serde_json::json!({
                "completionSequence": intent.sequence,
                "durableResultValidated": true,
                "resultPath": result.result_path(),
                "resultSha256": result.sha256(),
                "resultSizeBytes": result.size_bytes(),
                "treeExited": true,
                "supervisorPid": terminal_accounting.map(|value| value.0),
                "rootPid": terminal_accounting.map(|value| value.1),
                "peakPrivateCommitBytes": terminal_accounting
                    .and_then(|value| value.2.peak_private_commit_bytes),
                "peakAccountingComplete": terminal_accounting.map(|value| value.2.complete)
            }),
            now,
        )?;
        if !release_active_job_reservation_tx(&transaction, &identity.job_id, now)? {
            return Err(StoreError::MissingAdmissionReservation(
                identity.job_id.clone(),
            ));
        }
        append_event_tx(
            &transaction,
            &identity.job_id,
            identity.attempt,
            Some(&identity.worker_instance_id),
            "reservation-released",
            &serde_json::json!({
                "reservationState": "released",
                "reason": "confirmed-completion"
            }),
            now,
        )?;
        let updated = query_job(&transaction, &identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    /// Returns durable, confirmable completion intents that a newly started
    /// authoritative runtime may validate before it performs restart
    /// reconciliation. A later cancellation request wins the durable ordering,
    /// so intents on `cancelling` jobs are deliberately left for cancellation
    /// reconciliation rather than returned through an API that cannot confirm
    /// them.
    pub fn pending_worker_completion_intents_for_recovery(
        &self,
    ) -> Result<Vec<WorkerCompletionIntent>, StoreError> {
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let mut statement = transaction.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM runtime_jobs
             WHERE state IN ('running','checkpointing')
             ORDER BY created_at"
        ))?;
        let jobs = statement
            .query_map([], row_to_job)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let mut intents = Vec::new();
        for job in jobs {
            let Some(identity) = job.identity() else {
                continue;
            };
            if let Some(intent) = completion_intent_tx(&transaction, &identity)? {
                if completion_confirmation_tx(&transaction, &identity)?.is_some() {
                    return Err(StoreError::CorruptState(job.job_id));
                }
                if intent.sequence != job.last_worker_sequence {
                    return Err(StoreError::CorruptState(job.job_id));
                }
                require_exact_job_result_path(&job, intent.result_path())
                    .map_err(|_| StoreError::CorruptState(job.job_id.clone()))?;
                intents.push(intent);
            }
        }
        transaction.commit()?;
        Ok(intents)
    }

    /// Cancels queued and admitted jobs to a terminal state in this one
    /// transaction because their attempt-zero rows prove no worker identity
    /// was assigned. Any assigned attempt only enters `cancelling`; its hold is
    /// retained until the process owner supplies authoritative tree-exit
    /// evidence, including when that hold is still pending rather than resident.
    pub fn request_cancellation(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<JobRecord, StoreError> {
        context.validate()?;
        let owner = context.owner();
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_owned_job(
            &transaction,
            owner,
            context.garden_id(),
            context.conversation_id(),
            job_id,
        )?;
        if current.state.is_terminal() {
            transaction.commit()?;
            return Ok(current);
        }
        if matches!(current.state, JobState::Queued | JobState::Admitted)
            || (current.state == JobState::Cancelling && current.identity().is_none())
        {
            cancel_unstarted_job_tx(&transaction, &current)?;
            let updated = query_owned_job(
                &transaction,
                owner,
                context.garden_id(),
                context.conversation_id(),
                job_id,
            )?;
            transaction.commit()?;
            return Ok(updated);
        }
        if current.state == JobState::Cancelling {
            // An assigned attempt remains receipt-gated even if its admission
            // reservation is still pending. Requesting cancellation must never
            // infer that the process tree failed to become resident or release
            // its hold without authoritative zero-resident evidence.
            current
                .identity()
                .ok_or_else(|| StoreError::CorruptState(current.job_id.clone()))?;
            require_active_job_reservation_matches_job_tx(&transaction, &current)?;
            transaction.commit()?;
            return Ok(current);
        }
        current
            .identity()
            .ok_or_else(|| StoreError::CorruptState(current.job_id.clone()))?;
        require_active_job_reservation_matches_job_tx(&transaction, &current)?;
        validate_transition(current.state, JobState::Cancelling)?;
        let now = now_ms();
        transaction.execute(
            "UPDATE runtime_jobs SET state='cancelling', cancellation_requested=1, updated_at=?5
             WHERE job_id=?1 AND owner_principal=?2
               AND garden_id IS ?3 AND conversation_id IS ?4",
            params![
                job_id,
                owner.principal(),
                context.garden_id(),
                context.conversation_id(),
                now,
            ],
        )?;
        append_event_tx(
            &transaction,
            job_id,
            current.attempt,
            current.worker_instance_id.as_deref(),
            "cancellation-requested",
            &serde_json::json!({ "state": "cancelling" }),
            now,
        )?;
        let updated = query_owned_job(
            &transaction,
            owner,
            context.garden_id(),
            context.conversation_id(),
            job_id,
        )?;
        transaction.commit()?;
        Ok(updated)
    }

    /// Borrows the zero-resident receipt for the exact cancelling
    /// worker. Cancellation becomes terminal and its resident reservation is
    /// released in the same transaction.
    pub fn confirm_cancelled(&self, tree_exit: &ProcessTreeExit) -> Result<JobRecord, StoreError> {
        self.require_process_tree_exit_scope(tree_exit)?;
        let identity = tree_exit.worker_identity().cloned().ok_or_else(|| {
            StoreError::InvalidInput(
                "service process-tree exit cannot confirm worker cancellation".into(),
            )
        })?;
        identity.validate()?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &identity.job_id)?;
        require_identity(&current, &identity)?;
        confirm_cancelled_tx(&transaction, &current, &identity)?;
        let updated = query_job(&transaction, &identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    /// Call only after the complete fenced worker tree, not merely its root
    /// process, has exited without a valid terminal event.
    pub fn worker_exited_without_terminal(
        &self,
        tree_exit: &ProcessTreeExit,
    ) -> Result<JobRecord, StoreError> {
        self.require_process_tree_exit_scope(tree_exit)?;
        let (target, code, message) = match tree_exit.classification() {
            ProcessExitClassification::ResourceExhausted => (
                JobState::ResourceExhausted,
                "WORKER_RESOURCE_EXHAUSTED",
                "Worker process tree exhausted its enforced resource limit",
            ),
            ProcessExitClassification::WorkerProtocolFault => (
                JobState::Failed,
                "WORKER_PROTOCOL_FAULT",
                "Worker process tree exited after an invalid fenced event stream",
            ),
            ProcessExitClassification::SupervisorFailure => (
                JobState::Failed,
                "WORKER_SUPERVISION_FAILED",
                "Worker process tree exited after authoritative supervision failed",
            ),
            ProcessExitClassification::Stopped => (
                JobState::Interrupted,
                "WORKER_STOPPED_WITHOUT_TERMINAL_EVENT",
                "Worker process tree stopped without a valid terminal event",
            ),
            ProcessExitClassification::TargetExit => (
                JobState::Failed,
                "WORKER_EXIT_WITHOUT_TERMINAL_EVENT",
                "Worker exited without a valid terminal event",
            ),
        };
        self.worker_terminal_transition(tree_exit, target, code, message)
    }

    /// Records a failure that occurred after admission but before a worker
    /// identity or owned tree existed. Because no work became resident, the
    /// pending reservation is released in the same transaction.
    pub fn worker_start_failed_before_assignment(
        &self,
        job_id: &str,
        resource_exhausted: bool,
    ) -> Result<JobRecord, StoreError> {
        validate_identifier("jobId", job_id)?;
        let target = if resource_exhausted {
            JobState::ResourceExhausted
        } else {
            JobState::Interrupted
        };
        let code = if resource_exhausted {
            "WORKER_START_RESOURCE_EXHAUSTED"
        } else {
            "WORKER_START_FAILED"
        };
        let message = "Worker failed to start before process-tree assignment";
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, job_id)?;
        if current.attempt != 0 || current.worker_instance_id.is_some() {
            return Err(StoreError::InvalidInput(format!(
                "job {job_id} already has a worker identity"
            )));
        }
        validate_transition(current.state, target)?;
        require_pending_job_reservation_tx(&transaction, &current)?;
        let now = now_ms();
        transaction.execute(
            "UPDATE runtime_jobs SET state=?2, failure_code=?3, failure_message=?4,
             updated_at=?5, finished_at=?5 WHERE job_id=?1",
            params![job_id, state_name(target), code, message, now],
        )?;
        append_event_tx(
            &transaction,
            job_id,
            current.attempt,
            None,
            state_name(target),
            &serde_json::json!({ "code": code, "message": message }),
            now,
        )?;
        release_active_job_reservation_tx(&transaction, job_id, now)?;
        append_event_tx(
            &transaction,
            job_id,
            current.attempt,
            None,
            "reservation-released",
            &serde_json::json!({ "reservationState": "released" }),
            now,
        )?;
        let updated = query_job(&transaction, job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    /// Finalizes only an opaque claim-owned proof minted before CreateProcess.
    /// The failure class is derived from the actual launch error rather than a
    /// caller-selected release reason. Every database error returns the exact
    /// proof intact for retry.
    pub fn finish_worker_not_created(
        &self,
        authority: WorkerLaunchNotCreated,
    ) -> Result<JobRecord, WorkerStoreTransitionError<WorkerLaunchNotCreated>> {
        let disposition = pre_residency_disposition_for_launch_error(authority.error());
        match self.finish_worker_claim_before_residency_inner(authority.claim(), disposition) {
            Ok(job) => Ok(job),
            Err(error) => Err(WorkerStoreTransitionError {
                authority: Box::new(authority),
                error,
            }),
        }
    }

    #[cfg(test)]
    fn finish_worker_claim_before_residency(
        &self,
        claim: WorkerDispatchClaim,
        disposition: PreResidencyClaimDisposition,
    ) -> Result<JobRecord, StoreError> {
        self.finish_worker_claim_before_residency_inner(&claim, disposition)
    }

    fn finish_worker_claim_before_residency_inner(
        &self,
        claim: &WorkerDispatchClaim,
        disposition: PreResidencyClaimDisposition,
    ) -> Result<JobRecord, StoreError> {
        if claim.generation_scope != self.generation_scope {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        claim.identity.validate()?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &claim.identity.job_id)?;
        require_identity(&current, &claim.identity)?;
        if current.request_digest != claim.job.request_digest
            || current.workspace_path != claim.job.workspace_path
            || current.workspace_path != worker_attempt_workspace_path(&claim.identity)?
        {
            return Err(StoreError::StaleWorker(claim.identity.job_id.clone()));
        }
        require_worker_event_state(&current, &[JobState::Starting, JobState::Cancelling])?;
        match current.state {
            JobState::Starting if current.cancellation_requested => {
                return Err(StoreError::CorruptState(current.job_id.clone()))
            }
            JobState::Cancelling if !current.cancellation_requested => {
                return Err(StoreError::CorruptState(current.job_id.clone()))
            }
            _ => {}
        }
        require_pending_job_reservation_tx(&transaction, &current)?;

        #[cfg(test)]
        let caller_selected_test_cancellation =
            disposition == PreResidencyClaimDisposition::Cancellation;
        #[cfg(not(test))]
        let caller_selected_test_cancellation = false;
        let cancellation_wins =
            current.state == JobState::Cancelling || caller_selected_test_cancellation;
        let now = now_ms();
        if cancellation_wins && current.state == JobState::Starting {
            validate_transition(JobState::Starting, JobState::Cancelling)?;
            let changed = transaction.execute(
                "UPDATE runtime_jobs SET state='cancelling', cancellation_requested=1, updated_at=?5
                 WHERE job_id=?1 AND state='starting' AND attempt=?2
                   AND worker_instance_id=?3 AND workspace_path=?4
                   AND cancellation_requested=0",
                params![
                    &claim.identity.job_id,
                    claim.identity.attempt,
                    &claim.identity.worker_instance_id,
                    &current.workspace_path,
                    now,
                ],
            )?;
            if changed != 1 {
                return Err(StoreError::StaleWorker(claim.identity.job_id.clone()));
            }
            append_event_tx(
                &transaction,
                &claim.identity.job_id,
                claim.identity.attempt,
                Some(&claim.identity.worker_instance_id),
                "cancellation-requested",
                &serde_json::json!({
                    "state": "cancelling",
                    "code": "WORKER_CANCELLED_BEFORE_TREE_RESIDENCY",
                    "treeBecameResident": false,
                }),
                now,
            )?;
        }

        let (target, code, message, release_reason) = if cancellation_wins {
            (
                JobState::Cancelled,
                "WORKER_CANCELLED_BEFORE_TREE_RESIDENCY",
                "Worker dispatch was cancelled before authoritative tree residency",
                "cancelled-before-tree-residency",
            )
        } else {
            match disposition {
                PreResidencyClaimDisposition::SpawnFailed => (
                    JobState::Interrupted,
                    "WORKER_START_FAILED_BEFORE_TREE_RESIDENCY",
                    "Worker failed to start before authoritative tree residency",
                    "spawn-failed-before-tree-residency",
                ),
                PreResidencyClaimDisposition::SpawnResourceExhausted => (
                    JobState::ResourceExhausted,
                    "WORKER_START_RESOURCE_EXHAUSTED_BEFORE_TREE_RESIDENCY",
                    "Worker start exhausted resources before authoritative tree residency",
                    "spawn-resource-exhausted-before-tree-residency",
                ),
                #[cfg(test)]
                PreResidencyClaimDisposition::Cancellation => unreachable!(
                    "the cancellation disposition always selects the cancellation path"
                ),
            }
        };
        let expected_state = if cancellation_wins {
            validate_transition(JobState::Cancelling, JobState::Cancelled)?;
            "cancelling"
        } else {
            validate_transition(JobState::Starting, target)?;
            "starting"
        };
        let (failure_code, failure_message): (Option<&str>, Option<&str>) = if cancellation_wins {
            (None, None)
        } else {
            (Some(code), Some(message))
        };
        let changed = transaction.execute(
            "UPDATE runtime_jobs SET state=?5, failure_code=?6, failure_message=?7,
             updated_at=?8, finished_at=?8
             WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
               AND workspace_path=?4 AND state=?9
               AND cancellation_requested=?10",
            params![
                &claim.identity.job_id,
                claim.identity.attempt,
                &claim.identity.worker_instance_id,
                &current.workspace_path,
                state_name(target),
                failure_code,
                failure_message,
                now,
                expected_state,
                cancellation_wins,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::StaleWorker(claim.identity.job_id.clone()));
        }
        append_event_tx(
            &transaction,
            &claim.identity.job_id,
            claim.identity.attempt,
            Some(&claim.identity.worker_instance_id),
            state_name(target),
            &serde_json::json!({
                "state": state_name(target),
                "code": code,
                "message": message,
                "treeBecameResident": false,
            }),
            now,
        )?;
        let released = transaction.execute(
            "UPDATE runtime_admission_reservations
             SET lifecycle_state='released', released_at=?2, updated_at=?2
             WHERE subject_kind='job' AND subject_id=?1 AND lifecycle_state='pending'",
            params![&claim.identity.job_id, now],
        )?;
        if released != 1 {
            return Err(StoreError::MissingAdmissionReservation(
                claim.identity.job_id.clone(),
            ));
        }
        append_event_tx(
            &transaction,
            &claim.identity.job_id,
            claim.identity.attempt,
            Some(&claim.identity.worker_instance_id),
            "reservation-released",
            &serde_json::json!({
                "reservationState": "released",
                "reason": release_reason,
                "treeBecameResident": false,
            }),
            now,
        )?;
        let updated = query_job(&transaction, &claim.identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    /// Finalizes a claim only with the exact zero-resident receipt returned by
    /// its coupled live owner. Every store error returns the full pair intact.
    pub fn finish_worker_before_started(
        &self,
        authority: WorkerTreeExitAuthority,
    ) -> Result<JobRecord, WorkerStoreTransitionError<WorkerTreeExitAuthority>> {
        let result = {
            let (claim, tree_exit) = authority.parts();
            self.finish_worker_claim_after_tree_exit_inner(claim, tree_exit)
        };
        match result {
            Ok(job) => Ok(job),
            Err(error) => Err(WorkerStoreTransitionError {
                authority: Box::new(authority),
                error,
            }),
        }
    }

    #[cfg(test)]
    fn finish_worker_claim_after_tree_exit(
        &self,
        claim: WorkerDispatchClaim,
        tree_exit: ProcessTreeExit,
    ) -> Result<JobRecord, StoreError> {
        self.finish_worker_claim_after_tree_exit_inner(&claim, &tree_exit)
    }

    fn finish_worker_claim_after_tree_exit_inner(
        &self,
        claim: &WorkerDispatchClaim,
        tree_exit: &ProcessTreeExit,
    ) -> Result<JobRecord, StoreError> {
        if claim.generation_scope != self.generation_scope
            || !tree_exit.matches_generation_scope(&self.generation_scope)
        {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        let exit_identity = tree_exit.worker_identity().ok_or_else(|| {
            StoreError::InvalidInput(
                "service process-tree exit cannot finish a worker dispatch claim".into(),
            )
        })?;
        if exit_identity != &claim.identity {
            return Err(StoreError::StaleWorker(claim.identity.job_id.clone()));
        }
        if tree_exit.started_boundary_accepted() {
            return Err(StoreError::InvalidInput(
                "a started process-tree exit cannot use the pre-start claim finalizer".into(),
            ));
        }
        let classification = tree_exit.classification();
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &claim.identity.job_id)?;
        require_identity(&current, &claim.identity)?;
        require_dispatch_claim_matches_job(claim, &current)?;
        require_worker_event_state(&current, &[JobState::Starting, JobState::Cancelling])?;
        require_pending_job_reservation_tx(&transaction, &current)?;
        let accepted_worker_events: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM runtime_job_events
             WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
               AND worker_sequence IS NOT NULL",
            params![
                &claim.identity.job_id,
                claim.identity.attempt,
                &claim.identity.worker_instance_id,
            ],
            |row| row.get(0),
        )?;
        if current.last_worker_sequence != 0 || accepted_worker_events != 0 {
            return Err(StoreError::CorruptState(format!(
                "job {} accepted worker data before a pre-start tree exit",
                current.job_id
            )));
        }
        match current.state {
            JobState::Starting if current.cancellation_requested => {
                return Err(StoreError::CorruptState(current.job_id.clone()))
            }
            JobState::Cancelling if !current.cancellation_requested => {
                return Err(StoreError::CorruptState(current.job_id.clone()))
            }
            _ => {}
        }

        let cancellation_wins = current.state == JobState::Cancelling;
        let (target, code, message) = if cancellation_wins {
            (
                JobState::Cancelled,
                "WORKER_CANCELLED_BEFORE_STARTED",
                "Worker dispatch was cancelled before the target started",
            )
        } else {
            match classification {
                ProcessExitClassification::ResourceExhausted => (
                    JobState::ResourceExhausted,
                    "WORKER_START_RESOURCE_EXHAUSTED_BEFORE_STARTED",
                    "Worker process tree exhausted resources before the target started",
                ),
                ProcessExitClassification::Stopped => (
                    JobState::Interrupted,
                    "WORKER_STOPPED_BEFORE_STARTED",
                    "Worker process tree stopped before the target started",
                ),
                ProcessExitClassification::SupervisorFailure => (
                    JobState::Failed,
                    "WORKER_SUPERVISION_FAILED_BEFORE_STARTED",
                    "Authoritative worker supervision failed before the target started",
                ),
                ProcessExitClassification::WorkerProtocolFault => (
                    JobState::Failed,
                    "WORKER_PROTOCOL_FAULT_BEFORE_STARTED",
                    "Worker process tree produced invalid protocol data before started",
                ),
                ProcessExitClassification::TargetExit => (
                    JobState::Failed,
                    "WORKER_EXITED_BEFORE_STARTED",
                    "Worker target exited without an accepted started boundary",
                ),
            }
        };
        validate_transition(current.state, target)?;
        let now = now_ms();
        let (failure_code, failure_message): (Option<&str>, Option<&str>) = if cancellation_wins {
            (None, None)
        } else {
            (Some(code), Some(message))
        };
        let changed = transaction.execute(
            "UPDATE runtime_jobs SET state=?5, failure_code=?6, failure_message=?7,
             updated_at=?8, finished_at=?8
             WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
               AND workspace_path=?4 AND state=?9 AND cancellation_requested=?10",
            params![
                &claim.identity.job_id,
                claim.identity.attempt,
                &claim.identity.worker_instance_id,
                &current.workspace_path,
                state_name(target),
                failure_code,
                failure_message,
                now,
                state_name(current.state),
                cancellation_wins,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::StaleWorker(claim.identity.job_id.clone()));
        }
        append_event_tx(
            &transaction,
            &claim.identity.job_id,
            claim.identity.attempt,
            Some(&claim.identity.worker_instance_id),
            state_name(target),
            &serde_json::json!({
                "state": state_name(target),
                "code": code,
                "message": message,
                "treeExitConfirmed": true,
                "treeBecameResident": false,
                "classification": process_exit_classification_name(classification),
            }),
            now,
        )?;
        let released = transaction.execute(
            "UPDATE runtime_admission_reservations
             SET lifecycle_state='released', released_at=?2, updated_at=?2
             WHERE subject_kind='job' AND subject_id=?1 AND lifecycle_state='pending'",
            params![&claim.identity.job_id, now],
        )?;
        if released != 1 {
            return Err(StoreError::MissingAdmissionReservation(
                claim.identity.job_id.clone(),
            ));
        }
        append_event_tx(
            &transaction,
            &claim.identity.job_id,
            claim.identity.attempt,
            Some(&claim.identity.worker_instance_id),
            "reservation-released",
            &serde_json::json!({
                "reservationState": "released",
                "reason": "tree-exited-before-started",
                "treeExitConfirmed": true,
            }),
            now,
        )?;
        let updated = query_job(&transaction, &claim.identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    pub fn events_after(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<JobEventRecord>, StoreError> {
        context.validate()?;
        let owner = context.owner();
        let bounded = i64::try_from(limit.clamp(1, 1_000))
            .map_err(|_| StoreError::InvalidInput("event limit cannot fit in SQLite".into()))?;
        let connection = self.connection.lock().expect("job store mutex poisoned");
        query_owned_job(
            &connection,
            owner,
            context.garden_id(),
            context.conversation_id(),
            job_id,
        )?;
        query_owned_events_after(
            &connection,
            owner,
            context.garden_id(),
            context.conversation_id(),
            job_id,
            after_sequence,
            bounded,
        )
    }

    /// Reads the owned durable job, a `requested_limit + 1` event page, and
    /// the public-stream seal from one deferred SQLite transaction. A terminal
    /// worker failure remains unsealed while its pending or resident admission
    /// reservation proves that the process-tree owner can still append the
    /// reservation-release event.
    pub fn replay_job_events_snapshot(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
        after_sequence: i64,
        requested_limit: usize,
    ) -> Result<JobEventReplaySnapshot, StoreError> {
        context.validate()?;
        if after_sequence < 0
            || requested_limit == 0
            || requested_limit > MAX_JOB_EVENT_REPLAY_RECORDS
        {
            return Err(StoreError::InvalidInput(
                "event replay query is outside the protocol bound".into(),
            ));
        }
        let source_limit = requested_limit
            .checked_add(1)
            .ok_or_else(|| StoreError::InvalidInput("event replay limit overflowed".into()))?;
        let bounded = i64::try_from(source_limit)
            .map_err(|_| StoreError::InvalidInput("event limit cannot fit in SQLite".into()))?;
        let owner = context.owner();
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let job = query_owned_job(
            &transaction,
            owner,
            context.garden_id(),
            context.conversation_id(),
            job_id,
        )?;
        let public_event_stream_sealed =
            job.state.is_terminal() && active_job_reservation_tx(&transaction, job_id)?.is_none();
        let events = query_owned_events_after(
            &transaction,
            owner,
            context.garden_id(),
            context.conversation_id(),
            job_id,
            after_sequence,
            bounded,
        )?;
        transaction.commit()?;
        Ok(JobEventReplaySnapshot {
            job,
            events,
            public_event_stream_sealed,
        })
    }

    pub fn checkpoints(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<Vec<CheckpointRecord>, StoreError> {
        context.validate()?;
        let owner = context.owner();
        let connection = self.connection.lock().expect("job store mutex poisoned");
        query_owned_job(
            &connection,
            owner,
            context.garden_id(),
            context.conversation_id(),
            job_id,
        )?;
        let mut statement = connection.prepare(
            "SELECT sequence, job_id, attempt, worker_instance_id, kind, path, created_at
             FROM runtime_job_checkpoints
             WHERE job_id=?1
               AND EXISTS (
                   SELECT 1 FROM runtime_jobs
                   WHERE runtime_jobs.job_id=runtime_job_checkpoints.job_id
                     AND owner_principal=?2
                     AND garden_id IS ?3
                     AND conversation_id IS ?4
               )
             ORDER BY sequence ASC",
        )?;
        let rows = statement.query_map(
            params![
                job_id,
                owner.principal(),
                context.garden_id(),
                context.conversation_id(),
            ],
            |row| {
                Ok(CheckpointRecord {
                    sequence: row.get(0)?,
                    job_id: row.get(1)?,
                    attempt: i64_to_u32(row.get(2)?, 2, "checkpoint attempt")?,
                    worker_instance_id: row.get(3)?,
                    kind: row.get(4)?,
                    path: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    /// Reconciles durable state only after consuming the one-shot proof that
    /// the prior generation for this store's exact pinned data root reached
    /// zero resident processes. A proof for any other root is rejected before
    /// the database transaction begins. Before calling, the runtime inspects
    /// completion intents; any intent lacking a surviving authoritative
    /// process-owner proof remains uncertain and is never blindly retried.
    pub fn reconcile_after_runtime_restart(
        &self,
        prior_generation_drained: PriorGenerationDrained,
    ) -> Result<Vec<JobRecord>, StoreError> {
        if !prior_generation_drained.matches_scope(&self.generation_scope) {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        self.reconcile_after_runtime_restart_authorized()
    }

    /// Mints an explicit one-shot restart proof for source tests. Unlike the
    /// production proof this carries no kernel authority, but it remains bound
    /// to the exact store scope and cannot bypass mismatch checks.
    #[cfg(test)]
    pub(crate) fn prior_generation_drained_for_test(&self) -> RuntimeRestartProofForTest {
        RuntimeRestartProofForTest {
            scope: self.generation_scope.clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn reconcile_after_runtime_restart_for_test(
        &self,
        proof: RuntimeRestartProofForTest,
    ) -> Result<Vec<JobRecord>, StoreError> {
        if proof.scope != self.generation_scope {
            return Err(StoreError::GenerationAuthorityMismatch);
        }
        self.reconcile_after_runtime_restart_authorized()
    }

    fn reconcile_after_runtime_restart_authorized(&self) -> Result<Vec<JobRecord>, StoreError> {
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut statement = transaction.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM runtime_jobs
             WHERE state IN ('starting','running','checkpointing','cancelling') ORDER BY created_at"
        ))?;
        let jobs = statement
            .query_map([], row_to_job)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let now = now_ms();
        let mut reconciled = Vec::with_capacity(jobs.len());
        for job in jobs {
            let identity = job.identity();
            if !matches!(job.state, JobState::Cancelling) && identity.is_none() {
                return Err(StoreError::CorruptState(job.job_id));
            }
            let completion_intent = match &identity {
                Some(identity) => completion_intent_tx(&transaction, identity)?,
                None => None,
            };
            if let Some(identity) = &identity {
                if completion_confirmation_tx(&transaction, identity)?.is_some() {
                    return Err(StoreError::CorruptState(job.job_id));
                }
            }
            if let Some(intent) = &completion_intent {
                if intent.sequence > job.last_worker_sequence
                    || (job.state != JobState::Cancelling
                        && intent.sequence != job.last_worker_sequence)
                {
                    return Err(StoreError::CorruptState(job.job_id));
                }
                require_exact_job_result_path(&job, &intent.result_path)
                    .map_err(|_| StoreError::CorruptState(job.job_id.clone()))?;
            }
            let checkpoint_path = match &identity {
                Some(identity) => latest_checkpoint_for_attempt_tx(&transaction, identity)?,
                None => None,
            };
            let latest_worker_event = match &identity {
                Some(identity) => {
                    latest_worker_event_name_tx(&transaction, identity, job.last_worker_sequence)?
                }
                None => None,
            };

            // Provider-call receipts do not yet have a trusted durable writer
            // in this schema. Until that exists, a running attempt without a
            // completion intent or checkpoint stays explicitly uncertain; it
            // must never be inferred safe to retry from an absent receipt.
            let (target, code, message, payload) = match job.state {
                JobState::Cancelling => (
                    JobState::Cancelled,
                    None,
                    None,
                    serde_json::json!({
                        "code": "RUNTIME_RESTART_CANCELLATION_CONFIRMED",
                        "retryable": false,
                        "treeExited": true
                    }),
                ),
                JobState::Starting => {
                    if completion_intent.is_some()
                        || checkpoint_path.is_some()
                        || latest_worker_event.is_some()
                    {
                        return Err(StoreError::CorruptState(job.job_id));
                    }
                    (
                        JobState::Interrupted,
                        Some("RUNTIME_RESTART_BEFORE_WORKER_READY"),
                        Some("Runtime restarted before the fenced worker became ready"),
                        serde_json::json!({
                            "code": "RUNTIME_RESTART_BEFORE_WORKER_READY",
                            "recoveryEvidence": "none",
                            "retryable": false
                        }),
                    )
                }
                JobState::Running | JobState::Checkpointing => {
                    if let Some(intent) = completion_intent {
                        (
                            JobState::Uncertain,
                            Some("RUNTIME_RESTART_AFTER_COMPLETION_INTENT"),
                            Some("Runtime restarted after worker completion intent but before result and tree-exit confirmation"),
                            serde_json::json!({
                                "code": "RUNTIME_RESTART_AFTER_COMPLETION_INTENT",
                                "completionSequence": intent.sequence,
                                "completionUncertain": true,
                                "resultPath": intent.result_path,
                                "retryable": false
                            }),
                        )
                    } else if let Some(checkpoint_path) = checkpoint_path {
                        if job.state == JobState::Checkpointing
                            && latest_worker_event.as_deref() == Some("checkpoint")
                        {
                            (
                                JobState::Interrupted,
                                Some("RUNTIME_RESTART_CHECKPOINT_AVAILABLE"),
                                Some("Runtime restarted with a durable checkpoint available for explicit recovery"),
                                serde_json::json!({
                                    "checkpointPath": checkpoint_path,
                                    "code": "RUNTIME_RESTART_CHECKPOINT_AVAILABLE",
                                    "providerReceiptEvidence": "unavailable",
                                    "recovery": "explicit-checkpoint",
                                    "retryable": false
                                }),
                            )
                        } else {
                            (
                                JobState::Uncertain,
                                Some("RUNTIME_RESTART_AFTER_CHECKPOINT_ACTIVITY_UNCLASSIFIED"),
                                Some("Runtime restarted after activity resumed beyond the last durable checkpoint without provider-receipt evidence"),
                                serde_json::json!({
                                    "checkpointPath": checkpoint_path,
                                    "code": "RUNTIME_RESTART_AFTER_CHECKPOINT_ACTIVITY_UNCLASSIFIED",
                                    "completionUncertain": true,
                                    "providerReceiptEvidence": "unavailable",
                                    "retryable": false
                                }),
                            )
                        }
                    } else if job.state == JobState::Checkpointing {
                        return Err(StoreError::CorruptState(job.job_id));
                    } else {
                        (
                            JobState::Uncertain,
                            Some("RUNTIME_RESTART_EXTERNAL_EFFECTS_UNCLASSIFIED"),
                            Some("Runtime restarted without durable completion, checkpoint, or provider-receipt evidence"),
                            serde_json::json!({
                                "code": "RUNTIME_RESTART_EXTERNAL_EFFECTS_UNCLASSIFIED",
                                "completionUncertain": true,
                                "providerReceiptEvidence": "unavailable",
                                "retryable": false
                            }),
                        )
                    }
                }
                _ => return Err(StoreError::CorruptState(job.job_id)),
            };
            validate_transition(job.state, target)?;
            transaction.execute(
                "UPDATE runtime_jobs SET state=?2, failure_code=?3, failure_message=?4,
                 finished_at=?5, updated_at=?5 WHERE job_id=?1",
                params![job.job_id, state_name(target), code, message, now,],
            )?;
            append_event_tx(
                &transaction,
                &job.job_id,
                job.attempt,
                job.worker_instance_id.as_deref(),
                state_name(target),
                &payload,
                now,
            )?;
            if release_active_job_reservation_tx(&transaction, &job.job_id, now)? {
                append_event_tx(
                    &transaction,
                    &job.job_id,
                    job.attempt,
                    job.worker_instance_id.as_deref(),
                    "reservation-released",
                    &serde_json::json!({
                        "reservationState": "released",
                        "reason": "runtime-restart-reconciliation"
                    }),
                    now,
                )?;
            }
            reconciled.push(query_job(&transaction, &job.job_id)?);
        }

        // A v1 database can contain admitted jobs but cannot contain the v2
        // reservation needed to resume them safely. A v2 admitted job is valid
        // only while it retains a pending reservation; all other cases become
        // interrupted rather than silently starting without a reservation.
        let mut statement = transaction.prepare(&format!(
            "SELECT {JOB_COLUMNS} FROM runtime_jobs AS jobs
             WHERE state='admitted' AND NOT EXISTS (
                 SELECT 1 FROM runtime_admission_reservations AS reservations
                 WHERE reservations.subject_kind='job'
                   AND reservations.subject_id=jobs.job_id
                   AND reservations.lifecycle_state='pending'
                   AND reservations.definition_key=jobs.worker_kind
                   AND reservations.resource_class=jobs.resource_class
             ) ORDER BY created_at"
        ))?;
        let stranded = statement
            .query_map([], row_to_job)?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for mut job in stranded {
            validate_transition(job.state, JobState::Interrupted)?;
            transaction.execute(
                "UPDATE runtime_jobs SET state='interrupted',
                 failure_code='ADMISSION_RESERVATION_MISSING_ON_RESTART',
                 failure_message='Runtime restarted without a resumable pending admission reservation',
                 finished_at=?2, updated_at=?2 WHERE job_id=?1",
                params![job.job_id, now],
            )?;
            append_event_tx(
                &transaction,
                &job.job_id,
                job.attempt,
                job.worker_instance_id.as_deref(),
                "interrupted",
                &serde_json::json!({
                    "code": "ADMISSION_RESERVATION_MISSING_ON_RESTART",
                    "retryable": false
                }),
                now,
            )?;
            if release_active_job_reservation_tx(&transaction, &job.job_id, now)? {
                append_event_tx(
                    &transaction,
                    &job.job_id,
                    job.attempt,
                    job.worker_instance_id.as_deref(),
                    "reservation-released",
                    &serde_json::json!({
                        "reservationState": "released",
                        "reason": "runtime-restart"
                    }),
                    now,
                )?;
            }
            job.state = JobState::Interrupted;
            job.failure_code = Some("ADMISSION_RESERVATION_MISSING_ON_RESTART".into());
            job.failure_message =
                Some("Runtime restarted without a resumable pending admission reservation".into());
            job.finished_at = Some(now);
            job.updated_at = now;
            reconciled.push(job);
        }

        // Job Objects and managed service trees are killed when the old runtime
        // loses ownership. Preserve only a valid pending hold for an admitted
        // job; every other active reservation is stale at startup.
        transaction.execute(
            "UPDATE runtime_admission_reservations
             SET lifecycle_state='released', released_at=?1, updated_at=?1
             WHERE lifecycle_state IN ('pending','resident') AND (
                 subject_kind='service' OR
                 (subject_kind='job' AND NOT EXISTS (
                     SELECT 1 FROM runtime_jobs
                     WHERE runtime_jobs.job_id=runtime_admission_reservations.subject_id
                       AND runtime_jobs.state='admitted'
                 ))
             )",
            params![now],
        )?;
        transaction.commit()?;
        Ok(reconciled)
    }

    fn worker_terminal_transition(
        &self,
        tree_exit: &ProcessTreeExit,
        target: JobState,
        code: &str,
        message: &str,
    ) -> Result<JobRecord, StoreError> {
        self.require_process_tree_exit_scope(tree_exit)?;
        let identity = tree_exit.worker_identity().cloned().ok_or_else(|| {
            StoreError::InvalidInput(
                "service process-tree exit cannot terminate a worker job".into(),
            )
        })?;
        identity.validate()?;
        validate_identifier("failure code", code)?;
        validate_bounded_text("failure message", message, MAX_FAILURE_MESSAGE_BYTES)?;
        let mut connection = self.connection.lock().expect("job store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = query_job(&transaction, &identity.job_id)?;
        require_identity(&current, &identity)?;
        if matches!(current.state, JobState::Cancelling | JobState::Cancelled) {
            confirm_cancelled_tx(&transaction, &current, &identity)?;
            let updated = query_job(&transaction, &identity.job_id)?;
            transaction.commit()?;
            return Ok(updated);
        }
        if current.cancellation_requested {
            return Err(StoreError::CorruptState(identity.job_id.clone()));
        }
        if current.state == target
            && current.failure_code.as_deref() == Some(code)
            && current.failure_message.as_deref() == Some(message)
        {
            if latest_job_reservation_state_tx(&transaction, &identity.job_id)?.as_deref()
                != Some("released")
            {
                return Err(StoreError::CorruptState(identity.job_id.clone()));
            }
            transaction.commit()?;
            return Ok(current);
        }
        if completion_intent_tx(&transaction, &identity)?.is_some() {
            return Err(StoreError::PendingCompletionIntent(identity.job_id.clone()));
        }
        validate_transition(current.state, target)?;
        let now = now_ms();
        transaction.execute(
            "UPDATE runtime_jobs SET state=?2, failure_code=?3, failure_message=?4,
             updated_at=?5, finished_at=?5 WHERE job_id=?1",
            params![identity.job_id, state_name(target), code, message, now],
        )?;
        append_event_tx(
            &transaction,
            &identity.job_id,
            identity.attempt,
            Some(&identity.worker_instance_id),
            state_name(target),
            &serde_json::json!({ "code": code, "message": message }),
            now,
        )?;
        if !release_active_job_reservation_tx(&transaction, &identity.job_id, now)? {
            return Err(StoreError::MissingAdmissionReservation(
                identity.job_id.clone(),
            ));
        }
        append_event_tx(
            &transaction,
            &identity.job_id,
            identity.attempt,
            Some(&identity.worker_instance_id),
            "reservation-released",
            &serde_json::json!({ "reservationState": "released" }),
            now,
        )?;
        let updated = query_job(&transaction, &identity.job_id)?;
        transaction.commit()?;
        Ok(updated)
    }

    fn require_process_tree_exit_scope(
        &self,
        tree_exit: &ProcessTreeExit,
    ) -> Result<(), StoreError> {
        if tree_exit.matches_generation_scope(&self.generation_scope) {
            Ok(())
        } else {
            Err(StoreError::GenerationAuthorityMismatch)
        }
    }
}

fn revalidate_completion_result_before_commit(
    proof: Option<&WorkerCompletionProof>,
    identity: &WorkerIdentity,
    completion_sequence: u64,
    result: &ValidatedWorkerResult,
) -> Result<(), StoreError> {
    let Some(proof) = proof else {
        // Crate-local semantic tests exercise the transaction independently of
        // the production process-owner proof. The public production entrypoint
        // always supplies `Some` here.
        return Ok(());
    };
    if proof.identity() != identity
        || proof.completion_sequence() != completion_sequence
        || proof.result() != result
    {
        return Err(StoreError::ConflictingCompletionEvidence(
            identity.job_id.clone(),
        ));
    }
    proof
        .revalidate_result_file()
        .map_err(|_| StoreError::ConflictingCompletionEvidence(identity.job_id.clone()))
}

fn confirm_cancelled_tx(
    transaction: &Transaction<'_>,
    current: &JobRecord,
    identity: &WorkerIdentity,
) -> Result<(), StoreError> {
    if current.state == JobState::Cancelled {
        if !current.cancellation_requested
            || latest_job_reservation_state_tx(transaction, &identity.job_id)?.as_deref()
                != Some("released")
        {
            return Err(StoreError::CorruptState(identity.job_id.clone()));
        }
        return Ok(());
    }
    if current.state != JobState::Cancelling {
        return Err(StoreError::WorkerEventInState {
            job_id: identity.job_id.clone(),
            state: current.state,
        });
    }
    if !current.cancellation_requested {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let reservation = require_active_job_reservation_matches_job_tx(transaction, current)?;
    if reservation.lifecycle_state != "resident" {
        return Err(StoreError::InvalidAdmissionReservationState {
            job_id: identity.job_id.clone(),
            state: reservation.lifecycle_state,
        });
    }
    validate_transition(JobState::Cancelling, JobState::Cancelled)?;
    let now = now_ms();
    let changed = transaction.execute(
        "UPDATE runtime_jobs SET state='cancelled', failure_code=NULL, failure_message=NULL,
         updated_at=?2, finished_at=?2
         WHERE job_id=?1 AND state='cancelling' AND attempt=?3
           AND worker_instance_id=?4 AND cancellation_requested=1",
        params![
            &identity.job_id,
            now,
            identity.attempt,
            &identity.worker_instance_id
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::CorruptState(format!(
            "cancelling job {} changed while tree exit was confirmed",
            identity.job_id
        )));
    }
    append_event_tx(
        transaction,
        &identity.job_id,
        identity.attempt,
        Some(&identity.worker_instance_id),
        "cancelled",
        &serde_json::json!({ "state": "cancelled" }),
        now,
    )?;
    if !release_active_job_reservation_tx(transaction, &identity.job_id, now)? {
        return Err(StoreError::MissingAdmissionReservation(
            identity.job_id.clone(),
        ));
    }
    append_event_tx(
        transaction,
        &identity.job_id,
        identity.attempt,
        Some(&identity.worker_instance_id),
        "reservation-released",
        &serde_json::json!({ "reservationState": "released" }),
        now,
    )?;
    Ok(())
}

#[derive(Debug)]
struct ActiveJobReservation {
    definition_key: String,
    resource_class: String,
    estimated_pending_commit_mb: u64,
    lifecycle_state: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompletionConfirmation {
    completion_sequence: u64,
    result: ValidatedWorkerResult,
    terminal_accounting: Option<(u32, u32, ProcessTreeAccounting)>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedCompletionConfirmation {
    completion_sequence: u64,
    durable_result_validated: bool,
    result_path: String,
    result_sha256: String,
    result_size_bytes: u64,
    tree_exited: bool,
    #[serde(default)]
    supervisor_pid: Option<u32>,
    #[serde(default)]
    root_pid: Option<u32>,
    #[serde(default)]
    peak_private_commit_bytes: Option<u64>,
    #[serde(default)]
    peak_accounting_complete: Option<bool>,
}

#[derive(Debug, Default)]
struct ActiveReservationSummary {
    pending_commit_mb: u64,
    active_job_classes: Vec<ResourceClass>,
    active_service_classes: Vec<ResourceClass>,
    active_job_definitions: Vec<String>,
}

/// Completes the serialized disposition of one admission denial. Shutdown is
/// a lifecycle gate, and an explicitly retryable future policy decision still
/// needs a scheduler-owned retry policy, so those remain queued. A permanent
/// resource denial is different: its terminal job row and private diagnostic
/// evidence are committed together before the denial is returned.
fn finish_admission_denial_tx(
    transaction: Transaction<'_>,
    current: &JobRecord,
    denial: AdmissionDenial,
) -> Result<JobAdmissionResult, StoreError> {
    if denial.is_runtime_shutdown_gate() || denial.retryable {
        transaction.commit()?;
        return Ok(JobAdmissionResult::Denied(denial));
    }

    validate_transition(current.state, JobState::ResourceExhausted)?;
    if current.attempt != 0 || current.worker_instance_id.is_some() {
        return Err(StoreError::CorruptState(current.job_id.clone()));
    }
    if active_job_reservation_tx(&transaction, &current.job_id)?.is_some() {
        return Err(StoreError::CorruptState(format!(
            "queued job {} acquired a reservation before its permanent admission denial",
            current.job_id
        )));
    }

    let now = now_ms();
    let changed = transaction.execute(
        "UPDATE runtime_jobs
         SET state='resource_exhausted', stage=NULL, failure_code=?2,
             failure_message=?3, updated_at=?4, finished_at=?4
         WHERE job_id=?1 AND state='queued' AND attempt=0
           AND worker_instance_id IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM runtime_admission_reservations
               WHERE subject_kind='job' AND subject_id=?1
                 AND lifecycle_state IN ('pending','resident')
           )",
        params![
            current.job_id,
            ADMISSION_RESOURCE_EXHAUSTED_FAILURE_CODE,
            ADMISSION_RESOURCE_EXHAUSTED_FAILURE_MESSAGE,
            now,
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::CorruptState(format!(
            "queued job {} changed while its permanent admission denial was being recorded",
            current.job_id
        )));
    }
    append_event_tx(
        &transaction,
        &current.job_id,
        current.attempt,
        None,
        "resource_exhausted",
        &serde_json::json!({
            "state": "resource_exhausted",
            "code": ADMISSION_RESOURCE_EXHAUSTED_FAILURE_CODE,
            "message": ADMISSION_RESOURCE_EXHAUSTED_FAILURE_MESSAGE,
            "reservationCreated": false,
            "admissionDenial": &denial,
        }),
        now,
    )?;
    if active_job_reservation_tx(&transaction, &current.job_id)?.is_some() {
        return Err(StoreError::CorruptState(format!(
            "terminal admission denial for job {} has an active reservation",
            current.job_id
        )));
    }
    transaction.commit()?;
    Ok(JobAdmissionResult::Denied(denial))
}

/// Finishes cancellation without a process-tree receipt only while durable
/// state proves that no worker identity was ever assigned. A queued job has no
/// admission reservation; an admitted job has exactly the pending hold created
/// by admission, which is released in this same transaction. Once an identity
/// exists, even a still-pending hold remains fail-closed and must use the
/// process-owner path instead.
fn cancel_unstarted_job_tx(
    transaction: &Transaction<'_>,
    current: &JobRecord,
) -> Result<(), StoreError> {
    if current.attempt != 0
        || current.worker_instance_id.is_some()
        || current.started_at.is_some()
        || current.last_heartbeat_at.is_some()
        || current.last_worker_sequence != 0
        || current.stage.is_some()
        || current.progress_current != 0
        || current.progress_total != 0
        || current.failure_code.is_some()
        || current.failure_message.is_some()
    {
        return Err(StoreError::CorruptState(current.job_id.clone()));
    }

    let release_pending_reservation = match current.state {
        JobState::Queued => {
            if current.cancellation_requested
                || latest_job_reservation_state_tx(transaction, &current.job_id)?.is_some()
            {
                return Err(StoreError::CorruptState(current.job_id.clone()));
            }
            false
        }
        JobState::Admitted => {
            if current.cancellation_requested {
                return Err(StoreError::CorruptState(current.job_id.clone()));
            }
            require_pending_job_reservation_tx(transaction, current)?;
            true
        }
        // This drains unstarted cancellation rows written by an older runtime
        // without weakening the identity boundary. A resident hold without an
        // identity is corrupt and is never released here.
        JobState::Cancelling => {
            if !current.cancellation_requested {
                return Err(StoreError::CorruptState(current.job_id.clone()));
            }
            match active_job_reservation_tx(transaction, &current.job_id)? {
                Some(_) => {
                    require_pending_job_reservation_tx(transaction, current)?;
                    true
                }
                None => {
                    if latest_job_reservation_state_tx(transaction, &current.job_id)?.is_some() {
                        return Err(StoreError::CorruptState(current.job_id.clone()));
                    }
                    false
                }
            }
        }
        _ => {
            return Err(StoreError::WorkerEventInState {
                job_id: current.job_id.clone(),
                state: current.state,
            })
        }
    };

    let now = now_ms();
    if current.state != JobState::Cancelling {
        validate_transition(current.state, JobState::Cancelling)?;
        let changed = transaction.execute(
            "UPDATE runtime_jobs
             SET state='cancelling', cancellation_requested=1, updated_at=?3
             WHERE job_id=?1 AND state=?2 AND attempt=0
               AND worker_instance_id IS NULL AND cancellation_requested=0",
            params![current.job_id, state_name(current.state), now],
        )?;
        if changed != 1 {
            return Err(StoreError::CorruptState(format!(
                "unstarted job {} changed while cancellation was requested",
                current.job_id
            )));
        }
        append_event_tx(
            transaction,
            &current.job_id,
            0,
            None,
            "cancellation-requested",
            &serde_json::json!({ "state": "cancelling" }),
            now,
        )?;
    }

    validate_transition(JobState::Cancelling, JobState::Cancelled)?;
    let changed = transaction.execute(
        "UPDATE runtime_jobs
         SET state='cancelled', stage=NULL, failure_code=NULL, failure_message=NULL,
             updated_at=?2, finished_at=?2
         WHERE job_id=?1 AND state='cancelling' AND attempt=0
           AND worker_instance_id IS NULL AND cancellation_requested=1",
        params![current.job_id, now],
    )?;
    if changed != 1 {
        return Err(StoreError::CorruptState(format!(
            "unstarted job {} changed while cancellation was confirmed",
            current.job_id
        )));
    }
    append_event_tx(
        transaction,
        &current.job_id,
        0,
        None,
        "cancelled",
        &serde_json::json!({ "state": "cancelled" }),
        now,
    )?;

    if release_pending_reservation {
        if !release_active_job_reservation_tx(transaction, &current.job_id, now)? {
            return Err(StoreError::MissingAdmissionReservation(
                current.job_id.clone(),
            ));
        }
        append_event_tx(
            transaction,
            &current.job_id,
            0,
            None,
            "reservation-released",
            &serde_json::json!({
                "reservationState": "released",
                "reason": "cancelled-before-worker-assignment"
            }),
            now,
        )?;
    } else if active_job_reservation_tx(transaction, &current.job_id)?.is_some() {
        return Err(StoreError::CorruptState(format!(
            "unreserved cancelled job {} acquired an active reservation",
            current.job_id
        )));
    }
    Ok(())
}

fn require_registered_admission_matches(
    current: &JobRecord,
    admission: &RegisteredJobAdmission,
) -> Result<(), StoreError> {
    if current.job_type.as_str() != admission.job_type.as_str()
        || current.worker_kind.as_str() != admission.definition_key.as_str()
        || current.resource_class != admission.resource_class.as_str()
    {
        return Err(StoreError::InvalidInput(format!(
            "registered admission does not match job {}",
            current.job_id
        )));
    }
    Ok(())
}

fn active_reservation_summary_tx(
    transaction: &Transaction<'_>,
) -> Result<ActiveReservationSummary, StoreError> {
    let mut statement = transaction.prepare(
        "SELECT subject_kind, subject_id, definition_key, resource_class,
                estimated_pending_commit_mb, lifecycle_state
         FROM runtime_admission_reservations
         WHERE lifecycle_state IN ('pending','resident')
         ORDER BY reservation_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;
    let mut summary = ActiveReservationSummary::default();
    for row in rows {
        let (subject_kind, subject_id, definition_key, resource_class, estimate, state) = row?;
        validate_identifier("reservation subject", &subject_id)?;
        validate_identifier("reservation definition", &definition_key)?;
        validate_identifier("reservation resource class", &resource_class)?;
        let resource_class = parse_resource_class(&resource_class).ok_or_else(|| {
            StoreError::CorruptState(format!(
                "reservation {subject_kind}:{subject_id} has unknown resource class"
            ))
        })?;
        let estimate = i64_to_u64(estimate, 4, "pending admission commit")?;
        if state == "pending" {
            summary.pending_commit_mb = summary
                .pending_commit_mb
                .checked_add(estimate)
                .ok_or_else(|| {
                    StoreError::CorruptState(
                        "active pending admission commit total overflowed".into(),
                    )
                })?;
        } else if state != "resident" {
            return Err(StoreError::CorruptState(format!(
                "reservation {subject_kind}:{subject_id} has invalid active state {state}"
            )));
        }
        match subject_kind.as_str() {
            "job" => {
                summary.active_job_classes.push(resource_class);
                summary.active_job_definitions.push(definition_key);
            }
            "service" => summary.active_service_classes.push(resource_class),
            _ => {
                return Err(StoreError::CorruptState(format!(
                    "reservation has unknown subject kind {subject_kind}"
                )))
            }
        }
    }
    Ok(summary)
}

fn active_job_reservation_tx(
    transaction: &Transaction<'_>,
    job_id: &str,
) -> Result<Option<ActiveJobReservation>, StoreError> {
    transaction
        .query_row(
            "SELECT definition_key, resource_class, estimated_pending_commit_mb, lifecycle_state
             FROM runtime_admission_reservations
             WHERE subject_kind='job' AND subject_id=?1
               AND lifecycle_state IN ('pending','resident')
             ORDER BY reservation_id DESC LIMIT 1",
            params![job_id],
            |row| {
                Ok(ActiveJobReservation {
                    definition_key: row.get(0)?,
                    resource_class: row.get(1)?,
                    estimated_pending_commit_mb: i64_to_u64(
                        row.get(2)?,
                        2,
                        "pending admission commit",
                    )?,
                    lifecycle_state: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(StoreError::from)
}

fn require_matching_active_job_reservation_tx(
    transaction: &Transaction<'_>,
    current: &JobRecord,
    admission: &RegisteredJobAdmission,
) -> Result<(), StoreError> {
    let reservation = active_job_reservation_tx(transaction, &current.job_id)?
        .ok_or_else(|| StoreError::MissingAdmissionReservation(current.job_id.clone()))?;
    if reservation.lifecycle_state != "pending" {
        return Err(StoreError::InvalidAdmissionReservationState {
            job_id: current.job_id.clone(),
            state: reservation.lifecycle_state,
        });
    }
    if reservation.definition_key.as_str() != admission.definition_key.as_str()
        || reservation.resource_class != admission.resource_class.as_str()
        || reservation.estimated_pending_commit_mb != admission.estimated_cold_start_commit_mb
    {
        return Err(StoreError::CorruptState(format!(
            "active admission reservation does not match job {}",
            current.job_id
        )));
    }
    Ok(())
}

fn require_pending_job_reservation_tx(
    transaction: &Transaction<'_>,
    current: &JobRecord,
) -> Result<(), StoreError> {
    let reservation = require_active_job_reservation_matches_job_tx(transaction, current)?;
    if reservation.lifecycle_state == "pending" {
        Ok(())
    } else {
        Err(StoreError::InvalidAdmissionReservationState {
            job_id: current.job_id.clone(),
            state: reservation.lifecycle_state,
        })
    }
}

fn require_active_job_reservation_matches_job_tx(
    transaction: &Transaction<'_>,
    current: &JobRecord,
) -> Result<ActiveJobReservation, StoreError> {
    let reservation = active_job_reservation_tx(transaction, &current.job_id)?
        .ok_or_else(|| StoreError::MissingAdmissionReservation(current.job_id.clone()))?;
    if reservation.definition_key.as_str() != current.worker_kind.as_str()
        || reservation.resource_class.as_str() != current.resource_class.as_str()
    {
        return Err(StoreError::CorruptState(format!(
            "active admission reservation does not match job {}",
            current.job_id
        )));
    }
    Ok(reservation)
}

fn latest_job_reservation_state_tx(
    transaction: &Transaction<'_>,
    job_id: &str,
) -> Result<Option<String>, StoreError> {
    transaction
        .query_row(
            "SELECT lifecycle_state FROM runtime_admission_reservations
             WHERE subject_kind='job' AND subject_id=?1
             ORDER BY reservation_id DESC LIMIT 1",
            params![job_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(StoreError::from)
}

fn release_active_job_reservation_tx(
    transaction: &Transaction<'_>,
    job_id: &str,
    now: i64,
) -> Result<bool, StoreError> {
    let changed = transaction.execute(
        "UPDATE runtime_admission_reservations
         SET lifecycle_state='released', released_at=?2, updated_at=?2
         WHERE subject_kind='job' AND subject_id=?1
           AND lifecycle_state IN ('pending','resident')",
        params![job_id, now],
    )?;
    if changed > 1 {
        return Err(StoreError::CorruptState(format!(
            "job {job_id} has multiple active admission reservations"
        )));
    }
    Ok(changed == 1)
}

fn parse_resource_class(value: &str) -> Option<ResourceClass> {
    Some(match value {
        "core" => ResourceClass::Core,
        "large-generation" => ResourceClass::LargeGeneration,
        "document-processing" => ResourceClass::DocumentProcessing,
        "document-model" => ResourceClass::DocumentModel,
        "media-processing" => ResourceClass::MediaProcessing,
        "browser-automation" => ResourceClass::BrowserAutomation,
        "local-model" => ResourceClass::LocalModel,
        "docker-stack" => ResourceClass::DockerStack,
        _ => return None,
    })
}

fn query_job_by_idempotency_key(
    connection: &Connection,
    owner_principal: &str,
    idempotency_key: &str,
) -> Result<Option<JobRecord>, StoreError> {
    connection
        .query_row(
            &format!(
                "SELECT {JOB_COLUMNS} FROM runtime_jobs
                 WHERE owner_principal=?1 AND idempotency_key=?2"
            ),
            params![owner_principal, idempotency_key],
            row_to_job,
        )
        .optional()
        .map_err(StoreError::from)
}

fn query_job(connection: &Connection, job_id: &str) -> Result<JobRecord, StoreError> {
    query_job_optional(connection, job_id)?
        .ok_or_else(|| StoreError::JobNotFound(job_id.to_string()))
}

fn query_job_optional(
    connection: &Connection,
    job_id: &str,
) -> Result<Option<JobRecord>, StoreError> {
    connection
        .query_row(
            &format!("SELECT {JOB_COLUMNS} FROM runtime_jobs WHERE job_id=?1"),
            params![job_id],
            row_to_job,
        )
        .optional()
        .map_err(StoreError::from)
}

fn query_owned_job(
    connection: &Connection,
    owner: &JobOwner,
    garden_id: Option<&str>,
    conversation_id: Option<&str>,
    job_id: &str,
) -> Result<JobRecord, StoreError> {
    connection
        .query_row(
            &format!(
                "SELECT {JOB_COLUMNS} FROM runtime_jobs
                 WHERE job_id=?1 AND owner_principal=?2
                   AND garden_id IS ?3 AND conversation_id IS ?4"
            ),
            params![job_id, owner.principal(), garden_id, conversation_id],
            row_to_job,
        )
        .optional()?
        .ok_or_else(|| StoreError::JobNotFound(job_id.to_string()))
}

fn query_owned_events_after(
    connection: &Connection,
    owner: &JobOwner,
    garden_id: Option<&str>,
    conversation_id: Option<&str>,
    job_id: &str,
    after_sequence: i64,
    bounded_limit: i64,
) -> Result<Vec<JobEventRecord>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT sequence, job_id, attempt, worker_instance_id, worker_sequence,
                event_type,
                CAST(substr(CAST(payload_json AS BLOB), 1, ?7) AS BLOB),
                length(CAST(payload_json AS BLOB)), typeof(payload_json), created_at
         FROM runtime_job_events
         WHERE job_id=?1 AND sequence>?5
           AND EXISTS (
               SELECT 1 FROM runtime_jobs
               WHERE runtime_jobs.job_id=runtime_job_events.job_id
                 AND owner_principal=?2
                 AND garden_id IS ?3
                 AND conversation_id IS ?4
           )
         ORDER BY sequence ASC LIMIT ?6",
    )?;
    let rows = statement.query_map(
        params![
            job_id,
            owner.principal(),
            garden_id,
            conversation_id,
            after_sequence,
            bounded_limit,
            (MAX_PROTOCOL_LINE_BYTES + 1) as i64,
        ],
        |row| {
            let payload = bounded_payload_json(row, 6, 7, 8)?;
            Ok(JobEventRecord {
                sequence: row.get(0)?,
                job_id: row.get(1)?,
                attempt: i64_to_u32(row.get(2)?, 2, "event attempt")?,
                worker_instance_id: row.get(3)?,
                worker_sequence: row
                    .get::<_, Option<i64>>(4)?
                    .map(|value| i64_to_u64(value, 4, "worker event sequence"))
                    .transpose()?,
                event_type: row.get(5)?,
                payload: serde_json::from_str(&payload).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        6,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                created_at: row.get(9)?,
            })
        },
    )?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

fn query_bound_job_input(connection: &Connection, job: &JobRecord) -> Result<Vec<u8>, StoreError> {
    let input = connection
        .query_row(
            "SELECT request_digest,
                    CAST(substr(canonical_request_payload, 1, ?2) AS BLOB),
                    length(canonical_request_payload),
                    typeof(canonical_request_payload)
             FROM runtime_job_inputs WHERE job_id=?1",
            params![&job.job_id, (MAX_REQUEST_BODY_BYTES + 1) as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| StoreError::CorruptState(job.job_id.clone()))?;
    let (input_digest, canonical_payload, stored_length, stored_type) = input;
    if stored_type != "blob"
        || stored_length < 1
        || stored_length > MAX_REQUEST_BODY_BYTES as i64
        || stored_length as usize != canonical_payload.len()
    {
        return Err(StoreError::CorruptState(job.job_id.clone()));
    }
    if input_digest != job.request_digest || !is_valid_request_digest(&input_digest) {
        return Err(StoreError::CorruptState(job.job_id.clone()));
    }
    validate_canonical_request_payload(&canonical_payload)
        .map_err(|_| StoreError::CorruptState(job.job_id.clone()))?;
    let owner = JobOwner {
        principal: job.owner_principal.clone(),
        user_id: job.user_id,
    };
    let expected_digest = compute_submission_digest(
        &owner,
        &job.job_type,
        job.garden_id.as_deref(),
        job.conversation_id.as_deref(),
        &canonical_payload,
    )
    .map_err(|_| StoreError::CorruptState(job.job_id.clone()))?;
    if expected_digest != input_digest {
        return Err(StoreError::CorruptState(job.job_id.clone()));
    }
    Ok(canonical_payload)
}

fn row_to_job(row: &Row<'_>) -> rusqlite::Result<JobRecord> {
    let state: String = row.get(8)?;
    let state = parse_state(&state).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            8,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unknown persisted job state {state:?}"),
            )),
        )
    })?;
    let owner_principal: String = row.get(4)?;
    let user_id: Option<i64> = row.get(5)?;
    let owner_is_valid = match user_id {
        Some(value) => value > 0 && owner_principal == format!("user:{value}"),
        None => owner_principal
            .strip_prefix("internal:")
            .is_some_and(|id| validate_identifier("internal owner", id).is_ok()),
    };
    if !owner_is_valid {
        return Err(text_conversion_error(
            4,
            "persisted owner principal does not match its owner id",
        ));
    }
    let request_digest: String = row.get(28)?;
    if !is_valid_request_digest(&request_digest) {
        return Err(text_conversion_error(
            28,
            "persisted request digest is invalid",
        ));
    }
    let cancellation_requested = match row.get::<_, i64>(26)? {
        0 => false,
        1 => true,
        value => return Err(integer_conversion_error(26, "cancellation flag", value)),
    };
    let job = JobRecord {
        job_id: row.get(0)?,
        job_type: row.get(1)?,
        worker_kind: row.get(2)?,
        resource_class: row.get(3)?,
        owner_principal,
        user_id,
        garden_id: row.get(6)?,
        conversation_id: row.get(7)?,
        state,
        stage: row.get(9)?,
        attempt: i64_to_u32(row.get(10)?, 10, "job attempt")?,
        worker_instance_id: row.get(11)?,
        input_manifest_path: row.get(12)?,
        workspace_path: row.get(13)?,
        checkpoint_path: row.get(14)?,
        result_path: row.get(15)?,
        created_at: row.get(16)?,
        started_at: row.get(17)?,
        updated_at: row.get(18)?,
        finished_at: row.get(19)?,
        last_heartbeat_at: row.get(20)?,
        last_worker_sequence: i64_to_u64(row.get(21)?, 21, "last worker sequence")?,
        progress_current: i64_to_u64(row.get(22)?, 22, "progress current")?,
        progress_total: i64_to_u64(row.get(23)?, 23, "progress total")?,
        failure_code: row.get(24)?,
        failure_message: row.get(25)?,
        cancellation_requested,
        idempotency_key: row.get(27)?,
        request_digest,
    };
    validate_persisted_job_record(&job).map_err(|message| text_conversion_error(0, &message))?;
    Ok(job)
}

fn validate_persisted_job_record(job: &JobRecord) -> Result<(), String> {
    for (field, value) in [
        ("jobId", job.job_id.as_str()),
        ("jobType", job.job_type.as_str()),
        ("workerKind", job.worker_kind.as_str()),
        ("resourceClass", job.resource_class.as_str()),
    ] {
        validate_identifier(field, value).map_err(|_| format!("persisted {field} is invalid"))?;
    }
    if let Some(value) = &job.garden_id {
        validate_scope_id("gardenId", value)
            .map_err(|_| "persisted garden scope is invalid".to_string())?;
    }
    if let Some(value) = &job.conversation_id {
        validate_scope_id("conversationId", value)
            .map_err(|_| "persisted conversation scope is invalid".to_string())?;
    }
    for (field, value) in [
        ("inputManifestPath", job.input_manifest_path.as_str()),
        ("workspacePath", job.workspace_path.as_str()),
        ("checkpointPath", job.checkpoint_path.as_str()),
        ("resultPath", job.result_path.as_str()),
    ] {
        validate_relative_path(field, value)
            .map_err(|_| format!("persisted {field} is invalid"))?;
    }
    let root = format!("runtime/jobs/{}", job.job_id);
    if normalized_relative_path(&job.input_manifest_path) != format!("{root}/input.json")
        || normalized_relative_path(&job.result_path) != format!("{root}/result.json")
    {
        return Err("persisted job paths do not match the trusted job layout".into());
    }
    require_path_in_job_namespace(&job.job_id, &job.checkpoint_path)
        .map_err(|_| "persisted checkpoint escaped its job namespace".to_string())?;
    validate_bounded_text(
        "idempotencyKey",
        &job.idempotency_key,
        MAX_IDEMPOTENCY_KEY_BYTES,
    )
    .map_err(|_| "persisted idempotency key is invalid".to_string())?;
    if job.created_at < 0
        || job.updated_at < job.created_at
        || job.started_at.is_some_and(|value| value < job.created_at)
        || job.finished_at.is_some_and(|value| value < job.created_at)
        || job
            .last_heartbeat_at
            .is_some_and(|value| value < job.created_at)
    {
        return Err("persisted job timestamps are invalid".into());
    }
    if job.state.is_terminal() != job.finished_at.is_some() {
        return Err("persisted terminal state and finished timestamp disagree".into());
    }
    if job.progress_total > 0 && job.progress_current > job.progress_total {
        return Err("persisted progress exceeds its total".into());
    }
    match (job.attempt, &job.worker_instance_id) {
        (0, None) => {
            if normalized_relative_path(&job.workspace_path) != format!("{root}/workspace") {
                return Err("unclaimed job workspace is not the trusted staging path".into());
            }
        }
        (attempt, Some(worker_instance_id)) if attempt > 0 => {
            let identity = WorkerIdentity {
                job_id: job.job_id.clone(),
                attempt,
                worker_instance_id: worker_instance_id.clone(),
            };
            identity
                .validate()
                .map_err(|_| "persisted worker fence is invalid".to_string())?;
            let expected = worker_attempt_workspace_path(&identity)
                .map_err(|_| "persisted worker workspace is invalid".to_string())?;
            let actual = normalized_relative_path(&job.workspace_path);
            // Older schema-v3 writers kept the fixed job workspace after
            // assignment. Accept those rows only for restart compatibility;
            // every newly claimed attempt persists the exact fenced path.
            if actual != expected && actual != format!("{root}/workspace") {
                return Err("persisted worker workspace does not match its attempt fence".into());
            }
        }
        _ => return Err("persisted attempt and worker fence disagree".into()),
    }
    if job.last_worker_sequence > 0 && job.worker_instance_id.is_none() {
        return Err("persisted worker sequence has no worker fence".into());
    }
    Ok(())
}

fn i64_to_u32(value: i64, column: usize, field: &str) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|_| integer_conversion_error(column, field, value))
}

fn i64_to_u64(value: i64, column: usize, field: &str) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|_| integer_conversion_error(column, field, value))
}

fn u64_to_i64(value: u64, field: &str) -> Result<i64, StoreError> {
    i64::try_from(value).map_err(|_| {
        StoreError::InvalidInput(format!("{field} value cannot be represented by SQLite"))
    })
}

fn integer_conversion_error(column: usize, field: &str, value: i64) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Integer,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("persisted {field} value {value} is outside its unsigned range"),
        )),
    )
}

fn text_conversion_error(column: usize, message: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message.to_string(),
        )),
    )
}

fn bounded_payload_json(
    row: &Row<'_>,
    payload_column: usize,
    length_column: usize,
    type_column: usize,
) -> rusqlite::Result<String> {
    let prefix: Vec<u8> = row.get(payload_column)?;
    let stored_length: i64 = row.get(length_column)?;
    let stored_type: String = row.get(type_column)?;
    let valid_length = usize::try_from(stored_length).ok();
    if stored_type != "text"
        || valid_length.is_none()
        || valid_length.is_some_and(|length| length > MAX_PROTOCOL_LINE_BYTES)
        || valid_length != Some(prefix.len())
    {
        return Err(text_conversion_error(
            payload_column,
            "persisted event payload is oversized or has an invalid SQLite representation",
        ));
    }
    String::from_utf8(prefix).map_err(|_| {
        text_conversion_error(payload_column, "persisted event payload is not valid UTF-8")
    })
}

fn is_valid_request_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn canonicalize_request_payload(value: &Value) -> Result<Vec<u8>, StoreError> {
    let canonical = canonical_json(value);
    let encoded = serde_json::to_vec(&canonical)
        .map_err(|error| StoreError::InvalidInput(error.to_string()))?;
    validate_canonical_request_payload(&encoded)?;
    Ok(encoded)
}

fn canonical_json(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonical_json).collect()),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                let item = values
                    .get(key)
                    .expect("canonical JSON key came from this object");
                canonical.insert(key.clone(), canonical_json(item));
            }
            Value::Object(canonical)
        }
        scalar => scalar.clone(),
    }
}

fn validate_canonical_request_payload(bytes: &[u8]) -> Result<(), StoreError> {
    if bytes.is_empty() || bytes.len() > MAX_REQUEST_BODY_BYTES {
        return Err(StoreError::InvalidInput(format!(
            "canonical request payload must contain between 1 and {MAX_REQUEST_BODY_BYTES} bytes"
        )));
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| {
        StoreError::InvalidInput("canonical request payload is not valid JSON".into())
    })?;
    let canonical = serde_json::to_vec(&canonical_json(&value))
        .map_err(|error| StoreError::InvalidInput(error.to_string()))?;
    if canonical.as_slice() != bytes {
        return Err(StoreError::InvalidInput(
            "request payload bytes are not in canonical JSON form".into(),
        ));
    }
    Ok(())
}

pub(crate) fn compute_submission_digest(
    owner: &JobOwner,
    job_type: &str,
    garden_id: Option<&str>,
    conversation_id: Option<&str>,
    canonical_request_payload: &[u8],
) -> Result<String, StoreError> {
    owner.validate()?;
    validate_identifier("jobType", job_type)?;
    if let Some(value) = garden_id {
        validate_scope_id("gardenId", value)?;
    }
    if let Some(value) = conversation_id {
        validate_scope_id("conversationId", value)?;
    }
    validate_canonical_request_payload(canonical_request_payload)?;

    let mut digest = Sha256::new();
    digest.update(b"breadboard-runtime-v2/job-submission\0");
    update_digest_field(&mut digest, owner.principal().as_bytes());
    update_digest_field(&mut digest, job_type.as_bytes());
    update_optional_digest_field(&mut digest, garden_id.map(str::as_bytes));
    update_optional_digest_field(&mut digest, conversation_id.map(str::as_bytes));
    update_digest_field(&mut digest, canonical_request_payload);
    Ok(format!("{:x}", digest.finalize()))
}

fn update_digest_field(digest: &mut Sha256, value: &[u8]) {
    digest.update((value.len() as u64).to_be_bytes());
    digest.update(value);
}

fn update_optional_digest_field(digest: &mut Sha256, value: Option<&[u8]>) {
    match value {
        Some(value) => {
            digest.update([1]);
            update_digest_field(digest, value);
        }
        None => digest.update([0]),
    }
}

fn normalized_relative_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn worker_attempt_workspace_path(identity: &WorkerIdentity) -> Result<String, StoreError> {
    identity.validate()?;
    let workspace = format!(
        "runtime/jobs/{}/attempts/{}/{}/workspace",
        identity.job_id, identity.attempt, identity.worker_instance_id
    );
    validate_relative_path("workspacePath", &workspace)?;
    Ok(workspace)
}

fn require_path_in_job_namespace(job_id: &str, path: &str) -> Result<(), StoreError> {
    let normalized = normalized_relative_path(path);
    let prefix = format!("runtime/jobs/{job_id}/");
    if normalized.starts_with(&prefix) {
        Ok(())
    } else {
        Err(StoreError::InvalidInput(format!(
            "worker path is outside the trusted namespace for job {job_id}"
        )))
    }
}

fn require_exact_job_result_path(current: &JobRecord, result_path: &str) -> Result<(), StoreError> {
    require_path_in_job_namespace(&current.job_id, result_path)?;
    if normalized_relative_path(result_path) == normalized_relative_path(&current.result_path) {
        Ok(())
    } else {
        Err(StoreError::InvalidInput(format!(
            "worker result path does not match the trusted result path for job {}",
            current.job_id
        )))
    }
}

fn require_identity(current: &JobRecord, identity: &WorkerIdentity) -> Result<(), StoreError> {
    if current.job_id != identity.job_id
        || current.attempt != identity.attempt
        || current.worker_instance_id.as_deref() != Some(identity.worker_instance_id.as_str())
    {
        return Err(StoreError::StaleWorker(identity.job_id.clone()));
    }
    Ok(())
}

fn require_dispatch_claim_matches_job(
    claim: &WorkerDispatchClaim,
    current: &JobRecord,
) -> Result<(), StoreError> {
    if current.request_digest != claim.job.request_digest
        || current.workspace_path != claim.job.workspace_path
        || current.workspace_path != worker_attempt_workspace_path(&claim.identity)?
    {
        return Err(StoreError::StaleWorker(claim.identity.job_id.clone()));
    }
    Ok(())
}

fn require_worker_event_state(current: &JobRecord, allowed: &[JobState]) -> Result<(), StoreError> {
    if allowed.contains(&current.state) {
        Ok(())
    } else {
        Err(StoreError::WorkerEventInState {
            job_id: current.job_id.clone(),
            state: current.state,
        })
    }
}

fn transition_worker_tx(
    transaction: &Transaction<'_>,
    current: &JobRecord,
    target: JobState,
    now: i64,
) -> Result<(), StoreError> {
    validate_transition(current.state, target)?;
    transaction.execute(
        "UPDATE runtime_jobs SET state=?2, updated_at=?3,
         finished_at=CASE WHEN ?4 THEN ?3 ELSE finished_at END WHERE job_id=?1",
        params![
            current.job_id,
            state_name(target),
            now,
            target.is_terminal()
        ],
    )?;
    Ok(())
}

fn completion_intent_tx(
    transaction: &Transaction<'_>,
    identity: &WorkerIdentity,
) -> Result<Option<WorkerCompletionIntent>, StoreError> {
    let mut statement = transaction.prepare(
        "SELECT worker_sequence,
                CAST(substr(CAST(payload_json AS BLOB), 1, ?4) AS BLOB),
                length(CAST(payload_json AS BLOB)), typeof(payload_json)
         FROM runtime_job_events AS completion
         WHERE completion.job_id=?1 AND completion.attempt=?2
           AND completion.worker_instance_id=?3
           AND completion.event_type='complete'
           AND NOT EXISTS (
               SELECT 1 FROM runtime_job_events AS cancellation
               WHERE cancellation.job_id=completion.job_id
                 AND cancellation.attempt=completion.attempt
                 AND cancellation.worker_instance_id=completion.worker_instance_id
                 AND cancellation.event_type='cancellation-requested'
                 AND cancellation.sequence < completion.sequence
           )
         ORDER BY completion.sequence ASC",
    )?;
    let mut records = statement
        .query_map(
            params![
                identity.job_id,
                identity.attempt,
                identity.worker_instance_id,
                (MAX_PROTOCOL_LINE_BYTES + 1) as i64,
            ],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    bounded_payload_json(row, 1, 2, 3)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    if records.len() > 1 {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let Some((stored_sequence, payload_json)) = records.pop() else {
        return Ok(None);
    };
    if payload_json.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let stored_sequence =
        stored_sequence.ok_or_else(|| StoreError::CorruptState(identity.job_id.clone()))?;
    let stored_sequence = u64::try_from(stored_sequence)
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    let event: WorkerEvent = serde_json::from_str(&payload_json)
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    event
        .validate()
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    match event {
        WorkerEvent::Complete {
            identity: stored_identity,
            sequence,
            result_path,
        } if &stored_identity == identity && sequence == stored_sequence => {
            Ok(Some(WorkerCompletionIntent {
                identity: stored_identity,
                sequence,
                result_path,
            }))
        }
        _ => Err(StoreError::CorruptState(identity.job_id.clone())),
    }
}

fn completion_confirmation_tx(
    transaction: &Transaction<'_>,
    identity: &WorkerIdentity,
) -> Result<Option<CompletionConfirmation>, StoreError> {
    let mut statement = transaction.prepare(
        "SELECT worker_sequence,
                CAST(substr(CAST(payload_json AS BLOB), 1, ?4) AS BLOB),
                length(CAST(payload_json AS BLOB)), typeof(payload_json)
         FROM runtime_job_events
         WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
           AND event_type='completion-confirmed'
         ORDER BY sequence ASC",
    )?;
    let mut records = statement
        .query_map(
            params![
                identity.job_id,
                identity.attempt,
                identity.worker_instance_id,
                (MAX_PROTOCOL_LINE_BYTES + 1) as i64,
            ],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    bounded_payload_json(row, 1, 2, 3)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    if records.len() > 1 {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let Some((worker_sequence, payload_json)) = records.pop() else {
        return Ok(None);
    };
    if worker_sequence.is_some() {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    if payload_json.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let persisted: PersistedCompletionConfirmation = serde_json::from_str(&payload_json)
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    if persisted.completion_sequence == 0
        || !persisted.durable_result_validated
        || !persisted.tree_exited
    {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let has_terminal_accounting = persisted.supervisor_pid.is_some()
        || persisted.root_pid.is_some()
        || persisted.peak_private_commit_bytes.is_some()
        || persisted.peak_accounting_complete.is_some();
    if has_terminal_accounting
        && (persisted.supervisor_pid.is_none_or(|pid| pid == 0)
            || persisted.root_pid.is_none_or(|pid| pid == 0)
            || persisted.peak_private_commit_bytes.is_none()
            || persisted.peak_accounting_complete != Some(true))
    {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let result = ValidatedWorkerResult::from_trusted_validation(
        persisted.result_path,
        persisted.result_sha256,
        persisted.result_size_bytes,
    )
    .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    let terminal_accounting = if has_terminal_accounting {
        Some((
            persisted
                .supervisor_pid
                .ok_or_else(|| StoreError::CorruptState(identity.job_id.clone()))?,
            persisted
                .root_pid
                .ok_or_else(|| StoreError::CorruptState(identity.job_id.clone()))?,
            ProcessTreeAccounting {
                peak_private_commit_bytes: persisted.peak_private_commit_bytes,
                complete: persisted.peak_accounting_complete == Some(true),
            },
        ))
    } else {
        None
    };
    Ok(Some(CompletionConfirmation {
        completion_sequence: persisted.completion_sequence,
        result,
        terminal_accounting,
    }))
}

fn worker_ready_accepted_tx(
    transaction: &Transaction<'_>,
    identity: &WorkerIdentity,
) -> Result<bool, StoreError> {
    let mut statement = transaction.prepare(
        "SELECT worker_sequence FROM runtime_job_events
         WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
           AND event_type IN ('ready','ready-after-cancellation')
         ORDER BY sequence ASC
         LIMIT 2",
    )?;
    let mut sequences = statement
        .query_map(
            params![
                &identity.job_id,
                identity.attempt,
                &identity.worker_instance_id
            ],
            |row| row.get::<_, Option<i64>>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    if sequences.len() > 1 {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    let Some(stored_sequence) = sequences.pop() else {
        return Ok(false);
    };
    let stored_sequence =
        stored_sequence.ok_or_else(|| StoreError::CorruptState(identity.job_id.clone()))?;
    let stored_sequence = u64::try_from(stored_sequence)
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    let payload_json = persisted_worker_event_tx(transaction, identity, stored_sequence)?
        .ok_or_else(|| StoreError::CorruptState(identity.job_id.clone()))?;
    let event: WorkerEvent = serde_json::from_str(&payload_json)
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    event
        .validate()
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    match event {
        WorkerEvent::Ready {
            identity: stored_identity,
            sequence,
            ..
        } if stored_identity == *identity && sequence == 1 && sequence == stored_sequence => {
            Ok(true)
        }
        _ => Err(StoreError::CorruptState(identity.job_id.clone())),
    }
}

fn latest_checkpoint_for_attempt_tx(
    transaction: &Transaction<'_>,
    identity: &WorkerIdentity,
) -> Result<Option<String>, StoreError> {
    let path = transaction
        .query_row(
            "SELECT path FROM runtime_job_checkpoints
             WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
             ORDER BY sequence DESC LIMIT 1",
            params![
                identity.job_id,
                identity.attempt,
                identity.worker_instance_id,
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(path) = &path {
        validate_relative_path("persisted checkpoint path", path)
            .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
        require_path_in_job_namespace(&identity.job_id, path)
            .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    }
    Ok(path)
}

fn latest_worker_event_name_tx(
    transaction: &Transaction<'_>,
    identity: &WorkerIdentity,
    last_worker_sequence: u64,
) -> Result<Option<String>, StoreError> {
    if last_worker_sequence == 0 {
        return Ok(None);
    }
    let event_type = transaction
        .query_row(
            "SELECT event_type FROM runtime_job_events
             WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
               AND worker_sequence=?4",
            params![
                identity.job_id,
                identity.attempt,
                identity.worker_instance_id,
                u64_to_i64(last_worker_sequence, "last worker sequence")?,
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(event_type) = event_type else {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    };
    validate_identifier("persisted worker event type", &event_type)
        .map_err(|_| StoreError::CorruptState(identity.job_id.clone()))?;
    if !matches!(
        event_type.as_str(),
        "ready"
            | "ready-after-cancellation"
            | "heartbeat"
            | "progress"
            | "checkpoint"
            | "artifact"
            | "complete"
            | "failed"
            | "failed-after-cancellation"
            | "cancellation-acknowledged"
    ) {
        return Err(StoreError::CorruptState(identity.job_id.clone()));
    }
    Ok(Some(event_type))
}

fn persisted_worker_event_tx(
    transaction: &Transaction<'_>,
    identity: &WorkerIdentity,
    worker_sequence: u64,
) -> Result<Option<String>, StoreError> {
    let worker_sequence = u64_to_i64(worker_sequence, "worker event sequence")?;
    transaction
        .query_row(
            "SELECT CAST(substr(CAST(payload_json AS BLOB), 1, ?5) AS BLOB),
                    length(CAST(payload_json AS BLOB)), typeof(payload_json)
             FROM runtime_job_events
             WHERE job_id=?1 AND attempt=?2 AND worker_instance_id=?3
               AND worker_sequence=?4",
            params![
                identity.job_id,
                identity.attempt,
                identity.worker_instance_id,
                worker_sequence,
                (MAX_PROTOCOL_LINE_BYTES + 1) as i64,
            ],
            |row| bounded_payload_json(row, 0, 1, 2),
        )
        .optional()
        .map_err(StoreError::from)
}

fn append_worker_event_tx(
    transaction: &Transaction<'_>,
    identity: &WorkerIdentity,
    worker_sequence: u64,
    event_type: &str,
    payload_json: &str,
    created_at: i64,
) -> Result<(), StoreError> {
    validate_identifier("eventType", event_type)?;
    let worker_sequence = u64_to_i64(worker_sequence, "worker event sequence")?;
    if payload_json.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(StoreError::InvalidInput(
            "event payload is oversized".into(),
        ));
    }
    transaction.execute(
        "INSERT INTO runtime_job_events
         (job_id, attempt, worker_instance_id, worker_sequence, event_type, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            identity.job_id,
            identity.attempt,
            identity.worker_instance_id,
            worker_sequence,
            event_type,
            payload_json,
            created_at,
        ],
    )?;
    Ok(())
}

fn append_event_tx(
    transaction: &Transaction<'_>,
    job_id: &str,
    attempt: u32,
    worker_instance_id: Option<&str>,
    event_type: &str,
    payload: &Value,
    created_at: i64,
) -> Result<(), StoreError> {
    validate_identifier("eventType", event_type)?;
    let payload_json = canonical_json_string(payload)?;
    if payload_json.len() > MAX_PROTOCOL_LINE_BYTES {
        return Err(StoreError::InvalidInput(
            "event payload is oversized".into(),
        ));
    }
    transaction.execute(
        "INSERT INTO runtime_job_events
         (job_id, attempt, worker_instance_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            job_id,
            attempt,
            worker_instance_id,
            event_type,
            payload_json,
            created_at,
        ],
    )?;
    Ok(())
}

fn canonical_json_string(value: &Value) -> Result<String, StoreError> {
    serde_json::to_string(&canonical_json_value(value))
        .map_err(|error| StoreError::InvalidInput(error.to_string()))
}

fn canonical_json_value(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonical_json_value).collect()),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            let mut canonical = serde_json::Map::new();
            for key in keys {
                let item = values.get(key).expect("key came from this JSON object");
                canonical.insert(key.clone(), canonical_json_value(item));
            }
            Value::Object(canonical)
        }
        scalar => scalar.clone(),
    }
}

fn worker_event_name(event: &WorkerEvent) -> &'static str {
    match event {
        WorkerEvent::Ready { .. } => "ready",
        WorkerEvent::Heartbeat { .. } => "heartbeat",
        WorkerEvent::Progress { .. } => "progress",
        WorkerEvent::Checkpoint { .. } => "checkpoint",
        WorkerEvent::Artifact { .. } => "artifact",
        WorkerEvent::Complete { .. } => "complete",
        WorkerEvent::Failed { .. } => "failed",
        WorkerEvent::CancellationAcknowledged { .. } => "cancellation-acknowledged",
    }
}

fn persisted_worker_event_name(event: &WorkerEvent, cancellation_wins: bool) -> &'static str {
    if cancellation_wins {
        match event {
            WorkerEvent::Ready { .. } => return "ready-after-cancellation",
            WorkerEvent::Failed { .. } => return "failed-after-cancellation",
            _ => {}
        }
    }
    worker_event_name(event)
}

fn process_exit_classification_name(classification: ProcessExitClassification) -> &'static str {
    match classification {
        ProcessExitClassification::TargetExit => "target-exit",
        ProcessExitClassification::Stopped => "stopped",
        ProcessExitClassification::ResourceExhausted => "resource-exhausted",
        ProcessExitClassification::SupervisorFailure => "supervisor-failure",
        ProcessExitClassification::WorkerProtocolFault => "worker-protocol-fault",
    }
}

fn pre_residency_disposition_for_launch_error(
    error: &ProcessOwnerError,
) -> PreResidencyClaimDisposition {
    // Windows reports these before CreateProcess returns a child handle. The
    // classification is derived from the OS error, never supplied by a
    // dispatcher caller.
    const ERROR_NOT_ENOUGH_MEMORY: i32 = 8;
    const ERROR_OUTOFMEMORY: i32 = 14;
    const ERROR_COMMITMENT_LIMIT: i32 = 1455;
    match error {
        ProcessOwnerError::Spawn(error)
            if matches!(
                error.raw_os_error(),
                Some(ERROR_NOT_ENOUGH_MEMORY | ERROR_OUTOFMEMORY | ERROR_COMMITMENT_LIMIT)
            ) =>
        {
            PreResidencyClaimDisposition::SpawnResourceExhausted
        }
        _ => PreResidencyClaimDisposition::SpawnFailed,
    }
}

fn state_name(state: JobState) -> &'static str {
    match state {
        JobState::Queued => "queued",
        JobState::Admitted => "admitted",
        JobState::Starting => "starting",
        JobState::Running => "running",
        JobState::Checkpointing => "checkpointing",
        JobState::Cancelling => "cancelling",
        JobState::Cancelled => "cancelled",
        JobState::Succeeded => "succeeded",
        JobState::Failed => "failed",
        JobState::ResourceExhausted => "resource_exhausted",
        JobState::Interrupted => "interrupted",
        JobState::Uncertain => "uncertain",
    }
}

fn parse_state(value: &str) -> Option<JobState> {
    Some(match value {
        "queued" => JobState::Queued,
        "admitted" => JobState::Admitted,
        "starting" => JobState::Starting,
        "running" => JobState::Running,
        "checkpointing" => JobState::Checkpointing,
        "cancelling" => JobState::Cancelling,
        "cancelled" => JobState::Cancelled,
        "succeeded" => JobState::Succeeded,
        "failed" => JobState::Failed,
        "resource_exhausted" => JobState::ResourceExhausted,
        "interrupted" => JobState::Interrupted,
        "uncertain" => JobState::Uncertain,
        _ => return None,
    })
}

fn now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

fn initialize_schema(connection: &mut Connection) -> Result<(), StoreError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut version: i64 = transaction.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if !(0..=SCHEMA_VERSION).contains(&version) {
        return Err(StoreError::UnsupportedSchemaVersion {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }
    if version == 0 {
        let existing_schema_objects: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE name NOT GLOB 'sqlite_*' AND type IN ('table','index','view','trigger')",
            [],
            |row| row.get(0),
        )?;
        if existing_schema_objects != 0 {
            return Err(StoreError::UnversionedSchema);
        }
        transaction.execute_batch(SCHEMA_V1)?;
        transaction.execute_batch("PRAGMA user_version = 1;")?;
        version = 1;
    }
    if version == 1 {
        // Never run migration DDL over a database that merely claims to be v1.
        validate_schema_v1_shape(&transaction, 1)?;
        require_no_unexpected_schema_objects(&transaction, 1, SCHEMA_V1_OBJECTS)?;
        transaction.execute_batch(SCHEMA_V2)?;
        version = 2;
    }
    if version == 2 {
        // V2 never persisted request bytes, so only an empty V2 job ledger can
        // be upgraded without inventing or losing submission authority.
        validate_schema_v2_shape(&transaction, 2, SCHEMA_V2_OBJECTS)?;
        let legacy_jobs: i64 =
            transaction.query_row("SELECT COUNT(*) FROM runtime_jobs", [], |row| row.get(0))?;
        if legacy_jobs != 0 {
            return Err(StoreError::LegacyJobInputsUnavailable { jobs: legacy_jobs });
        }
        transaction.execute_batch(SCHEMA_V3)?;
        version = 3;
    }
    if version == 3 {
        // V4 adds only the validated admitted-work FIFO index. Validate the
        // complete v3 shape first so a database cannot smuggle arbitrary
        // schema objects through this otherwise metadata-only migration.
        validate_schema_v3_shape(&transaction, 3, SCHEMA_V3_OBJECTS)?;
        transaction.execute_batch(SCHEMA_V4)?;
        version = 4;
    }
    if version != SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchemaVersion {
            found: version,
            supported: SCHEMA_VERSION,
        });
    }
    let persisted_version: i64 =
        transaction.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if persisted_version != SCHEMA_VERSION {
        return Err(StoreError::UnsupportedSchemaVersion {
            found: persisted_version,
            supported: SCHEMA_VERSION,
        });
    }
    validate_schema_v4_shape(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn validate_schema_v1_shape(connection: &Connection, version: i64) -> Result<(), StoreError> {
    for (object_type, object_name) in [
        ("table", "runtime_jobs"),
        ("index", "runtime_jobs_state_idx"),
        ("index", "runtime_jobs_owner_idx"),
        ("table", "runtime_job_events"),
        ("index", "runtime_job_events_replay_idx"),
        ("index", "runtime_job_events_worker_sequence_idx"),
        ("table", "runtime_job_checkpoints"),
        ("index", "runtime_job_checkpoints_job_idx"),
    ] {
        require_schema_object_matches(connection, version, object_type, object_name, SCHEMA_V1)?;
    }
    for (table, required_columns) in [
        (
            "runtime_jobs",
            &[
                "job_id",
                "job_type",
                "worker_kind",
                "resource_class",
                "owner_principal",
                "user_id",
                "garden_id",
                "conversation_id",
                "state",
                "stage",
                "attempt",
                "worker_instance_id",
                "input_manifest_path",
                "workspace_path",
                "checkpoint_path",
                "result_path",
                "created_at",
                "started_at",
                "updated_at",
                "finished_at",
                "last_heartbeat_at",
                "last_worker_sequence",
                "progress_current",
                "progress_total",
                "failure_code",
                "failure_message",
                "cancellation_requested",
                "idempotency_key",
                "request_digest",
            ][..],
        ),
        (
            "runtime_job_events",
            &[
                "sequence",
                "job_id",
                "attempt",
                "worker_instance_id",
                "worker_sequence",
                "event_type",
                "payload_json",
                "created_at",
            ][..],
        ),
        (
            "runtime_job_checkpoints",
            &[
                "sequence",
                "job_id",
                "attempt",
                "worker_instance_id",
                "kind",
                "path",
                "created_at",
            ][..],
        ),
    ] {
        require_table_columns(connection, version, table, required_columns)?;
    }
    require_unique_index_columns(
        connection,
        version,
        "runtime_jobs",
        &["owner_principal", "idempotency_key"],
        false,
        None,
    )?;
    require_unique_index_columns(
        connection,
        version,
        "runtime_job_events",
        &["job_id", "attempt", "worker_instance_id", "worker_sequence"],
        true,
        Some(
            "CREATE UNIQUE INDEX runtime_job_events_worker_sequence_idx
             ON runtime_job_events(job_id, attempt, worker_instance_id, worker_sequence)
             WHERE worker_sequence IS NOT NULL",
        ),
    )?;
    require_foreign_key(
        connection,
        version,
        "runtime_job_events",
        "job_id",
        "runtime_jobs",
        "job_id",
        "CASCADE",
    )?;
    require_foreign_key(
        connection,
        version,
        "runtime_job_checkpoints",
        "job_id",
        "runtime_jobs",
        "job_id",
        "CASCADE",
    )?;
    Ok(())
}

fn validate_schema_v2_shape(
    connection: &Connection,
    version: i64,
    expected_objects: &[&str],
) -> Result<(), StoreError> {
    validate_schema_v1_shape(connection, version)?;
    for (object_type, object_name) in [
        ("table", "runtime_admission_reservations"),
        ("index", "runtime_admission_reservations_active_subject_idx"),
        (
            "index",
            "runtime_admission_reservations_active_definition_idx",
        ),
    ] {
        require_schema_object_matches(connection, version, object_type, object_name, SCHEMA_V2)?;
    }
    require_table_columns(
        connection,
        version,
        "runtime_admission_reservations",
        &[
            "reservation_id",
            "subject_kind",
            "subject_id",
            "definition_key",
            "resource_class",
            "estimated_pending_commit_mb",
            "lifecycle_state",
            "created_at",
            "updated_at",
            "settled_at",
            "released_at",
        ],
    )?;
    require_unique_index_columns(
        connection,
        version,
        "runtime_admission_reservations",
        &["subject_kind", "subject_id"],
        true,
        Some(
            "CREATE UNIQUE INDEX runtime_admission_reservations_active_subject_idx
             ON runtime_admission_reservations(subject_kind, subject_id)
             WHERE lifecycle_state IN ('pending','resident')",
        ),
    )?;
    require_no_unexpected_schema_objects(connection, version, expected_objects)?;
    Ok(())
}

fn validate_schema_v3_shape(
    connection: &Connection,
    version: i64,
    expected_objects: &[&str],
) -> Result<(), StoreError> {
    validate_schema_v2_shape(connection, version, expected_objects)?;
    for (object_type, object_name) in [
        ("index", "runtime_jobs_request_binding_idx"),
        ("table", "runtime_job_inputs"),
    ] {
        require_schema_object_matches(connection, version, object_type, object_name, SCHEMA_V3)?;
    }
    require_table_columns(
        connection,
        version,
        "runtime_job_inputs",
        &["job_id", "request_digest", "canonical_request_payload"],
    )?;
    require_unique_index_columns(
        connection,
        version,
        "runtime_jobs",
        &["job_id", "request_digest"],
        false,
        Some(
            "CREATE UNIQUE INDEX runtime_jobs_request_binding_idx
             ON runtime_jobs(job_id, request_digest)",
        ),
    )?;
    require_composite_foreign_key(
        connection,
        version,
        "runtime_job_inputs",
        "runtime_jobs",
        &[("job_id", "job_id"), ("request_digest", "request_digest")],
        "CASCADE",
    )?;
    require_no_unexpected_schema_objects(connection, version, expected_objects)?;
    Ok(())
}

fn validate_schema_v4_shape(connection: &Connection) -> Result<(), StoreError> {
    validate_schema_v3_shape(connection, 4, SCHEMA_V4_OBJECTS)?;
    require_schema_object_matches(
        connection,
        4,
        "index",
        "runtime_jobs_admitted_fifo_idx",
        SCHEMA_V4,
    )?;
    require_schema_object_matches(
        connection,
        4,
        "index",
        "runtime_jobs_queued_fifo_idx",
        SCHEMA_V4,
    )?;
    require_no_unexpected_schema_objects(connection, 4, SCHEMA_V4_OBJECTS)?;
    Ok(())
}

fn require_schema_object_matches(
    connection: &Connection,
    version: i64,
    object_type: &str,
    object_name: &str,
    expected_schema: &str,
) -> Result<(), StoreError> {
    let actual_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type=?1 AND name=?2",
            params![object_type, object_name],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let normalized_name = object_name.to_ascii_lowercase();
    let expected_sql = expected_schema.split(';').find(|statement| {
        let normalized = normalize_schema_sql(statement).to_ascii_lowercase();
        normalized.starts_with(&format!("createtable{normalized_name}("))
            || normalized.starts_with(&format!("createindex{normalized_name}on"))
            || normalized.starts_with(&format!("createuniqueindex{normalized_name}on"))
    });
    let matches = match (actual_sql.as_deref(), expected_sql) {
        (Some(actual), Some(expected)) => {
            normalize_schema_sql(actual) == normalize_schema_sql(expected)
        }
        _ => false,
    };
    if matches {
        Ok(())
    } else {
        Err(StoreError::SchemaMismatch {
            version,
            column: format!("schema object {object_name}"),
        })
    }
}

fn require_no_unexpected_schema_objects(
    connection: &Connection,
    version: i64,
    expected_objects: &[&str],
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(
        "SELECT name FROM sqlite_master
         WHERE name NOT GLOB 'sqlite_*' AND type IN ('table','index','view','trigger')
         ORDER BY name",
    )?;
    let objects = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for object in objects {
        if !expected_objects.contains(&object.as_str()) {
            return Err(StoreError::SchemaMismatch {
                version,
                column: format!("unexpected schema object {object}"),
            });
        }
    }
    Ok(())
}

fn require_table_columns(
    connection: &Connection,
    version: i64,
    table: &str,
    required_columns: &[&str],
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(&format!(
        "PRAGMA table_info({})",
        quoted_sql_identifier(table)
    ))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<HashSet<_>, _>>()?;
    for required in required_columns {
        if !columns.contains(*required) {
            return Err(StoreError::SchemaMismatch {
                version,
                column: format!("{table}.{required}"),
            });
        }
    }
    Ok(())
}

fn require_unique_index_columns(
    connection: &Connection,
    version: i64,
    table: &str,
    required_columns: &[&str],
    partial: bool,
    expected_sql: Option<&str>,
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(&format!(
        "PRAGMA index_list({})",
        quoted_sql_identifier(table)
    ))?;
    let indexes = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? != 0,
                row.get::<_, i64>(4)? != 0,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for (index_name, unique, is_partial) in indexes {
        if !unique || is_partial != partial {
            continue;
        }
        let mut statement = connection.prepare(&format!(
            "PRAGMA index_info({})",
            quoted_sql_identifier(&index_name)
        ))?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(2))?
            .collect::<Result<Vec<_>, _>>()?;
        if columns
            .iter()
            .map(String::as_str)
            .eq(required_columns.iter().copied())
        {
            if let Some(expected_sql) = expected_sql {
                let actual_sql: Option<String> = connection.query_row(
                    "SELECT sql FROM sqlite_master WHERE type='index' AND name=?1",
                    params![index_name],
                    |row| row.get(0),
                )?;
                if actual_sql.as_deref().map(normalize_schema_sql)
                    != Some(normalize_schema_sql(expected_sql))
                {
                    continue;
                }
            }
            return Ok(());
        }
    }
    Err(StoreError::SchemaMismatch {
        version,
        column: format!(
            "{table}.unique({}){}",
            required_columns.join(","),
            if partial { "[partial]" } else { "" }
        ),
    })
}

fn normalize_schema_sql(sql: &str) -> String {
    sql.split_whitespace().collect::<String>()
}

fn require_foreign_key(
    connection: &Connection,
    version: i64,
    table: &str,
    from: &str,
    target_table: &str,
    target_column: &str,
    on_delete: &str,
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(&format!(
        "PRAGMA foreign_key_list({})",
        quoted_sql_identifier(table)
    ))?;
    let foreign_keys = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if foreign_keys
        .iter()
        .any(|(actual_table, actual_from, actual_to, actual_delete)| {
            actual_table == target_table
                && actual_from == from
                && actual_to == target_column
                && actual_delete.eq_ignore_ascii_case(on_delete)
        })
    {
        Ok(())
    } else {
        Err(StoreError::SchemaMismatch {
            version,
            column: format!("{table}.{from}->{}.{target_column}", target_table),
        })
    }
}

fn require_composite_foreign_key(
    connection: &Connection,
    version: i64,
    table: &str,
    target_table: &str,
    columns: &[(&str, &str)],
    on_delete: &str,
) -> Result<(), StoreError> {
    let mut statement = connection.prepare(&format!(
        "PRAGMA foreign_key_list({})",
        quoted_sql_identifier(table)
    ))?;
    let foreign_keys = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut candidate_ids = foreign_keys
        .iter()
        .filter(|(_, _, actual_table, _, _, actual_delete)| {
            actual_table == target_table && actual_delete.eq_ignore_ascii_case(on_delete)
        })
        .map(|(id, _, _, _, _, _)| *id)
        .collect::<HashSet<_>>();
    if candidate_ids.drain().any(|id| {
        let mut actual = foreign_keys
            .iter()
            .filter(|(actual_id, _, _, _, _, _)| *actual_id == id)
            .map(|(_, sequence, _, from, to, _)| (*sequence, from.as_str(), to.as_str()))
            .collect::<Vec<_>>();
        actual.sort_unstable_by_key(|(sequence, _, _)| *sequence);
        actual.len() == columns.len()
            && actual.iter().zip(columns.iter()).enumerate().all(
                |(index, (actual_column, expected_column))| {
                    actual_column.0 == index as i64
                        && actual_column.1 == expected_column.0
                        && actual_column.2 == expected_column.1
                },
            )
    }) {
        Ok(())
    } else {
        Err(StoreError::SchemaMismatch {
            version,
            column: format!(
                "{table}.({})->{target_table}.({})",
                columns
                    .iter()
                    .map(|(from, _)| *from)
                    .collect::<Vec<_>>()
                    .join(","),
                columns
                    .iter()
                    .map(|(_, to)| *to)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        })
    }
}

fn quoted_sql_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

const SCHEMA_V1_OBJECTS: &[&str] = &[
    "runtime_jobs",
    "runtime_jobs_state_idx",
    "runtime_jobs_owner_idx",
    "runtime_job_events",
    "runtime_job_events_replay_idx",
    "runtime_job_events_worker_sequence_idx",
    "runtime_job_checkpoints",
    "runtime_job_checkpoints_job_idx",
];

const SCHEMA_V2_OBJECTS: &[&str] = &[
    "runtime_jobs",
    "runtime_jobs_state_idx",
    "runtime_jobs_owner_idx",
    "runtime_job_events",
    "runtime_job_events_replay_idx",
    "runtime_job_events_worker_sequence_idx",
    "runtime_job_checkpoints",
    "runtime_job_checkpoints_job_idx",
    "runtime_admission_reservations",
    "runtime_admission_reservations_active_subject_idx",
    "runtime_admission_reservations_active_definition_idx",
];

const SCHEMA_V3_OBJECTS: &[&str] = &[
    "runtime_jobs",
    "runtime_jobs_state_idx",
    "runtime_jobs_owner_idx",
    "runtime_job_events",
    "runtime_job_events_replay_idx",
    "runtime_job_events_worker_sequence_idx",
    "runtime_job_checkpoints",
    "runtime_job_checkpoints_job_idx",
    "runtime_admission_reservations",
    "runtime_admission_reservations_active_subject_idx",
    "runtime_admission_reservations_active_definition_idx",
    "runtime_jobs_request_binding_idx",
    "runtime_job_inputs",
];

const SCHEMA_V4_OBJECTS: &[&str] = &[
    "runtime_jobs",
    "runtime_jobs_state_idx",
    "runtime_jobs_owner_idx",
    "runtime_job_events",
    "runtime_job_events_replay_idx",
    "runtime_job_events_worker_sequence_idx",
    "runtime_job_checkpoints",
    "runtime_job_checkpoints_job_idx",
    "runtime_admission_reservations",
    "runtime_admission_reservations_active_subject_idx",
    "runtime_admission_reservations_active_definition_idx",
    "runtime_jobs_request_binding_idx",
    "runtime_job_inputs",
    "runtime_jobs_admitted_fifo_idx",
    "runtime_jobs_queued_fifo_idx",
];

const SCHEMA_V1: &str = r#"
CREATE TABLE runtime_jobs (
    job_id TEXT PRIMARY KEY,
    job_type TEXT NOT NULL,
    worker_kind TEXT NOT NULL,
    resource_class TEXT NOT NULL,
    owner_principal TEXT NOT NULL,
    user_id INTEGER CHECK (user_id IS NULL OR user_id > 0),
    garden_id TEXT,
    conversation_id TEXT,
    state TEXT NOT NULL CHECK (state IN (
        'queued','admitted','starting','running','checkpointing','cancelling',
        'cancelled','succeeded','failed','resource_exhausted','interrupted','uncertain'
    )),
    stage TEXT,
    attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 4294967295),
    worker_instance_id TEXT,
    input_manifest_path TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    checkpoint_path TEXT NOT NULL,
    result_path TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER,
    last_heartbeat_at INTEGER,
    last_worker_sequence INTEGER NOT NULL DEFAULT 0 CHECK (last_worker_sequence >= 0),
    progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
    progress_total INTEGER NOT NULL DEFAULT 0 CHECK (progress_total >= 0),
    failure_code TEXT,
    failure_message TEXT,
    cancellation_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancellation_requested IN (0,1)),
    idempotency_key TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    UNIQUE(owner_principal, idempotency_key)
);
CREATE INDEX runtime_jobs_state_idx ON runtime_jobs(state, updated_at);
CREATE INDEX runtime_jobs_owner_idx ON runtime_jobs(owner_principal, garden_id, created_at);

CREATE TABLE runtime_job_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL REFERENCES runtime_jobs(job_id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 4294967295),
    worker_instance_id TEXT,
    worker_sequence INTEGER CHECK (worker_sequence IS NULL OR worker_sequence > 0),
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (
        typeof(payload_json)='text' AND
        length(CAST(payload_json AS BLOB)) BETWEEN 1 AND 65536
    ),
    created_at INTEGER NOT NULL
);
CREATE INDEX runtime_job_events_replay_idx
    ON runtime_job_events(job_id, sequence);
CREATE UNIQUE INDEX runtime_job_events_worker_sequence_idx
    ON runtime_job_events(job_id, attempt, worker_instance_id, worker_sequence)
    WHERE worker_sequence IS NOT NULL;

CREATE TABLE runtime_job_checkpoints (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL REFERENCES runtime_jobs(job_id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 4294967295),
    worker_instance_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX runtime_job_checkpoints_job_idx
    ON runtime_job_checkpoints(job_id, sequence);
"#;

const SCHEMA_V2: &str = r#"
CREATE TABLE runtime_admission_reservations (
    reservation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('job','service')),
    subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 128),
    definition_key TEXT NOT NULL CHECK (length(definition_key) BETWEEN 1 AND 128),
    resource_class TEXT NOT NULL CHECK (length(resource_class) BETWEEN 1 AND 128),
    estimated_pending_commit_mb INTEGER NOT NULL
        CHECK (estimated_pending_commit_mb BETWEEN 1 AND 1048576),
    lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('pending','resident','released')),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
    settled_at INTEGER CHECK (settled_at IS NULL OR settled_at >= 0),
    released_at INTEGER CHECK (released_at IS NULL OR released_at >= 0),
    CHECK (
        (lifecycle_state='pending' AND settled_at IS NULL AND released_at IS NULL) OR
        (lifecycle_state='resident' AND settled_at IS NOT NULL AND released_at IS NULL) OR
        (lifecycle_state='released' AND released_at IS NOT NULL)
    )
);
CREATE UNIQUE INDEX runtime_admission_reservations_active_subject_idx
    ON runtime_admission_reservations(subject_kind, subject_id)
    WHERE lifecycle_state IN ('pending','resident');
CREATE INDEX runtime_admission_reservations_active_definition_idx
    ON runtime_admission_reservations(lifecycle_state, subject_kind, definition_key);
PRAGMA user_version = 2;
"#;

const SCHEMA_V3: &str = r#"
CREATE UNIQUE INDEX runtime_jobs_request_binding_idx
    ON runtime_jobs(job_id, request_digest);
CREATE TABLE runtime_job_inputs (
    job_id TEXT PRIMARY KEY,
    request_digest TEXT NOT NULL CHECK (
        length(request_digest)=64 AND
        request_digest NOT GLOB '*[^0-9a-f]*'
    ),
    canonical_request_payload BLOB NOT NULL CHECK (
        typeof(canonical_request_payload)='blob' AND
        length(canonical_request_payload) BETWEEN 1 AND 262144
    ),
    FOREIGN KEY (job_id, request_digest)
        REFERENCES runtime_jobs(job_id, request_digest) ON DELETE CASCADE
);
PRAGMA user_version = 3;
"#;

const SCHEMA_V4: &str = r#"
CREATE INDEX runtime_jobs_admitted_fifo_idx
    ON runtime_jobs(created_at, job_id) WHERE state='admitted';
CREATE INDEX runtime_jobs_queued_fifo_idx
    ON runtime_jobs(created_at, job_id) WHERE state='queued';
PRAGMA user_version = 4;
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, JobStore) {
        let directory = tempdir().unwrap();
        let store = JobStore::open_for_test(directory.path().join("runtime-v2.sqlite3")).unwrap();
        (directory, store)
    }

    fn reconcile_after_restart(store: &JobStore) -> Result<Vec<JobRecord>, StoreError> {
        let proof = store.prior_generation_drained_for_test();
        store.reconcile_after_runtime_restart_for_test(proof)
    }

    fn create_v2_database(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection.execute_batch(SCHEMA_V1).unwrap();
        connection.execute_batch(SCHEMA_V2).unwrap();
    }

    fn create_v3_database(path: &Path) {
        create_v2_database(path);
        let connection = Connection::open(path).unwrap();
        connection.execute_batch(SCHEMA_V3).unwrap();
    }

    fn owner(user_id: i64) -> JobOwner {
        JobOwner::user(user_id).unwrap()
    }

    fn context(user_id: i64) -> AuthenticatedJobContext {
        AuthenticatedJobContext::for_verified_user(user_id, Some("garden-1"), None).unwrap()
    }

    fn input_for(job_id: &str, key: &str, job_owner: JobOwner, payload: Value) -> NewJob {
        let canonical_request_payload = canonicalize_request_payload(&payload).unwrap();
        let request_digest = compute_submission_digest(
            &job_owner,
            "learn",
            Some("garden-1"),
            None,
            &canonical_request_payload,
        )
        .unwrap();
        NewJob {
            job_id: job_id.into(),
            job_type: "learn".into(),
            worker_kind: "learn-node".into(),
            resource_class: "large-generation".into(),
            owner: job_owner,
            garden_id: Some("garden-1".into()),
            conversation_id: None,
            input_manifest_path: format!("runtime/jobs/{job_id}/input.json"),
            workspace_path: format!("runtime/jobs/{job_id}/workspace"),
            checkpoint_path: format!("runtime/jobs/{job_id}/checkpoint.json"),
            result_path: format!("runtime/jobs/{job_id}/result.json"),
            idempotency_key: key.into(),
            request_digest,
            canonical_request_payload,
        }
    }

    fn input(job_id: &str, key: &str) -> NewJob {
        input_for(
            job_id,
            key,
            owner(1),
            serde_json::json!({ "source": "test" }),
        )
    }

    fn registered_admission(
        definition_key: &str,
        resource_class: ResourceClass,
        estimated_commit_mb: u64,
        maximum_concurrency: u32,
    ) -> RegisteredJobAdmission {
        RegisteredJobAdmission::new(
            "learn",
            definition_key,
            resource_class,
            estimated_commit_mb,
            maximum_concurrency,
        )
    }

    fn default_admission() -> RegisteredJobAdmission {
        registered_admission("learn-node", ResourceClass::LargeGeneration, 128, 1)
    }

    fn admit(store: &JobStore, job_id: &str, admission: &RegisteredJobAdmission) -> JobRecord {
        match store
            .try_admit_job(job_id, admission, AdmissionPolicy::default(), || {
                Ok(SystemCommit {
                    total_mb: 0,
                    limit_mb: 64 * 1024,
                })
            })
            .unwrap()
        {
            JobAdmissionResult::Admitted(job) => *job,
            JobAdmissionResult::Denied(denial) => {
                panic!("unexpected admission denial: {}", denial.reason)
            }
        }
    }

    fn active_reservation_count(store: &JobStore) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_admission_reservations
                 WHERE lifecycle_state IN ('pending','resident')",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn active_job_reservation_count(store: &JobStore, job_id: &str) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_admission_reservations
                 WHERE subject_kind='job' AND subject_id=?1
                   AND lifecycle_state IN ('pending','resident')",
                params![job_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn job_reservation_count(store: &JobStore, job_id: &str) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_admission_reservations
                 WHERE subject_kind='job' AND subject_id=?1",
                params![job_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn latest_reservation_state(store: &JobStore, job_id: &str) -> String {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT lifecycle_state FROM runtime_admission_reservations
                 WHERE subject_kind='job' AND subject_id=?1
                 ORDER BY reservation_id DESC LIMIT 1",
                params![job_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn job_event_count(store: &JobStore, job_id: &str) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_job_events WHERE job_id=?1",
                params![job_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn claim(store: &JobStore, job_id: &str, worker: &str) -> WorkerDispatchClaim {
        match store.try_claim_admitted_worker(job_id, worker).unwrap() {
            WorkerClaimOutcome::Claimed(claim) => *claim,
            WorkerClaimOutcome::NotClaimable => panic!("job {job_id} was not claimable"),
        }
    }

    fn claim_identity(store: &JobStore, job_id: &str, worker: &str) -> WorkerIdentity {
        claim(store, job_id, worker).identity().clone()
    }

    fn illicit_replay_claim(claim: &WorkerDispatchClaim) -> WorkerDispatchClaim {
        WorkerDispatchClaim {
            generation_scope: claim.generation_scope.clone(),
            identity: claim.identity.clone(),
            job: claim.job.clone(),
        }
    }

    fn settle_claim(store: &JobStore, claim: WorkerDispatchClaim) -> WorkerIdentity {
        let residency = ProcessTreeResidency::worker_for_test(
            store.generation_scope.clone(),
            claim.identity().clone(),
        );
        store.settle_job_reservation(claim, residency).unwrap()
    }

    fn claim_and_settle(store: &JobStore, job_id: &str, worker: &str) -> WorkerIdentity {
        settle_claim(store, claim(store, job_id, worker))
    }

    fn resident_tree_exit(store: &JobStore, identity: WorkerIdentity) -> ProcessTreeExit {
        ProcessTreeExit::worker_release_after_started_for_test_in_scope(
            store.generation_scope.clone(),
            identity,
        )
    }

    fn start(store: &JobStore, job_id: &str, worker: &str) -> WorkerIdentity {
        admit(store, job_id, &default_admission());
        let identity = claim_and_settle(store, job_id, worker);
        store
            .apply_worker_event(&WorkerEvent::Ready {
                identity: identity.clone(),
                sequence: 1,
                protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
            })
            .unwrap();
        identity
    }

    fn validated_result(job_id: &str) -> ValidatedWorkerResult {
        ValidatedWorkerResult::from_trusted_validation(
            format!("runtime/jobs/{job_id}/result.json"),
            "a".repeat(64),
            128,
        )
        .unwrap()
    }

    #[test]
    fn duplicate_submission_is_idempotent_within_an_owner() {
        let (_directory, store) = store();
        let first = store.submit_raw(&input("job_1", "request_1")).unwrap();
        let duplicate = store.submit_raw(&input("job_2", "request_1")).unwrap();
        assert_eq!(first.job_id, duplicate.job_id);
        assert_eq!(duplicate.state, JobState::Queued);
        assert_eq!(
            store
                .load_canonical_request_payload(&first.job_id)
                .unwrap()
                .as_slice(),
            br#"{"source":"test"}"#
        );
    }

    #[test]
    fn closed_admission_rejects_submission_before_any_durable_row_or_event() {
        let (_directory, store) = store();
        store.set_accepting_work(false);

        assert!(matches!(
            store.submit_raw(&input("job_closed", "request_closed")),
            Err(StoreError::AdmissionClosed)
        ));
        {
            let connection = store.connection.lock().unwrap();
            for table in ["runtime_jobs", "runtime_job_inputs", "runtime_job_events"] {
                let count: i64 = connection
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(count, 0, "closed submission wrote to {table}");
            }
        }

        // Tests may explicitly reopen the lifecycle gate; production shutdown
        // never does so within the same generation.
        store.set_accepting_work(true);
        assert_eq!(
            store
                .submit_raw(&input("job_reopened", "request_reopened"))
                .unwrap()
                .state,
            JobState::Queued
        );
        assert_eq!(
            store
                .events_after(&context(1), "job_reopened", 0, 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn worker_event_rejection_classification_is_conservative() {
        let deterministic = [
            StoreError::WorkerEventInState {
                job_id: "job_1".into(),
                state: JobState::Cancelled,
            },
            StoreError::WorkerEventRejected,
            StoreError::WorkerEventAfterCompletionIntent("job_1".into()),
        ];
        assert!(deterministic
            .iter()
            .all(StoreError::is_deterministic_worker_event_rejection));

        let fatal = [
            StoreError::Database(rusqlite::Error::InvalidQuery),
            StoreError::CorruptState("job_1".into()),
            StoreError::GenerationAuthorityMismatch,
            StoreError::StaleWorker("job_1".into()),
            StoreError::OutOfOrderWorkerEvent {
                job_id: "job_1".into(),
                expected: 2,
                actual: 3,
            },
            StoreError::ConflictingWorkerEvent {
                job_id: "job_1".into(),
                sequence: 2,
            },
            StoreError::InvalidInput("ambiguous caller input".into()),
            StoreError::Transition(crate::StateTransitionError {
                from: JobState::Cancelling,
                to: JobState::Running,
            }),
            StoreError::ProtocolValidation(
                validate_identifier("worker event test", "").unwrap_err(),
            ),
        ];
        assert!(fatal
            .iter()
            .all(|error| !error.is_deterministic_worker_event_rejection()));
    }

    #[test]
    fn idempotency_conflicts_on_a_changed_request_but_not_across_owners() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let changed = input_for(
            "job_2",
            "request_1",
            owner(1),
            serde_json::json!({ "source": "changed" }),
        );
        assert!(matches!(
            store.submit_raw(&changed),
            Err(StoreError::IdempotencyConflict { .. })
        ));

        let other_owner = input_for(
            "job_3",
            "request_1",
            owner(2),
            serde_json::json!({ "source": "test" }),
        );
        assert_eq!(store.submit_raw(&other_owner).unwrap().job_id, "job_3");
    }

    #[test]
    fn request_input_digest_is_bound_to_its_job_row() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let connection = store.connection.lock().unwrap();
        let result = connection.execute(
            "UPDATE runtime_job_inputs SET request_digest=?2 WHERE job_id=?1",
            params!["job_1", "b".repeat(64)],
        );
        assert!(matches!(result, Err(rusqlite::Error::SqliteFailure(_, _))));
    }

    #[test]
    fn bounded_input_loader_rejects_payload_tampering() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_job_inputs
                     SET canonical_request_payload=?2 WHERE job_id=?1",
                    params!["job_1", b"{\"source\":\"tampered\"}".as_slice()],
                )
                .unwrap();
        }
        assert!(matches!(
            store.load_canonical_request_payload("job_1"),
            Err(StoreError::CorruptState(job_id)) if job_id == "job_1"
        ));
    }

    #[test]
    fn concurrent_admissions_observe_one_durable_heavyweight_reservation() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        store.submit_raw(&input("job_2", "request_2")).unwrap();
        let store = Arc::new(store);
        let barrier = Arc::new(Barrier::new(3));
        let admission = registered_admission("learn-node", ResourceClass::LargeGeneration, 128, 2);
        let mut handles = Vec::new();
        for job_id in ["job_1", "job_2"] {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            let admission = admission.clone();
            handles.push(thread::spawn(move || {
                barrier.wait();
                store
                    .try_admit_job(job_id, &admission, AdmissionPolicy::default(), || {
                        Ok(SystemCommit {
                            total_mb: 0,
                            limit_mb: 64 * 1024,
                        })
                    })
                    .unwrap()
            }));
        }
        barrier.wait();
        let outcomes = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| matches!(outcome, JobAdmissionResult::Admitted(_)))
                .count(),
            1
        );
        assert_eq!(
            outcomes
                .iter()
                .filter(|outcome| matches!(outcome, JobAdmissionResult::Denied(_)))
                .count(),
            1
        );
        assert_eq!(active_reservation_count(store.as_ref()), 1);
        let states = ["job_1", "job_2"].map(|job_id| store.get(&context(1), job_id).unwrap().state);
        assert_eq!(
            states
                .iter()
                .filter(|state| **state == JobState::ResourceExhausted)
                .count(),
            1
        );
        assert_eq!(
            states
                .iter()
                .filter(|state| **state == JobState::Admitted)
                .count(),
            1
        );
    }

    #[test]
    fn durable_service_reservation_participates_in_global_heavyweight_admission() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO runtime_admission_reservations (
                        subject_kind, subject_id, definition_key, resource_class,
                        estimated_pending_commit_mb, lifecycle_state, created_at, updated_at
                     ) VALUES ('service', 'service_1', 'service_1', 'local-model',
                               128, 'pending', 1, 1)",
                    [],
                )
                .unwrap();
        }
        let result = store
            .try_admit_job(
                "job_1",
                &default_admission(),
                AdmissionPolicy {
                    one_heavyweight_at_a_time: false,
                    ..AdmissionPolicy::default()
                },
                || {
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 64 * 1024,
                    })
                },
            )
            .unwrap();
        let JobAdmissionResult::Denied(denial) = result else {
            panic!("expected heavyweight service denial")
        };
        assert_eq!(denial.resource, "heavyweight_concurrency");
        let denied = store.get(&context(1), "job_1").unwrap();
        assert_eq!(denied.state, JobState::ResourceExhausted);
        assert_eq!(
            denied.failure_code.as_deref(),
            Some(ADMISSION_RESOURCE_EXHAUSTED_FAILURE_CODE)
        );
        assert_eq!(
            denied.failure_message.as_deref(),
            Some(ADMISSION_RESOURCE_EXHAUSTED_FAILURE_MESSAGE)
        );
        assert_eq!(active_job_reservation_count(&store, "job_1"), 0);
        let events = store.events_after(&context(1), "job_1", 0, 10).unwrap();
        let terminal = events
            .iter()
            .find(|event| event.event_type == "resource_exhausted")
            .expect("permanent admission denial must append its terminal event");
        assert_eq!(terminal.payload["state"], "resource_exhausted");
        assert_eq!(terminal.payload["reservationCreated"], false);
        assert_eq!(
            terminal.payload["admissionDenial"]["resource"],
            "heavyweight_concurrency"
        );
        assert_eq!(terminal.payload["admissionDenial"]["retryable"], false);
    }

    #[test]
    fn per_worker_concurrency_is_enforced_from_active_reservations() {
        let (_directory, store) = store();
        for (job_id, key) in [("job_1", "request_1"), ("job_2", "request_2")] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
        }
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 1);
        admit(&store, "job_1", &admission);
        let denial = store
            .try_admit_job("job_2", &admission, AdmissionPolicy::default(), || {
                Ok(SystemCommit {
                    total_mb: 0,
                    limit_mb: 64 * 1024,
                })
            })
            .unwrap();
        let JobAdmissionResult::Denied(denial) = denial else {
            panic!("expected worker-concurrency denial")
        };
        assert_eq!(denial.resource, "worker_concurrency");
        assert!(!denial.retryable);
        assert_eq!(
            store.get(&context(1), "job_2").unwrap().state,
            JobState::ResourceExhausted
        );
        assert_eq!(active_job_reservation_count(&store, "job_2"), 0);
        assert!(matches!(
            store.try_admit_job("job_2", &admission, AdmissionPolicy::default(), || panic!(
                "a terminal admission denial must not be sampled again"
            ),),
            Err(StoreError::Transition(_))
        ));
    }

    #[test]
    fn shutdown_denial_is_serialized_and_leaves_the_job_queued() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        store.set_accepting_work(false);
        let result = store
            .try_admit_job(
                "job_1",
                &default_admission(),
                AdmissionPolicy::default(),
                || panic!("shutdown admission must not sample commit"),
            )
            .unwrap();
        let JobAdmissionResult::Denied(denial) = result else {
            panic!("expected shutdown denial")
        };
        assert_eq!(denial.resource, "runtime");
        assert!(denial.is_runtime_shutdown_gate());
        assert!(!denial.retryable);
        assert_eq!(active_reservation_count(&store), 0);
        assert_eq!(
            store.get(&context(1), "job_1").unwrap().state,
            JobState::Queued
        );
        assert_eq!(
            store
                .events_after(&context(1), "job_1", 0, 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn pending_estimates_reduce_headroom_for_following_admissions() {
        let (_directory, store) = store();
        let mut first = input("job_1", "request_1");
        first.resource_class = "core".into();
        store.submit_raw(&first).unwrap();
        let mut second = input("job_2", "request_2");
        second.worker_kind = "other-node".into();
        second.resource_class = "core".into();
        store.submit_raw(&second).unwrap();
        let first_admission = registered_admission("learn-node", ResourceClass::Core, 2_000, 1);
        let second_admission = registered_admission("other-node", ResourceClass::Core, 2_000, 1);
        match store
            .try_admit_job(
                "job_1",
                &first_admission,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 12_000,
                    })
                },
            )
            .unwrap()
        {
            JobAdmissionResult::Admitted(_) => {}
            JobAdmissionResult::Denied(denial) => panic!("unexpected denial: {}", denial.reason),
        }
        let second = store
            .try_admit_job(
                "job_2",
                &second_admission,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 12_000,
                    })
                },
            )
            .unwrap();
        let JobAdmissionResult::Denied(denial) = second else {
            panic!("expected pending-commit denial")
        };
        assert_eq!(denial.resource, "windows_commit");
        assert!(!denial.retryable);
        assert_eq!(
            store.get(&context(1), "job_2").unwrap().state,
            JobState::ResourceExhausted
        );
        assert_eq!(active_job_reservation_count(&store, "job_2"), 0);
    }

    #[test]
    fn settling_stops_double_counting_commit_but_retains_concurrency() {
        let (_directory, store) = store();
        for (job_id, key, worker) in [
            ("job_1", "request_1", "learn-node"),
            ("job_2", "request_2", "learn-node"),
            ("job_3", "request_3", "other-node"),
        ] {
            let mut job = input(job_id, key);
            job.worker_kind = worker.into();
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
        }
        let first_admission = registered_admission("learn-node", ResourceClass::Core, 2_000, 1);
        let other_admission = registered_admission("other-node", ResourceClass::Core, 2_000, 1);
        match store
            .try_admit_job(
                "job_1",
                &first_admission,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 13_000,
                    })
                },
            )
            .unwrap()
        {
            JobAdmissionResult::Admitted(_) => {}
            JobAdmissionResult::Denied(denial) => panic!("unexpected denial: {}", denial.reason),
        }
        claim_and_settle(&store, "job_1", "worker_1");
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");

        let same_worker = store
            .try_admit_job(
                "job_2",
                &first_admission,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 2_000,
                        limit_mb: 13_000,
                    })
                },
            )
            .unwrap();
        assert!(matches!(same_worker, JobAdmissionResult::Denied(_)));
        assert_eq!(
            store.get(&context(1), "job_2").unwrap().state,
            JobState::ResourceExhausted
        );
        assert_eq!(active_job_reservation_count(&store, "job_2"), 0);

        let other_worker = store
            .try_admit_job(
                "job_3",
                &other_admission,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 2_000,
                        limit_mb: 13_000,
                    })
                },
            )
            .unwrap();
        assert!(matches!(other_worker, JobAdmissionResult::Admitted(_)));
    }

    #[test]
    fn resident_heavyweight_still_blocks_a_conflicting_heavyweight_admission() {
        let (_directory, store) = store();
        for (job_id, key) in [("job_1", "request_1"), ("job_2", "request_2")] {
            store.submit_raw(&input(job_id, key)).unwrap();
        }
        let first = registered_admission("learn-node", ResourceClass::LargeGeneration, 2_000, 2);
        admit(&store, "job_1", &first);
        claim_and_settle(&store, "job_1", "worker_1");
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");

        let denial = match store
            .try_admit_job("job_2", &first, AdmissionPolicy::default(), || {
                Ok(SystemCommit {
                    total_mb: 0,
                    limit_mb: 64 * 1024,
                })
            })
            .unwrap()
        {
            JobAdmissionResult::Denied(denial) => denial,
            JobAdmissionResult::Admitted(_) => {
                panic!("resident heavyweight must keep the global class occupied")
            }
        };
        assert_eq!(denial.resource, "heavyweight_concurrency");
    }

    #[test]
    fn complete_tree_exit_releases_the_concurrency_hold() {
        let (_directory, store) = store();
        for (job_id, key) in [("job_1", "request_1"), ("job_2", "request_2")] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
        }
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 1);
        admit(&store, "job_1", &admission);
        let identity = claim_and_settle(&store, "job_1", "worker_1");
        let tree_exit = resident_tree_exit(&store, identity.clone());
        store.worker_exited_without_terminal(&tree_exit).unwrap();
        assert_eq!(
            store
                .worker_exited_without_terminal(&tree_exit)
                .unwrap()
                .state,
            JobState::Failed
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert!(matches!(
            store
                .try_admit_job("job_2", &admission, AdmissionPolicy::default(), || Ok(
                    SystemCommit {
                        total_mb: 0,
                        limit_mb: 64 * 1024
                    }
                ),)
                .unwrap(),
            JobAdmissionResult::Admitted(_)
        ));
    }

    #[test]
    fn start_failure_releases_the_pending_concurrency_hold_atomically() {
        let (_directory, store) = store();
        for (job_id, key) in [("job_1", "request_1"), ("job_2", "request_2")] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
        }
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 1);
        admit(&store, "job_1", &admission);
        let failed = store
            .worker_start_failed_before_assignment("job_1", false)
            .unwrap();
        assert_eq!(failed.state, JobState::Interrupted);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert!(matches!(
            store
                .try_admit_job("job_2", &admission, AdmissionPolicy::default(), || Ok(
                    SystemCommit {
                        total_mb: 0,
                        limit_mb: 64 * 1024
                    }
                ),)
                .unwrap(),
            JobAdmissionResult::Admitted(_)
        ));
    }

    #[test]
    fn queued_admission_candidates_are_bounded_fifo_and_advisory() {
        let (_directory, store) = store();
        for (job_id, key) in [
            ("job_b", "request_b"),
            ("job_a", "request_a"),
            ("job_admitted", "request_admitted"),
        ] {
            store.submit_raw(&input(job_id, key)).unwrap();
        }
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_jobs SET created_at=100, updated_at=100
                     WHERE job_id IN ('job_a','job_b')",
                    [],
                )
                .unwrap();
            let mut plan = connection
                .prepare(
                    "EXPLAIN QUERY PLAN
                     SELECT jobs.job_id, jobs.job_type, jobs.worker_kind, jobs.resource_class,
                            jobs.created_at
                     FROM runtime_jobs AS jobs INDEXED BY runtime_jobs_queued_fifo_idx
                     WHERE jobs.state='queued'
                     ORDER BY jobs.created_at ASC, jobs.job_id ASC
                     LIMIT ?1",
                )
                .unwrap();
            let details = plan
                .query_map(params![2_i64], |row| row.get::<_, String>(3))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert!(details
                .iter()
                .any(|detail| detail.contains("runtime_jobs_queued_fifo_idx")));
        }
        admit(&store, "job_admitted", &default_admission());

        assert!(matches!(
            store.queued_admission_candidates(0),
            Err(StoreError::InvalidInput(_))
        ));
        assert!(matches!(
            store.queued_admission_candidates(MAX_DISPATCH_CANDIDATES + 1),
            Err(StoreError::InvalidInput(_))
        ));
        let candidates = store.queued_admission_candidates(2).unwrap();
        assert_eq!(
            candidates
                .iter()
                .map(QueuedAdmissionCandidate::job_id)
                .collect::<Vec<_>>(),
            vec!["job_a", "job_b"]
        );
        assert!(candidates.iter().all(|candidate| {
            candidate.job_type() == "learn"
                && candidate.worker_kind() == "learn-node"
                && candidate.resource_class() == "large-generation"
                && candidate.created_at() == 100
        }));
        assert_eq!(
            store.get(&context(1), "job_a").unwrap().state,
            JobState::Queued
        );
        assert_eq!(store.get(&context(1), "job_a").unwrap().attempt, 0);
        assert_eq!(job_reservation_count(&store, "job_a"), 0);
        assert!(!candidates
            .iter()
            .any(|candidate| candidate.job_id() == "job_admitted"));
    }

    #[test]
    fn dispatch_candidates_are_bounded_admitted_only_and_fifo() {
        let (_directory, store) = store();
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 16);
        for (job_id, key) in [
            ("job_b", "request_b"),
            ("job_a", "request_a"),
            ("job_c", "request_c"),
            ("job_queued", "request_queued"),
        ] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
        }
        for job_id in ["job_b", "job_a", "job_c"] {
            admit(&store, job_id, &admission);
        }
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_jobs
                     SET created_at=CASE job_id
                         WHEN 'job_a' THEN 100 WHEN 'job_b' THEN 100 ELSE 200 END
                     WHERE job_id IN ('job_a','job_b','job_c')",
                    [],
                )
                .unwrap();
            let mut plan = connection
                .prepare(
                    "EXPLAIN QUERY PLAN
                     SELECT jobs.job_id, jobs.worker_kind, jobs.resource_class, jobs.created_at
                     FROM runtime_jobs AS jobs INDEXED BY runtime_jobs_admitted_fifo_idx
                     WHERE jobs.state='admitted'
                     ORDER BY jobs.created_at ASC, jobs.job_id ASC
                     LIMIT ?1",
                )
                .unwrap();
            let details = plan
                .query_map(params![2_i64], |row| row.get::<_, String>(3))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert!(details
                .iter()
                .any(|detail| detail.contains("runtime_jobs_admitted_fifo_idx")));
        }

        assert!(matches!(
            store.dispatch_candidates(0),
            Err(StoreError::InvalidInput(_))
        ));
        assert!(matches!(
            store.dispatch_candidates(MAX_DISPATCH_CANDIDATES + 1),
            Err(StoreError::InvalidInput(_))
        ));
        let candidates = store.dispatch_candidates(2).unwrap();
        assert_eq!(
            candidates
                .iter()
                .map(WorkerDispatchCandidate::job_id)
                .collect::<Vec<_>>(),
            vec!["job_a", "job_b"]
        );
        assert!(candidates
            .iter()
            .all(|candidate| candidate.worker_kind() == "learn-node"
                && candidate.resource_class() == "core"
                && candidate.created_at() == 100));
        assert_eq!(
            store.get(&context(1), "job_a").unwrap().state,
            JobState::Admitted
        );
        assert_eq!(store.get(&context(1), "job_a").unwrap().attempt, 0);
        assert!(!candidates
            .iter()
            .any(|candidate| candidate.job_id() == "job_queued"));

        store.set_accepting_work(false);
        assert!(matches!(
            store
                .try_claim_admitted_worker("job_b", "worker_shutdown")
                .unwrap(),
            WorkerClaimOutcome::NotClaimable
        ));
        assert_eq!(
            store.get(&context(1), "job_b").unwrap().state,
            JobState::Admitted
        );
        store.set_accepting_work(true);

        let claim = claim(&store, candidates[0].job_id(), "worker_fifo");
        let cancelled = store
            .finish_worker_claim_before_residency(claim, PreResidencyClaimDisposition::Cancellation)
            .unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
    }

    #[test]
    fn concurrent_dispatch_claimers_mint_exactly_one_attempt_authority() {
        let directory = tempdir().unwrap();
        let database = directory.path().join("runtime-v2.sqlite3");
        let first = Arc::new(JobStore::open_for_test(&database).unwrap());
        let mut job = input("job_1", "request_1");
        job.resource_class = "core".into();
        first.submit_raw(&job).unwrap();
        admit(
            first.as_ref(),
            "job_1",
            &registered_admission("learn-node", ResourceClass::Core, 128, 2),
        );
        let second = Arc::new(JobStore::open_for_test(&database).unwrap());
        let barrier = Arc::new(Barrier::new(3));
        let mut handles = Vec::new();
        for (store, worker) in [
            (Arc::clone(&first), "worker_a"),
            (Arc::clone(&second), "worker_b"),
        ] {
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                barrier.wait();
                store.try_claim_admitted_worker("job_1", worker).unwrap()
            }));
        }
        barrier.wait();
        let mut claims = handles
            .into_iter()
            .filter_map(|handle| match handle.join().unwrap() {
                WorkerClaimOutcome::Claimed(claim) => Some(*claim),
                WorkerClaimOutcome::NotClaimable => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(claims.len(), 1);
        let claim = claims.pop().unwrap();
        let debug_claim = format!("{claim:?}");
        assert_eq!(
            debug_claim,
            "WorkerDispatchClaim(\"<opaque durable dispatch authority>\")"
        );
        assert!(!debug_claim.contains("job_1"));
        assert!(!debug_claim.contains("worker_"));
        assert_eq!(claim.identity().attempt, 1);
        assert!(matches!(
            claim.identity().worker_instance_id.as_str(),
            "worker_a" | "worker_b"
        ));
        assert_eq!(
            claim.job().workspace_path,
            format!(
                "runtime/jobs/job_1/attempts/1/{}/workspace",
                claim.identity().worker_instance_id
            )
        );
        assert!(matches!(
            first
                .try_claim_admitted_worker("job_1", "worker_replay")
                .unwrap(),
            WorkerClaimOutcome::NotClaimable
        ));
        let persisted = first.get(&context(1), "job_1").unwrap();
        assert_eq!(persisted.state, JobState::Starting);
        assert_eq!(persisted.workspace_path, claim.job().workspace_path);

        first
            .finish_worker_claim_before_residency(claim, PreResidencyClaimDisposition::SpawnFailed)
            .unwrap();
        assert_eq!(
            latest_reservation_state(first.as_ref(), "job_1"),
            "released"
        );
    }

    #[test]
    fn dispatch_claim_requires_the_matching_pending_admission_hold() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_admission_reservations
                     SET definition_key='other-node'
                     WHERE subject_kind='job' AND subject_id='job_1'
                       AND lifecycle_state='pending'",
                    [],
                )
                .unwrap();
        }

        assert!(matches!(
            store.try_claim_admitted_worker("job_1", "worker_1"),
            Err(StoreError::CorruptState(_))
        ));
        let unchanged = store.get(&context(1), "job_1").unwrap();
        assert_eq!(unchanged.state, JobState::Admitted);
        assert_eq!(unchanged.attempt, 0);
        assert_eq!(unchanged.worker_instance_id, None);
        assert_eq!(unchanged.workspace_path, "runtime/jobs/job_1/workspace");
        assert_eq!(latest_reservation_state(&store, "job_1"), "pending");
    }

    #[test]
    fn reservation_settlement_consumes_exact_claim_and_started_authority() {
        let (_directory, store) = store();
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 8);
        for (job_id, key) in [
            ("job_exact", "request_exact"),
            ("job_scope", "request_scope"),
            ("job_identity", "request_identity"),
            ("job_service", "request_service"),
        ] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
            admit(&store, job_id, &admission);
        }

        let exact = claim(&store, "job_exact", "worker_exact");
        let replay = illicit_replay_claim(&exact);
        let exact_identity = exact.identity().clone();
        let settled = store
            .settle_job_reservation(
                exact,
                ProcessTreeResidency::worker_for_test(
                    store.generation_scope.clone(),
                    exact_identity.clone(),
                ),
            )
            .unwrap();
        assert_eq!(settled, exact_identity);
        assert!(matches!(
            store.settle_job_reservation(
                replay,
                ProcessTreeResidency::worker_for_test(
                    store.generation_scope.clone(),
                    settled.clone(),
                ),
            ),
            Err(StoreError::InvalidAdmissionReservationState { .. })
        ));

        let wrong_scope = claim(&store, "job_scope", "worker_scope");
        let foreign_scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        assert_ne!(foreign_scope, store.generation_scope);
        let wrong_scope_identity = wrong_scope.identity().clone();
        assert!(matches!(
            store.settle_job_reservation(
                wrong_scope,
                ProcessTreeResidency::worker_for_test(foreign_scope, wrong_scope_identity),
            ),
            Err(StoreError::GenerationAuthorityMismatch)
        ));

        let wrong_identity = claim(&store, "job_identity", "worker_identity");
        let mismatched = WorkerIdentity {
            job_id: wrong_identity.identity().job_id.clone(),
            attempt: wrong_identity.identity().attempt,
            worker_instance_id: "other_worker".into(),
        };
        assert!(matches!(
            store.settle_job_reservation(
                wrong_identity,
                ProcessTreeResidency::worker_for_test(store.generation_scope.clone(), mismatched,),
            ),
            Err(StoreError::StaleWorker(_))
        ));

        let service = claim(&store, "job_service", "worker_service");
        assert!(matches!(
            store.settle_job_reservation(
                service,
                ProcessTreeResidency::service_for_test(
                    store.generation_scope.clone(),
                    "hermes",
                    "service_1",
                ),
            ),
            Err(StoreError::InvalidInput(_))
        ));
    }

    #[test]
    fn legacy_v3_assigned_workspace_remains_readable_for_safe_restart_drain() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");
        assert_eq!(
            claim.job().workspace_path,
            "runtime/jobs/job_1/attempts/1/worker_1/workspace"
        );
        drop(claim);
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_jobs SET workspace_path='runtime/jobs/job_1/workspace'
                     WHERE job_id='job_1' AND state='starting'",
                    [],
                )
                .unwrap();
        }

        let legacy = store.get(&context(1), "job_1").unwrap();
        assert_eq!(legacy.state, JobState::Starting);
        assert_eq!(legacy.attempt, 1);
        assert_eq!(legacy.worker_instance_id.as_deref(), Some("worker_1"));
        assert_eq!(legacy.workspace_path, "runtime/jobs/job_1/workspace");
        let reconciled = reconcile_after_restart(&store).unwrap();
        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].state, JobState::Interrupted);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn replayed_dispatch_claim_is_rejected_and_releases_only_once() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");
        // Safe callers cannot clone this authority. Constructing a duplicate is
        // possible only here, inside the defining module, to verify that the
        // durable predicates also reject an illicit replay.
        let replay = WorkerDispatchClaim {
            generation_scope: claim.generation_scope.clone(),
            identity: claim.identity.clone(),
            job: claim.job.clone(),
        };

        let failed = store
            .finish_worker_claim_before_residency(claim, PreResidencyClaimDisposition::SpawnFailed)
            .unwrap();
        assert_eq!(failed.state, JobState::Interrupted);
        assert!(matches!(
            store.finish_worker_claim_before_residency(
                replay,
                PreResidencyClaimDisposition::SpawnFailed,
            ),
            Err(StoreError::WorkerEventInState { .. })
        ));
        assert_eq!(active_job_reservation_count(&store, "job_1"), 0);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        let events = store.events_after(&context(1), "job_1", 0, 20).unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| event.event_type == "reservation-released")
                .count(),
            1
        );
    }

    #[test]
    fn cancellation_wins_a_claimed_pre_residency_spawn_failure() {
        let (_directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");

        let cancelling = store.request_cancellation(&job_owner, "job_1").unwrap();
        assert_eq!(cancelling.state, JobState::Cancelling);
        let cancelled = store
            .finish_worker_claim_before_residency(
                claim,
                PreResidencyClaimDisposition::SpawnResourceExhausted,
            )
            .unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert!(cancelled.cancellation_requested);
        assert_eq!(cancelled.failure_code, None);
        assert_eq!(cancelled.failure_message, None);
        assert_eq!(active_job_reservation_count(&store, "job_1"), 0);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        let events = store.events_after(&job_owner, "job_1", 0, 20).unwrap();
        assert_eq!(
            events
                .iter()
                .filter(|event| event.event_type == "cancellation-requested")
                .count(),
            1
        );
        assert_eq!(
            events
                .iter()
                .find(|event| event.event_type == "cancelled")
                .unwrap()
                .payload["code"],
            "WORKER_CANCELLED_BEFORE_TREE_RESIDENCY"
        );
    }

    #[test]
    fn claim_owned_no_process_authority_is_retry_safe_cancel_safe_and_replay_fenced() {
        let (_directory, store) = store();
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 8);
        for (job_id, key) in [
            ("job_retry", "request_retry"),
            ("job_cancel", "request_cancel"),
            ("job_scope", "request_scope"),
        ] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
            admit(&store, job_id, &admission);
        }

        let retry_claim = claim(&store, "job_retry", "worker_retry");
        let replay = illicit_replay_claim(&retry_claim);
        let not_created = WorkerLaunchNotCreated::for_test(
            retry_claim,
            ProcessOwnerError::Spawn(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "pre-CreateProcess test failure",
            )),
        );
        let debug = format!("{not_created:?}");
        assert!(!debug.contains("job_retry"));
        assert!(!debug.contains("worker_retry"));

        // Retrying consumes the entire old authority and returns a new one;
        // there is no cloneable proof that can survive beside the retry.
        let retried = not_created.retry_for_test();
        let failed = store.finish_worker_not_created(retried).unwrap();
        assert_eq!(failed.state, JobState::Interrupted);
        assert_eq!(latest_reservation_state(&store, "job_retry"), "released");

        let replay_error = store
            .finish_worker_not_created(WorkerLaunchNotCreated::for_test(
                replay,
                ProcessOwnerError::Spawn(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "illicit replay",
                )),
            ))
            .unwrap_err();
        assert!(matches!(
            replay_error.error(),
            StoreError::WorkerEventInState { .. }
        ));
        let (replayed_authority, _) = replay_error.into_parts();
        assert_eq!(replayed_authority.identity().job_id, "job_retry");
        assert_eq!(
            store
                .events_after(&context(1), "job_retry", 0, 20)
                .unwrap()
                .iter()
                .filter(|event| event.event_type == "reservation-released")
                .count(),
            1
        );

        let cancelling_claim = claim(&store, "job_cancel", "worker_cancel");
        store
            .request_cancellation(&context(1), "job_cancel")
            .unwrap();
        let cancelled = store
            .finish_worker_not_created(WorkerLaunchNotCreated::for_test(
                cancelling_claim,
                ProcessOwnerError::Spawn(std::io::Error::from_raw_os_error(1455)),
            ))
            .unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(cancelled.failure_code, None);
        assert_eq!(latest_reservation_state(&store, "job_cancel"), "released");

        let mut foreign_claim = claim(&store, "job_scope", "worker_scope");
        foreign_claim.generation_scope =
            RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        assert_ne!(foreign_claim.generation_scope, store.generation_scope);
        let scope_error = store
            .finish_worker_not_created(WorkerLaunchNotCreated::for_test(
                foreign_claim,
                ProcessOwnerError::Spawn(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "foreign generation",
                )),
            ))
            .unwrap_err();
        assert!(matches!(
            scope_error.error(),
            StoreError::GenerationAuthorityMismatch
        ));
        let (foreign_authority, _) = scope_error.into_parts();
        assert_eq!(foreign_authority.identity().job_id, "job_scope");
        assert_eq!(latest_reservation_state(&store, "job_scope"), "pending");
    }

    #[test]
    fn no_process_store_failure_returns_full_authority_and_rolls_back() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");
        let expected_identity = claim.identity().clone();
        let authority = WorkerLaunchNotCreated::for_test(
            claim,
            ProcessOwnerError::Spawn(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "pre-CreateProcess test failure",
            )),
        );
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute("DROP TABLE runtime_job_events", [])
                .unwrap();
        }

        let transition_error = store.finish_worker_not_created(authority).unwrap_err();
        assert!(matches!(transition_error.error(), StoreError::Database(_)));
        let (authority, _) = transition_error.into_parts();
        assert_eq!(authority.identity(), &expected_identity);
        let persisted = store.get(&context(1), "job_1").unwrap();
        assert_eq!(persisted.state, JobState::Starting);
        assert_eq!(latest_reservation_state(&store, "job_1"), "pending");
    }

    #[test]
    fn pre_started_tree_exit_finalizer_is_exact_cancel_safe_and_single_use() {
        let (_directory, store) = store();
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 8);
        for (job_id, key) in [
            ("job_exit", "request_exit"),
            ("job_cancel", "request_cancel"),
            ("job_started", "request_started"),
            ("job_mismatch", "request_mismatch"),
            ("job_service", "request_service"),
            ("job_scope", "request_scope"),
            ("job_resident", "request_resident"),
        ] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
            admit(&store, job_id, &admission);
        }

        let exited = claim(&store, "job_exit", "worker_exit");
        let replay = illicit_replay_claim(&exited);
        let exited_identity = exited.identity().clone();
        let failed = store
            .finish_worker_claim_after_tree_exit(
                exited,
                ProcessTreeExit::worker_release_for_test_in_scope(
                    store.generation_scope.clone(),
                    exited_identity.clone(),
                    ProcessExitClassification::SupervisorFailure,
                ),
            )
            .unwrap();
        assert_eq!(failed.state, JobState::Failed);
        assert_eq!(
            failed.failure_code.as_deref(),
            Some("WORKER_SUPERVISION_FAILED_BEFORE_STARTED")
        );
        assert_eq!(latest_reservation_state(&store, "job_exit"), "released");
        assert!(matches!(
            store.finish_worker_claim_after_tree_exit(
                replay,
                ProcessTreeExit::worker_release_for_test_in_scope(
                    store.generation_scope.clone(),
                    exited_identity,
                    ProcessExitClassification::SupervisorFailure,
                ),
            ),
            Err(StoreError::WorkerEventInState { .. })
        ));
        assert_eq!(
            store
                .events_after(&context(1), "job_exit", 0, 20)
                .unwrap()
                .iter()
                .filter(|event| event.event_type == "reservation-released")
                .count(),
            1
        );

        let cancelled_claim = claim(&store, "job_cancel", "worker_cancel");
        let cancelled_identity = cancelled_claim.identity().clone();
        store
            .request_cancellation(&context(1), "job_cancel")
            .unwrap();
        let cancelled = store
            .finish_worker_claim_after_tree_exit(
                cancelled_claim,
                ProcessTreeExit::worker_release_for_test_in_scope(
                    store.generation_scope.clone(),
                    cancelled_identity,
                    ProcessExitClassification::ResourceExhausted,
                ),
            )
            .unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(cancelled.failure_code, None);
        assert_eq!(latest_reservation_state(&store, "job_cancel"), "released");

        let started_claim = claim(&store, "job_started", "worker_started");
        let started_identity = started_claim.identity().clone();
        assert!(matches!(
            store.finish_worker_claim_after_tree_exit(
                started_claim,
                ProcessTreeExit::worker_release_after_started_for_test_in_scope(
                    store.generation_scope.clone(),
                    started_identity,
                ),
            ),
            Err(StoreError::InvalidInput(_))
        ));
        assert_eq!(
            store.get(&context(1), "job_started").unwrap().state,
            JobState::Starting
        );
        assert_eq!(latest_reservation_state(&store, "job_started"), "pending");

        let mismatch_claim = claim(&store, "job_mismatch", "worker_mismatch");
        let mismatch_identity = WorkerIdentity {
            job_id: mismatch_claim.identity().job_id.clone(),
            attempt: mismatch_claim.identity().attempt,
            worker_instance_id: "other_worker".into(),
        };
        assert!(matches!(
            store.finish_worker_claim_after_tree_exit(
                mismatch_claim,
                ProcessTreeExit::worker_release_for_test_in_scope(
                    store.generation_scope.clone(),
                    mismatch_identity,
                    ProcessExitClassification::SupervisorFailure,
                ),
            ),
            Err(StoreError::StaleWorker(_))
        ));

        let service_claim = claim(&store, "job_service", "worker_service");
        assert!(matches!(
            store.finish_worker_claim_after_tree_exit(
                service_claim,
                ProcessTreeExit::service_release_for_test_in_scope(
                    store.generation_scope.clone(),
                    "hermes",
                    "service_1",
                ),
            ),
            Err(StoreError::InvalidInput(_))
        ));

        let scope_claim = claim(&store, "job_scope", "worker_scope");
        let scope_identity = scope_claim.identity().clone();
        assert!(matches!(
            store.finish_worker_claim_after_tree_exit(
                scope_claim,
                ProcessTreeExit::worker_release_for_test_in_scope(
                    RuntimeGenerationScope::from_trusted_data_root_identity(7, 11),
                    scope_identity,
                    ProcessExitClassification::SupervisorFailure,
                ),
            ),
            Err(StoreError::GenerationAuthorityMismatch)
        ));

        let resident_claim = claim(&store, "job_resident", "worker_resident");
        let resident_replay = illicit_replay_claim(&resident_claim);
        let resident_identity = settle_claim(&store, resident_claim);
        assert!(matches!(
            store.finish_worker_claim_after_tree_exit(
                resident_replay,
                ProcessTreeExit::worker_release_for_test_in_scope(
                    store.generation_scope.clone(),
                    resident_identity,
                    ProcessExitClassification::SupervisorFailure,
                ),
            ),
            Err(StoreError::InvalidAdmissionReservationState { .. })
        ));
        assert_eq!(latest_reservation_state(&store, "job_resident"), "resident");
    }

    #[test]
    fn post_identity_spawn_failure_releases_only_a_pending_reservation() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");

        let failed = store
            .finish_worker_claim_before_residency(claim, PreResidencyClaimDisposition::SpawnFailed)
            .unwrap();
        assert_eq!(failed.state, JobState::Interrupted);
        assert_eq!(
            failed.failure_code.as_deref(),
            Some("WORKER_START_FAILED_BEFORE_TREE_RESIDENCY")
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn post_identity_spawn_failure_refuses_to_release_a_resident_tree() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");
        let replay = WorkerDispatchClaim {
            generation_scope: claim.generation_scope.clone(),
            identity: claim.identity.clone(),
            job: claim.job.clone(),
        };
        settle_claim(&store, claim);

        assert!(matches!(
            store.finish_worker_claim_before_residency(
                replay,
                PreResidencyClaimDisposition::SpawnFailed,
            ),
            Err(StoreError::InvalidAdmissionReservationState { .. })
        ));
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");
        assert_eq!(
            store.get(&context(1), "job_1").unwrap().state,
            JobState::Starting
        );
    }

    #[test]
    fn worker_ready_requires_the_process_tree_reservation_to_be_resident() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");
        let identity = claim.identity().clone();
        let ready = WorkerEvent::Ready {
            identity: identity.clone(),
            sequence: 1,
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
        };

        assert!(matches!(
            store.apply_worker_event(&ready),
            Err(StoreError::InvalidAdmissionReservationState { .. })
        ));
        let unchanged = store.get(&context(1), "job_1").unwrap();
        assert_eq!(unchanged.state, JobState::Starting);
        assert_eq!(unchanged.last_worker_sequence, 0);

        settle_claim(&store, claim);
        assert_eq!(
            store.apply_worker_event(&ready).unwrap().state,
            JobState::Running
        );
    }

    #[test]
    fn owned_worker_event_requires_exact_store_generation_before_validation_or_mutation() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let identity = claim_and_settle(&store, "job_1", "worker_1");
        let raw_ready = WorkerEvent::Ready {
            identity,
            sequence: 1,
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
        };
        let foreign_scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        assert_ne!(foreign_scope, store.generation_scope);
        let before_events = job_event_count(&store, "job_1");

        let foreign_event = OwnedWorkerEvent::for_test(
            foreign_scope,
            WorkerEvent::Ready {
                identity: raw_ready.identity().clone(),
                sequence: 1,
                protocol_version: 0,
            },
        );
        assert!(matches!(
            store.apply_owned_worker_event(&foreign_event),
            Err(StoreError::GenerationAuthorityMismatch)
        ));
        let unchanged = store.get(&context(1), "job_1").unwrap();
        assert_eq!(unchanged.state, JobState::Starting);
        assert_eq!(unchanged.last_worker_sequence, 0);
        assert_eq!(job_event_count(&store, "job_1"), before_events);

        let exact_event = OwnedWorkerEvent::for_test(store.generation_scope.clone(), raw_ready);
        assert_eq!(
            store.apply_owned_worker_event(&exact_event).unwrap().state,
            JobState::Running
        );
    }

    #[test]
    fn dispatcher_snapshot_is_exact_identity_scoped_and_cancel_visible() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");
        let identity = claim.identity().clone();

        let snapshot = store.worker_dispatch_snapshot(&identity).unwrap();
        assert_eq!(snapshot.identity(), &identity);
        assert_eq!(snapshot.state(), JobState::Starting);
        assert!(!snapshot.cancellation_requested());
        assert_eq!(snapshot.last_worker_sequence(), 0);
        assert_eq!(store.worker_completion_intent(&identity).unwrap(), None);

        let mut stale = identity.clone();
        stale.worker_instance_id = "other_worker".into();
        assert!(matches!(
            store.worker_dispatch_snapshot(&stale),
            Err(StoreError::StaleWorker(_))
        ));
        assert!(matches!(
            store.worker_completion_intent(&stale),
            Err(StoreError::StaleWorker(_))
        ));

        store.request_cancellation(&context(1), "job_1").unwrap();
        let cancelling = store.worker_dispatch_snapshot(&identity).unwrap();
        assert_eq!(cancelling.state(), JobState::Cancelling);
        assert!(cancelling.cancellation_requested());
        drop(claim);
    }

    #[test]
    fn every_resident_tree_exit_consumer_rejects_foreign_generation_without_mutation() {
        let (_directory, store) = store();
        let foreign_scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        assert_ne!(foreign_scope, store.generation_scope);

        store
            .submit_raw(&input("job_release", "request_release"))
            .unwrap();
        let release_identity = start(&store, "job_release", "worker_release");
        store
            .apply_worker_event(&WorkerEvent::Failed {
                identity: release_identity.clone(),
                sequence: 2,
                code: "WORKER_FAILED".into(),
                message: "test failure".into(),
            })
            .unwrap();
        let release_events = job_event_count(&store, "job_release");
        let foreign_release = ProcessTreeExit::worker_release_after_started_for_test_in_scope(
            foreign_scope.clone(),
            release_identity.clone(),
        );
        assert!(matches!(
            store.finalize_reported_worker_failure_after_tree_exit(&foreign_release),
            Err(StoreError::GenerationAuthorityMismatch)
        ));
        assert_eq!(latest_reservation_state(&store, "job_release"), "resident");
        assert_eq!(job_event_count(&store, "job_release"), release_events);
        store
            .finalize_reported_worker_failure_after_tree_exit(&resident_tree_exit(
                &store,
                release_identity,
            ))
            .unwrap();

        store
            .submit_raw(&input("job_reject", "request_reject"))
            .unwrap();
        let reject_identity = start(&store, "job_reject", "worker_reject");
        store
            .apply_worker_event(&WorkerEvent::Complete {
                identity: reject_identity.clone(),
                sequence: 2,
                result_path: "runtime/jobs/job_reject/result.json".into(),
            })
            .unwrap();
        let reject_events = job_event_count(&store, "job_reject");
        let foreign_reject = ProcessTreeExit::worker_release_after_started_for_test_in_scope(
            foreign_scope.clone(),
            reject_identity.clone(),
        );
        assert!(matches!(
            store.reject_worker_completion_after_tree_exit(&foreign_reject),
            Err(StoreError::GenerationAuthorityMismatch)
        ));
        assert_eq!(
            store.get(&context(1), "job_reject").unwrap().state,
            JobState::Running
        );
        assert_eq!(latest_reservation_state(&store, "job_reject"), "resident");
        assert_eq!(job_event_count(&store, "job_reject"), reject_events);
        store
            .reject_worker_completion_after_tree_exit(&resident_tree_exit(&store, reject_identity))
            .unwrap();

        store
            .submit_raw(&input("job_cancel", "request_cancel"))
            .unwrap();
        let cancel_identity = start(&store, "job_cancel", "worker_cancel");
        store
            .request_cancellation(&context(1), "job_cancel")
            .unwrap();
        let cancel_events = job_event_count(&store, "job_cancel");
        let foreign_cancel = ProcessTreeExit::worker_release_after_started_for_test_in_scope(
            foreign_scope.clone(),
            cancel_identity.clone(),
        );
        assert!(matches!(
            store.confirm_cancelled(&foreign_cancel),
            Err(StoreError::GenerationAuthorityMismatch)
        ));
        assert_eq!(
            store.get(&context(1), "job_cancel").unwrap().state,
            JobState::Cancelling
        );
        assert_eq!(latest_reservation_state(&store, "job_cancel"), "resident");
        assert_eq!(job_event_count(&store, "job_cancel"), cancel_events);
        store
            .confirm_cancelled(&resident_tree_exit(&store, cancel_identity))
            .unwrap();

        store
            .submit_raw(&input("job_exit", "request_exit"))
            .unwrap();
        let exit_identity = start(&store, "job_exit", "worker_exit");
        let exit_events = job_event_count(&store, "job_exit");
        let foreign_exit = ProcessTreeExit::worker_release_after_started_for_test_in_scope(
            foreign_scope,
            exit_identity.clone(),
        );
        assert!(matches!(
            store.worker_exited_without_terminal(&foreign_exit),
            Err(StoreError::GenerationAuthorityMismatch)
        ));
        assert_eq!(
            store.get(&context(1), "job_exit").unwrap().state,
            JobState::Running
        );
        assert_eq!(latest_reservation_state(&store, "job_exit"), "resident");
        assert_eq!(job_event_count(&store, "job_exit"), exit_events);
        assert_eq!(
            store
                .worker_exited_without_terminal(&resident_tree_exit(&store, exit_identity))
                .unwrap()
                .state,
            JobState::Failed
        );
    }

    #[test]
    fn worker_complete_is_intent_until_runtime_confirms_result_and_tree_exit() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        let completion = WorkerEvent::Complete {
            identity: identity.clone(),
            sequence: 2,
            result_path: "runtime/jobs/job_1/result.json".into(),
        };

        let intent = store.apply_worker_event(&completion).unwrap();
        assert_eq!(intent.state, JobState::Running);
        assert_eq!(intent.finished_at, None);
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");
        assert_eq!(
            store.apply_worker_event(&completion).unwrap().state,
            JobState::Running
        );
        let pending = store
            .pending_worker_completion_intents_for_recovery()
            .unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].identity(), &identity);
        assert_eq!(pending[0].sequence(), 2);
        assert_eq!(pending[0].result_path(), "runtime/jobs/job_1/result.json");
        assert_eq!(
            store.worker_completion_intent(&identity).unwrap(),
            Some(pending[0].clone())
        );
        assert!(matches!(
            store.worker_exited_without_terminal(&resident_tree_exit(&store, identity.clone())),
            Err(StoreError::PendingCompletionIntent(_))
        ));

        assert!(matches!(
            store.apply_worker_event(&WorkerEvent::Heartbeat {
                identity: identity.clone(),
                sequence: 3,
                stage: "late".into(),
            }),
            Err(StoreError::WorkerEventAfterCompletionIntent(_))
        ));

        let result = validated_result("job_1");
        let succeeded = store
            .confirm_validated_worker_completion(
                &identity,
                2,
                &result,
                Some((
                    7,
                    42,
                    ProcessTreeAccounting {
                        peak_private_commit_bytes: Some(1024),
                        complete: true,
                    },
                )),
                None,
            )
            .unwrap();
        assert_eq!(succeeded.state, JobState::Succeeded);
        assert!(succeeded.finished_at.is_some());
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert!(store
            .pending_worker_completion_intents_for_recovery()
            .unwrap()
            .is_empty());
        let completion_event = store
            .events_after(&context(1), "job_1", 0, 100)
            .unwrap()
            .into_iter()
            .find(|event| event.event_type == "completion-confirmed")
            .unwrap();
        assert_eq!(completion_event.payload["supervisorPid"], 7);
        assert_eq!(completion_event.payload["rootPid"], 42);
        assert_eq!(completion_event.payload["peakPrivateCommitBytes"], 1024);
        assert_eq!(completion_event.payload["peakAccountingComplete"], true);
        assert_eq!(
            store
                .confirm_validated_worker_completion(
                    &identity,
                    2,
                    &result,
                    Some((
                        7,
                        42,
                        ProcessTreeAccounting {
                            peak_private_commit_bytes: Some(1024),
                            complete: true,
                        },
                    )),
                    None,
                )
                .unwrap()
                .state,
            JobState::Succeeded
        );
    }

    #[test]
    fn completion_proof_requires_exact_store_generation_without_partial_mutation() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Complete {
                identity: identity.clone(),
                sequence: 2,
                result_path: "runtime/jobs/job_1/result.json".into(),
            })
            .unwrap();
        let before_events = job_event_count(&store, "job_1");
        let foreign_scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        assert_ne!(foreign_scope, store.generation_scope);
        let foreign_proof = WorkerCompletionProof::for_test(
            foreign_scope,
            identity.clone(),
            2,
            "runtime/jobs/job_1/result.json",
        );

        assert!(matches!(
            store.confirm_worker_completion(&foreign_proof),
            Err(StoreError::GenerationAuthorityMismatch)
        ));
        let unchanged = store.get(&context(1), "job_1").unwrap();
        assert_eq!(unchanged.state, JobState::Running);
        assert_eq!(unchanged.last_worker_sequence, 2);
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");
        assert_eq!(job_event_count(&store, "job_1"), before_events);

        let mut changed_result_proof = WorkerCompletionProof::for_test(
            store.generation_scope.clone(),
            identity.clone(),
            2,
            "runtime/jobs/job_1/result.json",
        );
        changed_result_proof.invalidate_result_file_for_test();
        assert!(matches!(
            store.confirm_worker_completion(&changed_result_proof),
            Err(StoreError::ConflictingCompletionEvidence(_))
        ));
        let unchanged = store.get(&context(1), "job_1").unwrap();
        assert_eq!(unchanged.state, JobState::Running);
        assert_eq!(unchanged.last_worker_sequence, 2);
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");
        assert_eq!(job_event_count(&store, "job_1"), before_events);

        let exact_proof = WorkerCompletionProof::for_test(
            store.generation_scope.clone(),
            identity,
            2,
            "runtime/jobs/job_1/result.json",
        );
        assert_eq!(
            store.confirm_worker_completion(&exact_proof).unwrap().state,
            JobState::Succeeded
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn rejected_post_exit_completion_releases_the_reservation_atomically() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Complete {
                identity: identity.clone(),
                sequence: 2,
                result_path: "runtime/jobs/job_1/result.json".into(),
            })
            .unwrap();

        let tree_exit = resident_tree_exit(&store, identity);
        let failed = store
            .reject_worker_completion_after_tree_exit(&tree_exit)
            .unwrap();
        assert_eq!(failed.state, JobState::Failed);
        assert_eq!(
            failed.failure_code.as_deref(),
            Some("WORKER_COMPLETION_VALIDATION_FAILED")
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert_eq!(
            store
                .reject_worker_completion_after_tree_exit(&tree_exit)
                .unwrap()
                .state,
            JobState::Failed
        );
        assert!(store
            .pending_worker_completion_intents_for_recovery()
            .unwrap()
            .is_empty());
        let replay = store
            .replay_job_events_snapshot(&context(1), "job_1", 0, MAX_JOB_EVENT_REPLAY_RECORDS)
            .unwrap();
        assert!(replay
            .events
            .iter()
            .any(|event| event.event_type == "failed"));
        assert!(crate::runtime_job_events_response(
            &replay.job,
            replay.public_event_stream_sealed,
            0,
            MAX_JOB_EVENT_REPLAY_RECORDS,
            &replay.events,
        )
        .is_ok());
    }

    #[test]
    fn completion_confirmation_requires_matching_intent_and_trusted_result_path() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        assert!(matches!(
            store.confirm_validated_worker_completion(
                &identity,
                2,
                &validated_result("job_1"),
                None,
                None,
            ),
            Err(StoreError::MissingCompletionIntent(_))
        ));

        store
            .apply_worker_event(&WorkerEvent::Complete {
                identity: identity.clone(),
                sequence: 2,
                result_path: "runtime/jobs/job_1/result.json".into(),
            })
            .unwrap();
        let wrong_path = ValidatedWorkerResult::from_trusted_validation(
            "runtime/jobs/job_1/other-result.json",
            "b".repeat(64),
            64,
        )
        .unwrap();
        assert!(matches!(
            store.confirm_validated_worker_completion(&identity, 2, &wrong_path, None, None),
            Err(StoreError::InvalidInput(_))
        ));
        assert_eq!(
            store.get(&context(1), "job_1").unwrap().state,
            JobState::Running
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");
    }

    #[test]
    fn cancellation_wins_a_completion_intent_race_with_borrowed_tree_exit() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Complete {
                identity: identity.clone(),
                sequence: 2,
                result_path: "runtime/jobs/job_1/result.json".into(),
            })
            .unwrap();

        let cancelling = store.request_cancellation(&context(1), "job_1").unwrap();
        assert_eq!(cancelling.state, JobState::Cancelling);
        let acknowledged = store
            .apply_worker_event(&WorkerEvent::CancellationAcknowledged {
                identity: identity.clone(),
                sequence: 3,
            })
            .unwrap();
        assert_eq!(acknowledged.state, JobState::Cancelling);
        assert_eq!(acknowledged.last_worker_sequence, 3);
        assert!(store
            .pending_worker_completion_intents_for_recovery()
            .unwrap()
            .is_empty());
        let tree_exit = resident_tree_exit(&store, identity);
        let cancelled = store.confirm_cancelled(&tree_exit).unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert_eq!(
            store.confirm_cancelled(&tree_exit).unwrap().state,
            JobState::Cancelled
        );
    }

    #[test]
    fn cancellation_wins_an_exact_completion_proof_race_without_publishing_success() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Complete {
                identity: identity.clone(),
                sequence: 2,
                result_path: "runtime/jobs/job_1/result.json".into(),
            })
            .unwrap();
        store.request_cancellation(&context(1), "job_1").unwrap();
        let proof = WorkerCompletionProof::for_test(
            store.generation_scope.clone(),
            identity,
            2,
            "runtime/jobs/job_1/result.json",
        );

        let cancelled = store.confirm_worker_completion(&proof).unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert!(cancelled.cancellation_requested);
        assert_eq!(cancelled.failure_code, None);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert!(!store
            .events_after(&context(1), "job_1", 0, 100)
            .unwrap()
            .iter()
            .any(|event| event.event_type == "completion-confirmed"));
    }

    #[test]
    fn restart_reconciliation_releases_stale_reservations() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        store.submit_raw(&input("job_2", "request_2")).unwrap();
        start(&store, "job_1", "worker_1");
        let reconciled = reconcile_after_restart(&store).unwrap();
        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].state, JobState::Uncertain);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert!(matches!(
            store
                .try_admit_job(
                    "job_2",
                    &default_admission(),
                    AdmissionPolicy::default(),
                    || Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 64 * 1024
                    }),
                )
                .unwrap(),
            JobAdmissionResult::Admitted(_)
        ));
    }

    #[test]
    fn restart_reconciliation_rejects_authority_from_another_data_root() {
        let (_first_directory, first) = store();
        let (_second_directory, second) = store();
        let wrong_root_proof = first.prior_generation_drained_for_test();

        assert!(matches!(
            second.reconcile_after_runtime_restart_for_test(wrong_root_proof),
            Err(StoreError::GenerationAuthorityMismatch)
        ));
    }

    #[test]
    fn raw_internal_submission_still_requires_the_trusted_job_layout() {
        let (_directory, store) = store();
        let mut invalid = input("job_1", "request_1");
        invalid.result_path = "runtime/jobs/job_2/result.json".into();
        assert!(matches!(
            store.submit_raw(&invalid),
            Err(StoreError::InvalidInput(_))
        ));
    }

    #[test]
    fn reads_and_cancellation_are_owner_qualified() {
        let (_directory, store) = store();
        let owner_one = context(1);
        let owner_two = context(2);
        let wrong_scope =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-2"), None).unwrap();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        assert!(store.get(&owner_one, "job_1").is_ok());
        assert!(matches!(
            store.get(&wrong_scope, "job_1"),
            Err(StoreError::JobNotFound(_))
        ));
        assert!(matches!(
            store.get(&owner_two, "job_1"),
            Err(StoreError::JobNotFound(_))
        ));
        assert!(matches!(
            store.events_after(&owner_two, "job_1", 0, 10),
            Err(StoreError::JobNotFound(_))
        ));
        assert!(matches!(
            store.replay_job_events_snapshot(&owner_two, "job_1", 0, 10),
            Err(StoreError::JobNotFound(_))
        ));
        assert!(matches!(
            store.checkpoints(&owner_two, "job_1"),
            Err(StoreError::JobNotFound(_))
        ));
        assert!(matches!(
            store.request_cancellation(&owner_two, "job_1"),
            Err(StoreError::JobNotFound(_))
        ));
    }

    #[test]
    fn stale_worker_cannot_update_a_job() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        let stale = WorkerIdentity {
            worker_instance_id: "worker_stale".into(),
            ..identity
        };
        let result = store.apply_worker_event(&WorkerEvent::Heartbeat {
            identity: stale,
            sequence: 2,
            stage: "generate".into(),
        });
        assert!(matches!(result, Err(StoreError::StaleWorker(_))));
    }

    #[test]
    fn replay_snapshot_seals_only_after_terminal_tree_reservation_release() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let queued = store
            .replay_job_events_snapshot(&context(1), "job_1", 0, 1)
            .unwrap();
        assert_eq!(queued.job.state, JobState::Queued);
        assert!(!queued.public_event_stream_sealed);
        let identity = start(&store, "job_1", "worker_1");
        let failed = store
            .apply_worker_event(&WorkerEvent::Failed {
                identity: identity.clone(),
                sequence: 2,
                code: "WORKER_FAILED".into(),
                message: "private worker failure detail".into(),
            })
            .unwrap();
        assert_eq!(failed.state, JobState::Failed);

        let lookahead = store
            .replay_job_events_snapshot(&context(1), "job_1", 0, 1)
            .unwrap();
        assert_eq!(lookahead.events.len(), 2);

        let before_release = store
            .replay_job_events_snapshot(&context(1), "job_1", 0, MAX_JOB_EVENT_REPLAY_RECORDS)
            .unwrap();
        assert_eq!(before_release.job.state, JobState::Failed);
        assert!(!before_release.public_event_stream_sealed);
        assert_eq!(
            before_release
                .events
                .last()
                .map(|event| event.event_type.as_str()),
            Some("failed")
        );

        store
            .finalize_reported_worker_failure_after_tree_exit(&resident_tree_exit(&store, identity))
            .unwrap();
        let after_release = store
            .replay_job_events_snapshot(&context(1), "job_1", 0, MAX_JOB_EVENT_REPLAY_RECORDS)
            .unwrap();
        assert!(after_release.public_event_stream_sealed);
        assert_eq!(after_release.events.len(), before_release.events.len() + 1);
        assert_eq!(
            after_release
                .events
                .last()
                .map(|event| event.event_type.as_str()),
            Some("reservation-released")
        );
    }

    #[test]
    fn authoritative_tree_exit_overrides_a_provisional_worker_failure() {
        let (_directory, store) = store();
        let cases = [
            (
                "job_resource",
                ProcessExitClassification::ResourceExhausted,
                JobState::ResourceExhausted,
                "WORKER_RESOURCE_EXHAUSTED",
            ),
            (
                "job_supervisor",
                ProcessExitClassification::SupervisorFailure,
                JobState::Failed,
                "WORKER_SUPERVISION_FAILED",
            ),
            (
                "job_protocol",
                ProcessExitClassification::WorkerProtocolFault,
                JobState::Failed,
                "WORKER_PROTOCOL_FAULT",
            ),
            (
                "job_target",
                ProcessExitClassification::TargetExit,
                JobState::Failed,
                "PROVISIONAL_WORKER_FAILURE",
            ),
        ];

        for (index, (job_id, classification, expected_state, expected_code)) in
            cases.into_iter().enumerate()
        {
            store
                .submit_raw(&input(job_id, &format!("request_{index}")))
                .unwrap();
            let identity = start(&store, job_id, &format!("worker_{index}"));
            store
                .apply_worker_event(&WorkerEvent::Failed {
                    identity: identity.clone(),
                    sequence: 2,
                    code: "PROVISIONAL_WORKER_FAILURE".into(),
                    message: "worker-authored failure detail".into(),
                })
                .unwrap();
            let tree_exit = ProcessTreeExit::worker_release_for_test_in_scope(
                store.generation_scope.clone(),
                identity,
                classification,
            );
            let finalized = store
                .finalize_reported_worker_failure_after_tree_exit(&tree_exit)
                .unwrap();
            assert_eq!(finalized.state, expected_state);
            assert_eq!(finalized.failure_code.as_deref(), Some(expected_code));
            assert_eq!(latest_reservation_state(&store, job_id), "released");
            assert_eq!(
                store
                    .finalize_reported_worker_failure_after_tree_exit(&tree_exit)
                    .unwrap()
                    .failure_code
                    .as_deref(),
                Some(expected_code)
            );
        }
    }

    #[test]
    fn restart_can_seal_a_terminal_stream_without_inventing_a_release_event() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Failed {
                identity,
                sequence: 2,
                code: "WORKER_FAILED".into(),
                message: "private worker failure detail".into(),
            })
            .unwrap();
        let before_restart = store
            .replay_job_events_snapshot(&context(1), "job_1", 0, MAX_JOB_EVENT_REPLAY_RECORDS)
            .unwrap();
        assert!(!before_restart.public_event_stream_sealed);

        assert!(reconcile_after_restart(&store).unwrap().is_empty());
        let after_restart = store
            .replay_job_events_snapshot(&context(1), "job_1", 0, MAX_JOB_EVENT_REPLAY_RECORDS)
            .unwrap();
        assert!(after_restart.public_event_stream_sealed);
        assert_eq!(after_restart.events, before_restart.events);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn worker_event_replay_compares_the_canonical_persisted_encoding() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        let heartbeat = WorkerEvent::Heartbeat {
            identity: identity.clone(),
            sequence: 2,
            stage: "generate".into(),
        };
        let first = store.apply_worker_event(&heartbeat).unwrap();
        let replay = store.apply_worker_event(&heartbeat).unwrap();
        assert_eq!(first, replay);

        let conflict = WorkerEvent::Heartbeat {
            identity,
            sequence: 2,
            stage: "different".into(),
        };
        assert!(matches!(
            store.apply_worker_event(&conflict),
            Err(StoreError::ConflictingWorkerEvent { .. })
        ));
    }

    #[test]
    fn checkpoints_and_events_are_durable_and_fenced() {
        let (directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Checkpoint {
                identity: identity.clone(),
                sequence: 2,
                kind: "page".into(),
                path: "runtime/jobs/job_1/checkpoints/page-1.json".into(),
            })
            .unwrap();
        drop(store);

        let reopened =
            JobStore::open_for_test(directory.path().join("runtime-v2.sqlite3")).unwrap();
        assert_eq!(reopened.checkpoints(&job_owner, "job_1").unwrap().len(), 1);
        assert!(
            reopened
                .events_after(&job_owner, "job_1", 0, 100)
                .unwrap()
                .len()
                >= 3
        );
    }

    #[test]
    fn worker_paths_cannot_cross_job_namespaces() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        let event = WorkerEvent::Artifact {
            identity: identity.clone(),
            sequence: 2,
            kind: "output".into(),
            path: "runtime/jobs/job_2/stolen.json".into(),
        };
        assert!(matches!(
            store.apply_worker_event(&event),
            Err(StoreError::WorkerEventRejected)
        ));
        let wrong_result = WorkerEvent::Complete {
            identity,
            sequence: 2,
            result_path: "runtime/jobs/job_1/alternate-result.json".into(),
        };
        assert!(matches!(
            store.apply_worker_event(&wrong_result),
            Err(StoreError::WorkerEventRejected)
        ));
    }

    #[test]
    fn queued_cancellation_is_terminal_without_process_tree_authority() {
        let (_directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();

        let cancelled = store.request_cancellation(&job_owner, "job_1").unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert!(cancelled.cancellation_requested);
        assert!(cancelled.finished_at.is_some());
        assert_eq!(cancelled.attempt, 0);
        assert_eq!(cancelled.worker_instance_id, None);
        assert_eq!(cancelled.failure_code, None);
        assert_eq!(cancelled.failure_message, None);
        assert_eq!(job_reservation_count(&store, "job_1"), 0);

        let replay = store
            .replay_job_events_snapshot(&job_owner, "job_1", 0, 10)
            .unwrap();
        assert!(replay.public_event_stream_sealed);
        assert_eq!(
            replay
                .events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<_>>(),
            vec!["queued", "cancellation-requested", "cancelled"]
        );
        assert!(replay.events.iter().all(|event| {
            event.attempt == 0
                && event.worker_instance_id.is_none()
                && event.worker_sequence.is_none()
        }));

        assert_eq!(
            store.request_cancellation(&job_owner, "job_1").unwrap(),
            cancelled
        );
        assert_eq!(
            store
                .events_after(&job_owner, "job_1", 0, 10)
                .unwrap()
                .len(),
            3
        );
        assert!(reconcile_after_restart(&store).unwrap().is_empty());
    }

    #[test]
    fn admitted_cancellation_releases_its_pending_hold_atomically() {
        let (_directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        store.submit_raw(&input("job_2", "request_2")).unwrap();
        admit(&store, "job_1", &default_admission());
        assert_eq!(latest_reservation_state(&store, "job_1"), "pending");

        let cancelled = store.request_cancellation(&job_owner, "job_1").unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert!(cancelled.cancellation_requested);
        assert_eq!(cancelled.attempt, 0);
        assert_eq!(cancelled.worker_instance_id, None);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
        assert_eq!(active_job_reservation_count(&store, "job_1"), 0);

        let replay = store
            .replay_job_events_snapshot(&job_owner, "job_1", 0, 10)
            .unwrap();
        assert!(replay.public_event_stream_sealed);
        assert_eq!(
            replay
                .events
                .iter()
                .map(|event| event.event_type.as_str())
                .collect::<Vec<_>>(),
            vec![
                "queued",
                "admitted",
                "cancellation-requested",
                "cancelled",
                "reservation-released",
            ]
        );
        assert!(replay.events[2..].iter().all(|event| {
            event.attempt == 0
                && event.worker_instance_id.is_none()
                && event.worker_sequence.is_none()
        }));
        assert!(matches!(
            store
                .try_admit_job(
                    "job_2",
                    &default_admission(),
                    AdmissionPolicy::default(),
                    || Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 64 * 1024
                    }),
                )
                .unwrap(),
            JobAdmissionResult::Admitted(_)
        ));
    }

    #[test]
    fn assigned_pending_cancellation_remains_receipt_gated_and_fail_closed() {
        let (_directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let claim = claim(&store, "job_1", "worker_1");
        let identity = claim.identity().clone();

        let cancelling = store.request_cancellation(&job_owner, "job_1").unwrap();
        assert_eq!(cancelling.state, JobState::Cancelling);
        assert_eq!(cancelling.identity().as_ref(), Some(&identity));
        assert_eq!(latest_reservation_state(&store, "job_1"), "pending");
        assert_eq!(
            store
                .events_after(&job_owner, "job_1", 0, 10)
                .unwrap()
                .last()
                .map(|event| event.event_type.as_str()),
            Some("cancellation-requested")
        );

        let tree_exit = resident_tree_exit(&store, identity.clone());
        assert!(matches!(
            store.confirm_cancelled(&tree_exit),
            Err(StoreError::InvalidAdmissionReservationState { .. })
        ));
        assert_eq!(
            store.get(&job_owner, "job_1").unwrap().state,
            JobState::Cancelling
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "pending");

        settle_claim(&store, claim);
        let cancelled = store.confirm_cancelled(&tree_exit).unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn cancel_before_ready_sequences_late_nonterminal_events_without_leaving_cancelling() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        admit(&store, "job_1", &default_admission());
        let identity = claim_and_settle(&store, "job_1", "worker_1");
        assert_eq!(
            store
                .request_cancellation(&context(1), "job_1")
                .unwrap()
                .state,
            JobState::Cancelling
        );

        assert!(matches!(
            store.apply_worker_event(&WorkerEvent::Heartbeat {
                identity: identity.clone(),
                sequence: 1,
                stage: "too-early".into(),
            }),
            Err(StoreError::WorkerEventRejected)
        ));
        assert_eq!(
            store
                .get(&context(1), "job_1")
                .unwrap()
                .last_worker_sequence,
            0
        );

        let first_ready = WorkerEvent::Ready {
            identity: identity.clone(),
            sequence: 1,
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
        };
        let ready_state = store.apply_worker_event(&first_ready).unwrap();
        assert_eq!(ready_state.state, JobState::Cancelling);
        assert_eq!(ready_state.last_worker_sequence, 1);
        assert!(store
            .events_after(&context(1), "job_1", 0, 20)
            .unwrap()
            .iter()
            .any(|event| event.worker_sequence == Some(1)
                && event.event_type == "ready-after-cancellation"));
        assert!(matches!(
            store.apply_worker_event(&WorkerEvent::Ready {
                identity: identity.clone(),
                sequence: 2,
                protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
            }),
            Err(StoreError::WorkerEventRejected)
        ));

        let late_events = [
            WorkerEvent::Heartbeat {
                identity: identity.clone(),
                sequence: 2,
                stage: "stopping".into(),
            },
            WorkerEvent::Progress {
                identity: identity.clone(),
                sequence: 3,
                stage: "stopping".into(),
                current: 1,
                total: 2,
            },
            WorkerEvent::Checkpoint {
                identity: identity.clone(),
                sequence: 4,
                kind: "page".into(),
                path: "runtime/jobs/job_1/checkpoints/page-1.json".into(),
            },
            WorkerEvent::Artifact {
                identity: identity.clone(),
                sequence: 5,
                kind: "document".into(),
                path: "runtime/jobs/job_1/artifacts/draft.json".into(),
            },
            WorkerEvent::CancellationAcknowledged {
                identity: identity.clone(),
                sequence: 6,
            },
        ];
        for event in late_events {
            let updated = store.apply_worker_event(&event).unwrap();
            assert_eq!(updated.state, JobState::Cancelling);
            assert!(updated.cancellation_requested);
            assert_eq!(updated.last_worker_sequence, event.sequence());
            assert_eq!(updated.finished_at, None);
        }
        assert_eq!(store.checkpoints(&context(1), "job_1").unwrap().len(), 1);
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");
    }

    #[test]
    fn late_complete_after_cancellation_is_sequenced_but_never_mints_success_intent() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store.request_cancellation(&context(1), "job_1").unwrap();

        let updated = store
            .apply_worker_event(&WorkerEvent::Complete {
                identity: identity.clone(),
                sequence: 2,
                result_path: "runtime/jobs/job_1/result.json".into(),
            })
            .unwrap();
        assert_eq!(updated.state, JobState::Cancelling);
        assert!(updated.cancellation_requested);
        assert_eq!(updated.last_worker_sequence, 2);
        assert_eq!(updated.finished_at, None);
        assert_eq!(store.worker_completion_intent(&identity).unwrap(), None);
        assert!(store
            .pending_worker_completion_intents_for_recovery()
            .unwrap()
            .is_empty());
        assert_eq!(
            store
                .confirm_cancelled(&resident_tree_exit(&store, identity))
                .unwrap()
                .state,
            JobState::Cancelled
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn late_failed_after_cancellation_is_sequenced_without_overriding_cancellation() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store.request_cancellation(&context(1), "job_1").unwrap();

        let updated = store
            .apply_worker_event(&WorkerEvent::Failed {
                identity: identity.clone(),
                sequence: 2,
                code: "LATE_WORKER_FAILURE".into(),
                message: "worker reported failure while stopping".into(),
            })
            .unwrap();
        assert_eq!(updated.state, JobState::Cancelling);
        assert!(updated.cancellation_requested);
        assert_eq!(updated.last_worker_sequence, 2);
        assert_eq!(updated.failure_code, None);
        assert_eq!(updated.failure_message, None);
        assert_eq!(updated.finished_at, None);
        assert!(store
            .events_after(&context(1), "job_1", 0, 20)
            .unwrap()
            .iter()
            .any(|event| event.worker_sequence == Some(2)
                && event.event_type == "failed-after-cancellation"));
        assert_eq!(
            store
                .confirm_cancelled(&resident_tree_exit(&store, identity))
                .unwrap()
                .state,
            JobState::Cancelled
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn exact_tree_exit_after_cancellation_finishes_cancelled_even_without_terminal_event() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store.request_cancellation(&context(1), "job_1").unwrap();

        let cancelled = store
            .worker_exited_without_terminal(&resident_tree_exit(&store, identity))
            .unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert!(cancelled.cancellation_requested);
        assert_eq!(cancelled.failure_code, None);
        assert_eq!(cancelled.failure_message, None);
        assert!(cancelled.finished_at.is_some());
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn started_cancellation_becomes_terminal_only_after_tree_exit_confirmation() {
        let (_directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        let cancelling = store.request_cancellation(&job_owner, "job_1").unwrap();
        assert_eq!(cancelling.state, JobState::Cancelling);
        assert!(cancelling.cancellation_requested);
        let cancelled = store
            .confirm_cancelled(&resident_tree_exit(&store, identity))
            .unwrap();
        assert_eq!(cancelled.state, JobState::Cancelled);
        assert_eq!(latest_reservation_state(&store, "job_1"), "released");
    }

    #[test]
    fn cancellation_confirmation_requires_the_exact_fenced_worker_exit() {
        let (_directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store.request_cancellation(&job_owner, "job_1").unwrap();
        let stale = WorkerIdentity {
            worker_instance_id: "worker_stale".into(),
            ..identity
        };
        assert!(matches!(
            store.confirm_cancelled(&resident_tree_exit(&store, stale)),
            Err(StoreError::StaleWorker(_))
        ));
        assert_eq!(
            store.get(&job_owner, "job_1").unwrap().state,
            JobState::Cancelling
        );
        assert_eq!(latest_reservation_state(&store, "job_1"), "resident");
    }

    #[test]
    fn restart_reconciliation_does_not_blindly_retry() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        start(&store, "job_1", "worker_1");
        let reconciled = reconcile_after_restart(&store).unwrap();
        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].state, JobState::Uncertain);
        assert_eq!(reconciled[0].attempt, 1);
        assert_eq!(
            reconciled[0].failure_code.as_deref(),
            Some("RUNTIME_RESTART_EXTERNAL_EFFECTS_UNCLASSIFIED")
        );
    }

    #[test]
    fn restart_reconciliation_distinguishes_pre_ready_and_cancelling_jobs() {
        let (_directory, store) = store();
        for (job_id, key) in [("job_1", "request_1"), ("job_2", "request_2")] {
            let mut job = input(job_id, key);
            job.resource_class = "core".into();
            store.submit_raw(&job).unwrap();
        }
        let admission = registered_admission("learn-node", ResourceClass::Core, 128, 2);
        admit(&store, "job_1", &admission);
        claim_identity(&store, "job_1", "worker_1");

        admit(&store, "job_2", &admission);
        let cancelling_identity = claim_and_settle(&store, "job_2", "worker_2");
        store
            .apply_worker_event(&WorkerEvent::Ready {
                identity: cancelling_identity,
                sequence: 1,
                protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
            })
            .unwrap();
        store.request_cancellation(&context(1), "job_2").unwrap();

        let reconciled = reconcile_after_restart(&store).unwrap();
        assert_eq!(reconciled.len(), 2);
        let pre_ready = reconciled.iter().find(|job| job.job_id == "job_1").unwrap();
        assert_eq!(pre_ready.state, JobState::Interrupted);
        assert_eq!(
            pre_ready.failure_code.as_deref(),
            Some("RUNTIME_RESTART_BEFORE_WORKER_READY")
        );
        let cancelling = reconciled.iter().find(|job| job.job_id == "job_2").unwrap();
        assert_eq!(cancelling.state, JobState::Cancelled);
        assert_eq!(cancelling.failure_code, None);
        assert_eq!(latest_reservation_state(&store, "job_2"), "released");
    }

    #[test]
    fn restart_reconciliation_uses_checkpoint_but_never_auto_retries() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Checkpoint {
                identity,
                sequence: 2,
                kind: "page".into(),
                path: "runtime/jobs/job_1/checkpoints/page-1.json".into(),
            })
            .unwrap();

        let reconciled = reconcile_after_restart(&store).unwrap();
        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].state, JobState::Interrupted);
        assert_eq!(reconciled[0].attempt, 1);
        assert_eq!(
            reconciled[0].failure_code.as_deref(),
            Some("RUNTIME_RESTART_CHECKPOINT_AVAILABLE")
        );
    }

    #[test]
    fn restart_after_post_checkpoint_activity_remains_uncertain_without_receipts() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Checkpoint {
                identity: identity.clone(),
                sequence: 2,
                kind: "page".into(),
                path: "runtime/jobs/job_1/checkpoints/page-1.json".into(),
            })
            .unwrap();
        store
            .apply_worker_event(&WorkerEvent::Progress {
                identity,
                sequence: 3,
                stage: "provider-call".into(),
                current: 1,
                total: 2,
            })
            .unwrap();

        let reconciled = reconcile_after_restart(&store).unwrap();
        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].state, JobState::Uncertain);
        assert_eq!(
            reconciled[0].failure_code.as_deref(),
            Some("RUNTIME_RESTART_AFTER_CHECKPOINT_ACTIVITY_UNCLASSIFIED")
        );
    }

    #[test]
    fn restart_after_completion_intent_is_uncertain_without_runtime_validation() {
        let (_directory, store) = store();
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        let identity = start(&store, "job_1", "worker_1");
        store
            .apply_worker_event(&WorkerEvent::Complete {
                identity,
                sequence: 2,
                result_path: "runtime/jobs/job_1/result.json".into(),
            })
            .unwrap();

        let reconciled = reconcile_after_restart(&store).unwrap();
        assert_eq!(reconciled.len(), 1);
        assert_eq!(reconciled[0].state, JobState::Uncertain);
        assert_eq!(
            reconciled[0].failure_code.as_deref(),
            Some("RUNTIME_RESTART_AFTER_COMPLETION_INTENT")
        );
    }

    #[test]
    fn unversioned_existing_schema_is_rejected() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("runtime-v2.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch("CREATE TABLE unrelated_application_data (id INTEGER PRIMARY KEY);")
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(path),
            Err(StoreError::UnversionedSchema)
        ));
    }

    #[test]
    fn valid_v1_schema_is_explicitly_migrated_through_v4() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("runtime-v1.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(SCHEMA_V1).unwrap();
        connection
            .execute_batch("PRAGMA user_version = 1;")
            .unwrap();
        drop(connection);

        let store = JobStore::open_for_test(&path).unwrap();
        let connection = store.connection.lock().unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        let reservation_table: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='table' AND name='runtime_admission_reservations'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let input_table: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='table' AND name='runtime_job_inputs'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let dispatch_index: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='index' AND name='runtime_jobs_admitted_fifo_idx'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, 4);
        assert_eq!(reservation_table, 1);
        assert_eq!(input_table, 1);
        assert_eq!(dispatch_index, 1);
    }

    #[test]
    fn malformed_v1_is_rejected_before_migration() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("malformed-v1.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch(SCHEMA_V1).unwrap();
        connection
            .execute_batch(
                "DROP INDEX runtime_job_events_worker_sequence_idx;
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(path),
            Err(StoreError::SchemaMismatch { version: 1, .. })
        ));
    }

    #[test]
    fn malformed_v2_reservation_shape_is_rejected() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("malformed-v2.sqlite3");
        create_v2_database(&path);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "DROP TABLE runtime_admission_reservations;
                 CREATE TABLE runtime_admission_reservations (
                     reservation_id INTEGER PRIMARY KEY,
                     subject_kind TEXT NOT NULL,
                     subject_id TEXT NOT NULL
                 );",
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(path),
            Err(StoreError::SchemaMismatch { version: 2, .. })
        ));
    }

    #[test]
    fn malformed_v2_active_uniqueness_predicate_is_rejected() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("malformed-v2-index.sqlite3");
        create_v2_database(&path);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "DROP INDEX runtime_admission_reservations_active_subject_idx;
                 CREATE UNIQUE INDEX runtime_admission_reservations_active_subject_idx
                 ON runtime_admission_reservations(subject_kind, subject_id)
                 WHERE lifecycle_state='released';",
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(path),
            Err(StoreError::SchemaMismatch { version: 2, .. })
        ));
    }

    #[test]
    fn nonempty_v2_database_is_not_migrated_without_request_bytes() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("nonempty-v2.sqlite3");
        create_v2_database(&path);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO runtime_jobs (
                    job_id, job_type, worker_kind, resource_class, owner_principal, user_id,
                    garden_id, conversation_id, state, input_manifest_path, workspace_path,
                    checkpoint_path, result_path, created_at, updated_at, idempotency_key,
                    request_digest
                 ) VALUES (
                    'job_legacy', 'learn', 'learn-node', 'large-generation', 'user:1', 1,
                    'garden-1', NULL, 'queued', 'runtime/jobs/job_legacy/input.json',
                    'runtime/jobs/job_legacy/workspace', 'runtime/jobs/job_legacy/checkpoint.json',
                    'runtime/jobs/job_legacy/result.json', 1, 1, 'legacy-request', ?1
                 )",
                params!["a".repeat(64)],
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(path),
            Err(StoreError::LegacyJobInputsUnavailable { jobs: 1 })
        ));
    }

    #[test]
    fn malformed_v3_input_binding_schema_is_rejected() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("malformed-v3.sqlite3");
        create_v3_database(&path);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "DROP TABLE runtime_job_inputs;
                 CREATE TABLE runtime_job_inputs (
                     job_id TEXT PRIMARY KEY,
                     request_digest TEXT NOT NULL,
                     canonical_request_payload BLOB NOT NULL
                 );",
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(path),
            Err(StoreError::SchemaMismatch { version: 3, .. })
        ));
    }

    #[test]
    fn malformed_v4_dispatch_fifo_index_is_rejected() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("malformed-v4-index.sqlite3");
        let store = JobStore::open_for_test(&path).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute_batch(
                    "DROP INDEX runtime_jobs_admitted_fifo_idx;
                     CREATE INDEX runtime_jobs_admitted_fifo_idx
                     ON runtime_jobs(updated_at, job_id) WHERE state='queued';",
                )
                .unwrap();
        }
        drop(store);
        assert!(matches!(
            JobStore::open_for_test(path),
            Err(StoreError::SchemaMismatch { version: 4, .. })
        ));
    }

    #[test]
    fn future_and_malformed_versioned_schemas_are_rejected() {
        let directory = tempdir().unwrap();
        let future_path = directory.path().join("future.sqlite3");
        let connection = Connection::open(&future_path).unwrap();
        connection
            .execute_batch("PRAGMA user_version = 5;")
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(future_path),
            Err(StoreError::UnsupportedSchemaVersion {
                found: 5,
                supported: SCHEMA_VERSION
            })
        ));

        let malformed_path = directory.path().join("malformed.sqlite3");
        let connection = Connection::open(&malformed_path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE runtime_jobs (job_id TEXT PRIMARY KEY);
                 PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);
        assert!(matches!(
            JobStore::open_for_test(malformed_path),
            Err(StoreError::SchemaMismatch { .. })
        ));
    }

    #[test]
    fn corrupt_unsigned_database_values_are_not_wrapped() {
        let (_directory, store) = store();
        let job_owner = context(1);
        store.submit_raw(&input("job_1", "request_1")).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute_batch(
                    "PRAGMA ignore_check_constraints = ON;
                     UPDATE runtime_jobs SET last_worker_sequence = -1 WHERE job_id = 'job_1';",
                )
                .unwrap();
        }
        assert!(matches!(
            store.get(&job_owner, "job_1"),
            Err(StoreError::Database(
                rusqlite::Error::FromSqlConversionFailure(_, _, _)
            ))
        ));
    }
}
