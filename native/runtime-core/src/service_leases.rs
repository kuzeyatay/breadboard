//! Pure service-lease lifecycle logic.
//!
//! This module deliberately knows nothing about processes, ports, sockets, or
//! persistence. It turns validated lease/lifecycle inputs into explicit tree
//! actions that the runtime daemon must durably publish and then execute. A
//! status read is observational only; it can never create a start action.

use breadboard_runtime_protocol::{
    validate_bounded_text, validate_identifier, RestartPolicy, RuntimeServiceState,
    RuntimeServiceStatus, ServiceDefinition, ServiceStartupPolicy, ValidationError,
    MAX_CONCURRENCY, MAX_FAILURE_MESSAGE_BYTES, MAX_SQLITE_UNSIGNED, MAX_STAGE_BYTES,
    MAX_TIMEOUT_MS,
};
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ServiceLeaseError {
    #[error(transparent)]
    InvalidDefinition(#[from] ValidationError),
    #[error("external service ownership is forbidden for {0}")]
    ExternalOwnershipForbidden(String),
    #[error("{field} is outside its bounded range")]
    InvalidLimit { field: &'static str },
    #[error("runtime time {0} is outside its bounded range")]
    InvalidTime(u64),
    #[error("runtime time moved backwards from {previous} to {actual}")]
    ClockMovedBackwards { previous: u64, actual: u64 },
    #[error("lease duration {actual_ms}ms is outside the configured maximum {maximum_ms}ms")]
    InvalidLeaseDuration { actual_ms: u64, maximum_ms: u64 },
    #[error("lease expiry exceeds the bounded runtime clock")]
    LeaseExpiryOverflow,
    #[error("lease {0} already exists")]
    DuplicateLease(String),
    #[error("service {service_id} already has its maximum {maximum} leases")]
    LeaseLimitReached { service_id: String, maximum: u32 },
    #[error("service {0} is closed to new lease acquisitions")]
    AcquisitionClosed(String),
    #[error("service {0} is stopping and cannot acquire another lease")]
    ServiceStopping(String),
    #[error("service {0} is not configured for eager startup")]
    NotEager(String),
    #[error("service {service_id} cannot {operation} while {state:?}")]
    InvalidState {
        service_id: String,
        operation: &'static str,
        state: RuntimeServiceState,
    },
    #[error("stale generation {actual} for service {service_id}; expected {expected}")]
    StaleGeneration {
        service_id: String,
        expected: u64,
        actual: u64,
    },
    #[error("service {0} does not permit restart after failure")]
    RestartForbidden(String),
    #[error("service {service_id} reached its maximum {maximum} restarts")]
    RestartLimitReached { service_id: String, maximum: u32 },
    #[error("service generation counter is exhausted")]
    GenerationExhausted,
}

/// Runtime-wide bounds applied in addition to the service manifest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceLeaseLimits {
    max_concurrent_leases: u32,
    max_lease_ms: u64,
    max_restarts: u32,
}

impl ServiceLeaseLimits {
    pub fn new(
        max_concurrent_leases: u32,
        max_lease_ms: u64,
        max_restarts: u32,
    ) -> Result<Self, ServiceLeaseError> {
        if max_concurrent_leases == 0 || max_concurrent_leases > MAX_CONCURRENCY {
            return Err(ServiceLeaseError::InvalidLimit {
                field: "maxConcurrentLeases",
            });
        }
        if max_lease_ms == 0 || max_lease_ms > MAX_TIMEOUT_MS {
            return Err(ServiceLeaseError::InvalidLimit {
                field: "maxLeaseMs",
            });
        }
        if max_restarts > MAX_CONCURRENCY {
            return Err(ServiceLeaseError::InvalidLimit {
                field: "maxRestarts",
            });
        }
        Ok(Self {
            max_concurrent_leases,
            max_lease_ms,
            max_restarts,
        })
    }

    pub fn max_concurrent_leases(self) -> u32 {
        self.max_concurrent_leases
    }

    pub fn max_lease_ms(self) -> u64 {
        self.max_lease_ms
    }

    pub fn max_restarts(self) -> u32 {
        self.max_restarts
    }
}

/// The immutable, manifest-derived identity and lifecycle policy retained by
/// the lease engine. Executable authority is intentionally not copied here.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceLeaseRegistration {
    service_id: String,
    display_name: String,
    required: bool,
    startup_policy: ServiceStartupPolicy,
    restart_policy: RestartPolicy,
    idle_ttl_ms: Option<u64>,
    limits: ServiceLeaseLimits,
}

