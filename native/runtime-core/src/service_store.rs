//! Durable service generations, leases, and process-intent outbox.
//!
//! The pure `ServiceLeaseMachine` remains useful for reasoning about lifecycle
//! semantics, but this module is the production authority: every mutation is
//! serialized through the same SQLite connection, admission gate, and
//! transaction boundary as durable jobs. Status reads are deliberately
//! observational and never expire a lease or manufacture a process action.

use crate::service_process::{
    ClaimedServiceProcess, ResidentServiceProcess, ServiceLaunchNotCreated, ServiceLaunchOutcome,
    ServiceLaunchUncertain, ServiceReadinessPendingReason, ServiceReadinessProbeOutcome,
    ServiceReadyAuthority, ServiceResidencyAuthority, ServiceTreeExitAuthority,
    StartingServiceProcess, StoppingServiceProcess,
};
use crate::store::{
    evaluate_global_admission, global_admission_snapshot_for_worker_dependency_tx,
    global_admission_snapshot_tx, validate_worker_service_dependency_admission_tx,
    ValidatedWorkerServiceDependencyAdmission, WorkerServiceDependencyOwnerValidation,
};
use crate::{
    AdmissionDecision, AdmissionDenial, AdmissionPolicy, AdmissionRequest,
    CurrentGenerationMembership, JobStore, ProcessExitClassification, ProcessOwnerError,
    ProcessOwnerEvent, ProcessOwnerTerminal, ProcessTreeExit, ProcessTreeResidency,
    RuntimeGenerationScope, ServiceLaunchRequest, ServiceLaunchRetentionDisposition,
    ServiceLeaseAction, ServiceLeaseClaimState, ServiceLeaseError, ServiceLeaseLimits,
    ServiceLeaseRegistration, ServiceLeaseReleaseDisposition, ServiceLeaseReleaseReason,
    ServiceStopCause, StoreError, SystemCommit, WorkerServiceDependencyAdmission,
};
use breadboard_runtime_protocol::{
    validate_identifier, ResourceClass, RestartPolicy, RuntimeMode, RuntimeServiceState,
    RuntimeServiceStatus, ServiceRestartBounds, ServiceStartupPolicy, MAX_COMMIT_LIMIT_MB,
    MAX_FAILURE_MESSAGE_BYTES, MAX_SERVICE_RESTARTS, MAX_SQLITE_UNSIGNED, MAX_TIMEOUT_MS,
};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction, TransactionBehavior};
use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::Ordering;
use std::time::Duration;
use thiserror::Error;

// The service schema requires a positive estimate before any generation exists.
// Persist the maximum as a fail-closed unbound sentinel; every successful
// generation start atomically replaces it with its Registry-minted profile.
const UNBOUND_SERVICE_ADMISSION_ESTIMATE_MB: u64 = MAX_COMMIT_LIMIT_MB;

#[derive(Debug, Error)]
pub enum DurableServiceStoreError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error(transparent)]
    Lease(#[from] ServiceLeaseError),
    #[error("service {0} was not registered")]
    ServiceNotFound(String),
    #[error("service {0} is already bound to different durable registration data")]
    RegistrationConflict(String),
    #[error("service {0} admission profile does not match its registration or active generation")]
    AdmissionProfileConflict(String),
    #[error("lease {0} already exists in the durable service ledger")]
    DuplicateLease(String),
    #[error("lease {0} was not found in the durable service ledger")]
    LeaseNotFound(String),
    #[error("service {0} has corrupt durable lifecycle state")]
    CorruptService(String),
    #[error("service {0} received a denial outside the closed resource-admission domain")]
    InvalidAdmissionDenial(String),
    #[error("stale service generation {actual} for {service_id}; expected {expected}")]
    StaleGeneration {
        service_id: String,
        expected: u64,
        actual: u64,
    },
    #[error("service intent claim is stale, expired, or belongs to another runtime generation")]
    OutboxFenceMismatch,
    #[error("service intent is not valid for operation {0}")]
    InvalidIntent(&'static str),
    #[error(
        "retained launch authority for service {service_id} generation {generation} was not found"
    )]
    RetainedLaunchNotFound { service_id: String, generation: u64 },
    #[error("retained launch authority for service {service_id} generation {generation} has no running process")]
    RetainedLaunchNotRunning { service_id: String, generation: u64 },
    #[error(
        "retained authority for service {service_id} generation {generation} is in phase {phase:?}, which cannot perform {operation}"
    )]
    RetainedAuthorityPhase {
        service_id: String,
        generation: u64,
        phase: Option<RetainedServiceAuthorityPhase>,
        operation: &'static str,
    },
    #[error(transparent)]
    ProcessOwner(#[from] ProcessOwnerError),
}

/// Copyable observation of the authority phase retained by the generation-
/// global service table. It contains no process handle or durable capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetainedServiceAuthorityPhase {
    Claimed,
    Residency,
    Starting,
    ReadyProof,
    Resident,
    Stopping,
    NotCreated,
    CreationUncertain,
    ExitProof,
}

/// Result of one bounded readiness advance. The process and all proofs remain
/// in the generation-global table in every variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetainedServiceReadinessProgress {
    Pending {
        retry_after: Duration,
        reason: ServiceReadinessPendingReason,
    },
    Ready,
    AlreadyReady,
    TimedOut,
    ProcessExited,
}

/// Result of binding one acknowledged StopTree authority. A deferred result
/// means both the live phase (when present) and StopTree authority remain in
/// the table for `retry_retained_durable_service_stop`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetainedServiceStopProgress {
    Bound,
    AlreadyStopping,
    Deferred {
        phase: Option<RetainedServiceAuthorityPhase>,
    },
    DuplicateQuarantined,
}

enum RetainedServiceAuthority {
    Claimed(ClaimedServiceProcess),
    Residency(ServiceResidencyAuthority),
    Starting(StartingServiceProcess),
    Ready(ServiceReadyAuthority),
    Resident(ResidentServiceProcess),
    Stopping(StoppingServiceProcess),
    NotCreated(ServiceLaunchNotCreated),
    Uncertain(ServiceLaunchUncertain),
    Exited(ServiceTreeExitAuthority),
}

impl RetainedServiceAuthority {
    fn from_launch(outcome: ServiceLaunchOutcome) -> Self {
        match outcome {
            ServiceLaunchOutcome::Running(process) => Self::Claimed(*process),
            ServiceLaunchOutcome::NotCreated(authority) => Self::NotCreated(authority),
            ServiceLaunchOutcome::Uncertain(authority) => Self::Uncertain(authority),
        }
    }

    fn service_id(&self) -> &str {
        match self {
            Self::Claimed(authority) => authority.service_id(),
            Self::Residency(authority) => authority.service_id(),
            Self::Starting(authority) => authority.service_id(),
            Self::Ready(authority) => authority.service_id(),
            Self::Resident(authority) => authority.service_id(),
            Self::Stopping(authority) => authority.service_id(),
            Self::NotCreated(authority) => authority.service_id(),
            Self::Uncertain(authority) => authority.service_id(),
            Self::Exited(authority) => authority.service_id(),
        }
    }

    fn generation(&self) -> u64 {
        match self {
            Self::Claimed(authority) => authority.generation(),
            Self::Residency(authority) => authority.generation(),
            Self::Starting(authority) => authority.generation(),
            Self::Ready(authority) => authority.generation(),
            Self::Resident(authority) => authority.generation(),
            Self::Stopping(authority) => authority.generation(),
            Self::NotCreated(authority) => authority.generation(),
            Self::Uncertain(authority) => authority.generation(),
            Self::Exited(authority) => authority.generation(),
        }
    }

    fn phase(&self) -> RetainedServiceAuthorityPhase {
        match self {
            Self::Claimed(_) => RetainedServiceAuthorityPhase::Claimed,
            Self::Residency(_) => RetainedServiceAuthorityPhase::Residency,
            Self::Starting(_) => RetainedServiceAuthorityPhase::Starting,
            Self::Ready(_) => RetainedServiceAuthorityPhase::ReadyProof,
            Self::Resident(_) => RetainedServiceAuthorityPhase::Resident,
            Self::Stopping(_) => RetainedServiceAuthorityPhase::Stopping,
            Self::NotCreated(_) => RetainedServiceAuthorityPhase::NotCreated,
            Self::Uncertain(_) => RetainedServiceAuthorityPhase::CreationUncertain,
            Self::Exited(_) => RetainedServiceAuthorityPhase::ExitProof,
        }
    }

    fn read_event(&mut self, timeout: Duration) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        match self {
            Self::Claimed(authority) => authority.read_event(timeout),
            Self::Residency(authority) => authority.read_event(timeout),
            Self::Starting(authority) => authority.read_event(timeout),
            Self::Ready(authority) => authority.read_event(timeout),
            Self::Resident(authority) => authority.read_event(timeout),
            Self::Stopping(authority) => authority.read_event(timeout),
            Self::NotCreated(_) | Self::Uncertain(_) | Self::Exited(_) => {
                Err(ProcessOwnerError::InvalidLaunch(
                    "retained service authority has no readable process owner",
                ))
            }
        }
    }

    fn pids(&self) -> Option<(u32, Option<u32>)> {
        match self {
            Self::Claimed(authority) => Some((authority.supervisor_pid(), authority.root_pid())),
            Self::Residency(authority) => Some((authority.supervisor_pid(), authority.root_pid())),
            Self::Starting(authority) => Some((authority.supervisor_pid(), authority.root_pid())),
            Self::Ready(authority) => Some((authority.supervisor_pid(), authority.root_pid())),
            Self::Resident(authority) => Some((authority.supervisor_pid(), authority.root_pid())),
            Self::Stopping(authority) => Some((authority.supervisor_pid(), authority.root_pid())),
            Self::NotCreated(_) | Self::Uncertain(_) | Self::Exited(_) => None,
        }
    }

    // Failure must return the complete linear process authority; boxing only
    // for lint size would obscure the exact move/restore paths below.
    #[allow(clippy::result_large_err)]
    fn confirm_exit(
        self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ServiceTreeExitAuthority, (Self, ProcessOwnerError)> {
        macro_rules! confirm {
            ($authority:expr, $variant:ident) => {
                match $authority.confirm_exit(terminal) {
                    Ok(exit) => Ok(exit),
                    Err(transition) => {
                        let (authority, error) = transition.into_parts();
                        Err((Self::$variant(authority), error))
                    }
                }
            };
        }
        match self {
            Self::Claimed(authority) => confirm!(authority, Claimed),
            Self::Residency(authority) => confirm!(authority, Residency),
            Self::Starting(authority) => confirm!(authority, Starting),
            Self::Ready(authority) => confirm!(authority, Ready),
            Self::Resident(authority) => confirm!(authority, Resident),
            Self::Stopping(authority) => confirm!(authority, Stopping),
            authority @ (Self::NotCreated(_) | Self::Uncertain(_) | Self::Exited(_)) => Err((
                authority,
                ProcessOwnerError::InvalidLaunch(
                    "retained service authority has no confirmable process owner",
                ),
            )),
        }
    }

    // The error tuple intentionally returns both single-use authorities so a
    // failed stop bind cannot silently drop either side of the fence.
    #[allow(clippy::result_large_err)]
    fn bind_stop(
        self,
        stop: DurableServiceStopAuthority,
        force: bool,
    ) -> Result<Self, (Self, DurableServiceStopAuthority, ProcessOwnerError)> {
        macro_rules! bind {
            ($stop_method:ident, $authority:expr, $variant:ident) => {
                match stop.$stop_method($authority, force) {
                    Ok(stopping) => Ok(Self::Stopping(stopping)),
                    Err(transition) => {
                        let (authority, stop, error) = transition.into_parts();
                        Err((Self::$variant(authority), stop, error))
                    }
                }
            };
        }
        match self {
            Self::Claimed(authority) => bind!(request_claimed_stop, authority, Claimed),
            Self::Residency(authority) => bind!(request_residency_stop, authority, Residency),
            Self::Starting(authority) => bind!(request_starting_stop, authority, Starting),
            Self::Ready(authority) => bind!(request_ready_stop, authority, Ready),
            Self::Resident(authority) => bind!(request_resident_stop, authority, Resident),
            authority @ (Self::Stopping(_)
            | Self::NotCreated(_)
            | Self::Uncertain(_)
            | Self::Exited(_)) => Err((
                authority,
                stop,
                ProcessOwnerError::InvalidLaunch(
                    "retained service phase cannot bind an acknowledged StopTree",
                ),
            )),
        }
    }
}

#[derive(Default)]
struct RetainedServiceGeneration {
    phase: Option<RetainedServiceAuthority>,
    deferred_stop: Option<DurableServiceStopAuthority>,
}

/// Process-lifetime authority table shared by every `JobStore` handle for one
/// exact runtime generation scope. Empty-phase entries are allowed only while
/// an acknowledged StopTree waits for its matching live phase to appear.
#[derive(Default)]
pub(crate) struct RetainedServiceAuthorities {
    active: HashMap<(String, u64), RetainedServiceGeneration>,
    quarantined: Vec<RetainedServiceGeneration>,
}

impl RetainedServiceAuthorities {
    fn retain_launch(
        &mut self,
        outcome: ServiceLaunchOutcome,
    ) -> ServiceLaunchRetentionDisposition {
        self.retain_phase(RetainedServiceAuthority::from_launch(outcome))
    }

    fn retain_phase(
        &mut self,
        phase: RetainedServiceAuthority,
    ) -> ServiceLaunchRetentionDisposition {
        let key = (phase.service_id().to_owned(), phase.generation());
        let entry = self.active.entry(key).or_default();
        if entry.phase.is_none() {
            entry.phase = Some(phase);
            ServiceLaunchRetentionDisposition::Retained
        } else {
            self.quarantined.push(RetainedServiceGeneration {
                phase: Some(phase),
                deferred_stop: None,
            });
            ServiceLaunchRetentionDisposition::DuplicateQuarantined
        }
    }

    fn retain_stop(
        &mut self,
        stop: DurableServiceStopAuthority,
    ) -> ServiceLaunchRetentionDisposition {
        let key = (stop.service_id().to_owned(), stop.generation());
        let entry = self.active.entry(key).or_default();
        if entry.deferred_stop.is_none()
            && !matches!(
                entry.phase.as_ref(),
                Some(RetainedServiceAuthority::Stopping(_))
            )
        {
            entry.deferred_stop = Some(stop);
            ServiceLaunchRetentionDisposition::Retained
        } else {
            self.quarantined.push(RetainedServiceGeneration {
                phase: None,
                deferred_stop: Some(stop),
            });
            ServiceLaunchRetentionDisposition::DuplicateQuarantined
        }
    }

    fn phase_mismatch(
        service_id: &str,
        generation: u64,
        phase: Option<RetainedServiceAuthorityPhase>,
        operation: &'static str,
    ) -> DurableServiceStoreError {
        DurableServiceStoreError::RetainedAuthorityPhase {
            service_id: service_id.into(),
            generation,
            phase,
            operation,
        }
    }
}

fn bind_retained_service_stop(
    retained: &mut RetainedServiceAuthorities,
    service_id: &str,
    generation: u64,
    force: bool,
) -> RetainedServiceStopProgress {
    let key = (service_id.to_owned(), generation);
    let Some(entry) = retained.active.get_mut(&key) else {
        return RetainedServiceStopProgress::Deferred { phase: None };
    };
    if entry.deferred_stop.is_none() {
        return match entry.phase.as_mut() {
            Some(RetainedServiceAuthority::Stopping(process)) => {
                if process.request_stop(force).is_ok() {
                    RetainedServiceStopProgress::AlreadyStopping
                } else {
                    RetainedServiceStopProgress::Deferred {
                        phase: Some(RetainedServiceAuthorityPhase::Stopping),
                    }
                }
            }
            phase => RetainedServiceStopProgress::Deferred {
                phase: phase.as_ref().map(|authority| (*authority).phase()),
            },
        };
    }
    let stop = entry
        .deferred_stop
        .take()
        .expect("checked deferred StopTree must remain retained");
    let Some(phase) = entry.phase.take() else {
        entry.deferred_stop = Some(stop);
        return RetainedServiceStopProgress::Deferred { phase: None };
    };
    match phase.bind_stop(stop, force) {
        Ok(stopping) => {
            entry.phase = Some(stopping);
            RetainedServiceStopProgress::Bound
        }
        Err((phase, stop, _error)) => {
            let current = phase.phase();
            entry.phase = Some(phase);
            entry.deferred_stop = Some(stop);
            RetainedServiceStopProgress::Deferred {
                phase: Some(current),
            }
        }
    }
}

/// Manifest-derived, mode-invariant durable lifecycle identity. Its fields are
/// private so callers cannot widen lease or restart limits after registration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableServiceRegistration {
    lease: ServiceLeaseRegistration,
    resource_class: ResourceClass,
    restart_bounds: Option<ServiceRestartBounds>,
}

impl DurableServiceRegistration {
    /// Registry handoff. Downstream control/HTTP callers cannot mint durable
    /// service identity directly from request data.
    pub(crate) fn new(
        lease: ServiceLeaseRegistration,
        resource_class: ResourceClass,
        restart_bounds: Option<ServiceRestartBounds>,
    ) -> Result<Self, DurableServiceStoreError> {
        validate_restart_registration(&lease, restart_bounds.as_ref())?;
        Ok(Self {
            lease,
            resource_class,
            restart_bounds,
        })
    }

    pub fn service_id(&self) -> &str {
        self.lease.service_id()
    }

    pub fn lease_registration(&self) -> &ServiceLeaseRegistration {
        &self.lease
    }

    pub fn resource_class(&self) -> ResourceClass {
        self.resource_class
    }

    fn restart_bounds(&self) -> Option<&ServiceRestartBounds> {
        self.restart_bounds.as_ref()
    }
}

fn validate_restart_registration(
    lease: &ServiceLeaseRegistration,
    restart_bounds: Option<&ServiceRestartBounds>,
) -> Result<(), DurableServiceStoreError> {
    match (lease.restart_policy(), restart_bounds) {
        (RestartPolicy::Never, None) if lease.limits().max_restarts() == 0 => Ok(()),
        (RestartPolicy::OnFailure, Some(bounds))
            if bounds.maximum_restarts == lease.limits().max_restarts()
                && bounds.maximum_restarts > 0
                && bounds.maximum_restarts <= MAX_SERVICE_RESTARTS
                && bounds.window_ms > 0
                && bounds.window_ms <= MAX_TIMEOUT_MS
                && bounds.initial_backoff_ms > 0
                && bounds.initial_backoff_ms <= bounds.maximum_backoff_ms
                && bounds.maximum_backoff_ms <= bounds.window_ms =>
        {
            Ok(())
        }
        _ => Err(ServiceLeaseError::InvalidLimit {
            field: "service restart bounds",
        }
        .into()),
    }
}

/// Registry-minted admission data for one exact runtime mode. It is separate
/// from durable registration so reopening the same database in another mode
/// does not mutate or conflict with the service's durable identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableServiceAdmissionProfile {
    service_id: String,
    mode: RuntimeMode,
    estimated_cold_start_commit_mb: u64,
}

impl DurableServiceAdmissionProfile {
    pub(crate) fn new(
        service_id: String,
        mode: RuntimeMode,
        estimated_cold_start_commit_mb: u64,
    ) -> Result<Self, DurableServiceStoreError> {
        validate_identifier("serviceId", &service_id).map_err(ServiceLeaseError::from)?;
        if estimated_cold_start_commit_mb == 0
            || estimated_cold_start_commit_mb > MAX_COMMIT_LIMIT_MB
        {
            return Err(ServiceLeaseError::InvalidLimit {
                field: "estimatedColdStartCommitMb",
            }
            .into());
        }
        Ok(Self {
            service_id,
            mode,
            estimated_cold_start_commit_mb,
        })
    }

    pub fn service_id(&self) -> &str {
        &self.service_id
    }

    pub fn mode(&self) -> RuntimeMode {
        self.mode
    }

    pub fn estimated_cold_start_commit_mb(&self) -> u64 {
        self.estimated_cold_start_commit_mb
    }

    fn reservation_definition_key(&self) -> &'static str {
        match self.mode {
            RuntimeMode::Lean => "lean",
            RuntimeMode::Hot => "hot",
            RuntimeMode::Packaged => "packaged",
        }
    }
}

/// Exact durable lease authority. Construction is private and the data-root
/// generation scope is retained, so a lease from another store cannot release
/// or mutate this service.
#[must_use = "a durable service lease must be released or retained by its owner"]
pub struct DurableServiceLeaseClaim {
    scope: RuntimeGenerationScope,
    lease_id: String,
    service_id: String,
    generation: u64,
    expires_at_ms: u64,
    state: ServiceLeaseClaimState,
}

impl fmt::Debug for DurableServiceLeaseClaim {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DurableServiceLeaseClaim")
            .field("authority", &"<opaque durable lease>")
            .field("state", &self.state)
            .finish()
    }
}

impl DurableServiceLeaseClaim {
    pub fn lease_id(&self) -> &str {
        &self.lease_id
    }

    pub fn service_id(&self) -> &str {
        &self.service_id
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn expires_at_ms(&self) -> u64 {
        self.expires_at_ms
    }

    pub fn state(&self) -> ServiceLeaseClaimState {
        self.state
    }
}

#[derive(Debug)]
pub enum DurableServiceAcquireResult {
    Acquired(DurableServiceLeaseClaim),
    RestartDeferred(DurableServiceRestartSchedule),
    Denied(AdmissionDenial),
}

/// Typed result for the dispatcher-only dependency path. `OwnerLost` is the
/// benign race where cancellation or another claimant changed the job after
/// Registry selected dependencies but before this serialized transaction.
/// It is deliberately distinct from ledger corruption and service denial.
#[derive(Debug)]
pub enum DurableWorkerServiceAcquireResult {
    OwnerLost,
    Evaluated(DurableServiceAcquireResult),
}

#[derive(Debug, Clone, Copy)]
enum ServiceAcquireAuthority<'a> {
    Independent,
    WorkerDependency(&'a WorkerServiceDependencyAdmission),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DurableServiceStartResult {
    Queued,
    AlreadyStartingOrReady,
    RestartDeferred(DurableServiceRestartSchedule),
    Denied(AdmissionDenial),
}

/// Durable scheduler handoff for a failed service. The engine must not publish
/// another StartTree before `eligible_at_ms`; `window_exhausted` distinguishes
/// a backoff delay from a restart-budget delay without granting launch
/// authority to the observer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DurableServiceRestartSchedule {
    pub eligible_at_ms: u64,
    pub window_ends_at_ms: u64,
    pub attempts_in_window: u32,
    pub maximum_restarts: u32,
    pub window_exhausted: bool,
}

/// Observational durable restart state. Reading it cannot advance the window
/// or make a restart eligible.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DurableServiceRestartStatus {
    Disabled,
    PolicyBindingRequired,
    Idle {
        attempts_in_window: u32,
        window_ends_at_ms: Option<u64>,
    },
    Deferred(DurableServiceRestartSchedule),
}

impl DurableServiceRestartStatus {
    pub fn next_attempt_at_ms(self) -> Option<u64> {
        match self {
            Self::Deferred(schedule) => Some(schedule.eligible_at_ms),
            Self::Disabled | Self::PolicyBindingRequired | Self::Idle { .. } => None,
        }
    }
}

/// Pure database snapshot. Reading it never advances the durable clock,
/// releases an expired lease, starts a service, or publishes an outbox row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DurableServiceSnapshot {
    pub status: RuntimeServiceStatus,
    /// Exact bounded denial persisted by the global governor. This remains an
    /// internal Rust observation; public status serialization exposes only the
    /// sanitized state and message above.
    pub admission_denial: Option<AdmissionDenial>,
    pub generation: u64,
    pub pending_leases: u32,
    pub active_leases: u32,
    pub acquisition_closed: bool,
    pub next_lease_expiry_ms: Option<u64>,
    pub restart: DurableServiceRestartStatus,
}

#[must_use = "an outbox claim must be acknowledged or allowed to expire"]
pub struct DurableServiceOutboxClaim {
    scope: RuntimeGenerationScope,
    intent_id: i64,
    claim_epoch: u64,
    claim_expires_at_ms: u64,
    action: ServiceLeaseAction,
}

impl fmt::Debug for DurableServiceOutboxClaim {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DurableServiceOutboxClaim")
            .field("authority", &"<opaque durable outbox claim>")
            .field("action", &self.action)
            .finish()
    }
}

impl DurableServiceOutboxClaim {
    pub fn action(&self) -> &ServiceLeaseAction {
        &self.action
    }

    pub fn claim_expires_at_ms(&self) -> u64 {
        self.claim_expires_at_ms
    }
}

/// Sole durable authority for one acknowledged `StartTree` intent. The
/// service engine must keep this non-cloneable value coupled to the exact
/// process owner until a zero-resident receipt is durably finalized.
#[must_use = "start authority must remain coupled to its service process until tree exit"]
pub(crate) struct DurableServiceStartAuthority {
    scope: RuntimeGenerationScope,
    intent_id: i64,
    claim_epoch: u64,
    service_id: String,
    generation: u64,
}

impl fmt::Debug for DurableServiceStartAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DurableServiceStartAuthority")
            .field("authority", &"<opaque acknowledged service start>")
            .finish()
    }
}

impl DurableServiceStartAuthority {
    pub fn service_id(&self) -> &str {
        &self.service_id
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        &self.scope == scope
    }
}

/// Acknowledged stop authority is deliberately distinct from the sole start
/// authority. It can request a stop from a matching owned process, but it can
/// never independently prove that the process tree reached zero residents.
#[must_use = "stop authority must be bound to the matching owned service process"]
pub struct DurableServiceStopAuthority {
    scope: RuntimeGenerationScope,
    _intent_id: i64,
    _claim_epoch: u64,
    service_id: String,
    generation: u64,
    cause: ServiceStopCause,
}

impl fmt::Debug for DurableServiceStopAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DurableServiceStopAuthority")
            .field("authority", &"<opaque acknowledged service stop>")
            .field("cause", &self.cause)
            .finish()
    }
}

impl DurableServiceStopAuthority {
    pub fn service_id(&self) -> &str {
        &self.service_id
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn cause(&self) -> ServiceStopCause {
        self.cause
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        &self.scope == scope
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceIntentAckDisposition {
    Acked,
    AlreadyAcked,
}

#[must_use = "the returned typed authority must be retained by the service engine"]
pub(crate) enum AcknowledgedServiceIntent {
    Start(DurableServiceStartAuthority),
    Stop(DurableServiceStopAuthority),
}

impl fmt::Debug for AcknowledgedServiceIntent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Start(_) => formatter.write_str("AcknowledgedServiceIntent::Start(<opaque>)"),
            Self::Stop(_) => formatter.write_str("AcknowledgedServiceIntent::Stop(<opaque>)"),
        }
    }
}

#[must_use = "the returned typed authority owns the acknowledged intent"]
pub(crate) struct ServiceIntentAck {
    pub(crate) disposition: ServiceIntentAckDisposition,
    pub(crate) authority: AcknowledgedServiceIntent,
}

impl fmt::Debug for ServiceIntentAck {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ServiceIntentAck")
            .field("disposition", &self.disposition)
            .field("authority", &self.authority)
            .finish()
    }
}

/// Failed acknowledgement retains the sole outbox authority so the service
/// engine may retry the exact transaction or keep it through fatal shutdown.
#[must_use = "failed outbox transitions retain authority and must be handled"]
pub struct DurableServiceIntentTransitionError {
    claim: Box<DurableServiceOutboxClaim>,
    error: DurableServiceStoreError,
}

impl fmt::Debug for DurableServiceIntentTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DurableServiceIntentTransitionError")
            .field("authority", &"<opaque retained outbox claim>")
            .field("error", &self.error)
            .finish()
    }
}

impl fmt::Display for DurableServiceIntentTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for DurableServiceIntentTransitionError {}

impl DurableServiceIntentTransitionError {
    pub fn error(&self) -> &DurableServiceStoreError {
        &self.error
    }

    pub fn into_parts(self) -> (DurableServiceOutboxClaim, DurableServiceStoreError) {
        (*self.claim, self.error)
    }
}

/// A start-intent launch failure retains both the exact outbox claim and the
/// fully pinned Registry launch request. The service engine can safely retry
/// the same linearized operation without reconstructing either authority from
/// copied identifiers.
#[must_use = "failed service launch transitions retain authority and must be handled"]
pub struct DurableServiceLaunchTransitionError {
    claim: Box<DurableServiceOutboxClaim>,
    request: Box<ServiceLaunchRequest>,
    error: DurableServiceStoreError,
}

impl fmt::Debug for DurableServiceLaunchTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.claim, &self.request);
        formatter
            .debug_struct("DurableServiceLaunchTransitionError")
            .field(
                "authority",
                &"<opaque retained StartTree claim and launch request>",
            )
            .field("error", &self.error)
            .finish()
    }
}

impl fmt::Display for DurableServiceLaunchTransitionError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.error.fmt(formatter)
    }
}

impl std::error::Error for DurableServiceLaunchTransitionError {}

impl DurableServiceLaunchTransitionError {
    pub fn error(&self) -> &DurableServiceStoreError {
        &self.error
    }

