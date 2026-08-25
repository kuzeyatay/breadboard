use crate::shutdown::ShutdownCoordinator;
use breadboard_runtime_core::{
    AdmissionGovernor, ClaimedWorkerProcess, CurrentGenerationMembership, JobStore,
    OwnedWorkerEvent, ProcessOwnerError, ProcessOwnerEvent, ProcessTreeExit, Registry,
    RegistryError, ResidentWorkerProcess, RuntimePaths, StoreError, WorkerClaimOutcome,
    WorkerLaunchNotCreated, WorkerLaunchOutcome, WorkerLaunchUncertain, WorkerResidencyAuthority,
    WorkerTreeExitAuthority,
};
use breadboard_runtime_protocol::{WorkerDefinition, WorkerEvent, WorkerIdentity};
use std::io;
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use thiserror::Error;

const DISPATCH_POLL_INTERVAL: Duration = Duration::from_millis(100);
const POST_TERMINAL_EXIT_GRACE: Duration = Duration::from_secs(2);
const WORKER_INSTANCE_RANDOM_BYTES: usize = 16;

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
}

/// One native scheduler thread owns FIFO admission, one live disposable worker
/// at a time, and every authority transition for that worker. The deliberate
/// single-live-worker first slice is stricter than manifest concurrency and is
/// consistent with the global one-heavyweight policy; it can be generalized
/// later without creating a second dispatcher or durable ledger.
pub(crate) struct WorkerDispatcher {
    shutdown: Arc<ShutdownCoordinator>,
    // A completed JoinHandle retains its return value until join. In the
    // uncertain-launch case that return value owns the opaque child+claim
    // authority, keeping both fenced until the host is already in its shutdown
    // epilogue and the process is committed to exit (the generation Job is
    // deliberately process-lifetime and closes only at process termination).
    thread: Option<JoinHandle<Result<(), DispatchLoopError>>>,
    retained_authority: Option<FatalDispatchAuthority>,
}

