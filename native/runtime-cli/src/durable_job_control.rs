use crate::control::{RuntimeJobControl, RuntimeJobControlError, RuntimeJobInputSeal};
use breadboard_runtime_core::{
    runtime_job_events_response, runtime_job_response, AuthenticatedJobContext,
    CancelJobByIdempotencyOutcome, JobStore, PathError, Registry, RegistryError, RuntimePaths,
    StoreError,
};
use breadboard_runtime_protocol::{
    JobState, JobSubmissionPayload, RuntimeJobEventsResponse,
    RuntimeJobIdempotencyCancellationResponse, RuntimeJobIdempotencyCancellationState,
    RuntimeJobInputReservationRequest, RuntimeJobInputReservationResponse, RuntimeJobResponse,
    MAX_JOB_EVENT_REPLAY_RECORDS, MAX_JOB_INPUT_UPLOAD_BYTES, MAX_JSON_SAFE_INTEGER,
    RUNTIME_CONTROL_PROTOCOL_VERSION,
};
use std::io::{self, Read, Write};
use std::sync::Arc;

const UPLOAD_COPY_BUFFER_BYTES: usize = 64 * 1024;

/// The durable, path-free control-plane adapter for an authoritative engine.
///
/// Submission stops at a durable `queued` row. This adapter neither admits nor
/// dispatches work and deliberately exposes no executable, argument, working
/// directory, or environment authority through `RuntimeJobControl`.
pub(crate) struct DurableRuntimeJobControl {
    registry: Registry,
    store: Arc<JobStore>,
    paths: RuntimePaths,
}

impl DurableRuntimeJobControl {
    pub(crate) fn new(registry: Registry, store: Arc<JobStore>, paths: RuntimePaths) -> Self {
        Self {
            registry,
            store,
            paths,
        }
    }
}

impl RuntimeJobControl for DurableRuntimeJobControl {
    fn reserve_job_input(
        &self,
        context: &AuthenticatedJobContext,
        request: &RuntimeJobInputReservationRequest,
    ) -> Result<RuntimeJobInputReservationResponse, RuntimeJobControlError> {
        self.store
            .reserve_job_input_upload(context, request, MAX_JOB_INPUT_UPLOAD_BYTES)
            .map_err(map_reservation_store_error)
    }

    fn upload_job_input(
        &self,
        context: &AuthenticatedJobContext,
        upload_id: &str,
        body: &mut dyn Read,
    ) -> Result<RuntimeJobInputSeal, RuntimeJobControlError> {
        let mut lease = self
            .store
            .begin_job_input_upload(&self.paths, context, upload_id)
            .map_err(map_upload_store_error)?;
        if lease.upload_id() != upload_id {
            return Err(RuntimeJobControlError::Internal);
        }
        let mut buffer = [0_u8; UPLOAD_COPY_BUFFER_BYTES];
        loop {
            let received = match body.read(&mut buffer) {
                Ok(received) => received,
                Err(error) => {
                    buffer.fill(0);
                    return Err(map_upload_read_error(error));
                }
            };
            if received == 0 {
                break;
            }
            let write_result = lease.write_all(&buffer[..received]);
            buffer[..received].fill(0);
            write_result.map_err(map_upload_write_error)?;
        }
        let sealed = lease.seal().map_err(map_upload_store_error)?;
        if sealed.upload_id() != upload_id {
            return Err(RuntimeJobControlError::Internal);
        }
        Ok(RuntimeJobInputSeal {
            size_bytes: sealed.size_bytes(),
            sha256: sealed.sha256().to_owned(),
        })
    }

    fn abandon_job_input(
        &self,
        context: &AuthenticatedJobContext,
        upload_id: &str,
    ) -> Result<(), RuntimeJobControlError> {
        self.store
            .abandon_job_input_upload(&self.paths, context, upload_id)
            .map(|_| ())
            .map_err(map_upload_store_error)
    }

