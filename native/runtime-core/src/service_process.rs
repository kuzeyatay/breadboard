//! Durable service-generation authority coupled to native process ownership.
//!
//! A service process may only be created by consuming an acknowledged
//! `StartTree` authority.  That same non-cloneable authority remains attached
//! to the exact live process until a zero-resident tree-exit receipt exists.
//! Normal stop requests additionally consume the matching acknowledged
//! `StopTree` authority, but that authority can never finalize an exit by
//! itself.

use crate::process_owner::{
    prepare_claimed_service_launch, LoopbackListenerOwnership, ProcessCreationUncertain,
    ProcessSpawnAttempt, TrustedProcessLaunch,
};
use crate::service_store::{DurableServiceStartAuthority, DurableServiceStopAuthority};
use crate::{
    CurrentGenerationMembership, ProcessOwnerError, ProcessOwnerEvent, ProcessOwnerTerminal,
    ProcessTreeExit, ProcessTreeResidency, RunningProcessOwner, RuntimeGenerationScope,
    ServiceLaunchRequest, ServiceStopCause,
};
use breadboard_runtime_protocol::ServiceHttpReadiness;
use std::fmt;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, Instant};

const MAX_SERVICE_READINESS_RESPONSE_BYTES: usize = 64 * 1024;

struct ServiceReadinessBinding {
    port: u16,
    readiness: ServiceHttpReadiness,
    authorization: Option<String>,
    startup_deadline: Option<Instant>,
}

impl ServiceReadinessBinding {
    fn from_request(request: &ServiceLaunchRequest) -> Self {
        let (port, readiness, authorization) = request.readiness_binding();
        Self {
            port,
            readiness,
            authorization,
            startup_deadline: None,
        }
    }

    fn activate(mut self) -> Self {
        self.startup_deadline =
            Instant::now().checked_add(Duration::from_millis(self.readiness.startup_timeout_ms));
        self
    }

    fn deadline(&self) -> Option<Instant> {
        self.startup_deadline
    }
}

enum ServiceLaunchRetryMaterial {
    Request(ServiceLaunchRequest),
    Prepared {
        launch: Box<TrustedProcessLaunch>,
        readiness: ServiceReadinessBinding,
    },
}

/// Exhaustive result of consuming one acknowledged durable `StartTree`
/// authority at the sole service process-creation boundary.
#[must_use = "every service launch outcome owns durable or live process authority and must be handled"]
pub enum ServiceLaunchOutcome {
    Running(Box<ClaimedServiceProcess>),
    NotCreated(ServiceLaunchNotCreated),
    Uncertain(ServiceLaunchUncertain),
}

impl fmt::Debug for ServiceLaunchOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Running(_) => formatter.write_str("ServiceLaunchOutcome::Running(<opaque>)"),
            Self::NotCreated(_) => {
                formatter.write_str("ServiceLaunchOutcome::NotCreated(<opaque>)")
            }
            Self::Uncertain(_) => formatter.write_str("ServiceLaunchOutcome::Uncertain(<opaque>)"),
        }
    }
}

/// Proof that a launch failed before the OS created any process.  It retains
/// both the exact Start authority and all material required for a one-shot
/// retry, so reservation-release authority cannot coexist with a later live
/// tree produced from the same durable intent.
#[must_use = "no-process-created authority must be retried or durably finalized"]
pub struct ServiceLaunchNotCreated {
    start: Box<DurableServiceStartAuthority>,
    retry: Option<ServiceLaunchRetryMaterial>,
    error: ProcessOwnerError,
}

impl fmt::Debug for ServiceLaunchNotCreated {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.start, &self.retry);
        formatter
            .debug_struct("ServiceLaunchNotCreated")
            .field("authority", &"<opaque no-process-created authority>")
            .field("error", &self.error)
            .finish()
    }
}

impl ServiceLaunchNotCreated {
    pub fn service_id(&self) -> &str {
        self.start.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.start.generation()
    }

    pub(crate) fn parts(&self) -> (&DurableServiceStartAuthority, &ProcessOwnerError) {
        (self.start.as_ref(), &self.error)
    }

    /// Performs the single retry retained by the initial no-process-created
    /// outcome. A second failure remains finalizable but cannot recursively
    /// mint another retry and bypass durable restart/backoff policy.
    pub(crate) fn retry(
        mut self,
        generation: &CurrentGenerationMembership,
    ) -> Result<ServiceLaunchOutcome, Box<Self>> {
        let Some(retry) = self.retry.take() else {
            return Err(Box::new(self));
        };
        let Self {
            start,
            retry: _,
            error: _,
        } = self;
        Ok(match retry {
            ServiceLaunchRetryMaterial::Request(request) => {
                launch_request(start, generation, request, false)
            }
            ServiceLaunchRetryMaterial::Prepared { launch, readiness } => {
                launch_prepared(start, generation, launch, readiness, false)
            }
        })
    }
}

/// A transition failure that returns the complete authority to its caller.
/// Event timeouts, reap delays, receipt mismatches, and other transient errors
/// therefore cannot silently drop the sole durable/live capability.
#[must_use = "transition errors retain authority and must be recovered or terminated"]
pub struct ServiceProcessTransitionError<A> {
    authority: Box<A>,
    error: ProcessOwnerError,
}

