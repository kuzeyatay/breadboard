use crate::control::RuntimeServiceControlError;
use crate::service_engine::{
    WorkerServiceDependencyAcquireError, WorkerServiceDependencyControl,
    WorkerServiceDependencyLease,
};
use crate::shutdown::ShutdownCoordinator;
use breadboard_runtime_core::{
    AdmissionGovernor, AuthoritativeProcessOwner, ClaimedWorkerProcess,
    CurrentGenerationMembership, JobAdmissionResult, JobStore, OwnedWorkerEvent, ProcessOwnerError,
    ProcessOwnerEvent, ProcessTreeExit, Registry, RegistryError, ResidentWorkerProcess,
    RuntimePaths, StoreError, TrustedWorkerEnvironmentSet, WorkerClaimOutcome,
    WorkerCompletionProof, WorkerLaunchNotCreated, WorkerLaunchNotCreatedCleanup,
    WorkerLaunchOutcome, WorkerLaunchUncertain, WorkerResidencyAuthority,
    WorkerServiceDependencyFailure, WorkerServiceDependencyFailureDisposition,
    WorkerTreeExitAuthority, MAX_DISPATCH_CANDIDATES,
};
use breadboard_runtime_protocol::{RuntimeMode, WorkerDefinition, WorkerEvent, WorkerIdentity};
use std::io;
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use thiserror::Error;

const DISPATCH_POLL_INTERVAL: Duration = Duration::from_millis(100);
const POST_TERMINAL_EXIT_GRACE: Duration = Duration::from_secs(2);
const WORKER_INSTANCE_RANDOM_BYTES: usize = 16;
const ONLINE_EXPIRED_UPLOAD_CLEANUP_BATCH: usize = 8;
const ONLINE_EXPIRED_IDEMPOTENCY_CANCELLATION_CLEANUP_BATCH: usize = 8;
const ONLINE_EXPIRED_UPLOAD_CLEANUP_INTERVAL: Duration = Duration::from_secs(5);
const MAX_ACTIVE_WORKER_LANES: usize = MAX_DISPATCH_CANDIDATES;