    pub fn into_parts(
        self,
    ) -> (
        DurableServiceOutboxClaim,
        ServiceLaunchRequest,
        DurableServiceStoreError,
    ) {
        (*self.claim, *self.request, self.error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ServiceRow {
    service_id: String,
    display_name: String,
    required: bool,
    startup_policy: ServiceStartupPolicy,
    restart_policy: RestartPolicy,
    resource_class: ResourceClass,
    estimated_pending_commit_mb: u64,
    max_concurrent_leases: u32,
    max_lease_ms: u64,
    max_restarts: u32,
    restart_bounds: Option<DurableRestartBounds>,
    restart_window_started_at: Option<u64>,
    restart_attempts_in_window: u32,
    next_restart_at: Option<u64>,
    idle_ttl_ms: Option<u64>,
    lifecycle_state: ServiceLifecycleState,
    generation: u64,
    restarts: u32,
    retry_required: bool,
    acquisition_closed: bool,
    idle_due_at: Option<u64>,
    last_error: Option<String>,
    last_exited_generation: Option<u64>,
    last_observed_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DurableRestartBounds {
    window_ms: u64,
    initial_backoff_ms: u64,
    maximum_backoff_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DurableRestartAttempt {
    window_started_at_ms: u64,
    attempts_in_window: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DurableRestartDecision {
    Start(DurableRestartAttempt),
    Deferred(DurableServiceRestartSchedule),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DurableRestartTerminalState {
    retry_required: bool,
    window_started_at_ms: Option<u64>,
    attempts_in_window: u32,
    next_restart_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServiceLifecycleState {
    AvailableButStopped,
    Starting,
    Ready,
    Failed,
    Stopping,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServiceTerminalProofKind {
    NotCreated,
    TreeExit {
        started_boundary_accepted: bool,
        accepted_stop: Option<ServiceStopCause>,
    },
}

impl ServiceLifecycleState {
    const fn as_str(self) -> &'static str {
        match self {
            Self::AvailableButStopped => "available_but_stopped",
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Stopping => "stopping",
        }
    }
}

impl JobStore {
    /// Irreversibly closes trusted service registration/start/launch for this
    /// runtime generation. The shutdown coordinator calls this while holding
    /// its global process-launch fence, so an in-flight guarded launch either
    /// retains its classified outcome first or observes shutdown and creates
    /// no process.
    pub(crate) fn close_durable_service_launch_gate(&self) {
        let mut gate = self
            .trusted_service_bootstrap_open
            .lock()
            .expect("trusted service bootstrap gate mutex poisoned");
        *gate = false;
    }

    /// Registers immutable service lifecycle data in the shared ledger. This
    /// operation never starts a process and is safe to repeat with the exact
    /// same registration.
    pub fn register_durable_service(
        &self,
        registration: &DurableServiceRegistration,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        validate_runtime_time(now_ms)?;
        let bootstrap_gate = self
            .trusted_service_bootstrap_open
            .lock()
            .expect("trusted service bootstrap gate mutex poisoned");
        if self.generation_shutdown.load(Ordering::Acquire) || !*bootstrap_gate {
            return Err(StoreError::AdmissionClosed.into());
        }
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_service_registration_tx(&transaction, registration, now_ms)?;
        let snapshot = service_snapshot_tx(&transaction, registration.service_id())?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// Observes one registered service without advancing time. In particular,
    /// an expired timestamp remains persisted until an explicit lifecycle
    /// mutation runs; a status poll can never publish StartTree or StopTree.
    pub fn durable_service_snapshot(
        &self,
        service_id: &str,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        validate_identifier("serviceId", service_id).map_err(ServiceLeaseError::from)?;
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let snapshot = service_snapshot_tx(&transaction, service_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// Observes every registered service from one SQLite snapshot. This is the
    /// status/dashboard path and intentionally contains no write transaction.
    pub fn durable_service_snapshots(
        &self,
    ) -> Result<Vec<DurableServiceSnapshot>, DurableServiceStoreError> {
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let mut statement =
            transaction.prepare("SELECT service_id FROM runtime_services ORDER BY service_id")?;
        let service_ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let snapshots = service_ids
            .iter()
            .map(|service_id| service_snapshot_tx(&transaction, service_id))
            .collect::<Result<Vec<_>, _>>()?;
        transaction.commit()?;
        Ok(snapshots)
    }

    /// Acquires one bounded durable lease. If this is the first lease for a
    /// stopped service, admission reservation, generation transition, and
    /// StartTree outbox publication commit atomically. Concurrent acquisitions
    /// for the same service join that generation and cannot publish a second
    /// start intent.
    // Admission is one transaction boundary and keeps its trusted
    // registration, profile, lease fence, timing, policy, and sampler
    // explicit instead of accepting an untyped caller-built options bag.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn begin_durable_service_acquire<F>(
        &self,
        registration: &DurableServiceRegistration,
        admission_profile: &DurableServiceAdmissionProfile,
        lease_id: &str,
        requested_lease_ms: u64,
        now_ms: u64,
        policy: AdmissionPolicy,
        sample_commit: F,
    ) -> Result<DurableServiceAcquireResult, DurableServiceStoreError>
    where
        F: FnOnce() -> Result<SystemCommit, StoreError>,
    {
        match self.begin_durable_service_acquire_inner(
            registration,
            admission_profile,
            lease_id,
            requested_lease_ms,
            now_ms,
            policy,
            sample_commit,
            ServiceAcquireAuthority::Independent,
        )? {
            DurableWorkerServiceAcquireResult::Evaluated(result) => Ok(result),
            DurableWorkerServiceAcquireResult::OwnerLost => Err(
                DurableServiceStoreError::CorruptService(registration.service_id().into()),
            ),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn begin_durable_worker_service_dependency_acquire<F>(
        &self,
        registration: &DurableServiceRegistration,
        admission_profile: &DurableServiceAdmissionProfile,
        dependency: &WorkerServiceDependencyAdmission,
        lease_id: &str,
        requested_lease_ms: u64,
        now_ms: u64,
        policy: AdmissionPolicy,
        sample_commit: F,
    ) -> Result<DurableWorkerServiceAcquireResult, DurableServiceStoreError>
    where
        F: FnOnce() -> Result<SystemCommit, StoreError>,
    {
        self.begin_durable_service_acquire_inner(
            registration,
            admission_profile,
            lease_id,
            requested_lease_ms,
            now_ms,
            policy,
            sample_commit,
            ServiceAcquireAuthority::WorkerDependency(dependency),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn begin_durable_service_acquire_inner<F>(
        &self,
        registration: &DurableServiceRegistration,
        admission_profile: &DurableServiceAdmissionProfile,
        lease_id: &str,
        requested_lease_ms: u64,
        now_ms: u64,
        policy: AdmissionPolicy,
        sample_commit: F,
        authority: ServiceAcquireAuthority<'_>,
    ) -> Result<DurableWorkerServiceAcquireResult, DurableServiceStoreError>
    where
        F: FnOnce() -> Result<SystemCommit, StoreError>,
    {
        require_matching_service_admission_profile(registration, admission_profile)?;
        validate_identifier("leaseId", lease_id).map_err(ServiceLeaseError::from)?;
        validate_runtime_time(now_ms)?;
        validate_lease_duration(registration.lease.limits(), requested_lease_ms)?;
        let expires_at_ms = now_ms
            .checked_add(requested_lease_ms)
            .filter(|expires| *expires <= MAX_SQLITE_UNSIGNED)
            .ok_or(ServiceLeaseError::LeaseExpiryOverflow)?;

        let admission_gate = self
            .admission_open
            .lock()
            .expect("runtime admission gate mutex poisoned");
        if self.generation_shutdown.load(Ordering::Acquire) || !*admission_gate {
            return Err(StoreError::AdmissionClosed.into());
        }
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_service_registration_tx(&transaction, registration, now_ms)?;
        let worker_dependency = match authority {
            ServiceAcquireAuthority::Independent => None,
            ServiceAcquireAuthority::WorkerDependency(dependency) => {
                match validate_worker_service_dependency_admission_tx(
                    &transaction,
                    dependency,
                    registration.service_id(),
                )? {
                    WorkerServiceDependencyOwnerValidation::Valid(validated) => Some(validated),
                    WorkerServiceDependencyOwnerValidation::Lost => {
                        transaction.rollback()?;
                        return Ok(DurableWorkerServiceAcquireResult::OwnerLost);
                    }
                }
            }
        };
        let mut service = query_service_tx(&transaction, registration.service_id())?;
        require_monotonic_time(&service, now_ms)?;
        expire_service_leases_tx(&transaction, &service, now_ms)?;
        service = query_service_tx(&transaction, registration.service_id())?;

        if service.acquisition_closed {
            return Err(ServiceLeaseError::AcquisitionClosed(service.service_id).into());
        }
        if lease_exists_tx(&transaction, lease_id)? {
            return Err(DurableServiceStoreError::DuplicateLease(lease_id.into()));
        }
        let (pending, active) = active_lease_counts_tx(&transaction, &service.service_id)?;
        if pending.saturating_add(active) >= service.max_concurrent_leases {
            return Err(ServiceLeaseError::LeaseLimitReached {
                service_id: service.service_id,
                maximum: registration.lease.limits().max_concurrent_leases(),
            }
            .into());
        }

        let (generation, claim_state) = match service.lifecycle_state {
            ServiceLifecycleState::Starting => {
                require_active_service_admission_profile_tx(
                    &transaction,
                    &service,
                    admission_profile,
                )?;
                (service.generation, ServiceLeaseClaimState::Pending)
            }
            ServiceLifecycleState::Ready => {
                require_active_service_admission_profile_tx(
                    &transaction,
                    &service,
                    admission_profile,
                )?;
                let (generation_pending, generation_active) = exact_generation_lease_counts_tx(
                    &transaction,
                    &service.service_id,
                    service.generation,
                )?;
                if generation_pending != 0 {
                    return Err(DurableServiceStoreError::CorruptService(service.service_id));
                }
                if matches!(
                    service.startup_policy,
                    ServiceStartupPolicy::OnDemand | ServiceStartupPolicy::Scheduled
                ) && service.resource_class.is_heavyweight()
                    && generation_active == 0
                {
                    // A ready dynamic resident is reflected in sampled commit
                    // and owns no static class hold, whether idle or leased.
                    // Recheck the first exact-generation active lease against
                    // global admission with a zero incremental estimate because
                    // no cold start occurs. The process-tree cap and the one
                    // cross-process dynamic-burst lease continue to bound later
                    // growth. On denial the uncommitted transaction restores
                    // expired leases and the original idle deadline.
                    let sampled_commit =
                        sample_commit().map_err(DurableServiceStoreError::Store)?;
                    let snapshot = service_acquire_admission_snapshot_tx(
                        &transaction,
                        worker_dependency.as_ref(),
                    )?;
                    let evaluation = evaluate_global_admission(
                        snapshot,
                        sampled_commit,
                        *admission_gate,
                        AdmissionRequest {
                            resource_class: service.resource_class,
                            estimated_cold_start_commit_mb: 0,
                            reserve_floor_mb: None,
                        },
                        policy,
                    );
                    if let AdmissionDecision::Denied(denial) = evaluation.decision {
                        transaction.rollback()?;
                        return Ok(DurableWorkerServiceAcquireResult::Evaluated(
                            DurableServiceAcquireResult::Denied(denial),
                        ));
                    }
                }
                transaction.execute(
                    "UPDATE runtime_services SET idle_due_at=NULL, last_observed_at=?2,
                     updated_at=?2 WHERE service_id=?1",
                    params![service.service_id, to_i64(now_ms, "service time")?],
                )?;
                (service.generation, ServiceLeaseClaimState::Active)
            }
            ServiceLifecycleState::Stopping => {
                return Err(ServiceLeaseError::ServiceStopping(service.service_id).into());
            }
            ServiceLifecycleState::AvailableButStopped => {
                if service.retry_required {
                    return Err(DurableServiceStoreError::CorruptService(service.service_id));
                }
                let generation = next_generation(&service)?;
                if let Some(denial) = begin_service_generation_tx(
                    &transaction,
                    &service,
                    admission_profile,
                    generation,
                    None,
                    now_ms,
                    policy,
                    sample_commit,
                    worker_dependency.as_ref(),
                )? {
                    transaction.commit()?;
                    return Ok(DurableWorkerServiceAcquireResult::Evaluated(
                        DurableServiceAcquireResult::Denied(denial),
                    ));
                }
                (generation, ServiceLeaseClaimState::Pending)
            }
            ServiceLifecycleState::Failed => {
                let restart = match plan_durable_service_restart(&service, now_ms)? {
                    DurableRestartDecision::Start(restart) => restart,
                    DurableRestartDecision::Deferred(schedule) => {
                        persist_restart_deferral_observation_tx(
                            &transaction,
                            &service.service_id,
                            now_ms,
                        )?;
                        transaction.commit()?;
                        return Ok(DurableWorkerServiceAcquireResult::Evaluated(
                            DurableServiceAcquireResult::RestartDeferred(schedule),
                        ));
                    }
                };
                let generation = next_generation(&service)?;
                if let Some(denial) = begin_service_generation_tx(
                    &transaction,
                    &service,
                    admission_profile,
                    generation,
                    Some(restart),
                    now_ms,
                    policy,
                    sample_commit,
                    worker_dependency.as_ref(),
                )? {
                    transaction.commit()?;
                    return Ok(DurableWorkerServiceAcquireResult::Evaluated(
                        DurableServiceAcquireResult::Denied(denial),
                    ));
                }
                (generation, ServiceLeaseClaimState::Pending)
            }
        };

        transaction.execute(
            "INSERT INTO runtime_service_leases (
                lease_id, service_id, generation, lifecycle_state,
                created_at, updated_at, expires_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
            params![
                lease_id,
                registration.service_id(),
                to_i64(generation, "service generation")?,
                lease_state_name(claim_state),
                to_i64(now_ms, "service lease creation time")?,
                to_i64(expires_at_ms, "service lease expiry")?,
            ],
        )?;
        transaction.execute(
            "UPDATE runtime_services SET last_observed_at=?2, updated_at=?2
             WHERE service_id=?1",
            params![registration.service_id(), to_i64(now_ms, "service time")?],
        )?;
        transaction.commit()?;
        Ok(DurableWorkerServiceAcquireResult::Evaluated(
            DurableServiceAcquireResult::Acquired(DurableServiceLeaseClaim {
                scope: self.generation_scope.clone(),
                lease_id: lease_id.into(),
                service_id: registration.service_id().into(),
                generation,
                expires_at_ms,
                state: claim_state,
            }),
        ))
    }

    /// Starts a registered eager service without manufacturing a lease. The
    /// exact admission reservation and StartTree outbox semantics are shared
    /// with first-lease startup. Runtime integrations use
    /// `AdmissionGovernor`; this lower-level public seam remains temporarily
    /// for the cross-crate process-owner integration fixture.
    #[doc(hidden)]
    pub fn begin_eager_durable_service_start<F>(
        &self,
        registration: &DurableServiceRegistration,
        admission_profile: &DurableServiceAdmissionProfile,
        now_ms: u64,
        policy: AdmissionPolicy,
        sample_commit: F,
    ) -> Result<DurableServiceStartResult, DurableServiceStoreError>
    where
        F: FnOnce() -> Result<SystemCommit, StoreError>,
    {
        require_matching_service_admission_profile(registration, admission_profile)?;
        if registration.lease.startup_policy() != ServiceStartupPolicy::Eager {
            return Err(ServiceLeaseError::NotEager(registration.service_id().into()).into());
        }
        validate_runtime_time(now_ms)?;
        let bootstrap_gate = self
            .trusted_service_bootstrap_open
            .lock()
            .expect("trusted service bootstrap gate mutex poisoned");
        if self.generation_shutdown.load(Ordering::Acquire) || !*bootstrap_gate {
            return Err(StoreError::AdmissionClosed.into());
        }
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        ensure_service_registration_tx(&transaction, registration, now_ms)?;
        let service = query_service_tx(&transaction, registration.service_id())?;
        require_monotonic_time(&service, now_ms)?;
        if service.acquisition_closed {
            return Err(ServiceLeaseError::AcquisitionClosed(service.service_id).into());
        }
        if matches!(
            service.lifecycle_state,
            ServiceLifecycleState::Starting | ServiceLifecycleState::Ready
        ) {
            require_active_service_admission_profile_tx(&transaction, &service, admission_profile)?;
            transaction.commit()?;
            return Ok(DurableServiceStartResult::AlreadyStartingOrReady);
        }
        if service.lifecycle_state == ServiceLifecycleState::Stopping {
            return Err(ServiceLeaseError::ServiceStopping(service.service_id).into());
        }
        let restart = match service.lifecycle_state {
            ServiceLifecycleState::AvailableButStopped => {
                if service.retry_required {
                    return Err(DurableServiceStoreError::CorruptService(service.service_id));
                }
                None
            }
            ServiceLifecycleState::Failed => {
                match plan_durable_service_restart(&service, now_ms)? {
                    DurableRestartDecision::Start(restart) => Some(restart),
                    DurableRestartDecision::Deferred(schedule) => {
                        persist_restart_deferral_observation_tx(
                            &transaction,
                            &service.service_id,
                            now_ms,
                        )?;
                        transaction.commit()?;
                        return Ok(DurableServiceStartResult::RestartDeferred(schedule));
                    }
                }
            }
            ServiceLifecycleState::Starting
            | ServiceLifecycleState::Ready
            | ServiceLifecycleState::Stopping => unreachable!("handled above"),
        };
        let generation = next_generation(&service)?;
        if let Some(denial) = begin_service_generation_tx(
            &transaction,
            &service,
            admission_profile,
            generation,
            restart,
            now_ms,
            policy,
            sample_commit,
            None,
        )? {
            transaction.commit()?;
            return Ok(DurableServiceStartResult::Denied(denial));
        }
        transaction.commit()?;
        Ok(DurableServiceStartResult::Queued)
    }
}

fn validate_runtime_time(now_ms: u64) -> Result<(), DurableServiceStoreError> {
    if now_ms > MAX_SQLITE_UNSIGNED {
        Err(ServiceLeaseError::InvalidTime(now_ms).into())
    } else {
        Ok(())
    }
}

fn validate_retained_launch_key(
    service_id: &str,
    generation: u64,
) -> Result<(), DurableServiceStoreError> {
    validate_identifier("serviceId", service_id).map_err(ServiceLeaseError::from)?;
    if generation == 0 || generation > MAX_SQLITE_UNSIGNED {
        return Err(ServiceLeaseError::InvalidLimit {
            field: "service generation",
        }
        .into());
    }
    Ok(())
}

fn validate_lease_duration(
    limits: ServiceLeaseLimits,
    requested_lease_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    if requested_lease_ms == 0 || requested_lease_ms > limits.max_lease_ms() {
        Err(ServiceLeaseError::InvalidLeaseDuration {
            actual_ms: requested_lease_ms,
            maximum_ms: limits.max_lease_ms(),
        }
        .into())
    } else {
        Ok(())
    }
}

fn to_i64(value: u64, field: &'static str) -> Result<i64, DurableServiceStoreError> {
    i64::try_from(value).map_err(|_| ServiceLeaseError::InvalidLimit { field }.into())
}

fn from_i64_u64(value: i64, service_id: &str) -> Result<u64, DurableServiceStoreError> {
    u64::try_from(value).map_err(|_| DurableServiceStoreError::CorruptService(service_id.into()))
}

fn from_i64_u32(value: i64, service_id: &str) -> Result<u32, DurableServiceStoreError> {
    u32::try_from(value).map_err(|_| DurableServiceStoreError::CorruptService(service_id.into()))
}

fn startup_policy_name(policy: ServiceStartupPolicy) -> &'static str {
    match policy {
        ServiceStartupPolicy::Eager => "eager",
        ServiceStartupPolicy::OnDemand => "on-demand",
        ServiceStartupPolicy::Scheduled => "scheduled",
        ServiceStartupPolicy::External => "external",
    }
}

fn parse_startup_policy(
    value: &str,
    service_id: &str,
) -> Result<ServiceStartupPolicy, DurableServiceStoreError> {
    match value {
        "eager" => Ok(ServiceStartupPolicy::Eager),
        "on-demand" => Ok(ServiceStartupPolicy::OnDemand),
        "scheduled" => Ok(ServiceStartupPolicy::Scheduled),
        _ => Err(DurableServiceStoreError::CorruptService(service_id.into())),
    }
}

fn restart_policy_name(policy: RestartPolicy) -> &'static str {
    match policy {
        RestartPolicy::Never => "never",
        RestartPolicy::OnFailure => "on_failure",
    }
}

fn parse_restart_policy(
    value: &str,
    service_id: &str,
) -> Result<RestartPolicy, DurableServiceStoreError> {
    match value {
        "never" => Ok(RestartPolicy::Never),
        "on_failure" => Ok(RestartPolicy::OnFailure),
        _ => Err(DurableServiceStoreError::CorruptService(service_id.into())),
    }
}

fn parse_resource_class(
    value: &str,
    service_id: &str,
) -> Result<ResourceClass, DurableServiceStoreError> {
    match value {
        "core" => Ok(ResourceClass::Core),
        "large-generation" => Ok(ResourceClass::LargeGeneration),
        "document-processing" => Ok(ResourceClass::DocumentProcessing),
        "document-model" => Ok(ResourceClass::DocumentModel),
        "media-processing" => Ok(ResourceClass::MediaProcessing),
        "browser-automation" => Ok(ResourceClass::BrowserAutomation),
        "local-model" => Ok(ResourceClass::LocalModel),
        "docker-stack" => Ok(ResourceClass::DockerStack),
        _ => Err(DurableServiceStoreError::CorruptService(service_id.into())),
    }
}

fn parse_lifecycle_state(
    value: &str,
    service_id: &str,
) -> Result<ServiceLifecycleState, DurableServiceStoreError> {
    match value {
        "available_but_stopped" => Ok(ServiceLifecycleState::AvailableButStopped),
        "starting" => Ok(ServiceLifecycleState::Starting),
        "ready" => Ok(ServiceLifecycleState::Ready),
        "failed" => Ok(ServiceLifecycleState::Failed),
        "stopping" => Ok(ServiceLifecycleState::Stopping),
        _ => Err(DurableServiceStoreError::CorruptService(service_id.into())),
    }
}

fn lease_state_name(state: ServiceLeaseClaimState) -> &'static str {
    match state {
        ServiceLeaseClaimState::Pending => "pending",
        ServiceLeaseClaimState::Active => "active",
    }
}

fn release_reason_name(reason: ServiceLeaseReleaseReason) -> &'static str {
    match reason {
        ServiceLeaseReleaseReason::Success => "success",
        ServiceLeaseReleaseReason::Failure => "failure",
        ServiceLeaseReleaseReason::Cancellation => "cancellation",
        ServiceLeaseReleaseReason::Disconnect => "disconnect",
        ServiceLeaseReleaseReason::Timeout => "timeout",
        ServiceLeaseReleaseReason::Explicit => "explicit",
    }
}

fn row_to_service(row: &Row<'_>) -> rusqlite::Result<ServiceRow> {
    let service_id = row.get::<_, String>(0)?;
    let error_service_id = service_id.clone();
    let corrupt = move |index| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("service {error_service_id} has corrupt lifecycle data"),
            )),
        )
    };
    let startup_text = row.get::<_, String>(3)?;
    let restart_text = row.get::<_, String>(4)?;
    let resource_text = row.get::<_, String>(5)?;
    let lifecycle_text = row.get::<_, String>(11)?;
    let startup_policy =
        parse_startup_policy(&startup_text, &service_id).map_err(|_| corrupt(3))?;
    let restart_policy =
        parse_restart_policy(&restart_text, &service_id).map_err(|_| corrupt(4))?;
    let resource_class =
        parse_resource_class(&resource_text, &service_id).map_err(|_| corrupt(5))?;
    let lifecycle_state =
        parse_lifecycle_state(&lifecycle_text, &service_id).map_err(|_| corrupt(11))?;
    let generation = u64::try_from(row.get::<_, i64>(12)?).map_err(|_| corrupt(12))?;
    let restarts = u32::try_from(row.get::<_, i64>(13)?).map_err(|_| corrupt(13))?;
    let idle_due_at = row
        .get::<_, Option<i64>>(16)?
        .map(u64::try_from)
        .transpose()
        .map_err(|_| corrupt(16))?;
    let last_exited_generation = row
        .get::<_, Option<i64>>(18)?
        .map(u64::try_from)
        .transpose()
        .map_err(|_| corrupt(18))?;
    let restart_window_ms = u64::try_from(row.get::<_, i64>(20)?).map_err(|_| corrupt(20))?;
    let initial_backoff_ms = u64::try_from(row.get::<_, i64>(21)?).map_err(|_| corrupt(21))?;
    let maximum_backoff_ms = u64::try_from(row.get::<_, i64>(22)?).map_err(|_| corrupt(22))?;
    let restart_window_started_at = row
        .get::<_, Option<i64>>(23)?
        .map(u64::try_from)
        .transpose()
        .map_err(|_| corrupt(23))?;
    let restart_attempts_in_window =
        u32::try_from(row.get::<_, i64>(24)?).map_err(|_| corrupt(24))?;
    let next_restart_at = row
        .get::<_, Option<i64>>(25)?
        .map(u64::try_from)
        .transpose()
        .map_err(|_| corrupt(25))?;
    let restart_bounds = match (restart_window_ms, initial_backoff_ms, maximum_backoff_ms) {
        (0, 0, 0) => None,
        (window_ms, initial_backoff_ms, maximum_backoff_ms)
            if window_ms > 0
                && window_ms <= MAX_TIMEOUT_MS
                && initial_backoff_ms > 0
                && initial_backoff_ms <= maximum_backoff_ms
                && maximum_backoff_ms <= window_ms =>
        {
            Some(DurableRestartBounds {
                window_ms,
                initial_backoff_ms,
                maximum_backoff_ms,
            })
        }
        _ => return Err(corrupt(20)),
    };
    let service = ServiceRow {
        service_id,
        display_name: row.get(1)?,
        required: row.get::<_, i64>(2)? != 0,
        startup_policy,
        restart_policy,
        resource_class,
        estimated_pending_commit_mb: u64::try_from(row.get::<_, i64>(6)?)
            .map_err(|_| corrupt(6))?,
        max_concurrent_leases: u32::try_from(row.get::<_, i64>(7)?).map_err(|_| corrupt(7))?,
        max_lease_ms: u64::try_from(row.get::<_, i64>(8)?).map_err(|_| corrupt(8))?,
        max_restarts: u32::try_from(row.get::<_, i64>(9)?).map_err(|_| corrupt(9))?,
        restart_bounds,
        restart_window_started_at,
        restart_attempts_in_window,
        next_restart_at,
        idle_ttl_ms: row
            .get::<_, Option<i64>>(10)?
            .map(u64::try_from)
            .transpose()
            .map_err(|_| corrupt(10))?,
        lifecycle_state,
        generation,
        restarts,
        retry_required: row.get::<_, i64>(14)? != 0,
        acquisition_closed: row.get::<_, i64>(15)? != 0,
        idle_due_at,
        last_error: row.get(17)?,
        last_exited_generation,
        last_observed_at: u64::try_from(row.get::<_, i64>(19)?).map_err(|_| corrupt(19))?,
    };
    let restart_shape_valid = match (service.restart_policy, service.restart_bounds) {
        (RestartPolicy::Never, None) => {
            service.max_restarts == 0
                && service.restart_window_started_at.is_none()
                && service.restart_attempts_in_window == 0
                && service.next_restart_at.is_none()
        }
        // A v5 row is explicitly unbound until its immutable manifest
        // registration supplies the newly durable v6 timing policy.
        (RestartPolicy::OnFailure, None) => {
            service.restart_window_started_at.is_none()
                && service.restart_attempts_in_window == 0
                && service.next_restart_at.is_none()
        }
        (RestartPolicy::OnFailure, Some(bounds)) => {
            service.max_restarts > 0
                && service.restart_attempts_in_window <= service.max_restarts
                && match (service.restart_window_started_at, service.next_restart_at) {
                    (None, None) => {
                        service.restart_attempts_in_window == 0 && !service.retry_required
                    }
                    (Some(started_at), Some(next_at)) => {
                        let window_end = durable_restart_window_end(started_at, bounds);
                        service.retry_required
                            && service.lifecycle_state == ServiceLifecycleState::Failed
                            && next_at >= started_at
                            && next_at <= window_end
                    }
                    (Some(_), None) => !service.retry_required,
                    (None, Some(_)) => false,
                }
        }
        (RestartPolicy::Never, Some(_)) => false,
    };
    if !restart_shape_valid {
        return Err(corrupt(20));
    }
    Ok(service)
}

const SERVICE_COLUMNS: &str = "service_id, display_name, required, startup_policy, restart_policy, resource_class, estimated_pending_commit_mb, max_concurrent_leases, max_lease_ms, max_restarts, idle_ttl_ms, lifecycle_state, generation, restarts, retry_required, acquisition_closed, idle_due_at, last_error, last_exited_generation, last_observed_at, restart_window_ms, initial_restart_backoff_ms, maximum_restart_backoff_ms, restart_window_started_at, restart_attempts_in_window, next_restart_at";

fn query_service_tx(
    connection: &Connection,
    service_id: &str,
) -> Result<ServiceRow, DurableServiceStoreError> {
    connection
        .query_row(
            &format!("SELECT {SERVICE_COLUMNS} FROM runtime_services WHERE service_id=?1"),
            params![service_id],
            row_to_service,
        )
        .optional()?
        .ok_or_else(|| DurableServiceStoreError::ServiceNotFound(service_id.into()))
}

fn ensure_service_registration_tx(
    transaction: &Transaction<'_>,
    registration: &DurableServiceRegistration,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    let existing = transaction
        .query_row(
            &format!("SELECT {SERVICE_COLUMNS} FROM runtime_services WHERE service_id=?1"),
            params![registration.service_id()],
            row_to_service,
        )
        .optional()?;
    if let Some(existing) = existing {
        let lease = &registration.lease;
        let expected_idle_ttl = lease.idle_ttl_ms();
        if existing.display_name != lease.display_name()
            || existing.required != lease.required()
            || existing.startup_policy != lease.startup_policy()
            || existing.restart_policy != lease.restart_policy()
            || existing.resource_class != registration.resource_class
            || existing.max_concurrent_leases != lease.limits().max_concurrent_leases()
            || existing.max_lease_ms != lease.limits().max_lease_ms()
            || existing.max_restarts != lease.limits().max_restarts()
            || existing.idle_ttl_ms != expected_idle_ttl
        {
            return Err(DurableServiceStoreError::RegistrationConflict(
                registration.service_id().into(),
            ));
        }
        match (existing.restart_bounds, registration.restart_bounds()) {
            (Some(actual), Some(expected))
                if actual.window_ms == expected.window_ms
                    && actual.initial_backoff_ms == expected.initial_backoff_ms
                    && actual.maximum_backoff_ms == expected.maximum_backoff_ms =>
            {
                return Ok(());
            }
            (None, Some(expected)) if existing.restart_policy == RestartPolicy::OnFailure => {
                bind_migrated_restart_policy_tx(transaction, &existing, expected, now_ms)?;
                return Ok(());
            }
            (None, None) if existing.restart_policy == RestartPolicy::Never => return Ok(()),
            _ => {
                return Err(DurableServiceStoreError::RegistrationConflict(
                    registration.service_id().into(),
                ));
            }
        }
    }
    if registration.lease.startup_policy() == ServiceStartupPolicy::External {
        return Err(ServiceLeaseError::ExternalOwnershipForbidden(
            registration.service_id().into(),
        )
        .into());
    }
    let now = to_i64(now_ms, "service registration time")?;
    let (restart_window_ms, initial_backoff_ms, maximum_backoff_ms) =
        registration.restart_bounds().map_or((0, 0, 0), |bounds| {
            (
                bounds.window_ms,
                bounds.initial_backoff_ms,
                bounds.maximum_backoff_ms,
            )
        });
    transaction.execute(
        "INSERT INTO runtime_services (
            service_id, display_name, required, startup_policy, restart_policy,
            resource_class, estimated_pending_commit_mb, max_concurrent_leases,
            max_lease_ms, max_restarts, idle_ttl_ms, lifecycle_state, generation,
            restarts, retry_required, acquisition_closed, last_observed_at,
            created_at, updated_at, restart_window_ms,
            initial_restart_backoff_ms, maximum_restart_backoff_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                   'available_but_stopped', 0, 0, 0, 0, ?12, ?12, ?12,
                   ?13, ?14, ?15)",
        params![
            registration.service_id(),
            registration.lease.display_name(),
            if registration.lease.required() {
                1_i64
            } else {
                0_i64
            },
            startup_policy_name(registration.lease.startup_policy()),
            restart_policy_name(registration.lease.restart_policy()),
            registration.resource_class.as_str(),
            to_i64(
                UNBOUND_SERVICE_ADMISSION_ESTIMATE_MB,
                "unbound service admission estimate"
            )?,
            i64::from(registration.lease.limits().max_concurrent_leases()),
            to_i64(registration.lease.limits().max_lease_ms(), "maximum lease")?,
            i64::from(registration.lease.limits().max_restarts()),
            registration
                .lease
                .idle_ttl_ms()
                .map(|value| to_i64(value, "service idle ttl"))
                .transpose()?,
            now,
            to_i64(restart_window_ms, "service restart window")?,
            to_i64(initial_backoff_ms, "initial service restart backoff")?,
            to_i64(maximum_backoff_ms, "maximum service restart backoff")?,
        ],
    )?;
    Ok(())
}

fn bind_migrated_restart_policy_tx(
    transaction: &Transaction<'_>,
    service: &ServiceRow,
    bounds: &ServiceRestartBounds,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    let (window_started_at, next_restart_at) = if service.retry_required {
        let next = now_ms
            .checked_add(bounds.initial_backoff_ms)
            .filter(|value| *value <= MAX_SQLITE_UNSIGNED)
            .ok_or(ServiceLeaseError::LeaseExpiryOverflow)?;
        (Some(now_ms), Some(next))
    } else {
        (None, None)
    };
    let changed = transaction.execute(
        "UPDATE runtime_services
         SET restart_window_ms=?2, initial_restart_backoff_ms=?3,
             maximum_restart_backoff_ms=?4, restart_window_started_at=?5,
             restart_attempts_in_window=0, next_restart_at=?6,
             last_observed_at=?7, updated_at=?7
         WHERE service_id=?1 AND restart_policy='on_failure'
           AND restart_window_ms=0 AND initial_restart_backoff_ms=0
           AND maximum_restart_backoff_ms=0",
        params![
            service.service_id,
            to_i64(bounds.window_ms, "service restart window")?,
            to_i64(bounds.initial_backoff_ms, "initial service restart backoff")?,
            to_i64(bounds.maximum_backoff_ms, "maximum service restart backoff")?,
            window_started_at
                .map(|value| to_i64(value, "service restart window start"))
                .transpose()?,
            next_restart_at
                .map(|value| to_i64(value, "next service restart"))
                .transpose()?,
            to_i64(now_ms, "service restart policy binding time")?,
        ],
    )?;
    if changed == 1 {
        Ok(())
    } else {
        Err(DurableServiceStoreError::RegistrationConflict(
            service.service_id.clone(),
        ))
    }
}

fn require_matching_service_admission_profile(
    registration: &DurableServiceRegistration,
    admission_profile: &DurableServiceAdmissionProfile,
) -> Result<(), DurableServiceStoreError> {
    if registration.service_id() == admission_profile.service_id() {
        Ok(())
    } else {
        Err(DurableServiceStoreError::AdmissionProfileConflict(
            registration.service_id().into(),
        ))
    }
}

fn require_active_service_admission_profile_tx(
    connection: &Connection,
    service: &ServiceRow,
    admission_profile: &DurableServiceAdmissionProfile,
) -> Result<(), DurableServiceStoreError> {
    let reservation = connection
        .query_row(
            "SELECT definition_key, resource_class, estimated_pending_commit_mb
             FROM runtime_admission_reservations
             WHERE subject_kind='service' AND subject_id=?1
               AND lifecycle_state IN ('pending','resident')",
            params![service.service_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    let (mode_key, resource_class, estimate) = reservation;
    let resource_class = parse_resource_class(&resource_class, &service.service_id)?;
    let estimate = from_i64_u64(estimate, &service.service_id)?;
    if !matches!(mode_key.as_str(), "lean" | "hot" | "packaged")
        || resource_class != service.resource_class
        || estimate != service.estimated_pending_commit_mb
    {
        return Err(DurableServiceStoreError::CorruptService(
            service.service_id.clone(),
        ));
    }
    if mode_key != admission_profile.reservation_definition_key()
        || estimate != admission_profile.estimated_cold_start_commit_mb()
    {
        return Err(DurableServiceStoreError::AdmissionProfileConflict(
            service.service_id.clone(),
        ));
    }
    Ok(())
}

fn service_admission_denial_is_closed(denial: &AdmissionDenial) -> bool {
    denial.code == "BREADBOARD_RESOURCE_EXHAUSTED"
        && matches!(
            denial.resource.as_str(),
            "windows_commit_critical" | "heavyweight_concurrency" | "windows_commit"
        )
        && !denial.retryable
        && !denial.reason.is_empty()
        && denial.reason.len() <= MAX_FAILURE_MESSAGE_BYTES
        && !denial.reason.chars().any(char::is_control)
        && denial.required_headroom_mb <= MAX_SQLITE_UNSIGNED
        && denial.available_headroom_mb <= MAX_SQLITE_UNSIGNED
}

fn persist_service_admission_block_tx(
    transaction: &Transaction<'_>,
    service: &ServiceRow,
    denial: &AdmissionDenial,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    if !matches!(
        service.lifecycle_state,
        ServiceLifecycleState::AvailableButStopped | ServiceLifecycleState::Failed
    ) || !service_admission_denial_is_closed(denial)
    {
        return Err(DurableServiceStoreError::InvalidAdmissionDenial(
            service.service_id.clone(),
        ));
    }
    transaction.execute(
        "INSERT INTO runtime_service_admission_blocks (
            service_id, code, resource, required_headroom_mb,
            available_headroom_mb, retryable, reason, blocked_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
         ON CONFLICT(service_id) DO UPDATE SET
            code=excluded.code,
            resource=excluded.resource,
            required_headroom_mb=excluded.required_headroom_mb,
            available_headroom_mb=excluded.available_headroom_mb,
            retryable=excluded.retryable,
            reason=excluded.reason,
            blocked_at=excluded.blocked_at",
        params![
            service.service_id,
            denial.code,
            denial.resource,
            to_i64(denial.required_headroom_mb, "required service headroom")?,
            to_i64(denial.available_headroom_mb, "available service headroom")?,
            denial.reason,
            to_i64(now_ms, "service admission block time")?,
        ],
    )?;
    Ok(())
}

fn clear_service_admission_block_tx(
    transaction: &Transaction<'_>,
    service_id: &str,
) -> Result<(), DurableServiceStoreError> {
    transaction.execute(
        "DELETE FROM runtime_service_admission_blocks WHERE service_id=?1",
        params![service_id],
    )?;
    Ok(())
}

fn service_admission_block_tx(
    connection: &Connection,
    service_id: &str,
) -> Result<Option<AdmissionDenial>, DurableServiceStoreError> {
    let row = connection
        .query_row(
            "SELECT code, resource, required_headroom_mb,
                    available_headroom_mb, retryable, reason, blocked_at
             FROM runtime_service_admission_blocks WHERE service_id=?1",
            params![service_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((code, resource, required, available, retryable, reason, blocked_at)) = row else {
        return Ok(None);
    };
    let denial = AdmissionDenial {
        code,
        resource,
        required_headroom_mb: from_i64_u64(required, service_id)?,
        available_headroom_mb: from_i64_u64(available, service_id)?,
        retryable: match retryable {
            0 => false,
            1 => true,
            _ => {
                return Err(DurableServiceStoreError::CorruptService(service_id.into()));
            }
        },
        reason,
    };
    let _blocked_at_ms = from_i64_u64(blocked_at, service_id)?;
    if !service_admission_denial_is_closed(&denial) {
        return Err(DurableServiceStoreError::CorruptService(service_id.into()));
    }
    Ok(Some(denial))
}

fn service_snapshot_tx(
    connection: &Connection,
    service_id: &str,
) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
    let service = query_service_tx(connection, service_id)?;
    let admission_denial = service_admission_block_tx(connection, service_id)?;
    let (pending_leases, active_leases) = active_lease_counts_tx(connection, service_id)?;
    let next_expiry = connection.query_row(
        "SELECT MIN(expires_at) FROM runtime_service_leases
         WHERE service_id=?1 AND lifecycle_state IN ('pending','active')",
        params![service_id],
        |row| row.get::<_, Option<i64>>(0),
    )?;
    let next_lease_expiry_ms = next_expiry
        .map(|value| from_i64_u64(value, service_id))
        .transpose()?;
    if admission_denial.is_some()
        && (!matches!(
            service.lifecycle_state,
            ServiceLifecycleState::AvailableButStopped | ServiceLifecycleState::Failed
        ) || pending_leases != 0
            || active_leases != 0)
    {
        return Err(DurableServiceStoreError::CorruptService(service.service_id));
    }
    let state = match (service.lifecycle_state, admission_denial.is_some()) {
        (ServiceLifecycleState::AvailableButStopped | ServiceLifecycleState::Failed, true) => {
            RuntimeServiceState::ResourceBlocked
        }
        (ServiceLifecycleState::AvailableButStopped, false) => {
            RuntimeServiceState::AvailableButStopped
        }
        (ServiceLifecycleState::Starting, false) => RuntimeServiceState::Starting,
        (ServiceLifecycleState::Ready, false) if pending_leases == 0 && active_leases == 0 => {
            RuntimeServiceState::Ready
        }
        (ServiceLifecycleState::Ready, false) => RuntimeServiceState::Busy,
        (ServiceLifecycleState::Failed, false) => RuntimeServiceState::Failed,
        (ServiceLifecycleState::Stopping, false) => RuntimeServiceState::Stopping,
        (
            ServiceLifecycleState::Starting
            | ServiceLifecycleState::Ready
            | ServiceLifecycleState::Stopping,
            true,
        ) => {
            unreachable!("inconsistent admission block rejected above")
        }
    };
    let restart = durable_restart_status(&service)?;
    let status = RuntimeServiceStatus {
        id: service.service_id,
        display_name: service.display_name,
        required: service.required,
        startup_policy: service.startup_policy,
        state,
        last_error: admission_denial
            .as_ref()
            .map(|denial| denial.reason.clone())
            .or(service.last_error),
        restarts: service.restarts,
        adopted: false,
    };
    status.validate().map_err(ServiceLeaseError::from)?;
    Ok(DurableServiceSnapshot {
        status,
        admission_denial,
        generation: service.generation,
        pending_leases,
        active_leases,
        acquisition_closed: service.acquisition_closed,
        next_lease_expiry_ms,
        restart,
    })
}

fn active_lease_counts_tx(
    connection: &Connection,
    service_id: &str,
) -> Result<(u32, u32), DurableServiceStoreError> {
    let (pending, active) = connection.query_row(
        "SELECT
            SUM(CASE WHEN lifecycle_state='pending' THEN 1 ELSE 0 END),
            SUM(CASE WHEN lifecycle_state='active' THEN 1 ELSE 0 END)
         FROM runtime_service_leases WHERE service_id=?1",
        params![service_id],
        |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                row.get::<_, Option<i64>>(1)?.unwrap_or(0),
            ))
        },
    )?;
    Ok((
        from_i64_u32(pending, service_id)?,
        from_i64_u32(active, service_id)?,
    ))
}

fn exact_generation_lease_counts_tx(
    connection: &Connection,
    service_id: &str,
    generation: u64,
) -> Result<(u32, u32), DurableServiceStoreError> {
    let (pending, active) = connection.query_row(
        "SELECT
            SUM(CASE WHEN lifecycle_state='pending' THEN 1 ELSE 0 END),
            SUM(CASE WHEN lifecycle_state='active' THEN 1 ELSE 0 END)
         FROM runtime_service_leases
         WHERE service_id=?1 AND generation=?2",
        params![service_id, to_i64(generation, "service generation")?],
        |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?.unwrap_or(0),
                row.get::<_, Option<i64>>(1)?.unwrap_or(0),
            ))
        },
    )?;
    Ok((
        from_i64_u32(pending, service_id)?,
        from_i64_u32(active, service_id)?,
    ))
}

fn require_monotonic_time(
    service: &ServiceRow,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    if now_ms < service.last_observed_at {
        Err(ServiceLeaseError::ClockMovedBackwards {
            previous: service.last_observed_at,
            actual: now_ms,
        }
        .into())
    } else {
        Ok(())
    }
}

fn bounded_runtime_add(start_ms: u64, duration_ms: u64) -> u64 {
    start_ms
        .saturating_add(duration_ms)
        .min(MAX_SQLITE_UNSIGNED)
}

fn durable_restart_window_end(start_ms: u64, bounds: DurableRestartBounds) -> u64 {
    bounded_runtime_add(start_ms, bounds.window_ms)
}

fn durable_restart_backoff(bounds: DurableRestartBounds, prior_attempts: u32) -> u64 {
    let mut delay = bounds.initial_backoff_ms;
    for _ in 0..prior_attempts {
        delay = delay.saturating_mul(2).min(bounds.maximum_backoff_ms);
        if delay == bounds.maximum_backoff_ms {
            break;
        }
    }
    delay
}

fn durable_restart_status(
    service: &ServiceRow,
) -> Result<DurableServiceRestartStatus, DurableServiceStoreError> {
    if service.restart_policy == RestartPolicy::Never
        || (service.lifecycle_state == ServiceLifecycleState::Failed && !service.retry_required)
    {
        return Ok(DurableServiceRestartStatus::Disabled);
    }
    let Some(bounds) = service.restart_bounds else {
        return Ok(DurableServiceRestartStatus::PolicyBindingRequired);
    };
    let window_ends_at_ms = service
        .restart_window_started_at
        .map(|started_at| durable_restart_window_end(started_at, bounds));
    if !service.retry_required {
        return Ok(DurableServiceRestartStatus::Idle {
            attempts_in_window: service.restart_attempts_in_window,
            window_ends_at_ms,
        });
    }
    let window_ends_at_ms = window_ends_at_ms
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    let eligible_at_ms = service
        .next_restart_at
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    Ok(DurableServiceRestartStatus::Deferred(
        DurableServiceRestartSchedule {
            eligible_at_ms,
            window_ends_at_ms,
            attempts_in_window: service.restart_attempts_in_window,
            maximum_restarts: service.max_restarts,
            window_exhausted: service.restart_attempts_in_window >= service.max_restarts,
        },
    ))
}

fn plan_durable_service_restart(
    service: &ServiceRow,
    now_ms: u64,
) -> Result<DurableRestartDecision, DurableServiceStoreError> {
    if service.lifecycle_state != ServiceLifecycleState::Failed || !service.retry_required {
        return Err(ServiceLeaseError::RestartForbidden(service.service_id.clone()).into());
    }
    if service.restart_policy != RestartPolicy::OnFailure {
        return Err(ServiceLeaseError::RestartForbidden(service.service_id.clone()).into());
    }
    let bounds = service
        .restart_bounds
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    let persisted_start = service
        .restart_window_started_at
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    let persisted_eligible = service
        .next_restart_at
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    let persisted_end = durable_restart_window_end(persisted_start, bounds);
    let (window_started_at_ms, attempts_in_window, eligible_at_ms) = if now_ms >= persisted_end {
        (now_ms, 0, now_ms)
    } else {
        (
            persisted_start,
            service.restart_attempts_in_window,
            persisted_eligible,
        )
    };
    let window_ends_at_ms = durable_restart_window_end(window_started_at_ms, bounds);
    let window_exhausted = attempts_in_window >= service.max_restarts;
    let eligible_at_ms = if window_exhausted {
        window_ends_at_ms
    } else {
        eligible_at_ms
    };
    if now_ms < eligible_at_ms || window_exhausted {
        return Ok(DurableRestartDecision::Deferred(
            DurableServiceRestartSchedule {
                eligible_at_ms,
                window_ends_at_ms,
                attempts_in_window,
                maximum_restarts: service.max_restarts,
                window_exhausted,
            },
        ));
    }
    let attempts_in_window = attempts_in_window
        .checked_add(1)
        .filter(|attempts| *attempts <= service.max_restarts)
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    Ok(DurableRestartDecision::Start(DurableRestartAttempt {
        window_started_at_ms,
        attempts_in_window,
    }))
}

fn durable_restart_terminal_state(
    service: &ServiceRow,
    retry_requested: bool,
    now_ms: u64,
) -> Result<DurableRestartTerminalState, DurableServiceStoreError> {
    let retry_required = retry_requested && service.restart_policy == RestartPolicy::OnFailure;
    if !retry_required {
        return Ok(DurableRestartTerminalState {
            retry_required: false,
            window_started_at_ms: service.restart_window_started_at,
            attempts_in_window: service.restart_attempts_in_window,
            next_restart_at_ms: None,
        });
    }
    let bounds = service
        .restart_bounds
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service.service_id.clone()))?;
    let (window_started_at_ms, attempts_in_window) = match service.restart_window_started_at {
        Some(started_at) if now_ms < durable_restart_window_end(started_at, bounds) => {
            (started_at, service.restart_attempts_in_window)
        }
        _ => (now_ms, 0),
    };
    let window_ends_at_ms = durable_restart_window_end(window_started_at_ms, bounds);
    let next_restart_at_ms = if attempts_in_window >= service.max_restarts {
        window_ends_at_ms
    } else {
        bounded_runtime_add(now_ms, durable_restart_backoff(bounds, attempts_in_window))
            .min(window_ends_at_ms)
    };
    Ok(DurableRestartTerminalState {
        retry_required: true,
        window_started_at_ms: Some(window_started_at_ms),
        attempts_in_window,
        next_restart_at_ms: Some(next_restart_at_ms),
    })
}

