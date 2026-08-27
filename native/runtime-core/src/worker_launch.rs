use crate::process_owner::{
    prepare_claimed_worker_launch, ProcessCreationUncertain, ProcessSpawnAttempt,
};
use crate::{
    CurrentGenerationMembership, ProcessOwnerError, ProcessOwnerEvent, ProcessOwnerTerminal,
    ProcessTreeExit, ProcessTreeResidency, RunningProcessOwner, RuntimeGenerationScope,
    WorkerDispatchClaim, WorkerLaunchRequest,
};
use breadboard_runtime_protocol::WorkerIdentity;
use std::fmt;
use std::time::Duration;

enum WorkerLaunchRetryMaterial {
    Request(WorkerLaunchRequest),
    Prepared(Box<crate::process_owner::TrustedProcessLaunch>),
    #[cfg(test)]
    Test,
}

/// Exhaustive result of consuming one durable worker dispatch claim at the
/// sole worker process-creation boundary.
#[must_use = "every worker launch outcome owns durable or live process authority and must be handled"]
pub enum WorkerLaunchOutcome {
    Running(ClaimedWorkerProcess),
    NotCreated(WorkerLaunchNotCreated),
    Uncertain(WorkerLaunchUncertain),
}

impl fmt::Debug for WorkerLaunchOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Running(_) => formatter.write_str("WorkerLaunchOutcome::Running(<opaque>)"),
            Self::NotCreated(_) => formatter.write_str("WorkerLaunchOutcome::NotCreated(<opaque>)"),
            Self::Uncertain(_) => formatter.write_str("WorkerLaunchOutcome::Uncertain(<opaque>)"),
        }
    }
}

/// One-shot proof that the claim-owned launch boundary failed before the OS
/// created any process. It owns both the claim and all retry material. Retrying
/// consumes this whole value, so a stale no-process proof cannot coexist with
/// a later live process tree.
#[must_use = "no-process-created authority must be retried or durably finalized"]
pub struct WorkerLaunchNotCreated {
    claim: Box<WorkerDispatchClaim>,
    retry: Option<WorkerLaunchRetryMaterial>,
    error: ProcessOwnerError,
}

/// Opaque proof that a claimed attempt was durably terminalized after the
/// process-creation boundary proved no process was created. It retains no
/// launch material and exists only to authorize exact terminal blob cleanup.
#[must_use = "no-process terminal cleanup authority must be reconciled"]
pub struct WorkerLaunchNotCreatedCleanup {
    pub(crate) generation_scope: RuntimeGenerationScope,
    pub(crate) identity: WorkerIdentity,
}

impl fmt::Debug for WorkerLaunchNotCreatedCleanup {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("WorkerLaunchNotCreatedCleanup(<opaque no-process proof>)")
    }
}

impl WorkerLaunchNotCreatedCleanup {
    pub fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }
}

impl fmt::Debug for WorkerLaunchNotCreated {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.claim, &self.retry);
        formatter
            .debug_struct("WorkerLaunchNotCreated")
            .field("authority", &"<opaque no-process-created authority>")
            .field("error", &self.error)
            .finish()
    }
}

impl WorkerLaunchNotCreated {
    pub fn identity(&self) -> &WorkerIdentity {
        self.claim.identity()
    }

    pub fn error(&self) -> &ProcessOwnerError {
        &self.error
    }

    pub fn can_retry(&self) -> bool {
        self.retry.is_some()
    }

    /// Performs the single retry retained by the initial no-process-created
    /// outcome. A second failure remains finalizable but cannot recursively
    /// mint another retry and bypass durable dispatch/backoff policy.
    pub(crate) fn retry(
        mut self,
        generation: &CurrentGenerationMembership,
    ) -> Result<WorkerLaunchOutcome, Self> {
        let Some(retry) = self.retry.take() else {
            return Err(self);
        };
        let Self {
            claim,
            retry: _,
            error: _,
        } = self;
        Ok(match retry {
            WorkerLaunchRetryMaterial::Request(request) => {
                launch_request(claim, generation, request, false)
            }
            WorkerLaunchRetryMaterial::Prepared(launch) => {
                launch_prepared(claim, generation, *launch, false)
            }
            #[cfg(test)]
            WorkerLaunchRetryMaterial::Test => {
                WorkerLaunchOutcome::NotCreated(WorkerLaunchNotCreated {
                    claim,
                    retry: None,
                    error: ProcessOwnerError::Spawn(std::io::Error::new(
                        std::io::ErrorKind::NotFound,
                        "test-only pre-CreateProcess failure",
                    )),
                })
            }
        })
    }