/// Sanitized dispatcher failures. The source chain remains available to the
/// native host, but path, job, process, and manifest details never become a
/// public control-plane payload.
#[derive(Debug, Error)]
pub(crate) enum WorkerDispatcherError {
    #[error("the worker dispatcher thread could not be started")]
    ThreadStart(#[source] io::Error),
    #[error("the worker dispatcher thread stopped unexpectedly")]
    ThreadPanicked,
    #[error("the trusted worker registry rejected dispatcher state")]
    Registry(#[source] RegistryError),
    #[error("the durable worker scheduler transaction failed")]
    Store(#[source] StoreError),
    #[error("the authoritative worker process transition failed")]
    Process(#[source] ProcessOwnerError),
    #[error("a fresh worker instance identity could not be generated")]
    IdentityGeneration,
    #[error("a validated worker deadline could not be represented by the dispatcher")]
    InvalidWorkerLimits,
    #[error("worker launch became uncertain after process creation")]
    UncertainLaunch,
    #[error("fatal worker authority is retained for generation teardown")]
    AuthorityRetained,
    #[error("the authoritative worker did not finish bounded forced cleanup")]
    ForcedCleanupTimeout,
    #[error("a required Runtime service dependency lease could not be reconciled")]
    ServiceDependencyControl,
}

/// One native scheduler thread owns FIFO admission while bounded owner lanes
/// independently drive live disposable workers. SQLite remains the sole
/// durable ledger; per-definition concurrency and live system-commit admission
/// decide which jobs may overlap.
pub(crate) struct WorkerDispatcherConfig {
    pub(crate) mode: RuntimeMode,
    pub(crate) registry: Registry,
    pub(crate) store: Arc<JobStore>,
    pub(crate) paths: RuntimePaths,
    pub(crate) generation: CurrentGenerationMembership,
    pub(crate) environments: TrustedWorkerEnvironmentSet,
    pub(crate) service_dependencies: WorkerServiceDependencyControl,
    pub(crate) shutdown: Arc<ShutdownCoordinator>,
}

pub(crate) struct WorkerDispatcher {
    shutdown: Arc<ShutdownCoordinator>,
    // A completed JoinHandle retains its return value until join. In the
    // uncertain-launch case that return value owns the opaque child+claim
    // authority, keeping both fenced until the host is already in its shutdown
    // epilogue and the process is committed to exit (the generation Job is
    // deliberately process-lifetime and closes only at process termination).
    thread: Option<JoinHandle<Result<(), DispatchLoopFailure>>>,
    retained_authorities: Vec<FatalDispatchAuthority>,
}

enum DispatchLoopError {
    Fatal(WorkerDispatcherError),
    Authority(FatalDispatchAuthority),
}

struct DispatchLoopFailure {
    primary: WorkerDispatcherError,
    authorities: Vec<FatalDispatchAuthority>,
}

impl DispatchLoopFailure {
    fn from_errors(errors: Vec<DispatchLoopError>) -> Option<Self> {
        let mut fatal = None;
        let mut authorities = Vec::new();
        let mut uncertain = false;
        for error in errors {
            match error {
                DispatchLoopError::Fatal(error) => {
                    if fatal.is_none() {
                        fatal = Some(error);
                    }
                }
                DispatchLoopError::Authority(authority) => {
                    uncertain |= matches!(&authority, FatalDispatchAuthority::Uncertain(_));
                    authorities.push(authority);
                }
            }
        }
        let primary = fatal.or_else(|| {
            (!authorities.is_empty()).then_some(if uncertain {
                WorkerDispatcherError::UncertainLaunch
            } else {
                WorkerDispatcherError::AuthorityRetained
            })
        })?;
        Some(Self {
            primary,
            authorities,
        })
    }
}

/// Authority-bearing failures are deliberately not ordinary errors. The
/// dispatcher holds these values after joining its thread while the host exits.
/// This prevents a transaction error, transient reap error, or protocol
/// ambiguity from destroying the only claim/live-process capability and then
/// allowing the same generation to resume. Returning the retained-authority
/// error commits `main` to process exit and the process-lifetime outer Job
/// teardown.
enum FatalDispatchAuthority {
    Claimed(Box<ClaimedWorkerProcess>),
    Resident(Box<ResidentWorkerProcess>),
    NotCreated(Box<WorkerLaunchNotCreated>),
    NotCreatedCleanup(Box<WorkerLaunchNotCreatedCleanup>),
    Residency(Box<WorkerResidencyAuthority>),
    BeforeStarted(Box<WorkerTreeExitAuthority>),
    TreeExit(Box<ProcessTreeExit>),
    Completion {
        owner: Box<AuthoritativeProcessOwner>,
        proof: Box<WorkerCompletionProof>,
    },
    Uncertain(Box<WorkerLaunchUncertain>),
    PendingWorkerEvent {
        process: Box<ResidentWorkerProcess>,
        event: Box<OwnedWorkerEvent>,
    },
}

impl FatalDispatchAuthority {
    fn request_generation_shutdown(&mut self) {
        match self {
            Self::Claimed(process) => {
                let _ = process.request_stop(true);
            }
            Self::Resident(process) => {
                let _ = process.request_stop(true);
            }
            Self::Uncertain(authority) => authority.request_runtime_shutdown(),
            Self::PendingWorkerEvent { process, event } => {
                let _ = event.event();
                let _ = process.request_stop(true);
            }
            Self::NotCreated(authority) => {
                let _ = authority.identity();
            }
            Self::NotCreatedCleanup(authority) => {
                let _ = authority.identity();
            }
            Self::Residency(authority) => {
                let _ = authority.request_runtime_shutdown();
            }
            Self::BeforeStarted(authority) => {
                let _ = authority.identity();
            }
            Self::TreeExit(authority) => {
                let _ = authority.classification();
            }
            Self::Completion { owner, proof } => {
                let _ = (&**owner, &**proof);
            }
        }
    }
}

impl From<WorkerDispatcherError> for DispatchLoopError {
    fn from(error: WorkerDispatcherError) -> Self {
        Self::Fatal(error)
    }
}

impl WorkerDispatcher {
    pub(crate) fn start(config: WorkerDispatcherConfig) -> Result<Self, WorkerDispatcherError> {
        let shutdown = Arc::clone(&config.shutdown);
        let thread = thread::Builder::new()
            .name("runtime-worker-dispatcher".into())
            .spawn(move || {
                let result = run_dispatch_loop(&config);
                if result.is_err() {
                    // Any authority or persistence ambiguity takes the whole
                    // generation out of service. Restart reconciliation, not a
                    // blind in-generation retry, classifies retained state.
                    config.shutdown.request_shutdown();
                }
                result
            })
            .map_err(WorkerDispatcherError::ThreadStart)?;
        Ok(Self {
            shutdown,
            thread: Some(thread),
            retained_authorities: Vec::new(),
        })
    }

    pub(crate) fn shutdown(&mut self) -> Result<(), WorkerDispatcherError> {
        self.shutdown.request_shutdown();
        self.join()
    }

    fn join(&mut self) -> Result<(), WorkerDispatcherError> {
        if !self.retained_authorities.is_empty() {
            return Err(WorkerDispatcherError::AuthorityRetained);
        }
        let Some(thread) = self.thread.take() else {
            return Ok(());
        };
        match thread
            .join()
            .map_err(|_| WorkerDispatcherError::ThreadPanicked)?
        {
            Ok(()) => Ok(()),
            Err(mut failure) => {
                // Admission is already closed and the control listener is
                // leaving. Request cleanup without consuming opaque values,
                // then retain every authority until `main` terminates the
                // process-lifetime generation.
                for authority in &mut failure.authorities {
                    authority.request_generation_shutdown();
                }
                self.retained_authorities = failure.authorities;
                Err(failure.primary)
            }
        }
    }
}

impl Drop for WorkerDispatcher {
    fn drop(&mut self) {
        self.shutdown.request_shutdown();
        // Every process-owner wait used by the dispatcher is bounded. A drop
        // during host error handling therefore still joins every owner lane
        // and runs the same authority-retention path instead of detaching it.
        let _ = self.join();
    }
}

fn run_dispatch_loop(config: &WorkerDispatcherConfig) -> Result<(), DispatchLoopFailure> {
    let mut lanes = Vec::new();
    let mut failures = Vec::new();
    let mut next_expired_upload_cleanup = Instant::now();
    while !config.shutdown.is_requested() {
        failures.extend(reap_finished_worker_lanes(&mut lanes));
        if !failures.is_empty() {
            config.shutdown.request_shutdown();
            break;
        }
        if !config.shutdown.is_accepting_work() {
            config
                .shutdown
                .wait_for_dispatch_tick(DISPATCH_POLL_INTERVAL);
            continue;
        }

        let now = Instant::now();
        if now >= next_expired_upload_cleanup {
            if let Err(error) = config
                .store
                .reconcile_expired_job_input_uploads_online(
                    &config.paths,
                    ONLINE_EXPIRED_UPLOAD_CLEANUP_BATCH,
                )
                .map_err(WorkerDispatcherError::Store)
            {
                failures.push(error.into());
                config.shutdown.request_shutdown();
                break;
            }
            if let Err(error) = config
                .store
                .reconcile_expired_idempotency_cancellations_online(
                    ONLINE_EXPIRED_IDEMPOTENCY_CANCELLATION_CLEANUP_BATCH,
                )
                .map_err(WorkerDispatcherError::Store)
            {
                failures.push(error.into());
                config.shutdown.request_shutdown();
                break;
            }
            next_expired_upload_cleanup = now + ONLINE_EXPIRED_UPLOAD_CLEANUP_INTERVAL;
        }

        if lanes.len() >= MAX_ACTIVE_WORKER_LANES {
            config
                .shutdown
                .wait_for_dispatch_tick(DISPATCH_POLL_INTERVAL);
            continue;
        }

        // Existing admitted work always precedes new reservation creation.
        let dispatch = match dispatch_one(
            &config.registry,
            Arc::clone(&config.store),
            config.paths.clone(),
            config.generation.clone(),
            &config.environments,
            config.service_dependencies.clone(),
            Arc::clone(&config.shutdown),
        ) {
            Ok(dispatch) => dispatch,
            Err(error) => {
                failures.push(error);
                config.shutdown.request_shutdown();
                break;
            }
        };
        match dispatch {
            DispatchOneOutcome::Spawned(lane) => {
                lanes.push(lane);
                continue;
            }
            DispatchOneOutcome::Handled => continue,
            DispatchOneOutcome::Idle => {}
        }

        match admit_one(
            config.mode,
            &config.registry,
            &config.store,
            &config.paths,
            &lanes,
        ) {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => {
                failures.push(error.into());
                config.shutdown.request_shutdown();
                break;
            }
        }

        if failures.is_empty() {
            config
                .shutdown
                .wait_for_dispatch_tick(DISPATCH_POLL_INTERVAL);
        }
    }

    failures.extend(join_worker_lanes(lanes));
    match DispatchLoopFailure::from_errors(failures) {
        Some(failure) => Err(failure),
        None => Ok(()),
    }
}

fn admit_one(
    mode: RuntimeMode,
    registry: &Registry,
    store: &JobStore,
    paths: &RuntimePaths,
    active_lanes: &[ActiveWorkerLane],
) -> Result<bool, WorkerDispatcherError> {
    let candidates = store
        .queued_admission_candidates(MAX_DISPATCH_CANDIDATES)
        .map_err(WorkerDispatcherError::Store)?;
    let mut selected = None;
    for candidate in candidates {
        let admission = registry
            .admission_for_job_type(candidate.job_type())
            .map_err(WorkerDispatcherError::Registry)?;
        if definition_has_capacity(
            active_lanes.iter().map(|lane| lane.definition_key.as_str()),
            admission.definition_key(),
            admission.maximum_concurrency(),
        ) {
            selected = Some((candidate, admission));
            break;
        }
    }
    let Some((candidate, admission)) = selected else {
        return Ok(false);
    };
    let result = AdmissionGovernor::for_runtime_mode(store, mode)
        .try_admit_job(candidate.job_id(), &admission)
        .map_err(WorkerDispatcherError::Store)?;
    if matches!(result, JobAdmissionResult::Denied(ref denial) if !denial.retryable) {
        store
            .cleanup_unstarted_terminal_job_inputs(paths, candidate.job_id())
            .map_err(WorkerDispatcherError::Store)?;
    }
    Ok(true)
}

fn definition_has_capacity<'a>(
    active_definition_keys: impl Iterator<Item = &'a str>,
    definition_key: &str,
    maximum_concurrency: u32,
) -> bool {
    active_definition_keys
        .filter(|active| *active == definition_key)
        .take(maximum_concurrency as usize)
        .count()
        < maximum_concurrency as usize
}

struct ActiveWorkerLane {
    definition_key: String,
    thread: JoinHandle<Result<(), DispatchLoopError>>,
}

struct WorkerDriveTask {
    process: ClaimedWorkerProcess,
    store: Arc<JobStore>,
    paths: RuntimePaths,
    definition: WorkerDefinition,
    service_dependencies: WorkerServiceDependencyControl,
    dependency_leases: Vec<WorkerServiceDependencyLease>,
}

struct StandbyWorkerLane {
    sender: mpsc::SyncSender<WorkerDriveTask>,
    lane: ActiveWorkerLane,
}

enum DispatchOneOutcome {
    Idle,
    Handled,
    Spawned(ActiveWorkerLane),
}

fn dispatch_one(
    registry: &Registry,
    store: Arc<JobStore>,
    paths: RuntimePaths,
    generation: CurrentGenerationMembership,
    environments: &TrustedWorkerEnvironmentSet,
    service_dependencies: WorkerServiceDependencyControl,
    shutdown: Arc<ShutdownCoordinator>,
) -> Result<DispatchOneOutcome, DispatchLoopError> {
    let mut candidates = store
        .dispatch_candidates(1)
        .map_err(WorkerDispatcherError::Store)?;
    let Some(candidate) = candidates.pop() else {
        return Ok(DispatchOneOutcome::Idle);
    };

    let definition = registry
        .worker(candidate.worker_kind())
        .map_err(WorkerDispatcherError::Registry)?
        .clone();
    let worker_instance_id = fresh_worker_instance_id()?;
    let required_services = registry
        .required_service_dependency_admissions_for_job(
            &store,
            candidate.job_id(),
            candidate.worker_kind(),
        )
        .map_err(WorkerDispatcherError::Registry)?;
    let mut dependency_leases = Vec::with_capacity(required_services.len());
    for dependency in required_services.into_iter().filter(|dependency| {
        environments.should_acquire_service_dependency(dependency.service_id())
    }) {
        match service_dependencies.acquire(dependency, &worker_instance_id) {
            Ok(lease) => dependency_leases.push(lease),
            Err(WorkerServiceDependencyAcquireError::OwnerLost) => {
                release_worker_dependencies(&service_dependencies, dependency_leases)?;
                return Ok(DispatchOneOutcome::Handled);
            }
            Err(WorkerServiceDependencyAcquireError::Control(error)) => {
                release_worker_dependencies(&service_dependencies, dependency_leases)?;
                // A memory denial keeps its headroom numbers on the job so the
                // dashboard can say what was missing instead of only that the
                // job failed; every other refusal is a plain unavailable verdict.
                let failure = match error {
                    RuntimeServiceControlError::ResourceExhausted {
                        required_headroom_mb,
                        available_headroom_mb,
                    } => WorkerServiceDependencyFailure::ResourceExhausted {
                        required_headroom_mb,
                        available_headroom_mb,
                    },
                    _ => WorkerServiceDependencyFailure::Unavailable,
                };
                let disposition = store
                    .worker_service_dependency_unavailable_before_assignment(
                        candidate.job_id(),
                        failure,
                    )
                    .map_err(WorkerDispatcherError::Store)?;
                if matches!(
                    disposition,
                    WorkerServiceDependencyFailureDisposition::Finalized(_)
                ) {
                    store
                        .cleanup_unstarted_terminal_job_inputs(&paths, candidate.job_id())
                        .map_err(WorkerDispatcherError::Store)?;
                }
                return Ok(DispatchOneOutcome::Handled);
            }
        }
    }
    let environment = environments.prepare_for_source(definition.environment_source);
    let request = match registry.prepare_worker_launch(&paths, &definition.kind, environment) {
        Ok(request) => request,
        Err(error) => {
            // No claim or process identity exists yet, so the attempt-zero
            // finalizer is the exact safe authority for releasing this hold.
            store
                .worker_start_failed_before_assignment(candidate.job_id(), false)
                .map_err(WorkerDispatcherError::Store)?;
            store
                .cleanup_unstarted_terminal_job_inputs(&paths, candidate.job_id())
                .map_err(WorkerDispatcherError::Store)?;
            release_worker_dependencies(&service_dependencies, dependency_leases)?;
            return Err(WorkerDispatcherError::Registry(error).into());
        }
    };
    let standby = match start_standby_worker_lane(&definition.kind, Arc::clone(&shutdown)) {
        Ok(standby) => standby,
        Err(error) => {
            release_worker_dependencies(&service_dependencies, dependency_leases)?;
            return Err(error.into());
        }
    };
    // Claim and CreateProcess are one shutdown-linearized boundary. Trusted
    // pins are prepared above without process authority; once shutdown closes
    // this gate, no new attempt can be claimed and no new OS process can begin.
    let launch: Option<Result<Option<WorkerLaunchOutcome>, WorkerDispatcherError>> = shutdown
        .with_worker_launch_gate(|| {
            let claim = match store
                .try_claim_admitted_worker(candidate.job_id(), &worker_instance_id)
                .map_err(WorkerDispatcherError::Store)?
            {
                WorkerClaimOutcome::Claimed(claim) => claim,
                WorkerClaimOutcome::NotClaimable => return Ok(None),
            };
            Ok(Some(store.launch_claimed_worker(
                claim,
                &generation,
                request,
            )))
        });
    let Some(launch) = launch else {
        cancel_standby_worker_lane(standby);
        release_worker_dependencies(&service_dependencies, dependency_leases)?;
        return Ok(DispatchOneOutcome::Idle);
    };
    let launch = match launch {
        Ok(launch) => launch,
        Err(error) => {
            cancel_standby_worker_lane(standby);
            release_worker_dependencies(&service_dependencies, dependency_leases)?;
            return Err(error.into());
        }
    };
    let Some(launch) = launch else {
        cancel_standby_worker_lane(standby);
        release_worker_dependencies(&service_dependencies, dependency_leases)?;
        return Ok(DispatchOneOutcome::Handled);
    };

    match launch {
        WorkerLaunchOutcome::NotCreated(authority) => {
            cancel_standby_worker_lane(standby);
            match store.finish_worker_not_created(authority) {
                Ok((_job, cleanup)) => {
                    if store
                        .cleanup_job_inputs_after_worker_not_created(&paths, &cleanup)
                        .is_err()
                    {
                        Err(DispatchLoopError::Authority(
                            FatalDispatchAuthority::NotCreatedCleanup(Box::new(cleanup)),
                        ))
                    } else {
                        release_worker_dependencies(&service_dependencies, dependency_leases)?;
                        Ok(DispatchOneOutcome::Handled)
                    }
                }
                Err(error) => {
                    let (authority, _source) = error.into_parts();
                    Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::NotCreated(Box::new(authority)),
                    ))
                }
            }
        }
        WorkerLaunchOutcome::Uncertain(mut authority) => {
            cancel_standby_worker_lane(standby);
            // No release is persisted: the launch may have crossed
            // CreateProcess. Returning the authority places it inside the
            // completed JoinHandle while the thread requests host shutdown.
            authority.request_runtime_shutdown();
            Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::Uncertain(Box::new(authority)),
            ))
        }
        WorkerLaunchOutcome::Running(process) => {
            let task = WorkerDriveTask {
                process,
                store,
                paths,
                definition,
                service_dependencies,
                dependency_leases,
            };
            match standby.sender.send(task) {
                Ok(()) => Ok(DispatchOneOutcome::Spawned(standby.lane)),
                Err(error) => {
                    let task = error.0;
                    let _ = standby.lane.thread.join();
                    Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::Claimed(Box::new(task.process)),
                    ))
                }
            }
        }
    }
}