impl<A> fmt::Debug for ServiceProcessTransitionError<A> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ServiceProcessTransitionError")
            .field("authority", &"<opaque retained authority>")
            .field("error", &self.error)
            .finish()
    }
}

impl<A> ServiceProcessTransitionError<A> {
    pub fn into_parts(self) -> (A, ProcessOwnerError) {
        (*self.authority, self.error)
    }
}

struct LiveServiceProcess {
    start: Box<DurableServiceStartAuthority>,
    generation_scope: RuntimeGenerationScope,
    owner: Box<RunningProcessOwner>,
    readiness: ServiceReadinessBinding,
    pending_exit: Option<ProcessTreeExit>,
}

impl fmt::Debug for LiveServiceProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (
            &self.start,
            &self.generation_scope,
            &self.owner,
            &self.readiness.port,
            &self.pending_exit,
        );
        formatter.write_str("LiveServiceProcess(<opaque coupled authority and owner>)")
    }
}

impl LiveServiceProcess {
    fn service_id(&self) -> &str {
        self.start.service_id()
    }

    fn generation(&self) -> u64 {
        self.start.generation()
    }

    fn validate_start_binding(&self) -> Result<(), ProcessOwnerError> {
        if self.start.matches_generation_scope(&self.generation_scope) {
            Ok(())
        } else {
            Err(ProcessOwnerError::GenerationScopeMismatch)
        }
    }

    fn validate_residency(
        &self,
        residency: &ProcessTreeResidency,
    ) -> Result<(), ProcessOwnerError> {
        self.validate_start_binding()?;
        if !residency.matches_generation_scope(&self.generation_scope) {
            return Err(ProcessOwnerError::GenerationScopeMismatch);
        }
        if residency.service_identity() != Some((self.service_id(), self.generation())) {
            return Err(ProcessOwnerError::InvalidLaunch(
                "service residency did not match its durable StartTree authority",
            ));
        }
        Ok(())
    }

    fn validate_exit(&self, tree_exit: &ProcessTreeExit) -> Result<(), ProcessOwnerError> {
        self.validate_start_binding()?;
        if !tree_exit.matches_generation_scope(&self.generation_scope) {
            return Err(ProcessOwnerError::GenerationScopeMismatch);
        }
        if tree_exit.service_identity() != Some((self.service_id(), self.generation())) {
            return Err(ProcessOwnerError::InvalidLaunch(
                "service tree-exit receipt did not match its durable StartTree authority",
            ));
        }
        Ok(())
    }

    fn confirm_exit(
        &mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ProcessTreeExit, ProcessOwnerError> {
        if self.pending_exit.is_none() {
            self.pending_exit = Some(self.owner.confirm_exit(terminal)?);
        }
        let tree_exit = self
            .pending_exit
            .as_ref()
            .expect("confirmed service exit receipt must be retained");
        self.validate_exit(tree_exit)?;
        Ok(self
            .pending_exit
            .take()
            .expect("validated service exit receipt must be retained"))
    }

    /// The supervision-lost mirror of [`Self::confirm_exit`]. It shares the
    /// retained-receipt and scope-validation discipline; only the proof of zero
    /// residency differs, and that difference lives entirely in
    /// `RunningProcessOwner::confirm_supervision_lost`.
    fn confirm_supervision_lost(&mut self) -> Result<ProcessTreeExit, ProcessOwnerError> {
        if self.pending_exit.is_none() {
            self.pending_exit = Some(self.owner.confirm_supervision_lost()?);
        }
        let tree_exit = self
            .pending_exit
            .as_ref()
            .expect("confirmed service exit receipt must be retained");
        self.validate_exit(tree_exit)?;
        Ok(self
            .pending_exit
            .take()
            .expect("validated service exit receipt must be retained"))
    }
}

/// A StartTree-owned service whose supervisor was created.  The exact native
/// owner remains inseparable from the durable Start authority until residency
/// or zero-resident exit is settled.
#[must_use = "a claimed service must settle residency or reach exact tree exit"]
pub struct ClaimedServiceProcess {
    live: LiveServiceProcess,
    pending_residency: Option<ProcessTreeResidency>,
}

impl fmt::Debug for ClaimedServiceProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.live, &self.pending_residency);
        formatter.write_str("ClaimedServiceProcess(<opaque StartTree and live owner>)")
    }
}

impl ClaimedServiceProcess {
    pub fn service_id(&self) -> &str {
        self.live.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.live.generation()
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.live.owner.supervisor_pid()
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.live.owner.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.live.owner.read_event(timeout)
    }

    pub fn into_residency(
        mut self,
    ) -> Result<ServiceResidencyAuthority, ServiceProcessTransitionError<Self>> {
        if self.pending_residency.is_none() {
            match self.live.owner.take_process_tree_residency() {
                Ok(residency) => self.pending_residency = Some(residency),
                Err(error) => {
                    return Err(ServiceProcessTransitionError {
                        authority: Box::new(self),
                        error,
                    });
                }
            }
        }
        if let Err(error) = self.live.validate_residency(
            self.pending_residency
                .as_ref()
                .expect("taken service residency must be retained"),
        ) {
            return Err(ServiceProcessTransitionError {
                authority: Box::new(self),
                error,
            });
        }
        let residency = self
            .pending_residency
            .take()
            .expect("validated service residency must be retained");
        Ok(ServiceResidencyAuthority {
            process: self,
            residency,
        })
    }

