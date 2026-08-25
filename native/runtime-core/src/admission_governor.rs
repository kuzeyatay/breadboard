use crate::admission::{
    AdmissionPolicy, RegisteredJobAdmission, SystemCommit, ADMISSION_RESERVE_FLOOR_MB,
};
use crate::store::{JobAdmissionResult, JobStore, StoreError};
use crate::system_commit::read_system_commit;
#[cfg(test)]
use crate::system_commit::{SystemCommitReadError, SystemCommitSnapshot};
use std::fmt;

/// The production admission authority. It is the only public path that can
/// create a durable job reservation: the exact system commit sample is taken
/// inside `JobStore`'s serialized admission transaction, conservatively
/// converted to MiB, and immediately evaluated against every active hold.
pub struct AdmissionGovernor<'store> {
    store: &'store JobStore,
    policy: AdmissionPolicy,
}

impl fmt::Debug for AdmissionGovernor<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdmissionGovernor")
            .field("store", &"<opaque durable store>")
            .field("policy", &self.policy)
            .finish()
    }
}

impl<'store> AdmissionGovernor<'store> {
    /// Creates the production admission authority with the architectural
    /// system-commit reserve. Downstream callers cannot inject policy.
    pub fn new(store: &'store JobStore) -> Self {
        Self::with_reserve_floors(
            store,
            ADMISSION_RESERVE_FLOOR_MB,
            ADMISSION_RESERVE_FLOOR_MB,
        )
    }

    /// Reserved for a future trusted configuration source. Clamping happens
    /// inside `AdmissionPolicy`, so malformed values can only preserve or
    /// raise the architecture floor, never lower it.
    pub(crate) fn with_reserve_floors(
        store: &'store JobStore,
        minimum_reserve_mb: u64,
        critical_reserve_mb: u64,
    ) -> Self {
        Self {
            store,
            policy: AdmissionPolicy::with_reserve_floors(minimum_reserve_mb, critical_reserve_mb),
        }
    }

    pub fn try_admit_job(
        &self,
        job_id: &str,
        admission: &RegisteredJobAdmission,
    ) -> Result<JobAdmissionResult, StoreError> {
        // The store owns denial persistence as well as reservation creation:
        // permanent resource denials are terminal before this call returns,
        // while the exact runtime-shutdown gate remains queued.
        self.store
            .try_admit_job(job_id, admission, self.policy, sample_commit_for_admission)
    }

    /// Production has no injected sampler constructor or public generic
    /// admission path. Unit tests retain this private seam to prove sampling
    /// failure, exact invocation count, and conservative byte conversion.
    #[cfg(test)]
    fn try_admit_job_with_sampler<F>(
        &self,
        job_id: &str,
        admission: &RegisteredJobAdmission,
        sample: F,
    ) -> Result<JobAdmissionResult, StoreError>
    where
        F: FnOnce() -> Result<SystemCommitSnapshot, SystemCommitReadError>,
    {
        self.store
            .try_admit_job(job_id, admission, self.policy, || {
                sample()?.admission_value().map_err(StoreError::from)
            })
    }
}