    pub(crate) fn claim(&self) -> &WorkerDispatchClaim {
        self.claim.as_ref()
    }

    pub(crate) fn rejected_before_creation(
        claim: Box<WorkerDispatchClaim>,
        error: ProcessOwnerError,
    ) -> Self {
        Self {
            claim,
            retry: None,
            error,
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(claim: WorkerDispatchClaim, error: ProcessOwnerError) -> Self {
        Self {
            claim: Box::new(claim),
            retry: Some(WorkerLaunchRetryMaterial::Test),
            error,
        }
    }

    #[cfg(test)]
    pub(crate) fn retry_for_test(self) -> Self {
        let Self {
            claim,
            retry,
            error: _,
        } = self;
        assert!(
            retry.is_some(),
            "test retry authority was already exhausted"
        );
        Self {
            claim,
            retry: None,
            error: ProcessOwnerError::Spawn(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "test-only retried pre-CreateProcess failure",
            )),
        }
    }
}

/// A claimed worker whose supervisor was created and whose exact live owner is
/// still coupled to the durable dispatch claim. The raw owner is intentionally
/// not exposed, preventing callers from separating launch authority before
/// residency or exact tree exit.
#[must_use = "a claimed worker must settle residency or reach exact tree exit"]
pub struct ClaimedWorkerProcess {
    claim: Box<WorkerDispatchClaim>,
    owner: Box<RunningProcessOwner>,
}

impl fmt::Debug for ClaimedWorkerProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.claim, &self.owner);
        formatter.write_str("ClaimedWorkerProcess(<opaque coupled claim and live owner>)")
    }
}

impl ClaimedWorkerProcess {
    pub fn identity(&self) -> &WorkerIdentity {
        self.claim.identity()
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.owner.supervisor_pid()
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.owner.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.owner.read_event(timeout)
    }

    pub fn request_stop(&mut self, force: bool) -> Result<(), ProcessOwnerError> {
        self.owner.request_stop(force)
    }

    /// Permanently rejects the just-observed parsed worker event using the
    /// fixed durable-state protocol fault. This is available before residency
    /// so a validly framed event that arrives before accepted `started` cannot
    /// later yield successful completion authority.
    pub fn reject_current_worker_event(&mut self) -> Result<(), ProcessOwnerError> {
        self.owner.reject_current_worker_event()
    }

    pub fn stop_terminal_wait_timeout(&self, force: bool) -> Result<Duration, ProcessOwnerError> {
        self.owner.stop_terminal_wait_timeout(force)
    }

    pub fn wait_for_terminal<F>(
        &mut self,
        timeout: Duration,
        observe: F,
    ) -> Result<ProcessOwnerTerminal, ProcessOwnerError>
    where
        F: FnMut(&ProcessOwnerEvent),
    {
        self.owner.wait_for_terminal(timeout, observe)
    }

    pub fn into_residency(
        mut self,
    ) -> Result<WorkerResidencyAuthority, WorkerProcessTransitionError<Self>> {
        match self.owner.take_process_tree_residency() {
            Ok(residency) => Ok(WorkerResidencyAuthority {
                process: self,
                residency,
            }),
            Err(error) => Err(WorkerProcessTransitionError {
                authority: Box::new(self),
                error,
            }),
        }
    }

    pub fn confirm_exit(
        mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<WorkerTreeExitAuthority, WorkerProcessTransitionError<Self>> {
        match self.owner.confirm_exit(terminal) {
            Ok(tree_exit) => Ok(WorkerTreeExitAuthority {
                process: self,
                tree_exit,
            }),
            Err(error) => Err(WorkerProcessTransitionError {
                authority: Box::new(self),
                error,
            }),
        }
    }
}

/// A transition failure that returns the complete live authority to its caller.
/// Event timeouts, reap delays, and other transient owner errors therefore do
/// not silently drop the only claim/process capability.
#[must_use = "transition errors retain live authority and must be recovered or terminated"]
pub struct WorkerProcessTransitionError<A> {
    authority: Box<A>,
    error: ProcessOwnerError,
}

impl<A> fmt::Debug for WorkerProcessTransitionError<A> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("WorkerProcessTransitionError")
            .field("authority", &"<opaque retained authority>")
            .field("error", &self.error)
            .finish()
    }
}

impl<A> WorkerProcessTransitionError<A> {
    pub fn error(&self) -> &ProcessOwnerError {
        &self.error
    }