fn persist_restart_deferral_observation_tx(
    transaction: &Transaction<'_>,
    service_id: &str,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    let changed = transaction.execute(
        "UPDATE runtime_services SET last_observed_at=?2, updated_at=?2
         WHERE service_id=?1 AND lifecycle_state='failed' AND retry_required=1",
        params![service_id, to_i64(now_ms, "service restart observation")?],
    )?;
    if changed == 1 {
        Ok(())
    } else {
        Err(DurableServiceStoreError::CorruptService(service_id.into()))
    }
}

fn next_generation(service: &ServiceRow) -> Result<u64, DurableServiceStoreError> {
    service
        .generation
        .checked_add(1)
        .filter(|generation| *generation <= MAX_SQLITE_UNSIGNED)
        .ok_or_else(|| ServiceLeaseError::GenerationExhausted.into())
}

fn service_acquire_admission_snapshot_tx(
    transaction: &Transaction<'_>,
    worker_dependency: Option<&ValidatedWorkerServiceDependencyAdmission>,
) -> Result<crate::store::GlobalAdmissionSnapshot, StoreError> {
    match worker_dependency {
        Some(admission) => {
            global_admission_snapshot_for_worker_dependency_tx(transaction, admission)
        }
        None => global_admission_snapshot_tx(transaction),
    }
}

// Keep every authority-bearing input explicit at this single transaction
// boundary; bundling them would permit invalid partial combinations.
#[allow(clippy::too_many_arguments)]
fn begin_service_generation_tx<F>(
    transaction: &Transaction<'_>,
    service: &ServiceRow,
    admission_profile: &DurableServiceAdmissionProfile,
    generation: u64,
    restart: Option<DurableRestartAttempt>,
    now_ms: u64,
    policy: AdmissionPolicy,
    sample_commit: F,
    worker_dependency: Option<&ValidatedWorkerServiceDependencyAdmission>,
) -> Result<Option<AdmissionDenial>, DurableServiceStoreError>
where
    F: FnOnce() -> Result<SystemCommit, StoreError>,
{
    require_monotonic_time(service, now_ms)?;
    let active_reservations: i64 = transaction.query_row(
        "SELECT COUNT(*) FROM runtime_admission_reservations
         WHERE subject_kind='service' AND subject_id=?1
           AND lifecycle_state IN ('pending','resident')",
        params![service.service_id],
        |row| row.get(0),
    )?;
    if active_reservations != 0 {
        return Err(DurableServiceStoreError::CorruptService(
            service.service_id.clone(),
        ));
    }
    let sampled_commit = sample_commit().map_err(DurableServiceStoreError::Store)?;
    let snapshot = service_acquire_admission_snapshot_tx(transaction, worker_dependency)?;
    let evaluation = evaluate_global_admission(
        snapshot,
        sampled_commit,
        true,
        AdmissionRequest {
            resource_class: service.resource_class,
            estimated_cold_start_commit_mb: admission_profile.estimated_cold_start_commit_mb(),
            reserve_floor_mb: None,
        },
        policy,
    );
    if let AdmissionDecision::Denied(denial) = evaluation.decision {
        persist_service_admission_block_tx(transaction, service, &denial, now_ms)?;
        transaction.execute(
            "UPDATE runtime_services SET last_observed_at=?2, updated_at=?2
             WHERE service_id=?1",
            params![
                service.service_id,
                to_i64(now_ms, "service admission time")?
            ],
        )?;
        return Ok(Some(denial));
    }
    clear_service_admission_block_tx(transaction, &service.service_id)?;
    let now = to_i64(now_ms, "service generation start time")?;
    let is_restart = restart.is_some();
    let restart_window_started_at = restart
        .map(|attempt| to_i64(attempt.window_started_at_ms, "service restart window start"))
        .transpose()?;
    let restart_attempts_in_window = restart.map(|attempt| i64::from(attempt.attempts_in_window));
    transaction.execute(
        "INSERT INTO runtime_admission_reservations (
            subject_kind, subject_id, definition_key, resource_class,
            estimated_pending_commit_mb, lifecycle_state, created_at, updated_at
         ) VALUES ('service', ?1, ?2, ?3, ?4, 'pending', ?5, ?5)",
        params![
            service.service_id,
            admission_profile.reservation_definition_key(),
            service.resource_class.as_str(),
            to_i64(
                admission_profile.estimated_cold_start_commit_mb(),
                "service admission estimate"
            )?,
            now,
        ],
    )?;
    let changed = transaction.execute(
        "UPDATE runtime_services SET lifecycle_state='starting', generation=?2,
         restarts=CASE WHEN ?3=1 AND restarts<64 THEN restarts+1 ELSE restarts END,
         retry_required=0, idle_due_at=NULL, last_error=NULL,
         estimated_pending_commit_mb=?4, last_observed_at=?5, updated_at=?5,
         restart_window_started_at=CASE WHEN ?3=1 THEN ?6 ELSE restart_window_started_at END,
         restart_attempts_in_window=CASE WHEN ?3=1 THEN ?7 ELSE restart_attempts_in_window END,
         next_restart_at=CASE WHEN ?3=1 THEN NULL ELSE next_restart_at END
         WHERE service_id=?1 AND generation<?2
           AND lifecycle_state IN ('available_but_stopped','failed')",
        params![
            service.service_id,
            to_i64(generation, "service generation")?,
            if is_restart { 1_i64 } else { 0_i64 },
            to_i64(
                admission_profile.estimated_cold_start_commit_mb(),
                "service admission estimate"
            )?,
            now,
            restart_window_started_at,
            restart_attempts_in_window,
        ],
    )?;
    if changed != 1 {
        return Err(DurableServiceStoreError::CorruptService(
            service.service_id.clone(),
        ));
    }
    if !insert_service_intent_tx(
        transaction,
        &service.service_id,
        generation,
        "start_tree",
        None,
        now_ms,
    )? {
        return Err(DurableServiceStoreError::CorruptService(
            service.service_id.clone(),
        ));
    }
    Ok(None)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PersistedLease {
    service_id: String,
    generation: u64,
    state: PersistedLeaseState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PersistedLeaseState {
    Pending,
    Active,
    Released,
}

fn query_lease_tx(
    connection: &Connection,
    lease_id: &str,
) -> Result<Option<PersistedLease>, DurableServiceStoreError> {
    let row = connection
        .query_row(
            "SELECT service_id, generation, lifecycle_state
             FROM runtime_service_leases WHERE lease_id=?1",
            params![lease_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    row.map(|(service_id, generation, state)| {
        let generation = from_i64_u64(generation, &service_id)?;
        let state = match state.as_str() {
            "pending" => PersistedLeaseState::Pending,
            "active" => PersistedLeaseState::Active,
            "released" => PersistedLeaseState::Released,
            _ => return Err(DurableServiceStoreError::CorruptService(service_id)),
        };
        Ok(PersistedLease {
            service_id,
            generation,
            state,
        })
    })
    .transpose()
}

fn lease_exists_tx(
    connection: &Connection,
    lease_id: &str,
) -> Result<bool, DurableServiceStoreError> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM runtime_service_leases WHERE lease_id=?1)",
        params![lease_id],
        |row| row.get::<_, i64>(0),
    )? != 0)
}

fn expire_service_leases_tx(
    transaction: &Transaction<'_>,
    service: &ServiceRow,
    now_ms: u64,
) -> Result<usize, DurableServiceStoreError> {
    require_monotonic_time(service, now_ms)?;
    let now = to_i64(now_ms, "service lease expiry time")?;
    let expired = transaction.execute(
        "UPDATE runtime_service_leases SET lifecycle_state='released', released_at=?2,
         release_reason='timeout', updated_at=?2
         WHERE service_id=?1 AND lifecycle_state IN ('pending','active')
           AND expires_at<=?2",
        params![service.service_id, now],
    )?;
    schedule_idle_if_eligible_tx(transaction, &service.service_id, now_ms)?;
    Ok(expired)
}

