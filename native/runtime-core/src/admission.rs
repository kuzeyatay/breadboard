use breadboard_runtime_protocol::ResourceClass;
use serde::{Deserialize, Serialize};

/// Runtime V2 never authorizes new work below this system-commit reserve.
/// Trusted configuration may raise either policy reserve, but no constructor
/// available to downstream callers can reduce them below this floor.
pub const ADMISSION_RESERVE_FLOOR_MB: u64 = 8 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemCommit {
    pub total_mb: u64,
    pub limit_mb: u64,
}

impl SystemCommit {
    pub fn free_mb(self) -> u64 {
        self.limit_mb.saturating_sub(self.total_mb)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeLoad {
    pub accepting_work: bool,
    pub active_job_classes: Vec<ResourceClass>,
    pub active_service_classes: Vec<ResourceClass>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdmissionRequest {
    pub resource_class: ResourceClass,
    pub estimated_cold_start_commit_mb: u64,
    pub reserve_floor_mb: Option<u64>,
}

/// Admission data derived from a validated worker registry entry. Its fields
/// are private so callers cannot lower a worker's configured estimate or raise
/// its concurrency while asking the durable store to admit a job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredJobAdmission {
    pub(crate) job_type: String,
    pub(crate) definition_key: String,
    pub(crate) resource_class: ResourceClass,
    pub(crate) estimated_cold_start_commit_mb: u64,
    pub(crate) maximum_concurrency: u32,
}

impl RegisteredJobAdmission {
    pub(crate) fn new(
        job_type: &str,
        definition_key: &str,
        resource_class: ResourceClass,
        estimated_cold_start_commit_mb: u64,
        maximum_concurrency: u32,
    ) -> Self {
        Self {
            job_type: job_type.to_string(),
            definition_key: definition_key.to_string(),
            resource_class,
            estimated_cold_start_commit_mb,
            maximum_concurrency,
        }
    }

    pub fn job_type(&self) -> &str {
        &self.job_type
    }

    pub fn definition_key(&self) -> &str {
        &self.definition_key
    }

    pub fn resource_class(&self) -> ResourceClass {
        self.resource_class
    }

    pub fn estimated_cold_start_commit_mb(&self) -> u64 {
        self.estimated_cold_start_commit_mb
    }

    pub fn maximum_concurrency(&self) -> u32 {
        self.maximum_concurrency
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AdmissionPolicy {
    pub(crate) minimum_reserve_mb: u64,
    pub(crate) critical_reserve_mb: u64,
    pub(crate) one_heavyweight_at_a_time: bool,
}

impl Default for AdmissionPolicy {
    fn default() -> Self {
        Self::with_reserve_floors(
            ADMISSION_RESERVE_FLOOR_MB,
            ADMISSION_RESERVE_FLOOR_MB,
        )
    }
}

/// One admission decision with private diagnostic evidence. In the durable job
/// path, `retryable: false` is terminal resource exhaustion except for the
/// exact runtime-shutdown gate constructed below.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdmissionDenial {
    pub code: String,
    pub resource: String,
    pub required_headroom_mb: u64,
    pub available_headroom_mb: u64,
    pub retryable: bool,
    pub reason: String,
}

impl AdmissionDenial {
    /// Constructs the one non-retryable denial that is a runtime lifecycle
    /// gate rather than a terminal resource decision. The durable store keeps
    /// this denial queued so shutdown can finish without manufacturing failed
    /// jobs; every other non-retryable denial is persisted as resource
    /// exhaustion before admission returns.
    pub(crate) fn runtime_shutdown_gate(
        required_headroom_mb: u64,
        available_headroom_mb: u64,
    ) -> Self {
        Self {
            code: "BREADBOARD_RUNTIME_SHUTTING_DOWN".into(),
            resource: "runtime".into(),
            required_headroom_mb,
            available_headroom_mb,
            retryable: false,
            reason: "runtime is not accepting new work".into(),
        }
    }

    /// This exact semantic marker prevents the shutdown exception from
    /// swallowing an unrelated permanent denial that merely names the runtime
    /// as its resource.
    pub(crate) fn is_runtime_shutdown_gate(&self) -> bool {
        self.code == "BREADBOARD_RUNTIME_SHUTTING_DOWN"
            && self.resource == "runtime"
            && !self.retryable
            && self.reason == "runtime is not accepting new work"
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdmissionDecision {
    Admitted,
    Denied(AdmissionDenial),
}

impl AdmissionPolicy {
    pub fn minimum_reserve_mb(self) -> u64 {
        self.minimum_reserve_mb
    }

    pub fn critical_reserve_mb(self) -> u64 {
        self.critical_reserve_mb
    }

    pub fn one_heavyweight_at_a_time(self) -> bool {
        self.one_heavyweight_at_a_time
    }

    /// This seam is crate-private because reserve configuration is resource
    /// authority. Both inputs are clamped so even a malformed future trusted
    /// configuration fails safe instead of weakening the architecture floor.
    pub(crate) fn with_reserve_floors(
        minimum_reserve_mb: u64,
        critical_reserve_mb: u64,
    ) -> Self {
        Self {
            minimum_reserve_mb: minimum_reserve_mb.max(ADMISSION_RESERVE_FLOOR_MB),
            critical_reserve_mb: critical_reserve_mb.max(ADMISSION_RESERVE_FLOOR_MB),
            one_heavyweight_at_a_time: true,
        }
    }

    /// Evaluates one already-serialized snapshot. This is useful for reporting
    /// and tests, but it is not an authorization boundary; production callers
    /// must use `AdmissionGovernor::try_admit_job` so the native sample and
    /// reservation are protected by the durable admission transaction.
    pub fn decide(
        self,
        request: AdmissionRequest,
        commit: SystemCommit,
        load: &RuntimeLoad,
    ) -> AdmissionDecision {
        let reserve = self
            .minimum_reserve_mb
            .max(request.reserve_floor_mb.unwrap_or(0));
        let required = reserve.saturating_add(request.estimated_cold_start_commit_mb);
        let available = commit.free_mb();
        if !load.accepting_work {
            return AdmissionDecision::Denied(AdmissionDenial::runtime_shutdown_gate(
                required, available,
            ));
        }
        if available <= self.critical_reserve_mb {
            return AdmissionDecision::Denied(AdmissionDenial {
                code: "BREADBOARD_RESOURCE_EXHAUSTED".into(),
                resource: "windows_commit_critical".into(),
                required_headroom_mb: self.critical_reserve_mb.saturating_add(1),
                available_headroom_mb: available,
                retryable: false,
                reason: "Windows commit headroom is already at the critical reserve".into(),
            });
        }
        if request.resource_class.is_heavyweight()
            && self.one_heavyweight_at_a_time
            && load
                .active_job_classes
                .iter()
                .chain(load.active_service_classes.iter())
                .any(|class| class.is_heavyweight())
        {
            return AdmissionDecision::Denied(AdmissionDenial {
                code: "BREADBOARD_RESOURCE_EXHAUSTED".into(),
                resource: "heavyweight_concurrency".into(),
                required_headroom_mb: required,
                available_headroom_mb: available,
                retryable: false,
                reason: "another heavyweight class is active".into(),
            });
        }
        if available < required {
            return AdmissionDecision::Denied(AdmissionDenial {
                code: "BREADBOARD_RESOURCE_EXHAUSTED".into(),
                resource: "windows_commit".into(),
                required_headroom_mb: required,
                available_headroom_mb: available,
                retryable: false,
                reason: "Windows commit reserve would be violated".into(),
            });
        }
        AdmissionDecision::Admitted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_load() -> RuntimeLoad {
        RuntimeLoad {
            accepting_work: true,
            active_job_classes: vec![],
            active_service_classes: vec![],
        }
    }

    #[test]
    fn commit_headroom_includes_reserve_and_cold_start() {
        let result = AdmissionPolicy::default().decide(
            AdmissionRequest {
                resource_class: ResourceClass::DocumentProcessing,
                estimated_cold_start_commit_mb: 2048,
                reserve_floor_mb: None,
            },
            SystemCommit {
                total_mb: 33_000,
                limit_mb: 42_000,
            },
            &empty_load(),
        );
        let AdmissionDecision::Denied(denial) = result else {
            panic!("expected denial")
        };
        assert_eq!(denial.required_headroom_mb, 10_240);
        assert_eq!(denial.available_headroom_mb, 9_000);
        assert!(!denial.retryable);
    }

    #[test]
    fn a_second_heavyweight_class_is_denied() {
        let mut load = empty_load();
        load.active_job_classes.push(ResourceClass::LargeGeneration);
        let result = AdmissionPolicy::default().decide(
            AdmissionRequest {
                resource_class: ResourceClass::BrowserAutomation,
                estimated_cold_start_commit_mb: 1024,
                reserve_floor_mb: None,
            },
            SystemCommit {
                total_mb: 20_000,
                limit_mb: 42_000,
            },
            &load,
        );
        assert!(matches!(result, AdmissionDecision::Denied(_)));
    }

    #[test]
    fn a_request_cannot_lower_the_configured_reserve() {
        let result = AdmissionPolicy::default().decide(
            AdmissionRequest {
                resource_class: ResourceClass::Core,
                estimated_cold_start_commit_mb: 1024,
                reserve_floor_mb: Some(0),
            },
            SystemCommit {
                total_mb: 33_500,
                limit_mb: 42_000,
            },
            &empty_load(),
        );
        let AdmissionDecision::Denied(denial) = result else {
            panic!("expected denial")
        };
        assert_eq!(denial.required_headroom_mb, 9_216);
    }

    #[test]
    fn policy_construction_clamps_both_architecture_reserves() {
        let policy = AdmissionPolicy::with_reserve_floors(0, 1);
        assert_eq!(
            policy.minimum_reserve_mb(),
            ADMISSION_RESERVE_FLOOR_MB
        );
        assert_eq!(
            policy.critical_reserve_mb(),
            ADMISSION_RESERVE_FLOOR_MB
        );
        assert!(policy.one_heavyweight_at_a_time());
    }

    #[test]
    fn shutdown_gate_is_distinct_from_permanent_resource_denials() {
        let mut load = empty_load();
        load.accepting_work = false;
        let AdmissionDecision::Denied(shutdown) = AdmissionPolicy::default().decide(
            AdmissionRequest {
                resource_class: ResourceClass::Core,
                estimated_cold_start_commit_mb: 128,
                reserve_floor_mb: None,
            },
            SystemCommit {
                total_mb: 0,
                limit_mb: 64 * 1024,
            },
            &load,
        ) else {
            panic!("expected shutdown gate")
        };
        assert!(shutdown.is_runtime_shutdown_gate());

        let permanent = AdmissionDenial {
            code: "BREADBOARD_RESOURCE_EXHAUSTED".into(),
            resource: "runtime".into(),
            required_headroom_mb: 8_192,
            available_headroom_mb: 4_096,
            retryable: false,
            reason: "runtime resource authority rejected the request".into(),
        };
        assert!(!permanent.is_runtime_shutdown_gate());
    }
}