    pub fn into_parts(self) -> (A, ProcessOwnerError) {
        (*self.authority, self.error)
    }
}

/// Exact claim + accepted-started authority awaiting one atomic durable
/// pending-to-resident transition.
#[must_use = "worker residency authority must be durably settled"]
pub struct WorkerResidencyAuthority {
    process: ClaimedWorkerProcess,
    residency: ProcessTreeResidency,
}

impl fmt::Debug for WorkerResidencyAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.process, &self.residency);
        formatter.write_str("WorkerResidencyAuthority(<opaque claim and started authority>)")
    }
}

impl WorkerResidencyAuthority {
    pub fn identity(&self) -> &WorkerIdentity {
        self.process.identity()
    }

    /// Keeps the unsettled claim + started authority intact while asking the
    /// exact live owner to stop during fatal host shutdown.
    pub fn request_runtime_shutdown(&mut self) -> Result<(), ProcessOwnerError> {
        self.process.request_stop(true)
    }

    pub(crate) fn parts(&self) -> (&WorkerDispatchClaim, &ProcessTreeResidency) {
        (self.process.claim.as_ref(), &self.residency)
    }

    pub(crate) fn into_resident(self, identity: WorkerIdentity) -> ResidentWorkerProcess {
        debug_assert_eq!(self.process.identity(), &identity);
        ResidentWorkerProcess {
            identity,
            owner: self.process.owner,
        }
    }
}

/// Exact claim + zero-resident receipt for a tree that exited before durable
/// residency was accepted.
#[must_use = "pre-residency tree-exit authority must be durably finalized"]
pub struct WorkerTreeExitAuthority {
    process: ClaimedWorkerProcess,
    tree_exit: ProcessTreeExit,
}

impl fmt::Debug for WorkerTreeExitAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.process, &self.tree_exit);
        formatter.write_str("WorkerTreeExitAuthority(<opaque claim and zero-resident receipt>)")
    }
}

impl WorkerTreeExitAuthority {
    pub fn identity(&self) -> &WorkerIdentity {
        self.process.identity()
    }

    pub(crate) fn parts(&self) -> (&WorkerDispatchClaim, &ProcessTreeExit) {
        (self.process.claim.as_ref(), &self.tree_exit)
    }

    pub(crate) fn into_parts(self) -> (ClaimedWorkerProcess, ProcessTreeExit) {
        (self.process, self.tree_exit)
    }
}

/// A resident worker no longer carries a pending dispatch claim. It retains
/// only the exact live owner needed for event polling, cancellation, and the
/// eventual zero-resident receipt.
#[must_use = "a resident worker must reach exact process-tree exit"]
pub struct ResidentWorkerProcess {
    identity: WorkerIdentity,
    owner: Box<RunningProcessOwner>,
}

impl fmt::Debug for ResidentWorkerProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.identity, &self.owner);
        formatter.write_str("ResidentWorkerProcess(<opaque resident live owner>)")
    }
}

impl ResidentWorkerProcess {
    pub fn identity(&self) -> &WorkerIdentity {
        &self.identity
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.owner.supervisor_pid()
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.owner.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.owner.read_event(timeout)
    }

    pub fn request_stop(&mut self, force: bool) -> Result<(), ProcessOwnerError> {
        self.owner.request_stop(force)
    }

    /// Permanently rejects the just-observed parsed worker event after the
    /// durable store determines that its state/result semantics are invalid.
    /// The fixed fault cannot be caller-selected, clears any queued worker
    /// records, and prevents this process tree from later minting successful
    /// completion authority while retaining the exact live owner for cleanup.
    pub fn reject_current_worker_event(&mut self) -> Result<(), ProcessOwnerError> {
        self.owner.reject_current_worker_event()
    }

    pub fn stop_terminal_wait_timeout(&self, force: bool) -> Result<Duration, ProcessOwnerError> {
        self.owner.stop_terminal_wait_timeout(force)
    }

    pub fn wait_for_terminal<F>(
        &mut self,
        timeout: Duration,
        observe: F,
    ) -> Result<ProcessOwnerTerminal, ProcessOwnerError>
    where
        F: FnMut(&ProcessOwnerEvent),
    {
        self.owner.wait_for_terminal(timeout, observe)
    }