    fn submit_job(
        &self,
        context: &AuthenticatedJobContext,
        payload: &JobSubmissionPayload,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
        // Registry submission is the sole authority for deriving authenticated
        // scope, worker kind, resource class, and trusted per-job paths.
        let record = self
            .registry
            .submit_job(&self.store, &self.paths, context, payload)
            .map_err(map_submission_registry_error)?;
        runtime_job_response(&record).map_err(map_projection_error)
    }

    fn lookup_job(
        &self,
        context: &AuthenticatedJobContext,
        idempotency_key: &str,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
        let record = self
            .store
            .get_by_idempotency_key(context, idempotency_key)
            .map_err(map_owned_store_error)?
            .ok_or(RuntimeJobControlError::NotFound)?;
        runtime_job_response(&record).map_err(map_projection_error)
    }

    fn cancel_job_by_idempotency_key(
        &self,
        context: &AuthenticatedJobContext,
        idempotency_key: &str,
    ) -> Result<RuntimeJobIdempotencyCancellationResponse, RuntimeJobControlError> {
        let outcome = self
            .store
            .cancel_job_by_idempotency_key(context, idempotency_key)
            .map_err(map_idempotency_cancellation_store_error)?;
        let (job_id, state, accepted) = match outcome {
            CancelJobByIdempotencyOutcome::Pending { .. } => {
                (None, RuntimeJobIdempotencyCancellationState::Pending, true)
            }
            CancelJobByIdempotencyOutcome::Job { job, accepted } => {
                let job = *job;
                if accepted && should_cleanup_unstarted_terminal_inputs(job.state, job.attempt) {
                    self.store
                        .cleanup_unstarted_terminal_job_inputs(&self.paths, &job.job_id)
                        .map_err(map_owned_store_error)?;
                }
                (
                    Some(job.job_id),
                    RuntimeJobIdempotencyCancellationState::from(job.state),
                    accepted,
                )
            }
        };
        Ok(
            RuntimeJobIdempotencyCancellationResponse::RuntimeJobIdempotencyCancellation {
                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                job_id,
                state,
                accepted,
            },
        )
    }

    fn inspect_job(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
        let record = self
            .store
            .get(context, job_id)
            .map_err(map_owned_store_error)?;
        runtime_job_response(&record).map_err(map_projection_error)
    }

    fn replay_job_events(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
        after: u64,
        limit: usize,
    ) -> Result<RuntimeJobEventsResponse, RuntimeJobControlError> {
        let after_sequence = replay_query_bounds(after, limit)?;
        let snapshot = self
            .store
            .replay_job_events_snapshot(context, job_id, after_sequence, limit)
            .map_err(map_owned_store_error)?;
        runtime_job_events_response(
            &snapshot.job,
            snapshot.public_event_stream_sealed,
            after,
            limit,
            &snapshot.events,
        )
        .map_err(map_projection_error)
    }

    fn cancel_job(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<RuntimeJobResponse, RuntimeJobControlError> {
        // A queued or admitted attempt-zero cancellation is terminal without
        // process authority, so its adopted inputs can be removed immediately.
        // Started attempts remain owned by the process-exit cleanup path.
        let record = self
            .store
            .request_cancellation(context, job_id)
            .map_err(map_owned_store_error)?;
        if should_cleanup_unstarted_terminal_inputs(record.state, record.attempt) {
            self.store
                .cleanup_unstarted_terminal_job_inputs(&self.paths, job_id)
                .map_err(map_owned_store_error)?;
        }
        runtime_job_response(&record).map_err(map_projection_error)
    }

    fn read_job_checkpoint(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<Vec<u8>, RuntimeJobControlError> {
        self.store
            .read_owned_job_checkpoint_bytes(&self.paths, context, job_id)
            .map_err(map_checkpoint_store_error)?
            .ok_or(RuntimeJobControlError::OutputNotReady)
    }

    fn read_job_result(
        &self,
        context: &AuthenticatedJobContext,
        job_id: &str,
    ) -> Result<Vec<u8>, RuntimeJobControlError> {
        self.store
            .read_owned_job_result_bytes(&self.paths, context, job_id)
            .map_err(map_result_store_error)
    }
}

fn should_cleanup_unstarted_terminal_inputs(state: JobState, attempt: u32) -> bool {
    state.is_terminal() && attempt == 0
}

fn map_reservation_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        StoreError::AdmissionClosed => RuntimeJobControlError::Unavailable,
        StoreError::InputUploadQuotaExceeded { .. } => RuntimeJobControlError::InputQuotaExceeded,
        StoreError::InvalidInput(_) | StoreError::ProtocolValidation(_) => {
            RuntimeJobControlError::InvalidRequest
        }
        _ => RuntimeJobControlError::Internal,
    }
}