    pub fn confirm_exit(
        mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_exit(terminal) {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }

    pub fn confirm_supervision_lost(
        mut self,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_supervision_lost() {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }
}

/// Exact StartTree + accepted-started authority awaiting the durable
/// pending-to-starting transition.
#[must_use = "service residency authority must be durably settled"]
pub struct ServiceResidencyAuthority {
    process: ClaimedServiceProcess,
    residency: ProcessTreeResidency,
}

impl fmt::Debug for ServiceResidencyAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.process, &self.residency);
        formatter.write_str("ServiceResidencyAuthority(<opaque StartTree and residency proof>)")
    }
}

impl ServiceResidencyAuthority {
    pub fn service_id(&self) -> &str {
        self.process.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.process.generation()
    }

    pub(crate) fn supervisor_pid(&self) -> u32 {
        self.process.supervisor_pid()
    }

    pub(crate) fn root_pid(&self) -> Option<u32> {
        self.process.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.process.read_event(timeout)
    }

    pub fn confirm_exit(
        self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let mut authority = self;
        let tree_exit = match authority.process.live.confirm_exit(terminal) {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(authority),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: authority.process.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }

    pub fn confirm_supervision_lost(
        self,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let mut authority = self;
        let tree_exit = match authority.process.live.confirm_supervision_lost() {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(authority),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: authority.process.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }

    pub(crate) fn parts(&self) -> (&DurableServiceStartAuthority, &ProcessTreeResidency) {
        (self.process.live.start.as_ref(), &self.residency)
    }

    /// Called only after the durable store atomically accepts `parts()` as the
    /// resident process for this generation.
    pub(crate) fn into_starting(self) -> StartingServiceProcess {
        debug_assert!(self
            .process
            .live
            .validate_residency(&self.residency)
            .is_ok());
        StartingServiceProcess {
            live: self.process.live,
        }
    }
}

/// An accepted-started service which has not yet crossed its private health
/// readiness boundary.  It retains the sole StartTree authority and owner.
#[must_use = "a starting service must become resident or reach exact tree exit"]
pub struct StartingServiceProcess {
    live: LiveServiceProcess,
}

impl fmt::Debug for StartingServiceProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = &self.live;
        formatter.write_str("StartingServiceProcess(<opaque StartTree and live owner>)")
    }
}

impl StartingServiceProcess {
    pub fn service_id(&self) -> &str {
        self.live.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.live.generation()
    }

    /// Keeps failure transitions coupled to the sole acknowledged StartTree
    /// authority while the process remains retained by runtime-core.
    pub(crate) fn start_authority(&self) -> &DurableServiceStartAuthority {
        self.live.start.as_ref()
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.live.owner.supervisor_pid()
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.live.owner.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.live.owner.read_event(timeout)
    }