enum DispatchLoopError {
    Fatal(WorkerDispatcherError),
    Authority(FatalDispatchAuthority),
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
    Residency(Box<WorkerResidencyAuthority>),
    BeforeStarted(Box<WorkerTreeExitAuthority>),
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
            Self::Residency(authority) => {
                let _ = authority.request_runtime_shutdown();
            }
            Self::BeforeStarted(authority) => {
                let _ = authority.identity();
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
    pub(crate) fn start(
        registry: Registry,
        store: Arc<JobStore>,
        paths: RuntimePaths,
        generation: CurrentGenerationMembership,
        shutdown: Arc<ShutdownCoordinator>,
    ) -> Result<Self, WorkerDispatcherError> {
        let dispatcher_shutdown = Arc::clone(&shutdown);
        let thread = thread::Builder::new()
            .name("runtime-worker-dispatcher".into())
            .spawn(move || {
                let result =
                    run_dispatch_loop(&registry, &store, &paths, &generation, &dispatcher_shutdown);
                if result.is_err() {
                    // Any authority or persistence ambiguity takes the whole
                    // generation out of service. Restart reconciliation, not a
                    // blind in-generation retry, classifies retained state.
                    dispatcher_shutdown.request_shutdown();
                }
                result
            })
            .map_err(WorkerDispatcherError::ThreadStart)?;
        Ok(Self {
            shutdown,
            thread: Some(thread),
            retained_authority: None,
        })
    }

    pub(crate) fn shutdown(&mut self) -> Result<(), WorkerDispatcherError> {
        self.shutdown.request_shutdown();
        self.join()
    }

    fn join(&mut self) -> Result<(), WorkerDispatcherError> {
        if self.retained_authority.is_some() {
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
            Err(DispatchLoopError::Fatal(error)) => Err(error),
            Err(DispatchLoopError::Authority(mut authority)) => {
                // Admission is already closed and the control listener is
                // leaving. Request cleanup without consuming any opaque value,
                // then retain it until `run_after_bootstrap` returns an error
                // and `main` terminates the process-lifetime generation.
                authority.request_generation_shutdown();
                let uncertain = matches!(&authority, FatalDispatchAuthority::Uncertain(_));
                self.retained_authority = Some(authority);
                Err(if uncertain {
                    WorkerDispatcherError::UncertainLaunch
                } else {
                    WorkerDispatcherError::AuthorityRetained
                })
            }
        }
    }
}

impl Drop for WorkerDispatcher {
    fn drop(&mut self) {
        self.shutdown.request_shutdown();
        // Every process-owner wait used by the dispatcher is bounded. A drop
        // during host error handling therefore still joins the sole owner and
        // runs the same authority-retention path instead of detaching it.
        let _ = self.join();
    }
}

fn run_dispatch_loop(
    registry: &Registry,
    store: &JobStore,
    paths: &RuntimePaths,
    generation: &CurrentGenerationMembership,
    shutdown: &ShutdownCoordinator,
) -> Result<(), DispatchLoopError> {
    while !shutdown.is_requested() {
        if !shutdown.is_accepting_work() {
            shutdown.wait_for_dispatch_tick(DISPATCH_POLL_INTERVAL);
            continue;
        }

        // Existing admitted work always precedes new reservation creation.
        // Querying a single row keeps this first single-owner slice bounded and
        // avoids building an in-memory queue that can drift from SQLite.
        if !dispatch_one(registry, store, paths, generation, shutdown)?
            && !admit_one(registry, store)?
        {
            shutdown.wait_for_dispatch_tick(DISPATCH_POLL_INTERVAL);
        }
    }
    Ok(())
}

fn admit_one(registry: &Registry, store: &JobStore) -> Result<bool, WorkerDispatcherError> {
    let mut candidates = store
        .queued_admission_candidates(1)
        .map_err(WorkerDispatcherError::Store)?;
    let Some(candidate) = candidates.pop() else {
        return Ok(false);
    };
    let admission = registry
        .admission_for_job_type(candidate.job_type())
        .map_err(WorkerDispatcherError::Registry)?;
    AdmissionGovernor::new(store)
        .try_admit_job(candidate.job_id(), &admission)
        .map_err(WorkerDispatcherError::Store)?;
    Ok(true)
}

fn dispatch_one(
    registry: &Registry,
    store: &JobStore,
    paths: &RuntimePaths,
    generation: &CurrentGenerationMembership,
    shutdown: &ShutdownCoordinator,
) -> Result<bool, DispatchLoopError> {
    let mut candidates = store
        .dispatch_candidates(1)
        .map_err(WorkerDispatcherError::Store)?;
    let Some(candidate) = candidates.pop() else {
        return Ok(false);
    };

    let definition = registry
        .worker(candidate.worker_kind())
        .map_err(WorkerDispatcherError::Registry)?
        .clone();
    let request = match registry.prepare_worker_launch(paths, &definition.kind) {
        Ok(request) => request,
        Err(error) => {
            // No claim or process identity exists yet, so the attempt-zero
            // finalizer is the exact safe authority for releasing this hold.
            store
                .worker_start_failed_before_assignment(candidate.job_id(), false)
                .map_err(WorkerDispatcherError::Store)?;
            return Err(WorkerDispatcherError::Registry(error).into());
        }
    };
    let worker_instance_id = fresh_worker_instance_id()?;
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
            Ok(Some(claim.launch(generation, request)))
        });
    let Some(launch) = launch else {
        return Ok(false);
    };
    let Some(launch) = launch? else {
        return Ok(true);
    };

    match launch {
        WorkerLaunchOutcome::NotCreated(authority) => {
            match store.finish_worker_not_created(authority) {
                Ok(_) => Ok(true),
                Err(error) => {
                    let (authority, _source) = error.into_parts();
                    Err(DispatchLoopError::Authority(
                        FatalDispatchAuthority::NotCreated(Box::new(authority)),
                    ))
                }
            }
        }
        WorkerLaunchOutcome::Uncertain(mut authority) => {
            // No release is persisted: the launch may have crossed
            // CreateProcess. Returning the authority places it inside the
            // completed JoinHandle while the thread requests host shutdown.
            authority.request_runtime_shutdown();
            Err(DispatchLoopError::Authority(
                FatalDispatchAuthority::Uncertain(Box::new(authority)),
            ))
        }
        WorkerLaunchOutcome::Running(process) => {
            drive_claimed_process(process, store, paths, &definition, shutdown)?;
            Ok(true)
        }
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
                    Ok(_) => Ok(()),
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
                        // only live process owner and the exact parsed event.
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
                )
                .map_err(DispatchLoopError::Fatal);
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
) -> Result<(), WorkerDispatcherError> {
    let snapshot = store
        .worker_dispatch_snapshot(identity)
        .map_err(WorkerDispatcherError::Store)?;
    if snapshot.cancellation_requested() {
        store
            .confirm_cancelled(&tree_exit)
            .map_err(WorkerDispatcherError::Store)?;
        return Ok(());
    }
    if failed_event_persisted {
        store
            .finalize_reported_worker_failure_after_tree_exit(&tree_exit)
            .map_err(WorkerDispatcherError::Store)?;
        return Ok(());
    }

    let completion_intent = store
        .worker_completion_intent(identity)
        .map_err(WorkerDispatcherError::Store)?;
    let Some(intent) = completion_intent else {
        store
            .worker_exited_without_terminal(&tree_exit)
            .map_err(WorkerDispatcherError::Store)?;
        return Ok(());
    };

    match tree_exit.into_completion_authority() {
        Ok(owner) => match owner.prove_completion_after_tree_exit(paths, &intent) {
            Ok(proof) => {
                // The process-owner authority remains alive across this
                // borrowed proof. If commit becomes uncertain, returning the
                // store error shuts down the generation instead of issuing a
                // second authoritative transition.
                store
                    .confirm_worker_completion(&proof)
                    .map_err(WorkerDispatcherError::Store)?;
                Ok(())
            }
            Err(_) => {
                let release = owner.into_zero_resident_release();
                store
                    .reject_worker_completion_after_tree_exit(&release)
                    .map_err(WorkerDispatcherError::Store)?;
                Ok(())
            }
        },
        Err(release) => {
            store
                .reject_worker_completion_after_tree_exit(&release)
                .map_err(WorkerDispatcherError::Store)?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            allowed_executable: "bin/worker.exe".into(),
            allowed_entrypoint: "workers/deadline.mjs".into(),
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
            resource_class: breadboard_runtime_protocol::ResourceClass::Core,
            estimated_cold_start_commit_mb: 1,
            soft_commit_limit_mb: 2,
            hard_commit_limit_mb: 3,
            maximum_concurrency: 1,
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