    pub fn confirm_exit(
        mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ProcessTreeExit, WorkerProcessTransitionError<Self>> {
        match self.owner.confirm_exit(terminal) {
            Ok(tree_exit) => Ok(tree_exit),
            Err(error) => Err(WorkerProcessTransitionError {
                authority: Box::new(self),
                error,
            }),
        }
    }
}

/// A process was created, but setup failed before the ordinary live-owner
/// protocol could become authoritative. This object owns the exact child
/// cleanup handle and claim. It has no reservation-release conversion.
#[must_use = "an uncertain worker launch requires bounded cleanup and runtime restart"]
pub struct WorkerLaunchUncertain {
    claim: Box<WorkerDispatchClaim>,
    owner: Box<ProcessCreationUncertain>,
}

impl fmt::Debug for WorkerLaunchUncertain {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.claim, &self.owner);
        formatter.write_str("WorkerLaunchUncertain(<opaque claim and live cleanup authority>)")
    }
}

impl WorkerLaunchUncertain {
    pub fn identity(&self) -> &WorkerIdentity {
        self.claim.identity()
    }

    pub fn error(&self) -> &ProcessOwnerError {
        self.owner.error()
    }

    /// Requests bounded emergency termination without consuming the child
    /// handle or implying zero residents. The runtime must close admission,
    /// retain this object through shutdown, then let the next generation's
    /// drain proof reconcile the still-pending durable attempt.
    pub fn request_runtime_shutdown(&mut self) {
        self.owner.request_emergency_termination();
    }
}

impl WorkerDispatchClaim {
    pub(crate) fn launch(
        self: Box<Self>,
        generation: &CurrentGenerationMembership,
        request: WorkerLaunchRequest,
    ) -> WorkerLaunchOutcome {
        launch_request(self, generation, request, true)
    }
}

fn launch_request(
    claim: Box<WorkerDispatchClaim>,
    generation: &CurrentGenerationMembership,
    request: WorkerLaunchRequest,
    retry_available: bool,
) -> WorkerLaunchOutcome {
    let request_scope = request.generation_scope();
    if !claim.matches_generation_scope(&request_scope) || !generation.matches_scope(&request_scope)
    {
        return WorkerLaunchOutcome::NotCreated(WorkerLaunchNotCreated {
            claim,
            retry: retry_available.then_some(WorkerLaunchRetryMaterial::Request(request)),
            error: ProcessOwnerError::GenerationScopeMismatch,
        });
    }
    if request.worker_kind() != claim.job().worker_kind.as_str() {
        return WorkerLaunchOutcome::NotCreated(WorkerLaunchNotCreated {
            claim,
            retry: retry_available.then_some(WorkerLaunchRetryMaterial::Request(request)),
            error: ProcessOwnerError::InvalidLaunch(
                "worker registry material did not match the durable worker kind",
            ),
        });
    }
    match prepare_claimed_worker_launch(claim.as_ref(), request) {
        Ok(launch) => launch_prepared(claim, generation, launch, retry_available),
        Err((request, error)) => WorkerLaunchOutcome::NotCreated(WorkerLaunchNotCreated {
            claim,
            retry: retry_available.then_some(WorkerLaunchRetryMaterial::Request(request)),
            error,
        }),
    }
}