    /// Performs one bounded loopback HTTP readiness probe using only the port
    /// and readiness contract selected by the trusted Registry. Consuming and
    /// returning the complete process on every non-ready outcome prevents a
    /// caller from retaining the live owner while replaying a stale success.
    pub fn probe_readiness(mut self) -> ServiceReadinessProbeOutcome {
        let Some(deadline) = self.live.readiness.deadline() else {
            return ServiceReadinessProbeOutcome::TimedOut(self);
        };
        if Instant::now() >= deadline {
            return ServiceReadinessProbeOutcome::TimedOut(self);
        }
        match self.live.owner.supervisor_has_exited() {
            Ok(true) => return ServiceReadinessProbeOutcome::ProcessExited(self),
            Err(_) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::SupervisorStateUnavailable,
                    deadline,
                );
            }
            Ok(false) => {}
        }
        // Bind the HTTP exchange on both sides to one exact Job-resident PID.
        // A listener that disappears, changes owner, or is replaced between
        // the two observations cannot mint ready authority.
        let ownership_timeout =
            Duration::from_millis(self.live.readiness.readiness.request_timeout_ms)
                .min(deadline.saturating_duration_since(Instant::now()));
        if ownership_timeout.is_zero() {
            return ServiceReadinessProbeOutcome::TimedOut(self);
        }
        let owner_pid = match self
            .live
            .owner
            .inspect_loopback_listener_ownership(self.live.readiness.port, ownership_timeout)
        {
            Ok(LoopbackListenerOwnership::Owned(owner_pid)) => owner_pid,
            Ok(LoopbackListenerOwnership::Unowned(_)) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::ListenerNotOwned,
                    deadline,
                );
            }
            Ok(LoopbackListenerOwnership::Absent) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::ListenerAbsent,
                    deadline,
                );
            }
            Ok(LoopbackListenerOwnership::Unavailable)
            | Err(ProcessOwnerError::EventWaitTimeout) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::ListenerOwnershipUnavailable,
                    deadline,
                );
            }
            Ok(LoopbackListenerOwnership::ProcessExited) => {
                return ServiceReadinessProbeOutcome::ProcessExited(self);
            }
            Err(_) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::SupervisorStateUnavailable,
                    deadline,
                );
            }
        };

        let probe = probe_loopback_http_readiness(
            self.live.readiness.port,
            &self.live.readiness.readiness,
            self.live.readiness.authorization.as_deref(),
            deadline,
        );
        if let Err(reason) = probe {
            return readiness_pending(self, reason, deadline);
        }

        let ownership_timeout =
            Duration::from_millis(self.live.readiness.readiness.request_timeout_ms)
                .min(deadline.saturating_duration_since(Instant::now()));
        if ownership_timeout.is_zero() {
            return ServiceReadinessProbeOutcome::TimedOut(self);
        }
        match self
            .live
            .owner
            .inspect_loopback_listener_ownership(self.live.readiness.port, ownership_timeout)
        {
            Ok(LoopbackListenerOwnership::Owned(observed_pid)) if observed_pid == owner_pid => {}
            Ok(LoopbackListenerOwnership::Owned(_)) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::ListenerOwnerChanged,
                    deadline,
                );
            }
            Ok(LoopbackListenerOwnership::Unowned(_)) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::ListenerNotOwned,
                    deadline,
                );
            }
            Ok(LoopbackListenerOwnership::Absent) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::ListenerAbsent,
                    deadline,
                );
            }
            Ok(LoopbackListenerOwnership::Unavailable)
            | Err(ProcessOwnerError::EventWaitTimeout) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::ListenerOwnershipUnavailable,
                    deadline,
                );
            }
            Ok(LoopbackListenerOwnership::ProcessExited) => {
                return ServiceReadinessProbeOutcome::ProcessExited(self);
            }
            Err(_) => {
                return readiness_pending(
                    self,
                    ServiceReadinessPendingReason::SupervisorStateUnavailable,
                    deadline,
                );
            }
        }
        match self.live.owner.supervisor_has_exited() {
            Ok(false) => {
                ServiceReadinessProbeOutcome::Ready(ServiceReadyAuthority { process: self })
            }
            Ok(true) => ServiceReadinessProbeOutcome::ProcessExited(self),
            Err(_) => readiness_pending(
                self,
                ServiceReadinessPendingReason::SupervisorStateUnavailable,
                deadline,
            ),
        }
    }

    pub fn confirm_exit(
        mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_exit(terminal) {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }

    pub fn confirm_supervision_lost(
        mut self,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_supervision_lost() {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceReadinessPendingReason {
    ConnectionUnavailable,
    RequestFailed,
    ResponseTooLarge,
    InvalidResponse,
    UnexpectedStatus,
    BodyMismatch,
    ListenerAbsent,
    ListenerNotOwned,
    ListenerOwnerChanged,
    ListenerOwnershipUnavailable,
    SupervisorStateUnavailable,
}

/// One probe consumes the full starting-process authority and returns it in
/// exactly one state. Only the `Ready` variant can cross the durable ready
/// transaction; a timeout or exited supervisor still owns the process needed
/// for exact cleanup and tree-exit proof.
#[must_use = "readiness outcomes retain the sole live service authority"]
pub enum ServiceReadinessProbeOutcome {
    Ready(ServiceReadyAuthority),
    Pending {
        process: StartingServiceProcess,
        retry_after: Duration,
        reason: ServiceReadinessPendingReason,
    },
    TimedOut(StartingServiceProcess),
    ProcessExited(StartingServiceProcess),
}

impl fmt::Debug for ServiceReadinessProbeOutcome {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Ready(_) => formatter.write_str("ServiceReadinessProbeOutcome::Ready(<opaque>)"),
            Self::Pending {
                retry_after,
                reason,
                ..
            } => formatter
                .debug_struct("ServiceReadinessProbeOutcome::Pending")
                .field("retry_after", retry_after)
                .field("reason", reason)
                .field("process", &"<opaque>")
                .finish(),
            Self::TimedOut(_) => {
                formatter.write_str("ServiceReadinessProbeOutcome::TimedOut(<opaque>)")
            }
            Self::ProcessExited(_) => {
                formatter.write_str("ServiceReadinessProbeOutcome::ProcessExited(<opaque>)")
            }
        }
    }
}

/// Exact live service authority after the core-owned HTTP checker accepted the
/// Registry-selected readiness contract. Construction is private, so neither
/// a control request nor a copied URL can manufacture durable `Ready` state.
#[must_use = "ready authority must be atomically committed or retained"]
pub struct ServiceReadyAuthority {
    process: StartingServiceProcess,
}

impl fmt::Debug for ServiceReadyAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = &self.process;
        formatter.write_str("ServiceReadyAuthority(<opaque live process and health proof>)")
    }
}

impl ServiceReadyAuthority {
    pub fn service_id(&self) -> &str {
        self.process.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.process.generation()
    }

    pub(crate) fn supervisor_pid(&self) -> u32 {
        self.process.supervisor_pid()
    }

    pub(crate) fn root_pid(&self) -> Option<u32> {
        self.process.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.process.read_event(timeout)
    }