fn start_standby_worker_lane(
    definition_key: &str,
    shutdown: Arc<ShutdownCoordinator>,
) -> Result<StandbyWorkerLane, WorkerDispatcherError> {
    let (sender, receiver) = mpsc::sync_channel::<WorkerDriveTask>(1);
    let thread = thread::Builder::new()
        .name("runtime-worker-owner".into())
        .spawn(move || {
            let Ok(task) = receiver.recv() else {
                return Ok(());
            };
            let WorkerDriveTask {
                process,
                store,
                paths,
                definition,
                service_dependencies,
                dependency_leases,
            } = task;
            let result = drive_claimed_process(process, &store, &paths, &definition, &shutdown);
            let result = match result {
                Ok(()) => release_worker_dependencies(&service_dependencies, dependency_leases)
                    .map_err(DispatchLoopError::from),
                Err(error) => Err(error),
            };
            if result.is_err() {
                shutdown.request_shutdown();
            }
            result
        })
        .map_err(WorkerDispatcherError::ThreadStart)?;
    Ok(StandbyWorkerLane {
        sender,
        lane: ActiveWorkerLane {
            definition_key: definition_key.to_owned(),
            thread,
        },
    })
}

fn cancel_standby_worker_lane(standby: StandbyWorkerLane) {
    drop(standby.sender);
    let _ = standby.lane.thread.join();
}

