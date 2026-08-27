use breadboard_runtime_protocol::{ResourceClass, RuntimeMode};
use serde::{Deserialize, Serialize};

/// Packaged Runtime V2 admission never authorizes jobs or services below this
/// system-commit reserve. Development modes use the bounded adaptive reserve
/// below so the compiler and finite workers can share machines with smaller
/// commit limits without weakening packaged acceptance.
pub const ADMISSION_RESERVE_FLOOR_MB: u64 = 8 * 1024;

// Development admission and the Hot dashboard's live supervisor guard share
// this formula: preserve at least 4 GiB, otherwise 10% of the machine's commit
// limit (bounded to 1.5-8 GiB), plus a 256 MiB sampling/growth guard. Every
// process tree still has its independently enforced manifest hard limit.
const DEVELOPMENT_RESERVE_FLOOR_MB: u64 = 4 * 1024;
const DEVELOPMENT_DERIVED_RESERVE_MIN_MB: u64 = 1536;
const DEVELOPMENT_DERIVED_RESERVE_MAX_MB: u64 = 8 * 1024;
const DEVELOPMENT_RESERVE_GUARD_MB: u64 = 256;

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
    /// Finite job reservations retain their class until complete tree exit.
    pub active_job_classes: Vec<ResourceClass>,
    /// Service cold-start/restart holds only. Ready resident services are
    /// already included in the live system-commit sample and are not counted
    /// a second time as a static class hold.
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
    pub(crate) reserve_strategy: AdmissionReserveStrategy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AdmissionReserveStrategy {
    Fixed,
    Development,
}