    pub fn confirm_exit(
        self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let mut authority = self;
        let tree_exit = match authority.process.live.confirm_exit(terminal) {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(authority),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: authority.process.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }

    pub fn confirm_supervision_lost(
        self,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let mut authority = self;
        let tree_exit = match authority.process.live.confirm_supervision_lost() {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(authority),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: authority.process.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }

    pub(crate) fn start_authority(&self) -> &DurableServiceStartAuthority {
        self.process.live.start.as_ref()
    }

    pub(crate) fn into_resident(self) -> ResidentServiceProcess {
        ResidentServiceProcess {
            live: self.process.live,
        }
    }
}

/// A health-confirmed resident service.  The original StartTree authority is
/// retained until the exact process tree exits.
#[must_use = "a resident service must reach exact process-tree exit"]
pub struct ResidentServiceProcess {
    live: LiveServiceProcess,
}

impl fmt::Debug for ResidentServiceProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = &self.live;
        formatter.write_str("ResidentServiceProcess(<opaque StartTree and live owner>)")
    }
}

impl ResidentServiceProcess {
    pub fn service_id(&self) -> &str {
        self.live.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.live.generation()
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.live.owner.supervisor_pid()
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.live.owner.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.live.owner.read_event(timeout)
    }

    pub fn confirm_exit(
        mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_exit(terminal) {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }

    pub fn confirm_supervision_lost(
        mut self,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_supervision_lost() {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: None,
        })
    }
}

/// Exact StartTree + zero-resident process-tree receipt.  A StopTree authority
/// is never sufficient to construct this value.
#[must_use = "service tree-exit authority must be durably finalized"]
pub struct ServiceTreeExitAuthority {
    start: Box<DurableServiceStartAuthority>,
    tree_exit: ProcessTreeExit,
    accepted_stop: Option<ServiceStopCause>,
}

impl fmt::Debug for ServiceTreeExitAuthority {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.start, &self.tree_exit, &self.accepted_stop);
        formatter.write_str("ServiceTreeExitAuthority(<opaque StartTree and exit receipt>)")
    }
}

impl ServiceTreeExitAuthority {
    pub fn service_id(&self) -> &str {
        self.start.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.start.generation()
    }

    pub(crate) fn parts(
        &self,
    ) -> (
        &DurableServiceStartAuthority,
        &ProcessTreeExit,
        Option<ServiceStopCause>,
    ) {
        (self.start.as_ref(), &self.tree_exit, self.accepted_stop)
    }
}

/// A process may exist, but setup failed before the ordinary owner protocol
/// became authoritative.  This value retains the exact StartTree authority
/// and cleanup handle and intentionally offers no reservation-release or
/// tree-exit conversion.
#[must_use = "an uncertain service launch requires bounded cleanup and runtime restart"]
pub struct ServiceLaunchUncertain {
    start: Box<DurableServiceStartAuthority>,
    owner: Box<ProcessCreationUncertain>,
}

impl fmt::Debug for ServiceLaunchUncertain {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.start, &self.owner);
        formatter.write_str("ServiceLaunchUncertain(<opaque StartTree and cleanup authority>)")
    }
}

impl ServiceLaunchUncertain {
    pub fn service_id(&self) -> &str {
        self.start.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.start.generation()
    }

    /// The sole available operation is bounded emergency termination.  The
    /// runtime must retain this object through shutdown and let the next
    /// generation's containment drain reconcile the pending durable attempt.
    pub fn request_runtime_shutdown(&mut self) {
        self.owner.request_emergency_termination();
    }
}

/// A failed StopTree binding/write returns both the live process and the sole
/// StopTree authority.  The caller may retry without acknowledging a second
/// durable stop intent or losing live ownership.
#[must_use = "failed stop transitions retain both authorities and must be handled"]
pub struct ServiceStopTransitionError<P> {
    process: Box<P>,
    stop: Box<DurableServiceStopAuthority>,
    error: ProcessOwnerError,
}

impl<P> fmt::Debug for ServiceStopTransitionError<P> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ServiceStopTransitionError")
            .field("process", &"<opaque retained live authority>")
            .field("stop", &"<opaque retained StopTree authority>")
            .field("error", &self.error)
            .finish()
    }
}

impl<P> ServiceStopTransitionError<P> {
    pub fn into_parts(self) -> (P, DurableServiceStopAuthority, ProcessOwnerError) {
        (*self.process, *self.stop, self.error)
    }
}

/// A service with an exact acknowledged StopTree request written to the exact
/// live owner.  It retains Start + Stop + owner until zero-resident exit is
/// proven; the Stop authority itself cannot mint or finalize that receipt.
#[must_use = "a stopping service must reach exact process-tree exit"]
pub struct StoppingServiceProcess {
    live: LiveServiceProcess,
    stop: Box<DurableServiceStopAuthority>,
}

impl fmt::Debug for StoppingServiceProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.live, &self.stop);
        formatter.write_str("StoppingServiceProcess(<opaque StartTree, StopTree, and live owner>)")
    }
}

impl StoppingServiceProcess {
    pub fn service_id(&self) -> &str {
        self.live.service_id()
    }

    pub fn generation(&self) -> u64 {
        self.live.generation()
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.live.owner.supervisor_pid()
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.live.owner.root_pid()
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        self.live.owner.read_event(timeout)
    }

    /// Allows bounded escalation while retaining the same acknowledged Stop
    /// authority and exact process owner.
    pub fn request_stop(&mut self, force: bool) -> Result<(), ProcessOwnerError> {
        self.live.owner.request_stop(force)
    }