fn sample_commit_for_admission() -> Result<SystemCommit, StoreError> {
    read_system_commit()?
        .admission_value()
        .map_err(StoreError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AuthenticatedJobContext, Registry, RuntimePaths};
    use breadboard_runtime_protocol::{
        JobState, JobSubmissionPayload, ResourceClass, ServiceManifest, WorkerDefinition,
        WorkerManifest, WorkspacePolicy, SERVICE_MANIFEST_VERSION, WIRE_PROTOCOL_VERSION,
        WORKER_MANIFEST_VERSION,
    };
    use std::cell::Cell;
    use std::fs;

    const MEBIBYTE_BYTES: u64 = 1024 * 1024;

    fn queued_job() -> (
        tempfile::TempDir,
        JobStore,
        RegisteredJobAdmission,
        AuthenticatedJobContext,
        String,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let app = directory.path().join("app");
        let runtime = directory.path().join("runtime");
        fs::create_dir_all(&data).unwrap();
        fs::create_dir_all(&app).unwrap();
        fs::create_dir_all(&runtime).unwrap();
        let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
        let store = JobStore::open(data.join("runtime.sqlite3")).unwrap();
        let registry = Registry::new(
            WorkerManifest {
                version: WORKER_MANIFEST_VERSION,
                workers: vec![WorkerDefinition {
                    kind: "learn-node".into(),
                    job_types: vec!["learn".into()],
                    capability_ids: vec!["learn".into()],
                    allowed_executable: "node/node.exe".into(),
                    allowed_entrypoint: "workers/learn.mjs".into(),
                    protocol_version: WIRE_PROTOCOL_VERSION,
                    resource_class: ResourceClass::LargeGeneration,
                    estimated_cold_start_commit_mb: 128,
                    soft_commit_limit_mb: 256,
                    hard_commit_limit_mb: 512,
                    maximum_concurrency: 1,
                    workspace_policy: WorkspacePolicy::PrivatePerJob,
                    ready_timeout_ms: 10_000,
                    heartbeat_timeout_ms: 10_000,
                    graceful_cancellation_ms: 10_000,
                    maximum_runtime_ms: 60_000,
                    exit_after_job: true,
                }],
            },
            ServiceManifest {
                version: SERVICE_MANIFEST_VERSION,
                services: vec![],
            },
        )
        .unwrap();
        let context =
            AuthenticatedJobContext::for_verified_user(1, Some("garden-1"), None).unwrap();
        let record = registry
            .submit_job(
                &store,
                &paths,
                &context,
                &JobSubmissionPayload {
                    job_type: "learn".into(),
                    garden_id: Some("garden-1".into()),
                    conversation_id: None,
                    idempotency_key: "admission-governor-test".into(),
                    request_payload: serde_json::json!({ "source": "test" }),
                },
            )
            .unwrap();
        let admission = registry.admission_for_job_type("learn").unwrap();
        (directory, store, admission, context, record.job_id)
    }

    #[test]
    fn injected_test_sampler_is_called_once_inside_durable_admission() {
        let (_directory, store, admission, context, job_id) = queued_job();
        let governor = AdmissionGovernor::new(&store);
        let calls = Cell::new(0_u32);
        let result = governor
            .try_admit_job_with_sampler(&job_id, &admission, || {
                calls.set(calls.get() + 1);
                SystemCommitSnapshot::from_exact_bytes_for_test(
                    MEBIBYTE_BYTES + 1,
                    20_000 * MEBIBYTE_BYTES + (MEBIBYTE_BYTES - 1),
                )
            })
            .unwrap();

        assert_eq!(calls.get(), 1);
        assert!(matches!(result, JobAdmissionResult::Admitted(_)));
        assert_eq!(
            store.get(&context, &job_id).unwrap().state,
            JobState::Admitted
        );
    }

    #[test]
    fn sampling_failure_rolls_back_and_leaves_the_job_queued() {
        let (_directory, store, admission, context, job_id) = queued_job();
        let governor = AdmissionGovernor::new(&store);
        let result = governor.try_admit_job_with_sampler(&job_id, &admission, || {
            Err(SystemCommitReadError::InvalidSnapshot)
        });

        assert!(matches!(result, Err(StoreError::SystemCommitRead(_))));
        assert_eq!(
            store.get(&context, &job_id).unwrap().state,
            JobState::Queued
        );
    }

    #[test]
    fn crate_private_override_cannot_weaken_or_retry_the_durable_reserve_floor() {
        let (_directory, store, admission, context, job_id) = queued_job();
        let governor = AdmissionGovernor::with_reserve_floors(&store, 0, 1);
        assert_eq!(
            governor.policy.minimum_reserve_mb(),
            ADMISSION_RESERVE_FLOOR_MB
        );
        assert_eq!(
            governor.policy.critical_reserve_mb(),
            ADMISSION_RESERVE_FLOOR_MB
        );

        let result = governor
            .try_admit_job_with_sampler(&job_id, &admission, || {
                SystemCommitSnapshot::from_exact_bytes_for_test(
                    0,
                    ADMISSION_RESERVE_FLOOR_MB * MEBIBYTE_BYTES,
                )
            })
            .unwrap();

        let JobAdmissionResult::Denied(denial) = result else {
            panic!("the architecture reserve floor must deny admission")
        };
        assert_eq!(denial.resource, "windows_commit_critical");
        let terminal = store.get(&context, &job_id).unwrap();
        assert_eq!(terminal.state, JobState::ResourceExhausted);
        assert_eq!(
            terminal.failure_code.as_deref(),
            Some("BREADBOARD_RESOURCE_EXHAUSTED")
        );
    }
}