impl Default for AdmissionPolicy {
    fn default() -> Self {
        Self::with_reserve_floors(ADMISSION_RESERVE_FLOOR_MB, ADMISSION_RESERVE_FLOOR_MB)
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
    pub(crate) fn with_reserve_floors(minimum_reserve_mb: u64, critical_reserve_mb: u64) -> Self {
        Self {
            minimum_reserve_mb: minimum_reserve_mb.max(ADMISSION_RESERVE_FLOOR_MB),
            critical_reserve_mb: critical_reserve_mb.max(ADMISSION_RESERVE_FLOOR_MB),
            one_heavyweight_at_a_time: true,
            reserve_strategy: AdmissionReserveStrategy::Fixed,
        }
    }

    /// Development process trees retain manifest hard caps, serialized pending
    /// commit estimates, a live commit sample at each durable reservation, and
    /// the supervisor's single cross-process dynamic-burst lease. Static class
    /// serialization is therefore unnecessary in development: independent
    /// bounded trees may coexist only while measured commit headroom fits.
    /// Packaged mode keeps the fixed architecture reserve and conservative
    /// class serialization above.
    pub(crate) fn for_runtime_mode(mode: RuntimeMode) -> Self {
        if mode == RuntimeMode::Packaged {
            return Self::default();
        }
        Self {
            minimum_reserve_mb: DEVELOPMENT_RESERVE_FLOOR_MB,
            critical_reserve_mb: DEVELOPMENT_RESERVE_FLOOR_MB,
            one_heavyweight_at_a_time: false,
            reserve_strategy: AdmissionReserveStrategy::Development,
        }
    }

    fn effective_reserve_mb(self, commit_limit_mb: u64) -> u64 {
        match self.reserve_strategy {
            AdmissionReserveStrategy::Fixed => self.minimum_reserve_mb,
            AdmissionReserveStrategy::Development => {
                let derived_reserve_mb = (commit_limit_mb / 10).clamp(
                    DEVELOPMENT_DERIVED_RESERVE_MIN_MB,
                    DEVELOPMENT_DERIVED_RESERVE_MAX_MB,
                );
                DEVELOPMENT_RESERVE_FLOOR_MB
                    .max(derived_reserve_mb)
                    .saturating_add(DEVELOPMENT_RESERVE_GUARD_MB)
            }
        }
    }

    fn effective_critical_reserve_mb(self, commit_limit_mb: u64) -> u64 {
        match self.reserve_strategy {
            AdmissionReserveStrategy::Fixed => self.critical_reserve_mb,
            AdmissionReserveStrategy::Development => self.effective_reserve_mb(commit_limit_mb),
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
            .effective_reserve_mb(commit.limit_mb)
            .max(request.reserve_floor_mb.unwrap_or(0));
        let critical_reserve = self.effective_critical_reserve_mb(commit.limit_mb);
        let required = reserve.saturating_add(request.estimated_cold_start_commit_mb);
        let available = commit.free_mb();
        if !load.accepting_work {
            return AdmissionDecision::Denied(AdmissionDenial::runtime_shutdown_gate(
                required, available,
            ));
        }
        if available <= critical_reserve {
            return AdmissionDecision::Denied(AdmissionDenial {
                code: "BREADBOARD_RESOURCE_EXHAUSTED".into(),
                resource: "windows_commit_critical".into(),
                required_headroom_mb: critical_reserve.saturating_add(1),
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
        // Equality is not enough: consuming the full cold-start estimate from
        // an exactly-sized allowance would leave free commit at the reserve,
        // while Runtime V2's invariant is that it remains strictly above it.
        if available <= required {
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
    fn development_heavyweights_follow_live_headroom_while_packaged_stays_serialized() {
        let mut load = empty_load();
        load.active_service_classes
            .push(ResourceClass::BrowserAutomation);
        let policy = AdmissionPolicy::for_runtime_mode(RuntimeMode::Hot);
        let request = AdmissionRequest {
            resource_class: ResourceClass::LargeGeneration,
            estimated_cold_start_commit_mb: 1_536,
            reserve_floor_mb: None,
        };
        let sufficient = SystemCommit {
            total_mb: 40_221 - 8_706,
            limit_mb: 40_221,
        };

        assert_eq!(
            policy.decide(request, sufficient, &load),
            AdmissionDecision::Admitted
        );
        let AdmissionDecision::Denied(packaged) =
            AdmissionPolicy::default().decide(request, sufficient, &load)
        else {
            panic!("packaged admission must retain static class serialization")
        };
        assert_eq!(packaged.resource, "heavyweight_concurrency");

        // 40,221 MiB derives the 4,352 MiB guarded development reserve.
        // Equality with that reserve plus Hermes' 1,536 MiB estimate remains
        // fail-closed even though the static class gate is disabled.
        let exact_allowance = SystemCommit {
            total_mb: 40_221 - 5_888,
            limit_mb: 40_221,
        };
        let AdmissionDecision::Denied(pressure) = policy.decide(request, exact_allowance, &load)
        else {
            panic!("actual commit pressure must still deny the second tree")
        };
        assert_eq!(pressure.resource, "windows_commit");
        assert_eq!(pressure.required_headroom_mb, 5_888);
        assert_eq!(pressure.available_headroom_mb, 5_888);
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
    fn exact_reserve_plus_cold_start_headroom_is_denied() {
        let reserve = ADMISSION_RESERVE_FLOOR_MB;
        let estimate = 4_096;
        let AdmissionDecision::Denied(denial) = AdmissionPolicy::default().decide(
            AdmissionRequest {
                resource_class: ResourceClass::Core,
                estimated_cold_start_commit_mb: estimate,
                reserve_floor_mb: None,
            },
            SystemCommit {
                total_mb: 20_000,
                limit_mb: 20_000 + reserve + estimate,
            },
            &empty_load(),
        ) else {
            panic!("exact equality must not be admitted")
        };
        assert_eq!(denial.required_headroom_mb, reserve + estimate);
        assert_eq!(denial.available_headroom_mb, reserve + estimate);
        assert_eq!(denial.resource, "windows_commit");
    }

    #[test]
    fn policy_construction_clamps_both_architecture_reserves() {
        let policy = AdmissionPolicy::with_reserve_floors(0, 1);
        assert_eq!(policy.minimum_reserve_mb(), ADMISSION_RESERVE_FLOOR_MB);
        assert_eq!(policy.critical_reserve_mb(), ADMISSION_RESERVE_FLOOR_MB);
        assert!(policy.one_heavyweight_at_a_time());
    }

    #[test]
    fn development_reserve_tracks_commit_limit_and_includes_guard_band() {
        let policy = AdmissionPolicy::for_runtime_mode(RuntimeMode::Hot);
        let estimate = 3_072;

        for (commit_limit_mb, protected_reserve_mb) in
            [(20 * 1024, 4_352), (60 * 1024, 6_400), (100 * 1024, 8_448)]
        {
            let required = protected_reserve_mb + estimate;
            let request = AdmissionRequest {
                resource_class: ResourceClass::Core,
                estimated_cold_start_commit_mb: estimate,
                reserve_floor_mb: None,
            };
            let exactly_sized = SystemCommit {
                total_mb: commit_limit_mb - required,
                limit_mb: commit_limit_mb,
            };
            let AdmissionDecision::Denied(denial) =
                policy.decide(request, exactly_sized, &empty_load())
            else {
                panic!("the exact protected reserve plus estimate must be denied")
            };
            assert_eq!(denial.required_headroom_mb, required);
            assert_eq!(denial.available_headroom_mb, required);
            assert_eq!(denial.resource, "windows_commit");

            let one_mb_more = SystemCommit {
                total_mb: exactly_sized.total_mb - 1,
                limit_mb: commit_limit_mb,
            };
            assert_eq!(
                policy.decide(request, one_mb_more, &empty_load()),
                AdmissionDecision::Admitted
            );
        }
    }

    #[test]
    fn packaged_mode_retains_the_fixed_architecture_reserve() {
        let request = AdmissionRequest {
            resource_class: ResourceClass::DocumentProcessing,
            estimated_cold_start_commit_mb: 4_096,
            reserve_floor_mb: None,
        };
        let commit = SystemCommit {
            total_mb: 40 * 1024 - 9_000,
            limit_mb: 40 * 1024,
        };

        assert_eq!(
            AdmissionPolicy::for_runtime_mode(RuntimeMode::Lean).decide(
                request,
                commit,
                &empty_load()
            ),
            AdmissionDecision::Admitted
        );
        assert_eq!(
            AdmissionPolicy::for_runtime_mode(RuntimeMode::Hot).decide(
                request,
                commit,
                &empty_load()
            ),
            AdmissionDecision::Admitted
        );
        let AdmissionDecision::Denied(denial) = AdmissionPolicy::for_runtime_mode(
            RuntimeMode::Packaged,
        )
        .decide(request, commit, &empty_load()) else {
            panic!("packaged admission must retain the fixed reserve")
        };
        assert_eq!(denial.required_headroom_mb, 12_288);
        assert_eq!(denial.available_headroom_mb, 9_000);
    }

    #[test]
    fn recorded_development_document_headroom_is_admitted_without_weakening_packaged() {
        let request = AdmissionRequest {
            resource_class: ResourceClass::DocumentProcessing,
            estimated_cold_start_commit_mb: 4_096,
            reserve_floor_mb: None,
        };
        let recorded = SystemCommit {
            total_mb: 40_221 - 9_249,
            limit_mb: 40_221,
        };

        for mode in [RuntimeMode::Lean, RuntimeMode::Hot] {
            assert_eq!(
                AdmissionPolicy::for_runtime_mode(mode).decide(request, recorded, &empty_load()),
                AdmissionDecision::Admitted
            );
        }
        let AdmissionDecision::Denied(packaged) = AdmissionPolicy::for_runtime_mode(
            RuntimeMode::Packaged,
        )
        .decide(request, recorded, &empty_load()) else {
            panic!("the recorded packaged sample must remain denied")
        };
        assert_eq!(packaged.required_headroom_mb, 12_288);
        assert_eq!(packaged.available_headroom_mb, 9_249);

        let development_required = 4_352 + 4_096;
        let equality = SystemCommit {
            total_mb: recorded.limit_mb - development_required,
            limit_mb: recorded.limit_mb,
        };
        let AdmissionDecision::Denied(equality_denial) = AdmissionPolicy::for_runtime_mode(
            RuntimeMode::Hot,
        )
        .decide(request, equality, &empty_load()) else {
            panic!("development reserve equality must fail closed")
        };
        assert_eq!(equality_denial.required_headroom_mb, development_required);
        assert_eq!(equality_denial.available_headroom_mb, development_required);
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