impl ServiceLeaseRegistration {
    pub fn from_definition(
        definition: &ServiceDefinition,
        required: bool,
        limits: ServiceLeaseLimits,
    ) -> Result<Self, ServiceLeaseError> {
        definition.validate()?;
        if definition.startup_policy == ServiceStartupPolicy::External {
            return Err(ServiceLeaseError::ExternalOwnershipForbidden(
                definition.id.clone(),
            ));
        }
        validate_bounded_text("displayName", &definition.display_name, MAX_STAGE_BYTES)?;
        if definition.display_name.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "displayName",
            }
            .into());
        }
        let idle_ttl_ms = if matches!(
            definition.startup_policy,
            ServiceStartupPolicy::OnDemand | ServiceStartupPolicy::Scheduled
        ) {
            definition.idle_ttl_ms
        } else {
            None
        };
        Ok(Self {
            service_id: definition.id.clone(),
            display_name: definition.display_name.clone(),
            required,
            startup_policy: definition.startup_policy,
            restart_policy: definition.restart_policy,
            idle_ttl_ms,
            limits,
        })
    }

    pub fn service_id(&self) -> &str {
        &self.service_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn required(&self) -> bool {
        self.required
    }

    pub fn startup_policy(&self) -> ServiceStartupPolicy {
        self.startup_policy
    }

    pub fn restart_policy(&self) -> RestartPolicy {
        self.restart_policy
    }

    pub fn idle_ttl_ms(&self) -> Option<u64> {
        self.idle_ttl_ms
    }

    pub fn limits(&self) -> ServiceLeaseLimits {
        self.limits
    }

    fn permits_idle_stop(&self) -> bool {
        matches!(
            self.startup_policy,
            ServiceStartupPolicy::OnDemand | ServiceStartupPolicy::Scheduled
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceLeaseClaimState {
    Pending,
    Active,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceLeaseClaim {
    pub lease_id: String,
    pub service_id: String,
    pub generation: u64,
    pub expires_at_ms: u64,
    pub state: ServiceLeaseClaimState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceLeaseReleaseReason {
    Success,
    Failure,
    Cancellation,
    Disconnect,
    Timeout,
    Explicit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceLeaseResolution {
    pub lease_id: String,
    pub service_id: String,
    pub generation: u64,
    pub previous_state: ServiceLeaseClaimState,
    pub reason: ServiceLeaseReleaseReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceLeaseActivation {
    pub lease_id: String,
    pub service_id: String,
    pub generation: u64,
    pub expires_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceStopCause {
    Idle,
    Shutdown,
}

/// The only process-tree authority emitted by this module. It names a
/// registered service generation, never a PID or externally adopted process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceLeaseAction {
    StartTree {
        service_id: String,
        generation: u64,
    },
    StopTree {
        service_id: String,
        generation: u64,
        cause: ServiceStopCause,
    },
}

/// A generation-bound idle timer token. Callers must return this exact token
/// when the timer fires; copied or stale tokens cannot stop a newer tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdleStopDeadline {
    pub service_id: String,
    pub generation: u64,
    pub due_at_ms: u64,
    pub expected_pending_leases: u32,
    pub expected_active_leases: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServiceLeaseEffects {
    pub actions: Vec<ServiceLeaseAction>,
    pub activated: Vec<ServiceLeaseActivation>,
    pub resolved: Vec<ServiceLeaseResolution>,
    pub scheduled_idle_deadline: Option<IdleStopDeadline>,
    pub cancelled_idle_deadline: Option<IdleStopDeadline>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeginServiceAcquireOutcome {
    pub claim: ServiceLeaseClaim,
    pub effects: ServiceLeaseEffects,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceLeaseReleaseDisposition {
    Released,
    AlreadyReleased,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseServiceLeaseOutcome {
    pub disposition: ServiceLeaseReleaseDisposition,
    pub effects: ServiceLeaseEffects,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceTreeExitConfirmation {
    pub status: RuntimeServiceStatus,
    pub effects: ServiceLeaseEffects,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceLeaseSnapshot {
    pub status: RuntimeServiceStatus,
    pub generation: u64,
    pub pending_leases: u32,
    pub active_leases: u32,
    pub acquisition_closed: bool,
    pub idle_deadline: Option<IdleStopDeadline>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServicePhase {
    AvailableButStopped,
    Starting { generation: u64 },
    Ready { generation: u64 },
    Failed { generation: u64 },
    Stopping { generation: u64 },
}

impl ServicePhase {
    fn generation(self) -> Option<u64> {
        match self {
            Self::AvailableButStopped => None,
            Self::Starting { generation }
            | Self::Ready { generation }
            | Self::Failed { generation }
            | Self::Stopping { generation } => Some(generation),
        }
    }
}

/// Linearizable, bounded service-lease lifecycle state.
///
/// Mutating operations use a small copy-on-success transaction. An invalid or
/// stale input therefore cannot partially expire leases or advance lifecycle
/// state before returning an error.
#[derive(Debug)]
pub struct ServiceLeaseMachine {
    registration: ServiceLeaseRegistration,
    phase: ServicePhase,
    generation: u64,
    restarts: u32,
    retry_required: bool,
    acquisition_closed: bool,
    claims: BTreeMap<String, ServiceLeaseClaim>,
    idle_deadline: Option<IdleStopDeadline>,
    last_error: Option<String>,
    last_exited_generation: Option<u64>,
    last_observed_ms: u64,
}

impl ServiceLeaseMachine {
    pub fn new(registration: ServiceLeaseRegistration) -> Self {
        Self {
            registration,
            phase: ServicePhase::AvailableButStopped,
            generation: 0,
            restarts: 0,
            retry_required: false,
            acquisition_closed: false,
            claims: BTreeMap::new(),
            idle_deadline: None,
            last_error: None,
            last_exited_generation: None,
            last_observed_ms: 0,
        }
    }

    pub fn registration(&self) -> &ServiceLeaseRegistration {
        &self.registration
    }

    /// Pure observation. This method never advances time and can never emit a
    /// start/stop action.
    pub fn status(&self) -> RuntimeServiceStatus {
        RuntimeServiceStatus {
            id: self.registration.service_id.clone(),
            display_name: self.registration.display_name.clone(),
            required: self.registration.required,
            state: self.runtime_state(),
            last_error: self.last_error.clone(),
            restarts: self.restarts,
            adopted: false,
        }
    }

    pub fn snapshot(&self) -> ServiceLeaseSnapshot {
        let (pending_leases, active_leases) = self.lease_counts();
        ServiceLeaseSnapshot {
            status: self.status(),
            generation: self.generation,
            pending_leases,
            active_leases,
            acquisition_closed: self.acquisition_closed,
            idle_deadline: self.idle_deadline.clone(),
        }
    }

    /// Earliest bounded expiry for timer scheduling. Like `status`, this is a
    /// pure read and does not expire or otherwise mutate a lease.
    pub fn next_lease_expiry_ms(&self) -> Option<u64> {
        self.claims.values().map(|claim| claim.expires_at_ms).min()
    }

    pub fn begin_acquire(
        &mut self,
        lease_id: &str,
        requested_lease_ms: u64,
        now_ms: u64,
    ) -> Result<BeginServiceAcquireOutcome, ServiceLeaseError> {
        self.transact(|candidate| {
            candidate.begin_acquire_inner(lease_id, requested_lease_ms, now_ms)
        })
    }

    /// Explicit eager-policy bootstrap. Repeated calls while the same
    /// generation is starting or ready are no-ops, preserving single flight.
    pub fn begin_eager_start(
        &mut self,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.transact(|candidate| candidate.begin_eager_start_inner(now_ms))
    }

    pub fn confirm_ready(
        &mut self,
        generation: u64,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.transact(|candidate| candidate.confirm_ready_inner(generation, now_ms))
    }

    /// Records a failure for a start attempt that has no live owned tree left.
    /// If a tree was created, callers must instead confirm its tree exit.
    pub fn startup_failed(
        &mut self,
        generation: u64,
        failure: &str,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.transact(|candidate| candidate.startup_failed_inner(generation, failure, now_ms))
    }

    pub fn release(
        &mut self,
        lease_id: &str,
        reason: ServiceLeaseReleaseReason,
        now_ms: u64,
    ) -> Result<ReleaseServiceLeaseOutcome, ServiceLeaseError> {
        self.transact(|candidate| candidate.release_inner(lease_id, reason, now_ms))
    }

    /// Applies bounded lease expirations. Runtime timer integration must call
    /// this at the earliest returned lease expiry even when no requests arrive.
    pub fn advance_time(&mut self, now_ms: u64) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.transact(|candidate| candidate.advance_time_inner(now_ms))
    }

    /// Converts an exact, still-current idle timer into one stop-tree action.
    /// Stale timers are harmless no-ops.
    pub fn on_idle_deadline(
        &mut self,
        deadline: &IdleStopDeadline,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.transact(|candidate| candidate.on_idle_deadline_inner(deadline, now_ms))
    }

    /// Closes admission permanently, resolves every claim, and requests at
    /// most one stop for the currently owned tree generation.
    pub fn begin_shutdown(
        &mut self,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.transact(|candidate| candidate.begin_shutdown_inner(now_ms))
    }

    /// The only transition from a live/stopping generation back to
    /// `available-but-stopped`. Repeating confirmation for the last exited
    /// generation is idempotent.
    pub fn confirm_tree_exit(
        &mut self,
        generation: u64,
        reason: ServiceLeaseReleaseReason,
        last_error: Option<&str>,
        now_ms: u64,
    ) -> Result<ServiceTreeExitConfirmation, ServiceLeaseError> {
        self.transact(|candidate| {
            candidate.confirm_tree_exit_inner(generation, reason, last_error, now_ms)
        })
    }

    fn transact<T>(
        &mut self,
        operation: impl FnOnce(&mut Self) -> Result<T, ServiceLeaseError>,
    ) -> Result<T, ServiceLeaseError> {
        // Do not implement `Clone` for the public authority type. Two caller-
        // visible copies could independently emit `StartTree` for the same
        // service generation and defeat the single-flight guarantee. Keep the
        // copy-on-success behavior as a private implementation detail instead.
        let mut candidate = Self {
            registration: self.registration.clone(),
            phase: self.phase,
            generation: self.generation,
            restarts: self.restarts,
            retry_required: self.retry_required,
            acquisition_closed: self.acquisition_closed,
            claims: self.claims.clone(),
            idle_deadline: self.idle_deadline.clone(),
            last_error: self.last_error.clone(),
            last_exited_generation: self.last_exited_generation,
            last_observed_ms: self.last_observed_ms,
        };
        let result = operation(&mut candidate)?;
        *self = candidate;
        Ok(result)
    }

    fn begin_acquire_inner(
        &mut self,
        lease_id: &str,
        requested_lease_ms: u64,
        now_ms: u64,
    ) -> Result<BeginServiceAcquireOutcome, ServiceLeaseError> {
        validate_identifier("leaseId", lease_id)?;
        self.validate_now(now_ms)?;
        if requested_lease_ms == 0 || requested_lease_ms > self.registration.limits.max_lease_ms {
            return Err(ServiceLeaseError::InvalidLeaseDuration {
                actual_ms: requested_lease_ms,
                maximum_ms: self.registration.limits.max_lease_ms,
            });
        }
        let expires_at_ms = now_ms
            .checked_add(requested_lease_ms)
            .filter(|value| *value <= MAX_SQLITE_UNSIGNED)
            .ok_or(ServiceLeaseError::LeaseExpiryOverflow)?;
        if self.acquisition_closed {
            return Err(ServiceLeaseError::AcquisitionClosed(
                self.registration.service_id.clone(),
            ));
        }
        if matches!(self.phase, ServicePhase::Stopping { .. }) {
            return Err(ServiceLeaseError::ServiceStopping(
                self.registration.service_id.clone(),
            ));
        }
        if matches!(self.phase, ServicePhase::Failed { .. }) || self.retry_required {
            self.validate_restart_available()?;
        }

        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        if self.claims.contains_key(lease_id) {
            return Err(ServiceLeaseError::DuplicateLease(lease_id.to_string()));
        }
        if self.claims.len() >= self.registration.limits.max_concurrent_leases as usize {
            return Err(ServiceLeaseError::LeaseLimitReached {
                service_id: self.registration.service_id.clone(),
                maximum: self.registration.limits.max_concurrent_leases,
            });
        }

        let (generation, state, start_required, restart) = match self.phase {
            ServicePhase::AvailableButStopped => {
                let restart = self.retry_required;
                (
                    self.next_generation()?,
                    ServiceLeaseClaimState::Pending,
                    true,
                    restart,
                )
            }
            ServicePhase::Failed { .. } => (
                self.next_generation()?,
                ServiceLeaseClaimState::Pending,
                true,
                true,
            ),
            ServicePhase::Starting { generation } => {
                (generation, ServiceLeaseClaimState::Pending, false, false)
            }
            ServicePhase::Ready { generation } => {
                (generation, ServiceLeaseClaimState::Active, false, false)
            }
            ServicePhase::Stopping { .. } => {
                return Err(ServiceLeaseError::ServiceStopping(
                    self.registration.service_id.clone(),
                ));
            }
        };

        let claim = ServiceLeaseClaim {
            lease_id: lease_id.to_string(),
            service_id: self.registration.service_id.clone(),
            generation,
            expires_at_ms,
            state,
        };
        self.claims.insert(lease_id.to_string(), claim.clone());

        if state == ServiceLeaseClaimState::Active {
            self.cancel_idle_deadline(&mut effects);
        }
        if start_required {
            if restart {
                self.restarts += 1;
            }
            self.generation = generation;
            self.retry_required = false;
            self.last_error = None;
            self.phase = ServicePhase::Starting { generation };
            effects.actions.push(ServiceLeaseAction::StartTree {
                service_id: self.registration.service_id.clone(),
                generation,
            });
        }

        Ok(BeginServiceAcquireOutcome { claim, effects })
    }

    fn begin_eager_start_inner(
        &mut self,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.validate_now(now_ms)?;
        if self.registration.startup_policy != ServiceStartupPolicy::Eager {
            return Err(ServiceLeaseError::NotEager(
                self.registration.service_id.clone(),
            ));
        }
        if self.acquisition_closed {
            return Err(ServiceLeaseError::AcquisitionClosed(
                self.registration.service_id.clone(),
            ));
        }
        if matches!(self.phase, ServicePhase::Stopping { .. }) {
            return Err(ServiceLeaseError::ServiceStopping(
                self.registration.service_id.clone(),
            ));
        }
        if matches!(self.phase, ServicePhase::Failed { .. }) || self.retry_required {
            self.validate_restart_available()?;
        }

        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        match self.phase {
            ServicePhase::Starting { .. } | ServicePhase::Ready { .. } => return Ok(effects),
            ServicePhase::AvailableButStopped | ServicePhase::Failed { .. } => {}
            ServicePhase::Stopping { .. } => {
                return Err(ServiceLeaseError::ServiceStopping(
                    self.registration.service_id.clone(),
                ));
            }
        }

        let restart = matches!(self.phase, ServicePhase::Failed { .. }) || self.retry_required;
        let generation = self.next_generation()?;
        if restart {
            self.restarts += 1;
        }
        self.generation = generation;
        self.retry_required = false;
        self.last_error = None;
        self.phase = ServicePhase::Starting { generation };
        effects.actions.push(ServiceLeaseAction::StartTree {
            service_id: self.registration.service_id.clone(),
            generation,
        });
        Ok(effects)
    }

    fn confirm_ready_inner(
        &mut self,
        generation: u64,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.validate_now(now_ms)?;
        self.require_generation("become ready", generation, |phase| {
            matches!(phase, ServicePhase::Starting { .. })
        })?;

        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        for claim in self.claims.values_mut() {
            if claim.generation == generation && claim.state == ServiceLeaseClaimState::Pending {
                claim.state = ServiceLeaseClaimState::Active;
                effects.activated.push(ServiceLeaseActivation {
                    lease_id: claim.lease_id.clone(),
                    service_id: claim.service_id.clone(),
                    generation,
                    expires_at_ms: claim.expires_at_ms,
                });
            }
        }
        self.phase = ServicePhase::Ready { generation };
        self.last_error = None;
        self.schedule_idle_if_eligible(now_ms, &mut effects);
        Ok(effects)
    }

    fn startup_failed_inner(
        &mut self,
        generation: u64,
        failure: &str,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        validate_bounded_text("startupFailure", failure, MAX_FAILURE_MESSAGE_BYTES)?;
        if failure.chars().any(char::is_control) {
            return Err(ValidationError::InvalidIdentifier {
                field: "startupFailure",
            }
            .into());
        }
        self.validate_now(now_ms)?;
        self.require_generation("fail startup", generation, |phase| {
            matches!(phase, ServicePhase::Starting { .. })
        })?;

        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        self.resolve_all(ServiceLeaseReleaseReason::Failure, &mut effects);
        self.cancel_idle_deadline(&mut effects);
        self.phase = ServicePhase::Failed { generation };
        self.retry_required = true;
        self.last_error = Some(failure.to_string());
        Ok(effects)
    }

    fn release_inner(
        &mut self,
        lease_id: &str,
        reason: ServiceLeaseReleaseReason,
        now_ms: u64,
    ) -> Result<ReleaseServiceLeaseOutcome, ServiceLeaseError> {
        validate_identifier("leaseId", lease_id)?;
        self.validate_now(now_ms)?;
        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        let disposition = match self.claims.remove(lease_id) {
            Some(claim) => {
                effects.resolved.push(Self::resolution(claim, reason));
                ServiceLeaseReleaseDisposition::Released
            }
            None => ServiceLeaseReleaseDisposition::AlreadyReleased,
        };
        self.schedule_idle_if_eligible(now_ms, &mut effects);
        Ok(ReleaseServiceLeaseOutcome {
            disposition,
            effects,
        })
    }

    fn advance_time_inner(
        &mut self,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.validate_now(now_ms)?;
        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        Ok(effects)
    }

    fn on_idle_deadline_inner(
        &mut self,
        deadline: &IdleStopDeadline,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.validate_now(now_ms)?;
        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        if self.idle_deadline.as_ref() != Some(deadline) || now_ms < deadline.due_at_ms {
            return Ok(effects);
        }

        let (pending, active) = self.lease_counts();
        let exact_generation = matches!(
            self.phase,
            ServicePhase::Ready { generation } if generation == deadline.generation
        );
        if deadline.service_id != self.registration.service_id
            || !exact_generation
            || pending != deadline.expected_pending_leases
            || active != deadline.expected_active_leases
            || pending != 0
            || active != 0
        {
            return Ok(effects);
        }

        self.idle_deadline = None;
        self.phase = ServicePhase::Stopping {
            generation: deadline.generation,
        };
        effects.actions.push(ServiceLeaseAction::StopTree {
            service_id: self.registration.service_id.clone(),
            generation: deadline.generation,
            cause: ServiceStopCause::Idle,
        });
        Ok(effects)
    }

    fn begin_shutdown_inner(
        &mut self,
        now_ms: u64,
    ) -> Result<ServiceLeaseEffects, ServiceLeaseError> {
        self.validate_now(now_ms)?;
        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        self.acquisition_closed = true;
        self.resolve_all(ServiceLeaseReleaseReason::Cancellation, &mut effects);
        self.cancel_idle_deadline(&mut effects);

        match self.phase {
            ServicePhase::Starting { generation } | ServicePhase::Ready { generation } => {
                self.phase = ServicePhase::Stopping { generation };
                effects.actions.push(ServiceLeaseAction::StopTree {
                    service_id: self.registration.service_id.clone(),
                    generation,
                    cause: ServiceStopCause::Shutdown,
                });
            }
            ServicePhase::Failed { .. } => {
                self.phase = ServicePhase::AvailableButStopped;
            }
            ServicePhase::AvailableButStopped | ServicePhase::Stopping { .. } => {}
        }
        Ok(effects)
    }

    fn confirm_tree_exit_inner(
        &mut self,
        generation: u64,
        reason: ServiceLeaseReleaseReason,
        last_error: Option<&str>,
        now_ms: u64,
    ) -> Result<ServiceTreeExitConfirmation, ServiceLeaseError> {
        if let Some(message) = last_error {
            validate_bounded_text("serviceTreeExitError", message, MAX_FAILURE_MESSAGE_BYTES)?;
            if message.chars().any(char::is_control) {
                return Err(ValidationError::InvalidIdentifier {
                    field: "serviceTreeExitError",
                }
                .into());
            }
        }
        self.validate_now(now_ms)?;

        if self.phase == ServicePhase::AvailableButStopped
            && self.last_exited_generation == Some(generation)
        {
            let effects = self.advance_time_inner(now_ms)?;
            return Ok(ServiceTreeExitConfirmation {
                status: self.status(),
                effects,
            });
        }
        self.require_generation("confirm tree exit", generation, |_| true)?;

        let mut effects = ServiceLeaseEffects::default();
        self.observe_and_expire(now_ms, &mut effects)?;
        self.resolve_all(reason, &mut effects);
        self.cancel_idle_deadline(&mut effects);
        self.phase = ServicePhase::AvailableButStopped;
        self.last_exited_generation = Some(generation);
        self.retry_required = matches!(
            reason,
            ServiceLeaseReleaseReason::Failure | ServiceLeaseReleaseReason::Disconnect
        ) || last_error.is_some();
        self.last_error = last_error.map(str::to_string);
        Ok(ServiceTreeExitConfirmation {
            status: self.status(),
            effects,
        })
    }

    fn observe_and_expire(
        &mut self,
        now_ms: u64,
        effects: &mut ServiceLeaseEffects,
    ) -> Result<(), ServiceLeaseError> {
        self.observe_now(now_ms)?;
        let expired: Vec<String> = self
            .claims
            .iter()
            .filter(|(_, claim)| claim.expires_at_ms <= now_ms)
            .map(|(lease_id, _)| lease_id.clone())
            .collect();
        for lease_id in expired {
            if let Some(claim) = self.claims.remove(&lease_id) {
                effects
                    .resolved
                    .push(Self::resolution(claim, ServiceLeaseReleaseReason::Timeout));
            }
        }
        self.schedule_idle_if_eligible(now_ms, effects);
        Ok(())
    }

    fn observe_now(&mut self, now_ms: u64) -> Result<(), ServiceLeaseError> {
        self.validate_now(now_ms)?;
        self.last_observed_ms = now_ms;
        Ok(())
    }

    fn validate_now(&self, now_ms: u64) -> Result<(), ServiceLeaseError> {
        if now_ms > MAX_SQLITE_UNSIGNED {
            return Err(ServiceLeaseError::InvalidTime(now_ms));
        }
        if now_ms < self.last_observed_ms {
            return Err(ServiceLeaseError::ClockMovedBackwards {
                previous: self.last_observed_ms,
                actual: now_ms,
            });
        }
        Ok(())
    }

    fn next_generation(&self) -> Result<u64, ServiceLeaseError> {
        self.generation
            .checked_add(1)
            .filter(|value| *value <= MAX_SQLITE_UNSIGNED)
            .ok_or(ServiceLeaseError::GenerationExhausted)
    }

    fn validate_restart_available(&self) -> Result<(), ServiceLeaseError> {
        if self.registration.restart_policy != RestartPolicy::OnFailure {
            return Err(ServiceLeaseError::RestartForbidden(
                self.registration.service_id.clone(),
            ));
        }
        if self.restarts >= self.registration.limits.max_restarts {
            return Err(ServiceLeaseError::RestartLimitReached {
                service_id: self.registration.service_id.clone(),
                maximum: self.registration.limits.max_restarts,
            });
        }
        Ok(())
    }

    fn require_generation(
        &self,
        operation: &'static str,
        actual: u64,
        allowed_phase: impl FnOnce(ServicePhase) -> bool,
    ) -> Result<(), ServiceLeaseError> {
        let state = self.runtime_state();
        let Some(expected) = self.phase.generation() else {
            return Err(ServiceLeaseError::InvalidState {
                service_id: self.registration.service_id.clone(),
                operation,
                state,
            });
        };
        if expected != actual {
            return Err(ServiceLeaseError::StaleGeneration {
                service_id: self.registration.service_id.clone(),
                expected,
                actual,
            });
        }
        if !allowed_phase(self.phase) {
            return Err(ServiceLeaseError::InvalidState {
                service_id: self.registration.service_id.clone(),
                operation,
                state,
            });
        }
        Ok(())
    }

    fn runtime_state(&self) -> RuntimeServiceState {
        match self.phase {
            ServicePhase::AvailableButStopped => RuntimeServiceState::AvailableButStopped,
            ServicePhase::Starting { .. } => RuntimeServiceState::Starting,
            ServicePhase::Ready { .. } if self.claims.is_empty() => RuntimeServiceState::Ready,
            ServicePhase::Ready { .. } => RuntimeServiceState::Busy,
            ServicePhase::Failed { .. } => RuntimeServiceState::Failed,
            ServicePhase::Stopping { .. } => RuntimeServiceState::Stopping,
        }
    }

    fn lease_counts(&self) -> (u32, u32) {
        let mut pending = 0;
        let mut active = 0;
        for claim in self.claims.values() {
            match claim.state {
                ServiceLeaseClaimState::Pending => pending += 1,
                ServiceLeaseClaimState::Active => active += 1,
            }
        }
        (pending, active)
    }

    fn schedule_idle_if_eligible(&mut self, now_ms: u64, effects: &mut ServiceLeaseEffects) {
        if self.idle_deadline.is_some()
            || !self.registration.permits_idle_stop()
            || !self.claims.is_empty()
        {
            return;
        }
        let ServicePhase::Ready { generation } = self.phase else {
            return;
        };
        let Some(idle_ttl_ms) = self.registration.idle_ttl_ms else {
            return;
        };
        let due_at_ms = now_ms.saturating_add(idle_ttl_ms).min(MAX_SQLITE_UNSIGNED);
        let deadline = IdleStopDeadline {
            service_id: self.registration.service_id.clone(),
            generation,
            due_at_ms,
            expected_pending_leases: 0,
            expected_active_leases: 0,
        };
        self.idle_deadline = Some(deadline.clone());
        effects.scheduled_idle_deadline = Some(deadline);
    }

    fn cancel_idle_deadline(&mut self, effects: &mut ServiceLeaseEffects) {
        let Some(deadline) = self.idle_deadline.take() else {
            return;
        };
        if effects.scheduled_idle_deadline.as_ref() == Some(&deadline) {
            effects.scheduled_idle_deadline = None;
        } else {
            effects.cancelled_idle_deadline = Some(deadline);
        }
    }

    fn resolve_all(
        &mut self,
        reason: ServiceLeaseReleaseReason,
        effects: &mut ServiceLeaseEffects,
    ) {
        let claims = std::mem::take(&mut self.claims);
        effects.resolved.extend(
            claims
                .into_values()
                .map(|claim| Self::resolution(claim, reason)),
        );
    }

    fn resolution(
        claim: ServiceLeaseClaim,
        reason: ServiceLeaseReleaseReason,
    ) -> ServiceLeaseResolution {
        ServiceLeaseResolution {
            lease_id: claim.lease_id,
            service_id: claim.service_id,
            generation: claim.generation,
            previous_state: claim.state,
            reason,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use breadboard_runtime_protocol::ResourceClass;

    fn definition(
        startup_policy: ServiceStartupPolicy,
        restart_policy: RestartPolicy,
    ) -> ServiceDefinition {
        ServiceDefinition {
            id: "search".into(),
            display_name: "Search".into(),
            capability_ids: vec!["search-query".into()],
            allowed_executable: "runtime/search.exe".into(),
            allowed_entrypoint: None,
            startup_policy,
            resource_class: ResourceClass::Core,
            dependencies: Vec::new(),
            estimated_cold_start_commit_mb: 64,
            soft_commit_limit_mb: 0,
            hard_commit_limit_mb: 0,
            idle_ttl_ms: matches!(
                startup_policy,
                ServiceStartupPolicy::OnDemand | ServiceStartupPolicy::Scheduled
            )
            .then_some(100),
            graceful_shutdown_ms: 1_000,
            restart_policy,
        }
    }

    fn machine_with(
        startup_policy: ServiceStartupPolicy,
        restart_policy: RestartPolicy,
        max_leases: u32,
        max_lease_ms: u64,
        max_restarts: u32,
    ) -> ServiceLeaseMachine {
        let limits = ServiceLeaseLimits::new(max_leases, max_lease_ms, max_restarts).unwrap();
        let registration = ServiceLeaseRegistration::from_definition(
            &definition(startup_policy, restart_policy),
            true,
            limits,
        )
        .unwrap();
        ServiceLeaseMachine::new(registration)
    }

    fn on_demand_machine() -> ServiceLeaseMachine {
        machine_with(
            ServiceStartupPolicy::OnDemand,
            RestartPolicy::OnFailure,
            4,
            1_000,
            2,
        )
    }

    fn acquire_and_ready(machine: &mut ServiceLeaseMachine, lease_id: &str, now_ms: u64) -> u64 {
        let acquired = machine.begin_acquire(lease_id, 500, now_ms).unwrap();
        let generation = acquired.claim.generation;
        machine.confirm_ready(generation, now_ms + 1).unwrap();
        generation
    }

    #[test]
    fn rejects_external_process_ownership() {
        let limits = ServiceLeaseLimits::new(4, 1_000, 2).unwrap();
        let error = ServiceLeaseRegistration::from_definition(
            &definition(ServiceStartupPolicy::External, RestartPolicy::Never),
            false,
            limits,
        )
        .unwrap_err();
        assert_eq!(
            error,
            ServiceLeaseError::ExternalOwnershipForbidden("search".into())
        );
    }

    #[test]
    fn status_reads_are_observational_and_never_start() {
        let machine = on_demand_machine();
        let before = machine.snapshot();
        assert_eq!(
            machine.status().state,
            RuntimeServiceState::AvailableButStopped
        );
        assert!(!machine.status().adopted);
        assert_eq!(machine.snapshot(), before);
        assert_eq!(machine.snapshot().generation, 0);
    }

    #[test]
    fn first_claim_starts_once_and_concurrent_claims_share_the_generation() {
        let mut machine = on_demand_machine();
        let first = machine.begin_acquire("lease_1", 500, 1).unwrap();
        assert_eq!(first.claim.state, ServiceLeaseClaimState::Pending);
        assert_eq!(first.effects.actions.len(), 1);
        assert_eq!(
            first.effects.actions[0],
            ServiceLeaseAction::StartTree {
                service_id: "search".into(),
                generation: 1,
            }
        );

        let second = machine.begin_acquire("lease_2", 500, 1).unwrap();
        assert_eq!(second.claim.state, ServiceLeaseClaimState::Pending);
        assert_eq!(second.claim.generation, first.claim.generation);
        assert!(second.effects.actions.is_empty());
        assert_eq!(machine.snapshot().pending_leases, 2);
        assert_eq!(machine.status().state, RuntimeServiceState::Starting);
    }

    #[test]
    fn readiness_activates_every_waiter_for_the_same_generation() {
        let mut machine = on_demand_machine();
        machine.begin_acquire("lease_1", 500, 1).unwrap();
        machine.begin_acquire("lease_2", 500, 1).unwrap();
        let effects = machine.confirm_ready(1, 2).unwrap();
        assert_eq!(effects.activated.len(), 2);
        assert!(effects
            .activated
            .iter()
            .all(|activation| activation.generation == 1));
        assert_eq!(machine.snapshot().pending_leases, 0);
        assert_eq!(machine.snapshot().active_leases, 2);
        assert_eq!(machine.status().state, RuntimeServiceState::Busy);
    }

    #[test]
    fn startup_failure_truthfully_rejects_and_removes_pending_claims() {
        let mut machine = on_demand_machine();
        machine.begin_acquire("lease_1", 500, 1).unwrap();
        machine.begin_acquire("lease_2", 500, 1).unwrap();
        let effects = machine.startup_failed(1, "readiness failed", 2).unwrap();
        assert_eq!(effects.resolved.len(), 2);
        assert!(effects.resolved.iter().all(|resolution| {
            resolution.reason == ServiceLeaseReleaseReason::Failure
                && resolution.previous_state == ServiceLeaseClaimState::Pending
        }));
        assert_eq!(machine.snapshot().pending_leases, 0);
        assert_eq!(machine.status().state, RuntimeServiceState::Failed);
        assert_eq!(
            machine.status().last_error.as_deref(),
            Some("readiness failed")
        );
    }

    #[test]
    fn active_leases_prevent_idle_stop_until_the_final_release() {
        let mut machine = on_demand_machine();
        machine.begin_acquire("lease_1", 500, 1).unwrap();
        machine.begin_acquire("lease_2", 500, 1).unwrap();
        machine.confirm_ready(1, 2).unwrap();

        let first = machine
            .release("lease_1", ServiceLeaseReleaseReason::Success, 3)
            .unwrap();
        assert!(first.effects.scheduled_idle_deadline.is_none());
        assert_eq!(machine.snapshot().active_leases, 1);

        let second = machine
            .release("lease_2", ServiceLeaseReleaseReason::Success, 4)
            .unwrap();
        assert!(second.effects.scheduled_idle_deadline.is_some());
        assert_eq!(machine.status().state, RuntimeServiceState::Ready);
    }

    #[test]
    fn pending_claim_protects_startup_and_claimless_readiness_arms_idle() {
        let mut machine = on_demand_machine();
        machine.begin_acquire("lease_1", 500, 1).unwrap();
        assert_eq!(machine.next_lease_expiry_ms(), Some(501));
        assert!(machine.snapshot().idle_deadline.is_none());

        let released = machine
            .release("lease_1", ServiceLeaseReleaseReason::Cancellation, 2)
            .unwrap();
        assert!(released.effects.actions.is_empty());
        assert!(released.effects.scheduled_idle_deadline.is_none());

        let ready = machine.confirm_ready(1, 3).unwrap();
        assert!(ready.activated.is_empty());
        assert!(ready.scheduled_idle_deadline.is_some());
        assert_eq!(machine.status().state, RuntimeServiceState::Ready);
    }

    #[test]
    fn every_release_reason_is_preserved_and_release_is_idempotent() {
        for reason in [
            ServiceLeaseReleaseReason::Success,
            ServiceLeaseReleaseReason::Failure,
            ServiceLeaseReleaseReason::Cancellation,
            ServiceLeaseReleaseReason::Disconnect,
            ServiceLeaseReleaseReason::Timeout,
            ServiceLeaseReleaseReason::Explicit,
        ] {
            let mut machine = on_demand_machine();
            acquire_and_ready(&mut machine, "lease_1", 1);
            let first = machine.release("lease_1", reason, 3).unwrap();
            assert_eq!(first.disposition, ServiceLeaseReleaseDisposition::Released);
            assert_eq!(first.effects.resolved.len(), 1);
            assert_eq!(first.effects.resolved[0].reason, reason);

            let repeated = machine.release("lease_1", reason, 4).unwrap();
            assert_eq!(
                repeated.disposition,
                ServiceLeaseReleaseDisposition::AlreadyReleased
            );
            assert!(repeated.effects.resolved.is_empty());
        }
    }

    #[test]
    fn max_expiry_is_enforced_and_expiration_schedules_dynamic_idle() {
        let mut machine = machine_with(
            ServiceStartupPolicy::OnDemand,
            RestartPolicy::OnFailure,
            4,
            50,
            2,
        );
        assert!(matches!(
            machine.begin_acquire("too_long", 51, 0),
            Err(ServiceLeaseError::InvalidLeaseDuration { .. })
        ));
        machine.begin_acquire("lease_1", 50, 0).unwrap();
        machine.confirm_ready(1, 1).unwrap();
        let effects = machine.advance_time(50).unwrap();
        assert_eq!(effects.resolved.len(), 1);
        assert_eq!(
            effects.resolved[0].reason,
            ServiceLeaseReleaseReason::Timeout
        );
        assert_eq!(effects.scheduled_idle_deadline.unwrap().due_at_ms, 150);
    }

    #[test]
    fn expired_pending_claim_is_not_activated() {
        let mut machine = on_demand_machine();
        machine.begin_acquire("lease_1", 10, 0).unwrap();
        let effects = machine.confirm_ready(1, 10).unwrap();
        assert!(effects.activated.is_empty());
        assert_eq!(effects.resolved.len(), 1);
        assert_eq!(
            effects.resolved[0].reason,
            ServiceLeaseReleaseReason::Timeout
        );
        assert!(effects.scheduled_idle_deadline.is_some());
        assert_eq!(machine.status().state, RuntimeServiceState::Ready);
    }

    #[test]
    fn reacquire_cancels_idle_and_makes_the_old_timer_harmless() {
        let mut machine = on_demand_machine();
        acquire_and_ready(&mut machine, "lease_1", 1);
        let released = machine
            .release("lease_1", ServiceLeaseReleaseReason::Success, 3)
            .unwrap();
        let stale = released.effects.scheduled_idle_deadline.unwrap();

        let reacquired = machine.begin_acquire("lease_2", 500, 4).unwrap();
        assert_eq!(reacquired.claim.state, ServiceLeaseClaimState::Active);
        assert_eq!(
            reacquired.effects.cancelled_idle_deadline,
            Some(stale.clone())
        );
        let timer = machine.on_idle_deadline(&stale, stale.due_at_ms).unwrap();
        assert!(timer.actions.is_empty());
        assert_eq!(machine.status().state, RuntimeServiceState::Busy);
    }

    #[test]
    fn idle_stop_requires_the_exact_generation_state_and_zero_counts() {
        let mut machine = on_demand_machine();
        acquire_and_ready(&mut machine, "lease_1", 1);
        let released = machine
            .release("lease_1", ServiceLeaseReleaseReason::Explicit, 3)
            .unwrap();
        let deadline = released.effects.scheduled_idle_deadline.unwrap();

        let mut forged = deadline.clone();
        forged.expected_active_leases = 1;
        let ignored = machine
            .on_idle_deadline(&forged, deadline.due_at_ms)
            .unwrap();
        assert!(ignored.actions.is_empty());
        assert_eq!(machine.status().state, RuntimeServiceState::Ready);

        let effects = machine
            .on_idle_deadline(&deadline, deadline.due_at_ms)
            .unwrap();
        assert_eq!(
            effects.actions,
            vec![ServiceLeaseAction::StopTree {
                service_id: "search".into(),
                generation: 1,
                cause: ServiceStopCause::Idle,
            }]
        );
        assert_eq!(machine.status().state, RuntimeServiceState::Stopping);
    }

    #[test]
    fn tree_exit_confirmation_returns_available_but_stopped() {
        let mut machine = on_demand_machine();
        let generation = acquire_and_ready(&mut machine, "lease_1", 1);
        let confirmation = machine
            .confirm_tree_exit(
                generation,
                ServiceLeaseReleaseReason::Disconnect,
                Some("tree exited"),
                3,
            )
            .unwrap();
        assert_eq!(
            confirmation.status.state,
            RuntimeServiceState::AvailableButStopped
        );
        assert_eq!(confirmation.effects.resolved.len(), 1);
        assert_eq!(machine.snapshot().active_leases, 0);

        let repeated = machine
            .confirm_tree_exit(
                generation,
                ServiceLeaseReleaseReason::Disconnect,
                Some("tree exited"),
                4,
            )
            .unwrap();
        assert!(repeated.effects.resolved.is_empty());
        assert_eq!(
            repeated.status.state,
            RuntimeServiceState::AvailableButStopped
        );
    }

    #[test]
    fn shutdown_closes_acquisition_resolves_claims_and_requests_one_stop() {
        let mut machine = on_demand_machine();
        acquire_and_ready(&mut machine, "lease_1", 1);
        machine.begin_acquire("lease_2", 500, 2).unwrap();
        let effects = machine.begin_shutdown(3).unwrap();
        assert_eq!(effects.resolved.len(), 2);
        assert!(effects
            .resolved
            .iter()
            .all(|resolution| { resolution.reason == ServiceLeaseReleaseReason::Cancellation }));
        assert_eq!(
            effects.actions,
            vec![ServiceLeaseAction::StopTree {
                service_id: "search".into(),
                generation: 1,
                cause: ServiceStopCause::Shutdown,
            }]
        );
        assert_eq!(machine.status().state, RuntimeServiceState::Stopping);
        assert!(matches!(
            machine.begin_acquire("late", 100, 4),
            Err(ServiceLeaseError::AcquisitionClosed(_))
        ));
        assert!(machine.begin_shutdown(4).unwrap().actions.is_empty());

        let confirmation = machine
            .confirm_tree_exit(1, ServiceLeaseReleaseReason::Cancellation, None, 5)
            .unwrap();
        assert_eq!(
            confirmation.status.state,
            RuntimeServiceState::AvailableButStopped
        );
    }

    #[test]
    fn only_dynamic_policies_schedule_idle_deadlines() {
        let mut scheduled = machine_with(
            ServiceStartupPolicy::Scheduled,
            RestartPolicy::OnFailure,
            4,
            1_000,
            2,
        );
        acquire_and_ready(&mut scheduled, "scheduled_lease", 1);
        assert!(scheduled
            .release("scheduled_lease", ServiceLeaseReleaseReason::Success, 3)
            .unwrap()
            .effects
            .scheduled_idle_deadline
            .is_some());

        let mut eager = machine_with(
            ServiceStartupPolicy::Eager,
            RestartPolicy::OnFailure,
            4,
            1_000,
            2,
        );
        let start = eager.begin_eager_start(1).unwrap();
        assert_eq!(start.actions.len(), 1);
        assert!(eager.begin_eager_start(1).unwrap().actions.is_empty());
        eager.confirm_ready(1, 2).unwrap();
        eager.begin_acquire("eager_lease", 500, 3).unwrap();
        let release = eager
            .release("eager_lease", ServiceLeaseReleaseReason::Success, 4)
            .unwrap();
        assert!(release.effects.scheduled_idle_deadline.is_none());
        assert_eq!(eager.status().state, RuntimeServiceState::Ready);
    }

    #[test]
    fn lease_count_id_duration_time_and_restart_bounds_are_enforced() {
        assert!(ServiceLeaseLimits::new(0, 100, 0).is_err());
        assert!(ServiceLeaseLimits::new(MAX_CONCURRENCY + 1, 100, 0).is_err());
        assert!(ServiceLeaseLimits::new(1, MAX_TIMEOUT_MS + 1, 0).is_err());
        assert!(ServiceLeaseLimits::new(1, 100, MAX_CONCURRENCY + 1).is_err());

        let mut machine = machine_with(
            ServiceStartupPolicy::OnDemand,
            RestartPolicy::OnFailure,
            1,
            100,
            1,
        );
        assert!(machine.begin_acquire(&"x".repeat(129), 10, 0).is_err());
        machine.begin_acquire("lease_1", 10, 0).unwrap();
        assert!(matches!(
            machine.begin_acquire("lease_2", 10, 0),
            Err(ServiceLeaseError::LeaseLimitReached { .. })
        ));
        assert!(matches!(
            machine.begin_acquire("overflow", 1, MAX_SQLITE_UNSIGNED),
            Err(ServiceLeaseError::LeaseExpiryOverflow)
        ));

        machine.startup_failed(1, "failed once", 1).unwrap();
        let restarted = machine.begin_acquire("lease_2", 10, 2).unwrap();
        assert_eq!(restarted.claim.generation, 2);
        assert_eq!(machine.status().restarts, 1);
        machine.startup_failed(2, "failed twice", 3).unwrap();
        assert!(matches!(
            machine.begin_acquire("lease_3", 10, 4),
            Err(ServiceLeaseError::RestartLimitReached { .. })
        ));
    }

    #[test]
    fn restart_policy_never_is_fail_closed_after_start_failure() {
        let mut machine = machine_with(
            ServiceStartupPolicy::OnDemand,
            RestartPolicy::Never,
            4,
            1_000,
            2,
        );
        machine.begin_acquire("lease_1", 500, 1).unwrap();
        machine.startup_failed(1, "failed", 2).unwrap();
        assert!(matches!(
            machine.begin_acquire("lease_2", 500, 3),
            Err(ServiceLeaseError::RestartForbidden(_))
        ));
    }

    #[test]
    fn stale_generations_and_backwards_time_are_rejected_atomically() {
        let mut machine = on_demand_machine();
        machine.begin_acquire("lease_1", 500, 10).unwrap();
        let before = machine.snapshot();
        assert!(matches!(
            machine.confirm_ready(2, 11),
            Err(ServiceLeaseError::StaleGeneration { .. })
        ));
        assert_eq!(machine.snapshot(), before);
        assert!(matches!(
            machine.advance_time(9),
            Err(ServiceLeaseError::ClockMovedBackwards { .. })
        ));
        assert_eq!(machine.snapshot(), before);
    }
}