fn map_upload_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        StoreError::InputUploadQuotaExceeded { .. } => RuntimeJobControlError::InputQuotaExceeded,
        StoreError::InputUploadNotFound(_) | StoreError::InputUploadNotOwned(_) => {
            RuntimeJobControlError::NotFound
        }
        StoreError::InputUploadState { .. } | StoreError::InputUploadExpired(_) => {
            RuntimeJobControlError::Conflict
        }
        StoreError::InvalidInput(_) | StoreError::ProtocolValidation(_) => {
            RuntimeJobControlError::InvalidRequest
        }
        StoreError::Path(path) => map_upload_path_error(path),
        _ => RuntimeJobControlError::Internal,
    }
}

fn map_upload_path_error(error: PathError) -> RuntimeJobControlError {
    match error {
        PathError::BlobOverflow { .. } | PathError::InvalidBlobSize { .. } => {
            RuntimeJobControlError::PayloadTooLarge
        }
        PathError::BlobSizeMismatch { .. }
        | PathError::BlobDigestMismatch
        | PathError::InvalidBlobDigest
        | PathError::InvalidJobInput => RuntimeJobControlError::InvalidRequest,
        _ => RuntimeJobControlError::Internal,
    }
}

fn map_upload_read_error(error: io::Error) -> RuntimeJobControlError {
    match error.kind() {
        io::ErrorKind::FileTooLarge => RuntimeJobControlError::PayloadTooLarge,
        io::ErrorKind::Interrupted | io::ErrorKind::ConnectionAborted => {
            RuntimeJobControlError::Unavailable
        }
        _ => RuntimeJobControlError::InvalidRequest,
    }
}

fn map_upload_write_error(error: io::Error) -> RuntimeJobControlError {
    if let Some(PathError::BlobOverflow { .. }) = error
        .get_ref()
        .and_then(|inner| inner.downcast_ref::<PathError>())
    {
        RuntimeJobControlError::PayloadTooLarge
    } else {
        RuntimeJobControlError::Internal
    }
}

fn map_checkpoint_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        StoreError::JobNotFound(_) => RuntimeJobControlError::NotFound,
        StoreError::InvalidInput(_) => RuntimeJobControlError::OutputNotReady,
        StoreError::Path(PathError::FileChanged) => RuntimeJobControlError::OutputNotReady,
        StoreError::Path(PathError::Io(error))
            if error.kind() == io::ErrorKind::NotFound
                || (cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33))) =>
        {
            RuntimeJobControlError::OutputNotReady
        }
        _ => RuntimeJobControlError::Internal,
    }
}

fn map_result_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        StoreError::JobNotFound(_) => RuntimeJobControlError::NotFound,
        StoreError::InvalidInput(_) => RuntimeJobControlError::OutputNotReady,
        _ => RuntimeJobControlError::Internal,
    }
}

fn map_idempotency_cancellation_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        StoreError::IdempotencyCancellationQuotaExceeded { .. } => {
            RuntimeJobControlError::CancellationQuotaExceeded
        }
        StoreError::InvalidInput(_) | StoreError::ProtocolValidation(_) => {
            RuntimeJobControlError::InvalidRequest
        }
        _ => RuntimeJobControlError::Internal,
    }
}

