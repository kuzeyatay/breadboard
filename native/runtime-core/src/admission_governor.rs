use crate::admission::{
    AdmissionPolicy, RegisteredJobAdmission, SystemCommit, ADMISSION_RESERVE_FLOOR_MB,
};
use crate::store::{JobAdmissionResult, JobStore, StoreError};
use crate::system_commit::read_system_commit;
#[cfg(test)]
use crate::system_commit::{SystemCommitReadError, SystemCommitSnapshot};
use crate::{
    DurableServiceAcquireResult, DurableServiceAdmissionProfile, DurableServiceRegistration,
    DurableServiceStartResult, DurableServiceStoreError, DurableWorkerServiceAcquireResult,
    WorkerServiceDependencyAdmission,
};
use breadboard_runtime_protocol::RuntimeMode;
use std::fmt;

/// The production admission authority. It is the integration path that can
/// create a durable job or service reservation or acquire the first logical
/// hold for an idle heavyweight service without exposing policy or sampling
/// authority. The exact system commit sample is taken inside `JobStore`'s
/// serialized admission transaction,
/// conservatively converted to MiB, and immediately evaluated against every
/// active hold.
pub struct AdmissionGovernor<'store> {
    store: &'store JobStore,
    policy: AdmissionPolicy,
    mode: RuntimeMode,
}