fn schedule_idle_if_eligible_tx(
    transaction: &Transaction<'_>,
    service_id: &str,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    let service = query_service_tx(transaction, service_id)?;
    if service.lifecycle_state != ServiceLifecycleState::Ready
        || service.idle_due_at.is_some()
        || !matches!(
            service.startup_policy,
            ServiceStartupPolicy::OnDemand | ServiceStartupPolicy::Scheduled
        )
    {
        return Ok(());
    }
    let (pending, active) = active_lease_counts_tx(transaction, service_id)?;
    if pending != 0 || active != 0 {
        return Ok(());
    }
    let idle_ttl = service
        .idle_ttl_ms
        .ok_or_else(|| DurableServiceStoreError::CorruptService(service_id.into()))?;
    let due = now_ms
        .checked_add(idle_ttl)
        .filter(|value| *value <= MAX_SQLITE_UNSIGNED)
        .ok_or(ServiceLeaseError::LeaseExpiryOverflow)?;
    transaction.execute(
        "UPDATE runtime_services SET idle_due_at=?2, updated_at=?3
         WHERE service_id=?1 AND lifecycle_state='ready' AND idle_due_at IS NULL",
        params![
            service_id,
            to_i64(due, "service idle deadline")?,
            to_i64(now_ms, "service idle schedule time")?,
        ],
    )?;
    Ok(())
}

fn service_reservation_state_tx(
    transaction: &Connection,
    service_id: &str,
) -> Result<Option<&'static str>, DurableServiceStoreError> {
    let state = transaction
        .query_row(
            "SELECT lifecycle_state FROM runtime_admission_reservations
             WHERE subject_kind='service' AND subject_id=?1
             ORDER BY reservation_id DESC LIMIT 1",
            params![service_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match state.as_deref() {
        None => Ok(None),
        Some("pending") => Ok(Some("pending")),
        Some("resident") => Ok(Some("resident")),
        Some("released") => Ok(Some("released")),
        Some(_) => Err(DurableServiceStoreError::CorruptService(service_id.into())),
    }
}

fn settle_service_reservation_tx(
    transaction: &Transaction<'_>,
    service_id: &str,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    let changed = transaction.execute(
        "UPDATE runtime_admission_reservations
         SET lifecycle_state='resident', settled_at=?2, updated_at=?2
         WHERE subject_kind='service' AND subject_id=?1 AND lifecycle_state='pending'",
        params![
            service_id,
            to_i64(now_ms, "service reservation settlement")?
        ],
    )?;
    if changed != 1 {
        return Err(DurableServiceStoreError::CorruptService(service_id.into()));
    }
    Ok(())
}

fn release_service_reservation_tx(
    transaction: &Transaction<'_>,
    service_id: &str,
    now_ms: u64,
) -> Result<bool, DurableServiceStoreError> {
    let changed = transaction.execute(
        "UPDATE runtime_admission_reservations
         SET lifecycle_state='released', released_at=?2, updated_at=?2
         WHERE subject_kind='service' AND subject_id=?1
           AND lifecycle_state IN ('pending','resident')",
        params![service_id, to_i64(now_ms, "service reservation release")?],
    )?;
    if changed > 1 {
        return Err(DurableServiceStoreError::CorruptService(service_id.into()));
    }
    Ok(changed == 1)
}

const SERVICE_READINESS_TIMEOUT_MESSAGE: &str =
    "Service did not become ready before its trusted startup deadline";
const SERVICE_PREPARATION_FAILURE_MESSAGE: &str = "Service launch prerequisites were unavailable";

fn service_exit_disposition(
    tree_exit: &ProcessTreeExit,
    accepted_stop: Option<ServiceStopCause>,
) -> (
    ServiceLifecycleState,
    bool,
    ServiceLeaseReleaseReason,
    Option<&'static str>,
) {
    match (
        tree_exit.classification(),
        tree_exit.stop_outcome(),
        accepted_stop,
    ) {
        (
            ProcessExitClassification::Stopped,
            Some(crate::ProcessStopOutcome::Graceful)
            | Some(crate::ProcessStopOutcome::Forced)
            | Some(crate::ProcessStopOutcome::ForcedAfterGrace),
            Some(ServiceStopCause::Failure),
        ) => (
            ServiceLifecycleState::Failed,
            true,
            ServiceLeaseReleaseReason::Failure,
            Some(SERVICE_READINESS_TIMEOUT_MESSAGE),
        ),
        (
            ProcessExitClassification::Stopped,
            Some(crate::ProcessStopOutcome::Graceful)
            | Some(crate::ProcessStopOutcome::Forced)
            | Some(crate::ProcessStopOutcome::ForcedAfterGrace),
            Some(ServiceStopCause::Idle | ServiceStopCause::Shutdown),
        ) => (
            ServiceLifecycleState::AvailableButStopped,
            false,
            ServiceLeaseReleaseReason::Cancellation,
            None,
        ),
        (
            ProcessExitClassification::Stopped,
            Some(crate::ProcessStopOutcome::ParentDisconnect),
            _,
        ) => (
            ServiceLifecycleState::Failed,
            true,
            ServiceLeaseReleaseReason::Disconnect,
            Some("Service process tree lost its runtime owner"),
        ),
        (ProcessExitClassification::Stopped, _, _) => (
            ServiceLifecycleState::Failed,
            true,
            ServiceLeaseReleaseReason::Failure,
            Some("Service process stopped without matching durable StopTree authority"),
        ),
        (ProcessExitClassification::TargetExit, _, _) => (
            ServiceLifecycleState::Failed,
            true,
            ServiceLeaseReleaseReason::Failure,
            Some("Service process exited unexpectedly"),
        ),
        (ProcessExitClassification::ResourceExhausted, _, _) => (
            ServiceLifecycleState::Failed,
            false,
            ServiceLeaseReleaseReason::Failure,
            Some("Service process exhausted its enforced resource limit"),
        ),
        (ProcessExitClassification::SupervisorFailure, _, _) => (
            ServiceLifecycleState::Failed,
            true,
            ServiceLeaseReleaseReason::Failure,
            Some("Service process tree supervision failed"),
        ),
        (ProcessExitClassification::WorkerProtocolFault, _, _) => (
            ServiceLifecycleState::Failed,
            true,
            ServiceLeaseReleaseReason::Failure,
            Some("Service process emitted an invalid supervisor event stream"),
        ),
    }
}

fn service_not_created_message(error: &ProcessOwnerError) -> &'static str {
    match error {
        ProcessOwnerError::Path(_) => "Service launch material failed trusted-path revalidation",
        ProcessOwnerError::InvalidLaunch(_) | ProcessOwnerError::GenerationScopeMismatch => {
            "Service launch authority was invalid"
        }
        ProcessOwnerError::MissingEnvironment => "Service launch environment was unavailable",
        ProcessOwnerError::UnsupportedPlatform => {
            "Authoritative service process ownership is unsupported on this platform"
        }
        ProcessOwnerError::Spawn(_) => "Service process could not be created",
        ProcessOwnerError::GenerationContainment(_) => {
            "Service process generation containment could not be established"
        }
        ProcessOwnerError::Control(_)
        | ProcessOwnerError::Protocol(_)
        | ProcessOwnerError::SupervisorRejected { .. }
        | ProcessOwnerError::MissingTerminalReceipt
        | ProcessOwnerError::InvalidEventWait
        | ProcessOwnerError::EventWaitTimeout
        | ProcessOwnerError::SupervisorExitTimeout
        | ProcessOwnerError::ExitStatusMismatch
        | ProcessOwnerError::InvalidState(_) => "Service launch supervision failed",
    }
}

fn insert_service_intent_tx(
    transaction: &Transaction<'_>,
    service_id: &str,
    generation: u64,
    action: &str,
    stop_cause: Option<&str>,
    now_ms: u64,
) -> Result<bool, DurableServiceStoreError> {
    let changed = transaction.execute(
        "INSERT OR IGNORE INTO runtime_service_outbox (
            service_id, generation, action, stop_cause, lifecycle_state,
            claim_epoch, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, 'pending', 0, ?5, ?5)",
        params![
            service_id,
            to_i64(generation, "service intent generation")?,
            action,
            stop_cause,
            to_i64(now_ms, "service intent creation time")?,
        ],
    )?;
    Ok(changed == 1)
}