fn reap_finished_worker_lanes(lanes: &mut Vec<ActiveWorkerLane>) -> Vec<DispatchLoopError> {
    let mut failures = Vec::new();
    let mut index = 0;
    while index < lanes.len() {
        if lanes[index].thread.is_finished() {
            let lane = lanes.swap_remove(index);
            match lane.thread.join() {
                Ok(Ok(())) => {}
                Ok(Err(error)) => failures.push(error),
                Err(_) => failures.push(WorkerDispatcherError::ThreadPanicked.into()),
            }
        } else {
            index += 1;
        }
    }
    failures
}

fn join_worker_lanes(lanes: Vec<ActiveWorkerLane>) -> Vec<DispatchLoopError> {
    let mut failures = Vec::new();
    for lane in lanes {
        match lane.thread.join() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => failures.push(error),
            Err(_) => failures.push(WorkerDispatcherError::ThreadPanicked.into()),
        }
    }
    failures
}

fn release_worker_dependencies(
    control: &WorkerServiceDependencyControl,
    leases: Vec<WorkerServiceDependencyLease>,
) -> Result<(), WorkerDispatcherError> {
    let mut failed = false;
    for lease in leases.into_iter().rev() {
        let _service_id = lease.service_id();
        if control.release(lease).is_err() {
            failed = true;
        }
    }
    if failed {
        Err(WorkerDispatcherError::ServiceDependencyControl)
    } else {
        Ok(())
    }
}

