use crate::control::{RuntimeJobControl, RuntimeJobControlError};
use breadboard_runtime_core::{
    runtime_job_events_response, runtime_job_response, AuthenticatedJobContext, JobStore,
    Registry, RegistryError, RuntimePaths, StoreError,
};
use breadboard_runtime_protocol::{
    JobSubmissionPayload, RuntimeJobEventsResponse, RuntimeJobResponse,
    MAX_JOB_EVENT_REPLAY_RECORDS, MAX_JSON_SAFE_INTEGER,
};
use std::sync::Arc;

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
        // Cancellation is only a durable request. The process owner remains
        // responsible for signalling and confirming the complete tree exit.
        let record = self
            .store
            .request_cancellation(context, job_id)
            .map_err(map_owned_store_error)?;
        runtime_job_response(&record).map_err(map_projection_error)
    }
}

fn replay_query_bounds(
    after: u64,
    requested_limit: usize,
) -> Result<i64, RuntimeJobControlError> {
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
        RegistryError::AuthenticatedScopeMismatch { .. } => RuntimeJobControlError::Forbidden,
        RegistryError::Store(error) => map_submission_store_error(error),
        RegistryError::DependencyCycle(_)
        | RegistryError::DuplicateJobType { .. }
        | RegistryError::UnknownWorker(_)
        | RegistryError::UnknownService(_)
        | RegistryError::Path(_) => RuntimeJobControlError::Internal,
    }
}

fn map_submission_store_error(error: StoreError) -> RuntimeJobControlError {
    match error {
        StoreError::JobIdConflict(_) | StoreError::IdempotencyConflict { .. } => {
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
            map_owned_store_error(StoreError::JobNotFound("private-job".into())),
            RuntimeJobControlError::NotFound
        ));
    }
}