    pub fn confirm_exit(
        mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_exit(terminal) {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        let accepted_stop = self.stop.cause();
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: Some(accepted_stop),
        })
    }

    pub fn confirm_supervision_lost(
        mut self,
    ) -> Result<ServiceTreeExitAuthority, ServiceProcessTransitionError<Self>> {
        let tree_exit = match self.live.confirm_supervision_lost() {
            Ok(tree_exit) => tree_exit,
            Err(error) => {
                return Err(ServiceProcessTransitionError {
                    authority: Box::new(self),
                    error,
                });
            }
        };
        // The acknowledged StopTree is still the exact fence this generation
        // was stopped under, even though the supervisor never reported the
        // outcome; the receipt's `SupervisorFailure` classification is what
        // keeps `service_exit_disposition` from reading it as a clean stop.
        let accepted_stop = self.stop.cause();
        Ok(ServiceTreeExitAuthority {
            start: self.live.start,
            tree_exit,
            accepted_stop: Some(accepted_stop),
        })
    }
}

impl DurableServiceStartAuthority {
    pub(crate) fn launch(
        self,
        generation: &CurrentGenerationMembership,
        request: ServiceLaunchRequest,
    ) -> ServiceLaunchOutcome {
        launch_request(Box::new(self), generation, request, true)
    }
}

impl DurableServiceStopAuthority {
    pub fn request_claimed_stop(
        self,
        mut process: ClaimedServiceProcess,
        force: bool,
    ) -> Result<StoppingServiceProcess, ServiceStopTransitionError<ClaimedServiceProcess>> {
        let stop = Box::new(self);
        let binding_result = validate_stop_binding(stop.as_ref(), &process.live)
            .and_then(|_| process.live.owner.request_stop(force));
        if let Err(error) = binding_result {
            return Err(ServiceStopTransitionError {
                process: Box::new(process),
                stop,
                error,
            });
        }
        Ok(StoppingServiceProcess {
            live: process.live,
            stop,
        })
    }

    pub fn request_residency_stop(
        self,
        mut process: ServiceResidencyAuthority,
        force: bool,
    ) -> Result<StoppingServiceProcess, ServiceStopTransitionError<ServiceResidencyAuthority>> {
        let stop = Box::new(self);
        let binding_result = validate_stop_binding(stop.as_ref(), &process.process.live)
            .and_then(|_| process.process.live.owner.request_stop(force));
        if let Err(error) = binding_result {
            return Err(ServiceStopTransitionError {
                process: Box::new(process),
                stop,
                error,
            });
        }
        Ok(StoppingServiceProcess {
            live: process.process.live,
            stop,
        })
    }

    pub fn request_starting_stop(
        self,
        mut process: StartingServiceProcess,
        force: bool,
    ) -> Result<StoppingServiceProcess, ServiceStopTransitionError<StartingServiceProcess>> {
        let stop = Box::new(self);
        let binding_result = validate_stop_binding(stop.as_ref(), &process.live)
            .and_then(|_| process.live.owner.request_stop(force));
        if let Err(error) = binding_result {
            return Err(ServiceStopTransitionError {
                process: Box::new(process),
                stop,
                error,
            });
        }
        Ok(StoppingServiceProcess {
            live: process.live,
            stop,
        })
    }

    pub fn request_resident_stop(
        self,
        mut process: ResidentServiceProcess,
        force: bool,
    ) -> Result<StoppingServiceProcess, ServiceStopTransitionError<ResidentServiceProcess>> {
        let stop = Box::new(self);
        let binding_result = validate_stop_binding(stop.as_ref(), &process.live)
            .and_then(|_| process.live.owner.request_stop(force));
        if let Err(error) = binding_result {
            return Err(ServiceStopTransitionError {
                process: Box::new(process),
                stop,
                error,
            });
        }
        Ok(StoppingServiceProcess {
            live: process.live,
            stop,
        })
    }

    pub fn request_ready_stop(
        self,
        mut process: ServiceReadyAuthority,
        force: bool,
    ) -> Result<StoppingServiceProcess, ServiceStopTransitionError<ServiceReadyAuthority>> {
        let stop = Box::new(self);
        let binding_result = validate_stop_binding(stop.as_ref(), &process.process.live)
            .and_then(|_| process.process.live.owner.request_stop(force));
        if let Err(error) = binding_result {
            return Err(ServiceStopTransitionError {
                process: Box::new(process),
                stop,
                error,
            });
        }
        Ok(StoppingServiceProcess {
            live: process.process.live,
            stop,
        })
    }
}

fn validate_stop_binding(
    stop: &DurableServiceStopAuthority,
    live: &LiveServiceProcess,
) -> Result<(), ProcessOwnerError> {
    live.validate_start_binding()?;
    if !stop.matches_generation_scope(&live.generation_scope) {
        return Err(ProcessOwnerError::GenerationScopeMismatch);
    }
    if stop.service_id() != live.service_id() || stop.generation() != live.generation() {
        return Err(ProcessOwnerError::InvalidLaunch(
            "StopTree authority did not match the resident service generation",
        ));
    }
    Ok(())
}