impl fmt::Debug for AdmissionGovernor<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AdmissionGovernor")
            .field("store", &"<opaque durable store>")
            .field("policy", &self.policy)
            .field("mode", &self.mode)
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

    /// Selects the trusted host mode's admission policy. Lean and Hot sample
    /// live commit against a bounded adaptive reserve; Packaged remains on the
    /// fixed architecture reserve used by acceptance and shipped builds.
    pub fn for_runtime_mode(store: &'store JobStore, mode: RuntimeMode) -> Self {
        Self {
            store,
            policy: AdmissionPolicy::for_runtime_mode(mode),
            mode,
        }
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
            mode: RuntimeMode::Packaged,
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

    /// Acquires a durable service lease through the same production admission
    /// authority as jobs. The native commit sampler and reserve policy cannot
    /// be substituted by downstream callers.
    pub fn begin_durable_service_acquire(
        &self,
        registration: &DurableServiceRegistration,
        admission_profile: &DurableServiceAdmissionProfile,
        lease_id: &str,
        requested_lease_ms: u64,
        now_ms: u64,
    ) -> Result<DurableServiceAcquireResult, DurableServiceStoreError> {
        let policy = self.service_admission_policy(admission_profile);
        self.store.begin_durable_service_acquire(
            registration,
            admission_profile,
            lease_id,
            requested_lease_ms,
            now_ms,
            policy,
            sample_commit_for_admission,
        )
    }

    /// Acquires a manifest-selected worker dependency while preserving the
    /// owning job's pending commit estimate. The opaque dependency proof is
    /// revalidated inside the store's serialized transaction; a cancelled or
    /// already-claimed owner is returned as a benign lost-candidate outcome.
    pub fn begin_durable_worker_service_dependency_acquire(
        &self,
        registration: &DurableServiceRegistration,
        admission_profile: &DurableServiceAdmissionProfile,
        dependency: &WorkerServiceDependencyAdmission,
        lease_id: &str,
        requested_lease_ms: u64,
        now_ms: u64,
    ) -> Result<DurableWorkerServiceAcquireResult, DurableServiceStoreError> {
        let policy = self.service_admission_policy(admission_profile);
        self.store.begin_durable_worker_service_dependency_acquire(
            registration,
            admission_profile,
            dependency,
            lease_id,
            requested_lease_ms,
            now_ms,
            policy,
            sample_commit_for_admission,
        )
    }

    /// Starts a registered eager service through the production system-commit
    /// sampler and the same serialized global reservation snapshot.
    pub fn begin_eager_durable_service_start(
        &self,
        registration: &DurableServiceRegistration,
        admission_profile: &DurableServiceAdmissionProfile,
        now_ms: u64,
    ) -> Result<DurableServiceStartResult, DurableServiceStoreError> {
        let policy = self.service_admission_policy(admission_profile);
        self.store.begin_eager_durable_service_start(
            registration,
            admission_profile,
            now_ms,
            policy,
            sample_commit_for_admission,
        )
    }

    fn service_admission_policy(
        &self,
        admission_profile: &DurableServiceAdmissionProfile,
    ) -> AdmissionPolicy {
        // The sealed registry profile must agree with the host-selected mode.
        // A mismatch fails toward the packaged policy instead of allowing a
        // caller to borrow development headroom for a packaged service.
        if admission_profile.mode() == self.mode {
            self.policy
        } else {
            AdmissionPolicy::default()
        }
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
    use crate::{
        AdmissionDecision, AdmissionRequest, AuthenticatedJobContext, Registry, RuntimeLoad,
        RuntimePaths,
    };
    use breadboard_runtime_protocol::{
        JobState, JobSubmissionPayload, ResourceClass, RuntimeMode, ServiceManifest,
        WorkerDefinition, WorkerManifest, WorkspacePolicy, SERVICE_MANIFEST_VERSION,
        WIRE_PROTOCOL_VERSION, WORKER_MANIFEST_VERSION,
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
                    submission_authority:
                        breadboard_runtime_protocol::WorkerSubmissionAuthority::User,
                    environment_source:
                        breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Minimal,
                    service_dependencies: Vec::new(),
                    allowed_executable: "node/node.exe".into(),
                    allowed_entrypoint: "workers/learn.mjs".into(),
                    protocol_version: WIRE_PROTOCOL_VERSION,
                    resource_class: ResourceClass::LargeGeneration,
                    estimated_cold_start_commit_mb: 128,
                    soft_commit_limit_mb: 256,
                    hard_commit_limit_mb: 512,
                    maximum_concurrency: 1,
                    minimum_input_blobs: 0,
                    maximum_input_blobs: 0,
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
            RuntimeMode::Lean,
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
                    input_uploads: Vec::new(),
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

    #[test]
    fn development_policy_is_mode_bound_and_packaged_stays_strict() {
        let (_directory, store, _admission, _context, _job_id) = queued_job();
        let governor = AdmissionGovernor::for_runtime_mode(&store, RuntimeMode::Hot);
        let request = AdmissionRequest {
            resource_class: ResourceClass::Core,
            estimated_cold_start_commit_mb: 3_072,
            reserve_floor_mb: None,
        };
        let load = RuntimeLoad {
            accepting_work: true,
            active_job_classes: Vec::new(),
            active_service_classes: Vec::new(),
        };
        // 40 GiB commit limit => 4 GiB derived/floored reserve + 256 MiB
        // guard + 3 GiB process-tree estimate. Nine GiB of free commit is safe
        // for a guarded development tree but below the packaged 8 GiB reserve
        // plus the same estimate.
        let commit = SystemCommit {
            total_mb: 40 * 1024 - 9_000,
            limit_mb: 40 * 1024,
        };
        let hot_dashboard =
            DurableServiceAdmissionProfile::new("dashboard".into(), RuntimeMode::Hot, 3_072)
                .unwrap();
        assert_eq!(
            governor
                .service_admission_policy(&hot_dashboard)
                .decide(request, commit, &load),
            AdmissionDecision::Admitted
        );

        let hot_chatmock =
            DurableServiceAdmissionProfile::new("chatmock".into(), RuntimeMode::Hot, 3_072)
                .unwrap();
        assert_eq!(
            governor
                .service_admission_policy(&hot_chatmock)
                .decide(request, commit, &load),
            AdmissionDecision::Admitted
        );

        for profile in [
            DurableServiceAdmissionProfile::new("dashboard".into(), RuntimeMode::Lean, 3_072)
                .unwrap(),
            DurableServiceAdmissionProfile::new("dashboard".into(), RuntimeMode::Packaged, 3_072)
                .unwrap(),
        ] {
            let AdmissionDecision::Denied(denial) = governor
                .service_admission_policy(&profile)
                .decide(request, commit, &load)
            else {
                panic!("a mismatched mode must retain the packaged reserve")
            };
            assert_eq!(denial.required_headroom_mb, 8 * 1024 + 3_072);
            assert_eq!(denial.available_headroom_mb, 9_000);
            assert_eq!(denial.resource, "windows_commit");
        }
    }
}