fn supersede_unacked_service_intents_tx(
    transaction: &Transaction<'_>,
    service_id: &str,
    generation: u64,
    now_ms: u64,
) -> Result<(), DurableServiceStoreError> {
    transaction.execute(
        "UPDATE runtime_service_outbox SET lifecycle_state='superseded', updated_at=?3
         WHERE service_id=?1 AND generation=?2
           AND lifecycle_state IN ('pending','claimed')",
        params![
            service_id,
            to_i64(generation, "service intent generation")?,
            to_i64(now_ms, "service intent supersession time")?,
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OutboxState {
    Pending,
    Claimed,
    Acked,
    Superseded,
}

fn parse_outbox_state(
    service_id: &str,
    state: &str,
) -> Result<OutboxState, DurableServiceStoreError> {
    match state {
        "pending" => Ok(OutboxState::Pending),
        "claimed" => Ok(OutboxState::Claimed),
        "acked" => Ok(OutboxState::Acked),
        "superseded" => Ok(OutboxState::Superseded),
        _ => Err(DurableServiceStoreError::CorruptService(service_id.into())),
    }
}

fn query_generation_start_intent_state_tx(
    connection: &Connection,
    service_id: &str,
    generation: u64,
) -> Result<Option<OutboxState>, DurableServiceStoreError> {
    let state = connection
        .query_row(
            "SELECT lifecycle_state FROM runtime_service_outbox
             WHERE service_id=?1 AND generation=?2 AND action='start_tree'",
            params![service_id, to_i64(generation, "service intent generation")?],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    state
        .map(|state| parse_outbox_state(service_id, &state))
        .transpose()
}

fn query_generation_stop_intent_tx(
    connection: &Connection,
    service_id: &str,
    generation: u64,
) -> Result<Option<(ServiceStopCause, OutboxState)>, DurableServiceStoreError> {
    let row = connection
        .query_row(
            "SELECT stop_cause, lifecycle_state FROM runtime_service_outbox
             WHERE service_id=?1 AND generation=?2 AND action='stop_tree'",
            params![service_id, to_i64(generation, "service intent generation")?],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    row.map(|(stop_cause, state)| {
        let action = parse_service_action(
            service_id,
            generation,
            "stop_tree",
            Some(stop_cause.as_str()),
        )?;
        let ServiceLeaseAction::StopTree { cause, .. } = action else {
            unreachable!("a parsed stop_tree action cannot become StartTree");
        };
        Ok((cause, parse_outbox_state(service_id, state.as_str())?))
    })
    .transpose()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PersistedOutboxFence {
    claim_epoch: u64,
    claim_expires_at: u64,
    state: OutboxState,
    action: ServiceLeaseAction,
}

fn query_outbox_fence_tx(
    connection: &Connection,
    intent_id: i64,
) -> Result<Option<PersistedOutboxFence>, DurableServiceStoreError> {
    let row = connection
        .query_row(
            "SELECT service_id, generation, action, stop_cause, lifecycle_state,
                    claim_epoch, claim_expires_at
             FROM runtime_service_outbox WHERE intent_id=?1",
            params![intent_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                ))
            },
        )
        .optional()?;
    row.map(
        |(service_id, generation, action, stop_cause, state, claim_epoch, expires)| {
            let generation = from_i64_u64(generation, &service_id)?;
            let action =
                parse_service_action(&service_id, generation, &action, stop_cause.as_deref())?;
            let state = parse_outbox_state(&service_id, &state)?;
            let claim_epoch = from_i64_u64(claim_epoch, &service_id)?;
            let claim_expires_at = match (state, expires) {
                (OutboxState::Claimed | OutboxState::Acked, Some(value)) => {
                    from_i64_u64(value, &service_id)?
                }
                (OutboxState::Pending | OutboxState::Superseded, _) => 0,
                _ => return Err(DurableServiceStoreError::CorruptService(service_id)),
            };
            Ok(PersistedOutboxFence {
                claim_epoch,
                claim_expires_at,
                state,
                action,
            })
        },
    )
    .transpose()
}

fn parse_service_action(
    service_id: &str,
    generation: u64,
    action: &str,
    stop_cause: Option<&str>,
) -> Result<ServiceLeaseAction, DurableServiceStoreError> {
    match (action, stop_cause) {
        ("start_tree", None) => Ok(ServiceLeaseAction::StartTree {
            service_id: service_id.into(),
            generation,
        }),
        ("stop_tree", Some("idle")) => Ok(ServiceLeaseAction::StopTree {
            service_id: service_id.into(),
            generation,
            cause: ServiceStopCause::Idle,
        }),
        ("stop_tree", Some("shutdown")) => Ok(ServiceLeaseAction::StopTree {
            service_id: service_id.into(),
            generation,
            cause: ServiceStopCause::Shutdown,
        }),
        ("stop_tree", Some("failure")) => Ok(ServiceLeaseAction::StopTree {
            service_id: service_id.into(),
            generation,
            cause: ServiceStopCause::Failure,
        }),
        _ => Err(DurableServiceStoreError::CorruptService(service_id.into())),
    }
}

fn require_acknowledged_start_authority_tx(
    transaction: &Connection,
    authority: &DurableServiceStartAuthority,
) -> Result<(), DurableServiceStoreError> {
    let persisted = query_outbox_fence_tx(transaction, authority.intent_id)?
        .ok_or(DurableServiceStoreError::OutboxFenceMismatch)?;
    let expected = ServiceLeaseAction::StartTree {
        service_id: authority.service_id.clone(),
        generation: authority.generation,
    };
    if persisted.state != OutboxState::Acked
        || persisted.claim_epoch != authority.claim_epoch
        || persisted.action != expected
    {
        Err(DurableServiceStoreError::OutboxFenceMismatch)
    } else {
        Ok(())
    }
}

fn require_service_generation(
    service: &ServiceRow,
    generation: u64,
) -> Result<(), DurableServiceStoreError> {
    if service.generation == generation {
        Ok(())
    } else {
        Err(DurableServiceStoreError::StaleGeneration {
            service_id: service.service_id.clone(),
            expected: service.generation,
            actual: generation,
        })
    }
}

/// Called only from `JobStore` restart reconciliation after the exact pinned
/// data-root drain proof has been consumed. The transaction is shared with job
/// reconciliation: stale service leases, reservations, and unacked intents are
/// released/superseded before any new runtime generation may admit work.
pub(crate) fn reconcile_services_after_runtime_restart_tx(
    transaction: &Transaction<'_>,
    now_ms: i64,
) -> Result<(), StoreError> {
    transaction.execute(
        "UPDATE runtime_service_leases
         SET lifecycle_state='released', released_at=?1,
             release_reason='runtime-restart', updated_at=?1
         WHERE lifecycle_state IN ('pending','active')",
        params![now_ms],
    )?;
    transaction.execute(
        "UPDATE runtime_admission_reservations
         SET lifecycle_state='released', released_at=?1, updated_at=?1
         WHERE subject_kind='service' AND lifecycle_state IN ('pending','resident')",
        params![now_ms],
    )?;
    transaction.execute(
        "UPDATE runtime_service_outbox
         SET lifecycle_state='superseded', updated_at=?1
         WHERE lifecycle_state IN ('pending','claimed')",
        params![now_ms],
    )?;
    transaction.execute(
        "UPDATE runtime_services
         SET lifecycle_state='available_but_stopped',
             last_exited_generation=CASE WHEN generation>0 THEN generation
                                         ELSE last_exited_generation END,
             retry_required=0, idle_due_at=NULL,
             last_error=NULL, last_observed_at=?1, updated_at=?1
         WHERE lifecycle_state IN ('starting','ready','stopping')",
        params![now_ms],
    )?;
    transaction.execute(
        "UPDATE runtime_services
         SET acquisition_closed=0, idle_due_at=NULL,
             last_observed_at=?1, updated_at=?1
         WHERE lifecycle_state NOT IN ('starting','ready','stopping')",
        params![now_ms],
    )?;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use crate::{AuthenticatedJobContext, JobAdmissionResult, Registry, RuntimePaths};
    use breadboard_runtime_protocol::{
        JobSubmissionPayload, RuntimeMode, ServiceDefinition, ServiceExecutableAuthority,
        ServiceHttpReadiness, ServiceInstallProbe, ServiceInstallProbeAuthority,
        ServiceInstallProbeFile, ServiceLaunchProfile, ServiceRequirement, ServiceResourceLimits,
        ServiceRestartBounds, ServiceWorkingDirectoryPolicy, TrustedServiceEnvironmentSource,
    };
    use std::cell::Cell;
    use std::fs;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, JobStore) {
        let directory = tempdir().unwrap();
        let store = JobStore::open_for_test(directory.path().join("runtime-v2.sqlite3")).unwrap();
        (directory, store)
    }

    struct GbrainDependencyFixture {
        context: AuthenticatedJobContext,
        job_id: String,
        dependency: WorkerServiceDependencyAdmission,
        registration: DurableServiceRegistration,
        admission_profile: DurableServiceAdmissionProfile,
    }

    fn admitted_gbrain_dependency(
        directory: &tempfile::TempDir,
        store: &JobStore,
    ) -> GbrainDependencyFixture {
        let workers = breadboard_runtime_protocol::parse_worker_manifest(include_bytes!(
            "../../../desktop/runtime-v2/manifests/workers.json"
        ))
        .unwrap();
        let services = breadboard_runtime_protocol::parse_service_manifest(include_bytes!(
            "../../../desktop/runtime-v2/manifests/services.json"
        ))
        .unwrap();
        let registry = Registry::new(workers, services, RuntimeMode::Hot).unwrap();
        fs::create_dir_all(directory.path().join("app")).unwrap();
        fs::create_dir_all(directory.path().join("runtime-root")).unwrap();
        let paths = RuntimePaths::new(
            directory.path(),
            directory.path().join("app"),
            directory.path().join("runtime-root"),
        )
        .unwrap();
        let context =
            AuthenticatedJobContext::for_verified_user(7, Some("garden-one"), None).unwrap();
        let job = registry
            .submit_job(
                store,
                &paths,
                &context,
                &JobSubmissionPayload {
                    job_type: "gbrain-sync".into(),
                    garden_id: Some("garden-one".into()),
                    conversation_id: None,
                    idempotency_key: "gbrain-sync-v2:dependency-admission-test".into(),
                    input_uploads: Vec::new(),
                    request_payload: serde_json::json!({
                        "protocolVersion": 1,
                        "operation": "sync-garden",
                        "clusterId": 12,
                        "queueJobId": 44
                    }),
                },
            )
            .unwrap();
        let admission = registry.admission_for_job_type("gbrain-sync").unwrap();
        assert!(matches!(
            store
                .try_admit_job(&job.job_id, &admission, AdmissionPolicy::default(), || {
                    commit_sample()
                })
                .unwrap(),
            JobAdmissionResult::Admitted(_)
        ));
        let mut dependencies = registry
            .required_service_dependency_admissions_for_job(store, &job.job_id, "gbrain-sync-node")
            .unwrap();
        assert_eq!(dependencies.len(), 1);
        GbrainDependencyFixture {
            context,
            job_id: job.job_id,
            dependency: dependencies.pop().unwrap(),
            registration: registry.durable_service_registration("gbrain").unwrap(),
            admission_profile: registry
                .durable_service_admission_profile("gbrain")
                .unwrap(),
        }
    }

    fn definition(service_id: &str) -> ServiceDefinition {
        ServiceDefinition {
            id: service_id.into(),
            display_name: "Search".into(),
            capability_ids: vec!["search-query".into()],
            requirement: ServiceRequirement::Required,
            launch_profiles: vec![ServiceLaunchProfile {
                modes: vec![RuntimeMode::Lean, RuntimeMode::Hot, RuntimeMode::Packaged],
                executable_authority: ServiceExecutableAuthority::RuntimeRoot,
                allowed_executable: "runtime/search.exe".into(),
                arguments: Vec::new(),
                environment_source: TrustedServiceEnvironmentSource::Dashboard,
                working_directory: ServiceWorkingDirectoryPolicy::AppRoot,
                install_probe: ServiceInstallProbe::FilesPresent {
                    files: vec![ServiceInstallProbeFile {
                        authority: ServiceInstallProbeAuthority::RuntimeRoot,
                        path: "runtime/search.exe".into(),
                    }],
                },
                resource_limits: ServiceResourceLimits {
                    estimated_cold_start_commit_mb: 64,
                    soft_commit_limit_mb: 0,
                    hard_commit_limit_mb: 128,
                },
            }],
            readiness: ServiceHttpReadiness {
                path: "/health".into(),
                expected_body_contains: None,
                request_timeout_ms: 100,
                poll_interval_ms: 100,
                startup_timeout_ms: 1_000,
            },
            startup_policy: ServiceStartupPolicy::OnDemand,
            resource_class: ResourceClass::Core,
            dependencies: Vec::new(),
            maximum_concurrent_leases: 16,
            maximum_lease_ms: 1_000,
            idle_ttl_ms: Some(100),
            graceful_shutdown_ms: 1_000,
            restart_policy: RestartPolicy::OnFailure,
            restart_bounds: Some(ServiceRestartBounds {
                maximum_restarts: 2,
                window_ms: 1_000,
                initial_backoff_ms: 10,
                maximum_backoff_ms: 100,
            }),
        }
    }

    fn registration(service_id: &str) -> DurableServiceRegistration {
        registration_with_policy_and_class(
            service_id,
            ServiceStartupPolicy::OnDemand,
            ResourceClass::Core,
        )
    }

    fn registration_with_policy_and_class(
        service_id: &str,
        startup_policy: ServiceStartupPolicy,
        resource_class: ResourceClass,
    ) -> DurableServiceRegistration {
        let mut definition = definition(service_id);
        definition.startup_policy = startup_policy;
        definition.resource_class = resource_class;
        if startup_policy == ServiceStartupPolicy::Eager {
            definition.idle_ttl_ms = None;
        }
        let limits = ServiceLeaseLimits::new(16, 1_000, 2).unwrap();
        let lease = ServiceLeaseRegistration::from_definition(&definition, true, limits).unwrap();
        DurableServiceRegistration::new(lease, resource_class, definition.restart_bounds.clone())
            .unwrap()
    }

    fn admission_profile(
        service_id: &str,
        mode: RuntimeMode,
        estimated_cold_start_commit_mb: u64,
    ) -> DurableServiceAdmissionProfile {
        DurableServiceAdmissionProfile::new(service_id.into(), mode, estimated_cold_start_commit_mb)
            .unwrap()
    }

    fn commit_sample() -> Result<SystemCommit, StoreError> {
        Ok(SystemCommit {
            total_mb: 0,
            limit_mb: 64 * 1024,
        })
    }

    fn acquire(
        store: &JobStore,
        registration: &DurableServiceRegistration,
        lease_id: &str,
        now_ms: u64,
    ) -> DurableServiceLeaseClaim {
        let admission_profile = admission_profile(registration.service_id(), RuntimeMode::Lean, 64);
        match store
            .begin_durable_service_acquire(
                registration,
                &admission_profile,
                lease_id,
                500,
                now_ms,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap()
        {
            DurableServiceAcquireResult::Acquired(claim) => claim,
            DurableServiceAcquireResult::RestartDeferred(schedule) => {
                panic!(
                    "unexpected restart deferral until {}",
                    schedule.eligible_at_ms
                )
            }
            DurableServiceAcquireResult::Denied(denial) => {
                panic!("unexpected admission denial: {}", denial.reason)
            }
        }
    }

    fn acknowledge_next_start(
        store: &JobStore,
        claim_at_ms: u64,
        acknowledge_at_ms: u64,
    ) -> DurableServiceStartAuthority {
        let claim = store
            .claim_next_durable_service_intent(100, claim_at_ms)
            .unwrap()
            .expect("expected pending StartTree intent");
        match store
            .acknowledge_durable_service_intent(claim, acknowledge_at_ms)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        }
    }

    fn finish_next_start_not_created(
        store: &JobStore,
        claim_at_ms: u64,
        acknowledge_at_ms: u64,
        finish_at_ms: u64,
    ) -> DurableServiceSnapshot {
        let start = acknowledge_next_start(store, claim_at_ms, acknowledge_at_ms);
        store
            .finish_durable_service_not_created_inner(
                &start,
                &ProcessOwnerError::UnsupportedPlatform,
                finish_at_ms,
            )
            .unwrap()
    }

    fn outbox_count(store: &JobStore, state: Option<&str>) -> i64 {
        let connection = store.connection.lock().unwrap();
        match state {
            Some(state) => connection
                .query_row(
                    "SELECT COUNT(*) FROM runtime_service_outbox WHERE lifecycle_state=?1",
                    params![state],
                    |row| row.get(0),
                )
                .unwrap(),
            None => connection
                .query_row("SELECT COUNT(*) FROM runtime_service_outbox", [], |row| {
                    row.get(0)
                })
                .unwrap(),
        }
    }

    fn active_service_reservations(store: &JobStore) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_admission_reservations
                 WHERE subject_kind='service' AND lifecycle_state IN ('pending','resident')",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn active_job_reservations(store: &JobStore) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_admission_reservations
                 WHERE subject_kind='job' AND lifecycle_state IN ('pending','resident')",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn active_service_leases(store: &JobStore, service_id: &str) -> i64 {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_service_leases
                 WHERE service_id=?1 AND lifecycle_state IN ('pending','active')",
                params![service_id],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn active_service_reservation_profile(
        store: &JobStore,
        service_id: &str,
    ) -> (String, u64, u64) {
        let connection = store.connection.lock().unwrap();
        connection
            .query_row(
                "SELECT reservations.definition_key,
                        reservations.estimated_pending_commit_mb,
                        services.estimated_pending_commit_mb
                 FROM runtime_admission_reservations AS reservations
                 JOIN runtime_services AS services
                   ON services.service_id=reservations.subject_id
                 WHERE reservations.subject_kind='service'
                   AND reservations.subject_id=?1
                   AND reservations.lifecycle_state IN ('pending','resident')",
                params![service_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        u64::try_from(row.get::<_, i64>(1)?).unwrap(),
                        u64::try_from(row.get::<_, i64>(2)?).unwrap(),
                    ))
                },
            )
            .unwrap()
    }

    fn insert_active_service_reservation_for_summary(
        store: &JobStore,
        service_id: &str,
        startup_policy: ServiceStartupPolicy,
        resource_class: ResourceClass,
        reservation_state: &str,
        estimate_mb: u64,
        now_ms: u64,
    ) {
        let registration =
            registration_with_policy_and_class(service_id, startup_policy, resource_class);
        store
            .register_durable_service(&registration, now_ms)
            .unwrap();
        let service_state = match reservation_state {
            "pending" => "starting",
            "resident" => "ready",
            state => panic!("unsupported test reservation state {state}"),
        };
        let connection = store.connection.lock().unwrap();
        connection
            .execute(
                "UPDATE runtime_services
                 SET lifecycle_state=?2, generation=1,
                     estimated_pending_commit_mb=?3,
                     last_observed_at=?4, updated_at=?4
                 WHERE service_id=?1",
                params![
                    service_id,
                    service_state,
                    i64::try_from(estimate_mb).unwrap(),
                    i64::try_from(now_ms).unwrap(),
                ],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO runtime_admission_reservations (
                    subject_kind, subject_id, definition_key, resource_class,
                    estimated_pending_commit_mb, lifecycle_state, settled_at,
                    created_at, updated_at
                 ) VALUES ('service', ?1, 'lean', ?2, ?3, ?4,
                           CASE WHEN ?4='resident' THEN ?5 ELSE NULL END, ?5, ?5)",
                params![
                    service_id,
                    resource_class.as_str(),
                    i64::try_from(estimate_mb).unwrap(),
                    reservation_state,
                    i64::try_from(now_ms).unwrap(),
                ],
            )
            .unwrap();
    }

    fn insert_service_lease_for_summary(
        store: &JobStore,
        service_id: &str,
        lease_id: &str,
        generation: u64,
        active: bool,
    ) {
        let connection = store.connection.lock().unwrap();
        if active {
            connection
                .execute(
                    "INSERT INTO runtime_service_leases (
                        lease_id, service_id, generation, lifecycle_state,
                        created_at, updated_at, expires_at
                     ) VALUES (?1, ?2, ?3, 'active', 1, 1, 1000)",
                    params![lease_id, service_id, i64::try_from(generation).unwrap()],
                )
                .unwrap();
        } else {
            connection
                .execute(
                    "INSERT INTO runtime_service_leases (
                        lease_id, service_id, generation, lifecycle_state,
                        created_at, updated_at, expires_at, released_at, release_reason
                     ) VALUES (?1, ?2, ?3, 'released', 1, 2, 1000, 2, 'explicit')",
                    params![lease_id, service_id, i64::try_from(generation).unwrap()],
                )
                .unwrap();
        }
    }

    fn next_service_time(store: &JobStore, service_id: &str) -> u64 {
        let connection = store.connection.lock().unwrap();
        let value: i64 = connection
            .query_row(
                "SELECT last_observed_at FROM runtime_services WHERE service_id=?1",
                params![service_id],
                |row| row.get(0),
            )
            .unwrap();
        u64::try_from(value).unwrap().saturating_add(1)
    }

    fn insert_ready_idle_heavyweight(
        store: &JobStore,
        service_id: &str,
        generation: u64,
        idle_due_at: u64,
    ) -> DurableServiceRegistration {
        insert_active_service_reservation_for_summary(
            store,
            service_id,
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LocalModel,
            "resident",
            64,
            100,
        );
        let connection = store.connection.lock().unwrap();
        connection
            .execute(
                "UPDATE runtime_services SET generation=?2, idle_due_at=?3
                 WHERE service_id=?1 AND lifecycle_state='ready'",
                params![
                    service_id,
                    i64::try_from(generation).unwrap(),
                    i64::try_from(idle_due_at).unwrap(),
                ],
            )
            .unwrap();
        registration_with_policy_and_class(
            service_id,
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LocalModel,
        )
    }

    #[test]
    fn gbrain_dependency_shares_only_its_own_admitted_job_bundle() {
        let (directory, store) = store();
        let fixture = admitted_gbrain_dependency(&directory, &store);

        let result = store
            .begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &fixture.dependency,
                "gbrain_worker_lease",
                500,
                100,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        let DurableWorkerServiceAcquireResult::Evaluated(DurableServiceAcquireResult::Acquired(
            claim,
        )) = result
        else {
            panic!("GBrain must share its exact owning job admission bundle")
        };
        assert_eq!(claim.service_id(), "gbrain");
        assert_eq!(claim.state(), ServiceLeaseClaimState::Pending);
        assert_eq!(active_job_reservations(&store), 1);
        assert_eq!(active_service_reservations(&store), 1);
        assert_eq!(outbox_count(&store, None), 1);
    }

    #[test]
    fn cancellation_after_dependency_acquire_cannot_join_and_releases_cleanly() {
        let (directory, store) = store();
        let fixture = admitted_gbrain_dependency(&directory, &store);
        let first = store
            .begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &fixture.dependency,
                "gbrain_first_lease",
                500,
                100,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        let DurableWorkerServiceAcquireResult::Evaluated(DurableServiceAcquireResult::Acquired(
            first_claim,
        )) = first
        else {
            panic!("first dependency must acquire")
        };
        assert_eq!(outbox_count(&store, None), 1);

        store
            .request_cancellation(&fixture.context, &fixture.job_id)
            .unwrap();
        let stale_join = store
            .begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &fixture.dependency,
                "gbrain_stale_join",
                500,
                101,
                AdmissionPolicy::default(),
                || panic!("Starting join must validate the owner before sampling"),
            )
            .unwrap();
        assert!(matches!(
            stale_join,
            DurableWorkerServiceAcquireResult::OwnerLost
        ));
        assert_eq!(outbox_count(&store, None), 1);
        assert_eq!(active_service_leases(&store, "gbrain"), 1);

        assert_eq!(
            store
                .release_durable_service_lease(
                    &first_claim,
                    ServiceLeaseReleaseReason::Cancellation,
                    102,
                )
                .unwrap(),
            ServiceLeaseReleaseDisposition::Released
        );
        assert_eq!(active_service_leases(&store, "gbrain"), 0);
        assert_eq!(active_job_reservations(&store), 0);
    }

    #[test]
    fn worker_dependency_keeps_owner_estimate_in_strict_commit_arithmetic() {
        let (directory, store) = store();
        let fixture = admitted_gbrain_dependency(&directory, &store);
        let service_estimate = fixture.admission_profile.estimated_cold_start_commit_mb();
        let exact_allowance = crate::ADMISSION_RESERVE_FLOOR_MB + 1_024 + service_estimate;

        let result = store
            .begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &fixture.dependency,
                "gbrain_boundary_lease",
                500,
                100,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: exact_allowance,
                    })
                },
            )
            .unwrap();
        let DurableWorkerServiceAcquireResult::Evaluated(DurableServiceAcquireResult::Denied(
            denial,
        )) = result
        else {
            panic!("owner estimate must make equality fail closed")
        };
        assert_eq!(denial.resource, "windows_commit");
        assert_eq!(
            denial.available_headroom_mb,
            crate::ADMISSION_RESERVE_FLOOR_MB + service_estimate
        );
        assert_eq!(denial.required_headroom_mb, denial.available_headroom_mb);
        assert_eq!(active_job_reservations(&store), 1);
        assert_eq!(active_service_reservations(&store), 0);
        assert_eq!(outbox_count(&store, None), 0);
    }

    #[test]
    fn unrelated_heavy_job_and_service_do_not_block_worker_dependency() {
        for blocker in ["job", "service"] {
            let (directory, store) = store();
            let fixture = admitted_gbrain_dependency(&directory, &store);
            if blocker == "job" {
                let connection = store.connection.lock().unwrap();
                connection
                    .execute(
                        "INSERT INTO runtime_admission_reservations (
                            subject_kind, subject_id, definition_key, resource_class,
                            estimated_pending_commit_mb, lifecycle_state, created_at, updated_at
                         ) VALUES ('job', 'unrelated_job', 'unrelated-worker',
                                   'large-generation', 256, 'pending', 1, 1)",
                        [],
                    )
                    .unwrap();
            } else {
                insert_active_service_reservation_for_summary(
                    &store,
                    "unrelated_service",
                    ServiceStartupPolicy::OnDemand,
                    ResourceClass::LocalModel,
                    "pending",
                    256,
                    1,
                );
            }

            let result = store
                .begin_durable_worker_service_dependency_acquire(
                    &fixture.registration,
                    &fixture.admission_profile,
                    &fixture.dependency,
                    &format!("gbrain_blocked_by_{blocker}"),
                    500,
                    100,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap();
            let DurableWorkerServiceAcquireResult::Evaluated(
                DurableServiceAcquireResult::Acquired(claim),
            ) = result
            else {
                panic!("unrelated heavyweight {blocker} must not impose a static limit")
            };
            assert_eq!(claim.service_id(), "gbrain");
        }
    }

    #[test]
    fn ready_idle_heavy_service_accepts_independent_and_worker_leases() {
        let (directory, store) = store();
        let fixture = admitted_gbrain_dependency(&directory, &store);
        let registration = insert_ready_idle_heavyweight(&store, "gbrain", 1, 500);
        let profile = admission_profile("gbrain", RuntimeMode::Lean, 64);

        let independent = store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "independent_idle_lease",
                500,
                101,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        let DurableServiceAcquireResult::Acquired(independent_claim) = independent else {
            panic!("independent lease must not be rejected by a static heavyweight limit")
        };
        assert_eq!(independent_claim.state(), ServiceLeaseClaimState::Active);

        let result = store
            .begin_durable_worker_service_dependency_acquire(
                &registration,
                &profile,
                &fixture.dependency,
                "worker_idle_lease",
                500,
                102,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        let DurableWorkerServiceAcquireResult::Evaluated(DurableServiceAcquireResult::Acquired(
            claim,
        )) = result
        else {
            panic!("validated owner must share the ready service")
        };
        assert_eq!(claim.state(), ServiceLeaseClaimState::Active);
        assert_eq!(outbox_count(&store, None), 0);
    }

    #[test]
    fn wrong_or_stale_worker_dependency_authority_fails_closed() {
        let (directory, store) = store();
        let fixture = admitted_gbrain_dependency(&directory, &store);
        let wrong_target = WorkerServiceDependencyAdmission::from_registry(
            &fixture.job_id,
            "gbrain-sync-node",
            ResourceClass::DocumentProcessing,
            1_024,
            "chatmock",
        );
        assert!(matches!(
            store.begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &wrong_target,
                "wrong_target_lease",
                500,
                100,
                AdmissionPolicy::default(),
                commit_sample,
            ),
            Err(DurableServiceStoreError::Store(StoreError::CorruptState(message)))
                if message.contains("different service")
        ));

        let wrong_definition = WorkerServiceDependencyAdmission::from_registry(
            &fixture.job_id,
            "gbrain-sync-node",
            ResourceClass::DocumentProcessing,
            1_023,
            "gbrain",
        );
        assert!(matches!(
            store.begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &wrong_definition,
                "wrong_definition_lease",
                500,
                100,
                AdmissionPolicy::default(),
                commit_sample,
            ),
            Err(DurableServiceStoreError::Store(StoreError::CorruptState(message)))
                if message.contains("estimate")
        ));

        let foreign_owner = WorkerServiceDependencyAdmission::from_registry(
            "foreign_job",
            "gbrain-sync-node",
            ResourceClass::DocumentProcessing,
            1_024,
            "gbrain",
        );
        assert!(matches!(
            store
                .begin_durable_worker_service_dependency_acquire(
                    &fixture.registration,
                    &fixture.admission_profile,
                    &foreign_owner,
                    "foreign_owner_lease",
                    500,
                    100,
                    AdmissionPolicy::default(),
                    || panic!("foreign owner must be rejected before sampling"),
                )
                .unwrap(),
            DurableWorkerServiceAcquireResult::OwnerLost
        ));

        store
            .request_cancellation(&fixture.context, &fixture.job_id)
            .unwrap();
        let stale = store
            .begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &fixture.dependency,
                "stale_owner_lease",
                500,
                101,
                AdmissionPolicy::default(),
                || panic!("lost owner must be rejected before commit sampling"),
            )
            .unwrap();
        assert!(matches!(
            stale,
            DurableWorkerServiceAcquireResult::OwnerLost
        ));
        assert_eq!(active_job_reservations(&store), 0);
        assert_eq!(active_service_reservations(&store), 0);
    }

    #[test]
    fn multi_dependency_job_keeps_service_holds_and_release_fences_exact() {
        let (directory, store) = store();
        let fixture = admitted_gbrain_dependency(&directory, &store);
        let core_registration = registration("core_dependency");
        let core_profile = admission_profile("core_dependency", RuntimeMode::Hot, 64);
        let core_dependency = WorkerServiceDependencyAdmission::from_registry(
            &fixture.job_id,
            "gbrain-sync-node",
            ResourceClass::DocumentProcessing,
            1_024,
            "core_dependency",
        );
        let core = store
            .begin_durable_worker_service_dependency_acquire(
                &core_registration,
                &core_profile,
                &core_dependency,
                "core_dependency_lease",
                500,
                100,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        let DurableWorkerServiceAcquireResult::Evaluated(DurableServiceAcquireResult::Acquired(
            core_claim,
        )) = core
        else {
            panic!("first core dependency must acquire")
        };

        let gbrain = store
            .begin_durable_worker_service_dependency_acquire(
                &fixture.registration,
                &fixture.admission_profile,
                &fixture.dependency,
                "gbrain_dependency_lease",
                500,
                101,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        let DurableWorkerServiceAcquireResult::Evaluated(DurableServiceAcquireResult::Acquired(
            gbrain_claim,
        )) = gbrain
        else {
            panic!("second exact dependency must share only the owner job hold")
        };
        assert_eq!(outbox_count(&store, None), 2);
        assert_eq!(active_service_reservations(&store), 2);

        assert_eq!(
            store
                .release_durable_service_lease(
                    &gbrain_claim,
                    ServiceLeaseReleaseReason::Failure,
                    102,
                )
                .unwrap(),
            ServiceLeaseReleaseDisposition::Released
        );
        assert_eq!(
            store
                .release_durable_service_lease(
                    &core_claim,
                    ServiceLeaseReleaseReason::Failure,
                    103,
                )
                .unwrap(),
            ServiceLeaseReleaseDisposition::Released
        );
        assert_eq!(active_service_leases(&store, "gbrain"), 0);
        assert_eq!(active_service_leases(&store, "core_dependency"), 0);

        let disposition = store
            .worker_service_dependency_unavailable_before_assignment(&fixture.job_id, false)
            .unwrap();
        assert!(matches!(
            disposition,
            crate::WorkerServiceDependencyFailureDisposition::Finalized(_)
        ));
        assert_eq!(active_job_reservations(&store), 0);
    }

    #[test]
    fn reservation_summary_counts_pending_and_exact_generation_active_leases_only() {
        let (_directory, store) = store();
        insert_active_service_reservation_for_summary(
            &store,
            "chatmock",
            ServiceStartupPolicy::Eager,
            ResourceClass::LocalModel,
            "pending",
            512,
            100,
        );
        insert_active_service_reservation_for_summary(
            &store,
            "dashboard",
            ServiceStartupPolicy::Eager,
            ResourceClass::LargeGeneration,
            "resident",
            256,
            101,
        );
        insert_active_service_reservation_for_summary(
            &store,
            "search",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LocalModel,
            "resident",
            128,
            102,
        );
        insert_service_lease_for_summary(&store, "search", "lease_active", 1, true);
        insert_active_service_reservation_for_summary(
            &store,
            "idle_search",
            ServiceStartupPolicy::Scheduled,
            ResourceClass::LargeGeneration,
            "resident",
            64,
            103,
        );
        insert_service_lease_for_summary(&store, "idle_search", "lease_released", 1, false);

        let mut connection = store.connection.lock().unwrap();
        let transaction = connection.transaction().unwrap();
        let summary = global_admission_snapshot_tx(&transaction).unwrap();
        assert_eq!(summary.pending_commit_mb, 512);
        assert_eq!(
            summary.active_service_burst_classes,
            vec![ResourceClass::LocalModel]
        );
        transaction.rollback().unwrap();
    }

    #[test]
    fn ready_spotify_view_lease_and_hermes_start_coexist_with_hot_headroom() {
        let (_directory, store) = store();
        insert_active_service_reservation_for_summary(
            &store,
            "spotify-playback",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::BrowserAutomation,
            "resident",
            1_536,
            100,
        );
        insert_service_lease_for_summary(&store, "spotify-playback", "spotify-view-lease", 1, true);
        let hermes = registration_with_policy_and_class(
            "hermes",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LargeGeneration,
        );
        let hermes_profile = admission_profile("hermes", RuntimeMode::Hot, 1_536);
        store.register_durable_service(&hermes, 101).unwrap();

        let result = store
            .begin_durable_service_acquire(
                &hermes,
                &hermes_profile,
                "hermes-chat-lease",
                500,
                102,
                AdmissionPolicy::for_runtime_mode(RuntimeMode::Hot),
                || {
                    Ok(SystemCommit {
                        total_mb: 40_221 - 8_706,
                        limit_mb: 40_221,
                    })
                },
            )
            .unwrap();
        let DurableServiceAcquireResult::Acquired(hermes_claim) = result else {
            panic!("Hermes must start beside a ready Spotify view when live headroom fits")
        };
        assert_eq!(hermes_claim.state(), ServiceLeaseClaimState::Pending);
        assert_eq!(active_service_reservations(&store), 2);
        assert_eq!(active_service_leases(&store, "spotify-playback"), 1);
        assert_eq!(active_service_leases(&store, "hermes"), 1);
        assert_eq!(outbox_count(&store, Some("pending")), 1);
    }

    #[test]
    fn spotify_and_hermes_are_still_denied_under_actual_hot_commit_pressure() {
        let (_directory, store) = store();
        insert_active_service_reservation_for_summary(
            &store,
            "spotify-playback",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::BrowserAutomation,
            "resident",
            1_536,
            100,
        );
        insert_service_lease_for_summary(&store, "spotify-playback", "spotify-view-lease", 1, true);
        let hermes = registration_with_policy_and_class(
            "hermes",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LargeGeneration,
        );
        let hermes_profile = admission_profile("hermes", RuntimeMode::Hot, 1_536);
        store.register_durable_service(&hermes, 101).unwrap();

        let result = store
            .begin_durable_service_acquire(
                &hermes,
                &hermes_profile,
                "hermes-pressure-lease",
                500,
                102,
                AdmissionPolicy::for_runtime_mode(RuntimeMode::Hot),
                || {
                    Ok(SystemCommit {
                        // The Hot reserve is 4,352 MiB at this commit limit;
                        // equality after Hermes' 1,536 MiB estimate must fail.
                        total_mb: 40_221 - 5_888,
                        limit_mb: 40_221,
                    })
                },
            )
            .unwrap();
        let DurableServiceAcquireResult::Denied(denial) = result else {
            panic!("real commit pressure must still reject Hermes")
        };
        assert_eq!(denial.resource, "windows_commit");
        assert_eq!(denial.required_headroom_mb, 5_888);
        assert_eq!(denial.available_headroom_mb, 5_888);
        assert_eq!(active_service_reservations(&store), 1);
        assert_eq!(active_service_leases(&store, "spotify-playback"), 1);
        assert_eq!(active_service_leases(&store, "hermes"), 0);
        assert_eq!(outbox_count(&store, None), 0);
    }

    #[test]
    fn starting_service_hold_survives_reservation_settlement_until_readiness() {
        let (_directory, store) = store();
        insert_active_service_reservation_for_summary(
            &store,
            "warming_search",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LocalModel,
            "pending",
            512,
            100,
        );

        {
            let mut connection = store.connection.lock().unwrap();
            let transaction = connection.transaction().unwrap();
            let snapshot = global_admission_snapshot_tx(&transaction).unwrap();
            assert_eq!(snapshot.pending_commit_mb, 512);
            assert_eq!(
                snapshot.active_service_burst_classes,
                vec![ResourceClass::LocalModel]
            );
            transaction.rollback().unwrap();
        }

        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_admission_reservations
                     SET lifecycle_state='resident', settled_at=101, updated_at=101
                     WHERE subject_kind='service' AND subject_id='warming_search'
                       AND lifecycle_state='pending'",
                    [],
                )
                .unwrap();
        }
        {
            let mut connection = store.connection.lock().unwrap();
            let transaction = connection.transaction().unwrap();
            let snapshot = global_admission_snapshot_tx(&transaction).unwrap();
            assert_eq!(snapshot.pending_commit_mb, 512);
            assert_eq!(
                snapshot.active_service_burst_classes,
                vec![ResourceClass::LocalModel]
            );
            transaction.rollback().unwrap();
        }

        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_services
                     SET lifecycle_state='ready', last_observed_at=102, updated_at=102
                     WHERE service_id='warming_search' AND lifecycle_state='starting'",
                    [],
                )
                .unwrap();
        }
        let mut connection = store.connection.lock().unwrap();
        let transaction = connection.transaction().unwrap();
        let snapshot = global_admission_snapshot_tx(&transaction).unwrap();
        assert_eq!(snapshot.pending_commit_mb, 0);
        assert!(snapshot.active_service_burst_classes.is_empty());
        transaction.rollback().unwrap();
    }

    #[test]
    fn lifecycle_reservation_mismatch_fails_closed() {
        let (_directory, store) = store();
        insert_active_service_reservation_for_summary(
            &store,
            "search",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LocalModel,
            "pending",
            64,
            100,
        );
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_services SET lifecycle_state='ready'
                     WHERE service_id='search'",
                    [],
                )
                .unwrap();
        }
        let mut connection = store.connection.lock().unwrap();
        let transaction = connection.transaction().unwrap();
        assert!(matches!(
            global_admission_snapshot_tx(&transaction),
            Err(StoreError::CorruptState(message))
                if message.contains("invalid reservation or lease state")
        ));
        transaction.rollback().unwrap();
    }

    #[test]
    fn reservation_summary_fails_closed_without_a_service_registration() {
        let (_directory, store) = store();
        let mut connection = store.connection.lock().unwrap();
        connection
            .execute(
                "INSERT INTO runtime_admission_reservations (
                    subject_kind, subject_id, definition_key, resource_class,
                    estimated_pending_commit_mb, lifecycle_state, settled_at,
                    created_at, updated_at
                 ) VALUES ('service', 'missing_service', 'lean', 'local-model',
                           128, 'resident', 1, 1, 1)",
                [],
            )
            .unwrap();
        let transaction = connection.transaction().unwrap();
        assert!(matches!(
            global_admission_snapshot_tx(&transaction),
            Err(StoreError::CorruptState(message))
                if message.contains("missing_service")
        ));
        transaction.rollback().unwrap();
    }

    #[test]
    fn mode_switch_reuses_registration_and_binds_each_generation_profile_atomically() {
        let (_directory, store) = store();
        let registration = registration("search");
        let profiles = [
            (RuntimeMode::Lean, 64, "lean", "lease_lean"),
            (RuntimeMode::Hot, 128, "hot", "lease_hot"),
            (RuntimeMode::Packaged, 192, "packaged", "lease_packaged"),
        ];

        let mut now_ms = 100;
        for (index, (mode, estimate, mode_key, lease_id)) in profiles.into_iter().enumerate() {
            let profile = admission_profile("search", mode, estimate);
            store
                .register_durable_service(&registration, now_ms)
                .unwrap();
            let lease = match store
                .begin_durable_service_acquire(
                    &registration,
                    &profile,
                    lease_id,
                    500,
                    now_ms,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap()
            {
                DurableServiceAcquireResult::Acquired(lease) => lease,
                DurableServiceAcquireResult::RestartDeferred(schedule) => {
                    panic!(
                        "unexpected restart deferral until {}",
                        schedule.eligible_at_ms
                    )
                }
                DurableServiceAcquireResult::Denied(denial) => {
                    panic!("unexpected admission denial: {}", denial.reason)
                }
            };
            assert_eq!(lease.generation(), u64::try_from(index).unwrap() + 1);
            assert_eq!(
                active_service_reservation_profile(&store, "search"),
                (mode_key.into(), estimate, estimate)
            );

            if mode == RuntimeMode::Lean {
                let hot_profile = admission_profile("search", RuntimeMode::Hot, 128);
                assert!(matches!(
                    store.begin_durable_service_acquire(
                        &registration,
                        &hot_profile,
                        "lease_wrong_mode",
                        500,
                        now_ms + 1,
                        AdmissionPolicy::default(),
                        commit_sample,
                    ),
                    Err(DurableServiceStoreError::AdmissionProfileConflict(id)) if id == "search"
                ));
            }

            if index + 1 < profiles.len() {
                let proof = store.prior_generation_drained_for_test();
                store
                    .reconcile_after_runtime_restart_for_test(proof)
                    .unwrap();
                now_ms = next_service_time(&store, "search");
            }
        }
    }

    #[test]
    fn concurrent_acquisition_is_single_flight_and_bounded_by_one_reservation() {
        let (_directory, store) = store();
        let store = Arc::new(store);
        let registration = Arc::new(registration("search"));
        let barrier = Arc::new(Barrier::new(9));
        let mut threads = Vec::new();
        for index in 0..8 {
            let store = Arc::clone(&store);
            let registration = Arc::clone(&registration);
            let barrier = Arc::clone(&barrier);
            threads.push(thread::spawn(move || {
                barrier.wait();
                acquire(&store, &registration, &format!("lease_{index}"), 100).generation()
            }));
        }
        barrier.wait();
        let generations = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>();
        assert!(generations.iter().all(|generation| *generation == 1));
        let snapshot = store.durable_service_snapshot("search").unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::Starting);
        assert_eq!(snapshot.pending_leases, 8);
        assert_eq!(outbox_count(&store, None), 1);
        assert_eq!(active_service_reservations(&store), 1);
    }

    #[test]
    fn denied_cold_start_is_durably_resource_blocked_until_an_explicit_retry() {
        let (directory, store) = store();
        let registration = registration_with_policy_and_class(
            "local_model",
            ServiceStartupPolicy::OnDemand,
            ResourceClass::LocalModel,
        );
        let profile = admission_profile("local_model", RuntimeMode::Lean, 64);
        store.register_durable_service(&registration, 100).unwrap();
        let sampler_calls = Cell::new(0_u32);

        let result = store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_denied",
                500,
                101,
                AdmissionPolicy::default(),
                || {
                    sampler_calls.set(sampler_calls.get() + 1);
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: crate::ADMISSION_RESERVE_FLOOR_MB,
                    })
                },
            )
            .unwrap();
        let DurableServiceAcquireResult::Denied(denial) = result else {
            panic!("critical commit headroom must deny the cold start")
        };
        assert_eq!(sampler_calls.get(), 1);

        drop(store);
        let store = JobStore::open_for_test(directory.path().join("runtime-v2.sqlite3")).unwrap();

        for _ in 0..3 {
            let snapshot = store.durable_service_snapshot("local_model").unwrap();
            assert_eq!(snapshot.status.state, RuntimeServiceState::ResourceBlocked);
            assert_eq!(
                snapshot.status.last_error.as_deref(),
                Some(denial.reason.as_str())
            );
            assert_eq!(snapshot.admission_denial.as_ref(), Some(&denial));
            assert_eq!(snapshot.generation, 0);
            assert_eq!(snapshot.pending_leases, 0);
            assert_eq!(snapshot.active_leases, 0);
        }
        assert_eq!(
            sampler_calls.get(),
            1,
            "status polling must not retry admission"
        );
        assert_eq!(outbox_count(&store, None), 0);
        assert_eq!(active_service_reservations(&store), 0);

        let retry = store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_explicit_retry",
                500,
                102,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        assert!(matches!(retry, DurableServiceAcquireResult::Acquired(_)));
        let snapshot = store.durable_service_snapshot("local_model").unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::Starting);
        assert!(snapshot.status.last_error.is_none());
        assert!(snapshot.admission_denial.is_none());
        assert_eq!(snapshot.generation, 1);
        assert_eq!(outbox_count(&store, Some("pending")), 1);
        assert_eq!(active_service_reservations(&store), 1);
    }

    #[test]
    fn denied_eager_start_is_resource_blocked_without_a_failed_generation() {
        let (_directory, store) = store();
        let registration = registration_with_policy_and_class(
            "eager_model",
            ServiceStartupPolicy::Eager,
            ResourceClass::LocalModel,
        );
        let profile = admission_profile("eager_model", RuntimeMode::Lean, 64);
        store.register_durable_service(&registration, 100).unwrap();
        let result = store
            .begin_eager_durable_service_start(
                &registration,
                &profile,
                101,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: crate::ADMISSION_RESERVE_FLOOR_MB,
                    })
                },
            )
            .unwrap();
        assert!(matches!(result, DurableServiceStartResult::Denied(_)));

        let snapshot = store.durable_service_snapshot("eager_model").unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::ResourceBlocked);
        assert!(snapshot.admission_denial.is_some());
        assert_eq!(snapshot.generation, 0);
        assert_eq!(outbox_count(&store, None), 0);
        assert_eq!(active_service_reservations(&store), 0);
    }

    #[test]
    fn denied_warm_first_lease_preserves_idle_state_and_writes_no_lease() {
        let (_directory, store) = store();
        let registration = insert_ready_idle_heavyweight(&store, "local_model", 1, 900);
        let profile = admission_profile("local_model", RuntimeMode::Lean, 64);
        let sampler_calls = Cell::new(0_u32);

        let result = store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_denied",
                500,
                200,
                AdmissionPolicy::default(),
                || {
                    sampler_calls.set(sampler_calls.get() + 1);
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: crate::ADMISSION_RESERVE_FLOOR_MB,
                    })
                },
            )
            .unwrap();
        let DurableServiceAcquireResult::Denied(denial) = result else {
            panic!("critical commit headroom must deny the warm first lease")
        };
        assert_eq!(denial.resource, "windows_commit_critical");
        assert_eq!(sampler_calls.get(), 1);

        let connection = store.connection.lock().unwrap();
        let (state, idle_due_at, last_observed_at): (String, Option<i64>, i64) = connection
            .query_row(
                "SELECT lifecycle_state, idle_due_at, last_observed_at
                 FROM runtime_services WHERE service_id='local_model'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(state, "ready");
        assert_eq!(idle_due_at, Some(900));
        assert_eq!(last_observed_at, 100);
        let lease_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM runtime_service_leases
                 WHERE lease_id='lease_denied'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(lease_count, 0);
    }

    #[test]
    fn warm_first_current_generation_lease_samples_once_then_shares_the_hold() {
        let (_directory, store) = store();
        let registration = insert_ready_idle_heavyweight(&store, "local_model", 2, 900);
        let profile = admission_profile("local_model", RuntimeMode::Lean, 64);
        // An active lease from generation one must neither authorize this
        // generation nor occupy its logical service hold.
        insert_service_lease_for_summary(&store, "local_model", "stale_lease", 1, true);
        let sampler_calls = Cell::new(0_u32);

        let first = store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_current_1",
                500,
                200,
                AdmissionPolicy::default(),
                || {
                    sampler_calls.set(sampler_calls.get() + 1);
                    Ok(SystemCommit {
                        total_mb: 0,
                        // This proves the already-resident path requests zero
                        // incremental commit: adding the 64 MiB cold estimate
                        // would deny this otherwise-valid acquisition.
                        limit_mb: crate::ADMISSION_RESERVE_FLOOR_MB + 1,
                    })
                },
            )
            .unwrap();
        let DurableServiceAcquireResult::Acquired(first) = first else {
            panic!("warm first lease should be admitted with zero incremental estimate")
        };
        assert_eq!(first.generation(), 2);
        assert_eq!(first.state(), ServiceLeaseClaimState::Active);
        assert_eq!(sampler_calls.get(), 1);

        let second = store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_current_2",
                500,
                201,
                AdmissionPolicy::default(),
                || {
                    sampler_calls.set(sampler_calls.get() + 1);
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: crate::ADMISSION_RESERVE_FLOOR_MB,
                    })
                },
            )
            .unwrap();
        let DurableServiceAcquireResult::Acquired(second) = second else {
            panic!("a subsequent exact-generation lease must share the existing hold")
        };
        assert_eq!(second.generation(), 2);
        assert_eq!(second.state(), ServiceLeaseClaimState::Active);
        assert_eq!(sampler_calls.get(), 1);

        let connection = store.connection.lock().unwrap();
        let idle_due_at: Option<i64> = connection
            .query_row(
                "SELECT idle_due_at FROM runtime_services WHERE service_id='local_model'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(idle_due_at, None);
    }

    #[test]
    fn status_is_observational_and_expiry_requires_an_explicit_write() {
        let (_directory, store) = store();
        let registration = registration("search");
        let admission_profile = admission_profile("search", RuntimeMode::Lean, 64);
        let lease = match store
            .begin_durable_service_acquire(
                &registration,
                &admission_profile,
                "lease_1",
                50,
                100,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap()
        {
            DurableServiceAcquireResult::Acquired(claim) => claim,
            DurableServiceAcquireResult::RestartDeferred(schedule) => {
                panic!(
                    "unexpected restart deferral until {}",
                    schedule.eligible_at_ms
                )
            }
            DurableServiceAcquireResult::Denied(_) => panic!("unexpected denial"),
        };
        assert_eq!(lease.expires_at_ms(), 150);
        assert_eq!(
            store
                .durable_service_snapshot("search")
                .unwrap()
                .pending_leases,
            1
        );
        assert_eq!(outbox_count(&store, None), 1);
        assert_eq!(
            store.expire_durable_service_leases("search", 150).unwrap(),
            1
        );
        assert_eq!(
            store
                .durable_service_snapshot("search")
                .unwrap()
                .pending_leases,
            0
        );
        assert_eq!(outbox_count(&store, None), 1);
    }

    #[test]
    fn release_is_idempotent_for_the_same_opaque_lease() {
        let (_directory, store) = store();
        let registration = registration("search");
        let lease = acquire(&store, &registration, "lease_1", 100);
        assert_eq!(
            store
                .release_durable_service_lease(&lease, ServiceLeaseReleaseReason::Explicit, 110,)
                .unwrap(),
            ServiceLeaseReleaseDisposition::Released
        );
        assert_eq!(
            store
                .release_durable_service_lease(&lease, ServiceLeaseReleaseReason::Explicit, 120,)
                .unwrap(),
            ServiceLeaseReleaseDisposition::AlreadyReleased
        );
    }

    #[test]
    fn runtime_owned_lease_renewal_preserves_the_exact_opaque_claim() {
        let (_directory, store) = store();
        let registration = registration("search");
        let mut lease = acquire(&store, &registration, "lease_1", 100);
        assert_eq!(lease.expires_at_ms(), 600);
        assert_eq!(
            store.renew_durable_service_lease(&mut lease, 200).unwrap(),
            1_200
        );
        assert_eq!(lease.expires_at_ms(), 1_200);
        assert_eq!(
            store.expire_durable_service_leases("search", 600).unwrap(),
            0
        );
        assert_eq!(
            store
                .durable_service_snapshot("search")
                .unwrap()
                .pending_leases,
            1
        );

        store
            .release_durable_service_lease(&lease, ServiceLeaseReleaseReason::Explicit, 700)
            .unwrap();
        let error = store
            .renew_durable_service_lease(&mut lease, 800)
            .unwrap_err();
        assert!(matches!(
            error,
            DurableServiceStoreError::LeaseNotFound(ref lease_id) if lease_id == "lease_1"
        ));
    }

    #[test]
    fn outbox_reclaim_fences_old_ack_and_persisted_ack_is_idempotent() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let old = store
            .claim_next_durable_service_intent(10, 101)
            .unwrap()
            .unwrap();
        let current = store
            .claim_next_durable_service_intent(10, 111)
            .unwrap()
            .unwrap();
        let error = store
            .acknowledge_durable_service_intent(old, 112)
            .unwrap_err();
        assert!(matches!(
            error.error(),
            DurableServiceStoreError::OutboxFenceMismatch
        ));
        assert_eq!(
            store
                .acknowledge_durable_service_intent_inner(&current, 112)
                .unwrap(),
            ServiceIntentAckDisposition::Acked
        );
        assert_eq!(
            store
                .acknowledge_durable_service_intent_inner(&current, 113)
                .unwrap(),
            ServiceIntentAckDisposition::AlreadyAcked
        );
        let ack = store
            .acknowledge_durable_service_intent(current, 114)
            .unwrap();
        assert_eq!(ack.disposition, ServiceIntentAckDisposition::AlreadyAcked);
    }

    #[test]
    fn shutdown_cancels_an_unacknowledged_start_without_publishing_stop() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        assert_eq!(store.begin_durable_service_shutdown(110).unwrap(), 0);
        let snapshot = store.durable_service_snapshot("search").unwrap();
        assert_eq!(
            snapshot.status.state,
            RuntimeServiceState::AvailableButStopped
        );
        assert_eq!(snapshot.pending_leases, 0);
        assert!(snapshot.acquisition_closed);
        assert!(matches!(
            store.begin_durable_service_acquire(
                &registration,
                &admission_profile("search", RuntimeMode::Lean, 64),
                "lease_2",
                100,
                111,
                AdmissionPolicy::default(),
                commit_sample,
            ),
            Err(DurableServiceStoreError::Store(StoreError::AdmissionClosed))
        ));
        assert_eq!(outbox_count(&store, Some("superseded")), 1);
        assert_eq!(outbox_count(&store, Some("pending")), 0);
        assert_eq!(active_service_reservations(&store), 0);
    }

    #[test]
    fn shutdown_publishes_stop_only_after_start_acknowledgement() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let claim = store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        let _start = match store
            .acknowledge_durable_service_intent(claim, 102)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        };

        assert_eq!(store.begin_durable_service_shutdown(110).unwrap(), 1);
        let snapshot = store.durable_service_snapshot("search").unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::Stopping);
        assert_eq!(snapshot.pending_leases, 0);
        assert!(snapshot.acquisition_closed);
        assert_eq!(active_service_reservations(&store), 1);
        assert_eq!(outbox_count(&store, Some("acked")), 1);
        assert_eq!(outbox_count(&store, Some("pending")), 1);
    }

    #[test]
    fn shutdown_cancels_a_claimed_but_unacknowledged_start() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let _claim = store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();

        assert_eq!(store.begin_durable_service_shutdown(110).unwrap(), 0);
        let snapshot = store.durable_service_snapshot("search").unwrap();
        assert_eq!(
            snapshot.status.state,
            RuntimeServiceState::AvailableButStopped
        );
        assert_eq!(active_service_reservations(&store), 0);
        assert_eq!(outbox_count(&store, Some("superseded")), 1);
        assert_eq!(outbox_count(&store, Some("pending")), 0);
    }

    #[test]
    fn preparation_failure_consumes_only_the_exact_live_start_claim() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let expired = store
            .claim_next_durable_service_intent(10, 101)
            .unwrap()
            .unwrap();
        let transition = store
            .finish_claimed_durable_service_start_preparation_failure(expired, 111)
            .unwrap_err();
        assert!(matches!(
            transition.error(),
            DurableServiceStoreError::OutboxFenceMismatch
        ));
        let (_expired, _) = transition.into_parts();
        let before = store.durable_service_snapshot("search").unwrap();
        assert_eq!(before.status.state, RuntimeServiceState::Starting);
        assert_eq!(before.pending_leases, 1);
        assert_eq!(active_service_reservations(&store), 1);

        let current = store
            .claim_next_durable_service_intent(100, 111)
            .unwrap()
            .unwrap();
        let failed = store
            .finish_claimed_durable_service_start_preparation_failure(current, 112)
            .unwrap();
        assert_eq!(failed.status.state, RuntimeServiceState::Failed);
        assert_eq!(
            failed.status.last_error.as_deref(),
            Some(SERVICE_PREPARATION_FAILURE_MESSAGE)
        );
        assert_eq!(failed.pending_leases, 0);
        assert_eq!(failed.active_leases, 0);
        assert_eq!(failed.restart, DurableServiceRestartStatus::Disabled);
        assert_eq!(active_service_reservations(&store), 0);
        assert_eq!(outbox_count(&store, Some("superseded")), 1);
        assert_eq!(outbox_count(&store, Some("acked")), 0);
    }

    #[test]
    fn trusted_eager_bootstrap_is_separate_from_public_admission_and_shutdown_closes_it() {
        let (_directory, store) = store();
        let mut definition = definition("dashboard");
        definition.startup_policy = ServiceStartupPolicy::Eager;
        definition.idle_ttl_ms = None;
        let limits = ServiceLeaseLimits::new(16, 1_000, 2).unwrap();
        let lease = ServiceLeaseRegistration::from_definition(&definition, true, limits).unwrap();
        let registration = DurableServiceRegistration::new(
            lease,
            ResourceClass::Core,
            definition.restart_bounds.clone(),
        )
        .unwrap();
        let lean_profile = admission_profile("dashboard", RuntimeMode::Lean, 64);
        store.pause_accepting_work();
        assert_eq!(
            store
                .begin_eager_durable_service_start(
                    &registration,
                    &lean_profile,
                    100,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap(),
            DurableServiceStartResult::Queued
        );
        assert_eq!(outbox_count(&store, Some("pending")), 1);
        assert_eq!(
            active_service_reservation_profile(&store, "dashboard"),
            ("lean".into(), 64, 64)
        );
        let hot_profile = admission_profile("dashboard", RuntimeMode::Hot, 128);
        assert!(matches!(
            store.begin_eager_durable_service_start(
                &registration,
                &hot_profile,
                101,
                AdmissionPolicy::default(),
                commit_sample,
            ),
            Err(DurableServiceStoreError::AdmissionProfileConflict(id)) if id == "dashboard"
        ));
        assert_eq!(store.begin_durable_service_shutdown(110).unwrap(), 0);
        assert!(matches!(
            store.begin_eager_durable_service_start(
                &registration,
                &lean_profile,
                111,
                AdmissionPolicy::default(),
                commit_sample,
            ),
            Err(DurableServiceStoreError::Store(StoreError::AdmissionClosed))
        ));
    }

    #[test]
    fn restart_releases_every_stale_authority_without_reviving_generation() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let _claimed = store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        assert_eq!(active_service_reservations(&store), 1);
        let proof = store.prior_generation_drained_for_test();
        store
            .reconcile_after_runtime_restart_for_test(proof)
            .unwrap();
        let snapshot = store.durable_service_snapshot("search").unwrap();
        assert_eq!(
            snapshot.status.state,
            RuntimeServiceState::AvailableButStopped
        );
        assert_eq!(snapshot.generation, 1);
        assert_eq!(snapshot.pending_leases, 0);
        assert_eq!(snapshot.active_leases, 0);
        assert!(!snapshot.acquisition_closed);
        assert_eq!(active_service_reservations(&store), 0);
        assert_eq!(outbox_count(&store, Some("superseded")), 1);
        assert!(store
            .claim_next_durable_service_intent(100, 1_000)
            .unwrap()
            .is_none());

        let next_now: u64 = {
            let connection = store.connection.lock().unwrap();
            let value: i64 = connection
                .query_row(
                    "SELECT last_observed_at FROM runtime_services WHERE service_id='search'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            u64::try_from(value).unwrap().saturating_add(1)
        };
        let next = acquire(&store, &registration, "lease_2", next_now);
        assert_eq!(next.generation(), 2);
        assert_eq!(outbox_count(&store, Some("pending")), 1);
    }

    #[test]
    fn ready_and_failure_require_exact_start_process_authorities() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let claim = store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        let ack = store
            .acknowledge_durable_service_intent(claim, 102)
            .unwrap();
        let start = match ack.authority {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        };
        let residency =
            ProcessTreeResidency::service_for_test(store.generation_scope.clone(), "search", 1);
        store
            .settle_durable_service_residency_inner(&start, &residency, 103)
            .unwrap();
        store
            .confirm_durable_service_ready_inner(&start, 104)
            .unwrap();
        let exit = ProcessTreeExit::service_release_after_started_for_test_in_scope(
            store.generation_scope.clone(),
            "search",
            1,
        );
        let snapshot = store
            .finish_durable_service_tree_exit_inner(&start, &exit, None, 105)
            .unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::Failed);
        assert_eq!(
            snapshot.status.last_error.as_deref(),
            Some("Service process tree supervision failed")
        );
        assert_eq!(active_service_reservations(&store), 0);
    }

    #[test]
    fn restart_backoff_and_window_budget_are_durable_and_deterministic() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("restart-policy.sqlite3");
        let store = JobStore::open_for_test(&path).unwrap();
        let registration = registration("search");
        let profile = admission_profile("search", RuntimeMode::Lean, 64);

        let first = acquire(&store, &registration, "lease_1", 100);
        assert_eq!(first.generation(), 1);
        let failed = finish_next_start_not_created(&store, 101, 102, 103);
        assert_eq!(
            failed.restart,
            DurableServiceRestartStatus::Deferred(DurableServiceRestartSchedule {
                eligible_at_ms: 113,
                window_ends_at_ms: 1_103,
                attempts_in_window: 0,
                maximum_restarts: 2,
                window_exhausted: false,
            })
        );
        drop(store);

        let store = JobStore::open_for_test(&path).unwrap();
        assert_eq!(
            store
                .register_durable_service(&registration, 104)
                .unwrap()
                .restart,
            failed.restart
        );
        let deferred = store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_2",
                500,
                112,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap();
        assert!(matches!(
            deferred,
            DurableServiceAcquireResult::RestartDeferred(DurableServiceRestartSchedule {
                eligible_at_ms: 113,
                attempts_in_window: 0,
                window_exhausted: false,
                ..
            })
        ));
        assert_eq!(outbox_count(&store, Some("pending")), 0);

        let second = match store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_2",
                500,
                113,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap()
        {
            DurableServiceAcquireResult::Acquired(claim) => claim,
            result => panic!("expected eligible restart, got {result:?}"),
        };
        assert_eq!(second.generation(), 2);
        assert_eq!(
            store.durable_service_snapshot("search").unwrap().restart,
            DurableServiceRestartStatus::Idle {
                attempts_in_window: 1,
                window_ends_at_ms: Some(1_103),
            }
        );
        let failed_again = finish_next_start_not_created(&store, 114, 115, 116);
        assert_eq!(
            failed_again.restart.next_attempt_at_ms(),
            Some(136),
            "the second failure doubles the initial backoff"
        );

        let third = match store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_3",
                500,
                136,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap()
        {
            DurableServiceAcquireResult::Acquired(claim) => claim,
            result => panic!("expected second bounded restart, got {result:?}"),
        };
        assert_eq!(third.generation(), 3);
        let exhausted = finish_next_start_not_created(&store, 137, 138, 139);
        assert_eq!(
            exhausted.restart,
            DurableServiceRestartStatus::Deferred(DurableServiceRestartSchedule {
                eligible_at_ms: 1_103,
                window_ends_at_ms: 1_103,
                attempts_in_window: 2,
                maximum_restarts: 2,
                window_exhausted: true,
            })
        );
        assert!(matches!(
            store
                .begin_durable_service_acquire(
                    &registration,
                    &profile,
                    "lease_4",
                    500,
                    1_102,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap(),
            DurableServiceAcquireResult::RestartDeferred(DurableServiceRestartSchedule {
                eligible_at_ms: 1_103,
                window_exhausted: true,
                ..
            })
        ));

        let next_window = match store
            .begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_4",
                500,
                1_103,
                AdmissionPolicy::default(),
                commit_sample,
            )
            .unwrap()
        {
            DurableServiceAcquireResult::Acquired(claim) => claim,
            result => panic!("expected new restart window, got {result:?}"),
        };
        assert_eq!(next_window.generation(), 4);
        assert_eq!(
            store.durable_service_snapshot("search").unwrap().restart,
            DurableServiceRestartStatus::Idle {
                attempts_in_window: 1,
                window_ends_at_ms: Some(2_103),
            }
        );
    }

    #[test]
    fn trusted_registration_binds_a_migrated_v5_failure_to_manifest_timing() {
        let (_directory, store) = store();
        let registration = registration("search");
        store.register_durable_service(&registration, 100).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_services
                     SET lifecycle_state='failed', generation=1, retry_required=1,
                         last_error='legacy failure', last_exited_generation=1,
                         restart_window_ms=0, initial_restart_backoff_ms=0,
                         maximum_restart_backoff_ms=0,
                         restart_window_started_at=NULL,
                         restart_attempts_in_window=0, next_restart_at=NULL,
                         last_observed_at=150, updated_at=150
                     WHERE service_id='search'",
                    [],
                )
                .unwrap();
        }

        let snapshot = store.register_durable_service(&registration, 200).unwrap();
        assert_eq!(
            snapshot.restart,
            DurableServiceRestartStatus::Deferred(DurableServiceRestartSchedule {
                eligible_at_ms: 210,
                window_ends_at_ms: 1_200,
                attempts_in_window: 0,
                maximum_restarts: 2,
                window_exhausted: false,
            })
        );
        let connection = store.connection.lock().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT restart_window_ms, initial_restart_backoff_ms,
                            maximum_restart_backoff_ms
                     FROM runtime_services WHERE service_id='search'",
                    [],
                    |row| Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?
                    )),
                )
                .unwrap(),
            (1_000, 10, 100)
        );
    }

    #[test]
    fn failed_required_bootstrap_stays_visible_and_exact_retry_mints_one_start() {
        let (_directory, store) = store();
        let registration = registration_with_policy_and_class(
            "dashboard",
            ServiceStartupPolicy::Eager,
            ResourceClass::Core,
        );
        let profile = admission_profile("dashboard", RuntimeMode::Lean, 64);
        store.register_durable_service(&registration, 100).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "UPDATE runtime_services SET lifecycle_state='failed', generation=1,
                     last_exited_generation=1, last_error='dashboard startup failed', last_observed_at=101,
                     updated_at=101 WHERE service_id='dashboard'",
                    [],
                )
                .unwrap();
        }
        let failed = store.durable_service_snapshot("dashboard").unwrap();
        assert_eq!(failed.status.state, RuntimeServiceState::Failed);
        assert_eq!(
            failed.status.last_error.as_deref(),
            Some("dashboard startup failed")
        );

        let reset = store
            .reset_durable_service_for_explicit_retry("dashboard", 102)
            .unwrap();
        assert_eq!(reset.status.state, RuntimeServiceState::AvailableButStopped);
        assert_eq!(reset.status.last_error, None);
        assert_eq!(
            store
                .begin_eager_durable_service_start(
                    &registration,
                    &profile,
                    103,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap(),
            DurableServiceStartResult::Queued
        );
        assert_eq!(outbox_count(&store, None), 1);
        assert_eq!(
            store
                .reset_durable_service_for_explicit_retry("dashboard", 104)
                .unwrap()
                .status
                .state,
            RuntimeServiceState::Starting
        );
        assert_eq!(
            store
                .begin_eager_durable_service_start(
                    &registration,
                    &profile,
                    105,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap(),
            DurableServiceStartResult::AlreadyStartingOrReady
        );
        assert_eq!(outbox_count(&store, None), 1);
    }

    #[test]
    fn explicit_retry_accepts_acked_history_after_nonretryable_eager_exit() {
        let (_directory, store) = store();
        let registration = registration_with_policy_and_class(
            "dashboard",
            ServiceStartupPolicy::Eager,
            ResourceClass::Core,
        );
        let profile = admission_profile("dashboard", RuntimeMode::Lean, 64);
        store.register_durable_service(&registration, 100).unwrap();
        assert_eq!(
            store
                .begin_eager_durable_service_start(
                    &registration,
                    &profile,
                    101,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap(),
            DurableServiceStartResult::Queued
        );
        let start = acknowledge_next_start(&store, 102, 103);
        let failed = store
            .finish_durable_service_generation_inner(
                &start,
                ServiceLifecycleState::Failed,
                false,
                ServiceLeaseReleaseReason::Failure,
                Some("Service process exhausted its enforced resource limit"),
                ServiceTerminalProofKind::TreeExit {
                    started_boundary_accepted: true,
                    accepted_stop: None,
                },
                104,
            )
            .unwrap();
        assert_eq!(failed.status.state, RuntimeServiceState::Failed);
        assert_eq!(failed.restart, DurableServiceRestartStatus::Disabled);
        assert_eq!(outbox_count(&store, Some("acked")), 1);

        let reset = store
            .reset_durable_service_for_explicit_retry("dashboard", 105)
            .unwrap();
        assert_eq!(reset.status.state, RuntimeServiceState::AvailableButStopped);
        assert_eq!(
            store
                .begin_eager_durable_service_start(
                    &registration,
                    &profile,
                    106,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap(),
            DurableServiceStartResult::Queued
        );
        assert_eq!(outbox_count(&store, Some("acked")), 1);
        assert_eq!(outbox_count(&store, Some("pending")), 1);
        assert_eq!(
            store
                .begin_eager_durable_service_start(
                    &registration,
                    &profile,
                    107,
                    AdmissionPolicy::default(),
                    commit_sample,
                )
                .unwrap(),
            DurableServiceStartResult::AlreadyStartingOrReady
        );
        assert_eq!(outbox_count(&store, Some("pending")), 1);
    }

    #[test]
    fn nonretryable_failure_cannot_be_revived_by_a_new_lease() {
        let (_directory, store) = store();
        let registration = registration("search");
        let profile = admission_profile("search", RuntimeMode::Lean, 64);
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let start = acknowledge_next_start(&store, 101, 102);
        let snapshot = store
            .finish_durable_service_generation_inner(
                &start,
                ServiceLifecycleState::Failed,
                false,
                ServiceLeaseReleaseReason::Failure,
                Some("Service process exhausted its enforced resource limit"),
                ServiceTerminalProofKind::NotCreated,
                103,
            )
            .unwrap();
        assert_eq!(snapshot.restart, DurableServiceRestartStatus::Disabled);
        assert!(matches!(
            store.begin_durable_service_acquire(
                &registration,
                &profile,
                "lease_2",
                500,
                1_000,
                AdmissionPolicy::default(),
                commit_sample,
            ),
            Err(DurableServiceStoreError::Lease(
                ServiceLeaseError::RestartForbidden(service_id)
            )) if service_id == "search"
        ));
        assert_eq!(outbox_count(&store, Some("pending")), 0);
    }

    #[test]
    fn stopped_exit_requires_the_matching_acknowledged_stop_authority() {
        let (_unbound_directory, unbound_store) = store();
        let unbound_registration = registration("search");
        let _lease = acquire(&unbound_store, &unbound_registration, "lease_1", 100);
        let start_claim = unbound_store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        let start = match unbound_store
            .acknowledge_durable_service_intent(start_claim, 102)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        };
        let stopped = ProcessTreeExit::service_stopped_after_started_for_test_in_scope(
            unbound_store.generation_scope.clone(),
            "search",
            1,
        );
        let snapshot = unbound_store
            .finish_durable_service_tree_exit_inner(&start, &stopped, None, 103)
            .unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::Failed);
        assert_eq!(
            snapshot.status.last_error.as_deref(),
            Some("Service process stopped without matching durable StopTree authority")
        );

        let (_controlled_directory, controlled_store) = store();
        let controlled_registration = registration("search");
        let _lease = acquire(&controlled_store, &controlled_registration, "lease_1", 100);
        let start_claim = controlled_store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        let start = match controlled_store
            .acknowledge_durable_service_intent(start_claim, 102)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        };
        assert_eq!(
            controlled_store
                .begin_durable_service_shutdown(103)
                .unwrap(),
            1
        );
        let stop_claim = controlled_store
            .claim_next_durable_service_intent(100, 104)
            .unwrap()
            .unwrap();
        let stop = match controlled_store
            .acknowledge_durable_service_intent(stop_claim, 105)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Stop(authority) => authority,
            AcknowledgedServiceIntent::Start(_) => panic!("expected StopTree authority"),
        };
        let stopped = ProcessTreeExit::service_stopped_after_started_for_test_in_scope(
            controlled_store.generation_scope.clone(),
            "search",
            1,
        );
        let snapshot = controlled_store
            .finish_durable_service_tree_exit_inner(&start, &stopped, Some(stop.cause()), 106)
            .unwrap();
        assert_eq!(
            snapshot.status.state,
            RuntimeServiceState::AvailableButStopped
        );
        assert_eq!(snapshot.status.last_error, None);
        assert_eq!(active_service_reservations(&controlled_store), 0);
    }

    #[test]
    fn readiness_failure_stop_is_exact_idempotent_and_retryable_after_tree_exit() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let start = acknowledge_next_start(&store, 101, 102);
        let residency =
            ProcessTreeResidency::service_for_test(store.generation_scope.clone(), "search", 1);
        store
            .settle_durable_service_residency_inner(&start, &residency, 103)
            .unwrap();

        let stopping = store
            .begin_durable_service_readiness_failure_stop_inner(&start, 104)
            .unwrap();
        assert_eq!(stopping.status.state, RuntimeServiceState::Stopping);
        assert_eq!(stopping.pending_leases, 0);
        assert_eq!(stopping.active_leases, 0);
        assert_eq!(
            stopping.status.last_error.as_deref(),
            Some(SERVICE_READINESS_TIMEOUT_MESSAGE)
        );
        let repeated = store
            .begin_durable_service_readiness_failure_stop_inner(&start, 105)
            .unwrap();
        assert_eq!(repeated, stopping);
        assert_eq!(outbox_count(&store, Some("pending")), 1);
        {
            let connection = store.connection.lock().unwrap();
            assert_eq!(
                connection
                    .query_row(
                        "SELECT release_reason FROM runtime_service_leases
                         WHERE lease_id='lease_1'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .unwrap(),
                "failure"
            );
        }

        let stop_claim = store
            .claim_next_durable_service_intent(100, 106)
            .unwrap()
            .unwrap();
        let stop = match store
            .acknowledge_durable_service_intent(stop_claim, 107)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Stop(authority) => authority,
            AcknowledgedServiceIntent::Start(_) => panic!("expected StopTree authority"),
        };
        assert_eq!(stop.cause(), ServiceStopCause::Failure);
        let stopped = ProcessTreeExit::service_stopped_after_started_for_test_in_scope(
            store.generation_scope.clone(),
            "search",
            1,
        );
        let failed = store
            .finish_durable_service_tree_exit_inner(&start, &stopped, Some(stop.cause()), 108)
            .unwrap();
        assert_eq!(failed.status.state, RuntimeServiceState::Failed);
        assert_eq!(
            failed.status.last_error.as_deref(),
            Some(SERVICE_READINESS_TIMEOUT_MESSAGE)
        );
        assert_eq!(failed.restart.next_attempt_at_ms(), Some(118));
        assert_eq!(active_service_reservations(&store), 0);
    }

    #[test]
    fn start_cannot_become_ready_before_matching_tree_residency() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let claim = store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        let start = match store
            .acknowledge_durable_service_intent(claim, 102)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        };

        assert!(matches!(
            store.confirm_durable_service_ready_inner(&start, 103),
            Err(DurableServiceStoreError::CorruptService(_))
        ));
        let wrong_generation =
            ProcessTreeResidency::service_for_test(store.generation_scope.clone(), "search", 2);
        assert!(matches!(
            store.settle_durable_service_residency_inner(&start, &wrong_generation, 103),
            Err(DurableServiceStoreError::OutboxFenceMismatch)
        ));
        let foreign_scope = ProcessTreeResidency::service_for_test(
            RuntimeGenerationScope::from_trusted_data_root_identity(7, 11),
            "search",
            1,
        );
        assert!(matches!(
            store.settle_durable_service_residency_inner(&start, &foreign_scope, 103),
            Err(DurableServiceStoreError::OutboxFenceMismatch)
        ));
        assert_eq!(active_service_reservations(&store), 1);

        let residency =
            ProcessTreeResidency::service_for_test(store.generation_scope.clone(), "search", 1);
        store
            .settle_durable_service_residency_inner(&start, &residency, 103)
            .unwrap();
        let snapshot = store
            .confirm_durable_service_ready_inner(&start, 104)
            .unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::Busy);
    }

    #[test]
    fn not_created_proof_releases_pending_generation_with_fixed_diagnostic() {
        let (_directory, store) = store();
        let registration = registration("search");
        let _lease = acquire(&store, &registration, "lease_1", 100);
        let claim = store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        let start = match store
            .acknowledge_durable_service_intent(claim, 102)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        };
        let snapshot = store
            .finish_durable_service_not_created_inner(
                &start,
                &ProcessOwnerError::UnsupportedPlatform,
                103,
            )
            .unwrap();
        assert_eq!(snapshot.status.state, RuntimeServiceState::Failed);
        assert_eq!(
            snapshot.status.last_error.as_deref(),
            Some("Authoritative service process ownership is unsupported on this platform")
        );
        assert_eq!(snapshot.pending_leases, 0);
        assert_eq!(active_service_reservations(&store), 0);
    }

    #[test]
    fn stop_ack_mints_only_a_distinct_stop_authority() {
        let (_directory, store) = store();
        let registration = registration("search");
        let lease = acquire(&store, &registration, "lease_1", 100);
        let start_claim = store
            .claim_next_durable_service_intent(100, 101)
            .unwrap()
            .unwrap();
        let start = match store
            .acknowledge_durable_service_intent(start_claim, 102)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Start(authority) => authority,
            AcknowledgedServiceIntent::Stop(_) => panic!("expected StartTree authority"),
        };
        let residency =
            ProcessTreeResidency::service_for_test(store.generation_scope.clone(), "search", 1);
        store
            .settle_durable_service_residency_inner(&start, &residency, 103)
            .unwrap();
        store
            .confirm_durable_service_ready_inner(&start, 104)
            .unwrap();
        store
            .release_durable_service_lease(&lease, ServiceLeaseReleaseReason::Explicit, 105)
            .unwrap();
        store.advance_durable_service_time("search", 205).unwrap();
        let stop_claim = store
            .claim_next_durable_service_intent(100, 206)
            .unwrap()
            .unwrap();
        let stop = match store
            .acknowledge_durable_service_intent(stop_claim, 207)
            .unwrap()
            .authority
        {
            AcknowledgedServiceIntent::Stop(authority) => authority,
            AcknowledgedServiceIntent::Start(_) => panic!("expected StopTree authority"),
        };
        assert_eq!(stop.service_id(), "search");
        assert_eq!(stop.generation(), 1);
        assert_eq!(stop.cause(), ServiceStopCause::Idle);
        assert_eq!(
            store
                .durable_service_snapshot("search")
                .unwrap()
                .status
                .state,
            RuntimeServiceState::Stopping
        );
    }

    #[test]
    fn retained_table_preserves_a_deferred_stop_and_quarantines_a_duplicate() {
        let (_directory, store) = store();
        let stop = |intent_id| DurableServiceStopAuthority {
            scope: store.generation_scope.clone(),
            _intent_id: intent_id,
            _claim_epoch: 1,
            service_id: "search".into(),
            generation: 1,
            cause: ServiceStopCause::Shutdown,
        };
        let mut retained = RetainedServiceAuthorities::default();
        assert_eq!(
            retained.retain_stop(stop(1)),
            ServiceLaunchRetentionDisposition::Retained
        );
        let entry = retained.active.get(&("search".to_owned(), 1)).unwrap();
        assert!(entry.phase.is_none());
        assert!(entry.deferred_stop.is_some());

        assert_eq!(
            retained.retain_stop(stop(2)),
            ServiceLaunchRetentionDisposition::DuplicateQuarantined
        );
        assert_eq!(retained.quarantined.len(), 1);
        assert!(retained.active[&("search".to_owned(), 1)]
            .deferred_stop
            .is_some());
    }
}