fn launch_request(
    start: Box<DurableServiceStartAuthority>,
    generation: &CurrentGenerationMembership,
    request: ServiceLaunchRequest,
    retry_available: bool,
) -> ServiceLaunchOutcome {
    let readiness = ServiceReadinessBinding::from_request(&request);
    let request_scope = request.generation_scope();
    if !start.matches_generation_scope(&request_scope) || !generation.matches_scope(&request_scope)
    {
        return ServiceLaunchOutcome::NotCreated(ServiceLaunchNotCreated {
            start,
            retry: retry_available.then_some(ServiceLaunchRetryMaterial::Request(request)),
            error: ProcessOwnerError::GenerationScopeMismatch,
        });
    }
    if request.service_id() != start.service_id() {
        return ServiceLaunchOutcome::NotCreated(ServiceLaunchNotCreated {
            start,
            retry: retry_available.then_some(ServiceLaunchRetryMaterial::Request(request)),
            error: ProcessOwnerError::InvalidLaunch(
                "service registry material did not match the durable StartTree authority",
            ),
        });
    }

    let service_id = start.service_id().to_string();
    let service_generation = start.generation();
    match prepare_claimed_service_launch(&service_id, service_generation, request) {
        Ok(launch) => launch_prepared(
            start,
            generation,
            Box::new(launch),
            readiness,
            retry_available,
        ),
        Err((request, error)) => ServiceLaunchOutcome::NotCreated(ServiceLaunchNotCreated {
            start,
            retry: retry_available.then_some(ServiceLaunchRetryMaterial::Request(request)),
            error,
        }),
    }
}

fn launch_prepared(
    start: Box<DurableServiceStartAuthority>,
    generation: &CurrentGenerationMembership,
    launch: Box<TrustedProcessLaunch>,
    readiness: ServiceReadinessBinding,
    retry_available: bool,
) -> ServiceLaunchOutcome {
    let generation_scope = launch.generation_scope().clone();
    if !start.matches_generation_scope(&generation_scope)
        || !generation.matches_scope(&generation_scope)
    {
        return ServiceLaunchOutcome::NotCreated(ServiceLaunchNotCreated {
            start,
            retry: retry_available
                .then_some(ServiceLaunchRetryMaterial::Prepared { launch, readiness }),
            error: ProcessOwnerError::GenerationScopeMismatch,
        });
    }

    match RunningProcessOwner::spawn_claimed_service(generation, *launch) {
        ProcessSpawnAttempt::Running(owner) => {
            ServiceLaunchOutcome::Running(Box::new(ClaimedServiceProcess {
                live: LiveServiceProcess {
                    start,
                    generation_scope,
                    owner,
                    readiness: readiness.activate(),
                    pending_exit: None,
                },
                pending_residency: None,
            }))
        }
        ProcessSpawnAttempt::NotCreated { launch, error } => {
            ServiceLaunchOutcome::NotCreated(ServiceLaunchNotCreated {
                start,
                retry: retry_available
                    .then_some(ServiceLaunchRetryMaterial::Prepared { launch, readiness }),
                error,
            })
        }
        ProcessSpawnAttempt::Uncertain(owner) => {
            ServiceLaunchOutcome::Uncertain(ServiceLaunchUncertain { start, owner })
        }
    }
}

fn readiness_pending(
    process: StartingServiceProcess,
    reason: ServiceReadinessPendingReason,
    deadline: Instant,
) -> ServiceReadinessProbeOutcome {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        ServiceReadinessProbeOutcome::TimedOut(process)
    } else {
        let poll_interval =
            Duration::from_millis(process.live.readiness.readiness.poll_interval_ms);
        ServiceReadinessProbeOutcome::Pending {
            process,
            retry_after: poll_interval.min(remaining),
            reason,
        }
    }
}

fn probe_loopback_http_readiness(
    port: u16,
    readiness: &ServiceHttpReadiness,
    authorization: Option<&str>,
    startup_deadline: Instant,
) -> Result<(), ServiceReadinessPendingReason> {
    let timeout = Duration::from_millis(readiness.request_timeout_ms);
    let request_deadline = Instant::now()
        .checked_add(timeout)
        .map(|deadline| deadline.min(startup_deadline))
        .unwrap_or(startup_deadline);
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream =
        TcpStream::connect_timeout(&address, remaining_http_probe_time(request_deadline)?)
            .map_err(|_| ServiceReadinessPendingReason::ConnectionUnavailable)?;
    let authorization = authorization
        .map(|value| format!("Authorization: {value}\r\n"))
        .unwrap_or_default();
    let request = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\nAccept: text/plain, application/json\r\n{}\r\n",
        readiness.path, port, authorization
    );
    write_http_request_until(&mut stream, request.as_bytes(), request_deadline)?;

    let expected = readiness
        .expected_body_contains
        .as_deref()
        .map(str::as_bytes);
    let mut response = Vec::with_capacity(4 * 1024);
    let mut buffer = [0_u8; 4 * 1024];
    let mut body_offset = None;
    loop {
        stream
            .set_read_timeout(Some(remaining_http_probe_time(request_deadline)?))
            .map_err(|_| ServiceReadinessPendingReason::RequestFailed)?;
        let count = match stream.read(&mut buffer) {
            Ok(count) => count,
            Err(_) => return Err(ServiceReadinessPendingReason::RequestFailed),
        };
        if Instant::now() >= request_deadline {
            return Err(ServiceReadinessPendingReason::RequestFailed);
        }
        if count == 0 {
            let Some(offset) = body_offset else {
                return Err(ServiceReadinessPendingReason::InvalidResponse);
            };
            return match expected {
                None => Ok(()),
                Some(needle) if contains_bytes(&response[offset..], needle) => Ok(()),
                Some(_) => Err(ServiceReadinessPendingReason::BodyMismatch),
            };
        }
        if response.len().saturating_add(count) > MAX_SERVICE_READINESS_RESPONSE_BYTES {
            return Err(ServiceReadinessPendingReason::ResponseTooLarge);
        }
        response.extend_from_slice(&buffer[..count]);
        if body_offset.is_none() {
            if let Some(separator) = find_bytes(&response, b"\r\n\r\n") {
                validate_http_status(&response[..separator])?;
                body_offset = Some(separator + 4);
                if expected.is_none() {
                    return Ok(());
                }
            }
        }
        if let (Some(offset), Some(needle)) = (body_offset, expected) {
            if contains_bytes(&response[offset..], needle) {
                return Ok(());
            }
        }
    }
}