fn fresh_worker_instance_id() -> Result<String, WorkerDispatcherError> {
    let mut random = [0_u8; WORKER_INSTANCE_RANDOM_BYTES];
    getrandom::getrandom(&mut random).map_err(|_| WorkerDispatcherError::IdentityGeneration)?;
    let mut identity = String::with_capacity("worker_".len() + random.len() * 2);
    identity.push_str("worker_");
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in random {
        identity.push(char::from(HEX[usize::from(byte >> 4)]));
        identity.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    random.fill(0);
    Ok(identity)
}

struct AttemptRuntime {
    _launched_at: Instant,
    ready_deadline: Instant,
    maximum_deadline: Instant,
    heartbeat_timeout: Duration,
    last_activity: Instant,
    ready: bool,
    failed_event_persisted: bool,
    terminal_event_deadline: Option<Instant>,
    stop: Option<StopProgress>,
}

impl AttemptRuntime {
    fn new(definition: &WorkerDefinition) -> Result<Self, WorkerDispatcherError> {
        let launched_at = Instant::now();
        let ready_timeout = Duration::from_millis(definition.ready_timeout_ms);
        let maximum_runtime = Duration::from_millis(definition.maximum_runtime_ms);
        let ready_deadline = launched_at
            .checked_add(ready_timeout)
            .ok_or(WorkerDispatcherError::InvalidWorkerLimits)?;
        let maximum_deadline = launched_at
            .checked_add(maximum_runtime)
            .ok_or(WorkerDispatcherError::InvalidWorkerLimits)?;
        Ok(Self {
            _launched_at: launched_at,
            ready_deadline,
            maximum_deadline,
            heartbeat_timeout: Duration::from_millis(definition.heartbeat_timeout_ms),
            last_activity: launched_at,
            ready: false,
            failed_event_persisted: false,
            terminal_event_deadline: None,
            stop: None,
        })
    }

    fn observe_worker_event(&mut self, event: &WorkerEvent) {
        let now = Instant::now();
        self.last_activity = now;
        match event {
            WorkerEvent::Ready { .. } => self.ready = true,
            WorkerEvent::Complete { .. } | WorkerEvent::Failed { .. } => {
                if matches!(event, WorkerEvent::Failed { .. }) {
                    self.failed_event_persisted = true;
                }
                self.terminal_event_deadline = now.checked_add(POST_TERMINAL_EXIT_GRACE);
            }
            _ => {}
        }
    }

    fn automatic_stop_reason(&self, now: Instant) -> Option<StopReason> {
        if now >= self.maximum_deadline {
            return Some(StopReason::MaximumRuntime);
        }
        if let Some(deadline) = self.terminal_event_deadline {
            return (now >= deadline).then_some(StopReason::TerminalExitTimeout);
        }
        if !self.ready && now >= self.ready_deadline {
            return Some(StopReason::ReadyTimeout);
        }
        if self.ready && now.duration_since(self.last_activity) >= self.heartbeat_timeout {
            return Some(StopReason::HeartbeatTimeout);
        }
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StopReason {
    RuntimeShutdown,
    Cancellation,
    ReadyTimeout,
    HeartbeatTimeout,
    MaximumRuntime,
    TerminalExitTimeout,
    WorkerProtocolFault,
}

struct StopProgress {
    _reason: StopReason,
    force_sent: bool,
    deadline: Instant,
}

trait DispatchProcessControl {
    fn request_dispatch_stop(&mut self, force: bool) -> Result<(), ProcessOwnerError>;
    fn dispatch_stop_wait(&self, force: bool) -> Result<Duration, ProcessOwnerError>;
}

impl DispatchProcessControl for ClaimedWorkerProcess {
    fn request_dispatch_stop(&mut self, force: bool) -> Result<(), ProcessOwnerError> {
        self.request_stop(force)
    }

    fn dispatch_stop_wait(&self, force: bool) -> Result<Duration, ProcessOwnerError> {
        self.stop_terminal_wait_timeout(force)
    }
}

impl DispatchProcessControl for ResidentWorkerProcess {
    fn request_dispatch_stop(&mut self, force: bool) -> Result<(), ProcessOwnerError> {
        self.request_stop(force)
    }

    fn dispatch_stop_wait(&self, force: bool) -> Result<Duration, ProcessOwnerError> {
        self.stop_terminal_wait_timeout(force)
    }
}

fn begin_stop<P: DispatchProcessControl>(
    process: &mut P,
    runtime: &mut AttemptRuntime,
    reason: StopReason,
) -> Result<(), WorkerDispatcherError> {
    if runtime.stop.is_some() {
        return Ok(());
    }
    process
        .request_dispatch_stop(false)
        .map_err(WorkerDispatcherError::Process)?;
    let timeout = process
        .dispatch_stop_wait(false)
        .map_err(WorkerDispatcherError::Process)?;
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(WorkerDispatcherError::InvalidWorkerLimits)?;
    runtime.stop = Some(StopProgress {
        _reason: reason,
        force_sent: false,
        deadline,
    });
    Ok(())
}

fn advance_stop<P: DispatchProcessControl>(
    process: &mut P,
    runtime: &mut AttemptRuntime,
) -> Result<(), WorkerDispatcherError> {
    let Some(stop) = runtime.stop.as_mut() else {
        return Ok(());
    };
    if Instant::now() < stop.deadline {
        return Ok(());
    }
    if stop.force_sent {
        return Err(WorkerDispatcherError::ForcedCleanupTimeout);
    }
    process
        .request_dispatch_stop(true)
        .map_err(WorkerDispatcherError::Process)?;
    let timeout = process
        .dispatch_stop_wait(true)
        .map_err(WorkerDispatcherError::Process)?;
    stop.force_sent = true;
    stop.deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(WorkerDispatcherError::InvalidWorkerLimits)?;
    Ok(())
}

fn drive_claimed_process(
    mut process: ClaimedWorkerProcess,
    store: &JobStore,
    paths: &RuntimePaths,
    definition: &WorkerDefinition,
    shutdown: &ShutdownCoordinator,
) -> Result<(), DispatchLoopError> {
    let identity = process.identity().clone();
    let mut runtime = match AttemptRuntime::new(definition) {
        Ok(runtime) => runtime,
        Err(_) => {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::Claimed(Box::new(process)),
            ))
        }
    };
    loop {
        if apply_stop_policy(&mut process, &mut runtime, store, &identity, shutdown).is_err() {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::Claimed(Box::new(process)),
            ));
        }
        match process.read_event(DISPATCH_POLL_INTERVAL) {
            Ok(ProcessOwnerEvent::Lifecycle(_)) if process.root_pid().is_some() => {
                let residency = match process.into_residency() {
                    Ok(residency) => residency,
                    Err(error) => {
                        let (process, _source) = error.into_parts();
                        return Err(DispatchLoopError::Authority(
                            FatalDispatchAuthority::Claimed(Box::new(process)),
                        ));
                    }
                };
                let resident = match store.settle_worker_residency(residency) {
                    Ok(resident) => resident,
                    Err(error) => {
                        let (authority, _source) = error.into_parts();
                        return Err(DispatchLoopError::Authority(
                            FatalDispatchAuthority::Residency(Box::new(authority)),
                        ));
                    }
                };
                return drive_resident_process(
                    resident,
                    store,
                    paths,
                    &identity,
                    &mut runtime,
                    shutdown,
                );
            }
            Ok(ProcessOwnerEvent::Lifecycle(_)) => {}
            Ok(ProcessOwnerEvent::Terminal(terminal)) => {
                let exit = match process.confirm_exit(&terminal) {
                    Ok(exit) => exit,
                    Err(error) => {
                        let (process, _source) = error.into_parts();
                        return Err(DispatchLoopError::Authority(
                            FatalDispatchAuthority::Claimed(Box::new(process)),
                        ));
                    }
                };
                return match store.finish_worker_before_started(exit) {
                    Ok((_job, tree_exit)) => cleanup_terminal_job_inputs(store, paths, tree_exit),
                    Err(error) => {
                        let (authority, _source) = error.into_parts();
                        Err(DispatchLoopError::Authority(
                            FatalDispatchAuthority::BeforeStarted(Box::new(authority)),
                        ))
                    }
                };
            }
            Ok(ProcessOwnerEvent::Worker(_)) => {
                // The process owner normally serializes `started` before any
                // target stream data. If that boundary is ever contradicted,
                // poison completion authority, stop the coupled claim/tree,
                // and continue draining; never return and implicitly drop
                // live authority.
                if process.reject_current_worker_event().is_err()
                    || begin_stop(&mut process, &mut runtime, StopReason::WorkerProtocolFault)
                        .is_err()
                {
                    return Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::Claimed(Box::new(process)),
                    ));
                }
            }
            Ok(ProcessOwnerEvent::WorkerProtocolFault(_)) => {
                if begin_stop(&mut process, &mut runtime, StopReason::WorkerProtocolFault).is_err()
                {
                    return Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::Claimed(Box::new(process)),
                    ));
                }
            }
            Err(ProcessOwnerError::EventWaitTimeout) => {}
            Err(_) => {
                return Err(DispatchLoopError::Authority(
                    FatalDispatchAuthority::Claimed(Box::new(process)),
                ))
            }
        }
    }
}