impl JobStore {
    /// Extends one live opaque lease by the service's registered maximum
    /// duration. This is intentionally not exposed through the public control
    /// protocol: only a Runtime-owned long-poll gateway may retain and renew
    /// the exact non-cloneable claim that was originally admitted.
    pub fn renew_durable_service_lease(
        &self,
        lease: &mut DurableServiceLeaseClaim,
        now_ms: u64,
    ) -> Result<u64, DurableServiceStoreError> {
        self.require_service_scope(&lease.scope)?;
        validate_runtime_time(now_ms)?;
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let service = query_service_tx(&transaction, &lease.service_id)?;
        require_monotonic_time(&service, now_ms)?;
        expire_service_leases_tx(&transaction, &service, now_ms)?;
        let persisted = query_lease_tx(&transaction, &lease.lease_id)?
            .ok_or_else(|| DurableServiceStoreError::LeaseNotFound(lease.lease_id.clone()))?;
        if persisted.service_id != lease.service_id || persisted.generation != lease.generation {
            return Err(DurableServiceStoreError::OutboxFenceMismatch);
        }
        if persisted.state == PersistedLeaseState::Released {
            return Err(DurableServiceStoreError::LeaseNotFound(
                lease.lease_id.clone(),
            ));
        }
        let expires_at_ms = now_ms
            .checked_add(service.max_lease_ms)
            .filter(|expires| *expires <= MAX_SQLITE_UNSIGNED)
            .ok_or(ServiceLeaseError::LeaseExpiryOverflow)?;
        let updated = transaction.execute(
            "UPDATE runtime_service_leases SET expires_at=?2, updated_at=?3
             WHERE lease_id=?1 AND lifecycle_state IN ('pending','active')",
            params![
                lease.lease_id,
                to_i64(expires_at_ms, "service lease renewal expiry")?,
                to_i64(now_ms, "service lease renewal time")?,
            ],
        )?;
        if updated != 1 {
            return Err(DurableServiceStoreError::LeaseNotFound(
                lease.lease_id.clone(),
            ));
        }
        transaction.execute(
            "UPDATE runtime_services SET last_observed_at=?2, updated_at=?2
             WHERE service_id=?1",
            params![service.service_id, to_i64(now_ms, "service time")?],
        )?;
        transaction.commit()?;
        lease.expires_at_ms = expires_at_ms;
        Ok(expires_at_ms)
    }

