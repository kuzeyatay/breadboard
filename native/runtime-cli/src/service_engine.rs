use crate::control::{RuntimeServiceControl, RuntimeServiceControlError};
use crate::shutdown::{AdmissionOpenError, ShutdownCoordinator};
use breadboard_runtime_core::{
    AdmissionGovernor, AuthenticatedJobContext, CurrentGenerationMembership,
    DashboardControlEnvironment, DurableServiceAcquireResult, DurableServiceAdmissionProfile,
    DurableServiceLeaseClaim, DurableServiceOutboxClaim, DurableServiceRegistration,
    DurableServiceRestartSchedule, DurableServiceRestartStatus, DurableServiceSnapshot,
    DurableServiceStartResult, DurableServiceStoreError, DurableWorkerServiceAcquireResult,
    JobRecord, JobStore, PathError, ProcessExitClassification, ProcessOwnerError,
    ProcessOwnerEvent, ProcessOwnerTerminal, Registry, RegistryError,
    RetainedServiceAuthorityPhase, RetainedServiceReadinessProgress, RetainedServiceStopProgress,
    RuntimePaths, RuntimeReconcileTrigger, RuntimeScheduleDesiredState, RuntimeScheduleKind,
    RuntimeScheduleOccurrence, RuntimeScheduleRegistration, RuntimeScheduleSnapshot,
    RuntimeSchedulerAuthority, ServiceAuxiliaryEndpoint, ServiceEndpointMap, ServiceLaunchRequest,
    ServiceLaunchRetentionDisposition, ServiceLeaseAction, ServiceLeaseClaimState,
    ServiceLeaseError, ServiceLeaseReleaseDisposition, ServiceLeaseReleaseReason, StoreError,
    TrustedDirectoryPin, TrustedOsEnvironment, TrustedOsEnvironmentCaptureError,
    TrustedServiceEnvironmentError, TrustedServiceEnvironmentSet, TrustedWorkerEnvironmentSet,
    WorkerServiceDependencyAdmission,
};
use breadboard_runtime_protocol::{
    JobState, JobSubmissionPayload, RestartPolicy, RuntimeDesiredState, RuntimeGatewayId,
    RuntimeGatewayReconcileResponse, RuntimeGatewayServiceState, RuntimeMode,
    RuntimeRecallReconcileRequest, RuntimeRecallReconcileResponse,
    RuntimeRecallReconcileServiceState, RuntimeRecallStatusResponse, RuntimeScheduleControlState,
    RuntimeScheduleReconcileResponse, RuntimeScheduleStatusResponse,
    RuntimeServiceLeaseAcquireResponse, RuntimeServiceLeaseContractResponse,
    RuntimeServiceLeaseReleaseResponse, RuntimeServiceRetryResponse, RuntimeServiceState,
    RuntimeServiceStatus, ServiceStartupPolicy, TrustedServiceEnvironmentSource, MAX_CONCURRENCY,
    MAX_MANIFEST_ENTRIES, MAX_RECALL_LOG_LINES, MAX_RECALL_LOG_TAIL_BYTES,
    RUNTIME_CONTROL_PROTOCOL_VERSION, SERVICE_LEASE_RESPONSE_GRACE_MS,
    SERVICE_LEASE_SETTLEMENT_GRACE_MS,
};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use thiserror::Error;

const COMMAND_CAPACITY: usize = 16;
const CONTROL_RESPONSE_TIMEOUT: Duration = Duration::from_secs(4 * 60);
const CONTROLLER_TICK: Duration = Duration::from_millis(100);
const SERVICE_TIMER_INTERVAL: Duration = Duration::from_secs(1);
const OUTBOX_CLAIM_TTL_MS: u64 = 30_000;
const MAX_INTENTS_PER_TICK: usize = MAX_MANIFEST_ENTRIES;
const MAX_HELD_LEASES: usize = MAX_MANIFEST_ENTRIES * MAX_CONCURRENCY as usize;
const MAX_RELEASE_TOMBSTONES: usize = 256;
const RELEASE_TOMBSTONE_TTL_MS: u64 = 10 * 60 * 1000;
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(60);
const FORCE_STOP_PADDING: Duration = Duration::from_secs(2);
const LEASE_ID_RANDOM_BYTES: usize = 16;
const MAX_IDENTITY_ATTEMPTS: usize = 8;
const MAX_SCHEDULE_ACTIONS_PER_TICK: usize = 8;
const MAX_BACKGROUND_RESULT_BYTES: usize = 128 * 1024;
const STARTUP_GATEWAY_RECONCILE_DELAY_MS: u64 = 8_000;

type AcquireReply = Result<RuntimeServiceLeaseAcquireResponse, RuntimeServiceControlError>;
type WorkerDependencyAcquireReply =
    Result<RuntimeServiceLeaseAcquireResponse, WorkerServiceDependencyAcquireError>;