fn drive_resident_process(
    mut process: ResidentWorkerProcess,
    store: &JobStore,
    paths: &RuntimePaths,
    identity: &WorkerIdentity,
    runtime: &mut AttemptRuntime,
    shutdown: &ShutdownCoordinator,
) -> Result<(), DispatchLoopError> {
    loop {
        if apply_stop_policy(&mut process, runtime, store, identity, shutdown).is_err() {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::Resident(Box::new(process)),
            ));
        }
        match process.read_event(DISPATCH_POLL_INTERVAL) {
            Ok(ProcessOwnerEvent::Lifecycle(_)) => {}
            Ok(ProcessOwnerEvent::Worker(event)) => {
                match store.apply_owned_worker_event(&event) {
                    Ok(_) => runtime.observe_worker_event(event.event()),
                    Err(error) if error.is_deterministic_worker_event_rejection() => {
                        // The durable write was deterministically rejected, so
                        // poison this exact owner's stream before stopping it.
                        // Its eventual tree-exit receipt can then never mint
                        // completion authority, while unrelated jobs remain
                        // available in this generation.
                        if process.reject_current_worker_event().is_err()
                            || begin_stop(&mut process, runtime, StopReason::WorkerProtocolFault)
                                .is_err()
                        {
                            return Err(DispatchLoopError::Authority(
                                FatalDispatchAuthority::Resident(Box::new(process)),
                            ));
                        }
                    }
                    Err(_) => {
                        // Database/fence/invariant ambiguity retains both the
                        // exact live process owner and the parsed event.
                        // The generation now exits instead of reading ahead or
                        // guessing whether persistence committed.
                        return Err(DispatchLoopError::Authority(
                            FatalDispatchAuthority::PendingWorkerEvent {
                                process: Box::new(process),
                                event: Box::new(event),
                            },
                        ));
                    }
                }
            }
            Ok(ProcessOwnerEvent::WorkerProtocolFault(_)) => {
                if begin_stop(&mut process, runtime, StopReason::WorkerProtocolFault).is_err() {
                    return Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::Resident(Box::new(process)),
                    ));
                }
            }
            Ok(ProcessOwnerEvent::Terminal(terminal)) => {
                let tree_exit = match process.confirm_exit(&terminal) {
                    Ok(tree_exit) => tree_exit,
                    Err(error) => {
                        let (process, _source) = error.into_parts();
                        return Err(DispatchLoopError::Authority(
                            FatalDispatchAuthority::Resident(Box::new(process)),
                        ));
                    }
                };
                return finish_resident_attempt(
                    store,
                    paths,
                    identity,
                    tree_exit,
                    runtime.failed_event_persisted,
                );
            }
            Err(ProcessOwnerError::EventWaitTimeout) => {}
            Err(_) => {
                return Err(DispatchLoopError::Authority(
                    FatalDispatchAuthority::Resident(Box::new(process)),
                ))
            }
        }
    }
}