    /// Releases the exact durable lease. Repeating a release with the same
    /// authority is idempotent; a copied lease id without its scope and
    /// generation fence is insufficient.
    pub fn release_durable_service_lease(
        &self,
        lease: &DurableServiceLeaseClaim,
        reason: ServiceLeaseReleaseReason,
        now_ms: u64,
    ) -> Result<ServiceLeaseReleaseDisposition, DurableServiceStoreError> {
        self.require_service_scope(&lease.scope)?;
        validate_runtime_time(now_ms)?;
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let service = query_service_tx(&transaction, &lease.service_id)?;
        require_monotonic_time(&service, now_ms)?;
        expire_service_leases_tx(&transaction, &service, now_ms)?;
        let persisted = query_lease_tx(&transaction, &lease.lease_id)?
            .ok_or_else(|| DurableServiceStoreError::LeaseNotFound(lease.lease_id.clone()))?;
        if persisted.service_id != lease.service_id || persisted.generation != lease.generation {
            return Err(DurableServiceStoreError::OutboxFenceMismatch);
        }
        let disposition = if persisted.state == PersistedLeaseState::Released {
            ServiceLeaseReleaseDisposition::AlreadyReleased
        } else {
            transaction.execute(
                "UPDATE runtime_service_leases
                 SET lifecycle_state='released', released_at=?2, release_reason=?3, updated_at=?2
                 WHERE lease_id=?1 AND lifecycle_state IN ('pending','active')",
                params![
                    lease.lease_id,
                    to_i64(now_ms, "service lease release time")?,
                    release_reason_name(reason),
                ],
            )?;
            ServiceLeaseReleaseDisposition::Released
        };
        schedule_idle_if_eligible_tx(&transaction, &service.service_id, now_ms)?;
        transaction.execute(
            "UPDATE runtime_services SET last_observed_at=?2, updated_at=?2
             WHERE service_id=?1",
            params![service.service_id, to_i64(now_ms, "service time")?],
        )?;
        transaction.commit()?;
        Ok(disposition)
    }

    /// Explicitly expires due leases for one service. Timers call this method;
    /// status reads never do. It returns the number newly resolved.
    pub fn expire_durable_service_leases(
        &self,
        service_id: &str,
        now_ms: u64,
    ) -> Result<u32, DurableServiceStoreError> {
        validate_identifier("serviceId", service_id).map_err(ServiceLeaseError::from)?;
        validate_runtime_time(now_ms)?;
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let service = query_service_tx(&transaction, service_id)?;
        require_monotonic_time(&service, now_ms)?;
        let expired = expire_service_leases_tx(&transaction, &service, now_ms)?;
        transaction.execute(
            "UPDATE runtime_services SET last_observed_at=?2, updated_at=?2
             WHERE service_id=?1",
            params![service_id, to_i64(now_ms, "service time")?],
        )?;
        transaction.commit()?;
        u32::try_from(expired)
            .map_err(|_| DurableServiceStoreError::CorruptService(service_id.into()))
    }