type ReleaseReply = Result<RuntimeServiceLeaseReleaseResponse, RuntimeServiceControlError>;
type RetryReply = Result<RuntimeServiceRetryResponse, RuntimeServiceControlError>;
type GatewayReconcileReply = Result<RuntimeGatewayReconcileResponse, RuntimeServiceControlError>;
type ScheduleReconcileReply = Result<RuntimeScheduleReconcileResponse, RuntimeServiceControlError>;
type ScheduleStatusReply = Result<RuntimeScheduleStatusResponse, RuntimeServiceControlError>;
type RecallReconcileReply = Result<RuntimeRecallReconcileResponse, RuntimeServiceControlError>;
type RecallStatusReply = Result<RuntimeRecallStatusResponse, RuntimeServiceControlError>;
type ServiceKey = (String, u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ServiceAcquireTimeouts {
    pending: Duration,
    response: Duration,
}

fn service_acquire_timeouts(startup_ms: u64) -> ServiceAcquireTimeouts {
    ServiceAcquireTimeouts {
        pending: Duration::from_millis(startup_ms + SERVICE_LEASE_SETTLEMENT_GRACE_MS),
        response: Duration::from_millis(
            startup_ms + SERVICE_LEASE_SETTLEMENT_GRACE_MS + SERVICE_LEASE_RESPONSE_GRACE_MS,
        ),
    }
}

#[derive(Debug, Error)]
pub(crate) enum ServiceEngineError {
    #[error("allocating private service loopback endpoints failed: {0}")]
    EndpointAllocation(#[source] io::Error),
    #[error(transparent)]
    OsEnvironment(#[from] TrustedOsEnvironmentCaptureError),
    #[error(transparent)]
    Environment(#[from] TrustedServiceEnvironmentError),
    #[error(transparent)]
    Registry(#[from] RegistryError),
    #[error(transparent)]
    Store(#[from] DurableServiceStoreError),
    #[error(transparent)]
    JobStore(#[from] StoreError),
    #[error(transparent)]
    Path(#[from] PathError),
    #[error("generating a private service lease identity failed")]
    IdentityGeneration,
    #[error("required service {0} did not become ready")]
    RequiredServiceUnavailable(String),
    #[error("service bootstrap exceeded its bounded readiness deadline")]
    BootstrapTimeout,
    #[error("starting the service-controller thread failed: {0}")]
    ControllerThread(#[source] io::Error),
    #[error("the service controller stopped before accepting its authority handoff")]
    ControllerHandoff,
    #[error("the service controller violated a lifecycle invariant: {0}")]
    Invariant(&'static str),
    #[error("the service controller failed: {0}")]
    Controller(String),
}

/// Cloneable, internal-only command capability handed directly from the
/// prepared service engine to the finite-worker dispatcher. It is not part of
/// either HTTP control authority and accepts only service IDs already selected
/// by the trusted Registry.
#[derive(Clone)]
pub(crate) struct WorkerServiceDependencyControl {
    commands: SyncSender<ControllerCommand>,
    service_acquire_timeouts: Arc<BTreeMap<String, ServiceAcquireTimeouts>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkerServiceDependencyLease {
    lease_id: String,
    service_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WorkerServiceDependencyAcquireError {
    OwnerLost,
    Control(RuntimeServiceControlError),
}

impl WorkerServiceDependencyLease {
    pub(crate) fn service_id(&self) -> &str {
        &self.service_id
    }
}

impl WorkerServiceDependencyControl {
    pub(crate) fn acquire(
        &self,
        dependency: WorkerServiceDependencyAdmission,
        worker_instance_id: &str,
    ) -> Result<WorkerServiceDependencyLease, WorkerServiceDependencyAcquireError> {
        let service_id = dependency.service_id();
        let response_timeout = self
            .service_acquire_timeouts
            .get(service_id)
            .ok_or(WorkerServiceDependencyAcquireError::Control(
                RuntimeServiceControlError::NotFound,
            ))?
            .response;
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.commands
            .try_send(ControllerCommand::AcquireWorkerDependency {
                dependency,
                worker_instance_id: worker_instance_id.to_owned(),
                reply: reply_tx,
            })
            .map_err(|_| {
                WorkerServiceDependencyAcquireError::Control(
                    RuntimeServiceControlError::Unavailable,
                )
            })?;
        let acquired = reply_rx.recv_timeout(response_timeout).map_err(|_| {
            WorkerServiceDependencyAcquireError::Control(RuntimeServiceControlError::Unavailable)
        })??;
        Ok(WorkerServiceDependencyLease {
            lease_id: acquired.lease_id,
            service_id: acquired.service_id,
        })
    }

    pub(crate) fn release(
        &self,
        lease: WorkerServiceDependencyLease,
    ) -> Result<(), RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.commands
            .try_send(ControllerCommand::ReleaseWorkerDependency {
                lease_id: lease.lease_id,
                reply: reply_tx,
            })
            .map_err(|_| RuntimeServiceControlError::Unavailable)?;
        let _ = reply_rx
            .recv_timeout(CONTROL_RESPONSE_TIMEOUT)
            .map_err(|_| RuntimeServiceControlError::Unavailable)??;
        Ok(())
    }
}

/// Host-facing concrete engine state. The controller thread is the sole owner
/// of timers, durable lease claims, outbox execution, and service scheduling.
/// HTTP handlers can only submit bounded commands and await a bounded reply.
pub(crate) struct ServiceEngine {
    dashboard_url: String,
    statuses: Arc<RwLock<Vec<RuntimeServiceStatus>>>,
    required_startup_services: BTreeSet<String>,
    commands: SyncSender<ControllerCommand>,
    service_acquire_timeouts: Arc<BTreeMap<String, ServiceAcquireTimeouts>>,
    controller: Mutex<Option<JoinHandle<Result<(), String>>>>,
    worker_environments: Mutex<Option<TrustedWorkerEnvironmentSet>>,
    ready_published: Arc<AtomicBool>,
    shutdown: Arc<ShutdownCoordinator>,
}

impl ServiceEngine {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        mode: RuntimeMode,
        registry: &Registry,
        store: &Arc<JobStore>,
        paths: &RuntimePaths,
        config_root: &TrustedDirectoryPin,
        generation: CurrentGenerationMembership,
        dashboard_control: DashboardControlEnvironment,
        shutdown: Arc<ShutdownCoordinator>,
    ) -> Result<Self, ServiceEngineError> {
        let (endpoints, endpoint_reservations) = allocate_service_endpoints()?;
        let dashboard_url = format!(
            "http://127.0.0.1:{}",
            endpoints.port_for(TrustedServiceEnvironmentSource::Dashboard)
        );
        let os_environment = TrustedOsEnvironment::capture_electron_gated()?;
        let environments = TrustedServiceEnvironmentSet::load(
            mode,
            paths,
            config_root,
            &endpoints,
            dashboard_control,
            os_environment,
        )?;
        let worker_environments = TrustedWorkerEnvironmentSet::from_service_environments(
            mode,
            &environments,
            paths,
            os_environment,
        );
        let statuses = Arc::new(RwLock::new(Vec::new()));
        let ready_published = Arc::new(AtomicBool::new(false));
        let required_startup_services = required_startup_service_ids(registry)?;
        let service_acquire_timeouts = Arc::new(service_acquire_timeout_map(registry)?);
        let mut controller = ServiceController::new(
            mode,
            registry.clone(),
            Arc::clone(store),
            paths.clone(),
            generation,
            endpoints,
            endpoint_reservations,
            environments,
            required_startup_services.clone(),
            Arc::clone(&statuses),
            Arc::clone(&ready_published),
            Arc::clone(&shutdown),
        )?;
        if let Err(error) = controller.bootstrap() {
            shutdown.request_shutdown();
            let _ = controller.shutdown_bounded();
            return Err(error);
        }

        let (command_tx, command_rx) = mpsc::sync_channel(COMMAND_CAPACITY);
        // The controller itself is handed over only after the OS thread exists.
        // A thread-creation failure therefore leaves the full controller here,
        // where its already-started process trees can still be drained.
        let (handoff_tx, handoff_rx) = mpsc::sync_channel::<ServiceController>(0);
        let handle = match thread::Builder::new()
            .name("breadboard-service-controller".into())
            .spawn(move || {
                let mut controller = handoff_rx
                    .recv()
                    .map_err(|_| "service-controller authority handoff failed".to_owned())?;
                let run = catch_unwind(AssertUnwindSafe(|| controller.run(command_rx)));
                // This is the thread's process-authority finally boundary. A
                // panic must close the host admission/listener gate just like
                // an ordinary controller error, and the retained controller
                // still gets one bounded drain attempt before the thread exits.
                // A successful run can only return after `shutdown_bounded`
                // proved every tree exited, so replaying that durable shutdown
                // here would mutate and drive already-terminal generations a
                // second time.
                controller.shutdown.request_shutdown();
                let cleanup = controller_cleanup_after_run(&run, || controller.shutdown_bounded());
                finish_controller_thread(run, cleanup)
            }) {
            Ok(handle) => handle,
            Err(error) => {
                shutdown.request_shutdown();
                let _ = controller.shutdown_bounded();
                return Err(ServiceEngineError::ControllerThread(error));
            }
        };
        if let Err(error) = handoff_tx.send(controller) {
            let mut controller = error.0;
            shutdown.request_shutdown();
            let _ = controller.shutdown_bounded();
            let _ = handle.join();
            return Err(ServiceEngineError::ControllerHandoff);
        }

        Ok(Self {
            dashboard_url,
            statuses,
            required_startup_services,
            commands: command_tx,
            service_acquire_timeouts,
            controller: Mutex::new(Some(handle)),
            worker_environments: Mutex::new(Some(worker_environments)),
            ready_published,
            shutdown,
        })
    }

    pub(crate) fn dashboard_url(&self) -> &str {
        &self.dashboard_url
    }

    /// This is an in-memory copy published by the controller. It performs no
    /// health polling, SQLite read, timer advance, or process mutation.
    pub(crate) fn service_statuses(&self) -> Vec<RuntimeServiceStatus> {
        self.statuses
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn take_worker_environments(
        &self,
    ) -> Result<TrustedWorkerEnvironmentSet, ServiceEngineError> {
        self.worker_environments
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            .ok_or(ServiceEngineError::Invariant(
                "worker environment authority was already transferred",
            ))
    }

    pub(crate) fn worker_service_dependencies(&self) -> WorkerServiceDependencyControl {
        WorkerServiceDependencyControl {
            commands: self.commands.clone(),
            service_acquire_timeouts: Arc::clone(&self.service_acquire_timeouts),
        }
    }

    pub(crate) fn mark_ready_published(&self) -> Result<(), ServiceEngineError> {
        self.ready_published.store(true, Ordering::Release);
        if required_startup_services_are_ready(&self.statuses, &self.required_startup_services) {
            self.shutdown.open_admission().map_err(|_| {
                ServiceEngineError::Controller("runtime admission stayed closed".into())
            })?;
        }
        Ok(())
    }

    pub(crate) fn shutdown(&mut self) -> Result<(), String> {
        self.shutdown.request_shutdown();
        match self.commands.try_send(ControllerCommand::Shutdown) {
            Ok(()) | Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {}
        }
        let handle = self
            .controller
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        match handle {
            Some(handle) => handle
                .join()
                .map_err(|_| "service-controller thread panicked".to_owned())?,
            None => Ok(()),
        }
    }

    fn submit_command<R>(
        &self,
        command: ControllerCommand,
        response: Receiver<R>,
    ) -> Result<R, RuntimeServiceControlError> {
        self.submit_command_with_timeout(command, response, CONTROL_RESPONSE_TIMEOUT)
    }

    fn submit_command_with_timeout<R>(
        &self,
        command: ControllerCommand,
        response: Receiver<R>,
        timeout: Duration,
    ) -> Result<R, RuntimeServiceControlError> {
        match self.commands.try_send(command) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => return Err(RuntimeServiceControlError::Unavailable),
            Err(TrySendError::Disconnected(_)) => {
                return Err(RuntimeServiceControlError::Unavailable)
            }
        }
        response
            .recv_timeout(timeout)
            .map_err(|_| RuntimeServiceControlError::Unavailable)
    }
}

impl RuntimeServiceControl for ServiceEngine {
    fn service_lease_contract(
        &self,
        service_id: &str,
    ) -> Result<RuntimeServiceLeaseContractResponse, RuntimeServiceControlError> {
        let timeouts = self
            .service_acquire_timeouts
            .get(service_id)
            .ok_or(RuntimeServiceControlError::NotFound)?;
        let acquire_timeout_ms = u64::try_from(timeouts.response.as_millis())
            .map_err(|_| RuntimeServiceControlError::Internal)?;
        let response = RuntimeServiceLeaseContractResponse {
            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
            service_id: service_id.to_owned(),
            acquire_timeout_ms,
        };
        response
            .validate()
            .map_err(|_| RuntimeServiceControlError::Internal)?;
        Ok(response)
    }

    fn acquire_service_lease(
        &self,
        service_id: &str,
        _reason: &str,
    ) -> Result<RuntimeServiceLeaseAcquireResponse, RuntimeServiceControlError> {
        let response_timeout = self
            .service_acquire_timeouts
            .get(service_id)
            .ok_or(RuntimeServiceControlError::NotFound)?
            .response;
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command_with_timeout(
            ControllerCommand::Acquire {
                service_id: service_id.to_owned(),
                reply: reply_tx,
            },
            reply_rx,
            response_timeout,
        )?
    }

    fn release_service_lease(
        &self,
        lease_id: &str,
    ) -> Result<RuntimeServiceLeaseReleaseResponse, RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command(
            ControllerCommand::Release {
                lease_id: lease_id.to_owned(),
                reply: reply_tx,
            },
            reply_rx,
        )?
    }

    fn retry_service(
        &self,
        service_id: &str,
    ) -> Result<RuntimeServiceRetryResponse, RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command(
            ControllerCommand::Retry {
                service_id: service_id.to_owned(),
                reply: reply_tx,
            },
            reply_rx,
        )?
    }

    fn reconcile_gateway(
        &self,
        context: &AuthenticatedJobContext,
        gateway: RuntimeGatewayId,
        desired_state: RuntimeDesiredState,
    ) -> Result<RuntimeGatewayReconcileResponse, RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command(
            ControllerCommand::ReconcileGateway {
                context: context.clone(),
                gateway,
                desired_state,
                reply: reply_tx,
            },
            reply_rx,
        )?
    }

    fn reconcile_schedule(
        &self,
        context: &AuthenticatedJobContext,
        schedule_id: &str,
        desired_state: RuntimeDesiredState,
    ) -> Result<RuntimeScheduleReconcileResponse, RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command(
            ControllerCommand::ReconcileSchedule {
                context: context.clone(),
                schedule_id: schedule_id.to_owned(),
                desired_state,
                reply: reply_tx,
            },
            reply_rx,
        )?
    }

    fn schedule_status(
        &self,
        context: &AuthenticatedJobContext,
        schedule_id: &str,
    ) -> Result<RuntimeScheduleStatusResponse, RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command(
            ControllerCommand::ScheduleStatus {
                context: context.clone(),
                schedule_id: schedule_id.to_owned(),
                reply: reply_tx,
            },
            reply_rx,
        )?
    }

    fn reconcile_recall(
        &self,
        context: &AuthenticatedJobContext,
        request: RuntimeRecallReconcileRequest,
    ) -> Result<RuntimeRecallReconcileResponse, RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command(
            ControllerCommand::ReconcileRecall {
                context: context.clone(),
                request,
                reply: reply_tx,
            },
            reply_rx,
        )?
    }

    fn recall_status(
        &self,
        context: &AuthenticatedJobContext,
    ) -> Result<RuntimeRecallStatusResponse, RuntimeServiceControlError> {
        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
        self.submit_command(
            ControllerCommand::RecallStatus {
                context: context.clone(),
                reply: reply_tx,
            },
            reply_rx,
        )?
    }
}

impl Drop for ServiceEngine {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

fn required_startup_service_ids(
    registry: &Registry,
) -> Result<BTreeSet<String>, ServiceEngineError> {
    let mut required = BTreeSet::new();
    for service_id in registry.service_ids_in_dependency_order() {
        let definition = registry.service(service_id)?;
        if definition.requirement.is_required()
            && definition.startup_policy == ServiceStartupPolicy::Eager
        {
            required.insert(service_id.to_owned());
        }
    }
    if required.is_empty() {
        Err(ServiceEngineError::Invariant(
            "manifest has no required eager startup service",
        ))
    } else {
        Ok(required)
    }
}

fn service_acquire_timeout_map(
    registry: &Registry,
) -> Result<BTreeMap<String, ServiceAcquireTimeouts>, ServiceEngineError> {
    let mut timeouts = BTreeMap::new();
    for service_id in registry.service_ids_in_dependency_order() {
        let definition = registry.service(service_id)?;
        timeouts.insert(
            service_id.to_owned(),
            service_acquire_timeouts(definition.readiness.startup_timeout_ms),
        );
    }
    Ok(timeouts)
}

fn required_startup_services_are_ready(
    statuses: &RwLock<Vec<RuntimeServiceStatus>>,
    required_startup_services: &BTreeSet<String>,
) -> bool {
    let statuses = statuses
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    !required_startup_services.is_empty()
        && required_startup_services.iter().all(|service_id| {
            statuses.iter().any(|status| {
                status.id == *service_id
                    && status.required
                    && status.startup_policy == ServiceStartupPolicy::Eager
                    && matches!(
                        status.state,
                        RuntimeServiceState::Ready | RuntimeServiceState::Busy
                    )
            })
        })
}

fn open_runtime_admission_during_reconciliation(
    shutdown: &ShutdownCoordinator,
) -> Result<(), ServiceEngineError> {
    match shutdown.open_admission() {
        // Shutdown can close admission while the controller is finishing a
        // normal tick whose service snapshot is still Ready. The serialized
        // coordinator proves that this outcome cannot reopen the gate.
        Ok(()) | Err(AdmissionOpenError::ShutdownRequested) => Ok(()),
        Err(AdmissionOpenError::Unavailable) => Err(ServiceEngineError::Controller(
            "runtime admission stayed closed".into(),
        )),
    }
}

enum ControllerCommand {
    Acquire {
        service_id: String,
        reply: SyncSender<AcquireReply>,
    },
    AcquireWorkerDependency {
        dependency: WorkerServiceDependencyAdmission,
        worker_instance_id: String,
        reply: SyncSender<WorkerDependencyAcquireReply>,
    },
    Release {
        lease_id: String,
        reply: SyncSender<ReleaseReply>,
    },
    ReleaseWorkerDependency {
        lease_id: String,
        reply: SyncSender<ReleaseReply>,
    },
    Retry {
        service_id: String,
        reply: SyncSender<RetryReply>,
    },
    ReconcileGateway {
        context: AuthenticatedJobContext,
        gateway: RuntimeGatewayId,
        desired_state: RuntimeDesiredState,
        reply: SyncSender<GatewayReconcileReply>,
    },
    ReconcileSchedule {
        context: AuthenticatedJobContext,
        schedule_id: String,
        desired_state: RuntimeDesiredState,
        reply: SyncSender<ScheduleReconcileReply>,
    },
    ScheduleStatus {
        context: AuthenticatedJobContext,
        schedule_id: String,
        reply: SyncSender<ScheduleStatusReply>,
    },
    ReconcileRecall {
        context: AuthenticatedJobContext,
        request: RuntimeRecallReconcileRequest,
        reply: SyncSender<RecallReconcileReply>,
    },
    RecallStatus {
        context: AuthenticatedJobContext,
        reply: SyncSender<RecallStatusReply>,
    },
    Shutdown,
}

struct ServiceBinding {
    registration: DurableServiceRegistration,
    admission: DurableServiceAdmissionProfile,
}

struct HeldLease {
    claim: DurableServiceLeaseClaim,
    owner: HeldLeaseOwner,
    pending_reply: Option<AcquireReplySender>,
    pending_deadline: Option<Instant>,
    pending_worker_dependency: Option<WorkerServiceDependencyAdmission>,
    worker_cold_start_target_exit: bool,
    worker_cold_start_restart: Option<DurableServiceRestartSchedule>,
    worker_cold_start_reacquire_used: bool,
}

#[derive(Clone)]
enum AcquireReplySender {
    Standard(SyncSender<AcquireReply>),
    WorkerDependency(SyncSender<WorkerDependencyAcquireReply>),
}

impl AcquireReplySender {
    fn send_control(&self, reply: AcquireReply) -> bool {
        match self {
            Self::Standard(sender) => sender.send(reply).is_ok(),
            Self::WorkerDependency(sender) => sender
                .send(reply.map_err(WorkerServiceDependencyAcquireError::Control))
                .is_ok(),
        }
    }

    fn send_owner_lost(&self) -> bool {
        match self {
            Self::WorkerDependency(sender) => sender
                .send(Err(WorkerServiceDependencyAcquireError::OwnerLost))
                .is_ok(),
            Self::Standard(sender) => sender
                .send(Err(RuntimeServiceControlError::Internal))
                .is_ok(),
        }
    }
}

enum OwnedServiceAcquireAuthority {
    Independent(String),
    WorkerDependency(WorkerServiceDependencyAdmission),
}

impl OwnedServiceAcquireAuthority {
    fn service_id(&self) -> &str {
        match self {
            Self::Independent(service_id) => service_id,
            Self::WorkerDependency(dependency) => dependency.service_id(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum HeldLeaseOwner {
    DashboardGeneration(u64),
    RuntimeGateway {
        schedule_id: String,
        decision_epoch: u64,
    },
    WorkerInstance {
        job_id: String,
        worker_instance_id: String,
    },
    RuntimeServiceIntent {
        service_id: String,
        decision_epoch: u64,
    },
}

enum PendingReconcileReply {
    Gateway {
        gateway: RuntimeGatewayId,
        desired_state: RuntimeDesiredState,
        reply: SyncSender<GatewayReconcileReply>,
    },
    Schedule {
        desired_state: RuntimeDesiredState,
        reply: SyncSender<ScheduleReconcileReply>,
    },
}

struct PendingGatewayAcquire {
    gateway: RuntimeGatewayId,
    desired_state: RuntimeDesiredState,
    decision_epoch: u64,
    receiver: Receiver<AcquireReply>,
    reply: Option<SyncSender<GatewayReconcileReply>>,
    superseded: bool,
}

struct PendingRecallAcquire {
    decision_epoch: u64,
    receiver: Receiver<AcquireReply>,
    superseded: bool,
}

struct PendingRecallReconcile {
    desired_state: RuntimeDesiredState,
    decision_epoch: u64,
    reply: SyncSender<RecallReconcileReply>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackgroundResultIdentity {
    job_id: String,
    attempt: u32,
    worker_instance_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BackgroundResultEnvelope {
    protocol_version: u32,
    identity: BackgroundResultIdentity,
    completion_sequence: u64,
    result: BackgroundReconcileResult,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum BackgroundReconcileResult {
    #[serde(rename_all = "camelCase")]
    RuntimeServiceReconciliation {
        service_id: String,
        gateway: RuntimeGatewayId,
        decision_epoch: u64,
        desired_state: RuntimeDesiredState,
        owner_user_id: Option<u64>,
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    RuntimeScheduleReconciliation {
        schedule_id: String,
        decision_epoch: u64,
        desired_state: RuntimeDesiredState,
        owner_user_id: Option<u64>,
        initial_delay_ms: u64,
        interval_ms: u64,
        reason: String,
    },
}

struct StopProgress {
    started_at: Instant,
    force_sent: bool,
}

enum QuarantinedIntent {
    Claim(DurableServiceOutboxClaim),
    Launch(DurableServiceOutboxClaim, ServiceLaunchRequest),
}

struct ServiceController {
    mode: RuntimeMode,
    registry: Registry,
    store: Arc<JobStore>,
    paths: RuntimePaths,
    generation: CurrentGenerationMembership,
    endpoints: ServiceEndpointMap,
    endpoint_reservations: EndpointReservations,
    environments: TrustedServiceEnvironmentSet,
    required_startup_services: BTreeSet<String>,
    scheduler_authority: RuntimeSchedulerAuthority,
    scheduler_context: AuthenticatedJobContext,
    bindings: BTreeMap<String, ServiceBinding>,
    held_leases: BTreeMap<String, HeldLease>,
    gateway_lease_ids: BTreeMap<String, String>,
    pending_gateway_acquires: BTreeMap<String, PendingGatewayAcquire>,
    recall_lease_id: Option<String>,
    pending_recall_acquire: Option<PendingRecallAcquire>,
    pending_recall_reconcile: Option<PendingRecallReconcile>,
    recall_restart_barrier_epoch: Option<u64>,
    next_recall_attempt_ms: u64,
    pending_reconcile_replies: BTreeMap<(String, u64), PendingReconcileReply>,
    startup_gateway_due_ms: BTreeMap<String, u64>,
    schedule_drive_active: bool,
    release_tombstones: BTreeMap<String, u64>,
    release_tombstone_order: VecDeque<String>,
    next_readiness_probe: BTreeMap<ServiceKey, Instant>,
    next_eager_attempt_ms: BTreeMap<String, u64>,
    launch_retry_attempted: BTreeSet<ServiceKey>,
    pending_terminals: BTreeMap<ServiceKey, ProcessOwnerTerminal>,
    stops: BTreeMap<ServiceKey, StopProgress>,
    bootstrap_critical_services: BTreeSet<String>,
    bootstrap_generation_failures: BTreeSet<ServiceKey>,
    endpoint_blocked_services: BTreeSet<String>,
    quarantined_intent: Option<QuarantinedIntent>,
    statuses: Arc<RwLock<Vec<RuntimeServiceStatus>>>,
    ready_published: Arc<AtomicBool>,
    shutdown: Arc<ShutdownCoordinator>,
    clock: ClampedRuntimeClock,
    next_timer_sweep: Instant,
}

impl ServiceController {
    #[allow(clippy::too_many_arguments)]
    fn new(
        mode: RuntimeMode,
        registry: Registry,
        store: Arc<JobStore>,
        paths: RuntimePaths,
        generation: CurrentGenerationMembership,
        endpoints: ServiceEndpointMap,
        endpoint_reservations: EndpointReservations,
        environments: TrustedServiceEnvironmentSet,
        required_startup_services: BTreeSet<String>,
        statuses: Arc<RwLock<Vec<RuntimeServiceStatus>>>,
        ready_published: Arc<AtomicBool>,
        shutdown: Arc<ShutdownCoordinator>,
    ) -> Result<Self, ServiceEngineError> {
        let mut bindings = BTreeMap::new();
        for service_id in registry.service_ids_in_dependency_order() {
            bindings.insert(
                service_id.to_owned(),
                ServiceBinding {
                    registration: registry.durable_service_registration(service_id)?,
                    admission: registry.durable_service_admission_profile(service_id)?,
                },
            );
        }
        let scheduler_authority = RuntimeSchedulerAuthority::from_current_generation(&generation);
        let scheduler_context = scheduler_authority
            .trusted_internal_context("runtime-scheduler")
            .map_err(|_| {
                ServiceEngineError::Invariant("runtime scheduler authority was invalid")
            })?;
        Ok(Self {
            mode,
            registry,
            store,
            paths,
            generation,
            endpoints,
            endpoint_reservations,
            environments,
            required_startup_services,
            scheduler_authority,
            scheduler_context,
            bindings,
            held_leases: BTreeMap::new(),
            gateway_lease_ids: BTreeMap::new(),
            pending_gateway_acquires: BTreeMap::new(),
            recall_lease_id: None,
            pending_recall_acquire: None,
            pending_recall_reconcile: None,
            recall_restart_barrier_epoch: None,
            next_recall_attempt_ms: 0,
            pending_reconcile_replies: BTreeMap::new(),
            startup_gateway_due_ms: BTreeMap::new(),
            schedule_drive_active: false,
            release_tombstones: BTreeMap::new(),
            release_tombstone_order: VecDeque::new(),
            next_readiness_probe: BTreeMap::new(),
            next_eager_attempt_ms: BTreeMap::new(),
            launch_retry_attempted: BTreeSet::new(),
            pending_terminals: BTreeMap::new(),
            stops: BTreeMap::new(),
            bootstrap_critical_services: BTreeSet::new(),
            bootstrap_generation_failures: BTreeSet::new(),
            endpoint_blocked_services: BTreeSet::new(),
            quarantined_intent: None,
            statuses,
            ready_published,
            shutdown,
            clock: ClampedRuntimeClock::new(),
            next_timer_sweep: Instant::now(),
        })
    }

    fn bootstrap(&mut self) -> Result<(), ServiceEngineError> {
        let service_ids = self.service_ids();
        let now_ms = self.clock.now_ms();
        for service_id in &service_ids {
            let binding = self
                .bindings
                .get(service_id)
                .ok_or(ServiceEngineError::Invariant("service binding disappeared"))?;
            self.store
                .register_durable_service(&binding.registration, now_ms)?;
        }
        self.register_runtime_schedules(now_ms)?;
        self.refresh_and_reconcile()?;

        let bootstrap_wait_services = self.bootstrap_wait_services()?;
        self.bootstrap_critical_services = bootstrap_wait_services.clone();
        for service_id in service_ids {
            if self.shutdown.is_requested() {
                return Err(ServiceEngineError::Controller(
                    "shutdown was requested during service bootstrap".to_owned(),
                ));
            }
            let (startup_policy, restart_policy, startup_timeout_ms) = {
                let definition = self.registry.service(&service_id)?;
                (
                    definition.startup_policy,
                    definition.restart_policy,
                    definition.readiness.startup_timeout_ms,
                )
            };
            if startup_policy != ServiceStartupPolicy::Eager {
                continue;
            }
            let must_wait = bootstrap_wait_services.contains(&service_id);
            if let Err(error) = self.require_dependencies_ready(&service_id) {
                if matches!(&error, ServiceEngineError::RequiredServiceUnavailable(_)) {
                    continue;
                }
                return Err(error);
            }
            let mut start = self.begin_eager_start(&service_id, must_wait);
            if start.as_ref().err().is_some_and(|error| {
                eager_start_requires_fresh_host_retry(error, &service_id, restart_policy)
            }) {
                // A non-retryable terminal is intentionally sticky for the
                // lifetime of one Runtime host. Starting the application again
                // is a new explicit lifecycle-authority attempt; without this
                // narrow rearm, one resource-limit or preparation failure would
                // permanently prevent every later ready handshake.
                self.store
                    .reset_durable_service_for_explicit_retry(&service_id, self.clock.now_ms())?;
                start = self.begin_eager_start(&service_id, must_wait);
            }
            if let Err(error) = start {
                if matches!(&error, ServiceEngineError::RequiredServiceUnavailable(_)) {
                    continue;
                }
                return Err(error);
            }
            if !must_wait {
                continue;
            }
            let deadline = Instant::now()
                .checked_add(
                    Duration::from_millis(startup_timeout_ms).saturating_add(CONTROLLER_TICK),
                )
                .ok_or(ServiceEngineError::BootstrapTimeout)?;
            let mut cleanup_deadline = None;
            loop {
                if self.shutdown.is_requested() {
                    return Err(ServiceEngineError::Controller(
                        "shutdown was requested during service bootstrap".to_owned(),
                    ));
                }
                self.drive_once(false)?;
                let snapshot = self.store.durable_service_snapshot(&service_id)?;
                if matches!(
                    snapshot.status.state,
                    RuntimeServiceState::Ready | RuntimeServiceState::Busy
                ) {
                    break;
                }
                let generation_key = (service_id.clone(), snapshot.generation);
                if self.bootstrap_generation_failures.contains(&generation_key) {
                    if !matches!(
                        snapshot.status.state,
                        RuntimeServiceState::Starting
                            | RuntimeServiceState::Ready
                            | RuntimeServiceState::Busy
                            | RuntimeServiceState::Stopping
                    ) {
                        self.bootstrap_generation_failures.remove(&generation_key);
                        break;
                    }
                    let cleanup_deadline = cleanup_deadline.get_or_insert_with(|| {
                        Instant::now()
                            .checked_add(SHUTDOWN_TIMEOUT)
                            .unwrap_or_else(Instant::now)
                    });
                    if Instant::now() >= *cleanup_deadline {
                        break;
                    }
                    thread::sleep(CONTROLLER_TICK);
                    continue;
                }
                if Instant::now() >= deadline {
                    break;
                }
                thread::sleep(CONTROLLER_TICK);
            }
        }
        self.refresh_and_reconcile()?;
        self.bootstrap_critical_services.clear();
        self.bootstrap_generation_failures.clear();
        Ok(())
    }

    fn register_runtime_schedules(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        for registration in [
            RuntimeScheduleRegistration::fixed("hermes-abandoned-run-recovery", 0, 60_000),
            RuntimeScheduleRegistration::fixed("learn-recovery", 0, 60_000),
            RuntimeScheduleRegistration::fixed("scheduled-chats", 5_000, 30_000),
            RuntimeScheduleRegistration::fixed("memory-autofetch", 20 * 60_000, 20 * 60_000),
            RuntimeScheduleRegistration::fixed("review-scheduler", 10_000, 30_000),
            RuntimeScheduleRegistration::fixed("caldav-sync", 20_000, 60_000),
            RuntimeScheduleRegistration::dynamic("skills-catalog-refresh"),
            RuntimeScheduleRegistration::dynamic("email-poll"),
            RuntimeScheduleRegistration::dynamic("ifixai-maintenance"),
            RuntimeScheduleRegistration::gateway("telegram-gateway"),
            RuntimeScheduleRegistration::gateway("whatsapp-gateway"),
            RuntimeScheduleRegistration::service("recall"),
        ] {
            self.store
                .register_runtime_schedule(&registration, now_ms)?;
        }
        for schedule_id in ["skills-catalog-refresh", "email-poll", "ifixai-maintenance"] {
            self.store.begin_runtime_schedule_reconciliation(
                schedule_id,
                RuntimeReconcileTrigger::Startup,
                None,
                None,
                now_ms,
            )?;
        }
        for schedule_id in ["telegram-gateway", "whatsapp-gateway"] {
            self.startup_gateway_due_ms.insert(
                schedule_id.to_owned(),
                now_ms.saturating_add(STARTUP_GATEWAY_RECONCILE_DELAY_MS),
            );
        }
        Ok(())
    }

    fn bootstrap_wait_services(&self) -> Result<BTreeSet<String>, ServiceEngineError> {
        let mut pending = self
            .required_startup_services
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        let mut required = BTreeSet::new();
        while let Some(service_id) = pending.pop() {
            if !required.insert(service_id.clone()) {
                continue;
            }
            pending.extend(
                self.registry
                    .service(&service_id)?
                    .dependencies
                    .iter()
                    .cloned(),
            );
        }
        Ok(required)
    }

    fn run(&mut self, commands: Receiver<ControllerCommand>) -> Result<(), String> {
        loop {
            if self.shutdown.is_requested() {
                return self.shutdown_bounded().map_err(|error| error.to_string());
            }
            match commands.recv_timeout(CONTROLLER_TICK) {
                Ok(ControllerCommand::Acquire { service_id, reply }) => {
                    if let Err(error) = self.handle_acquire(service_id, reply) {
                        self.shutdown.request_shutdown();
                        let cleanup = self.shutdown_bounded().err();
                        return Err(join_controller_errors(error, cleanup));
                    }
                }
                Ok(ControllerCommand::AcquireWorkerDependency {
                    dependency,
                    worker_instance_id,
                    reply,
                }) => {
                    if let Err(error) =
                        self.handle_worker_dependency_acquire(dependency, worker_instance_id, reply)
                    {
                        self.shutdown.request_shutdown();
                        let cleanup = self.shutdown_bounded().err();
                        return Err(join_controller_errors(error, cleanup));
                    }
                }
                Ok(ControllerCommand::Release { lease_id, reply }) => {
                    if let Err(error) = self.handle_release(lease_id, reply) {
                        self.shutdown.request_shutdown();
                        let cleanup = self.shutdown_bounded().err();
                        return Err(join_controller_errors(error, cleanup));
                    }
                }
                Ok(ControllerCommand::ReleaseWorkerDependency { lease_id, reply }) => {
                    if let Err(error) = self.handle_release(lease_id, reply) {
                        self.shutdown.request_shutdown();
                        let cleanup = self.shutdown_bounded().err();
                        return Err(join_controller_errors(error, cleanup));
                    }
                }
                Ok(ControllerCommand::Retry { service_id, reply }) => {
                    if let Err(error) = self.handle_retry(service_id, reply) {
                        self.shutdown.request_shutdown();
                        let cleanup = self.shutdown_bounded().err();
                        return Err(join_controller_errors(error, cleanup));
                    }
                }
                Ok(ControllerCommand::ReconcileGateway {
                    context,
                    gateway,
                    desired_state,
                    reply,
                }) => {
                    self.handle_gateway_reconcile(context, gateway, desired_state, reply);
                }
                Ok(ControllerCommand::ReconcileSchedule {
                    context,
                    schedule_id,
                    desired_state,
                    reply,
                }) => {
                    self.handle_schedule_reconcile(context, schedule_id, desired_state, reply);
                }
                Ok(ControllerCommand::ScheduleStatus {
                    context,
                    schedule_id,
                    reply,
                }) => {
                    self.handle_schedule_status(context, schedule_id, reply);
                }
                Ok(ControllerCommand::ReconcileRecall {
                    context,
                    request,
                    reply,
                }) => {
                    self.handle_recall_reconcile(context, request, reply);
                }
                Ok(ControllerCommand::RecallStatus { context, reply }) => {
                    self.handle_recall_status(context, reply);
                }
                Ok(ControllerCommand::Shutdown) => {
                    self.shutdown.request_shutdown();
                    return self.shutdown_bounded().map_err(|error| error.to_string());
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    self.shutdown.request_shutdown();
                    return self.shutdown_bounded().map_err(|error| error.to_string());
                }
            }
            if let Err(error) = self.drive_once(false) {
                self.shutdown.request_shutdown();
                let cleanup = self.shutdown_bounded().err();
                return Err(join_controller_errors(error, cleanup));
            }
        }
    }

    fn handle_acquire(
        &mut self,
        service_id: String,
        reply: SyncSender<AcquireReply>,
    ) -> Result<(), ServiceEngineError> {
        if service_id == "recall" {
            let _ = reply.send(Err(RuntimeServiceControlError::Conflict));
            return Ok(());
        }
        let dashboard_id =
            breadboard_runtime_core::TrustedServiceEnvironmentProfile::Dashboard.service_id();
        let dashboard = self.store.durable_service_snapshot(dashboard_id)?;
        if !dashboard_generation_can_own_lease(
            dashboard.generation,
            dashboard.status.state,
            dashboard.generation,
        ) {
            let _ = reply.send(Err(RuntimeServiceControlError::Unavailable));
            return Ok(());
        }
        self.begin_owned_acquire(
            OwnedServiceAcquireAuthority::Independent(service_id),
            HeldLeaseOwner::DashboardGeneration(dashboard.generation),
            AcquireReplySender::Standard(reply),
        )
    }

    fn handle_worker_dependency_acquire(
        &mut self,
        dependency: WorkerServiceDependencyAdmission,
        worker_instance_id: String,
        reply: SyncSender<WorkerDependencyAcquireReply>,
    ) -> Result<(), ServiceEngineError> {
        if breadboard_runtime_protocol::validate_identifier("workerInstanceId", &worker_instance_id)
            .is_err()
        {
            let _ = reply.send(Err(WorkerServiceDependencyAcquireError::Control(
                RuntimeServiceControlError::InvalidRequest,
            )));
            return Ok(());
        }
        let job_id = dependency.job_id().to_owned();
        self.begin_owned_acquire(
            OwnedServiceAcquireAuthority::WorkerDependency(dependency),
            HeldLeaseOwner::WorkerInstance {
                job_id,
                worker_instance_id,
            },
            AcquireReplySender::WorkerDependency(reply),
        )
    }

    fn begin_owned_acquire(
        &mut self,
        authority: OwnedServiceAcquireAuthority,
        owner: HeldLeaseOwner,
        reply: AcquireReplySender,
    ) -> Result<(), ServiceEngineError> {
        self.begin_owned_acquire_with_deadline(authority, owner, reply, None, false, true)
    }

    fn begin_owned_acquire_with_deadline(
        &mut self,
        authority: OwnedServiceAcquireAuthority,
        owner: HeldLeaseOwner,
        reply: AcquireReplySender,
        pending_deadline_override: Option<Instant>,
        worker_cold_start_reacquire_used: bool,
        drive_after_acquire: bool,
    ) -> Result<(), ServiceEngineError> {
        if pending_deadline_override.is_some_and(|deadline| Instant::now() >= deadline) {
            let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
            return Ok(());
        }
        let service_id = authority.service_id().to_owned();
        // Runtime-owned gateway/worker leases are renewed by this controller;
        // dashboard leases remain generation-fenced and wire-compatible.
        let (lease_duration_ms, pending_timeout) = match self.registry.service(&service_id) {
            Ok(definition) => (
                definition.maximum_lease_ms,
                service_acquire_timeouts(definition.readiness.startup_timeout_ms).pending,
            ),
            Err(RegistryError::UnknownService(_)) => {
                let _ = reply.send_control(Err(RuntimeServiceControlError::NotFound));
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        };
        if self.held_leases.len() >= MAX_HELD_LEASES {
            let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
            return Ok(());
        }
        if let Err(error) = self.require_dependencies_ready(&service_id) {
            let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
            if matches!(error, ServiceEngineError::RequiredServiceUnavailable(_)) {
                return Ok(());
            }
            return Err(error);
        }
        let service = self.store.durable_service_snapshot(&service_id)?;
        if service_state_requires_endpoint_reservation(service.status.state)
            && !self.try_retain_endpoint_reservation(&service_id)?
        {
            let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
            return Ok(());
        }
        let binding = self
            .bindings
            .get(&service_id)
            .ok_or(ServiceEngineError::Invariant("service binding disappeared"))?;
        let lease_id = self.fresh_lease_id()?;
        let now_ms = self.clock.now_ms();
        let result = match &authority {
            OwnedServiceAcquireAuthority::Independent(_) => {
                AdmissionGovernor::for_runtime_mode(&self.store, self.mode)
                    .begin_durable_service_acquire(
                        &binding.registration,
                        &binding.admission,
                        &lease_id,
                        lease_duration_ms,
                        now_ms,
                    )
                    .map(DurableWorkerServiceAcquireResult::Evaluated)
            }
            OwnedServiceAcquireAuthority::WorkerDependency(dependency) => {
                AdmissionGovernor::for_runtime_mode(&self.store, self.mode)
                    .begin_durable_worker_service_dependency_acquire(
                        &binding.registration,
                        &binding.admission,
                        dependency,
                        &lease_id,
                        lease_duration_ms,
                        now_ms,
                    )
            }
        };
        let acquired = match result {
            Ok(DurableWorkerServiceAcquireResult::OwnerLost) => {
                let _ = reply.send_owner_lost();
                return Ok(());
            }
            Ok(DurableWorkerServiceAcquireResult::Evaluated(
                DurableServiceAcquireResult::Acquired(claim),
            )) => claim,
            Ok(DurableWorkerServiceAcquireResult::Evaluated(
                DurableServiceAcquireResult::RestartDeferred(_),
            )) => {
                let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
                return Ok(());
            }
            Ok(DurableWorkerServiceAcquireResult::Evaluated(
                DurableServiceAcquireResult::Denied(denial),
            )) => {
                let _ = reply.send_control(Err(RuntimeServiceControlError::ResourceExhausted {
                    required_headroom_mb: denial.required_headroom_mb,
                    available_headroom_mb: denial.available_headroom_mb,
                }));
                return Ok(());
            }
            Err(error) => {
                if let Some(control_error) = expected_acquire_error(&error) {
                    let _ = reply.send_control(Err(control_error));
                    return Ok(());
                }
                let _ = reply.send_control(Err(RuntimeServiceControlError::Internal));
                return Err(error.into());
            }
        };
        let pending = acquired.state() == ServiceLeaseClaimState::Pending;
        let pending_worker_dependency = if pending {
            match authority {
                OwnedServiceAcquireAuthority::WorkerDependency(dependency) => Some(dependency),
                OwnedServiceAcquireAuthority::Independent(_) => None,
            }
        } else {
            None
        };
        let held = HeldLease {
            claim: acquired,
            owner,
            pending_reply: pending.then_some(reply.clone()),
            pending_deadline: pending.then(|| {
                pending_deadline_override.unwrap_or_else(|| {
                    Instant::now()
                        .checked_add(pending_timeout)
                        .unwrap_or_else(Instant::now)
                })
            }),
            pending_worker_dependency,
            worker_cold_start_target_exit: false,
            worker_cold_start_restart: None,
            worker_cold_start_reacquire_used,
        };
        self.held_leases.insert(lease_id.clone(), held);
        if !pending {
            self.deliver_acquired_lease(&lease_id, reply)?;
        }
        if drive_after_acquire {
            self.drive_once(false)
        } else {
            Ok(())
        }
    }

    fn handle_gateway_reconcile(
        &mut self,
        context: AuthenticatedJobContext,
        gateway: RuntimeGatewayId,
        desired_state: RuntimeDesiredState,
        reply: SyncSender<GatewayReconcileReply>,
    ) {
        let Some(user_id) = context
            .user_id()
            .and_then(|value| u64::try_from(value).ok())
        else {
            let _ = reply.send(Err(RuntimeServiceControlError::InvalidRequest));
            return;
        };
        let schedule_id = gateway.service_id();
        self.fail_older_reconcile_replies(schedule_id);
        let epoch = match self.store.begin_runtime_schedule_reconciliation(
            schedule_id,
            RuntimeReconcileTrigger::Explicit,
            Some(schedule_desired_state(desired_state)),
            Some(user_id),
            self.clock.now_ms(),
        ) {
            Ok(epoch) => epoch,
            Err(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::Conflict));
                return;
            }
        };
        self.pending_reconcile_replies.insert(
            (schedule_id.to_owned(), epoch),
            PendingReconcileReply::Gateway {
                gateway,
                desired_state,
                reply,
            },
        );
    }

    fn handle_schedule_reconcile(
        &mut self,
        context: AuthenticatedJobContext,
        schedule_id: String,
        desired_state: RuntimeDesiredState,
        reply: SyncSender<ScheduleReconcileReply>,
    ) {
        if schedule_id != "email-poll" {
            let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
            return;
        }
        let Some(user_id) = context
            .user_id()
            .and_then(|value| u64::try_from(value).ok())
        else {
            let _ = reply.send(Err(RuntimeServiceControlError::InvalidRequest));
            return;
        };
        self.fail_older_reconcile_replies(&schedule_id);
        let epoch = match self.store.begin_runtime_schedule_reconciliation(
            &schedule_id,
            RuntimeReconcileTrigger::Explicit,
            Some(schedule_desired_state(desired_state)),
            Some(user_id),
            self.clock.now_ms(),
        ) {
            Ok(epoch) => epoch,
            Err(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::Conflict));
                return;
            }
        };
        self.pending_reconcile_replies.insert(
            (schedule_id, epoch),
            PendingReconcileReply::Schedule {
                desired_state,
                reply,
            },
        );
    }

    fn handle_schedule_status(
        &mut self,
        context: AuthenticatedJobContext,
        schedule_id: String,
        reply: SyncSender<ScheduleStatusReply>,
    ) {
        if schedule_id != "email-poll" {
            let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
            return;
        }
        let Some(user_id) = context
            .user_id()
            .and_then(|value| u64::try_from(value).ok())
        else {
            let _ = reply.send(Err(RuntimeServiceControlError::InvalidRequest));
            return;
        };
        let snapshot = match self.store.runtime_schedule_snapshot(&schedule_id) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => {
                let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
                return;
            }
            Err(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::Internal));
                return;
            }
        };
        if snapshot.owner_user_id.is_some_and(|owner| owner != user_id) {
            let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
            return;
        }
        let _ = reply.send(Ok(RuntimeScheduleStatusResponse {
            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
            ok: true,
            schedule_id,
            enabled: snapshot.desired_state == RuntimeScheduleDesiredState::Running,
        }));
    }

    fn handle_recall_reconcile(
        &mut self,
        context: AuthenticatedJobContext,
        request: RuntimeRecallReconcileRequest,
        reply: SyncSender<RecallReconcileReply>,
    ) {
        let Some(user_id) = context
            .user_id()
            .and_then(|value| u64::try_from(value).ok())
        else {
            let _ = reply.send(Err(RuntimeServiceControlError::InvalidRequest));
            return;
        };
        if request.validate().is_err() {
            let _ = reply.send(Err(RuntimeServiceControlError::InvalidRequest));
            return;
        }
        let desired_state = request.desired_state;
        let configuration = request.configuration.as_ref();
        let snapshot = match self.store.apply_runtime_service_intent(
            "recall",
            schedule_desired_state(desired_state),
            user_id,
            configuration,
            self.clock.now_ms(),
        ) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => {
                let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
                return;
            }
            Err(StoreError::InvalidInput(_)) => {
                let _ = reply.send(Err(RuntimeServiceControlError::InvalidRequest));
                return;
            }
            Err(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::Internal));
                return;
            }
        };
        if let Some(previous) = self.pending_recall_reconcile.take() {
            let _ = previous
                .reply
                .send(Err(RuntimeServiceControlError::Conflict));
        }
        if let Some(pending) = self.pending_recall_acquire.as_mut() {
            if pending.decision_epoch != snapshot.decision_epoch {
                pending.superseded = true;
            }
        }
        self.next_recall_attempt_ms = 0;
        self.pending_recall_reconcile = Some(PendingRecallReconcile {
            desired_state,
            decision_epoch: snapshot.decision_epoch,
            reply,
        });
    }

    fn handle_recall_status(
        &mut self,
        context: AuthenticatedJobContext,
        reply: SyncSender<RecallStatusReply>,
    ) {
        let Some(user_id) = context
            .user_id()
            .and_then(|value| u64::try_from(value).ok())
        else {
            let _ = reply.send(Err(RuntimeServiceControlError::InvalidRequest));
            return;
        };
        let intent = match self.store.runtime_schedule_snapshot("recall") {
            Ok(Some(snapshot)) if snapshot.kind == RuntimeScheduleKind::Service => snapshot,
            Ok(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
                return;
            }
            Err(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::Internal));
                return;
            }
        };
        let service = match self.store.durable_service_snapshot("recall") {
            Ok(snapshot) => snapshot,
            Err(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::Internal));
                return;
            }
        };
        let log_tail = match recall_log_tail(&self.paths) {
            Ok(lines) => lines,
            Err(_) => {
                let _ = reply.send(Err(RuntimeServiceControlError::Internal));
                return;
            }
        };
        let response = RuntimeRecallStatusResponse {
            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
            ok: true,
            service_id: "recall".into(),
            desired_state: runtime_desired_state(intent.desired_state),
            service_state: service.status.state,
            owned_by_requester: intent.owner_user_id == Some(user_id),
            log_tail,
        };
        let _ = reply.send(Ok(response));
    }

    fn handle_retry(
        &mut self,
        service_id: String,
        reply: SyncSender<RetryReply>,
    ) -> Result<(), ServiceEngineError> {
        let definition = match self.registry.service(&service_id) {
            Ok(definition) => definition,
            Err(RegistryError::UnknownService(_)) => {
                let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        };
        if definition.startup_policy != ServiceStartupPolicy::Eager {
            let _ = reply.send(Err(RuntimeServiceControlError::Conflict));
            return Ok(());
        }
        let before = self.store.durable_service_snapshot(&service_id)?;
        let retryable = matches!(
            before.status.state,
            RuntimeServiceState::AvailableButStopped
                | RuntimeServiceState::ResourceBlocked
                | RuntimeServiceState::InstallationUnavailable
                | RuntimeServiceState::Failed
        );
        if retryable {
            self.store
                .reset_durable_service_for_explicit_retry(&service_id, self.clock.now_ms())?;
            if self.require_dependencies_ready(&service_id).is_ok() {
                self.begin_eager_start(&service_id, false)?;
                self.drive_once(false)?;
            }
        }
        self.refresh_and_reconcile()?;
        let state = self
            .store
            .durable_service_snapshot(&service_id)?
            .status
            .state;
        let _ = reply.send(Ok(RuntimeServiceRetryResponse {
            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
            ok: true,
            service_id,
            accepted: retryable,
            state,
        }));
        Ok(())
    }

    fn handle_release(
        &mut self,
        lease_id: String,
        reply: SyncSender<ReleaseReply>,
    ) -> Result<(), ServiceEngineError> {
        let now_ms = self.clock.now_ms();
        self.prune_tombstones(now_ms);
        let Some(held) = self.held_leases.remove(&lease_id) else {
            if self.release_tombstones.contains_key(&lease_id) {
                let _ = reply.send(Ok(RuntimeServiceLeaseReleaseResponse {
                    ok: true,
                    released: false,
                }));
            } else {
                let _ = reply.send(Err(RuntimeServiceControlError::NotFound));
            }
            return Ok(());
        };
        match self.store.release_durable_service_lease(
            &held.claim,
            ServiceLeaseReleaseReason::Explicit,
            now_ms,
        ) {
            Ok(disposition) => {
                self.remember_release(lease_id, now_ms);
                let _ = reply.send(Ok(RuntimeServiceLeaseReleaseResponse {
                    ok: true,
                    released: disposition == ServiceLeaseReleaseDisposition::Released,
                }));
                self.drive_once(false)
            }
            Err(error) => {
                self.held_leases.insert(lease_id, held);
                if let Some(control_error) = expected_release_error(&error) {
                    let _ = reply.send(Err(control_error));
                    Ok(())
                } else {
                    let _ = reply.send(Err(RuntimeServiceControlError::Internal));
                    Err(error.into())
                }
            }
        }
    }

    fn begin_eager_start(
        &mut self,
        service_id: &str,
        bootstrap: bool,
    ) -> Result<(), ServiceEngineError> {
        let now_ms = self.clock.now_ms();
        let snapshot = self.store.durable_service_snapshot(service_id)?;
        if service_state_requires_endpoint_reservation(snapshot.status.state)
            && !self.try_retain_endpoint_reservation(service_id)?
        {
            self.next_eager_attempt_ms
                .insert(service_id.to_owned(), now_ms.saturating_add(1_000));
            return if bootstrap {
                Err(ServiceEngineError::RequiredServiceUnavailable(
                    service_id.to_owned(),
                ))
            } else {
                Ok(())
            };
        }
        let binding = self
            .bindings
            .get(service_id)
            .ok_or(ServiceEngineError::Invariant("service binding disappeared"))?;
        match AdmissionGovernor::for_runtime_mode(&self.store, self.mode)
            .begin_eager_durable_service_start(&binding.registration, &binding.admission, now_ms)?
        {
            DurableServiceStartResult::Queued
            | DurableServiceStartResult::AlreadyStartingOrReady => {
                self.next_eager_attempt_ms.remove(service_id);
                Ok(())
            }
            DurableServiceStartResult::RestartDeferred(schedule) => {
                self.next_eager_attempt_ms
                    .insert(service_id.to_owned(), schedule.eligible_at_ms);
                Ok(())
            }
            DurableServiceStartResult::Denied(denial) => {
                // The store has durably projected this exact generation-less
                // denial as resource-blocked. It is non-retryable, so discard
                // any earlier local failure-backoff hint instead of turning a
                // status/controller tick into a one-second admission loop.
                self.next_eager_attempt_ms.remove(service_id);
                if bootstrap {
                    Err(ServiceEngineError::RequiredServiceUnavailable(
                        service_id.to_owned(),
                    ))
                } else {
                    let _bounded_evidence =
                        (denial.required_headroom_mb, denial.available_headroom_mb);
                    Ok(())
                }
            }
        }
    }

    fn drive_once(&mut self, draining: bool) -> Result<(), ServiceEngineError> {
        let now_ms = self.clock.now_ms();
        if !draining && Instant::now() >= self.next_timer_sweep {
            for service_id in self.service_ids() {
                self.store
                    .advance_durable_service_time(&service_id, now_ms)?;
            }
            self.next_timer_sweep = Instant::now()
                .checked_add(SERVICE_TIMER_INTERVAL)
                .unwrap_or_else(Instant::now);
        }

        self.process_outbox(now_ms, draining)?;
        if !draining {
            self.renew_runtime_owned_leases(now_ms)?;
        }
        let snapshots = self.refresh_snapshots()?;
        for service_id in self.service_ids() {
            let snapshot = snapshots
                .get(&service_id)
                .ok_or(ServiceEngineError::Invariant(
                    "dependency-ordered service snapshot disappeared",
                ))?;
            self.drive_retained_generation(&service_id, snapshot, now_ms)?;
        }
        self.process_outbox(now_ms, draining)?;
        if !draining {
            self.schedule_eager_restarts(now_ms)?;
            self.process_outbox(now_ms, false)?;
        }
        self.refresh_and_reconcile()?;
        if !draining && self.shutdown.is_accepting_work() && !self.schedule_drive_active {
            self.schedule_drive_active = true;
            let schedule_result = self.drive_runtime_schedules(now_ms);
            self.schedule_drive_active = false;
            schedule_result?;
        }
        self.prune_tombstones(now_ms);
        Ok(())
    }

    fn drive_runtime_schedules(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        self.start_due_gateway_reconciliations(now_ms)?;
        self.advance_reconciliations(now_ms)?;
        self.advance_fixed_occurrences(now_ms)?;
        self.reconcile_gateway_desired_leases(now_ms)?;
        self.advance_pending_gateway_acquires(now_ms)?;
        self.reconcile_recall_desired_lease(now_ms)?;
        self.advance_pending_recall_acquire(now_ms)?;
        Ok(())
    }

    fn start_due_gateway_reconciliations(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        let due = self
            .startup_gateway_due_ms
            .iter()
            .filter(|(_, due)| now_ms >= **due)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for schedule_id in due {
            self.store.begin_runtime_schedule_reconciliation(
                &schedule_id,
                RuntimeReconcileTrigger::Startup,
                None,
                None,
                now_ms,
            )?;
            self.startup_gateway_due_ms.remove(&schedule_id);
        }
        Ok(())
    }

    fn advance_reconciliations(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        let snapshots = self.store.runtime_schedule_snapshots()?;
        let mut advanced = 0usize;
        for snapshot in snapshots {
            if advanced >= MAX_SCHEDULE_ACTIONS_PER_TICK {
                break;
            }
            let (Some(trigger), Some(epoch)) = (
                snapshot.reconcile_trigger,
                (snapshot.reconcile_trigger.is_some()).then_some(snapshot.decision_epoch),
            ) else {
                continue;
            };
            let context = match trigger {
                RuntimeReconcileTrigger::Startup => self.scheduler_context.clone(),
                RuntimeReconcileTrigger::Explicit => {
                    let Some(user_id) = snapshot.reconcile_owner_user_id else {
                        return Err(ServiceEngineError::Invariant(
                            "explicit schedule reconciliation lost its owner",
                        ));
                    };
                    let user_id = i64::try_from(user_id).map_err(|_| {
                        ServiceEngineError::Invariant("schedule owner exceeded authenticated range")
                    })?;
                    self.scheduler_authority
                        .trusted_user_context(user_id)
                        .map_err(|_| ServiceEngineError::Invariant("schedule owner was invalid"))?
                }
            };
            let job_id = if let Some(job_id) = snapshot.reconcile_job_id.clone() {
                job_id
            } else {
                let payload = reconciliation_payload(&snapshot)?;
                let job = self.registry.submit_runtime_job(
                    &self.store,
                    &self.paths,
                    &self.scheduler_authority,
                    &context,
                    &payload,
                )?;
                self.store.bind_runtime_schedule_reconciliation_job(
                    &snapshot.schedule_id,
                    epoch,
                    &job.job_id,
                    now_ms,
                )?;
                advanced += 1;
                job.job_id
            };
            let replay = self
                .store
                .replay_job_events_snapshot(&context, &job_id, 0, 1)?;
            if !replay.job.state.is_terminal() || !replay.public_event_stream_sealed {
                continue;
            }
            advanced += 1;
            if replay.job.state != JobState::Succeeded {
                self.store.fail_runtime_schedule_reconciliation(
                    &snapshot.schedule_id,
                    epoch,
                    &job_id,
                    now_ms,
                )?;
                self.fail_reconcile_reply(&snapshot.schedule_id, epoch);
                self.startup_gateway_due_ms
                    .insert(snapshot.schedule_id.clone(), now_ms.saturating_add(60_000));
                continue;
            }
            let bytes = self.registry.read_runtime_job_result(
                &self.paths,
                &self.scheduler_authority,
                &context,
                &replay.job,
                MAX_BACKGROUND_RESULT_BYTES,
            )?;
            let envelope: BackgroundResultEnvelope = serde_json::from_slice(&bytes)
                .map_err(|_| ServiceEngineError::Invariant("background result was invalid"))?;
            validate_background_result_envelope(&envelope, &replay.job)?;
            self.apply_reconciliation_result(&snapshot, envelope.result, now_ms)?;
        }
        Ok(())
    }

    fn apply_reconciliation_result(
        &mut self,
        snapshot: &breadboard_runtime_core::RuntimeScheduleSnapshot,
        result: BackgroundReconcileResult,
        now_ms: u64,
    ) -> Result<(), ServiceEngineError> {
        match result {
            BackgroundReconcileResult::RuntimeServiceReconciliation {
                service_id,
                gateway,
                decision_epoch,
                desired_state,
                owner_user_id,
                reason,
            } => {
                if snapshot.kind != RuntimeScheduleKind::Gateway
                    || snapshot.schedule_id != service_id
                    || gateway.service_id() != service_id
                    || decision_epoch != snapshot.decision_epoch
                    || reason.is_empty()
                    || reason.len() > 8_192
                    || (snapshot.reconcile_trigger == Some(RuntimeReconcileTrigger::Explicit)
                        && (owner_user_id != snapshot.reconcile_owner_user_id
                            || snapshot.reconcile_requested_state
                                != Some(schedule_desired_state(desired_state))))
                {
                    return Err(ServiceEngineError::Invariant(
                        "gateway reconciliation result escaped its durable fence",
                    ));
                }
                let applied = self.store.apply_runtime_schedule_reconciliation(
                    &service_id,
                    decision_epoch,
                    schedule_desired_state(desired_state),
                    owner_user_id,
                    None,
                    None,
                    now_ms,
                )?;
                if !applied {
                    self.fail_reconcile_reply(&service_id, decision_epoch);
                    return Ok(());
                }
                if desired_state == RuntimeDesiredState::Stopped {
                    self.stop_gateway_lease(&service_id)?;
                    if let Some(PendingReconcileReply::Gateway { reply, .. }) = self
                        .pending_reconcile_replies
                        .remove(&(service_id.clone(), decision_epoch))
                    {
                        let _ = reply.send(Ok(RuntimeGatewayReconcileResponse {
                            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                            ok: true,
                            gateway,
                            desired_state,
                            service_state: RuntimeGatewayServiceState::Stopped,
                        }));
                    }
                }
            }
            BackgroundReconcileResult::RuntimeScheduleReconciliation {
                schedule_id,
                decision_epoch,
                desired_state,
                owner_user_id,
                initial_delay_ms,
                interval_ms,
                reason,
            } => {
                if snapshot.kind != RuntimeScheduleKind::Dynamic
                    || snapshot.schedule_id != schedule_id
                    || decision_epoch != snapshot.decision_epoch
                    || reason.is_empty()
                    || reason.len() > 8_192
                    || (snapshot.reconcile_trigger == Some(RuntimeReconcileTrigger::Explicit)
                        && (owner_user_id != snapshot.reconcile_owner_user_id
                            || snapshot.reconcile_requested_state
                                != Some(schedule_desired_state(desired_state))))
                {
                    return Err(ServiceEngineError::Invariant(
                        "schedule reconciliation result escaped its durable fence",
                    ));
                }
                let applied = self.store.apply_runtime_schedule_reconciliation(
                    &schedule_id,
                    decision_epoch,
                    schedule_desired_state(desired_state),
                    owner_user_id,
                    Some(initial_delay_ms),
                    Some(interval_ms),
                    now_ms,
                )?;
                if !applied {
                    self.fail_reconcile_reply(&schedule_id, decision_epoch);
                    return Ok(());
                }
                if let Some(PendingReconcileReply::Schedule {
                    desired_state: requested,
                    reply,
                }) = self
                    .pending_reconcile_replies
                    .remove(&(schedule_id.clone(), decision_epoch))
                {
                    if requested != desired_state {
                        let _ = reply.send(Err(RuntimeServiceControlError::Conflict));
                    } else {
                        let _ = reply.send(Ok(RuntimeScheduleReconcileResponse {
                            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                            ok: true,
                            schedule_id,
                            desired_state,
                            schedule_state: match desired_state {
                                RuntimeDesiredState::Running => {
                                    RuntimeScheduleControlState::Enabled
                                }
                                RuntimeDesiredState::Stopped => {
                                    RuntimeScheduleControlState::Disabled
                                }
                            },
                        }));
                    }
                }
            }
        }
        Ok(())
    }

    fn advance_fixed_occurrences(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        let snapshots = self.store.runtime_schedule_snapshots()?;
        let mut advanced = 0usize;
        for snapshot in snapshots.iter().filter(|snapshot| {
            snapshot.kind != RuntimeScheduleKind::Gateway && snapshot.inflight_job_id.is_some()
        }) {
            if advanced >= MAX_SCHEDULE_ACTIONS_PER_TICK {
                return Ok(());
            }
            let job_id = snapshot
                .inflight_job_id
                .as_deref()
                .expect("filtered inflight job");
            let replay =
                self.store
                    .replay_job_events_snapshot(&self.scheduler_context, job_id, 0, 1)?;
            if replay.job.state.is_terminal() && replay.public_event_stream_sealed {
                self.store.complete_runtime_schedule_occurrence(
                    &snapshot.schedule_id,
                    job_id,
                    now_ms,
                )?;
                advanced += 1;
            }
        }
        while advanced < MAX_SCHEDULE_ACTIONS_PER_TICK {
            let Some(occurrence) = self.store.claim_due_runtime_schedule(now_ms)? else {
                break;
            };
            let payload = occurrence_payload(&occurrence)?;
            let job = if occurrence.schedule_id == "learn-recovery" {
                self.registry.submit_job(
                    &self.store,
                    &self.paths,
                    &self.scheduler_context,
                    &payload,
                )?
            } else {
                self.registry.submit_runtime_job(
                    &self.store,
                    &self.paths,
                    &self.scheduler_authority,
                    &self.scheduler_context,
                    &payload,
                )?
            };
            self.store
                .bind_runtime_schedule_occurrence_job(&occurrence, &job.job_id, now_ms)?;
            advanced += 1;
        }
        Ok(())
    }

    fn reconcile_gateway_desired_leases(&mut self, _now_ms: u64) -> Result<(), ServiceEngineError> {
        for snapshot in self
            .store
            .runtime_schedule_snapshots()?
            .into_iter()
            .filter(|snapshot| snapshot.kind == RuntimeScheduleKind::Gateway)
        {
            if let Some(lease_id) = self.gateway_lease_ids.get(&snapshot.schedule_id) {
                if !self.held_leases.contains_key(lease_id) {
                    self.gateway_lease_ids.remove(&snapshot.schedule_id);
                }
            }
            match snapshot.desired_state {
                RuntimeScheduleDesiredState::Stopped => {
                    self.stop_gateway_lease(&snapshot.schedule_id)?;
                }
                RuntimeScheduleDesiredState::Running => {
                    if !self.gateway_lease_ids.contains_key(&snapshot.schedule_id)
                        && !self
                            .pending_gateway_acquires
                            .contains_key(&snapshot.schedule_id)
                    {
                        let gateway = gateway_for_schedule(&snapshot.schedule_id)?;
                        let (reply_tx, reply_rx) = mpsc::sync_channel(1);
                        self.begin_owned_acquire(
                            OwnedServiceAcquireAuthority::Independent(snapshot.schedule_id.clone()),
                            HeldLeaseOwner::RuntimeGateway {
                                schedule_id: snapshot.schedule_id.clone(),
                                decision_epoch: snapshot.decision_epoch,
                            },
                            AcquireReplySender::Standard(reply_tx),
                        )?;
                        let explicit_reply = self
                            .pending_reconcile_replies
                            .remove(&(snapshot.schedule_id.clone(), snapshot.decision_epoch))
                            .and_then(|pending| match pending {
                                PendingReconcileReply::Gateway {
                                    gateway: expected_gateway,
                                    desired_state,
                                    reply,
                                } if expected_gateway == gateway
                                    && desired_state == RuntimeDesiredState::Running =>
                                {
                                    Some(reply)
                                }
                                other => {
                                    self.pending_reconcile_replies.insert(
                                        (snapshot.schedule_id.clone(), snapshot.decision_epoch),
                                        other,
                                    );
                                    None
                                }
                            });
                        self.pending_gateway_acquires.insert(
                            snapshot.schedule_id.clone(),
                            PendingGatewayAcquire {
                                gateway,
                                desired_state: RuntimeDesiredState::Running,
                                decision_epoch: snapshot.decision_epoch,
                                receiver: reply_rx,
                                reply: explicit_reply,
                                superseded: false,
                            },
                        );
                    }
                }
            }
        }
        Ok(())
    }

    fn advance_pending_gateway_acquires(&mut self, _now_ms: u64) -> Result<(), ServiceEngineError> {
        let schedule_ids = self
            .pending_gateway_acquires
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        for schedule_id in schedule_ids {
            let result = {
                let pending = self
                    .pending_gateway_acquires
                    .get(&schedule_id)
                    .expect("observed pending acquire remains present");
                pending.receiver.try_recv()
            };
            let result = match result {
                Ok(result) => result,
                Err(mpsc::TryRecvError::Empty) => continue,
                Err(mpsc::TryRecvError::Disconnected) => {
                    Err(RuntimeServiceControlError::Unavailable)
                }
            };
            let mut pending = self
                .pending_gateway_acquires
                .remove(&schedule_id)
                .expect("observed pending acquire remains present");
            let snapshot = self.store.runtime_schedule_snapshot(&schedule_id)?.ok_or(
                ServiceEngineError::Invariant("gateway schedule disappeared"),
            )?;
            match result {
                Ok(acquired)
                    if !pending.superseded
                        && snapshot.decision_epoch == pending.decision_epoch
                        && snapshot.desired_state == RuntimeScheduleDesiredState::Running =>
                {
                    self.gateway_lease_ids
                        .insert(schedule_id.clone(), acquired.lease_id);
                    if let Some(reply) = pending.reply.take() {
                        let _ = reply.send(Ok(RuntimeGatewayReconcileResponse {
                            protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                            ok: true,
                            gateway: pending.gateway,
                            desired_state: pending.desired_state,
                            service_state: RuntimeGatewayServiceState::Healthy,
                        }));
                    }
                }
                Ok(acquired) => {
                    let (reply_tx, _reply_rx) = mpsc::sync_channel(1);
                    self.handle_release(acquired.lease_id, reply_tx)?;
                    if let Some(reply) = pending.reply.take() {
                        let _ = reply.send(Err(RuntimeServiceControlError::Conflict));
                    }
                }
                Err(error) => {
                    if let Some(reply) = pending.reply.take() {
                        let _ = reply.send(Err(error));
                    }
                }
            }
        }
        Ok(())
    }

    fn stop_gateway_lease(&mut self, schedule_id: &str) -> Result<(), ServiceEngineError> {
        if let Some(pending) = self.pending_gateway_acquires.get_mut(schedule_id) {
            pending.superseded = true;
            if let Some(reply) = pending.reply.take() {
                let _ = reply.send(Err(RuntimeServiceControlError::Conflict));
            }
        }
        if let Some(lease_id) = self.gateway_lease_ids.remove(schedule_id) {
            let (reply_tx, _reply_rx) = mpsc::sync_channel(1);
            self.handle_release(lease_id, reply_tx)?;
        }
        Ok(())
    }

    fn reconcile_recall_desired_lease(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        let intent = self.store.runtime_schedule_snapshot("recall")?.ok_or(
            ServiceEngineError::Invariant("Recall service intent disappeared"),
        )?;
        if intent.kind != RuntimeScheduleKind::Service {
            return Err(ServiceEngineError::Invariant(
                "Recall desired state was not registered as a service intent",
            ));
        }
        if self
            .recall_lease_id
            .as_ref()
            .is_some_and(|lease_id| !self.held_leases.contains_key(lease_id))
        {
            self.recall_lease_id = None;
        }
        let held_epoch = self.recall_lease_id.as_ref().and_then(|lease_id| {
            self.held_leases
                .get(lease_id)
                .and_then(|held| match &held.owner {
                    HeldLeaseOwner::RuntimeServiceIntent {
                        service_id,
                        decision_epoch,
                    } if service_id == "recall" => Some(*decision_epoch),
                    _ => None,
                })
        });
        if held_epoch.is_some_and(|epoch| epoch != intent.decision_epoch) {
            self.recall_restart_barrier_epoch = Some(intent.decision_epoch);
            self.stop_recall_lease()?;
        }
        if self
            .pending_recall_acquire
            .as_ref()
            .is_some_and(|pending| pending.decision_epoch != intent.decision_epoch)
        {
            self.recall_restart_barrier_epoch = Some(intent.decision_epoch);
            if let Some(pending) = self.pending_recall_acquire.as_mut() {
                pending.superseded = true;
            }
            self.stop_recall_lease()?;
        }

        match intent.desired_state {
            RuntimeScheduleDesiredState::Stopped => {
                self.recall_restart_barrier_epoch = None;
                self.stop_recall_lease()?;
                let snapshot = self.store.durable_service_snapshot("recall")?;
                if recall_service_has_no_resident_tree(snapshot.status.state) {
                    if let Some(pending) = self.pending_recall_reconcile.take() {
                        if pending.decision_epoch == intent.decision_epoch
                            && pending.desired_state == RuntimeDesiredState::Stopped
                        {
                            let _ = pending.reply.send(Ok(RuntimeRecallReconcileResponse {
                                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                                ok: true,
                                service_id: "recall".into(),
                                desired_state: RuntimeDesiredState::Stopped,
                                service_state: RuntimeRecallReconcileServiceState::Stopped,
                            }));
                        } else {
                            let _ = pending
                                .reply
                                .send(Err(RuntimeServiceControlError::Conflict));
                        }
                    }
                }
            }
            RuntimeScheduleDesiredState::Running => {
                if intent.launch_configuration.is_none()
                    || intent.configuration_fingerprint.is_none()
                {
                    return Err(ServiceEngineError::Invariant(
                        "Recall running intent lost its launch policy",
                    ));
                }
                let snapshot = self.store.durable_service_snapshot("recall")?;
                if !advance_recall_restart_barrier(
                    &mut self.recall_restart_barrier_epoch,
                    intent.decision_epoch,
                    snapshot.status.state,
                ) {
                    return Ok(());
                }
                if self.recall_lease_id.is_some()
                    && matches!(
                        snapshot.status.state,
                        RuntimeServiceState::Ready | RuntimeServiceState::Busy
                    )
                {
                    if let Some(pending) = self.pending_recall_reconcile.take() {
                        if pending.decision_epoch == intent.decision_epoch
                            && pending.desired_state == RuntimeDesiredState::Running
                        {
                            let _ = pending.reply.send(Ok(RuntimeRecallReconcileResponse {
                                protocol_version: RUNTIME_CONTROL_PROTOCOL_VERSION,
                                ok: true,
                                service_id: "recall".into(),
                                desired_state: RuntimeDesiredState::Running,
                                service_state: RuntimeRecallReconcileServiceState::Healthy,
                            }));
                        } else {
                            let _ = pending
                                .reply
                                .send(Err(RuntimeServiceControlError::Conflict));
                        }
                    }
                } else if self.recall_lease_id.is_none()
                    && self.pending_recall_acquire.is_none()
                    && now_ms >= self.next_recall_attempt_ms
                    && snapshot.status.state != RuntimeServiceState::Stopping
                {
                    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
                    self.begin_owned_acquire(
                        OwnedServiceAcquireAuthority::Independent("recall".into()),
                        HeldLeaseOwner::RuntimeServiceIntent {
                            service_id: "recall".into(),
                            decision_epoch: intent.decision_epoch,
                        },
                        AcquireReplySender::Standard(reply_tx),
                    )?;
                    self.pending_recall_acquire = Some(PendingRecallAcquire {
                        decision_epoch: intent.decision_epoch,
                        receiver: reply_rx,
                        superseded: false,
                    });
                }
            }
        }
        Ok(())
    }

    fn advance_pending_recall_acquire(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        let Some(pending) = self.pending_recall_acquire.as_ref() else {
            return Ok(());
        };
        let result = match pending.receiver.try_recv() {
            Ok(result) => result,
            Err(mpsc::TryRecvError::Empty) => return Ok(()),
            Err(mpsc::TryRecvError::Disconnected) => Err(RuntimeServiceControlError::Unavailable),
        };
        let pending = self
            .pending_recall_acquire
            .take()
            .expect("observed Recall acquire remains pending");
        let intent = self.store.runtime_schedule_snapshot("recall")?.ok_or(
            ServiceEngineError::Invariant("Recall service intent disappeared"),
        )?;
        match result {
            Ok(acquired)
                if !pending.superseded
                    && intent.desired_state == RuntimeScheduleDesiredState::Running
                    && intent.decision_epoch == pending.decision_epoch =>
            {
                self.recall_lease_id = Some(acquired.lease_id);
                self.next_recall_attempt_ms = 0;
            }
            Ok(acquired) => {
                let (reply_tx, _reply_rx) = mpsc::sync_channel(1);
                self.handle_release(acquired.lease_id, reply_tx)?;
            }
            Err(error) => {
                self.next_recall_attempt_ms = now_ms.saturating_add(30_000);
                if let Some(pending_reply) = self.pending_recall_reconcile.take() {
                    if pending_reply.decision_epoch == pending.decision_epoch {
                        let _ = pending_reply.reply.send(Err(error));
                    } else {
                        self.pending_recall_reconcile = Some(pending_reply);
                    }
                }
            }
        }
        Ok(())
    }

    fn stop_recall_lease(&mut self) -> Result<(), ServiceEngineError> {
        if let Some(pending) = self.pending_recall_acquire.as_mut() {
            pending.superseded = true;
        }
        let mut lease_ids = self
            .held_leases
            .iter()
            .filter_map(|(lease_id, held)| match &held.owner {
                HeldLeaseOwner::RuntimeServiceIntent { service_id, .. }
                    if service_id == "recall" =>
                {
                    Some(lease_id.clone())
                }
                _ => None,
            })
            .collect::<Vec<_>>();
        if let Some(lease_id) = self.recall_lease_id.take() {
            if !lease_ids.contains(&lease_id) {
                lease_ids.push(lease_id);
            }
        }
        for lease_id in lease_ids {
            if self.held_leases.contains_key(&lease_id) {
                let (reply_tx, _reply_rx) = mpsc::sync_channel(1);
                self.handle_release(lease_id, reply_tx)?;
            }
        }
        Ok(())
    }

    fn renew_runtime_owned_leases(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        let lease_ids = self
            .held_leases
            .iter()
            .filter(|(_, held)| !matches!(held.owner, HeldLeaseOwner::DashboardGeneration(_)))
            .map(|(lease_id, _)| lease_id.clone())
            .collect::<Vec<_>>();
        for lease_id in lease_ids {
            let Some(held) = self.held_leases.get_mut(&lease_id) else {
                continue;
            };
            let maximum_lease_ms = self
                .registry
                .service(held.claim.service_id())?
                .maximum_lease_ms;
            let renewal_lead_ms = (maximum_lease_ms / 2).max(1);
            if held.claim.expires_at_ms().saturating_sub(now_ms) > renewal_lead_ms {
                continue;
            }
            self.store
                .renew_durable_service_lease(&mut held.claim, now_ms)?;
        }
        Ok(())
    }

    fn fail_reconcile_reply(&mut self, schedule_id: &str, epoch: u64) {
        if let Some(pending) = self
            .pending_reconcile_replies
            .remove(&(schedule_id.to_owned(), epoch))
        {
            match pending {
                PendingReconcileReply::Gateway { reply, .. } => {
                    let _ = reply.send(Err(RuntimeServiceControlError::Unavailable));
                }
                PendingReconcileReply::Schedule { reply, .. } => {
                    let _ = reply.send(Err(RuntimeServiceControlError::Unavailable));
                }
            }
        }
    }

    fn fail_older_reconcile_replies(&mut self, schedule_id: &str) {
        let keys = self
            .pending_reconcile_replies
            .keys()
            .filter(|(candidate, _)| candidate == schedule_id)
            .cloned()
            .collect::<Vec<_>>();
        for (candidate, epoch) in keys {
            self.fail_reconcile_reply(&candidate, epoch);
        }
    }

    fn process_outbox(&mut self, now_ms: u64, draining: bool) -> Result<(), ServiceEngineError> {
        if self.quarantined_intent.is_some() {
            return Err(ServiceEngineError::Invariant(
                "a quarantined service intent remains unresolved",
            ));
        }
        for _ in 0..MAX_INTENTS_PER_TICK {
            let Some(claim) = self
                .store
                .claim_next_durable_service_intent(OUTBOX_CLAIM_TTL_MS, now_ms)?
            else {
                return Ok(());
            };
            match claim.action().clone() {
                ServiceLeaseAction::StartTree {
                    service_id,
                    generation,
                } => {
                    if draining {
                        self.quarantined_intent = Some(QuarantinedIntent::Claim(claim));
                        return Err(ServiceEngineError::Invariant(
                            "shutdown observed an unsuperseded service start intent",
                        ));
                    }
                    let request = match self.prepare_launch(&service_id) {
                        Ok(request) => request,
                        Err(_error) => {
                            self.finish_start_preparation_failure(
                                claim,
                                &service_id,
                                generation,
                                now_ms,
                            )?;
                            continue;
                        }
                    };
                    if self.release_endpoint_for_launch(&service_id).is_err() {
                        drop(request);
                        self.finish_start_preparation_failure(
                            claim,
                            &service_id,
                            generation,
                            now_ms,
                        )?;
                        continue;
                    }
                    match self.store.acknowledge_and_launch_durable_service_start(
                        claim,
                        now_ms,
                        &self.generation,
                        request,
                    ) {
                        Ok(ServiceLaunchRetentionDisposition::Retained) => {
                            self.next_readiness_probe
                                .insert((service_id, generation), Instant::now());
                        }
                        Ok(ServiceLaunchRetentionDisposition::DuplicateQuarantined) => {
                            return Err(ServiceEngineError::Invariant(
                                "duplicate service process authority was quarantined",
                            ));
                        }
                        Err(error) => {
                            let (claim, request, source) = error.into_parts();
                            self.quarantined_intent =
                                Some(QuarantinedIntent::Launch(claim, request));
                            return Err(source.into());
                        }
                    }
                }
                ServiceLeaseAction::StopTree {
                    service_id,
                    generation,
                    ..
                } => {
                    match self
                        .store
                        .acknowledge_and_bind_retained_durable_service_stop(claim, now_ms, false)
                    {
                        Ok((_, RetainedServiceStopProgress::DuplicateQuarantined)) => {
                            return Err(ServiceEngineError::Invariant(
                                "duplicate service stop authority was quarantined",
                            ));
                        }
                        Ok((_, _)) => {
                            self.stops
                                .entry((service_id, generation))
                                .or_insert(StopProgress {
                                    started_at: Instant::now(),
                                    force_sent: false,
                                });
                        }
                        Err(error) => {
                            let (claim, source) = error.into_parts();
                            self.quarantined_intent = Some(QuarantinedIntent::Claim(claim));
                            return Err(source.into());
                        }
                    }
                }
            }
        }
        Ok(())
    }

    fn prepare_launch(&self, service_id: &str) -> Result<ServiceLaunchRequest, ServiceEngineError> {
        let definition = self.registry.service(service_id)?;
        let profile = definition
            .launch_profile(self.mode)
            .ok_or(ServiceEngineError::Invariant(
                "validated service mode lost its launch profile",
            ))?;
        self.environments
            .validate_service_installation(service_id, &self.paths)?;
        let environment = self
            .environments
            .prepare_for_launch_profile(service_id, profile)?;
        let port = self.endpoints.port_for(profile.environment_source).get();
        let recall_configuration = if service_id == "recall" {
            let intent = self.store.runtime_schedule_snapshot("recall")?.ok_or(
                ServiceEngineError::Invariant("Recall service intent disappeared before launch"),
            )?;
            if intent.kind != RuntimeScheduleKind::Service
                || intent.desired_state != RuntimeScheduleDesiredState::Running
            {
                return Err(ServiceEngineError::Invariant(
                    "Recall launch was not backed by running durable intent",
                ));
            }
            Some(
                intent
                    .launch_configuration
                    .ok_or(ServiceEngineError::Invariant(
                        "Recall running intent lost its typed launch configuration",
                    ))?,
            )
        } else {
            None
        };
        Ok(self.registry.prepare_service_launch(
            &self.paths,
            &self.scheduler_authority,
            service_id,
            port,
            environment,
            recall_configuration.as_ref(),
        )?)
    }

    fn finish_start_preparation_failure(
        &mut self,
        claim: DurableServiceOutboxClaim,
        service_id: &str,
        generation: u64,
        now_ms: u64,
    ) -> Result<(), ServiceEngineError> {
        match self
            .store
            .finish_claimed_durable_service_start_preparation_failure(claim, now_ms)
        {
            Ok(_) => {
                if self.bootstrap_critical_services.contains(service_id) {
                    self.bootstrap_generation_failures
                        .insert((service_id.to_owned(), generation));
                }
                let _reserved = self.try_retain_endpoint_reservation(service_id)?;
                Ok(())
            }
            Err(error) => {
                let (claim, source) = error.into_parts();
                self.quarantined_intent = Some(QuarantinedIntent::Claim(claim));
                Err(source.into())
            }
        }
    }

    fn service_environment_source(
        &self,
        service_id: &str,
    ) -> Result<TrustedServiceEnvironmentSource, ServiceEngineError> {
        self.registry
            .service(service_id)?
            .launch_profile(self.mode)
            .map(|profile| profile.environment_source)
            .ok_or(ServiceEngineError::Invariant(
                "validated service mode lost its launch profile",
            ))
    }

    /// Keeps the exact published endpoint unavailable to unrelated processes
    /// whenever its service owns no tree. A bind failure blocks only this
    /// service; a later real acquire or bounded eager retry may prove that the
    /// exact endpoint has become reservable again.
    fn try_retain_endpoint_reservation(
        &mut self,
        service_id: &str,
    ) -> Result<bool, ServiceEngineError> {
        let source = self.service_environment_source(service_id)?;
        match self.endpoint_reservations.reserve(source, &self.endpoints) {
            Ok(()) => {
                self.endpoint_blocked_services.remove(service_id);
                Ok(true)
            }
            Err(_) => {
                self.endpoint_blocked_services.insert(service_id.to_owned());
                Ok(false)
            }
        }
    }

    fn release_endpoint_for_launch(&mut self, service_id: &str) -> Result<(), ServiceEngineError> {
        let source = self.service_environment_source(service_id)?;
        if !self.endpoint_reservations.release(source) {
            self.endpoint_blocked_services.insert(service_id.to_owned());
            return Err(ServiceEngineError::Invariant(
                "service launch had no exact endpoint reservation",
            ));
        }
        self.endpoint_blocked_services.remove(service_id);
        Ok(())
    }

    fn drive_retained_generation(
        &mut self,
        service_id: &str,
        snapshot: &DurableServiceSnapshot,
        now_ms: u64,
    ) -> Result<(), ServiceEngineError> {
        if snapshot.generation == 0 {
            return Ok(());
        }
        let key = (service_id.to_owned(), snapshot.generation);
        if self.pending_terminals.contains_key(&key) {
            return self.finish_pending_terminal(&key, now_ms);
        }
        let phase = match self
            .store
            .retained_durable_service_authority_phase(service_id, snapshot.generation)
        {
            Ok(phase) => phase,
            Err(DurableServiceStoreError::RetainedLaunchNotFound { .. }) => {
                if matches!(
                    snapshot.status.state,
                    RuntimeServiceState::Ready
                        | RuntimeServiceState::Busy
                        | RuntimeServiceState::Stopping
                ) {
                    return Err(ServiceEngineError::Invariant(
                        "durable live service has no retained process authority",
                    ));
                }
                return Ok(());
            }
            Err(error) => return Err(error.into()),
        };
        if snapshot.status.state == RuntimeServiceState::Stopping
            && matches!(
                phase,
                Some(
                    RetainedServiceAuthorityPhase::Claimed
                        | RetainedServiceAuthorityPhase::Residency
                        | RetainedServiceAuthorityPhase::Starting
                        | RetainedServiceAuthorityPhase::ReadyProof
                        | RetainedServiceAuthorityPhase::Resident
                )
            )
        {
            let tracker = self.stops.entry(key.clone()).or_insert(StopProgress {
                started_at: Instant::now(),
                force_sent: false,
            });
            let graceful =
                Duration::from_millis(self.registry.service(service_id)?.graceful_shutdown_ms)
                    .saturating_add(FORCE_STOP_PADDING);
            let force = tracker.force_sent || tracker.started_at.elapsed() >= graceful;
            let progress = self.store.retry_retained_durable_service_stop(
                service_id,
                snapshot.generation,
                force,
            )?;
            if force {
                tracker.force_sent = true;
            }
            return match progress {
                RetainedServiceStopProgress::DuplicateQuarantined => {
                    Err(ServiceEngineError::Invariant(
                        "duplicate deferred service stop was quarantined",
                    ))
                }
                RetainedServiceStopProgress::Bound
                | RetainedServiceStopProgress::AlreadyStopping
                | RetainedServiceStopProgress::Deferred { .. } => Ok(()),
            };
        }
        match phase {
            Some(RetainedServiceAuthorityPhase::Claimed) => match self.poll_process_event(&key)? {
                Some(ProcessOwnerEvent::Lifecycle(_)) => {
                    let (_, root_pid) = self
                        .store
                        .retained_durable_service_launch_pids(service_id, snapshot.generation)?;
                    if root_pid.is_some() {
                        self.store.settle_retained_durable_service_residency(
                            service_id,
                            snapshot.generation,
                            now_ms,
                        )?;
                    }
                }
                Some(ProcessOwnerEvent::Terminal(terminal)) => {
                    self.retain_terminal_and_finish(key, terminal, now_ms)?;
                }
                Some(ProcessOwnerEvent::Worker(_) | ProcessOwnerEvent::WorkerProtocolFault(_)) => {
                    return Err(ServiceEngineError::Invariant(
                        "service process emitted a finite-worker protocol event",
                    ));
                }
                None => {}
            },
            Some(RetainedServiceAuthorityPhase::Residency) => {
                self.store.settle_retained_durable_service_residency(
                    service_id,
                    snapshot.generation,
                    now_ms,
                )?;
            }
            Some(RetainedServiceAuthorityPhase::Starting)
            | Some(RetainedServiceAuthorityPhase::ReadyProof) => {
                let due = self
                    .next_readiness_probe
                    .get(&key)
                    .is_none_or(|deadline| Instant::now() >= *deadline);
                if due {
                    match self.store.advance_retained_durable_service_readiness(
                        service_id,
                        snapshot.generation,
                        now_ms,
                    )? {
                        RetainedServiceReadinessProgress::Pending { retry_after, .. } => {
                            let deadline = Instant::now()
                                .checked_add(retry_after)
                                .unwrap_or_else(Instant::now);
                            self.next_readiness_probe.insert(key, deadline);
                        }
                        RetainedServiceReadinessProgress::Ready
                        | RetainedServiceReadinessProgress::AlreadyReady => {
                            self.next_readiness_probe.remove(&key);
                        }
                        RetainedServiceReadinessProgress::ProcessExited => {
                            if let Some(ProcessOwnerEvent::Terminal(terminal)) =
                                self.poll_process_event(&key)?
                            {
                                self.retain_terminal_and_finish(key, terminal, now_ms)?;
                            }
                        }
                        RetainedServiceReadinessProgress::TimedOut => {
                            // The durable transition has already fenced this
                            // generation, released its leases, and published
                            // the single failure StopTree intent. Keep driving
                            // that exact tree to a proven exit. Only bootstrap
                            // decides whether this service is critical enough
                            // to fail host preparation; an optional service
                            // timing out must not take unrelated capabilities
                            // or the authoritative runtime down with it.
                            if self.bootstrap_critical_services.contains(service_id) {
                                self.bootstrap_generation_failures.insert(key);
                            }
                        }
                    }
                }
            }
            Some(RetainedServiceAuthorityPhase::Resident) => {
                if let Some(event) = self.poll_process_event(&key)? {
                    match event {
                        ProcessOwnerEvent::Terminal(terminal) => {
                            self.retain_terminal_and_finish(key, terminal, now_ms)?;
                        }
                        ProcessOwnerEvent::Lifecycle(_) => {}
                        ProcessOwnerEvent::Worker(_)
                        | ProcessOwnerEvent::WorkerProtocolFault(_) => {
                            return Err(ServiceEngineError::Invariant(
                                "service process emitted a finite-worker protocol event",
                            ));
                        }
                    }
                }
            }
            Some(RetainedServiceAuthorityPhase::Stopping) => {
                self.advance_stop(&key)?;
                if let Some(event) = self.poll_process_event(&key)? {
                    match event {
                        ProcessOwnerEvent::Terminal(terminal) => {
                            self.retain_terminal_and_finish(key, terminal, now_ms)?;
                        }
                        ProcessOwnerEvent::Lifecycle(_) => {}
                        ProcessOwnerEvent::Worker(_)
                        | ProcessOwnerEvent::WorkerProtocolFault(_) => {
                            return Err(ServiceEngineError::Invariant(
                                "stopping service emitted a finite-worker protocol event",
                            ));
                        }
                    }
                }
            }
            Some(RetainedServiceAuthorityPhase::NotCreated) => {
                if self.launch_retry_attempted.insert(key.clone()) {
                    if !self.try_retain_endpoint_reservation(service_id)? {
                        self.store.finish_retained_durable_service_not_created(
                            service_id,
                            snapshot.generation,
                            now_ms,
                        )?;
                        self.clear_generation_tracking(&key);
                        return Ok(());
                    }
                    self.release_endpoint_for_launch(service_id)?;
                    match self.store.retry_retained_durable_service_launch(
                        service_id,
                        snapshot.generation,
                        &self.generation,
                    )? {
                        ServiceLaunchRetentionDisposition::Retained => {}
                        ServiceLaunchRetentionDisposition::DuplicateQuarantined => {
                            return Err(ServiceEngineError::Invariant(
                                "duplicate retried service authority was quarantined",
                            ));
                        }
                    }
                } else {
                    self.store.finish_retained_durable_service_not_created(
                        service_id,
                        snapshot.generation,
                        now_ms,
                    )?;
                    let _reserved = self.try_retain_endpoint_reservation(service_id)?;
                    self.clear_generation_tracking(&key);
                }
            }
            Some(RetainedServiceAuthorityPhase::CreationUncertain) => {
                self.store
                    .request_retained_durable_service_emergency_shutdown(
                        service_id,
                        snapshot.generation,
                    )?;
                return Err(ServiceEngineError::Invariant(
                    "service process creation became uncertain",
                ));
            }
            Some(RetainedServiceAuthorityPhase::ExitProof) => {
                return Err(ServiceEngineError::Invariant(
                    "service exit proof lost its retained terminal receipt",
                ));
            }
            None => {
                return Err(ServiceEngineError::Invariant(
                    "service authority table entry temporarily had no phase",
                ));
            }
        }
        Ok(())
    }

    fn poll_process_event(
        &self,
        key: &ServiceKey,
    ) -> Result<Option<ProcessOwnerEvent>, ServiceEngineError> {
        match self
            .store
            .read_retained_durable_service_launch_event(&key.0, key.1, Duration::ZERO)
        {
            Ok(event) => Ok(Some(event)),
            Err(DurableServiceStoreError::ProcessOwner(ProcessOwnerError::EventWaitTimeout)) => {
                Ok(None)
            }
            Err(error) => Err(error.into()),
        }
    }

    fn retain_terminal_and_finish(
        &mut self,
        key: ServiceKey,
        terminal: ProcessOwnerTerminal,
        now_ms: u64,
    ) -> Result<(), ServiceEngineError> {
        self.pending_terminals.insert(key.clone(), terminal);
        self.finish_pending_terminal(&key, now_ms)
    }

    fn finish_pending_terminal(
        &mut self,
        key: &ServiceKey,
        now_ms: u64,
    ) -> Result<(), ServiceEngineError> {
        let terminal = self
            .pending_terminals
            .get(key)
            .ok_or(ServiceEngineError::Invariant(
                "pending terminal receipt disappeared",
            ))?;
        let worker_cold_start_target_exit =
            terminal.classification() == ProcessExitClassification::TargetExit;
        match self
            .store
            .confirm_and_finish_retained_durable_service_exit(&key.0, key.1, terminal, now_ms)
        {
            Ok(_) => {
                if worker_cold_start_target_exit {
                    for held in self.held_leases.values_mut().filter(|held| {
                        held.claim.service_id() == key.0
                            && held.claim.generation() == key.1
                            && held.pending_reply.is_some()
                            && held.pending_worker_dependency.is_some()
                            && matches!(&held.owner, HeldLeaseOwner::WorkerInstance { .. })
                            && !held.worker_cold_start_reacquire_used
                    }) {
                        held.worker_cold_start_target_exit = true;
                    }
                }
                let _reserved = self.try_retain_endpoint_reservation(&key.0)?;
                self.clear_generation_tracking(key);
                Ok(())
            }
            Err(DurableServiceStoreError::ProcessOwner(ProcessOwnerError::EventWaitTimeout)) => {
                Ok(())
            }
            Err(error) => Err(error.into()),
        }
    }

    fn advance_stop(&mut self, key: &ServiceKey) -> Result<(), ServiceEngineError> {
        let tracker = self.stops.entry(key.clone()).or_insert(StopProgress {
            started_at: Instant::now(),
            force_sent: false,
        });
        let definition = self.registry.service(&key.0)?;
        let graceful = Duration::from_millis(definition.graceful_shutdown_ms)
            .saturating_add(FORCE_STOP_PADDING);
        if !tracker.force_sent && tracker.started_at.elapsed() >= graceful {
            self.store
                .request_retained_durable_service_stop(&key.0, key.1, true)?;
            tracker.force_sent = true;
        }
        Ok(())
    }

    fn schedule_eager_restarts(&mut self, now_ms: u64) -> Result<(), ServiceEngineError> {
        let snapshots = self.refresh_snapshots()?;
        for service_id in self.service_ids() {
            let snapshot = snapshots
                .get(&service_id)
                .ok_or(ServiceEngineError::Invariant(
                    "eager restart snapshot disappeared",
                ))?;
            if self.registry.service(&service_id)?.startup_policy != ServiceStartupPolicy::Eager
                || !service_state_allows_automatic_eager_restart(snapshot.status.state)
            {
                continue;
            }
            let Some(durable_due) = snapshot.restart.next_attempt_at_ms() else {
                continue;
            };
            let local_due = self
                .next_eager_attempt_ms
                .get(&service_id)
                .copied()
                .unwrap_or(durable_due);
            if now_ms >= durable_due.max(local_due) {
                if let Err(error) = self.require_dependencies_ready(&service_id) {
                    if matches!(&error, ServiceEngineError::RequiredServiceUnavailable(_)) {
                        self.next_eager_attempt_ms
                            .insert(service_id, now_ms.saturating_add(1_000));
                        continue;
                    }
                    return Err(error);
                }
                self.begin_eager_start(&service_id, false)?;
            }
        }
        Ok(())
    }

    fn require_dependencies_ready(&self, service_id: &str) -> Result<(), ServiceEngineError> {
        for dependency in &self.registry.service(service_id)?.dependencies {
            let snapshot = self.store.durable_service_snapshot(dependency)?;
            if !matches!(
                snapshot.status.state,
                RuntimeServiceState::Ready | RuntimeServiceState::Busy
            ) {
                return Err(ServiceEngineError::RequiredServiceUnavailable(
                    dependency.clone(),
                ));
            }
        }
        Ok(())
    }

    fn refresh_snapshots(
        &self,
    ) -> Result<BTreeMap<String, DurableServiceSnapshot>, ServiceEngineError> {
        let mut snapshots = self
            .store
            .durable_service_snapshots()?
            .into_iter()
            .map(|snapshot| (snapshot.status.id.clone(), snapshot))
            .collect::<BTreeMap<_, _>>();
        let mut ordered = BTreeMap::new();
        for service_id in self.registry.service_ids_in_dependency_order() {
            let snapshot = snapshots
                .remove(service_id)
                .ok_or(ServiceEngineError::Invariant(
                    "registered service snapshot disappeared",
                ))?;
            ordered.insert(service_id.to_owned(), snapshot);
        }
        if !snapshots.is_empty() {
            return Err(ServiceEngineError::Invariant(
                "durable store contained an unregistered service",
            ));
        }
        Ok(ordered)
    }

    fn refresh_and_reconcile(&mut self) -> Result<(), ServiceEngineError> {
        let snapshots = self.refresh_snapshots()?;
        let mut statuses = Vec::with_capacity(snapshots.len());
        for service_id in self.registry.service_ids_in_dependency_order() {
            let snapshot = snapshots
                .get(service_id)
                .ok_or(ServiceEngineError::Invariant(
                    "ordered service snapshot disappeared",
                ))?;
            statuses.push(snapshot.status.clone());
        }
        *self
            .statuses
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = statuses;
        if self.ready_published.load(Ordering::Acquire)
            && required_startup_services_are_ready(&self.statuses, &self.required_startup_services)
            && !self.shutdown.is_accepting_work()
        {
            open_runtime_admission_during_reconciliation(&self.shutdown)?;
        }
        self.reconcile_held_leases(&snapshots)
    }

    fn reconcile_held_leases(
        &mut self,
        snapshots: &BTreeMap<String, DurableServiceSnapshot>,
    ) -> Result<(), ServiceEngineError> {
        let now_ms = self.clock.now_ms();
        let now = Instant::now();
        let dashboard_id =
            breadboard_runtime_core::TrustedServiceEnvironmentProfile::Dashboard.service_id();
        let dashboard = snapshots
            .get(dashboard_id)
            .ok_or(ServiceEngineError::Invariant(
                "dashboard service snapshot disappeared",
            ))?;
        let lease_ids = self.held_leases.keys().cloned().collect::<Vec<_>>();
        for lease_id in lease_ids {
            let Some(held) = self.held_leases.get(&lease_id) else {
                continue;
            };
            let pending_deadline_expired = held
                .pending_deadline
                .is_some_and(|deadline| now >= deadline);
            let pending_deadline = held.pending_deadline;
            let claim_expired = held.claim.expires_at_ms() <= now_ms;
            let owner = held.owner.clone();
            let service_id = held.claim.service_id().to_owned();
            let service_generation = held.claim.generation();
            let pending_reply = held.pending_reply.is_some();
            let pending_worker_dependency = held.pending_worker_dependency.is_some()
                && matches!(&held.owner, HeldLeaseOwner::WorkerInstance { .. });
            let worker_cold_start_target_exit = held.worker_cold_start_target_exit;
            let worker_cold_start_restart = held.worker_cold_start_restart;
            let worker_cold_start_reacquire_used = held.worker_cold_start_reacquire_used;
            let snapshot = snapshots
                .get(&service_id)
                .ok_or(ServiceEngineError::Invariant(
                    "held lease referenced an unknown service",
                ))?;
            let owner_is_current = match owner {
                HeldLeaseOwner::DashboardGeneration(owner_dashboard_generation) => {
                    dashboard_generation_can_own_lease(
                        dashboard.generation,
                        dashboard.status.state,
                        owner_dashboard_generation,
                    )
                }
                HeldLeaseOwner::RuntimeGateway {
                    schedule_id,
                    decision_epoch,
                } => self
                    .store
                    .runtime_schedule_snapshot(&schedule_id)?
                    .is_some_and(|schedule| {
                        schedule.kind == RuntimeScheduleKind::Gateway
                            && schedule.decision_epoch == decision_epoch
                            && schedule.desired_state == RuntimeScheduleDesiredState::Running
                    }),
                HeldLeaseOwner::RuntimeServiceIntent {
                    service_id,
                    decision_epoch,
                } => self
                    .store
                    .runtime_schedule_snapshot(&service_id)?
                    .is_some_and(|schedule| {
                        schedule.kind == RuntimeScheduleKind::Service
                            && schedule.decision_epoch == decision_epoch
                            && schedule.desired_state == RuntimeScheduleDesiredState::Running
                    }),
                // Worker-instance ownership is released synchronously by the
                // dispatcher only after its authoritative descendant-tree exit
                // receipt. Dashboard lifecycle can never revoke this lease.
                HeldLeaseOwner::WorkerInstance { .. } => true,
            };
            let service_is_live = service_generation_can_own_lease(
                snapshot.generation,
                snapshot.status.state,
                service_generation,
            );

            if pending_deadline_expired || !owner_is_current {
                self.revoke_held_lease(&lease_id, now_ms)?;
                continue;
            }
            if let Some(restart) = worker_cold_start_restart {
                if !self.shutdown.is_accepting_work()
                    || now_ms >= restart.window_ends_at_ms
                    || !worker_cold_start_reacquire_still_permitted(
                        self.registry.service(&service_id)?.startup_policy,
                        self.registry.service(&service_id)?.restart_policy,
                        snapshot,
                        service_generation,
                        restart,
                        now_ms,
                    )
                {
                    self.revoke_held_lease(&lease_id, now_ms)?;
                    continue;
                }
                if now_ms < restart.eligible_at_ms {
                    continue;
                }
                self.reacquire_worker_cold_start_dependency(&lease_id, now_ms)?;
                continue;
            }
            if !service_is_live {
                let definition = self.registry.service(&service_id)?;
                let restart = worker_cold_start_reacquire_schedule(
                    definition.startup_policy,
                    definition.restart_policy,
                    snapshot,
                    service_generation,
                    pending_reply && pending_worker_dependency,
                    worker_cold_start_target_exit,
                    worker_cold_start_reacquire_used,
                    self.shutdown.is_accepting_work(),
                );
                let restart_fits_deadline = restart.is_some_and(|schedule| {
                    worker_cold_start_restart_fits_deadline(schedule, now_ms, now, pending_deadline)
                });
                if restart_fits_deadline {
                    let held = self.held_leases.get_mut(&lease_id).ok_or(
                        ServiceEngineError::Invariant(
                            "worker dependency lease disappeared before restart deferral",
                        ),
                    )?;
                    held.worker_cold_start_restart = restart;
                    held.worker_cold_start_reacquire_used = true;
                    continue;
                }
                self.revoke_held_lease(&lease_id, now_ms)?;
                continue;
            }
            if claim_expired {
                let mut held = self
                    .held_leases
                    .remove(&lease_id)
                    .expect("observed lease must remain present");
                if let Some(reply) = held.pending_reply.take() {
                    let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
                }
                self.remember_release(lease_id, now_ms);
                continue;
            }
            if !pending_reply {
                continue;
            }
            if matches!(
                snapshot.status.state,
                RuntimeServiceState::Ready | RuntimeServiceState::Busy
            ) {
                let reply = self
                    .held_leases
                    .get_mut(&lease_id)
                    .and_then(|held| {
                        held.pending_deadline = None;
                        held.pending_reply.take()
                    })
                    .ok_or(ServiceEngineError::Invariant(
                        "pending service lease responder disappeared",
                    ))?;
                self.deliver_acquired_lease(&lease_id, reply)?;
            }
        }
        Ok(())
    }

    fn reacquire_worker_cold_start_dependency(
        &mut self,
        lease_id: &str,
        now_ms: u64,
    ) -> Result<(), ServiceEngineError> {
        let mut held = self
            .held_leases
            .remove(lease_id)
            .ok_or(ServiceEngineError::Invariant(
                "worker dependency restart lease disappeared",
            ))?;
        match self.store.release_durable_service_lease(
            &held.claim,
            ServiceLeaseReleaseReason::Disconnect,
            now_ms,
        ) {
            Ok(_) | Err(DurableServiceStoreError::LeaseNotFound(_)) => {}
            Err(error) => {
                self.held_leases.insert(lease_id.to_owned(), held);
                return Err(error.into());
            }
        }
        let dependency =
            held.pending_worker_dependency
                .take()
                .ok_or(ServiceEngineError::Invariant(
                    "worker dependency restart lost its registry authority",
                ))?;
        let reply = held
            .pending_reply
            .take()
            .ok_or(ServiceEngineError::Invariant(
                "worker dependency restart lost its pending responder",
            ))?;
        let pending_deadline = held.pending_deadline.ok_or(ServiceEngineError::Invariant(
            "worker dependency restart lost its original deadline",
        ))?;
        let owner = held.owner;
        self.remember_release(lease_id.to_owned(), now_ms);
        self.begin_owned_acquire_with_deadline(
            OwnedServiceAcquireAuthority::WorkerDependency(dependency),
            owner,
            reply,
            Some(pending_deadline),
            true,
            false,
        )
    }

    fn revoke_held_lease(&mut self, lease_id: &str, now_ms: u64) -> Result<(), ServiceEngineError> {
        let mut held = self
            .held_leases
            .remove(lease_id)
            .ok_or(ServiceEngineError::Invariant(
                "revoked service lease disappeared",
            ))?;
        match self.store.release_durable_service_lease(
            &held.claim,
            ServiceLeaseReleaseReason::Disconnect,
            now_ms,
        ) {
            Ok(_) | Err(DurableServiceStoreError::LeaseNotFound(_)) => {}
            Err(error) => {
                self.held_leases.insert(lease_id.to_owned(), held);
                return Err(error.into());
            }
        }
        if let Some(reply) = held.pending_reply.take() {
            let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
        }
        self.remember_release(lease_id.to_owned(), now_ms);
        Ok(())
    }

    fn deliver_acquired_lease(
        &mut self,
        lease_id: &str,
        reply: AcquireReplySender,
    ) -> Result<(), ServiceEngineError> {
        let held = self
            .held_leases
            .get(lease_id)
            .ok_or(ServiceEngineError::Invariant(
                "delivered service lease disappeared",
            ))?;
        let response = RuntimeServiceLeaseAcquireResponse {
            ok: true,
            lease_id: held.claim.lease_id().to_owned(),
            service_id: held.claim.service_id().to_owned(),
        };
        if reply.send_control(Ok(response)) {
            return Ok(());
        }
        let held = self
            .held_leases
            .remove(lease_id)
            .expect("undeliverable lease must remain present");
        let now_ms = self.clock.now_ms();
        self.store.release_durable_service_lease(
            &held.claim,
            ServiceLeaseReleaseReason::Disconnect,
            now_ms,
        )?;
        self.remember_release(lease_id.to_owned(), now_ms);
        Ok(())
    }

    fn fresh_lease_id(&self) -> Result<String, ServiceEngineError> {
        for _ in 0..MAX_IDENTITY_ATTEMPTS {
            let mut random = [0_u8; LEASE_ID_RANDOM_BYTES];
            getrandom::getrandom(&mut random)
                .map_err(|_| ServiceEngineError::IdentityGeneration)?;
            let mut lease_id = String::with_capacity("lease_".len() + random.len() * 2);
            lease_id.push_str("lease_");
            const HEX: &[u8; 16] = b"0123456789abcdef";
            for byte in random {
                lease_id.push(char::from(HEX[usize::from(byte >> 4)]));
                lease_id.push(char::from(HEX[usize::from(byte & 0x0f)]));
            }
            random.fill(0);
            if !self.held_leases.contains_key(&lease_id)
                && !self.release_tombstones.contains_key(&lease_id)
            {
                return Ok(lease_id);
            }
        }
        Err(ServiceEngineError::IdentityGeneration)
    }

    fn remember_release(&mut self, lease_id: String, now_ms: u64) {
        let expires_at = now_ms.saturating_add(RELEASE_TOMBSTONE_TTL_MS);
        if self
            .release_tombstones
            .insert(lease_id.clone(), expires_at)
            .is_none()
        {
            self.release_tombstone_order.push_back(lease_id);
        }
        self.prune_tombstones(now_ms);
    }

    fn prune_tombstones(&mut self, now_ms: u64) {
        while let Some(lease_id) = self.release_tombstone_order.front() {
            let remove = self
                .release_tombstones
                .get(lease_id)
                .is_none_or(|expires_at| {
                    *expires_at <= now_ms || self.release_tombstones.len() > MAX_RELEASE_TOMBSTONES
                });
            if !remove {
                break;
            }
            let lease_id = self
                .release_tombstone_order
                .pop_front()
                .expect("observed release tombstone must remain queued");
            self.release_tombstones.remove(&lease_id);
        }
    }

    fn clear_generation_tracking(&mut self, key: &ServiceKey) {
        self.next_readiness_probe.remove(key);
        self.launch_retry_attempted.remove(key);
        self.pending_terminals.remove(key);
        self.stops.remove(key);
    }

    fn shutdown_bounded(&mut self) -> Result<(), ServiceEngineError> {
        let now_ms = self.clock.now_ms();
        self.store.begin_durable_service_shutdown(now_ms)?;
        // A failed outbox transition returns its complete unacknowledged
        // authority. The shutdown transaction above supersedes that claimed
        // start (which by construction never crossed CreateProcess) or fences
        // the failed stop acknowledgement before this value is released.
        match self.quarantined_intent.take() {
            Some(QuarantinedIntent::Claim(_claim)) => {}
            Some(QuarantinedIntent::Launch(_claim, _request)) => {}
            None => {}
        }
        self.fail_pending_acquires();
        let deadline =
            Instant::now()
                .checked_add(SHUTDOWN_TIMEOUT)
                .ok_or(ServiceEngineError::Controller(
                    "shutdown deadline overflowed".to_owned(),
                ))?;
        let mut first_error = None;
        loop {
            if let Err(error) = self.drive_once(true) {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
            if self.all_services_drained()? {
                return match first_error {
                    Some(error) => Err(error),
                    None => Ok(()),
                };
            }
            if Instant::now() >= deadline {
                return Err(first_error.unwrap_or_else(|| {
                    ServiceEngineError::Controller(
                        "bounded service shutdown did not prove every tree exited".to_owned(),
                    )
                }));
            }
            thread::sleep(CONTROLLER_TICK);
        }
    }

    fn fail_pending_acquires(&mut self) {
        for held in self.held_leases.values_mut() {
            if let Some(reply) = held.pending_reply.take() {
                let _ = reply.send_control(Err(RuntimeServiceControlError::Unavailable));
            }
            held.pending_deadline = None;
        }
        if let Some(pending) = self.pending_recall_reconcile.take() {
            let _ = pending
                .reply
                .send(Err(RuntimeServiceControlError::Unavailable));
        }
        self.pending_recall_acquire = None;
    }

    fn all_services_drained(&self) -> Result<bool, ServiceEngineError> {
        for snapshot in self.refresh_snapshots()?.into_values() {
            if matches!(
                snapshot.status.state,
                RuntimeServiceState::Starting
                    | RuntimeServiceState::Ready
                    | RuntimeServiceState::Busy
                    | RuntimeServiceState::Stopping
            ) {
                return Ok(false);
            }
            if snapshot.generation > 0 {
                match self.store.retained_durable_service_authority_phase(
                    &snapshot.status.id,
                    snapshot.generation,
                ) {
                    Ok(Some(_) | None) => return Ok(false),
                    Err(DurableServiceStoreError::RetainedLaunchNotFound { .. }) => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        Ok(true)
    }

    fn service_ids(&self) -> Vec<String> {
        self.registry
            .service_ids_in_dependency_order()
            .map(str::to_owned)
            .collect()
    }
}

fn schedule_desired_state(state: RuntimeDesiredState) -> RuntimeScheduleDesiredState {
    match state {
        RuntimeDesiredState::Running => RuntimeScheduleDesiredState::Running,
        RuntimeDesiredState::Stopped => RuntimeScheduleDesiredState::Stopped,
    }
}

fn runtime_desired_state(state: RuntimeScheduleDesiredState) -> RuntimeDesiredState {
    match state {
        RuntimeScheduleDesiredState::Running => RuntimeDesiredState::Running,
        RuntimeScheduleDesiredState::Stopped => RuntimeDesiredState::Stopped,
    }
}

fn recall_service_has_no_resident_tree(state: RuntimeServiceState) -> bool {
    matches!(
        state,
        RuntimeServiceState::AvailableButStopped
            | RuntimeServiceState::ResourceBlocked
            | RuntimeServiceState::InstallationUnavailable
            | RuntimeServiceState::Failed
    )
}

fn advance_recall_restart_barrier(
    barrier_epoch: &mut Option<u64>,
    intent_epoch: u64,
    state: RuntimeServiceState,
) -> bool {
    if barrier_epoch.is_none() {
        return true;
    }
    *barrier_epoch = Some(intent_epoch);
    if recall_service_has_no_resident_tree(state) {
        *barrier_epoch = None;
        true
    } else {
        false
    }
}

fn recall_log_tail(paths: &RuntimePaths) -> Result<Vec<String>, ServiceEngineError> {
    // The service logger is itself capped, but read a larger bounded window so
    // the public projection can preserve complete final lines before applying
    // its much smaller response limit.
    let bytes = paths.read_bounded_service_log("recall", 512 * 1024)?;
    let text = String::from_utf8_lossy(&bytes);
    let mut retained = VecDeque::new();
    let mut retained_bytes = 0_usize;
    for line in text.lines().rev() {
        let redacted = line.replace('\0', "");
        if redacted.is_empty() {
            continue;
        }
        let line_bytes = redacted.len();
        if retained.len() >= MAX_RECALL_LOG_LINES
            || retained_bytes.saturating_add(line_bytes) > MAX_RECALL_LOG_TAIL_BYTES
        {
            break;
        }
        retained_bytes = retained_bytes.saturating_add(line_bytes);
        retained.push_front(redacted);
    }
    Ok(retained.into_iter().collect())
}

fn desired_state_text(state: RuntimeScheduleDesiredState) -> &'static str {
    match state {
        RuntimeScheduleDesiredState::Running => "running",
        RuntimeScheduleDesiredState::Stopped => "stopped",
    }
}

fn reconcile_trigger_text(trigger: RuntimeReconcileTrigger) -> &'static str {
    match trigger {
        RuntimeReconcileTrigger::Startup => "startup",
        RuntimeReconcileTrigger::Explicit => "explicit",
    }
}

fn gateway_for_schedule(schedule_id: &str) -> Result<RuntimeGatewayId, ServiceEngineError> {
    match schedule_id {
        "telegram-gateway" => Ok(RuntimeGatewayId::Telegram),
        "whatsapp-gateway" => Ok(RuntimeGatewayId::Whatsapp),
        _ => Err(ServiceEngineError::Invariant("unknown gateway schedule")),
    }
}

fn reconciliation_payload(
    snapshot: &RuntimeScheduleSnapshot,
) -> Result<JobSubmissionPayload, ServiceEngineError> {
    let trigger = snapshot
        .reconcile_trigger
        .ok_or(ServiceEngineError::Invariant(
            "reconciliation trigger disappeared",
        ))?;
    let desired_state = snapshot.reconcile_requested_state.map(desired_state_text);
    let request_payload = match snapshot.kind {
        RuntimeScheduleKind::Gateway => serde_json::json!({
            "protocolVersion": 1,
            "operation": "gateway-reconcile",
            "gateway": gateway_for_schedule(&snapshot.schedule_id)?.as_str(),
            "trigger": reconcile_trigger_text(trigger),
            "desiredState": desired_state,
            "decisionEpoch": snapshot.decision_epoch,
        }),
        RuntimeScheduleKind::Dynamic => serde_json::json!({
            "protocolVersion": 1,
            "operation": "schedule-reconcile",
            "schedule": snapshot.schedule_id,
            "trigger": reconcile_trigger_text(trigger),
            "desiredState": desired_state,
            "decisionEpoch": snapshot.decision_epoch,
        }),
        RuntimeScheduleKind::Fixed => {
            return Err(ServiceEngineError::Invariant(
                "fixed schedule requested reconciliation",
            ))
        }
        RuntimeScheduleKind::Service => {
            return Err(ServiceEngineError::Invariant(
                "desired-state service requested worker reconciliation",
            ))
        }
    };
    Ok(JobSubmissionPayload {
        job_type: "background-task".into(),
        garden_id: None,
        conversation_id: None,
        idempotency_key: format!(
            "runtime-reconcile-{}-{}",
            snapshot.schedule_id, snapshot.decision_epoch
        ),
        input_uploads: Vec::new(),
        request_payload,
    })
}

fn occurrence_payload(
    occurrence: &RuntimeScheduleOccurrence,
) -> Result<JobSubmissionPayload, ServiceEngineError> {
    let (job_type, request_payload) = if occurrence.schedule_id == "learn-recovery" {
        ("learn", serde_json::json!({ "operation": "recovery" }))
    } else {
        match occurrence.schedule_id.as_str() {
            "hermes-abandoned-run-recovery"
            | "scheduled-chats"
            | "memory-autofetch"
            | "review-scheduler"
            | "caldav-sync"
            | "skills-catalog-refresh"
            | "email-poll"
            | "ifixai-maintenance" => {}
            _ => return Err(ServiceEngineError::Invariant("unknown finite schedule")),
        }
        (
            "background-task",
            serde_json::json!({
                "protocolVersion": 1,
                "operation": occurrence.schedule_id,
            }),
        )
    };
    Ok(JobSubmissionPayload {
        job_type: job_type.into(),
        garden_id: None,
        conversation_id: None,
        idempotency_key: format!(
            "runtime-schedule-{}-{}",
            occurrence.schedule_id, occurrence.due_at_ms
        ),
        input_uploads: Vec::new(),
        request_payload,
    })
}

fn validate_background_result_envelope(
    envelope: &BackgroundResultEnvelope,
    job: &JobRecord,
) -> Result<(), ServiceEngineError> {
    if envelope.protocol_version != 1
        || envelope.identity.job_id != job.job_id
        || envelope.identity.attempt != job.attempt
        || Some(envelope.identity.worker_instance_id.as_str()) != job.worker_instance_id.as_deref()
        || envelope.completion_sequence == 0
        || envelope.completion_sequence != job.last_worker_sequence
    {
        return Err(ServiceEngineError::Invariant(
            "background result identity escaped its worker fence",
        ));
    }
    Ok(())
}

fn dashboard_generation_can_own_lease(
    dashboard_generation: u64,
    dashboard_state: RuntimeServiceState,
    owner_generation: u64,
) -> bool {
    owner_generation != 0
        && dashboard_generation == owner_generation
        && matches!(
            dashboard_state,
            RuntimeServiceState::Ready | RuntimeServiceState::Busy
        )
}

fn service_generation_can_own_lease(
    service_generation: u64,
    service_state: RuntimeServiceState,
    lease_generation: u64,
) -> bool {
    lease_generation != 0
        && service_generation == lease_generation
        && matches!(
            service_state,
            RuntimeServiceState::Starting | RuntimeServiceState::Ready | RuntimeServiceState::Busy
        )
}

fn service_state_requires_endpoint_reservation(state: RuntimeServiceState) -> bool {
    matches!(
        state,
        RuntimeServiceState::AvailableButStopped
            | RuntimeServiceState::ResourceBlocked
            | RuntimeServiceState::InstallationUnavailable
            | RuntimeServiceState::Failed
    )
}

#[allow(clippy::too_many_arguments)]
fn worker_cold_start_reacquire_schedule(
    startup_policy: ServiceStartupPolicy,
    restart_policy: RestartPolicy,
    snapshot: &DurableServiceSnapshot,
    lease_generation: u64,
    pending_worker_dependency: bool,
    target_exit: bool,
    reacquire_used: bool,
    accepting_work: bool,
) -> Option<DurableServiceRestartSchedule> {
    if startup_policy != ServiceStartupPolicy::OnDemand
        || restart_policy != RestartPolicy::OnFailure
        || snapshot.status.state != RuntimeServiceState::Failed
        || snapshot.generation != lease_generation
        || !pending_worker_dependency
        || !target_exit
        || reacquire_used
        || !accepting_work
    {
        return None;
    }
    match snapshot.restart {
        DurableServiceRestartStatus::Deferred(schedule)
            if !schedule.window_exhausted
                && schedule.attempts_in_window < schedule.maximum_restarts
                && schedule.eligible_at_ms < schedule.window_ends_at_ms =>
        {
            Some(schedule)
        }
        DurableServiceRestartStatus::Disabled
        | DurableServiceRestartStatus::PolicyBindingRequired
        | DurableServiceRestartStatus::Idle { .. }
        | DurableServiceRestartStatus::Deferred(_) => None,
    }
}

fn worker_cold_start_reacquire_still_permitted(
    startup_policy: ServiceStartupPolicy,
    restart_policy: RestartPolicy,
    snapshot: &DurableServiceSnapshot,
    failed_generation: u64,
    original: DurableServiceRestartSchedule,
    now_ms: u64,
) -> bool {
    if startup_policy != ServiceStartupPolicy::OnDemand
        || restart_policy != RestartPolicy::OnFailure
    {
        return false;
    }
    if snapshot.status.state == RuntimeServiceState::Failed
        && snapshot.generation == failed_generation
    {
        return matches!(
            snapshot.restart,
            DurableServiceRestartStatus::Deferred(current)
                if current == original
                    && !current.window_exhausted
                    && current.attempts_in_window < current.maximum_restarts
                    && now_ms < current.window_ends_at_ms
        );
    }
    snapshot.generation > failed_generation
        && matches!(
            snapshot.status.state,
            RuntimeServiceState::Starting | RuntimeServiceState::Ready | RuntimeServiceState::Busy
        )
}

fn worker_cold_start_restart_fits_deadline(
    schedule: DurableServiceRestartSchedule,
    now_ms: u64,
    now: Instant,
    pending_deadline: Option<Instant>,
) -> bool {
    let wait = Duration::from_millis(schedule.eligible_at_ms.saturating_sub(now_ms));
    pending_deadline.is_some_and(|deadline| now.checked_add(wait).is_some_and(|due| due < deadline))
}

fn service_state_allows_automatic_eager_restart(state: RuntimeServiceState) -> bool {
    state == RuntimeServiceState::Failed
}

fn eager_start_requires_fresh_host_retry(
    error: &ServiceEngineError,
    service_id: &str,
    restart_policy: RestartPolicy,
) -> bool {
    restart_policy == RestartPolicy::OnFailure
        && matches!(
            error,
            ServiceEngineError::Store(DurableServiceStoreError::Lease(
                ServiceLeaseError::RestartForbidden(failed_service)
            )) if failed_service == service_id
        )
}

fn expected_acquire_error(error: &DurableServiceStoreError) -> Option<RuntimeServiceControlError> {
    match error {
        DurableServiceStoreError::ServiceNotFound(_) => Some(RuntimeServiceControlError::NotFound),
        DurableServiceStoreError::Lease(
            ServiceLeaseError::LeaseLimitReached { .. }
            | ServiceLeaseError::ServiceStopping(_)
            | ServiceLeaseError::DuplicateLease(_),
        )
        | DurableServiceStoreError::DuplicateLease(_) => Some(RuntimeServiceControlError::Conflict),
        DurableServiceStoreError::Store(StoreError::AdmissionClosed)
        | DurableServiceStoreError::Lease(
            ServiceLeaseError::AcquisitionClosed(_)
            | ServiceLeaseError::RestartForbidden(_)
            | ServiceLeaseError::RestartLimitReached { .. },
        ) => Some(RuntimeServiceControlError::Unavailable),
        _ => None,
    }
}

fn expected_release_error(error: &DurableServiceStoreError) -> Option<RuntimeServiceControlError> {
    match error {
        DurableServiceStoreError::LeaseNotFound(_) => Some(RuntimeServiceControlError::NotFound),
        DurableServiceStoreError::Store(StoreError::AdmissionClosed) => {
            Some(RuntimeServiceControlError::Unavailable)
        }
        _ => None,
    }
}

fn finish_controller_thread(
    run: std::thread::Result<Result<(), String>>,
    cleanup: std::thread::Result<Result<(), ServiceEngineError>>,
) -> Result<(), String> {
    let cleanup_error = match cleanup {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(error.to_string()),
        Err(_) => Some("service-controller cleanup panicked".to_owned()),
    };
    match run {
        Ok(Ok(())) => cleanup_error.map_or(Ok(()), Err),
        Ok(Err(error)) => match cleanup_error {
            Some(cleanup) => Err(format!("{error}; cleanup also failed: {cleanup}")),
            None => Err(error),
        },
        Err(_) => match cleanup_error {
            Some(cleanup) => Err(format!(
                "service-controller thread panicked; cleanup also failed: {cleanup}"
            )),
            None => Err("service-controller thread panicked".to_owned()),
        },
    }
}

fn controller_cleanup_after_run<F>(
    run: &std::thread::Result<Result<(), String>>,
    cleanup: F,
) -> std::thread::Result<Result<(), ServiceEngineError>>
where
    F: FnOnce() -> Result<(), ServiceEngineError>,
{
    if matches!(run, Ok(Ok(()))) {
        // Every successful return from `ServiceController::run` is the result
        // of a successful bounded shutdown. Preserve the finally boundary for
        // errors and panics without replaying completed durable lifecycle work.
        Ok(Ok(()))
    } else {
        catch_unwind(AssertUnwindSafe(cleanup))
    }
}

fn join_controller_errors(
    error: ServiceEngineError,
    cleanup: Option<ServiceEngineError>,
) -> String {
    match cleanup {
        Some(cleanup) => format!("{error}; cleanup also failed: {cleanup}"),
        None => error.to_string(),
    }
}

struct EndpointReservations {
    slots: [Option<TcpListener>; TrustedServiceEnvironmentSource::COUNT],
    auxiliary_slots: [Option<TcpListener>; ServiceAuxiliaryEndpoint::COUNT],
}

fn auxiliary_endpoints_for(
    source: TrustedServiceEnvironmentSource,
) -> &'static [ServiceAuxiliaryEndpoint] {
    const NONE: &[ServiceAuxiliaryEndpoint] = &[];
    const POSTIZ: &[ServiceAuxiliaryEndpoint] = &[ServiceAuxiliaryEndpoint::PostizWeb];
    const INBOX: &[ServiceAuxiliaryEndpoint] = &[
        ServiceAuxiliaryEndpoint::InboxWeb,
        ServiceAuxiliaryEndpoint::InboxDatabase,
        ServiceAuxiliaryEndpoint::InboxRedis,
        ServiceAuxiliaryEndpoint::InboxRedisHttp,
    ];
    match source {
        TrustedServiceEnvironmentSource::PostizCoordinator => POSTIZ,
        TrustedServiceEnvironmentSource::InboxZeroStack => INBOX,
        _ => NONE,
    }
}

impl EndpointReservations {
    fn release(&mut self, source: TrustedServiceEnvironmentSource) -> bool {
        if self.slots[source.index()].is_none()
            || auxiliary_endpoints_for(source)
                .iter()
                .any(|endpoint| self.auxiliary_slots[endpoint.index()].is_none())
        {
            return false;
        }
        self.slots[source.index()].take();
        for endpoint in auxiliary_endpoints_for(source) {
            self.auxiliary_slots[endpoint.index()].take();
        }
        true
    }

    fn reserve(
        &mut self,
        source: TrustedServiceEnvironmentSource,
        endpoints: &ServiceEndpointMap,
    ) -> io::Result<()> {
        let required_auxiliaries = auxiliary_endpoints_for(source);
        if self.slots[source.index()].is_some()
            && required_auxiliaries
                .iter()
                .all(|endpoint| self.auxiliary_slots[endpoint.index()].is_some())
        {
            return Ok(());
        }
        if self.slots[source.index()].is_some()
            || required_auxiliaries
                .iter()
                .any(|endpoint| self.auxiliary_slots[endpoint.index()].is_some())
        {
            return Err(io::Error::new(
                io::ErrorKind::AddrInUse,
                "partial service endpoint reservation",
            ));
        }
        let primary = TcpListener::bind(SocketAddrV4::new(
            Ipv4Addr::LOCALHOST,
            endpoints.port_for(source).get(),
        ))?;
        let mut auxiliaries = Vec::with_capacity(required_auxiliaries.len());
        for endpoint in required_auxiliaries {
            auxiliaries.push((
                *endpoint,
                TcpListener::bind(SocketAddrV4::new(
                    Ipv4Addr::LOCALHOST,
                    endpoints.auxiliary_port_for(*endpoint).get(),
                ))?,
            ));
        }
        self.slots[source.index()] = Some(primary);
        for (endpoint, listener) in auxiliaries {
            self.auxiliary_slots[endpoint.index()] = Some(listener);
        }
        Ok(())
    }

    #[cfg(test)]
    fn is_reserved(&self, source: TrustedServiceEnvironmentSource) -> bool {
        self.slots[source.index()].is_some()
            && auxiliary_endpoints_for(source)
                .iter()
                .all(|endpoint| self.auxiliary_slots[endpoint.index()].is_some())
    }
}

fn allocate_service_endpoints(
) -> Result<(ServiceEndpointMap, EndpointReservations), ServiceEngineError> {
    let bind = || {
        TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(ServiceEngineError::EndpointAllocation)
    };
    let mut ports = [0u16; TrustedServiceEnvironmentSource::COUNT];
    let mut slots = std::array::from_fn(|_| None);
    for source in TrustedServiceEnvironmentSource::ALL {
        let listener = bind()?;
        ports[source.index()] = listener
            .local_addr()
            .map_err(ServiceEngineError::EndpointAllocation)?
            .port();
        slots[source.index()] = Some(listener);
    }
    let mut auxiliary_ports = [0u16; ServiceAuxiliaryEndpoint::COUNT];
    let mut auxiliary_slots = std::array::from_fn(|_| None);
    for endpoint in ServiceAuxiliaryEndpoint::ALL {
        let listener = bind()?;
        auxiliary_ports[endpoint.index()] = listener
            .local_addr()
            .map_err(ServiceEngineError::EndpointAllocation)?
            .port();
        auxiliary_slots[endpoint.index()] = Some(listener);
    }
    Ok((
        ServiceEndpointMap::new(ports, auxiliary_ports)?,
        EndpointReservations {
            slots,
            auxiliary_slots,
        },
    ))
}

struct ClampedRuntimeClock {
    base_wall_ms: u64,
    base_instant: Instant,
    last_ms: u64,
}

impl ClampedRuntimeClock {
    fn new() -> Self {
        let wall_ms = system_time_ms();
        Self {
            base_wall_ms: wall_ms,
            base_instant: Instant::now(),
            last_ms: wall_ms,
        }
    }

    fn now_ms(&mut self) -> u64 {
        let elapsed_ms = u64::try_from(self.base_instant.elapsed().as_millis()).unwrap_or(u64::MAX);
        let monotonic_wall = self.base_wall_ms.saturating_add(elapsed_ms);
        self.last_ms = self
            .last_ms
            .max(monotonic_wall)
            .max(system_time_ms())
            .min(i64::MAX as u64);
        self.last_ms
    }
}

fn system_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| u64::try_from(duration.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
        .min(i64::MAX as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_service_restart_failures_are_expected_unavailability() {
        for error in [
            DurableServiceStoreError::Lease(ServiceLeaseError::RestartForbidden(
                "mem0-semantic-engine".to_owned(),
            )),
            DurableServiceStoreError::Lease(ServiceLeaseError::RestartLimitReached {
                service_id: "mem0-semantic-engine".to_owned(),
                maximum: 2,
            }),
        ] {
            assert_eq!(
                expected_acquire_error(&error),
                Some(RuntimeServiceControlError::Unavailable),
            );
        }
    }

    #[test]
    fn worker_dependency_reply_preserves_owner_lost_as_a_private_typed_outcome() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let reply = AcquireReplySender::WorkerDependency(sender);
        assert!(reply.send_owner_lost());
        assert_eq!(
            receiver.recv().unwrap(),
            Err(WorkerServiceDependencyAcquireError::OwnerLost)
        );

        let (sender, receiver) = mpsc::sync_channel(1);
        let reply = AcquireReplySender::WorkerDependency(sender);
        assert!(reply.send_control(Err(RuntimeServiceControlError::Unavailable)));
        assert_eq!(
            receiver.recv().unwrap(),
            Err(WorkerServiceDependencyAcquireError::Control(
                RuntimeServiceControlError::Unavailable,
            ))
        );
    }

    #[test]
    fn service_acquire_deadlines_follow_the_manifest_cold_start() {
        let voicebox = service_acquire_timeouts(1_800_000);
        assert_eq!(
            voicebox.pending,
            Duration::from_millis(1_800_000 + SERVICE_LEASE_SETTLEMENT_GRACE_MS),
        );
        assert_eq!(
            voicebox.response,
            Duration::from_millis(
                1_800_000 + SERVICE_LEASE_SETTLEMENT_GRACE_MS + SERVICE_LEASE_RESPONSE_GRACE_MS,
            ),
        );
        assert!(voicebox.response > voicebox.pending);
        assert!(voicebox.response > CONTROL_RESPONSE_TIMEOUT);
    }

    fn service_status(
        id: &str,
        required: bool,
        startup_policy: ServiceStartupPolicy,
        state: RuntimeServiceState,
    ) -> RuntimeServiceStatus {
        RuntimeServiceStatus {
            id: id.to_owned(),
            display_name: id.to_owned(),
            required,
            startup_policy,
            state,
            last_error: None,
            restarts: 0,
            adopted: false,
        }
    }

    fn failed_service_snapshot(
        generation: u64,
        schedule: DurableServiceRestartSchedule,
    ) -> DurableServiceSnapshot {
        DurableServiceSnapshot {
            status: service_status(
                "gbrain",
                true,
                ServiceStartupPolicy::OnDemand,
                RuntimeServiceState::Failed,
            ),
            admission_denial: None,
            generation,
            pending_leases: 0,
            active_leases: 0,
            acquisition_closed: false,
            next_lease_expiry_ms: None,
            restart: DurableServiceRestartStatus::Deferred(schedule),
        }
    }

    #[test]
    fn worker_cold_start_reacquire_is_exactly_one_target_exit_restart() {
        let schedule = DurableServiceRestartSchedule {
            eligible_at_ms: 110,
            window_ends_at_ms: 1_100,
            attempts_in_window: 0,
            maximum_restarts: 2,
            window_exhausted: false,
        };
        let snapshot = failed_service_snapshot(7, schedule);
        assert_eq!(
            worker_cold_start_reacquire_schedule(
                ServiceStartupPolicy::OnDemand,
                RestartPolicy::OnFailure,
                &snapshot,
                7,
                true,
                true,
                false,
                true,
            ),
            Some(schedule)
        );

        for (pending_worker, target_exit, used, accepting) in [
            (false, true, false, true),
            (true, false, false, true),
            (true, true, true, true),
            (true, true, false, false),
        ] {
            assert_eq!(
                worker_cold_start_reacquire_schedule(
                    ServiceStartupPolicy::OnDemand,
                    RestartPolicy::OnFailure,
                    &snapshot,
                    7,
                    pending_worker,
                    target_exit,
                    used,
                    accepting,
                ),
                None
            );
        }
        assert_eq!(
            worker_cold_start_reacquire_schedule(
                ServiceStartupPolicy::Eager,
                RestartPolicy::OnFailure,
                &snapshot,
                7,
                true,
                true,
                false,
                true,
            ),
            None
        );
        assert_eq!(
            worker_cold_start_reacquire_schedule(
                ServiceStartupPolicy::OnDemand,
                RestartPolicy::Never,
                &snapshot,
                7,
                true,
                true,
                false,
                true,
            ),
            None
        );

        let mut resource_blocked = snapshot.clone();
        resource_blocked.status.state = RuntimeServiceState::ResourceBlocked;
        assert_eq!(
            worker_cold_start_reacquire_schedule(
                ServiceStartupPolicy::OnDemand,
                RestartPolicy::OnFailure,
                &resource_blocked,
                7,
                true,
                true,
                false,
                true,
            ),
            None
        );

        let exhausted = failed_service_snapshot(
            7,
            DurableServiceRestartSchedule {
                eligible_at_ms: 1_100,
                window_ends_at_ms: 1_100,
                attempts_in_window: 2,
                maximum_restarts: 2,
                window_exhausted: true,
            },
        );
        assert_eq!(
            worker_cold_start_reacquire_schedule(
                ServiceStartupPolicy::OnDemand,
                RestartPolicy::OnFailure,
                &exhausted,
                7,
                true,
                true,
                false,
                true,
            ),
            None
        );
    }

    #[test]
    fn worker_cold_start_reacquire_preserves_schedule_and_original_deadline() {
        let schedule = DurableServiceRestartSchedule {
            eligible_at_ms: 110,
            window_ends_at_ms: 1_100,
            attempts_in_window: 0,
            maximum_restarts: 2,
            window_exhausted: false,
        };
        let snapshot = failed_service_snapshot(7, schedule);
        assert!(worker_cold_start_reacquire_still_permitted(
            ServiceStartupPolicy::OnDemand,
            RestartPolicy::OnFailure,
            &snapshot,
            7,
            schedule,
            109,
        ));

        let mut changed_schedule = snapshot.clone();
        changed_schedule.restart =
            DurableServiceRestartStatus::Deferred(DurableServiceRestartSchedule {
                eligible_at_ms: 120,
                ..schedule
            });
        assert!(!worker_cold_start_reacquire_still_permitted(
            ServiceStartupPolicy::OnDemand,
            RestartPolicy::OnFailure,
            &changed_schedule,
            7,
            schedule,
            120,
        ));

        let now = Instant::now();
        assert!(worker_cold_start_restart_fits_deadline(
            schedule,
            100,
            now,
            now.checked_add(Duration::from_millis(11)),
        ));
        assert!(!worker_cold_start_restart_fits_deadline(
            schedule,
            100,
            now,
            now.checked_add(Duration::from_millis(10)),
        ));
        assert!(!worker_cold_start_restart_fits_deadline(
            schedule, 100, now, None,
        ));
    }

    #[test]
    fn required_on_demand_services_do_not_hold_startup_admission_closed() {
        let statuses = RwLock::new(vec![
            service_status(
                "dashboard",
                true,
                ServiceStartupPolicy::Eager,
                RuntimeServiceState::Ready,
            ),
            service_status(
                "gbrain",
                true,
                ServiceStartupPolicy::OnDemand,
                RuntimeServiceState::AvailableButStopped,
            ),
        ]);
        let required_startup_services = BTreeSet::from(["dashboard".to_owned()]);

        assert!(required_startup_services_are_ready(
            &statuses,
            &required_startup_services,
        ));
    }

    #[test]
    fn requested_shutdown_is_not_misclassified_as_an_admission_failure() {
        let shutdown = ShutdownCoordinator::default();
        assert!(shutdown.request_shutdown());

        assert!(open_runtime_admission_during_reconciliation(&shutdown).is_ok());
        assert!(!shutdown.is_accepting_work());
    }

    #[test]
    fn unavailable_admission_still_fails_closed_during_reconciliation() {
        let shutdown = ShutdownCoordinator::default();
        let error = open_runtime_admission_during_reconciliation(&shutdown).unwrap_err();

        assert_eq!(
            error.to_string(),
            "the service controller failed: runtime admission stayed closed"
        );
        assert!(!shutdown.is_accepting_work());
    }

    #[test]
    fn required_eager_services_remain_fail_closed_until_ready() {
        let required_startup_services = BTreeSet::from(["workspace".to_owned()]);
        for state in [
            RuntimeServiceState::AvailableButStopped,
            RuntimeServiceState::Starting,
            RuntimeServiceState::ResourceBlocked,
            RuntimeServiceState::InstallationUnavailable,
            RuntimeServiceState::Failed,
            RuntimeServiceState::Stopping,
        ] {
            let statuses = RwLock::new(vec![service_status(
                "workspace",
                true,
                ServiceStartupPolicy::Eager,
                state,
            )]);
            assert!(!required_startup_services_are_ready(
                &statuses,
                &required_startup_services,
            ));
        }

        for state in [RuntimeServiceState::Ready, RuntimeServiceState::Busy] {
            let statuses = RwLock::new(vec![service_status(
                "workspace",
                true,
                ServiceStartupPolicy::Eager,
                state,
            )]);
            assert!(required_startup_services_are_ready(
                &statuses,
                &required_startup_services,
            ));
        }
    }

    #[test]
    fn missing_manifest_required_startup_status_remains_fail_closed() {
        let statuses = RwLock::new(vec![service_status(
            "gbrain",
            true,
            ServiceStartupPolicy::OnDemand,
            RuntimeServiceState::AvailableButStopped,
        )]);
        let required_startup_services = BTreeSet::from(["dashboard".to_owned()]);

        assert!(!required_startup_services_are_ready(
            &statuses,
            &required_startup_services,
        ));
    }

    #[test]
    fn dashboard_lease_owner_is_exact_generation_and_ready_state() {
        assert!(dashboard_generation_can_own_lease(
            7,
            RuntimeServiceState::Ready,
            7
        ));
        assert!(!dashboard_generation_can_own_lease(
            7,
            RuntimeServiceState::Ready,
            6
        ));
        assert!(!dashboard_generation_can_own_lease(
            7,
            RuntimeServiceState::Ready,
            0
        ));
        assert!(!dashboard_generation_can_own_lease(
            7,
            RuntimeServiceState::Starting,
            7
        ));
        assert!(!dashboard_generation_can_own_lease(
            7,
            RuntimeServiceState::Failed,
            7
        ));
    }

    #[test]
    fn service_lease_cannot_survive_a_terminal_or_stale_generation() {
        for state in [
            RuntimeServiceState::Starting,
            RuntimeServiceState::Ready,
            RuntimeServiceState::Busy,
        ] {
            assert!(service_generation_can_own_lease(4, state, 4));
        }
        for state in [
            RuntimeServiceState::AvailableButStopped,
            RuntimeServiceState::ResourceBlocked,
            RuntimeServiceState::InstallationUnavailable,
            RuntimeServiceState::Failed,
            RuntimeServiceState::Stopping,
        ] {
            assert!(!service_generation_can_own_lease(4, state, 4));
        }
        assert!(!service_generation_can_own_lease(
            5,
            RuntimeServiceState::Ready,
            4
        ));
    }

    #[test]
    fn resource_blocked_status_is_not_an_automatic_eager_restart_candidate() {
        assert!(service_state_allows_automatic_eager_restart(
            RuntimeServiceState::Failed
        ));
        for state in [
            RuntimeServiceState::AvailableButStopped,
            RuntimeServiceState::Starting,
            RuntimeServiceState::Ready,
            RuntimeServiceState::Busy,
            RuntimeServiceState::ResourceBlocked,
            RuntimeServiceState::InstallationUnavailable,
            RuntimeServiceState::Stopping,
        ] {
            assert!(!service_state_allows_automatic_eager_restart(state));
        }
    }

    #[test]
    fn fresh_host_rearms_only_nonretryable_terminal_eager_state() {
        let terminal = ServiceEngineError::Store(DurableServiceStoreError::Lease(
            ServiceLeaseError::RestartForbidden("dashboard".to_owned()),
        ));
        assert!(eager_start_requires_fresh_host_retry(
            &terminal,
            "dashboard",
            RestartPolicy::OnFailure,
        ));
        assert!(!eager_start_requires_fresh_host_retry(
            &terminal,
            "chatmock",
            RestartPolicy::OnFailure,
        ));
        assert!(!eager_start_requires_fresh_host_retry(
            &terminal,
            "dashboard",
            RestartPolicy::Never,
        ));
        assert!(!eager_start_requires_fresh_host_retry(
            &ServiceEngineError::RequiredServiceUnavailable("dashboard".to_owned()),
            "dashboard",
            RestartPolicy::OnFailure,
        ));
    }

    #[test]
    fn recall_configuration_change_waits_for_complete_tree_exit() {
        let mut barrier = Some(8);
        for state in [
            RuntimeServiceState::Starting,
            RuntimeServiceState::Ready,
            RuntimeServiceState::Busy,
            RuntimeServiceState::Stopping,
        ] {
            assert!(!advance_recall_restart_barrier(&mut barrier, 9, state));
            assert_eq!(barrier, Some(9));
        }
        assert!(advance_recall_restart_barrier(
            &mut barrier,
            9,
            RuntimeServiceState::AvailableButStopped,
        ));
        assert_eq!(barrier, None);
        assert!(advance_recall_restart_barrier(
            &mut barrier,
            10,
            RuntimeServiceState::Ready,
        ));
    }

    #[test]
    fn exact_endpoint_can_be_reacquired_and_collision_is_rejected() {
        let (endpoints, mut reservations) = allocate_service_endpoints().unwrap();
        for allocated in TrustedServiceEnvironmentSource::ALL {
            assert!(reservations.is_reserved(allocated));
            assert_ne!(endpoints.port_for(allocated).get(), 0);
        }
        let source = TrustedServiceEnvironmentSource::Hermes;
        let port = endpoints.port_for(source).get();
        assert!(reservations.is_reserved(source));
        assert!(reservations.release(source));
        assert!(!reservations.is_reserved(source));

        let unrelated = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).unwrap();
        assert!(reservations.reserve(source, &endpoints).is_err());
        assert!(!reservations.is_reserved(source));
        drop(unrelated);

        reservations.reserve(source, &endpoints).unwrap();
        assert!(reservations.is_reserved(source));
    }

    #[test]
    fn controller_thread_outcome_never_hides_run_or_cleanup_failure() {
        assert!(finish_controller_thread(Ok(Ok(())), Ok(Ok(()))).is_ok());
        assert_eq!(
            finish_controller_thread(Ok(Err("run failed".to_owned())), Ok(Ok(()))).unwrap_err(),
            "run failed"
        );
        let joined = finish_controller_thread(
            Ok(Err("run failed".to_owned())),
            Ok(Err(ServiceEngineError::Invariant("cleanup failed"))),
        )
        .unwrap_err();
        assert!(joined.contains("run failed"));
        assert!(joined.contains("cleanup failed"));
    }

    #[test]
    fn successful_controller_run_does_not_replay_completed_shutdown() {
        let cleanup_attempts = std::cell::Cell::new(0_u32);
        let successful_run = Ok(Ok(()));
        let cleanup = controller_cleanup_after_run(&successful_run, || {
            cleanup_attempts.set(cleanup_attempts.get() + 1);
            Ok(())
        });
        assert!(matches!(cleanup, Ok(Ok(()))));
        assert_eq!(cleanup_attempts.get(), 0);

        let failed_run = Ok(Err("run failed".to_owned()));
        let cleanup = controller_cleanup_after_run(&failed_run, || {
            cleanup_attempts.set(cleanup_attempts.get() + 1);
            Ok(())
        });
        assert!(matches!(cleanup, Ok(Ok(()))));
        assert_eq!(cleanup_attempts.get(), 1);
    }
}