fn apply_stop_policy<P: DispatchProcessControl>(
    process: &mut P,
    runtime: &mut AttemptRuntime,
    store: &JobStore,
    identity: &WorkerIdentity,
    shutdown: &ShutdownCoordinator,
) -> Result<(), WorkerDispatcherError> {
    if runtime.stop.is_none() {
        let snapshot = store
            .worker_dispatch_snapshot(identity)
            .map_err(WorkerDispatcherError::Store)?;
        let reason = if shutdown.is_requested() {
            Some(StopReason::RuntimeShutdown)
        } else if snapshot.cancellation_requested() {
            Some(StopReason::Cancellation)
        } else {
            runtime.automatic_stop_reason(Instant::now())
        };
        if let Some(reason) = reason {
            begin_stop(process, runtime, reason)?;
        }
    }
    advance_stop(process, runtime)
}

fn finish_resident_attempt(
    store: &JobStore,
    paths: &RuntimePaths,
    identity: &WorkerIdentity,
    tree_exit: ProcessTreeExit,
    failed_event_persisted: bool,
) -> Result<(), DispatchLoopError> {
    let snapshot = match store.worker_dispatch_snapshot(identity) {
        Ok(snapshot) => snapshot,
        Err(_) => {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::TreeExit(Box::new(tree_exit)),
            ))
        }
    };
    if snapshot.cancellation_requested() {
        if store.confirm_cancelled(&tree_exit).is_err() {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::TreeExit(Box::new(tree_exit)),
            ));
        }
        return cleanup_terminal_job_inputs(store, paths, tree_exit);
    }
    if failed_event_persisted {
        if store
            .finalize_reported_worker_failure_after_tree_exit(&tree_exit)
            .is_err()
        {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::TreeExit(Box::new(tree_exit)),
            ));
        }
        return cleanup_terminal_job_inputs(store, paths, tree_exit);
    }

    let completion_intent = match store.worker_completion_intent(identity) {
        Ok(intent) => intent,
        Err(_) => {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::TreeExit(Box::new(tree_exit)),
            ))
        }
    };
    let Some(intent) = completion_intent else {
        if store.worker_exited_without_terminal(&tree_exit).is_err() {
            return Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::TreeExit(Box::new(tree_exit)),
            ));
        }
        return cleanup_terminal_job_inputs(store, paths, tree_exit);
    };

    match tree_exit.into_completion_authority() {
        Ok(owner) => match owner.prove_completion_after_tree_exit(paths, &intent) {
            Ok(proof) => {
                if store.confirm_worker_completion(&proof).is_err() {
                    Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::Completion {
                            owner: Box::new(owner),
                            proof: Box::new(proof),
                        },
                    ))
                } else {
                    let release = owner.into_zero_resident_release();
                    cleanup_terminal_job_inputs(store, paths, release)
                }
            }
            Err(_) => {
                let release = owner.into_zero_resident_release();
                if store
                    .reject_worker_completion_after_tree_exit(&release)
                    .is_err()
                {
                    Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::TreeExit(Box::new(release)),
                    ))
                } else {
                    cleanup_terminal_job_inputs(store, paths, release)
                }
            }
        },
        Err(release) => {
            if store
                .reject_worker_completion_after_tree_exit(&release)
                .is_err()
            {
                Err(DispatchLoopError::Authority(
                    FatalDispatchAuthority::TreeExit(release),
                ))
            } else {
                cleanup_terminal_job_inputs(store, paths, *release)
            }
        }
    }
}