fn launch_prepared(
    claim: Box<WorkerDispatchClaim>,
    generation: &CurrentGenerationMembership,
    launch: crate::process_owner::TrustedProcessLaunch,
    retry_available: bool,
) -> WorkerLaunchOutcome {
    let scope = launch.generation_scope();
    let scope_matches = claim.matches_generation_scope(scope) && generation.matches_scope(scope);
    if !scope_matches {
        return WorkerLaunchOutcome::NotCreated(WorkerLaunchNotCreated {
            claim,
            retry: retry_available.then_some(WorkerLaunchRetryMaterial::Prepared(Box::new(launch))),
            error: ProcessOwnerError::GenerationScopeMismatch,
        });
    }
    match RunningProcessOwner::spawn_claimed_worker(generation, launch) {
        ProcessSpawnAttempt::Running(owner) => {
            WorkerLaunchOutcome::Running(ClaimedWorkerProcess { claim, owner })
        }
        ProcessSpawnAttempt::NotCreated { launch, error } => {
            WorkerLaunchOutcome::NotCreated(WorkerLaunchNotCreated {
                claim,
                retry: retry_available.then_some(WorkerLaunchRetryMaterial::Prepared(launch)),
                error,
            })
        }
        ProcessSpawnAttempt::Uncertain(owner) => {
            WorkerLaunchOutcome::Uncertain(WorkerLaunchUncertain { claim, owner })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ProcessOwnerLimits, RuntimeGenerationGuard, RuntimeGenerationScope, RuntimePaths};
    use breadboard_runtime_protocol::{parse_worker_start_manifest, WorkerExecutionScope};
    use std::fs;

    #[test]
    fn no_process_retry_material_is_available_exactly_once() {
        let identity = WorkerIdentity {
            job_id: "job_retry_once".into(),
            attempt: 1,
            worker_instance_id: "worker_retry_once".into(),
        };
        let claim = WorkerDispatchClaim::for_test(
            RuntimeGenerationScope::from_trusted_data_root_identity(7, 11),
            identity.clone(),
        );
        let first = WorkerLaunchNotCreated::for_test(
            claim,
            ProcessOwnerError::Spawn(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "initial pre-CreateProcess failure",
            )),
        );
        assert!(first.can_retry());

        let second = first.retry_for_test();
        assert!(!second.can_retry());
        assert_eq!(second.identity(), &identity);
    }

    #[test]
    fn start_manifest_scope_is_minted_from_the_exact_claim_not_job_payload() {
        let directory = tempfile::Builder::new()
            .prefix("breadboard-worker-execution-scope-")
            .tempdir()
            .unwrap();
        for relative in ["data", "app", "runtime/bin", "runtime/node"] {
            fs::create_dir_all(directory.path().join(relative)).unwrap();
        }
        fs::write(
            directory.path().join("runtime/bin/runtime-supervisor.exe"),
            b"not executed",
        )
        .unwrap();
        fs::write(
            directory.path().join("runtime/node/worker.exe"),
            b"not executed",
        )
        .unwrap();
        fs::write(directory.path().join("app/worker.mjs"), b"not executed").unwrap();

        let paths = RuntimePaths::new(
            directory.path().join("data"),
            directory.path().join("app"),
            directory.path().join("runtime"),
        )
        .unwrap();
        drop(
            paths
                .stage_job_input(
                    "job_scope",
                    br#"{"conversationId":"forged-conversation","gardenId":"forged-garden","userId":999}"#,
                )
                .unwrap(),
        );
        let identity = WorkerIdentity {
            job_id: "job_scope".into(),
            attempt: 1,
            worker_instance_id: "worker_scope".into(),
        };
        let expected_scope = WorkerExecutionScope::new(
            Some(42),
            Some("trusted-garden".into()),
            Some("trusted-conversation".into()),
        )
        .unwrap();
        let claim = WorkerDispatchClaim::for_test_with_execution_scope(
            paths.runtime_generation_scope(),
            identity.clone(),
            expected_scope.clone(),
        );
        let request = WorkerLaunchRequest::from_registry(
            "test-worker".into(),
            paths.clone(),
            paths
                .pin_runtime_file_for_launch(
                    &paths.resolve_runtime("bin/runtime-supervisor.exe").unwrap(),
                )
                .unwrap(),
            paths
                .pin_runtime_file_for_launch(&paths.resolve_runtime("node/worker.exe").unwrap())
                .unwrap(),
            Some(
                paths
                    .pin_app_file_for_launch(&paths.resolve_app("worker.mjs").unwrap())
                    .unwrap(),
            ),
            crate::TrustedWorkerEnvironment::minimal_for_test(),
            ProcessOwnerLimits {
                soft_commit_bytes: 0,
                hard_commit_bytes: 0,
                graceful_shutdown: Duration::from_secs(1),
                supervisor_exit_timeout: Duration::from_secs(1),
                system_commit_guard: None,
            },
        );

        let launch = prepare_claimed_worker_launch(&claim, request).unwrap();
        drop(launch);
        let encoded = fs::read(
            paths
                .data_root()
                .join("runtime/jobs/job_scope/attempts/1/worker_scope/start.json"),
        )
        .unwrap();
        let manifest = parse_worker_start_manifest(&encoded).unwrap();
        assert_eq!(manifest.identity, identity);
        assert_eq!(manifest.execution_scope, expected_scope);
        assert_ne!(manifest.execution_scope.user_id, Some(999));
        assert_ne!(
            manifest.execution_scope.garden_id.as_deref(),
            Some("forged-garden")
        );
        assert_ne!(
            manifest.execution_scope.conversation_id.as_deref(),
            Some("forged-conversation")
        );
    }

    #[cfg(windows)]
    #[test]
    fn foreign_data_root_is_not_created_before_worker_filesystem_preparation() {
        let directory = tempfile::Builder::new()
            .prefix("breadboard-worker-scope-fence-")
            .tempdir()
            .unwrap();
        for relative in ["data-a", "data-b", "app", "runtime/bin", "runtime/node"] {
            fs::create_dir_all(directory.path().join(relative)).unwrap();
        }
        fs::write(
            directory.path().join("runtime/bin/runtime-supervisor.exe"),
            b"not executed",
        )
        .unwrap();
        fs::write(
            directory.path().join("runtime/node/worker.exe"),
            b"not executed",
        )
        .unwrap();
        fs::write(directory.path().join("app/worker.mjs"), b"not executed").unwrap();

        let claim_paths = RuntimePaths::new(
            directory.path().join("data-a"),
            directory.path().join("app"),
            directory.path().join("runtime"),
        )
        .unwrap();
        let request_paths = RuntimePaths::new(
            directory.path().join("data-b"),
            directory.path().join("app"),
            directory.path().join("runtime"),
        )
        .unwrap();
        let scope = claim_paths.runtime_generation_scope();
        let (guard, _prior_generation) =
            RuntimeGenerationGuard::acquire(scope.clone(), Duration::ZERO, Duration::from_secs(2))
                .unwrap();
        let membership = guard.membership();
        let identity = WorkerIdentity {
            job_id: "job_scope".into(),
            attempt: 1,
            worker_instance_id: "worker_scope".into(),
        };
        let claim = Box::new(WorkerDispatchClaim::for_test(scope.clone(), identity));
        let supervisor = request_paths
            .pin_runtime_file_for_launch(
                &request_paths
                    .resolve_runtime("bin/runtime-supervisor.exe")
                    .unwrap(),
            )
            .unwrap();
        let executable = request_paths
            .pin_runtime_file_for_launch(&request_paths.resolve_runtime("node/worker.exe").unwrap())
            .unwrap();
        let entrypoint = request_paths
            .pin_app_file_for_launch(&request_paths.resolve_app("worker.mjs").unwrap())
            .unwrap();
        let request = WorkerLaunchRequest::from_registry(
            "test-worker".into(),
            request_paths.clone(),
            supervisor,
            executable,
            Some(entrypoint),
            crate::TrustedWorkerEnvironment::minimal_for_test(),
            ProcessOwnerLimits {
                soft_commit_bytes: 0,
                hard_commit_bytes: 0,
                graceful_shutdown: Duration::from_secs(1),
                supervisor_exit_timeout: Duration::from_secs(1),
                system_commit_guard: None,
            },
        );

        assert!(matches!(
            claim.launch(&membership, request),
            WorkerLaunchOutcome::NotCreated(ref authority)
                if authority.can_retry()
                    && matches!(authority.error(), ProcessOwnerError::GenerationScopeMismatch)
        ));
        assert!(!request_paths
            .data_root()
            .join("runtime/jobs/job_scope")
            .exists());

        let kind_identity = WorkerIdentity {
            job_id: "job_kind".into(),
            attempt: 1,
            worker_instance_id: "worker_kind".into(),
        };
        let kind_claim = Box::new(WorkerDispatchClaim::for_test(scope, kind_identity));
        let kind_request = WorkerLaunchRequest::from_registry(
            "different-worker".into(),
            claim_paths.clone(),
            claim_paths
                .pin_runtime_file_for_launch(
                    &claim_paths
                        .resolve_runtime("bin/runtime-supervisor.exe")
                        .unwrap(),
                )
                .unwrap(),
            claim_paths
                .pin_runtime_file_for_launch(
                    &claim_paths.resolve_runtime("node/worker.exe").unwrap(),
                )
                .unwrap(),
            Some(
                claim_paths
                    .pin_app_file_for_launch(&claim_paths.resolve_app("worker.mjs").unwrap())
                    .unwrap(),
            ),
            crate::TrustedWorkerEnvironment::minimal_for_test(),
            ProcessOwnerLimits {
                soft_commit_bytes: 0,
                hard_commit_bytes: 0,
                graceful_shutdown: Duration::from_secs(1),
                supervisor_exit_timeout: Duration::from_secs(1),
                system_commit_guard: None,
            },
        );
        assert!(matches!(
            kind_claim.launch(&membership, kind_request),
            WorkerLaunchOutcome::NotCreated(ref authority)
                if authority.can_retry()
                    && matches!(authority.error(), ProcessOwnerError::InvalidLaunch(_))
        ));
        assert!(!claim_paths
            .data_root()
            .join("runtime/jobs/job_kind")
            .exists());
    }
}