    /// Advances explicit service timers. Expiry and an eligible idle StopTree
    /// transition are committed together, ensuring the stop intent cannot be
    /// lost after the service enters `stopping`.
    pub fn advance_durable_service_time(
        &self,
        service_id: &str,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        validate_identifier("serviceId", service_id).map_err(ServiceLeaseError::from)?;
        validate_runtime_time(now_ms)?;
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let service = query_service_tx(&transaction, service_id)?;
        require_monotonic_time(&service, now_ms)?;
        expire_service_leases_tx(&transaction, &service, now_ms)?;
        let current = query_service_tx(&transaction, service_id)?;
        if current.lifecycle_state == ServiceLifecycleState::Ready
            && current.idle_due_at.is_some_and(|due| due <= now_ms)
        {
            let (pending, active) = active_lease_counts_tx(&transaction, service_id)?;
            if pending == 0 && active == 0 {
                transaction.execute(
                    "UPDATE runtime_services SET lifecycle_state='stopping', idle_due_at=NULL,
                     last_observed_at=?3, updated_at=?3
                     WHERE service_id=?1 AND generation=?2 AND lifecycle_state='ready'",
                    params![
                        service_id,
                        to_i64(current.generation, "service generation")?,
                        to_i64(now_ms, "service time")?,
                    ],
                )?;
                insert_service_intent_tx(
                    &transaction,
                    service_id,
                    current.generation,
                    "stop_tree",
                    Some("idle"),
                    now_ms,
                )?;
            }
        }
        transaction.execute(
            "UPDATE runtime_services SET last_observed_at=?2, updated_at=?2
             WHERE service_id=?1",
            params![service_id, to_i64(now_ms, "service time")?],
        )?;
        let snapshot = service_snapshot_tx(&transaction, service_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// Claims the oldest available StartTree/StopTree intent. An expired claim
    /// may be reclaimed with a larger epoch; that increment permanently fences
    /// the old claimant from acknowledging or confirming lifecycle state.
    pub fn claim_next_durable_service_intent(
        &self,
        claim_ttl_ms: u64,
        now_ms: u64,
    ) -> Result<Option<DurableServiceOutboxClaim>, DurableServiceStoreError> {
        validate_runtime_time(now_ms)?;
        if claim_ttl_ms == 0 || claim_ttl_ms > MAX_TIMEOUT_MS {
            return Err(ServiceLeaseError::InvalidLimit {
                field: "serviceIntentClaimTtlMs",
            }
            .into());
        }
        let expires_at = now_ms
            .checked_add(claim_ttl_ms)
            .filter(|expires| *expires <= MAX_SQLITE_UNSIGNED)
            .ok_or(ServiceLeaseError::LeaseExpiryOverflow)?;
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let candidate = transaction
            .query_row(
                "SELECT intent_id, service_id, generation, action, stop_cause, claim_epoch
                 FROM runtime_service_outbox
                 WHERE lifecycle_state='pending'
                    OR (lifecycle_state='claimed' AND claim_expires_at<=?1)
                 ORDER BY intent_id LIMIT 1",
                params![to_i64(now_ms, "service intent claim time")?],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()?;
        let Some((intent_id, service_id, generation, action, stop_cause, old_epoch)) = candidate
        else {
            transaction.commit()?;
            return Ok(None);
        };
        let claim_epoch = old_epoch
            .checked_add(1)
            .ok_or(DurableServiceStoreError::CorruptService(service_id.clone()))?;
        let changed = transaction.execute(
            "UPDATE runtime_service_outbox
             SET lifecycle_state='claimed', claim_epoch=?2, claimed_at=?3,
                 claim_expires_at=?4, updated_at=?3
             WHERE intent_id=?1 AND (
                lifecycle_state='pending' OR
                (lifecycle_state='claimed' AND claim_expires_at<=?3)
             )",
            params![
                intent_id,
                claim_epoch,
                to_i64(now_ms, "service intent claim time")?,
                to_i64(expires_at, "service intent claim expiry")?,
            ],
        )?;
        if changed != 1 {
            return Err(DurableServiceStoreError::OutboxFenceMismatch);
        }
        let generation = from_i64_u64(generation, &service_id)?;
        let claim_epoch = from_i64_u64(claim_epoch, &service_id)?;
        let action = parse_service_action(&service_id, generation, &action, stop_cause.as_deref())?;
        transaction.commit()?;
        Ok(Some(DurableServiceOutboxClaim {
            scope: self.generation_scope.clone(),
            intent_id,
            claim_epoch,
            claim_expires_at_ms: expires_at,
            action,
        }))
    }

    /// Linearizes StartTree acknowledgement, the sole CreateProcess attempt,
    /// and insertion of its classified outcome into the generation-global
    /// owner map against durable shutdown. No caller callback or returned
    /// process value can create a post-launch/pre-retention gap.
    pub fn acknowledge_and_launch_durable_service_start(
        &self,
        claim: DurableServiceOutboxClaim,
        now_ms: u64,
        generation: &CurrentGenerationMembership,
        request: ServiceLaunchRequest,
    ) -> Result<ServiceLaunchRetentionDisposition, DurableServiceLaunchTransitionError> {
        if !matches!(&claim.action, ServiceLeaseAction::StartTree { .. }) {
            return Err(DurableServiceLaunchTransitionError {
                claim: Box::new(claim),
                request: Box::new(request),
                error: DurableServiceStoreError::InvalidIntent("launch service start"),
            });
        }
        let bootstrap_gate = self
            .trusted_service_bootstrap_open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if self.generation_shutdown.load(Ordering::Acquire) || !*bootstrap_gate {
            return Err(DurableServiceLaunchTransitionError {
                claim: Box::new(claim),
                request: Box::new(request),
                error: StoreError::AdmissionClosed.into(),
            });
        }
        let acknowledgement = match self.acknowledge_durable_service_intent(claim, now_ms) {
            Ok(acknowledgement) => acknowledgement,
            Err(transition) => {
                let (claim, error) = transition.into_parts();
                return Err(DurableServiceLaunchTransitionError {
                    claim: Box::new(claim),
                    request: Box::new(request),
                    error,
                });
            }
        };
        let AcknowledgedServiceIntent::Start(start) = acknowledgement.authority else {
            unreachable!("a validated StartTree claim cannot acknowledge as StopTree");
        };
        let outcome = start.launch(generation, request);
        let retained = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .retain_launch(outcome);
        drop(bootstrap_gate);
        Ok(retained)
    }

    /// Reads one bounded supervisor event while the generation-global table
    /// continues to retain the exact live authority.
    pub fn read_retained_durable_service_launch_event(
        &self,
        service_id: &str,
        service_generation: u64,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match launches
            .active
            .get_mut(&(service_id.to_owned(), service_generation))
            .and_then(|entry| entry.phase.as_mut())
        {
            Some(authority) if authority.pids().is_some() => {
                authority.read_event(timeout).map_err(Into::into)
            }
            Some(_) => Err(DurableServiceStoreError::RetainedLaunchNotRunning {
                service_id: service_id.into(),
                generation: service_generation,
            }),
            None => Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            }),
        }
    }

    /// Returns process identifiers without transferring or cloning process
    /// ownership out of the generation-global table.
    pub fn retained_durable_service_launch_pids(
        &self,
        service_id: &str,
        service_generation: u64,
    ) -> Result<(u32, Option<u32>), DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match launches
            .active
            .get(&(service_id.to_owned(), service_generation))
            .and_then(|entry| entry.phase.as_ref())
        {
            Some(authority) => {
                authority
                    .pids()
                    .ok_or_else(|| DurableServiceStoreError::RetainedLaunchNotRunning {
                        service_id: service_id.into(),
                        generation: service_generation,
                    })
            }
            None => Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            }),
        }
    }

    /// Revalidates and performs the only retry retained by a no-process-created
    /// outcome under the same shutdown fence. Authority never leaves the
    /// generation-global table, including on every error path.
    pub fn retry_retained_durable_service_launch(
        &self,
        service_id: &str,
        service_generation: u64,
        generation: &CurrentGenerationMembership,
    ) -> Result<ServiceLaunchRetentionDisposition, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let bootstrap_gate = self
            .trusted_service_bootstrap_open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if self.generation_shutdown.load(Ordering::Acquire) || !*bootstrap_gate {
            return Err(StoreError::AdmissionClosed.into());
        }
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = (service_id.to_owned(), service_generation);
        let Some(entry) = launches.active.get_mut(&key) else {
            return Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            });
        };
        let Some(phase) = entry.phase.take() else {
            return Err(RetainedServiceAuthorities::phase_mismatch(
                service_id,
                service_generation,
                None,
                "retry launch",
            ));
        };
        let authority = match phase {
            RetainedServiceAuthority::NotCreated(authority) => authority,
            phase => {
                let current = phase.phase();
                entry.phase = Some(phase);
                return Err(RetainedServiceAuthorities::phase_mismatch(
                    service_id,
                    service_generation,
                    Some(current),
                    "retry launch",
                ));
            }
        };
        let validation = {
            let (start, _) = authority.parts();
            self.require_service_scope(&start.scope).and_then(|()| {
                let connection = self
                    .connection
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                require_acknowledged_start_authority_tx(&connection, start)?;
                let service = query_service_tx(&connection, start.service_id())?;
                require_service_generation(&service, start.generation())?;
                if service.lifecycle_state != ServiceLifecycleState::Starting
                    || service_reservation_state_tx(&connection, start.service_id())?
                        != Some("pending")
                {
                    return Err(DurableServiceStoreError::CorruptService(
                        start.service_id().into(),
                    ));
                }
                Ok(())
            })
        };
        if let Err(error) = validation {
            launches
                .active
                .get_mut(&key)
                .expect("failed service retry validation must retain its table entry")
                .phase = Some(RetainedServiceAuthority::NotCreated(authority));
            return Err(error);
        }
        let outcome = match authority.retry(generation) {
            Ok(outcome) => outcome,
            Err(authority) => {
                launches
                    .active
                    .get_mut(&key)
                    .expect("exhausted service retry must retain its table entry")
                    .phase = Some(RetainedServiceAuthority::NotCreated(*authority));
                return Err(DurableServiceStoreError::InvalidIntent(
                    "retry exhausted service launch",
                ));
            }
        };
        let next = RetainedServiceAuthority::from_launch(outcome);
        launches
            .active
            .get_mut(&key)
            .expect("retried service launch must retain its table entry")
            .phase = Some(next);
        drop(bootstrap_gate);
        Ok(ServiceLaunchRetentionDisposition::Retained)
    }

    /// Atomically settles the retained claimed/residency phase and leaves the
    /// resulting starting process in the generation-global table. No live or
    /// residency authority crosses the public API boundary.
    pub fn settle_retained_durable_service_residency(
        &self,
        service_id: &str,
        service_generation: u64,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = (service_id.to_owned(), service_generation);
        let Some(entry) = launches.active.get_mut(&key) else {
            return Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            });
        };
        let Some(phase) = entry.phase.take() else {
            return Err(RetainedServiceAuthorities::phase_mismatch(
                service_id,
                service_generation,
                None,
                "settle residency",
            ));
        };
        let residency = match phase {
            RetainedServiceAuthority::Claimed(process) => match process.into_residency() {
                Ok(residency) => residency,
                Err(transition) => {
                    let (process, error) = transition.into_parts();
                    entry.phase = Some(RetainedServiceAuthority::Claimed(process));
                    return Err(error.into());
                }
            },
            RetainedServiceAuthority::Residency(residency) => residency,
            phase => {
                let current = phase.phase();
                entry.phase = Some(phase);
                return Err(RetainedServiceAuthorities::phase_mismatch(
                    service_id,
                    service_generation,
                    Some(current),
                    "settle residency",
                ));
            }
        };
        let result = {
            let (start, proof) = residency.parts();
            self.settle_durable_service_residency_inner(start, proof, now_ms)
        };
        match result {
            Ok(snapshot) => {
                entry.phase = Some(RetainedServiceAuthority::Starting(
                    residency.into_starting(),
                ));
                Ok(snapshot)
            }
            Err(error) => {
                entry.phase = Some(RetainedServiceAuthority::Residency(residency));
                Err(error)
            }
        }
    }

    /// Performs one bounded readiness probe and, when successful, commits the
    /// exact ready proof before retaining the resident phase. The copyable
    /// result contains no process ownership.
    pub fn advance_retained_durable_service_readiness(
        &self,
        service_id: &str,
        service_generation: u64,
        now_ms: u64,
    ) -> Result<RetainedServiceReadinessProgress, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = (service_id.to_owned(), service_generation);
        let Some(entry) = launches.active.get_mut(&key) else {
            return Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            });
        };
        let Some(phase) = entry.phase.take() else {
            return Err(RetainedServiceAuthorities::phase_mismatch(
                service_id,
                service_generation,
                None,
                "advance readiness",
            ));
        };
        let ready = match phase {
            RetainedServiceAuthority::Starting(process) => match process.probe_readiness() {
                ServiceReadinessProbeOutcome::Ready(ready) => ready,
                ServiceReadinessProbeOutcome::Pending {
                    process,
                    retry_after,
                    reason,
                } => {
                    entry.phase = Some(RetainedServiceAuthority::Starting(process));
                    return Ok(RetainedServiceReadinessProgress::Pending {
                        retry_after,
                        reason,
                    });
                }
                ServiceReadinessProbeOutcome::TimedOut(process) => {
                    let failure = self.begin_durable_service_readiness_failure_stop_inner(
                        process.start_authority(),
                        now_ms,
                    );
                    entry.phase = Some(RetainedServiceAuthority::Starting(process));
                    return match failure {
                        Ok(_) => Ok(RetainedServiceReadinessProgress::TimedOut),
                        Err(error) => Err(error),
                    };
                }
                ServiceReadinessProbeOutcome::ProcessExited(process) => {
                    entry.phase = Some(RetainedServiceAuthority::Starting(process));
                    return Ok(RetainedServiceReadinessProgress::ProcessExited);
                }
            },
            RetainedServiceAuthority::Ready(ready) => ready,
            RetainedServiceAuthority::Resident(process) => {
                entry.phase = Some(RetainedServiceAuthority::Resident(process));
                return Ok(RetainedServiceReadinessProgress::AlreadyReady);
            }
            phase => {
                let current = phase.phase();
                entry.phase = Some(phase);
                return Err(RetainedServiceAuthorities::phase_mismatch(
                    service_id,
                    service_generation,
                    Some(current),
                    "advance readiness",
                ));
            }
        };
        match self.confirm_durable_service_ready_inner(ready.start_authority(), now_ms) {
            Ok(_) => {
                entry.phase = Some(RetainedServiceAuthority::Resident(ready.into_resident()));
                Ok(RetainedServiceReadinessProgress::Ready)
            }
            Err(error) => {
                entry.phase = Some(RetainedServiceAuthority::Ready(ready));
                Err(error)
            }
        }
    }

    /// Acknowledges a StopTree claim directly into the authority table and
    /// immediately attempts to bind it to any matching live phase. The raw
    /// acknowledged stop capability never leaves core.
    pub fn acknowledge_and_bind_retained_durable_service_stop(
        &self,
        claim: DurableServiceOutboxClaim,
        now_ms: u64,
        force: bool,
    ) -> Result<
        (ServiceIntentAckDisposition, RetainedServiceStopProgress),
        DurableServiceIntentTransitionError,
    > {
        let (service_id, generation) = match &claim.action {
            ServiceLeaseAction::StopTree {
                service_id,
                generation,
                ..
            } => (service_id.clone(), *generation),
            _ => {
                return Err(DurableServiceIntentTransitionError {
                    claim: Box::new(claim),
                    error: DurableServiceStoreError::InvalidIntent("acknowledge service stop"),
                })
            }
        };
        // Table -> connection is the global order used by every phase and
        // finalization transition. Holding this lock across acknowledgement
        // prevents exact exit/finalization from removing the generation in
        // the ack-to-retain interval.
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let acknowledged = self.acknowledge_durable_service_intent(claim, now_ms)?;
        let AcknowledgedServiceIntent::Stop(stop) = acknowledged.authority else {
            unreachable!("a validated StopTree claim cannot acknowledge as StartTree");
        };
        if launches.retain_stop(stop) == ServiceLaunchRetentionDisposition::DuplicateQuarantined {
            return Ok((
                acknowledged.disposition,
                RetainedServiceStopProgress::DuplicateQuarantined,
            ));
        }
        let progress = bind_retained_service_stop(&mut launches, &service_id, generation, force);
        Ok((acknowledged.disposition, progress))
    }

    /// Retries a previously deferred StopTree binding without acknowledging a
    /// second durable authority.
    pub fn retry_retained_durable_service_stop(
        &self,
        service_id: &str,
        service_generation: u64,
        force: bool,
    ) -> Result<RetainedServiceStopProgress, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !launches
            .active
            .contains_key(&(service_id.to_owned(), service_generation))
        {
            return Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            });
        }
        Ok(bind_retained_service_stop(
            &mut launches,
            service_id,
            service_generation,
            force,
        ))
    }

    /// Returns the copyable retained phase without exposing process authority.
    pub fn retained_durable_service_authority_phase(
        &self,
        service_id: &str,
        service_generation: u64,
    ) -> Result<Option<RetainedServiceAuthorityPhase>, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = launches
            .active
            .get(&(service_id.to_owned(), service_generation))
            .ok_or_else(|| DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            })?;
        Ok(entry.phase.as_ref().map(RetainedServiceAuthority::phase))
    }

    /// Durably finalizes a retained proof that process creation never
    /// occurred. Store failure restores the complete retry/start authority;
    /// success removes the generation entry and any now-stale deferred stop.
    pub fn finish_retained_durable_service_not_created(
        &self,
        service_id: &str,
        service_generation: u64,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = (service_id.to_owned(), service_generation);
        let Some(entry) = launches.active.get_mut(&key) else {
            return Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            });
        };
        let Some(phase) = entry.phase.take() else {
            return Err(RetainedServiceAuthorities::phase_mismatch(
                service_id,
                service_generation,
                None,
                "finish not-created launch",
            ));
        };
        let authority = match phase {
            RetainedServiceAuthority::NotCreated(authority) => authority,
            phase => {
                let current = phase.phase();
                entry.phase = Some(phase);
                return Err(RetainedServiceAuthorities::phase_mismatch(
                    service_id,
                    service_generation,
                    Some(current),
                    "finish not-created launch",
                ));
            }
        };
        let result = {
            let (start, error) = authority.parts();
            self.finish_durable_service_not_created_inner(start, error, now_ms)
        };
        match result {
            Ok(snapshot) => {
                launches.active.remove(&key);
                Ok(snapshot)
            }
            Err(error) => {
                launches
                    .active
                    .get_mut(&key)
                    .expect("failed not-created finalization must retain its table entry")
                    .phase = Some(RetainedServiceAuthority::NotCreated(authority));
                Err(error)
            }
        }
    }

    /// Confirms exact zero residency from any retained live phase and commits
    /// the terminal service transaction before releasing authority. A failed
    /// confirmation restores the live phase; a failed database transaction
    /// retains the exact exit proof for an idempotent retry of this method.
    pub fn confirm_and_finish_retained_durable_service_exit(
        &self,
        service_id: &str,
        service_generation: u64,
        terminal: &ProcessOwnerTerminal,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = (service_id.to_owned(), service_generation);
        let Some(entry) = launches.active.get_mut(&key) else {
            return Err(DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            });
        };
        let Some(phase) = entry.phase.take() else {
            return Err(RetainedServiceAuthorities::phase_mismatch(
                service_id,
                service_generation,
                None,
                "confirm and finish exit",
            ));
        };
        let exit = match phase {
            RetainedServiceAuthority::Exited(exit) => exit,
            phase @ (RetainedServiceAuthority::NotCreated(_)
            | RetainedServiceAuthority::Uncertain(_)) => {
                let current = phase.phase();
                entry.phase = Some(phase);
                return Err(RetainedServiceAuthorities::phase_mismatch(
                    service_id,
                    service_generation,
                    Some(current),
                    "confirm and finish exit",
                ));
            }
            phase => match phase.confirm_exit(terminal) {
                Ok(exit) => exit,
                Err((phase, error)) => {
                    entry.phase = Some(phase);
                    return Err(error.into());
                }
            },
        };
        let result = {
            let (start, tree_exit, accepted_stop) = exit.parts();
            self.finish_durable_service_tree_exit_inner(start, tree_exit, accepted_stop, now_ms)
        };
        match result {
            Ok(snapshot) => {
                launches.active.remove(&key);
                Ok(snapshot)
            }
            Err(error) => {
                launches
                    .active
                    .get_mut(&key)
                    .expect("failed tree-exit finalization must retain its table entry")
                    .phase = Some(RetainedServiceAuthority::Exited(exit));
                Err(error)
            }
        }
    }

    /// Requests bounded emergency cleanup for an uncertain CreateProcess
    /// result while leaving both StartTree and cleanup authority in the table.
    pub fn request_retained_durable_service_emergency_shutdown(
        &self,
        service_id: &str,
        service_generation: u64,
    ) -> Result<(), DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = launches
            .active
            .get_mut(&(service_id.to_owned(), service_generation))
            .ok_or_else(|| DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            })?;
        match entry.phase.as_mut() {
            Some(RetainedServiceAuthority::Uncertain(authority)) => {
                authority.request_runtime_shutdown();
                Ok(())
            }
            phase => Err(RetainedServiceAuthorities::phase_mismatch(
                service_id,
                service_generation,
                phase.as_ref().map(|phase| phase.phase()),
                "request uncertain-launch emergency shutdown",
            )),
        }
    }

    /// Reissues or escalates the native stop request for an already-bound
    /// retained Stopping phase. Errors never move the process authority.
    pub fn request_retained_durable_service_stop(
        &self,
        service_id: &str,
        service_generation: u64,
        force: bool,
    ) -> Result<(), DurableServiceStoreError> {
        validate_retained_launch_key(service_id, service_generation)?;
        let mut launches = self
            .service_launches
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = launches
            .active
            .get_mut(&(service_id.to_owned(), service_generation))
            .ok_or_else(|| DurableServiceStoreError::RetainedLaunchNotFound {
                service_id: service_id.into(),
                generation: service_generation,
            })?;
        match entry.phase.as_mut() {
            Some(RetainedServiceAuthority::Stopping(process)) => {
                process.request_stop(force).map_err(Into::into)
            }
            phase => Err(RetainedServiceAuthorities::phase_mismatch(
                service_id,
                service_generation,
                phase.as_ref().map(|phase| phase.phase()),
                "request retained stop escalation",
            )),
        }
    }

    /// Consumes one exact, unexpired StartTree claim when trusted launch
    /// preparation fails before process creation is attempted. No StartTree
    /// authority is minted, no StopTree is fabricated, and the pending
    /// reservation plus all waiting leases are released atomically.
    pub fn finish_claimed_durable_service_start_preparation_failure(
        &self,
        claim: DurableServiceOutboxClaim,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceIntentTransitionError> {
        let result = (|| {
            self.require_service_scope(&claim.scope)?;
            validate_runtime_time(now_ms)?;
            let (service_id, generation) = match &claim.action {
                ServiceLeaseAction::StartTree {
                    service_id,
                    generation,
                } => (service_id.as_str(), *generation),
                ServiceLeaseAction::StopTree { .. } => {
                    return Err(DurableServiceStoreError::InvalidIntent(
                        "finish service preparation failure",
                    ));
                }
            };
            let mut connection = self
                .connection
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let persisted = query_outbox_fence_tx(&transaction, claim.intent_id)?
                .ok_or(DurableServiceStoreError::OutboxFenceMismatch)?;
            if persisted.state != OutboxState::Claimed
                || persisted.claim_epoch != claim.claim_epoch
                || persisted.claim_expires_at <= now_ms
                || persisted.action != claim.action
            {
                return Err(DurableServiceStoreError::OutboxFenceMismatch);
            }
            let service = query_service_tx(&transaction, service_id)?;
            require_monotonic_time(&service, now_ms)?;
            require_service_generation(&service, generation)?;
            if service.lifecycle_state != ServiceLifecycleState::Starting
                || service_reservation_state_tx(&transaction, service_id)? != Some("pending")
            {
                return Err(DurableServiceStoreError::CorruptService(service_id.into()));
            }
            let changed = transaction.execute(
                "UPDATE runtime_service_outbox
                 SET lifecycle_state='superseded', updated_at=?3
                 WHERE intent_id=?1 AND claim_epoch=?2 AND lifecycle_state='claimed'
                   AND claim_expires_at>?3 AND acked_at IS NULL",
                params![
                    claim.intent_id,
                    to_i64(claim.claim_epoch, "service intent claim epoch")?,
                    to_i64(now_ms, "service preparation failure time")?,
                ],
            )?;
            if changed != 1 {
                return Err(DurableServiceStoreError::OutboxFenceMismatch);
            }
            transaction.execute(
                "UPDATE runtime_service_leases SET lifecycle_state='released', released_at=?3,
                 release_reason='failure', updated_at=?3
                 WHERE service_id=?1 AND generation=?2
                   AND lifecycle_state IN ('pending','active')",
                params![
                    service_id,
                    to_i64(generation, "service generation")?,
                    to_i64(now_ms, "service preparation failure time")?,
                ],
            )?;
            let restart_terminal = durable_restart_terminal_state(&service, false, now_ms)?;
            let changed = transaction.execute(
                "UPDATE runtime_services SET lifecycle_state='failed', retry_required=0,
                 idle_due_at=NULL, last_error=?3, last_exited_generation=?2,
                 last_observed_at=?4, updated_at=?4,
                 restart_window_started_at=?5, restart_attempts_in_window=?6,
                 next_restart_at=NULL
                 WHERE service_id=?1 AND generation=?2 AND lifecycle_state='starting'",
                params![
                    service_id,
                    to_i64(generation, "service generation")?,
                    SERVICE_PREPARATION_FAILURE_MESSAGE,
                    to_i64(now_ms, "service preparation failure time")?,
                    restart_terminal
                        .window_started_at_ms
                        .map(|value| to_i64(value, "service restart window start"))
                        .transpose()?,
                    i64::from(restart_terminal.attempts_in_window),
                ],
            )?;
            if changed != 1 || !release_service_reservation_tx(&transaction, service_id, now_ms)? {
                return Err(DurableServiceStoreError::CorruptService(service_id.into()));
            }
            let snapshot = service_snapshot_tx(&transaction, service_id)?;
            transaction.commit()?;
            Ok(snapshot)
        })();
        result.map_err(|error| DurableServiceIntentTransitionError {
            claim: Box::new(claim),
            error,
        })
    }

    /// Clears only a terminal generation-less service failure for an explicit
    /// lifecycle-authority retry. It never touches a live/stopping tree and it
    /// does not itself create launch authority; the controller must run the
    /// ordinary eager/acquire admission path afterward.
    pub fn reset_durable_service_for_explicit_retry(
        &self,
        service_id: &str,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        validate_identifier("serviceId", service_id).map_err(ServiceLeaseError::from)?;
        validate_runtime_time(now_ms)?;
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let service = query_service_tx(&transaction, service_id)?;
        require_monotonic_time(&service, now_ms)?;
        if matches!(
            service.lifecycle_state,
            ServiceLifecycleState::Starting
                | ServiceLifecycleState::Ready
                | ServiceLifecycleState::Stopping
        ) {
            let snapshot = service_snapshot_tx(&transaction, service_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        let active_leases: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM runtime_service_leases
              WHERE service_id=?1 AND lifecycle_state IN ('pending','active')",
            params![service_id],
            |row| row.get(0),
        )?;
        let active_intents: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM runtime_service_outbox
              WHERE service_id=?1 AND lifecycle_state IN ('pending','claimed')",
            params![service_id],
            |row| row.get(0),
        )?;
        // Acknowledged StartTree/StopTree rows are immutable historical
        // authority and remain after a generation is proven terminal. They do
        // not block an explicit retry; the exact last-exited fence below does.
        // Only an unacknowledged intent or live lease can still create/mutate
        // authority after this transaction.
        let terminal_generation_is_fenced =
            service.generation == 0 || service.last_exited_generation == Some(service.generation);
        if active_leases != 0 || active_intents != 0 || !terminal_generation_is_fenced {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        clear_service_admission_block_tx(&transaction, service_id)?;
        let changed = transaction.execute(
            "UPDATE runtime_services
                SET lifecycle_state='available_but_stopped', retry_required=0,
                    acquisition_closed=0, idle_due_at=NULL, last_error=NULL,
                    restart_window_started_at=NULL, restart_attempts_in_window=0,
                    next_restart_at=NULL, last_observed_at=?2, updated_at=?2
              WHERE service_id=?1 AND lifecycle_state IN ('available_but_stopped','failed')",
            params![service_id, to_i64(now_ms, "service explicit retry time")?],
        )?;
        if changed != 1 {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        let snapshot = service_snapshot_tx(&transaction, service_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// Acknowledges one exact outbox claim. Start acknowledgement remains
    /// crate-private so process creation cannot be separated from its gate.
    /// epoch, while an expired/reclaimed or cross-store claim fails closed.
    pub(crate) fn acknowledge_durable_service_intent(
        &self,
        claim: DurableServiceOutboxClaim,
        now_ms: u64,
    ) -> Result<ServiceIntentAck, DurableServiceIntentTransitionError> {
        match self.acknowledge_durable_service_intent_inner(&claim, now_ms) {
            Ok(disposition) => {
                let authority = match claim.action {
                    ServiceLeaseAction::StartTree {
                        service_id,
                        generation,
                    } => AcknowledgedServiceIntent::Start(DurableServiceStartAuthority {
                        scope: claim.scope,
                        intent_id: claim.intent_id,
                        claim_epoch: claim.claim_epoch,
                        service_id,
                        generation,
                    }),
                    ServiceLeaseAction::StopTree {
                        service_id,
                        generation,
                        cause,
                    } => AcknowledgedServiceIntent::Stop(DurableServiceStopAuthority {
                        scope: claim.scope,
                        _intent_id: claim.intent_id,
                        _claim_epoch: claim.claim_epoch,
                        service_id,
                        generation,
                        cause,
                    }),
                };
                Ok(ServiceIntentAck {
                    disposition,
                    authority,
                })
            }
            Err(error) => Err(DurableServiceIntentTransitionError {
                claim: Box::new(claim),
                error,
            }),
        }
    }

    fn acknowledge_durable_service_intent_inner(
        &self,
        claim: &DurableServiceOutboxClaim,
        now_ms: u64,
    ) -> Result<ServiceIntentAckDisposition, DurableServiceStoreError> {
        self.require_service_scope(&claim.scope)?;
        validate_runtime_time(now_ms)?;
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let persisted = query_outbox_fence_tx(&transaction, claim.intent_id)?
            .ok_or(DurableServiceStoreError::OutboxFenceMismatch)?;
        if persisted.claim_epoch != claim.claim_epoch
            || persisted.action != claim.action
            || matches!(
                persisted.state,
                OutboxState::Pending | OutboxState::Superseded
            )
            || (persisted.state == OutboxState::Claimed && persisted.claim_expires_at <= now_ms)
        {
            return Err(DurableServiceStoreError::OutboxFenceMismatch);
        }
        let disposition = if persisted.state == OutboxState::Acked {
            ServiceIntentAckDisposition::AlreadyAcked
        } else {
            let changed = transaction.execute(
                "UPDATE runtime_service_outbox SET lifecycle_state='acked', acked_at=?3,
                 updated_at=?3 WHERE intent_id=?1 AND claim_epoch=?2
                 AND lifecycle_state='claimed' AND claim_expires_at>?3",
                params![
                    claim.intent_id,
                    to_i64(claim.claim_epoch, "service intent claim epoch")?,
                    to_i64(now_ms, "service intent ack time")?,
                ],
            )?;
            if changed != 1 {
                return Err(DurableServiceStoreError::OutboxFenceMismatch);
            }
            ServiceIntentAckDisposition::Acked
        };
        transaction.commit()?;
        Ok(disposition)
    }

    /// Settles a service reservation only when the sole acknowledged StartTree
    /// authority is paired with the matching process owner's accepted-started
    /// receipt. This deliberately does not mark HTTP readiness or activate
    /// leases; those are a separate, stronger transition.
    fn settle_durable_service_residency_inner(
        &self,
        authority: &DurableServiceStartAuthority,
        residency: &ProcessTreeResidency,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        self.require_service_scope(&authority.scope)?;
        validate_runtime_time(now_ms)?;
        if !residency.matches_generation_scope(&authority.scope)
            || residency.service_identity()
                != Some((authority.service_id.as_str(), authority.generation))
        {
            return Err(DurableServiceStoreError::OutboxFenceMismatch);
        }
        let service_id = authority.service_id.as_str();
        let generation = authority.generation;
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_acknowledged_start_authority_tx(&transaction, authority)?;
        let service = query_service_tx(&transaction, service_id)?;
        require_monotonic_time(&service, now_ms)?;
        require_service_generation(&service, generation)?;
        if service.lifecycle_state != ServiceLifecycleState::Starting {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        match service_reservation_state_tx(&transaction, service_id)? {
            Some("resident") => {
                let snapshot = service_snapshot_tx(&transaction, service_id)?;
                transaction.commit()?;
                return Ok(snapshot);
            }
            Some("pending") => {}
            _ => return Err(DurableServiceStoreError::CorruptService(service_id.into())),
        }
        settle_service_reservation_tx(&transaction, service_id, now_ms)?;
        transaction.execute(
            "UPDATE runtime_services SET last_observed_at=?3, updated_at=?3
             WHERE service_id=?1 AND generation=?2 AND lifecycle_state='starting'",
            params![
                service_id,
                to_i64(generation, "service generation")?,
                to_i64(now_ms, "service residency time")?,
            ],
        )?;
        let snapshot = service_snapshot_tx(&transaction, service_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// The production wrapper consumes a process-bound readiness authority.
    /// This inner transaction remains private so an acknowledged StartTree by
    /// itself can never be used by another crate to forge `Ready`.
    fn confirm_durable_service_ready_inner(
        &self,
        authority: &DurableServiceStartAuthority,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        self.require_service_scope(&authority.scope)?;
        validate_runtime_time(now_ms)?;
        let service_id = authority.service_id.as_str();
        let generation = authority.generation;
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_acknowledged_start_authority_tx(&transaction, authority)?;
        let service = query_service_tx(&transaction, service_id)?;
        require_monotonic_time(&service, now_ms)?;
        require_service_generation(&service, generation)?;
        if service.lifecycle_state == ServiceLifecycleState::Ready {
            if service_reservation_state_tx(&transaction, service_id)? != Some("resident") {
                return Err(DurableServiceStoreError::CorruptService(service_id.into()));
            }
            let snapshot = service_snapshot_tx(&transaction, service_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        if service.lifecycle_state != ServiceLifecycleState::Starting
            || service_reservation_state_tx(&transaction, service_id)? != Some("resident")
        {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        expire_service_leases_tx(&transaction, &service, now_ms)?;
        transaction.execute(
            "UPDATE runtime_service_leases SET lifecycle_state='active', updated_at=?3
             WHERE service_id=?1 AND generation=?2 AND lifecycle_state='pending'
               AND expires_at>?3",
            params![
                service_id,
                to_i64(generation, "service generation")?,
                to_i64(now_ms, "service ready time")?,
            ],
        )?;
        let changed = transaction.execute(
            "UPDATE runtime_services SET lifecycle_state='ready', retry_required=0,
             last_error=NULL, last_observed_at=?3, updated_at=?3
             WHERE service_id=?1 AND generation=?2 AND lifecycle_state='starting'",
            params![
                service_id,
                to_i64(generation, "service generation")?,
                to_i64(now_ms, "service ready time")?,
            ],
        )?;
        if changed != 1 {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        schedule_idle_if_eligible_tx(&transaction, service_id, now_ms)?;
        let snapshot = service_snapshot_tx(&transaction, service_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// Converts an exact retained starting generation whose trusted readiness
    /// deadline expired into one durable failure StopTree. The live process
    /// authority stays retained until the acknowledged stop is bound and a
    /// zero-resident receipt finalizes the failure.
    fn begin_durable_service_readiness_failure_stop_inner(
        &self,
        authority: &DurableServiceStartAuthority,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        self.require_service_scope(&authority.scope)?;
        validate_runtime_time(now_ms)?;
        let service_id = authority.service_id.as_str();
        let generation = authority.generation;
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_acknowledged_start_authority_tx(&transaction, authority)?;
        let service = query_service_tx(&transaction, service_id)?;
        require_monotonic_time(&service, now_ms)?;
        require_service_generation(&service, generation)?;

        if service.lifecycle_state == ServiceLifecycleState::Stopping {
            let existing = query_generation_stop_intent_tx(&transaction, service_id, generation)?;
            if matches!(existing, Some((ServiceStopCause::Failure, _)))
                || (service.acquisition_closed
                    && matches!(existing, Some((ServiceStopCause::Shutdown, _))))
            {
                let snapshot = service_snapshot_tx(&transaction, service_id)?;
                transaction.commit()?;
                return Ok(snapshot);
            }
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        if service.lifecycle_state != ServiceLifecycleState::Starting
            || service_reservation_state_tx(&transaction, service_id)? != Some("resident")
            || query_generation_stop_intent_tx(&transaction, service_id, generation)?.is_some()
        {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }

        transaction.execute(
            "UPDATE runtime_service_leases SET lifecycle_state='released', released_at=?3,
             release_reason='failure', updated_at=?3
             WHERE service_id=?1 AND generation=?2
               AND lifecycle_state IN ('pending','active')",
            params![
                service_id,
                to_i64(generation, "service generation")?,
                to_i64(now_ms, "service readiness failure time")?,
            ],
        )?;
        let changed = transaction.execute(
            "UPDATE runtime_services SET lifecycle_state='stopping', retry_required=0,
             idle_due_at=NULL, last_error=?3, last_observed_at=?4, updated_at=?4
             WHERE service_id=?1 AND generation=?2 AND lifecycle_state='starting'",
            params![
                service_id,
                to_i64(generation, "service generation")?,
                SERVICE_READINESS_TIMEOUT_MESSAGE,
                to_i64(now_ms, "service readiness failure time")?,
            ],
        )?;
        if changed != 1
            || !insert_service_intent_tx(
                &transaction,
                service_id,
                generation,
                "stop_tree",
                Some("failure"),
                now_ms,
            )?
        {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        let snapshot = service_snapshot_tx(&transaction, service_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// Finalizes a generation only from the sole StartTree authority and the
    /// matching OS-proven zero-resident receipt. Terminal state and public
    /// diagnostics are derived from that receipt, never caller-selected.
    fn finish_durable_service_tree_exit_inner(
        &self,
        authority: &DurableServiceStartAuthority,
        tree_exit: &ProcessTreeExit,
        accepted_stop: Option<ServiceStopCause>,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        self.require_service_scope(&authority.scope)?;
        validate_runtime_time(now_ms)?;
        if !tree_exit.matches_generation_scope(&authority.scope)
            || tree_exit.service_identity()
                != Some((authority.service_id.as_str(), authority.generation))
        {
            return Err(DurableServiceStoreError::OutboxFenceMismatch);
        }
        let (target_state, retry_required, release_reason, last_error) =
            service_exit_disposition(tree_exit, accepted_stop);
        self.finish_durable_service_generation_inner(
            authority,
            target_state,
            retry_required,
            release_reason,
            last_error,
            ServiceTerminalProofKind::TreeExit {
                started_boundary_accepted: tree_exit.started_boundary_accepted(),
                accepted_stop,
            },
            now_ms,
        )
    }

    /// Finalizes a StartTree attempt proven to have failed before any process
    /// was created. An uncertain creation has no conversion to this path.
    fn finish_durable_service_not_created_inner(
        &self,
        authority: &DurableServiceStartAuthority,
        error: &ProcessOwnerError,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        let last_error = service_not_created_message(error);
        self.finish_durable_service_generation_inner(
            authority,
            ServiceLifecycleState::Failed,
            true,
            ServiceLeaseReleaseReason::Failure,
            Some(last_error),
            ServiceTerminalProofKind::NotCreated,
            now_ms,
        )
    }

    // This is the sole finalization transaction. Its explicit proof, release,
    // failure, and restart inputs are intentionally not a freely constructible
    // public options object.
    #[allow(clippy::too_many_arguments)]
    fn finish_durable_service_generation_inner(
        &self,
        authority: &DurableServiceStartAuthority,
        target_state: ServiceLifecycleState,
        retry_required: bool,
        release_reason: ServiceLeaseReleaseReason,
        last_error: Option<&'static str>,
        proof_kind: ServiceTerminalProofKind,
        now_ms: u64,
    ) -> Result<DurableServiceSnapshot, DurableServiceStoreError> {
        self.require_service_scope(&authority.scope)?;
        validate_runtime_time(now_ms)?;
        let service_id = authority.service_id.as_str();
        let generation = authority.generation;
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        require_acknowledged_start_authority_tx(&transaction, authority)?;
        let service = query_service_tx(&transaction, service_id)?;
        require_monotonic_time(&service, now_ms)?;
        require_service_generation(&service, generation)?;
        let reservation_state = service_reservation_state_tx(&transaction, service_id)?;
        let restart_terminal = durable_restart_terminal_state(&service, retry_required, now_ms)?;
        if service.last_exited_generation == Some(generation) {
            if service.lifecycle_state != target_state
                || service.retry_required != restart_terminal.retry_required
                || service.last_error.as_deref() != last_error
            {
                return Err(DurableServiceStoreError::CorruptService(service_id.into()));
            }
            let snapshot = service_snapshot_tx(&transaction, service_id)?;
            transaction.commit()?;
            return Ok(snapshot);
        }
        match (proof_kind, reservation_state) {
            (ServiceTerminalProofKind::NotCreated, Some("pending")) => {}
            (
                ServiceTerminalProofKind::TreeExit {
                    started_boundary_accepted: false,
                    accepted_stop: None,
                },
                Some("pending"),
            ) => {}
            (
                ServiceTerminalProofKind::TreeExit {
                    started_boundary_accepted: true,
                    accepted_stop: None,
                },
                Some("pending" | "resident"),
            ) => {}
            (
                ServiceTerminalProofKind::TreeExit {
                    started_boundary_accepted: false,
                    accepted_stop: Some(_),
                },
                Some("pending"),
            ) if service.lifecycle_state == ServiceLifecycleState::Stopping => {}
            (
                ServiceTerminalProofKind::TreeExit {
                    started_boundary_accepted: true,
                    accepted_stop: Some(_),
                },
                Some("pending" | "resident"),
            ) if service.lifecycle_state == ServiceLifecycleState::Stopping => {}
            _ => return Err(DurableServiceStoreError::CorruptService(service_id.into())),
        }
        if !matches!(
            service.lifecycle_state,
            ServiceLifecycleState::Starting
                | ServiceLifecycleState::Ready
                | ServiceLifecycleState::Stopping
        ) {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        transaction.execute(
            "UPDATE runtime_service_leases SET lifecycle_state='released', released_at=?3,
             release_reason=?4, updated_at=?3
             WHERE service_id=?1 AND generation=?2
               AND lifecycle_state IN ('pending','active')",
            params![
                service_id,
                to_i64(generation, "service generation")?,
                to_i64(now_ms, "service tree exit time")?,
                release_reason_name(release_reason),
            ],
        )?;
        let changed = transaction.execute(
            "UPDATE runtime_services SET lifecycle_state=?3,
             retry_required=?4, idle_due_at=NULL, last_error=?5,
             last_exited_generation=?2, last_observed_at=?6, updated_at=?6,
             restart_window_started_at=?7, restart_attempts_in_window=?8,
             next_restart_at=?9
             WHERE service_id=?1 AND generation=?2
               AND lifecycle_state IN ('starting','ready','stopping')",
            params![
                service_id,
                to_i64(generation, "service generation")?,
                target_state.as_str(),
                if restart_terminal.retry_required {
                    1_i64
                } else {
                    0_i64
                },
                last_error,
                to_i64(now_ms, "service tree exit time")?,
                restart_terminal
                    .window_started_at_ms
                    .map(|value| to_i64(value, "service restart window start"))
                    .transpose()?,
                i64::from(restart_terminal.attempts_in_window),
                restart_terminal
                    .next_restart_at_ms
                    .map(|value| to_i64(value, "next service restart"))
                    .transpose()?,
            ],
        )?;
        if changed != 1 {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        if !release_service_reservation_tx(&transaction, service_id, now_ms)? {
            return Err(DurableServiceStoreError::CorruptService(service_id.into()));
        }
        supersede_unacked_service_intents_tx(&transaction, service_id, generation, now_ms)?;
        let snapshot = service_snapshot_tx(&transaction, service_id)?;
        transaction.commit()?;
        Ok(snapshot)
    }

    /// Closes job and service acquisition in one lock order, resolves every
    /// lease as cancelled, and transactionally publishes StopTree for each
    /// generation that may still own a process tree.
    pub fn begin_durable_service_shutdown(
        &self,
        now_ms: u64,
    ) -> Result<u32, DurableServiceStoreError> {
        validate_runtime_time(now_ms)?;
        self.generation_shutdown.store(true, Ordering::Release);
        let mut bootstrap_gate = self
            .trusted_service_bootstrap_open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *bootstrap_gate = false;
        let mut admission_gate = self
            .admission_open
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *admission_gate = false;
        let mut connection = self
            .connection
            .lock()
            .expect("runtime service store mutex poisoned");
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut statement =
            transaction.prepare("SELECT service_id FROM runtime_services ORDER BY service_id")?;
        let service_ids = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let mut stop_intents = 0_u32;
        for service_id in service_ids {
            let service = query_service_tx(&transaction, &service_id)?;
            require_monotonic_time(&service, now_ms)?;
            transaction.execute(
                "UPDATE runtime_service_leases SET lifecycle_state='released', released_at=?2,
                 release_reason='cancellation', updated_at=?2
                 WHERE service_id=?1 AND lifecycle_state IN ('pending','active')",
                params![service_id, to_i64(now_ms, "service shutdown time")?],
            )?;
            match service.lifecycle_state {
                ServiceLifecycleState::Starting => {
                    match query_generation_start_intent_state_tx(
                        &transaction,
                        &service_id,
                        service.generation,
                    )? {
                        Some(OutboxState::Pending | OutboxState::Claimed) => {
                            // A process cannot exist before StartTree is
                            // acknowledged: the acknowledged authority is the
                            // sole service creation capability. Shutdown can
                            // therefore cancel this generation without
                            // manufacturing an unbindable StopTree.
                            supersede_unacked_service_intents_tx(
                                &transaction,
                                &service_id,
                                service.generation,
                                now_ms,
                            )?;
                            let changed = transaction.execute(
                                "UPDATE runtime_services
                                 SET lifecycle_state='available_but_stopped',
                                     retry_required=0, acquisition_closed=1,
                                     idle_due_at=NULL, last_error=NULL,
                                     last_exited_generation=?2,
                                     last_observed_at=?3, updated_at=?3
                                 WHERE service_id=?1 AND generation=?2
                                   AND lifecycle_state='starting'",
                                params![
                                    service_id,
                                    to_i64(service.generation, "service generation")?,
                                    to_i64(now_ms, "service shutdown time")?,
                                ],
                            )?;
                            if changed != 1
                                || !release_service_reservation_tx(
                                    &transaction,
                                    &service_id,
                                    now_ms,
                                )?
                            {
                                return Err(DurableServiceStoreError::CorruptService(service_id));
                            }
                            continue;
                        }
                        Some(OutboxState::Acked) => {}
                        Some(OutboxState::Superseded) | None => {
                            return Err(DurableServiceStoreError::CorruptService(service_id));
                        }
                    }
                    transaction.execute(
                        "UPDATE runtime_services SET lifecycle_state='stopping',
                         acquisition_closed=1, idle_due_at=NULL, last_observed_at=?3,
                         updated_at=?3 WHERE service_id=?1 AND generation=?2",
                        params![
                            service_id,
                            to_i64(service.generation, "service generation")?,
                            to_i64(now_ms, "service shutdown time")?,
                        ],
                    )?;
                    if insert_service_intent_tx(
                        &transaction,
                        &service_id,
                        service.generation,
                        "stop_tree",
                        Some("shutdown"),
                        now_ms,
                    )? {
                        stop_intents = stop_intents.saturating_add(1);
                    }
                }
                ServiceLifecycleState::Ready => {
                    if query_generation_start_intent_state_tx(
                        &transaction,
                        &service_id,
                        service.generation,
                    )? != Some(OutboxState::Acked)
                    {
                        return Err(DurableServiceStoreError::CorruptService(service_id));
                    }
                    transaction.execute(
                        "UPDATE runtime_services SET lifecycle_state='stopping',
                         acquisition_closed=1, idle_due_at=NULL, last_observed_at=?3,
                         updated_at=?3 WHERE service_id=?1 AND generation=?2",
                        params![
                            service_id,
                            to_i64(service.generation, "service generation")?,
                            to_i64(now_ms, "service shutdown time")?,
                        ],
                    )?;
                    if insert_service_intent_tx(
                        &transaction,
                        &service_id,
                        service.generation,
                        "stop_tree",
                        Some("shutdown"),
                        now_ms,
                    )? {
                        stop_intents = stop_intents.saturating_add(1);
                    }
                }
                ServiceLifecycleState::Stopping => {
                    transaction.execute(
                        "UPDATE runtime_services SET acquisition_closed=1, idle_due_at=NULL,
                         last_observed_at=?2, updated_at=?2 WHERE service_id=?1",
                        params![service_id, to_i64(now_ms, "service shutdown time")?],
                    )?;
                }
                ServiceLifecycleState::Failed => {
                    transaction.execute(
                        "UPDATE runtime_services SET acquisition_closed=1, idle_due_at=NULL,
                         last_observed_at=?2, updated_at=?2 WHERE service_id=?1",
                        params![service_id, to_i64(now_ms, "service shutdown time")?],
                    )?;
                    release_service_reservation_tx(&transaction, &service_id, now_ms)?;
                }
                ServiceLifecycleState::AvailableButStopped => {
                    transaction.execute(
                        "UPDATE runtime_services SET acquisition_closed=1, idle_due_at=NULL,
                         last_observed_at=?2, updated_at=?2 WHERE service_id=?1",
                        params![service_id, to_i64(now_ms, "service shutdown time")?],
                    )?;
                    release_service_reservation_tx(&transaction, &service_id, now_ms)?;
                }
            }
        }
        transaction.commit()?;
        Ok(stop_intents)
    }

    fn require_service_scope(
        &self,
        scope: &RuntimeGenerationScope,
    ) -> Result<(), DurableServiceStoreError> {
        if scope == &self.generation_scope {
            Ok(())
        } else {
            Err(StoreError::GenerationAuthorityMismatch.into())
        }
    }
}