fn replay_query_bounds(after: u64, requested_limit: usize) -> Result<i64, RuntimeJobControlError> {
    if after > MAX_JSON_SAFE_INTEGER
        || requested_limit == 0
        || requested_limit > MAX_JOB_EVENT_REPLAY_RECORDS
    {
        return Err(RuntimeJobControlError::InvalidRequest);
    }
    i64::try_from(after).map_err(|_| RuntimeJobControlError::InvalidRequest)
}

fn map_submission_registry_error(error: RegistryError) -> RuntimeJobControlError {
    match error {
        RegistryError::InvalidManifest(_) | RegistryError::UnknownJobType(_) => {
            RuntimeJobControlError::InvalidRequest
        }
        RegistryError::AuthenticatedScopeMismatch { .. }
        | RegistryError::WorkerSubmissionAuthorityMismatch(_) => RuntimeJobControlError::Forbidden,
        RegistryError::Store(error) => map_submission_store_error(error),
        RegistryError::DependencyCycle(_)
        | RegistryError::DuplicateJobType { .. }
        | RegistryError::DurableService(_)
        | RegistryError::InvalidServiceProcessLimits(_)
        | RegistryError::InvalidServicePort(_)
        | RegistryError::InvalidWorkerProcessLimits(_)
        | RegistryError::ProcessOwner(_)
        | RegistryError::ServiceEnvironmentModeMismatch { .. }
        | RegistryError::ServiceEnvironmentProfileMismatch { .. }
        | RegistryError::ServiceEnvironmentSourceMismatch { .. }
        | RegistryError::ServiceLease(_)
        | RegistryError::UnknownWorker(_)
        | RegistryError::UnknownWorkerServiceDependency { .. }
        | RegistryError::InvalidWorkerServiceDependencyCondition(_)
        | RegistryError::UnknownService(_)
        | RegistryError::Path(_) => RuntimeJobControlError::Internal,
    }
}

fn map_submission_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        StoreError::AdmissionClosed => RuntimeJobControlError::Unavailable,
        StoreError::InputUploadQuotaExceeded { .. } => RuntimeJobControlError::InputQuotaExceeded,
        StoreError::JobIdConflict(_) | StoreError::IdempotencyConflict { .. } => {
            RuntimeJobControlError::Conflict
        }
        StoreError::CancelledBeforeSubmission(_) => {
            RuntimeJobControlError::CancelledBeforeSubmission
        }
        StoreError::InputUploadNotFound(_) | StoreError::InputUploadNotOwned(_) => {
            RuntimeJobControlError::NotFound
        }
        StoreError::InputUploadExpired(_) | StoreError::InputUploadState { .. } => {
            RuntimeJobControlError::Conflict
        }
        StoreError::InvalidInput(_) | StoreError::ProtocolValidation(_) => {
            RuntimeJobControlError::InvalidRequest
        }
        _ => RuntimeJobControlError::Internal,
    }
}

fn map_owned_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        // Ownership and optional scope are part of the store query, so a row
        // outside the authenticated context is indistinguishable from absence.
        StoreError::JobNotFound(_) => RuntimeJobControlError::NotFound,
        _ => RuntimeJobControlError::Internal,
    }
}