fn cleanup_terminal_job_inputs(
    store: &JobStore,
    paths: &RuntimePaths,
    tree_exit: ProcessTreeExit,
) -> Result<(), DispatchLoopError> {
    if store
        .cleanup_job_inputs_after_worker_exit(paths, &tree_exit)
        .is_err()
    {
        Err(DispatchLoopError::Authority(
            FatalDispatchAuthority::TreeExit(Box::new(tree_exit)),
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capacity_is_per_definition_instead_of_global() {
        let active = ["learn-node", "background-task-node"];
        assert!(!definition_has_capacity(
            active.iter().copied(),
            "learn-node",
            1
        ));
        assert!(definition_has_capacity(
            active.iter().copied(),
            "outer-max-research-node",
            1
        ));
        assert!(definition_has_capacity(
            active.iter().copied(),
            "background-task-node",
            2
        ));
    }

    #[test]
    fn finished_owner_lane_is_reaped_without_joining_a_live_peer() {
        let finished = ActiveWorkerLane {
            definition_key: "finished-node".into(),
            thread: thread::spawn(|| Ok(())),
        };
        let (release_tx, release_rx) = mpsc::sync_channel(0);
        let live = ActiveWorkerLane {
            definition_key: "live-node".into(),
            thread: thread::spawn(move || {
                release_rx.recv().unwrap();
                Ok(())
            }),
        };
        while !finished.thread.is_finished() {
            thread::yield_now();
        }
        let mut lanes = vec![finished, live];
        assert!(reap_finished_worker_lanes(&mut lanes).is_empty());
        assert_eq!(lanes.len(), 1);
        assert_eq!(lanes[0].definition_key, "live-node");
        release_tx.send(()).unwrap();
        assert!(join_worker_lanes(lanes).is_empty());
    }

    #[test]
    fn worker_instance_ids_are_fresh_bounded_protocol_identifiers() {
        let first = fresh_worker_instance_id().unwrap();
        let second = fresh_worker_instance_id().unwrap();
        assert_ne!(first, second);
        assert_eq!(
            first.len(),
            "worker_".len() + WORKER_INSTANCE_RANDOM_BYTES * 2
        );
        assert!(first.starts_with("worker_"));
        assert!(first
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'));
    }

    #[test]
    fn ready_heartbeat_runtime_and_terminal_exit_deadlines_are_distinct() {
        let definition = WorkerDefinition {
            kind: "deadline-worker".into(),
            job_types: vec!["deadline-job".into()],
            capability_ids: vec!["test:deadline".into()],
            submission_authority: breadboard_runtime_protocol::WorkerSubmissionAuthority::User,
            environment_source:
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Minimal,
            service_dependencies: Vec::new(),
            allowed_executable: "bin/worker.exe".into(),
            allowed_entrypoint: "workers/deadline.mjs".into(),
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
            resource_class: breadboard_runtime_protocol::ResourceClass::Core,
            estimated_cold_start_commit_mb: 1,
            soft_commit_limit_mb: 2,
            hard_commit_limit_mb: 3,
            maximum_concurrency: 1,
            minimum_input_blobs: 0,
            maximum_input_blobs: 0,
            workspace_policy: breadboard_runtime_protocol::WorkspacePolicy::PrivatePerJob,
            ready_timeout_ms: 100,
            heartbeat_timeout_ms: 200,
            graceful_cancellation_ms: 100,
            maximum_runtime_ms: 10_000,
            exit_after_job: true,
        };
        let mut runtime = AttemptRuntime::new(&definition).unwrap();
        assert_eq!(
            runtime.automatic_stop_reason(runtime.ready_deadline),
            Some(StopReason::ReadyTimeout)
        );
        runtime.ready = true;
        assert_eq!(
            runtime.automatic_stop_reason(runtime.last_activity + runtime.heartbeat_timeout),
            Some(StopReason::HeartbeatTimeout)
        );
        runtime.terminal_event_deadline =
            runtime.last_activity.checked_add(POST_TERMINAL_EXIT_GRACE);
        assert_eq!(
            runtime.automatic_stop_reason(runtime.terminal_event_deadline.unwrap()),
            Some(StopReason::TerminalExitTimeout)
        );
        assert_eq!(
            runtime.automatic_stop_reason(runtime.maximum_deadline),
            Some(StopReason::MaximumRuntime)
        );
        assert_eq!(runtime._launched_at, runtime.last_activity);
    }
}