fn remaining_http_probe_time(deadline: Instant) -> Result<Duration, ServiceReadinessPendingReason> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(ServiceReadinessPendingReason::RequestFailed)
    } else {
        Ok(remaining)
    }
}

fn write_http_request_until(
    stream: &mut TcpStream,
    mut request: &[u8],
    deadline: Instant,
) -> Result<(), ServiceReadinessPendingReason> {
    while !request.is_empty() {
        stream
            .set_write_timeout(Some(remaining_http_probe_time(deadline)?))
            .map_err(|_| ServiceReadinessPendingReason::RequestFailed)?;
        match stream.write(request) {
            Ok(0) => return Err(ServiceReadinessPendingReason::RequestFailed),
            Ok(written) => request = &request[written..],
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err(ServiceReadinessPendingReason::RequestFailed),
        }
    }
    stream
        .set_write_timeout(Some(remaining_http_probe_time(deadline)?))
        .and_then(|_| stream.flush())
        .map_err(|_| ServiceReadinessPendingReason::RequestFailed)
}

fn validate_http_status(headers: &[u8]) -> Result<(), ServiceReadinessPendingReason> {
    let first_line_end = find_bytes(headers, b"\r\n").unwrap_or(headers.len());
    let first_line = std::str::from_utf8(&headers[..first_line_end])
        .map_err(|_| ServiceReadinessPendingReason::InvalidResponse)?;
    let mut fields = first_line.split_ascii_whitespace();
    let version = fields
        .next()
        .ok_or(ServiceReadinessPendingReason::InvalidResponse)?;
    let status = fields
        .next()
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or(ServiceReadinessPendingReason::InvalidResponse)?;
    if !matches!(version, "HTTP/1.0" | "HTTP/1.1") {
        return Err(ServiceReadinessPendingReason::InvalidResponse);
    }
    if !(200..=299).contains(&status) {
        return Err(ServiceReadinessPendingReason::UnexpectedStatus);
    }
    Ok(())
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    needle.is_empty() || find_bytes(haystack, needle).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    fn readiness(expected: Option<&str>) -> ServiceHttpReadiness {
        ServiceHttpReadiness {
            path: "/health".into(),
            expected_body_contains: expected.map(str::to_owned),
            request_timeout_ms: 500,
            poll_interval_ms: 25,
            startup_timeout_ms: 1_000,
        }
    }

    fn one_response(response: &'static [u8]) -> (u16, thread::JoinHandle<()>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1_024];
            let _ = stream.read(&mut request).unwrap();
            stream.write_all(response).unwrap();
            stream.flush().unwrap();
        });
        (port, server)
    }

    #[test]
    fn bounded_loopback_probe_requires_success_status_and_expected_body() {
        let (port, server) = one_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 17\r\nConnection: close\r\n\r\n{\"status\":\"ready\"}",
        );
        assert_eq!(
            probe_loopback_http_readiness(
                port,
                &readiness(Some("ready")),
                None,
                Instant::now() + Duration::from_secs(1),
            ),
            Ok(())
        );
        server.join().unwrap();

        let (port, server) =
            one_response(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 5\r\n\r\nready");
        assert_eq!(
            probe_loopback_http_readiness(
                port,
                &readiness(Some("ready")),
                None,
                Instant::now() + Duration::from_secs(1),
            ),
            Err(ServiceReadinessPendingReason::UnexpectedStatus)
        );
        server.join().unwrap();

        let (port, server) = one_response(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nno!");
        assert_eq!(
            probe_loopback_http_readiness(
                port,
                &readiness(Some("ready")),
                None,
                Instant::now() + Duration::from_secs(1),
            ),
            Err(ServiceReadinessPendingReason::BodyMismatch)
        );
        server.join().unwrap();
    }

    #[test]
    fn slow_drip_response_cannot_extend_the_total_request_deadline() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1_024];
            let _ = stream.read(&mut request);
            for byte in b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n" {
                if stream.write_all(&[*byte]).is_err() || stream.flush().is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(25));
            }
        });
        let mut contract = readiness(None);
        contract.request_timeout_ms = 125;
        let started = Instant::now();
        assert_eq!(
            probe_loopback_http_readiness(
                port,
                &contract,
                None,
                Instant::now() + Duration::from_secs(2),
            ),
            Err(ServiceReadinessPendingReason::RequestFailed)
        );
        assert!(started.elapsed() < Duration::from_millis(750));
        server.join().unwrap();
    }
}