fn map_projection_error(_error: StoreError) -> RuntimeJobControlError {
    // Projection failures describe corrupt or unrepresentable runtime state,
    // never caller-controlled text suitable for a response.
    RuntimeJobControlError::Internal
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_queries_enforce_protocol_cursor_and_page_bounds() {
        let Ok(bounds) = replay_query_bounds(7, MAX_JOB_EVENT_REPLAY_RECORDS) else {
            panic!("valid replay bounds were rejected");
        };
        assert_eq!(bounds, 7);
        assert!(matches!(
            replay_query_bounds(MAX_JSON_SAFE_INTEGER + 1, 1),
            Err(RuntimeJobControlError::InvalidRequest)
        ));
        assert!(matches!(
            replay_query_bounds(0, 0),
            Err(RuntimeJobControlError::InvalidRequest)
        ));
    }

    #[test]
    fn only_terminal_attempt_zero_cancellation_uses_unstarted_input_cleanup() {
        // Both queued and admitted cancellation project to this exact durable
        // fence. Core covers their distinct pre-cancellation states and exact
        // adopted-file cleanup with its deterministic admission sampler.
        assert!(should_cleanup_unstarted_terminal_inputs(
            JobState::Cancelled,
            0
        ));
        assert!(!should_cleanup_unstarted_terminal_inputs(
            JobState::Cancelling,
            1
        ));
        assert!(!should_cleanup_unstarted_terminal_inputs(
            JobState::Cancelled,
            1
        ));
        assert!(!should_cleanup_unstarted_terminal_inputs(
            JobState::Admitted,
            0
        ));
    }

    #[test]
    fn durable_error_maps_discard_embedded_strings() {
        assert!(matches!(
            map_submission_registry_error(RegistryError::UnknownJobType("secret".into())),
            RuntimeJobControlError::InvalidRequest
        ));
        assert!(matches!(
            map_submission_store_error(StoreError::IdempotencyConflict {
                owner: "private-owner".into(),
                key: "private-key".into(),
            }),
            RuntimeJobControlError::Conflict
        ));
        assert!(matches!(
            map_submission_store_error(StoreError::AdmissionClosed),
            RuntimeJobControlError::Unavailable
        ));
        assert!(matches!(
            map_reservation_store_error(StoreError::InputUploadQuotaExceeded {
                scope: breadboard_runtime_core::InputUploadQuotaScope::Owner,
            }),
            RuntimeJobControlError::InputQuotaExceeded
        ));
        assert!(matches!(
            map_submission_store_error(StoreError::InputUploadNotOwned("private-upload".into())),
            RuntimeJobControlError::NotFound
        ));
        assert!(matches!(
            map_submission_store_error(StoreError::InputUploadExpired("private-upload".into())),
            RuntimeJobControlError::Conflict
        ));
        assert!(matches!(
            map_submission_store_error(StoreError::InputUploadState {
                upload_id: "private-upload".into(),
                state: "private-state".into(),
            }),
            RuntimeJobControlError::Conflict
        ));
        assert!(matches!(
            map_submission_store_error(StoreError::Path(PathError::BlobDigestMismatch)),
            RuntimeJobControlError::Internal
        ));
        assert!(matches!(
            map_owned_store_error(StoreError::JobNotFound("private-job".into())),
            RuntimeJobControlError::NotFound
        ));
        assert!(matches!(
            map_upload_store_error(StoreError::InputUploadNotOwned("private-upload".into())),
            RuntimeJobControlError::NotFound
        ));
        assert!(matches!(
            map_upload_store_error(StoreError::InputUploadState {
                upload_id: "private-upload".into(),
                state: "private-state".into(),
            }),
            RuntimeJobControlError::Conflict
        ));
        assert!(matches!(
            map_upload_store_error(StoreError::Path(PathError::BlobOverflow {
                declared_bytes: 7,
            })),
            RuntimeJobControlError::PayloadTooLarge
        ));
        assert!(matches!(
            map_upload_store_error(StoreError::Path(PathError::BlobSizeMismatch {
                declared_bytes: 7,
                actual_bytes: 3,
            })),
            RuntimeJobControlError::InvalidRequest
        ));
        assert!(matches!(
            map_checkpoint_store_error(StoreError::InvalidInput("private-state".into())),
            RuntimeJobControlError::OutputNotReady
        ));
        assert!(matches!(
            map_checkpoint_store_error(StoreError::Path(PathError::FileChanged)),
            RuntimeJobControlError::OutputNotReady
        ));
        assert!(matches!(
            map_result_store_error(StoreError::Path(PathError::FileChanged)),
            RuntimeJobControlError::Internal
        ));
        #[cfg(windows)]
        assert!(matches!(
            map_checkpoint_store_error(StoreError::Path(PathError::Io(
                io::Error::from_raw_os_error(32),
            ))),
            RuntimeJobControlError::OutputNotReady
        ));
        assert!(matches!(
            map_upload_read_error(io::Error::new(
                io::ErrorKind::Interrupted,
                "private shutdown detail",
            )),
            RuntimeJobControlError::Unavailable
        ));
    }
}
