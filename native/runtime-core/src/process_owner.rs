use crate::{
    paths::PreparedWorkerStart,
    service_environment::{
        TrustedServiceEnvironment, TrustedServiceEnvironmentProfile, TrustedWorkerEnvironment,
    },
    CurrentGenerationMembership, PathError, RuntimeGenerationScope, RuntimePaths, TrustedFilePin,
    TrustedLaunchDirectory, WorkerDispatchClaim,
};
use breadboard_runtime_protocol::{
    parse_worker_event, validate_identifier, ServiceHttpReadiness, WorkerEvent,
    WorkerExecutionScope, WorkerIdentity, MAX_CONTROL_TOKEN_BYTES,
    MAX_PROTOCOL_LINE_BYTES as MAX_WORKER_EVENT_LINE_BYTES, MIN_CONTROL_TOKEN_BYTES,
};
use serde_json::Value;
use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io::{self, BufRead, BufReader, Read, Write};
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(test)]
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, ExitStatus};
#[cfg(windows)]
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError};
use std::time::{Duration, Instant};
use thiserror::Error;

pub const RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE: u32 = 73;
pub const MAX_PROCESS_OWNER_PROTOCOL_LINE_BYTES: u64 = 64 * 1024;
const MAX_TARGET_ARGUMENTS: usize = 4_096;
const MAX_BUFFERED_PROCESS_OWNER_EVENTS: usize = 32;
const MAX_PRIVATE_DIAGNOSTIC_RECORDS: usize = 16;
const MAX_PRIVATE_DIAGNOSTIC_BYTES: usize = 256 * 1024;
const MAX_DURABLE_SERVICE_DIAGNOSTIC_BYTES: usize = 512 * 1024;
const MAX_DURABLE_WORKER_DIAGNOSTIC_BYTES: usize = 256 * 1024;
const MAX_SUPERVISOR_FAILURE_CODE_BYTES: usize = 64;
const MAX_SUPERVISOR_FAILURE_MESSAGE_BYTES: usize = 128;
const MAX_SUPERVISOR_FAILURE_DIAGNOSTIC_BYTES: usize = "failure-code=".len()
    + MAX_SUPERVISOR_FAILURE_CODE_BYTES
    + " failure-message=".len()
    + MAX_SUPERVISOR_FAILURE_MESSAGE_BYTES;
const UNCLASSIFIED_SUPERVISOR_FAILURE_CODE: &str = "UNCLASSIFIED_SUPERVISOR_FAILURE";
const UNCLASSIFIED_SUPERVISOR_FAILURE_MESSAGE: &str =
    "Authoritative process supervision failed with an unclassified code";
pub const MIN_PROCESS_OWNER_GRACEFUL_SHUTDOWN: Duration = Duration::from_millis(100);
pub const MAX_PROCESS_OWNER_GRACEFUL_SHUTDOWN: Duration = Duration::from_secs(300);
const MIN_SUPERVISOR_EXIT_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_SUPERVISOR_EXIT_TIMEOUT: Duration = Duration::from_secs(30);
const SUPERVISOR_TERMINAL_CLEANUP_BUDGET: Duration = Duration::from_secs(8);
const MAX_PROCESS_OWNER_EVENT_WAIT: Duration = Duration::from_secs(24 * 60 * 60);
const FORCED_REAP_TIMEOUT: Duration = Duration::from_secs(1);
const CHILD_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(10);
const SUPERVISOR_ACTIVATION_RECORD: &[u8] = b"{\"type\":\"activate\",\"protocolVersion\":1}\n";
const MEBIBYTE_BYTES: u64 = 1024 * 1024;
pub(crate) const DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB: u64 = 4 * 1024;
const SYSTEM_COMMIT_RESERVE_FLOOR_BYTES: u64 =
    DEVELOPMENT_SYSTEM_COMMIT_RESERVE_MB * MEBIBYTE_BYTES;
const SYSTEM_COMMIT_DERIVED_RESERVE_MIN_BYTES: u64 = 1536 * MEBIBYTE_BYTES;
const SYSTEM_COMMIT_DERIVED_RESERVE_MAX_BYTES: u64 = 8 * 1024 * MEBIBYTE_BYTES;
const SYSTEM_COMMIT_RESERVE_GUARD_BAND_BYTES: u64 = 256 * MEBIBYTE_BYTES;
const SYSTEM_COMMIT_DYNAMIC_BURST_MULTIPLIER: u64 = 4;
const SYSTEM_COMMIT_DYNAMIC_BURST_MAX_BYTES: u64 = 32 * 1024 * MEBIBYTE_BYTES;

fn dynamic_commit_burst_ceiling(configured_hard_limit_bytes: u64) -> u64 {
    configured_hard_limit_bytes
        .saturating_mul(SYSTEM_COMMIT_DYNAMIC_BURST_MULTIPLIER)
        .min(SYSTEM_COMMIT_DYNAMIC_BURST_MAX_BYTES)
        .max(configured_hard_limit_bytes)
}

#[derive(Debug, Error)]
pub enum ProcessOwnerError {
    #[error(transparent)]
    Path(#[from] PathError),
    #[error("trusted process launch is invalid: {0}")]
    InvalidLaunch(&'static str),
    #[error("authoritative process owner is in an invalid state: {0}")]
    InvalidState(&'static str),
    #[error("a required trusted process environment variable is unavailable")]
    MissingEnvironment,
    #[error("authoritative process owner is unsupported on this platform")]
    UnsupportedPlatform,
    #[error("authoritative process supervisor could not be started")]
    Spawn(#[source] io::Error),
    #[error("authoritative process supervisor could not enter the outer generation job")]
    GenerationContainment(#[source] io::Error),
    #[error("process launch authorities belong to different Runtime V2 data roots")]
    GenerationScopeMismatch,
    #[error("authoritative process supervisor control failed")]
    Control(#[source] io::Error),
    #[error("authoritative process supervisor protocol failed: {0}")]
    Protocol(&'static str),
    #[error("authoritative process supervisor rejected the launch: {code}")]
    SupervisorRejected { code: String },
    #[error("authoritative process supervisor exited before a zero-resident receipt")]
    MissingTerminalReceipt,
    #[error("authoritative process supervisor event deadline is invalid")]
    InvalidEventWait,
    #[error("authoritative process supervisor did not emit an event within its bounded deadline")]
    EventWaitTimeout,
    #[error("authoritative process supervisor did not exit within its bounded deadline")]
    SupervisorExitTimeout,
    #[error("authoritative process supervisor exit status contradicted its terminal receipt")]
    ExitStatusMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessOwnerLimits {
    pub soft_commit_bytes: u64,
    pub hard_commit_bytes: u64,
    pub graceful_shutdown: Duration,
    pub supervisor_exit_timeout: Duration,
    // This authority is intentionally crate-private. Only the validated
    // registry may opt one exact development launch into system-wide commit
    // guarding;
    // downstream callers cannot attach it to an arbitrary process tree.
    pub(crate) system_commit_guard: Option<ProcessOwnerSystemCommitGuard>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProcessOwnerSystemCommitGuard {
    expected_commit_bytes: u64,
    trusted_reserve_bytes: u64,
}

impl ProcessOwnerSystemCommitGuard {
    pub(crate) fn development(
        expected_commit_bytes: u64,
        trusted_reserve_bytes: u64,
    ) -> Result<Self, ProcessOwnerError> {
        if expected_commit_bytes == 0 {
            return Err(ProcessOwnerError::InvalidLaunch(
                "system commit guard expected usage must be nonzero",
            ));
        }
        Ok(Self {
            expected_commit_bytes,
            trusted_reserve_bytes: trusted_reserve_bytes.max(SYSTEM_COMMIT_RESERVE_FLOOR_BYTES),
        })
    }

    fn expected_commit_bytes(self) -> u64 {
        self.expected_commit_bytes
    }

    fn trusted_reserve_bytes(self) -> u64 {
        self.trusted_reserve_bytes
    }
}

#[derive(Clone, PartialEq, Eq)]
pub enum ProcessOwnerPurpose {
    Worker(WorkerIdentity),
    Service { service_id: String, generation: u64 },
}

enum ProcessAuthorityGeneration {
    Live(CurrentGenerationMembership),
    #[cfg(test)]
    Test(RuntimeGenerationScope),
}

impl ProcessAuthorityGeneration {
    fn matches_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        match self {
            Self::Live(membership) => membership.matches_scope(scope),
            #[cfg(test)]
            Self::Test(test_scope) => test_scope == scope,
        }
    }
}

impl fmt::Debug for ProcessAuthorityGeneration {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProcessAuthorityGeneration(<opaque generation fence>)")
    }
}

/// One-shot authority proving that the pinned supervisor accepted its exact
/// target into the private Job Object and emitted the first valid `started`
/// boundary for this launch purpose. It cannot be constructed from a PID or a
/// JSON value and is intentionally neither cloneable nor serializable.
#[must_use = "process-tree residency must settle the matching durable dispatch claim"]
pub struct ProcessTreeResidency {
    generation: ProcessAuthorityGeneration,
    supervisor_pid: u32,
    root_pid: u32,
    purpose: ProcessOwnerPurpose,
}

impl fmt::Debug for ProcessTreeResidency {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (
            &self.generation,
            self.supervisor_pid,
            self.root_pid,
            &self.purpose,
        );
        formatter.write_str("ProcessTreeResidency(<opaque started-tree authority>)")
    }
}

impl ProcessTreeResidency {
    fn from_accepted_started(
        generation: CurrentGenerationMembership,
        supervisor_pid: u32,
        root_pid: u32,
        purpose: ProcessOwnerPurpose,
    ) -> Self {
        Self {
            generation: ProcessAuthorityGeneration::Live(generation),
            supervisor_pid,
            root_pid,
            purpose,
        }
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.generation.matches_scope(scope)
    }

    pub(crate) fn worker_identity(&self) -> Option<&WorkerIdentity> {
        match &self.purpose {
            ProcessOwnerPurpose::Worker(identity) => Some(identity),
            ProcessOwnerPurpose::Service { .. } => None,
        }
    }

    pub(crate) fn service_identity(&self) -> Option<(&str, u64)> {
        match &self.purpose {
            ProcessOwnerPurpose::Service {
                service_id,
                generation,
            } => Some((service_id, *generation)),
            ProcessOwnerPurpose::Worker(_) => None,
        }
    }

    #[cfg(test)]
    pub(crate) fn worker_for_test(scope: RuntimeGenerationScope, identity: WorkerIdentity) -> Self {
        Self {
            generation: ProcessAuthorityGeneration::Test(scope),
            supervisor_pid: 7,
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Worker(identity),
        }
    }

    #[cfg(test)]
    pub(crate) fn service_for_test(
        scope: RuntimeGenerationScope,
        service_id: &str,
        generation: u64,
    ) -> Self {
        Self {
            generation: ProcessAuthorityGeneration::Test(scope),
            supervisor_pid: 7,
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Service {
                service_id: service_id.into(),
                generation,
            },
        }
    }
}

fn take_residency_authority(
    pending: &mut Option<ProcessTreeResidency>,
    already_taken: &mut bool,
) -> Result<ProcessTreeResidency, ProcessOwnerError> {
    if let Some(residency) = pending.take() {
        *already_taken = true;
        return Ok(residency);
    }
    Err(ProcessOwnerError::InvalidState(if *already_taken {
        "process-tree residency authority was already taken"
    } else {
        "process-tree residency authority is unavailable before started"
    }))
}

impl fmt::Debug for ProcessOwnerPurpose {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Worker(_) => formatter.write_str("ProcessOwnerPurpose::Worker(<fenced>)"),
            Self::Service { .. } => formatter.write_str("ProcessOwnerPurpose::Service(<fenced>)"),
        }
    }
}

impl ProcessOwnerPurpose {
    fn validate(&self) -> Result<(), ProcessOwnerError> {
        match self {
            Self::Worker(identity) => identity.validate().map_err(|_| {
                ProcessOwnerError::InvalidLaunch("worker ownership fence was invalid")
            }),
            Self::Service {
                service_id,
                generation,
            } => {
                validate_identifier("serviceId", service_id).map_err(|_| {
                    ProcessOwnerError::InvalidLaunch("service ownership fence was invalid")
                })?;
                if *generation == 0 {
                    return Err(ProcessOwnerError::InvalidLaunch(
                        "service ownership generation was invalid",
                    ));
                }
                Ok(())
            }
        }
    }
}

impl ProcessOwnerLimits {
    pub fn validate(self) -> Result<Self, ProcessOwnerError> {
        if self.soft_commit_bytes > 0
            && self.hard_commit_bytes > 0
            && self.soft_commit_bytes >= self.hard_commit_bytes
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "soft commit limit must be lower than hard commit limit",
            ));
        }
        #[cfg(not(target_pointer_width = "64"))]
        if self.hard_commit_bytes > usize::MAX as u64 {
            return Err(ProcessOwnerError::InvalidLaunch(
                "hard commit limit cannot be represented on this platform",
            ));
        }
        if !(MIN_PROCESS_OWNER_GRACEFUL_SHUTDOWN..=MAX_PROCESS_OWNER_GRACEFUL_SHUTDOWN)
            .contains(&self.graceful_shutdown)
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "graceful shutdown deadline is outside the supported bounds",
            ));
        }
        if !(MIN_SUPERVISOR_EXIT_TIMEOUT..=MAX_SUPERVISOR_EXIT_TIMEOUT)
            .contains(&self.supervisor_exit_timeout)
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "supervisor exit deadline is outside the supported bounds",
            ));
        }
        if let Some(guard) = self.system_commit_guard {
            if self.hard_commit_bytes == 0
                || guard.expected_commit_bytes() >= self.hard_commit_bytes
                || guard.trusted_reserve_bytes() < SYSTEM_COMMIT_RESERVE_FLOOR_BYTES
            {
                return Err(ProcessOwnerError::InvalidLaunch(
                    "system commit guard is inconsistent with process limits",
                ));
            }
        }
        Ok(self)
    }
}

/// A complete launch selected by trusted registries and pinned filesystem
/// authorities. Arguments are caller data, but the supervisor, executable,
/// optional worker language entrypoint, and working directory cannot be
/// supplied as untrusted strings. Service argv is already fully resolved and
/// never receives the worker compatibility entrypoint.
pub(crate) struct TrustedProcessLaunch {
    purpose: ProcessOwnerPurpose,
    generation_scope: RuntimeGenerationScope,
    supervisor: TrustedFilePin,
    executable: TrustedFilePin,
    entrypoint: Option<TrustedFilePin>,
    launch_files: Vec<TrustedFilePin>,
    target: TrustedProcessTarget,
    environment: TrustedProcessEnvironment,
    service_diagnostic_paths: Option<RuntimePaths>,
    service_diagnostic_redactions: Vec<String>,
    worker_diagnostic_paths: Option<RuntimePaths>,
    worker_diagnostic_redactions: Vec<String>,
    limits: ProcessOwnerLimits,
}

/// Claim-independent, fully pinned worker launch material. The attempt-specific
/// `start.json` and workspace are deliberately not prepared here: that happens
/// only after this value and the exact durable dispatch claim are consumed by
/// `WorkerDispatchClaim::launch`.
pub struct WorkerLaunchRequest {
    inner: Box<WorkerLaunchRequestInner>,
}

/// Registry-selected service launch material bound to one exact Runtime V2
/// data-root authority. The Registry supplies every file pin, the working
/// directory, complete argv, and limits. The durable StartTree authority—not
/// this request—supplies the numeric service generation at launch time.
pub struct ServiceLaunchRequest {
    inner: Box<ServiceLaunchRequestInner>,
}

struct ServiceLaunchRequestInner {
    service_id: String,
    service_port: u16,
    readiness: ServiceHttpReadiness,
    readiness_authorization: Option<String>,
    generation_scope: RuntimeGenerationScope,
    paths: RuntimePaths,
    supervisor: TrustedFilePin,
    executable: TrustedFilePin,
    launch_files: Vec<TrustedFilePin>,
    working_directory: TrustedLaunchDirectory,
    arguments: Vec<OsString>,
    environment: TrustedProcessEnvironment,
    limits: ProcessOwnerLimits,
}

struct WorkerLaunchRequestInner {
    worker_kind: String,
    paths: RuntimePaths,
    supervisor: TrustedFilePin,
    executable: TrustedFilePin,
    entrypoint: Option<TrustedFilePin>,
    environment: TrustedWorkerEnvironment,
    limits: ProcessOwnerLimits,
}

impl fmt::Debug for WorkerLaunchRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (
            &self.inner.worker_kind,
            &self.inner.paths,
            &self.inner.supervisor,
            &self.inner.executable,
            &self.inner.entrypoint,
            &self.inner.environment,
        );
        formatter
            .debug_struct("WorkerLaunchRequest")
            .field("authority", &"<opaque pinned worker launch material>")
            .field("limits", &self.inner.limits)
            .finish()
    }
}

impl WorkerLaunchRequest {
    /// The trusted registry is the sole constructor. Keeping this crate-private
    /// prevents downstream callers from pairing arbitrary pins or limits with
    /// a durable worker claim while preserving an opaque public return type for
    /// the native CLI.
    pub(crate) fn from_registry(
        worker_kind: String,
        paths: RuntimePaths,
        supervisor: TrustedFilePin,
        executable: TrustedFilePin,
        entrypoint: Option<TrustedFilePin>,
        environment: TrustedWorkerEnvironment,
        limits: ProcessOwnerLimits,
    ) -> Self {
        Self {
            inner: Box::new(WorkerLaunchRequestInner {
                worker_kind,
                paths,
                supervisor,
                executable,
                entrypoint,
                environment,
                limits,
            }),
        }
    }

    pub(crate) fn generation_scope(&self) -> RuntimeGenerationScope {
        self.inner.paths.runtime_generation_scope()
    }

    pub(crate) fn worker_kind(&self) -> &str {
        &self.inner.worker_kind
    }

    #[cfg(test)]
    pub(crate) fn limits_for_test(&self) -> ProcessOwnerLimits {
        self.inner.limits
    }
}

impl fmt::Debug for ServiceLaunchRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (
            &self.inner.service_id,
            self.inner.service_port,
            &self.inner.readiness,
            &self.inner.readiness_authorization,
            &self.inner.generation_scope,
            &self.inner.supervisor,
            &self.inner.executable,
            &self.inner.launch_files,
            &self.inner.working_directory,
            &self.inner.arguments,
            &self.inner.environment,
        );
        formatter
            .debug_struct("ServiceLaunchRequest")
            .field("authority", &"<opaque registry service launch material>")
            .field("argument_count", &self.inner.arguments.len())
            .field("environment", &"<sealed service environment>")
            .field("limits", &self.inner.limits)
            .finish()
    }
}

impl ServiceLaunchRequest {
    // These values are deliberately passed as separate, already-pinned
    // authorities. Collapsing them into an ordinary public options object
    // would make the sole trusted Registry construction boundary less clear.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn from_registry(
        service_id: String,
        service_port: u16,
        readiness: ServiceHttpReadiness,
        generation_scope: RuntimeGenerationScope,
        paths: RuntimePaths,
        supervisor: TrustedFilePin,
        executable: TrustedFilePin,
        launch_files: Vec<TrustedFilePin>,
        working_directory: TrustedLaunchDirectory,
        arguments: Vec<OsString>,
        environment: TrustedServiceEnvironment,
        limits: ProcessOwnerLimits,
    ) -> Result<Self, ProcessOwnerError> {
        validate_identifier("serviceId", &service_id)
            .map_err(|_| ProcessOwnerError::InvalidLaunch("service ownership fence was invalid"))?;
        if service_port == 0 {
            return Err(ProcessOwnerError::InvalidLaunch(
                "service launch port was invalid",
            ));
        }
        if supervisor.authority_kind() != "runtime"
            || !matches!(executable.authority_kind(), "runtime" | "data")
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "supervisor must be runtime-root and service executable must be runtime-root or data-root authority",
            ));
        }
        if launch_files
            .iter()
            .any(|pin| !matches!(pin.authority_kind(), "runtime" | "application" | "data"))
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "service launch files must come from a closed runtime, application, or data-root authority",
            ));
        }
        if arguments.len() > MAX_TARGET_ARGUMENTS {
            return Err(ProcessOwnerError::InvalidLaunch(
                "target argument count exceeded its bound",
            ));
        }
        if arguments.iter().any(|argument| contains_nul(argument)) {
            return Err(ProcessOwnerError::InvalidLaunch(
                "target argument contained NUL",
            ));
        }
        let readiness_secret_name = match service_id.as_str() {
            "cliproxy" => Some("CLIPROXY_API_KEY"),
            "cad" => Some("BREADBOARD_CAD_SECRET"),
            "colpali" => Some("BREADBOARD_COLPALI_SECRET"),
            "humanizer" => Some("BREADBOARD_HUMANIZER_SECRET"),
            _ => None,
        };
        let readiness_authorization = if let Some(secret_name) = readiness_secret_name {
            let value = environment
                .value(secret_name)
                .and_then(OsStr::to_str)
                .filter(|value| {
                    value.len() >= MIN_CONTROL_TOKEN_BYTES
                        && value.len() <= MAX_CONTROL_TOKEN_BYTES
                        && value.bytes().all(|byte| byte.is_ascii_graphic())
                })
                .ok_or(ProcessOwnerError::InvalidLaunch(
                    "authenticated service readiness credential was unavailable",
                ))?;
            Some(format!("Bearer {value}"))
        } else {
            None
        };
        let environment = TrustedProcessEnvironment::service(&service_id, environment)?;
        Ok(Self {
            inner: Box::new(ServiceLaunchRequestInner {
                service_id,
                service_port,
                readiness,
                readiness_authorization,
                generation_scope,
                paths,
                supervisor,
                executable,
                launch_files,
                working_directory,
                arguments,
                environment,
                limits: limits.validate()?,
            }),
        })
    }

    pub(crate) fn generation_scope(&self) -> RuntimeGenerationScope {
        self.inner.generation_scope.clone()
    }

    pub(crate) fn service_id(&self) -> &str {
        &self.inner.service_id
    }

    pub(crate) fn readiness_binding(&self) -> (u16, ServiceHttpReadiness, Option<String>) {
        (
            self.inner.service_port,
            self.inner.readiness.clone(),
            self.inner.readiness_authorization.clone(),
        )
    }

    #[cfg(test)]
    pub(crate) fn service_id_for_test(&self) -> &str {
        &self.inner.service_id
    }

    #[cfg(test)]
    pub(crate) fn limits_for_test(&self) -> ProcessOwnerLimits {
        self.inner.limits
    }

    #[cfg(test)]
    pub(crate) fn arguments_for_test(&self) -> &[OsString] {
        &self.inner.arguments
    }

    #[cfg(test)]
    pub(crate) fn working_directory_for_test(&self) -> &Path {
        self.inner.working_directory.absolute()
    }
}

enum TrustedProcessTarget {
    Worker(Box<PreparedWorkerStart>),
    Service {
        working_directory: Box<TrustedLaunchDirectory>,
        arguments: Vec<OsString>,
    },
}

impl TrustedProcessTarget {
    fn working_directory(&self) -> &TrustedLaunchDirectory {
        match self {
            Self::Worker(start) => start.launch_directory(),
            Self::Service {
                working_directory, ..
            } => working_directory,
        }
    }

    fn arguments(&self) -> WorkerOrServiceArguments<'_> {
        match self {
            Self::Worker(start) => {
                WorkerOrServiceArguments::Worker(start.start_manifest_argument())
            }
            Self::Service { arguments, .. } => WorkerOrServiceArguments::Service(arguments),
        }
    }

    fn argument_count(&self) -> usize {
        match self {
            Self::Worker(_) => 1,
            Self::Service { arguments, .. } => arguments.len(),
        }
    }

    fn revalidate(&self) -> Result<(), ProcessOwnerError> {
        match self {
            Self::Worker(start) => start.revalidate().map_err(ProcessOwnerError::from),
            Self::Service {
                working_directory, ..
            } => working_directory
                .revalidate()
                .map_err(ProcessOwnerError::from),
        }
    }
}

enum WorkerOrServiceArguments<'a> {
    Worker(&'static str),
    Service(&'a [OsString]),
}

impl WorkerOrServiceArguments<'_> {
    #[cfg(windows)]
    fn apply_to(self, command: &mut Command) {
        match self {
            Self::Worker(argument) => {
                command.arg(argument);
            }
            Self::Service(arguments) => {
                command.args(arguments);
            }
        }
    }
}

#[cfg(windows)]
fn worker_entrypoint_argument(
    entrypoint: Option<&TrustedFilePin>,
) -> Result<Option<std::path::PathBuf>, ProcessOwnerError> {
    entrypoint
        .map(TrustedFilePin::child_argv_path)
        .transpose()
        .map_err(ProcessOwnerError::from)
}

enum TrustedProcessEnvironment {
    Worker(TrustedWorkerEnvironment),
    Service(TrustedServiceEnvironment),
}

impl TrustedProcessEnvironment {
    fn worker(environment: TrustedWorkerEnvironment) -> Self {
        Self::Worker(environment)
    }

    fn service(
        service_id: &str,
        environment: TrustedServiceEnvironment,
    ) -> Result<Self, ProcessOwnerError> {
        if environment.profile().service_id() != service_id
            || environment.source() != environment.profile().source()
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "service environment profile did not match service identity",
            ));
        }
        Ok(Self::Service(environment))
    }

    fn validate_purpose(&self, purpose: &ProcessOwnerPurpose) -> Result<(), ProcessOwnerError> {
        match (purpose, self) {
            (ProcessOwnerPurpose::Worker(_), Self::Worker(_)) => Ok(()),
            (ProcessOwnerPurpose::Service { service_id, .. }, Self::Service(environment))
                if environment.profile().service_id() == service_id
                    && environment.source() == environment.profile().source() =>
            {
                Ok(())
            }
            (ProcessOwnerPurpose::Worker(_), Self::Service(_)) => Err(
                ProcessOwnerError::InvalidLaunch("worker launch carried a service environment"),
            ),
            (ProcessOwnerPurpose::Service { .. }, Self::Worker(_)) => Err(
                ProcessOwnerError::InvalidLaunch("service launch carried the worker environment"),
            ),
            (ProcessOwnerPurpose::Service { .. }, Self::Service(_)) => {
                Err(ProcessOwnerError::InvalidLaunch(
                    "service environment profile did not match service identity",
                ))
            }
        }
    }

    fn supervisor_profile_argument(&self) -> &'static str {
        match self {
            Self::Worker(environment) => match environment.source() {
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Minimal => "worker",
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Background => {
                    "background-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::DocumentIngestion => {
                    "document-ingestion-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::AudioAnalyzer => {
                    "audio-analyzer-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::ImageSearchGoogle => {
                    "image-search-google-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::InteractiveVisualizer => {
                    "interactive-visualizer-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::QuartzPublish => {
                    "quartz-publish-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::ManagedSetup => {
                    "managed-setup-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Terminal => {
                    "terminal-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::CodeIndex => {
                    "code-index-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::AgentEdits => {
                    "agent-edits-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterOpencode => {
                    "outer-opencode-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::TradingAgent => {
                    "trading-agent-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterCareerOps => {
                    "outer-career-ops-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::SystemLocation => {
                    "system-location-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Chatmock => {
                    "chatmock-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Vimax => {
                    "vimax-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::VoxDirector => {
                    "vox-director-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterShorts => {
                    "outer-shorts-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterOpenGym => {
                    "outer-open-gym-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::AgentReachSetup => {
                    "agent-reach-setup-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::GbrainSync => {
                    "gbrain-sync-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterAgentReach => {
                    "outer-agent-reach-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::AgentBrowserProfile => {
                    "agent-browser-profile-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::AgentTars => {
                    "agent-tars-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterLegal => {
                    "outer-legal-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Sf3d => {
                    "sf3d-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterCodex => {
                    "outer-codex-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterRuflo => {
                    "outer-ruflo-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterDeepTutor => {
                    "outer-deep-tutor-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::DeepTutorMaintenance => {
                    "deep-tutor-maintenance-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterOpenPlanter => {
                    "outer-openplanter-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Manim => {
                    "manim-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Premortem => {
                    "premortem-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::AgentLoop => {
                    "agent-loop-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Omh => {
                    "omh-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Factcheck => {
                    "factcheck-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::WatchMedia => {
                    "watch-media-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Loopx => {
                    "loopx-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Resource2Skill => {
                    "resource2skill-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterMatraix => {
                    "outer-matraix-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Formsmith => {
                    "formsmith-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Hyperframes => {
                    "hyperframes-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OpenMontage => {
                    "openmontage-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterBoltSlides => {
                    "outer-bolt-slides-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Subsai => {
                    "subsai-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::SpeechMedia => {
                    "speech-media-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::GeneratedVisualBrowser => {
                    "generated-visual-browser-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::ScriberrGarden => {
                    "scriberr-garden-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::Watermark => {
                    "watermark-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterHardwareBlueprint => {
                    "outer-hardware-blueprint-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::GetDoc => {
                    "get-doc-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::GetDocDownload => {
                    "get-doc-download-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::MeetingNotes => {
                    "meeting-notes-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterInboxZero => {
                    "outer-inbox-zero-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterSocialsManager => {
                    "outer-socials-manager-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterMaxResearch => {
                    "outer-max-research-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterWardrobe => {
                    "outer-wardrobe-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterParametricCad => {
                    "outer-parametric-cad-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterStockAnalyst => {
                    "outer-stock-analyst-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterVibeTrading => {
                    "outer-vibe-trading-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterDeerFlow => {
                    "outer-deer-flow-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterMoneyPrinter => {
                    "outer-money-printer-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterVideoUse => {
                    "outer-video-use-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterDeepResearch => {
                    "outer-deep-research-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterOpenscience => {
                    "outer-openscience-worker"
                }
                breadboard_runtime_protocol::TrustedWorkerEnvironmentSource::OuterOpenwork => {
                    "outer-openwork-worker"
                }
            },
            Self::Service(environment) => {
                supervisor_service_environment_profile_argument(environment.profile())
            }
        }
    }

    fn is_live_system_commit_reserve_victim(&self) -> bool {
        matches!(
            self,
            Self::Service(environment)
                if environment.profile() == TrustedServiceEnvironmentProfile::Dashboard
        )
    }

    fn service_diagnostic_redactions(&self) -> Vec<String> {
        let Self::Service(environment) = self else {
            return Vec::new();
        };
        diagnostic_redactions(environment.pairs())
    }

    fn worker_diagnostic_redactions(&self) -> Vec<String> {
        let Self::Worker(environment) = self else {
            return Vec::new();
        };
        diagnostic_redactions(environment.pairs())
    }

    #[cfg(windows)]
    fn child_environment(&self) -> Result<Vec<(OsString, OsString)>, ProcessOwnerError> {
        match self {
            Self::Worker(environment) => Ok(environment
                .pairs()
                .map(|(name, value)| (name.to_owned(), value.to_owned()))
                .collect()),
            Self::Service(environment) => Ok(environment
                .pairs()
                .map(|(name, value)| (name.to_owned(), value.to_owned()))
                .collect()),
        }
    }
}

fn diagnostic_redactions<'a>(pairs: impl Iterator<Item = (&'a OsStr, &'a OsStr)>) -> Vec<String> {
    let mut values = pairs
        .filter_map(|(name, value)| {
            let name = name.to_string_lossy().to_ascii_uppercase();
            let sensitive = [
                "TOKEN",
                "SECRET",
                "PASSWORD",
                "API_KEY",
                "INVITE_CODE",
                "CREDENTIAL",
            ]
            .iter()
            .any(|marker| name.contains(marker));
            if !sensitive {
                return None;
            }
            let value = value.to_string_lossy().into_owned();
            (value.len() >= 4).then_some(value)
        })
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

const fn supervisor_service_environment_profile_argument(
    profile: TrustedServiceEnvironmentProfile,
) -> &'static str {
    match profile {
        TrustedServiceEnvironmentProfile::Chatmock => "chatmock",
        TrustedServiceEnvironmentProfile::Comfyui => "comfyui",
        TrustedServiceEnvironmentProfile::Dashboard => "dashboard",
        TrustedServiceEnvironmentProfile::Gbrain => "gbrain",
        TrustedServiceEnvironmentProfile::Hermes => "hermes",
        TrustedServiceEnvironmentProfile::TelegramGateway => "telegram-gateway",
        TrustedServiceEnvironmentProfile::WhatsappGateway => "whatsapp-gateway",
        TrustedServiceEnvironmentProfile::Openwork => "openwork",
        TrustedServiceEnvironmentProfile::Openscience => "openscience",
        TrustedServiceEnvironmentProfile::MoneyPrinter => "money-printer",
        TrustedServiceEnvironmentProfile::Wardrobe => "wardrobe",
        TrustedServiceEnvironmentProfile::Penecho => "penecho",
        TrustedServiceEnvironmentProfile::VlmOcr => "vlm-ocr",
        TrustedServiceEnvironmentProfile::Recall => "recall",
        TrustedServiceEnvironmentProfile::Mem0SemanticEngine => "mem0-semantic-engine",
        TrustedServiceEnvironmentProfile::LocalMcpBroker => "local-mcp-broker",
        TrustedServiceEnvironmentProfile::PostizCoordinator => "postiz-coordinator",
        TrustedServiceEnvironmentProfile::InboxZeroStack => "inbox-zero-stack",
        TrustedServiceEnvironmentProfile::SpotifyPlayback => "spotify-playback",
        TrustedServiceEnvironmentProfile::Cliproxy => "cliproxy",
        TrustedServiceEnvironmentProfile::Quartz => "quartz",
        TrustedServiceEnvironmentProfile::UiTars => "ui-tars",
        TrustedServiceEnvironmentProfile::Cad => "cad",
        TrustedServiceEnvironmentProfile::Colpali => "colpali",
        TrustedServiceEnvironmentProfile::Humanizer => "humanizer",
        TrustedServiceEnvironmentProfile::Voicebox => "voicebox",
        TrustedServiceEnvironmentProfile::Scriberr => "scriberr",
        TrustedServiceEnvironmentProfile::DeepResearch => "deep-research",
        TrustedServiceEnvironmentProfile::DeerFlow => "deer-flow",
        TrustedServiceEnvironmentProfile::VibeTrading => "vibe-trading",
        TrustedServiceEnvironmentProfile::StockAnalyst => "stock-analyst",
        TrustedServiceEnvironmentProfile::SolidworksMcp => "solidworks-mcp",
    }
}

impl fmt::Debug for TrustedProcessEnvironment {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Worker(environment) => formatter
                .debug_struct("TrustedProcessEnvironment::Worker")
                .field("source", &environment.source())
                .field("values", &"<redacted>")
                .finish(),
            Self::Service(environment) => formatter
                .debug_struct("TrustedProcessEnvironment::Service")
                .field("profile", &environment.profile())
                .field("values", &"<redacted>")
                .finish(),
        }
    }
}

impl fmt::Debug for TrustedProcessLaunch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("TrustedProcessLaunch")
            .field("purpose", &self.purpose)
            .field("supervisor", &"<redacted pinned file>")
            .field("executable", &"<redacted pinned file>")
            .field(
                "entrypoint",
                &self.entrypoint.as_ref().map(|_| "<redacted pinned file>"),
            )
            .field("working_directory", &"<redacted pinned directory>")
            .field("argument_count", &self.target.argument_count())
            .field("environment", &self.environment)
            .field("limits", &self.limits)
            .finish()
    }
}

impl TrustedProcessLaunch {
    fn revalidate_pins(&self) -> Result<(), ProcessOwnerError> {
        self.environment.validate_purpose(&self.purpose)?;
        self.supervisor.revalidate()?;
        self.executable.revalidate()?;
        if let Some(entrypoint) = &self.entrypoint {
            entrypoint.revalidate()?;
        }
        for launch_file in &self.launch_files {
            launch_file.revalidate()?;
        }
        self.target.revalidate()?;
        Ok(())
    }

    fn persist_service_diagnostic(
        &self,
        stream: &str,
        data: &str,
    ) -> Result<(), ProcessOwnerError> {
        let Some(paths) = &self.service_diagnostic_paths else {
            return Ok(());
        };
        let ProcessOwnerPurpose::Service {
            service_id,
            generation,
        } = &self.purpose
        else {
            return Err(ProcessOwnerError::InvalidState(
                "worker launch carried a service diagnostic log",
            ));
        };
        let sanitized = redact_service_diagnostic(data, &self.service_diagnostic_redactions);
        let record =
            format!("[service={service_id} generation={generation} stream={stream}] {sanitized}");
        paths.append_bounded_service_log(
            service_id,
            record.as_bytes(),
            MAX_DURABLE_SERVICE_DIAGNOSTIC_BYTES,
        )?;
        Ok(())
    }

    fn persist_worker_diagnostic(&self, stream: &str, data: &str) -> Result<(), ProcessOwnerError> {
        let Some(paths) = &self.worker_diagnostic_paths else {
            return Ok(());
        };
        let ProcessOwnerPurpose::Worker(identity) = &self.purpose else {
            return Err(ProcessOwnerError::InvalidState(
                "service launch carried a worker diagnostic log",
            ));
        };
        let sanitized = redact_service_diagnostic(data, &self.worker_diagnostic_redactions);
        let record = worker_diagnostic_record(identity, stream, &sanitized);
        paths.append_bounded_worker_log(
            identity,
            record.as_bytes(),
            MAX_DURABLE_WORKER_DIAGNOSTIC_BYTES,
        )?;
        Ok(())
    }

    #[cfg(windows)]
    fn child_environment(&self) -> Result<Vec<(OsString, OsString)>, ProcessOwnerError> {
        self.environment.child_environment()
    }

    pub(crate) fn generation_scope(&self) -> &RuntimeGenerationScope {
        &self.generation_scope
    }
}

fn redact_service_diagnostic(data: &str, secrets: &[String]) -> String {
    let mut sanitized = data.to_owned();
    for secret in secrets {
        sanitized = sanitized.replace(secret, "[REDACTED]");
    }
    sanitized
}

fn worker_diagnostic_record(identity: &WorkerIdentity, stream: &str, data: &str) -> String {
    format!(
        "[job={} attempt={} worker={} stream={stream}] {data}",
        identity.job_id, identity.attempt, identity.worker_instance_id
    )
}

pub(crate) fn prepare_claimed_service_launch(
    service_id: &str,
    generation: u64,
    request: ServiceLaunchRequest,
) -> Result<TrustedProcessLaunch, (ServiceLaunchRequest, ProcessOwnerError)> {
    let pre_file_validation = (|| {
        let purpose = ProcessOwnerPurpose::Service {
            service_id: service_id.into(),
            generation,
        };
        purpose.validate()?;
        if request.inner.service_id != service_id {
            return Err(ProcessOwnerError::InvalidLaunch(
                "service registry material did not match the durable service identity",
            ));
        }
        request.inner.environment.validate_purpose(&purpose)?;
        if request.inner.supervisor.authority_kind() != "runtime"
            || !matches!(
                request.inner.executable.authority_kind(),
                "runtime" | "data"
            )
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "supervisor must be runtime-root and service executable must be runtime-root or data-root authority",
            ));
        }
        if request
            .inner
            .launch_files
            .iter()
            .any(|pin| !matches!(pin.authority_kind(), "runtime" | "application" | "data"))
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "service launch files must come from a closed runtime, application, or data-root authority",
            ));
        }
        if request.inner.arguments.len() > MAX_TARGET_ARGUMENTS {
            return Err(ProcessOwnerError::InvalidLaunch(
                "target argument count exceeded its bound",
            ));
        }
        if request
            .inner
            .arguments
            .iter()
            .any(|argument| contains_nul(argument))
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "target argument contained NUL",
            ));
        }
        request.inner.limits.validate()?;
        Ok(())
    })();
    if let Err(error) = pre_file_validation {
        return Err((request, error));
    }

    let pin_validation = (|| {
        request.inner.supervisor.revalidate()?;
        request.inner.executable.revalidate()?;
        for launch_file in &request.inner.launch_files {
            launch_file.revalidate()?;
        }
        request.inner.working_directory.revalidate()?;
        Ok::<_, PathError>(())
    })();
    if let Err(error) = pin_validation {
        return Err((request, ProcessOwnerError::Path(error)));
    }
    let ServiceLaunchRequest { inner } = request;
    let ServiceLaunchRequestInner {
        service_id: request_service_id,
        service_port: _,
        readiness: _,
        readiness_authorization: _,
        generation_scope,
        paths,
        supervisor,
        executable,
        launch_files,
        working_directory,
        arguments,
        environment,
        limits,
    } = *inner;
    debug_assert_eq!(request_service_id, service_id);
    let service_diagnostic_redactions = environment.service_diagnostic_redactions();
    Ok(TrustedProcessLaunch {
        purpose: ProcessOwnerPurpose::Service {
            service_id: request_service_id,
            generation,
        },
        generation_scope,
        supervisor,
        executable,
        entrypoint: None,
        launch_files,
        target: TrustedProcessTarget::Service {
            working_directory: Box::new(working_directory),
            arguments,
        },
        environment,
        service_diagnostic_paths: Some(paths),
        service_diagnostic_redactions,
        worker_diagnostic_paths: None,
        worker_diagnostic_redactions: Vec::new(),
        limits,
    })
}

pub(crate) fn prepare_claimed_worker_launch(
    claim: &WorkerDispatchClaim,
    request: WorkerLaunchRequest,
) -> Result<TrustedProcessLaunch, (WorkerLaunchRequest, ProcessOwnerError)> {
    let identity = claim.identity();
    let job = claim.job();
    let execution_scope = match WorkerExecutionScope::new(
        job.user_id,
        job.garden_id.clone(),
        job.conversation_id.clone(),
    ) {
        Ok(scope) => scope,
        Err(_) => {
            return Err((
                request,
                ProcessOwnerError::InvalidLaunch("durable worker execution scope was invalid"),
            ));
        }
    };
    let generation_scope = request.generation_scope();
    let pre_file_validation = (|| {
        identity
            .validate()
            .map_err(|_| ProcessOwnerError::InvalidLaunch("worker ownership fence was invalid"))?;
        if job.identity().as_ref() != Some(identity) {
            return Err(ProcessOwnerError::InvalidLaunch(
                "durable worker record did not match its dispatch fence",
            ));
        }
        if request.inner.supervisor.authority_kind() != "runtime"
            || request.inner.executable.authority_kind() != "runtime"
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "supervisor and executable must come from runtime-root authority",
            ));
        }
        if request
            .inner
            .entrypoint
            .as_ref()
            .is_some_and(|entrypoint| entrypoint.authority_kind() != "application")
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "entrypoint must come from application-root authority",
            ));
        }
        request.inner.limits.validate()?;
        Ok(())
    })();
    if let Err(error) = pre_file_validation {
        return Err((request, error));
    }
    let pin_validation = (|| {
        request.inner.supervisor.revalidate()?;
        request.inner.executable.revalidate()?;
        if let Some(entrypoint) = &request.inner.entrypoint {
            entrypoint.revalidate()?;
        }
        Ok(())
    })();
    if let Err(error) = pin_validation {
        return Err((request, error));
    }
    let start = match request.inner.paths.prepare_worker_start(
        identity,
        &execution_scope,
        &claim.worker_input_blobs(),
    ) {
        Ok(start) => start,
        Err(error) => return Err((request, ProcessOwnerError::Path(error))),
    };
    if &start.manifest().identity != identity || start.manifest().execution_scope != execution_scope
    {
        return Err((
            request,
            ProcessOwnerError::InvalidLaunch(
                "worker start authority did not match the durable dispatch claim and scope",
            ),
        ));
    }
    if let Err(error) = start.revalidate() {
        return Err((request, ProcessOwnerError::Path(error)));
    }
    let WorkerLaunchRequest { inner } = request;
    let WorkerLaunchRequestInner {
        worker_kind: _,
        paths,
        supervisor,
        executable,
        entrypoint,
        environment,
        limits,
    } = *inner;
    let environment = TrustedProcessEnvironment::worker(environment);
    let worker_diagnostic_redactions = environment.worker_diagnostic_redactions();
    Ok(TrustedProcessLaunch {
        purpose: ProcessOwnerPurpose::Worker(identity.clone()),
        generation_scope,
        supervisor,
        executable,
        entrypoint,
        launch_files: Vec::new(),
        target: TrustedProcessTarget::Worker(Box::new(start)),
        environment,
        service_diagnostic_paths: None,
        service_diagnostic_redactions: Vec::new(),
        worker_diagnostic_paths: Some(paths),
        worker_diagnostic_redactions,
        limits,
    })
}

fn contains_nul(value: &OsStr) -> bool {
    value.to_string_lossy().contains('\0')
}

enum SupervisorRead {
    Record(Vec<u8>),
    End,
    Io(io::Error),
    Protocol(&'static str),
}

struct PrivateDiagnosticBuffer {
    records: VecDeque<(usize, Value)>,
    bytes: usize,
}

/// A bounded, non-secret classification for target worker protocol failure.
/// The raw stdout bytes remain private; this value is safe to hand to the
/// dispatcher while the native owner continues toward its terminal receipt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerProtocolFault {
    InvalidRecord,
    FenceOrSequenceMismatch,
    SequenceOverflow,
    RecordTooLarge,
    PartialRecord,
    OutputLost,
    DurableStateViolation,
}

struct WorkerEventStream {
    identity: WorkerIdentity,
    next_sequence: u64,
    pending_line: Vec<u8>,
    ready: VecDeque<WorkerEvent>,
    poisoned: bool,
}

impl WorkerEventStream {
    fn new(identity: WorkerIdentity) -> Self {
        Self {
            identity,
            next_sequence: 1,
            pending_line: Vec::new(),
            ready: VecDeque::new(),
            poisoned: false,
        }
    }

    fn push_stdout_chunk(&mut self, data: &str) -> Option<WorkerProtocolFault> {
        if self.poisoned {
            return None;
        }
        let result = self.push_stdout_chunk_unpoisoned(data);
        match result {
            Ok(()) => None,
            Err(fault) => self.poison(fault),
        }
    }

    fn push_stdout_chunk_unpoisoned(&mut self, data: &str) -> Result<(), WorkerProtocolFault> {
        let mut remaining = data.as_bytes();
        while let Some(newline) = remaining.iter().position(|byte| *byte == b'\n') {
            self.extend_pending(&remaining[..newline])?;
            if self.pending_line.last() == Some(&b'\r') {
                self.pending_line.pop();
            }
            let event = parse_worker_event(&self.pending_line)
                .map_err(|_| WorkerProtocolFault::InvalidRecord)?;
            if event.identity() != &self.identity || event.sequence() != self.next_sequence {
                return Err(WorkerProtocolFault::FenceOrSequenceMismatch);
            }
            self.next_sequence = self
                .next_sequence
                .checked_add(1)
                .ok_or(WorkerProtocolFault::SequenceOverflow)?;
            self.pending_line.clear();
            self.ready.push_back(event);
            remaining = &remaining[newline + 1..];
        }
        self.extend_pending(remaining)
    }

    fn extend_pending(&mut self, bytes: &[u8]) -> Result<(), WorkerProtocolFault> {
        if self.pending_line.len().saturating_add(bytes.len()) > MAX_WORKER_EVENT_LINE_BYTES {
            return Err(WorkerProtocolFault::RecordTooLarge);
        }
        self.pending_line.extend_from_slice(bytes);
        Ok(())
    }

    fn pop_ready(&mut self) -> Option<WorkerEvent> {
        self.ready.pop_front()
    }

    fn finish_record_boundary(&mut self) -> Option<WorkerProtocolFault> {
        if self.poisoned || self.pending_line.is_empty() {
            None
        } else {
            self.poison(WorkerProtocolFault::PartialRecord)
        }
    }

    fn poison(&mut self, fault: WorkerProtocolFault) -> Option<WorkerProtocolFault> {
        if self.poisoned {
            return None;
        }
        self.poisoned = true;
        self.pending_line.clear();
        self.ready.clear();
        Some(fault)
    }
}

fn reject_worker_event_for_durable_state(
    stream: Option<&mut WorkerEventStream>,
    worker_protocol_fault: &mut Option<WorkerProtocolFault>,
) -> Result<(), ProcessOwnerError> {
    let stream = stream.ok_or(ProcessOwnerError::InvalidState(
        "a service process has no worker event stream",
    ))?;
    let _ = stream.poison(WorkerProtocolFault::DurableStateViolation);
    if worker_protocol_fault.is_none() {
        *worker_protocol_fault = Some(WorkerProtocolFault::DurableStateViolation);
    }
    Ok(())
}

impl PrivateDiagnosticBuffer {
    fn new() -> Self {
        Self {
            records: VecDeque::new(),
            bytes: 0,
        }
    }

    fn record(&mut self, encoded_bytes: usize, value: Value) {
        if encoded_bytes > MAX_PRIVATE_DIAGNOSTIC_BYTES {
            return;
        }
        while self.records.len() >= MAX_PRIVATE_DIAGNOSTIC_RECORDS
            || self.bytes.saturating_add(encoded_bytes) > MAX_PRIVATE_DIAGNOSTIC_BYTES
        {
            let Some((removed_bytes, _)) = self.records.pop_front() else {
                break;
            };
            self.bytes = self.bytes.saturating_sub(removed_bytes);
        }
        self.bytes = self.bytes.saturating_add(encoded_bytes);
        self.records.push_back((encoded_bytes, value));
    }

    fn len(&self) -> usize {
        self.records.len()
    }
}

fn is_private_diagnostic_kind(kind: &str) -> bool {
    matches!(kind, "stdout" | "stderr")
}

fn private_diagnostic_data(value: &Value) -> Result<&str, ProcessOwnerError> {
    value
        .get("data")
        .and_then(Value::as_str)
        .ok_or(ProcessOwnerError::Protocol(
            "supervisor stream record contained invalid data",
        ))
}

fn safe_malformed_protocol_message(untrusted_message: &str) -> &'static str {
    match untrusted_message {
        "system commit guard values are invalid" => {
            "Supervisor system-commit guard options were inconsistent"
        }
        "inherited environment variable is outside the selected profile" => {
            "Supervisor environment profile rejected a requested variable"
        }
        "duplicate inherited environment variable name" => {
            "Supervisor environment profile received a duplicate variable"
        }
        "invalid inherited environment variable name" => {
            "Supervisor environment profile received an invalid variable name"
        }
        "soft limit must be lower than hard limit" => {
            "Supervisor process-tree commit limits were inconsistent"
        }
        "--expected-commit-bytes may be specified only once"
        | "--system-commit-reserve-bytes may be specified only once"
        | "--environment-profile may be specified only once"
        | "--cwd may be specified only once" => {
            "Supervisor launch protocol repeated a singleton option"
        }
        "--expected-commit-bytes and --system-commit-reserve-bytes must be supplied together" => {
            "Supervisor system-commit guard options were incomplete"
        }
        "missing target command" | "target command must not be empty" => {
            "Supervisor launch protocol omitted its target"
        }
        "target command and arguments must not contain NUL" => {
            "Supervisor launch target contained invalid data"
        }
        "target working directory is invalid" | "target working directory must be absolute" => {
            "Supervisor launch working directory was invalid"
        }
        "hard limit cannot be represented on this platform" => {
            "Supervisor process-tree commit limit was not representable"
        }
        "unknown environment profile" => {
            "Supervisor launch selected an unknown environment profile"
        }
        message if message.starts_with("missing value for ") => {
            "Supervisor launch protocol omitted an option value"
        }
        message if message.starts_with("invalid value for ") => {
            "Supervisor launch protocol supplied an invalid numeric value"
        }
        message if message.starts_with("unknown option ") => {
            "Supervisor launch protocol supplied an unknown option"
        }
        message if message.starts_with("target has more than ") => {
            "Supervisor launch target exceeded its argument bound"
        }
        message if message.starts_with("target command line exceeds the Windows ") => {
            "Supervisor launch target exceeded the Windows command-line bound"
        }
        _ => "Supervisor launch protocol was invalid",
    }
}

fn safe_supervisor_failure(code: &str, untrusted_message: &str) -> ProcessSupervisorFailure {
    let (code, message) = match code {
        "MALFORMED_PROTOCOL" => (
            "MALFORMED_PROTOCOL",
            safe_malformed_protocol_message(untrusted_message),
        ),
        "UNSUPPORTED_PLATFORM" => (
            "UNSUPPORTED_PLATFORM",
            "Authoritative process supervision is unsupported on this platform",
        ),
        "ACTIVATION_READ_FAILED" => (
            "ACTIVATION_READ_FAILED",
            "Supervisor activation could not be read",
        ),
        "ACTIVATION_REQUIRED" => (
            "ACTIVATION_REQUIRED",
            "Supervisor activation was not received",
        ),
        "ACTIVATION_TOO_LARGE" => (
            "ACTIVATION_TOO_LARGE",
            "Supervisor activation exceeded its protocol bound",
        ),
        "MALFORMED_ACTIVATION" => ("MALFORMED_ACTIVATION", "Supervisor activation was invalid"),
        "CONTROL_THREAD_FAILED" => (
            "CONTROL_THREAD_FAILED",
            "Supervisor control input could not be started",
        ),
        "SPAWN_FAILED" => ("SPAWN_FAILED", "Service process could not be created"),
        "JOB_ASSIGN_FAILED" => (
            "JOB_ASSIGN_FAILED",
            "Service process containment could not be established",
        ),
        "PROTOCOL_WRITE_FAILED" => ("PROTOCOL_WRITE_FAILED", "Supervisor event delivery failed"),
        "PROTOCOL_QUEUE_FULL" => (
            "PROTOCOL_QUEUE_FULL",
            "Supervisor event queue exhausted its bound",
        ),
        "PROTOCOL_EVENT_TOO_LARGE" => (
            "PROTOCOL_EVENT_TOO_LARGE",
            "Supervisor event exceeded its protocol bound",
        ),
        "PIPE_FAILED" => ("PIPE_FAILED", "Service process stream setup failed"),
        "STREAM_FORWARD_CANCEL_FAILED" => (
            "STREAM_FORWARD_CANCEL_FAILED",
            "Service stream forwarding could not be cancelled",
        ),
        "STREAM_FORWARD_FAILED" => ("STREAM_FORWARD_FAILED", "Service stream forwarding failed"),
        "STREAM_FORWARD_TIMEOUT" => (
            "STREAM_FORWARD_TIMEOUT",
            "Service stream forwarding did not stop in time",
        ),
        "JOB_TERMINATE_FAILED" => (
            "JOB_TERMINATE_FAILED",
            "Service process tree could not be terminated",
        ),
        "JOB_CONFIG_FAILED" => (
            "JOB_CONFIG_FAILED",
            "Service process containment could not be configured",
        ),
        "JOB_NOTIFICATION_FAILED" => (
            "JOB_NOTIFICATION_FAILED",
            "Service process containment notification failed",
        ),
        "JOB_ACCOUNTING_FAILED" => ("JOB_ACCOUNTING_FAILED", "Service process accounting failed"),
        "ROOT_TERMINATE_FAILED" => (
            "ROOT_TERMINATE_FAILED",
            "Service root process could not be terminated",
        ),
        "JOB_CLEANUP_FAILED" => (
            "JOB_CLEANUP_FAILED",
            "Service process containment cleanup failed",
        ),
        "JOB_CREATE_FAILED" => (
            "JOB_CREATE_FAILED",
            "Service process containment could not be created",
        ),
        "RESUME_FAILED" => (
            "RESUME_FAILED",
            "Service process could not be resumed after containment",
        ),
        "WAIT_FAILED" => ("WAIT_FAILED", "Service process exit wait failed"),
        "EXIT_QUERY_FAILED" => (
            "EXIT_QUERY_FAILED",
            "Service process exit status could not be read",
        ),
        _ => (
            UNCLASSIFIED_SUPERVISOR_FAILURE_CODE,
            UNCLASSIFIED_SUPERVISOR_FAILURE_MESSAGE,
        ),
    };
    debug_assert!(code.len() <= MAX_SUPERVISOR_FAILURE_CODE_BYTES);
    debug_assert!(message.len() <= MAX_SUPERVISOR_FAILURE_MESSAGE_BYTES);
    ProcessSupervisorFailure {
        code: code.to_owned(),
        message: message.to_owned(),
    }
}

fn supervisor_failure_diagnostic(failure: &ProcessSupervisorFailure) -> String {
    let diagnostic = format!(
        "failure-code={} failure-message={}",
        failure.code(),
        failure.message()
    );
    debug_assert!(diagnostic.len() <= MAX_SUPERVISOR_FAILURE_DIAGNOSTIC_BYTES);
    diagnostic
}

fn is_worker_stdout_loss_event(kind: &str, stream: Option<&str>, worker: bool) -> bool {
    worker && stream == Some("stdout") && matches!(kind, "stream-truncated" | "stream-pressure")
}

fn is_known_supervisor_lifecycle_kind(kind: &str) -> bool {
    matches!(
        kind,
        "memory"
            | "soft-limit"
            | "hard-limit"
            | "stop-escalated"
            | "listener-ownership"
            | "stream-pressure"
            | "stream-truncated"
    )
}

fn defer_lifecycle_event(
    deferred: &mut VecDeque<Value>,
    value: Value,
) -> Result<(), ProcessOwnerError> {
    // Memory records are periodic samples, not lifecycle authority. Preserve
    // the newest sample while an ownership inspection is in flight so a slow
    // readiness window cannot grow an unbounded replay queue. Every distinct
    // limit/stop/stream event remains ordered and lossless.
    if value.get("type").and_then(Value::as_str) == Some("memory") {
        if let Some(index) = deferred
            .iter()
            .rposition(|candidate| candidate.get("type").and_then(Value::as_str) == Some("memory"))
        {
            deferred[index] = value;
            return Ok(());
        }
    }
    if deferred.len() >= MAX_BUFFERED_PROCESS_OWNER_EVENTS {
        return Err(ProcessOwnerError::Protocol(
            "deferred supervisor lifecycle events exceeded their bound",
        ));
    }
    deferred.push_back(value);
    Ok(())
}

fn send_supervisor_read(sender: &SyncSender<SupervisorRead>, read: SupervisorRead) -> bool {
    sender.send(read).is_ok()
}

fn start_supervisor_reader(stdout: ChildStdout) -> io::Result<Receiver<SupervisorRead>> {
    let (sender, receiver) =
        mpsc::sync_channel::<SupervisorRead>(MAX_BUFFERED_PROCESS_OWNER_EVENTS);
    std::thread::Builder::new()
        .name("runtime-process-owner-events".into())
        .spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = Vec::new();
                let result = reader
                    .by_ref()
                    .take(MAX_PROCESS_OWNER_PROTOCOL_LINE_BYTES + 1)
                    .read_until(b'\n', &mut line);
                let count = match result {
                    Ok(count) => count,
                    Err(error) => {
                        let _ = send_supervisor_read(&sender, SupervisorRead::Io(error));
                        return;
                    }
                };
                if count == 0 {
                    let _ = send_supervisor_read(&sender, SupervisorRead::End);
                    return;
                }
                if line.len() as u64 > MAX_PROCESS_OWNER_PROTOCOL_LINE_BYTES {
                    let _ = send_supervisor_read(
                        &sender,
                        SupervisorRead::Protocol(
                            "supervisor protocol record exceeded its byte bound",
                        ),
                    );
                    return;
                }
                if !line.ends_with(b"\n") {
                    let _ = send_supervisor_read(
                        &sender,
                        SupervisorRead::Protocol("supervisor protocol ended mid-record"),
                    );
                    return;
                }
                if !send_supervisor_read(&sender, SupervisorRead::Record(line)) {
                    return;
                }
            }
        })?;
    Ok(receiver)
}

/// The live owner is deliberately distinct from `AuthoritativeProcessOwner`.
/// Only a verified terminal receipt plus the pinned native supervisor's exit
/// can mint one guarded tree-exit receipt; transient confirmation failures do
/// not consume the live owner.
pub struct RunningProcessOwner {
    child: Child,
    control: ChildStdin,
    events: Receiver<SupervisorRead>,
    private_diagnostics: PrivateDiagnosticBuffer,
    worker_events: Option<WorkerEventStream>,
    worker_protocol_fault: Option<WorkerProtocolFault>,
    deferred_lifecycle: VecDeque<Value>,
    pending_terminal: Option<ProcessOwnerTerminal>,
    observed_terminal: Option<ProcessOwnerTerminal>,
    supervisor_protocol_poisoned: bool,
    exit_confirmation_minted: bool,
    generation: CurrentGenerationMembership,
    launch: TrustedProcessLaunch,
    supervisor_pid: u32,
    root_pid: Option<u32>,
    pending_residency: Option<ProcessTreeResidency>,
    residency_taken: bool,
    started_boundary_accepted: bool,
    terminal_seen: bool,
    stop_requested: bool,
    listener_inspection_sequence: u64,
    pending_listener_inspection: Option<PendingListenerInspection>,
    completed_listener_inspection: Option<CompletedListenerInspection>,
    listener_inspection_wait_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PendingListenerInspection {
    request_id: u64,
    port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CompletedListenerInspection {
    request: PendingListenerInspection,
    ownership: LoopbackListenerOwnership,
}

pub(crate) enum ProcessSpawnAttempt {
    Running(Box<RunningProcessOwner>),
    NotCreated {
        launch: Box<TrustedProcessLaunch>,
        error: ProcessOwnerError,
    },
    Uncertain(Box<ProcessCreationUncertain>),
}

/// Owns the exact child handle, inherited generation containment, and trusted
/// launch after `CreateProcess` succeeded but launch setup could not establish
/// the ordinary supervisor protocol. Runtime bootstrap placed the creating
/// process in the non-breakaway generation Job before minting membership, so
/// even a defense-in-depth membership-query failure cannot create an
/// uncontained-child window. This deliberately cannot mint a no-process-
/// created receipt. Dropping it performs bounded emergency cleanup without
/// relabeling that best-effort attempt as tree-exit proof; authoritative proof
/// remains the next generation's kernel Job drain.
pub(crate) struct ProcessCreationUncertain {
    child: Option<Child>,
    generation: CurrentGenerationMembership,
    launch: Box<TrustedProcessLaunch>,
    supervisor_pid: u32,
    error: ProcessOwnerError,
}

impl fmt::Debug for ProcessCreationUncertain {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (&self.generation, &self.launch);
        formatter
            .debug_struct("ProcessCreationUncertain")
            .field("supervisor_pid", &self.supervisor_pid)
            .field("authority", &"<opaque live cleanup authority>")
            .field("error", &self.error)
            .finish()
    }
}

impl ProcessCreationUncertain {
    fn new(
        child: Child,
        generation: CurrentGenerationMembership,
        launch: TrustedProcessLaunch,
        error: ProcessOwnerError,
    ) -> Self {
        let supervisor_pid = child.id();
        Self {
            child: Some(child),
            generation,
            launch: Box::new(launch),
            supervisor_pid,
            error,
        }
    }

    pub(crate) fn error(&self) -> &ProcessOwnerError {
        &self.error
    }

    pub(crate) fn request_emergency_termination(&mut self) {
        if let Some(child) = self.child.as_mut() {
            terminate_and_reap_bounded(child, FORCED_REAP_TIMEOUT);
        }
    }
}

impl Drop for ProcessCreationUncertain {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            terminate_and_reap_bounded(&mut child, FORCED_REAP_TIMEOUT);
        }
    }
}

impl fmt::Debug for RunningProcessOwner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RunningProcessOwner")
            .field("supervisor_pid", &self.supervisor_pid)
            .field("root_pid", &self.root_pid)
            .field("terminal_seen", &self.terminal_seen)
            .field("stop_requested", &self.stop_requested)
            .field(
                "listener_inspection_pending",
                &self.pending_listener_inspection.is_some(),
            )
            .field(
                "listener_inspection_completed",
                &self.completed_listener_inspection.is_some(),
            )
            .field("private_diagnostic_count", &self.private_diagnostics.len())
            .field("typed_worker_event_stream", &self.worker_events.is_some())
            .field("worker_protocol_fault", &self.worker_protocol_fault)
            .field("deferred_lifecycle_count", &self.deferred_lifecycle.len())
            .field(
                "supervisor_protocol_poisoned",
                &self.supervisor_protocol_poisoned,
            )
            .field("exit_confirmation_minted", &self.exit_confirmation_minted)
            .field("residency_available", &self.pending_residency.is_some())
            .field("residency_taken", &self.residency_taken)
            .field("started_boundary_accepted", &self.started_boundary_accepted)
            .field("launch", &"<redacted trusted launch>")
            .finish()
    }
}

impl RunningProcessOwner {
    /// Raw service spawning is crate-private. Production callers must consume
    /// an acknowledged durable StartTree authority through `service_process`.
    pub(crate) fn spawn_claimed_service(
        generation: &CurrentGenerationMembership,
        launch: TrustedProcessLaunch,
    ) -> ProcessSpawnAttempt {
        if !matches!(&launch.purpose, ProcessOwnerPurpose::Service { .. }) {
            return ProcessSpawnAttempt::NotCreated {
                launch: Box::new(launch),
                error: ProcessOwnerError::InvalidLaunch(
                    "service launch did not carry service purpose",
                ),
            };
        }
        if !generation.matches_scope(launch.generation_scope()) {
            return ProcessSpawnAttempt::NotCreated {
                launch: Box::new(launch),
                error: ProcessOwnerError::GenerationScopeMismatch,
            };
        }
        Self::spawn_classified(generation, launch)
    }

    pub(crate) fn spawn_claimed_worker(
        generation: &CurrentGenerationMembership,
        launch: TrustedProcessLaunch,
    ) -> ProcessSpawnAttempt {
        if !matches!(&launch.purpose, ProcessOwnerPurpose::Worker(_)) {
            return ProcessSpawnAttempt::NotCreated {
                launch: Box::new(launch),
                error: ProcessOwnerError::InvalidLaunch(
                    "claimed worker launch did not carry worker purpose",
                ),
            };
        }
        if !generation.matches_scope(launch.generation_scope()) {
            return ProcessSpawnAttempt::NotCreated {
                launch: Box::new(launch),
                error: ProcessOwnerError::GenerationScopeMismatch,
            };
        }
        Self::spawn_classified(generation, launch)
    }

    #[cfg(windows)]
    fn spawn_classified(
        generation: &CurrentGenerationMembership,
        launch: TrustedProcessLaunch,
    ) -> ProcessSpawnAttempt {
        if let Err(error) = launch.revalidate_pins() {
            return ProcessSpawnAttempt::NotCreated {
                launch: Box::new(launch),
                error,
            };
        }
        if let Err(error) = launch.persist_service_diagnostic("lifecycle", "launch-start") {
            return ProcessSpawnAttempt::NotCreated {
                launch: Box::new(launch),
                error,
            };
        }
        let environment = match launch.child_environment() {
            Ok(environment) => environment,
            Err(error) => {
                return ProcessSpawnAttempt::NotCreated {
                    launch: Box::new(launch),
                    error,
                }
            }
        };
        let entrypoint_argument = match worker_entrypoint_argument(launch.entrypoint.as_ref()) {
            Ok(entrypoint) => entrypoint,
            Err(error) => {
                return ProcessSpawnAttempt::NotCreated {
                    launch: Box::new(launch),
                    error,
                }
            }
        };
        let working_directory_argument =
            match launch.target.working_directory().child_process_path() {
                Ok(directory) => directory,
                Err(error) => {
                    return ProcessSpawnAttempt::NotCreated {
                        launch: Box::new(launch),
                        error: ProcessOwnerError::Path(error),
                    }
                }
            };
        let mut command = Command::new(launch.supervisor.absolute());
        command
            .env_clear()
            .envs(
                environment
                    .iter()
                    .map(|(name, value)| (name.as_os_str(), value.as_os_str())),
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .arg("--soft-limit-bytes")
            .arg(launch.limits.soft_commit_bytes.to_string())
            .arg("--hard-limit-bytes")
            .arg(launch.limits.hard_commit_bytes.to_string())
            .arg("--graceful-timeout-ms")
            .arg(launch.limits.graceful_shutdown.as_millis().to_string())
            .arg("--cwd")
            .arg(&working_directory_argument)
            .arg("--environment-profile")
            .arg(launch.environment.supervisor_profile_argument());
        if let Some(guard) = launch.limits.system_commit_guard {
            command
                .arg("--expected-commit-bytes")
                .arg(guard.expected_commit_bytes().to_string())
                .arg("--system-commit-reserve-bytes")
                .arg(guard.trusted_reserve_bytes().to_string());
        }
        for (name, _) in &environment {
            command.arg("--inherit-env").arg(name);
        }
        command.arg("--").arg(launch.executable.absolute());
        // Only workers retain the compatibility entrypoint convention. A
        // service profile supplies its complete argv, so prepending any
        // entrypoint here would silently change the manifest-selected command.
        if matches!(&launch.target, TrustedProcessTarget::Worker(_)) {
            if let Some(entrypoint) = &entrypoint_argument {
                command.arg(entrypoint);
            }
        }
        launch.target.arguments().apply_to(&mut command);

        // All launch authorities are revalidated immediately before the OS
        // opens the pinned supervisor image. The supervisor repeats the target
        // containment sequence as CREATE_SUSPENDED + atomic Job assignment +
        // membership verification + ResumeThread.
        if let Err(error) = launch.revalidate_pins() {
            return ProcessSpawnAttempt::NotCreated {
                launch: Box::new(launch),
                error,
            };
        }
        // RuntimeGenerationGuard assigned this runtime process to the
        // non-breakaway generation Job Object before it minted `generation`.
        // Windows therefore creates this supervisor inside that boundary
        // atomically. No descendant can exist in a post-create/pre-assignment
        // gap; the membership check below is defense in depth.
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                return ProcessSpawnAttempt::NotCreated {
                    launch: Box::new(launch),
                    error: ProcessOwnerError::Spawn(error),
                }
            }
        };
        let supervisor_pid = child.id();
        if let Err(error) = verify_or_assign_supervisor_generation(&child, generation) {
            return ProcessSpawnAttempt::Uncertain(Box::new(ProcessCreationUncertain::new(
                child,
                generation.clone(),
                launch,
                error,
            )));
        }
        let mut control = match child.stdin.take() {
            Some(control) => control,
            None => {
                return ProcessSpawnAttempt::Uncertain(Box::new(ProcessCreationUncertain::new(
                    child,
                    generation.clone(),
                    launch,
                    ProcessOwnerError::Protocol("supervisor stdin was unavailable"),
                )));
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                return ProcessSpawnAttempt::Uncertain(Box::new(ProcessCreationUncertain::new(
                    child,
                    generation.clone(),
                    launch,
                    ProcessOwnerError::Protocol("supervisor stdout was unavailable"),
                )));
            }
        };
        let events = match start_supervisor_reader(stdout) {
            Ok(events) => events,
            Err(error) => {
                return ProcessSpawnAttempt::Uncertain(Box::new(ProcessCreationUncertain::new(
                    child,
                    generation.clone(),
                    launch,
                    ProcessOwnerError::Control(error),
                )));
            }
        };
        if let Err(error) = control
            .write_all(SUPERVISOR_ACTIVATION_RECORD)
            .and_then(|_| control.flush())
        {
            return ProcessSpawnAttempt::Uncertain(Box::new(ProcessCreationUncertain::new(
                child,
                generation.clone(),
                launch,
                ProcessOwnerError::Control(error),
            )));
        }
        let worker_events = match &launch.purpose {
            ProcessOwnerPurpose::Worker(identity) => Some(WorkerEventStream::new(identity.clone())),
            ProcessOwnerPurpose::Service { .. } => None,
        };
        ProcessSpawnAttempt::Running(Box::new(Self {
            child,
            control,
            events,
            private_diagnostics: PrivateDiagnosticBuffer::new(),
            worker_events,
            worker_protocol_fault: None,
            deferred_lifecycle: VecDeque::new(),
            pending_terminal: None,
            observed_terminal: None,
            supervisor_protocol_poisoned: false,
            exit_confirmation_minted: false,
            generation: generation.clone(),
            launch,
            supervisor_pid,
            root_pid: None,
            pending_residency: None,
            residency_taken: false,
            started_boundary_accepted: false,
            terminal_seen: false,
            stop_requested: false,
            listener_inspection_sequence: 0,
            pending_listener_inspection: None,
            completed_listener_inspection: None,
            listener_inspection_wait_active: false,
        }))
    }

    #[cfg(not(windows))]
    fn spawn_classified(
        _generation: &CurrentGenerationMembership,
        launch: TrustedProcessLaunch,
    ) -> ProcessSpawnAttempt {
        // Process groups alone cannot prove that a descendant did not call
        // setsid/setpgid and escape. Until the native runtime has an OS-backed
        // containment implementation for the target platform, refusing launch
        // is safer than minting false complete-tree authority.
        ProcessSpawnAttempt::NotCreated {
            launch: Box::new(launch),
            error: ProcessOwnerError::UnsupportedPlatform,
        }
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.supervisor_pid
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.root_pid
    }

    pub(crate) fn supervisor_has_exited(&mut self) -> Result<bool, ProcessOwnerError> {
        self.child
            .try_wait()
            .map(|status| status.is_some())
            .map_err(ProcessOwnerError::Control)
    }

    /// Takes the one residency authority minted by this live owner after its
    /// exact first `started` record was accepted. A PID, lifecycle `Value`, or
    /// repeated call cannot mint another authority.
    pub fn take_process_tree_residency(
        &mut self,
    ) -> Result<ProcessTreeResidency, ProcessOwnerError> {
        take_residency_authority(&mut self.pending_residency, &mut self.residency_taken)
    }

    pub fn request_stop(&mut self, force: bool) -> Result<(), ProcessOwnerError> {
        if self.terminal_seen {
            return Err(ProcessOwnerError::InvalidState(
                "stop was requested after the terminal event",
            ));
        }
        let record = if force {
            &b"{\"type\":\"stop\",\"force\":true}\n"[..]
        } else {
            &b"{\"type\":\"stop\",\"force\":false}\n"[..]
        };
        self.control
            .write_all(record)
            .and_then(|_| self.control.flush())
            .map_err(ProcessOwnerError::Control)?;
        self.stop_requested = true;
        Ok(())
    }

    /// Asks the exact pinned supervisor which still owns this service's
    /// private Job Object to correlate the loopback listener with the Job's
    /// current resident PID list. An HTTP response alone is not readiness
    /// authority: an unrelated local process may already occupy the reserved
    /// port. The request/response sequence is bound to this live owner, and a
    /// timeout retains the exact outstanding request rather than advancing to
    /// an id whose response could be confused with delayed protocol data.
    pub(crate) fn inspect_loopback_listener_ownership(
        &mut self,
        port: u16,
        timeout: Duration,
    ) -> Result<LoopbackListenerOwnership, ProcessOwnerError> {
        if !matches!(&self.launch.purpose, ProcessOwnerPurpose::Service { .. }) {
            return Err(ProcessOwnerError::InvalidState(
                "listener ownership inspection requires a service process",
            ));
        }
        if self.root_pid.is_none() || !self.started_boundary_accepted {
            return Err(ProcessOwnerError::InvalidState(
                "listener ownership inspection requires the accepted started boundary",
            ));
        }
        if self.terminal_seen || self.stop_requested {
            return Err(ProcessOwnerError::InvalidState(
                "listener ownership inspection is unavailable after stop or exit",
            ));
        }
        if port == 0 {
            return Err(ProcessOwnerError::InvalidState(
                "listener ownership inspection received an invalid port",
            ));
        }
        let deadline = bounded_event_deadline(timeout)?;
        if let Some(completed) = self.completed_listener_inspection.take() {
            if completed.request.port == port {
                return Ok(completed.ownership);
            }
            self.completed_listener_inspection = Some(completed);
            return Err(ProcessOwnerError::InvalidState(
                "a different listener ownership result remains unconsumed",
            ));
        }

        let inspection = match self.pending_listener_inspection {
            Some(inspection) if inspection.port == port => inspection,
            Some(_) => {
                return Err(ProcessOwnerError::InvalidState(
                    "a different listener ownership inspection remains outstanding",
                ))
            }
            None => {
                let request_id = self.listener_inspection_sequence.checked_add(1).ok_or(
                    ProcessOwnerError::InvalidState(
                        "listener ownership inspection sequence was exhausted",
                    ),
                )?;
                let inspection = PendingListenerInspection { request_id, port };
                // Record the request before writing it. A short/failed control
                // write is ambiguous: retrying with a new request id could
                // leave a delayed valid response queued ahead of the new one.
                // Retaining this exact request therefore fails closed and also
                // prevents readiness retries from filling the control queue.
                self.listener_inspection_sequence = request_id;
                self.pending_listener_inspection = Some(inspection);
                let record = format!(
                    "{{\"type\":\"inspect-loopback-listener\",\"requestId\":{request_id},\"port\":{port}}}\n"
                );
                self.control
                    .write_all(record.as_bytes())
                    .and_then(|_| self.control.flush())
                    .map_err(ProcessOwnerError::Control)?;
                inspection
            }
        };

        let mut deferred = std::mem::take(&mut self.deferred_lifecycle);
        loop {
            self.listener_inspection_wait_active = true;
            let event_result = self.read_event_until(deadline);
            self.listener_inspection_wait_active = false;
            let event = match event_result {
                Ok(event) => event,
                Err(error) => {
                    self.restore_deferred_lifecycle(deferred)?;
                    return Err(error);
                }
            };
            match event {
                ProcessOwnerEvent::Lifecycle(value)
                    if value.get("type").and_then(Value::as_str) == Some("listener-ownership") =>
                {
                    let result =
                        parse_listener_ownership(&value, inspection.request_id, inspection.port);
                    // The response record has been consumed even when its
                    // shape is invalid. Only a timeout keeps the exact request
                    // outstanding for the next readiness poll.
                    self.pending_listener_inspection = None;
                    self.restore_deferred_lifecycle(deferred)?;
                    if matches!(result, Err(ProcessOwnerError::Protocol(_))) {
                        self.supervisor_protocol_poisoned = true;
                    }
                    return result;
                }
                ProcessOwnerEvent::Lifecycle(value) => {
                    if let Err(error) = defer_lifecycle_event(&mut deferred, value) {
                        self.deferred_lifecycle = deferred;
                        self.supervisor_protocol_poisoned = true;
                        return Err(error);
                    }
                }
                ProcessOwnerEvent::Terminal(terminal) => {
                    // Preserve the exact terminal record for the ordinary
                    // service-exit path; this inspection is not allowed to
                    // consume zero-resident authority.
                    self.restore_deferred_lifecycle(deferred)?;
                    self.pending_listener_inspection = None;
                    self.pending_terminal = Some(terminal);
                    self.observed_terminal = None;
                    return Ok(LoopbackListenerOwnership::ProcessExited);
                }
                ProcessOwnerEvent::Worker(_) | ProcessOwnerEvent::WorkerProtocolFault(_) => {
                    self.restore_deferred_lifecycle(deferred)?;
                    self.supervisor_protocol_poisoned = true;
                    return Err(ProcessOwnerError::Protocol(
                        "service listener inspection observed a worker event",
                    ));
                }
            }
        }
    }

    fn restore_deferred_lifecycle(
        &mut self,
        mut deferred: VecDeque<Value>,
    ) -> Result<(), ProcessOwnerError> {
        if deferred.len().saturating_add(self.deferred_lifecycle.len())
            > MAX_BUFFERED_PROCESS_OWNER_EVENTS
        {
            self.supervisor_protocol_poisoned = true;
            return Err(ProcessOwnerError::Protocol(
                "deferred supervisor lifecycle events exceeded their bound",
            ));
        }
        deferred.append(&mut self.deferred_lifecycle);
        self.deferred_lifecycle = deferred;
        Ok(())
    }

    /// Returns the bounded terminal budget without consuming live ownership.
    /// Callers retain `self` across stop-write, event, and timeout failures and
    /// can therefore escalate or continue draining toward containment proof.
    pub fn stop_terminal_wait_timeout(&self, force: bool) -> Result<Duration, ProcessOwnerError> {
        terminal_wait_timeout(self.launch.limits, force)
    }

    pub fn read_event(
        &mut self,
        timeout: Duration,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        let deadline = bounded_event_deadline(timeout)?;
        self.read_event_until(deadline)
    }

    fn read_event_until(
        &mut self,
        deadline: Instant,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        if self.supervisor_protocol_poisoned {
            return Err(ProcessOwnerError::Protocol(
                "supervisor protocol authority was permanently poisoned",
            ));
        }
        let result = self.read_event_until_inner(deadline);
        if matches!(&result, Err(ProcessOwnerError::Protocol(_))) {
            self.supervisor_protocol_poisoned = true;
        }
        result
    }

    fn read_event_until_inner(
        &mut self,
        deadline: Instant,
    ) -> Result<ProcessOwnerEvent, ProcessOwnerError> {
        if let Some(value) = self.deferred_lifecycle.pop_front() {
            return Ok(ProcessOwnerEvent::Lifecycle(value));
        }
        if let Some(terminal) = self.pending_terminal.take() {
            self.observed_terminal = Some(terminal.clone());
            self.terminal_seen = true;
            return Ok(ProcessOwnerEvent::Terminal(terminal));
        }
        if self.terminal_seen {
            return Err(ProcessOwnerError::InvalidState(
                "protocol was read after its terminal event",
            ));
        }
        if let Some(event) = self
            .worker_events
            .as_mut()
            .and_then(WorkerEventStream::pop_ready)
        {
            return Ok(ProcessOwnerEvent::Worker(
                OwnedWorkerEvent::from_process_owner(self.generation.clone(), event),
            ));
        }
        loop {
            let mut line = match recv_supervisor_read_until(&self.events, deadline)? {
                SupervisorRead::Record(line) => line,
                SupervisorRead::End => return Err(ProcessOwnerError::MissingTerminalReceipt),
                SupervisorRead::Io(error) => return Err(ProcessOwnerError::Control(error)),
                SupervisorRead::Protocol(message) => {
                    return Err(ProcessOwnerError::Protocol(message))
                }
            };
            let encoded_bytes = line.len();
            while matches!(line.last(), Some(b'\n' | b'\r')) {
                line.pop();
            }
            let value: Value = serde_json::from_slice(&line)
                .map_err(|_| ProcessOwnerError::Protocol("supervisor record was not valid JSON"))?;
            let kind =
                value
                    .get("type")
                    .and_then(Value::as_str)
                    .ok_or(ProcessOwnerError::Protocol(
                        "supervisor record had no event type",
                    ))?;
            if self.root_pid.is_none() && !matches!(kind, "started" | "error") {
                return Err(ProcessOwnerError::Protocol(
                    "supervisor emitted lifecycle data before the started boundary",
                ));
            }
            if is_private_diagnostic_kind(kind) {
                let data = private_diagnostic_data(&value)?;
                self.launch.persist_service_diagnostic(kind, data)?;
                if kind == "stderr" {
                    // Worker diagnostics are supporting evidence, not process
                    // authority. A logging I/O failure must not turn a healthy
                    // worker into a failed job; the same bytes remain in the
                    // bounded private buffer for the live owner's lifetime.
                    let _ = self.launch.persist_worker_diagnostic(kind, data);
                }
                let worker_fault = if kind == "stdout" {
                    self.worker_events
                        .as_mut()
                        .and_then(|worker_events| worker_events.push_stdout_chunk(data))
                } else {
                    None
                };
                self.private_diagnostics.record(encoded_bytes, value);
                if let Some(fault) = worker_fault {
                    self.worker_protocol_fault = Some(fault);
                    return Ok(ProcessOwnerEvent::WorkerProtocolFault(fault));
                }
                if let Some(event) = self
                    .worker_events
                    .as_mut()
                    .and_then(WorkerEventStream::pop_ready)
                {
                    return Ok(ProcessOwnerEvent::Worker(
                        OwnedWorkerEvent::from_process_owner(self.generation.clone(), event),
                    ));
                }
                continue;
            }
            if is_worker_stdout_loss_event(
                kind,
                value.get("stream").and_then(Value::as_str),
                self.worker_events.is_some(),
            ) {
                if let Some(fault) = self
                    .worker_events
                    .as_mut()
                    .and_then(|events| events.poison(WorkerProtocolFault::OutputLost))
                {
                    self.worker_protocol_fault = Some(fault);
                    return Ok(ProcessOwnerEvent::WorkerProtocolFault(fault));
                }
                continue;
            }
            if kind == "listener-ownership" && !self.listener_inspection_wait_active {
                let request =
                    self.pending_listener_inspection
                        .ok_or(ProcessOwnerError::Protocol(
                            "supervisor emitted listener ownership without an outstanding request",
                        ))?;
                let ownership = parse_listener_ownership(&value, request.request_id, request.port)?;
                self.pending_listener_inspection = None;
                if self
                    .completed_listener_inspection
                    .replace(CompletedListenerInspection { request, ownership })
                    .is_some()
                {
                    return Err(ProcessOwnerError::Protocol(
                        "supervisor emitted more than one listener ownership result",
                    ));
                }
                // Listener evidence is an internal authority exchange, not an
                // observable lifecycle event. Preserve it for the next
                // readiness probe and continue to the caller's requested
                // lifecycle or terminal record.
                continue;
            }
            return match kind {
                "started" => {
                    let pid = bounded_pid(value.get("pid"))?;
                    if self.root_pid.replace(pid).is_some() {
                        return Err(ProcessOwnerError::Protocol(
                            "supervisor emitted more than one started event",
                        ));
                    }
                    if self.pending_residency.is_some() || self.residency_taken {
                        return Err(ProcessOwnerError::Protocol(
                            "supervisor attempted to mint residency more than once",
                        ));
                    }
                    self.pending_residency = Some(ProcessTreeResidency::from_accepted_started(
                        self.generation.clone(),
                        self.supervisor_pid,
                        pid,
                        self.launch.purpose.clone(),
                    ));
                    self.started_boundary_accepted = true;
                    Ok(ProcessOwnerEvent::Lifecycle(value))
                }
                "exit" => {
                    let terminal = ProcessOwnerTerminal::parse(&value, self.root_pid)?;
                    terminal.validate_system_commit_guard_for_limits(
                        self.launch.limits,
                        self.launch
                            .environment
                            .is_live_system_commit_reserve_victim(),
                    )?;
                    terminal.validate_zero_resident_release()?;
                    if let Some(fault) = self
                        .worker_events
                        .as_mut()
                        .and_then(WorkerEventStream::finish_record_boundary)
                    {
                        self.worker_protocol_fault = Some(fault);
                        self.pending_terminal = Some(terminal);
                        return Ok(ProcessOwnerEvent::WorkerProtocolFault(fault));
                    }
                    self.observed_terminal = Some(terminal.clone());
                    self.terminal_seen = true;
                    Ok(ProcessOwnerEvent::Terminal(terminal))
                }
                "error" => {
                    if self.root_pid.is_some() || value.get("rootPid").is_some() {
                        let terminal = ProcessOwnerTerminal::parse(&value, self.root_pid)?;
                        terminal.validate_system_commit_guard_for_limits(
                            self.launch.limits,
                            self.launch
                                .environment
                                .is_live_system_commit_reserve_victim(),
                        )?;
                        terminal.validate_zero_resident_release()?;
                        if self.root_pid.is_none() {
                            self.root_pid = terminal.root_pid;
                        }
                        if let Some(fault) = self
                            .worker_events
                            .as_mut()
                            .and_then(WorkerEventStream::finish_record_boundary)
                        {
                            self.worker_protocol_fault = Some(fault);
                            self.pending_terminal = Some(terminal);
                            self.persist_supervisor_failure_diagnostic(
                                self.pending_terminal
                                    .as_ref()
                                    .expect("retained terminal must remain available"),
                            );
                            return Ok(ProcessOwnerEvent::WorkerProtocolFault(fault));
                        }
                        self.observed_terminal = Some(terminal.clone());
                        self.terminal_seen = true;
                        self.persist_supervisor_failure_diagnostic(&terminal);
                        Ok(ProcessOwnerEvent::Terminal(terminal))
                    } else {
                        // The pinned supervisor emits this deliberately smaller
                        // record only when it failed before CreateProcessW
                        // returned a target. Every post-create failure is
                        // routed through its cleanup epilogue and carries a
                        // rootPid plus complete tree-exit accounting. Preserve
                        // the minimal record as terminal authority instead of
                        // converting it to an error that can never be confirmed.
                        let terminal = ProcessOwnerTerminal::parse_pre_start_failure(&value)?;
                        terminal.validate_system_commit_guard_for_limits(
                            self.launch.limits,
                            self.launch
                                .environment
                                .is_live_system_commit_reserve_victim(),
                        )?;
                        terminal.validate_zero_resident_release()?;
                        if let Some(fault) = self
                            .worker_events
                            .as_mut()
                            .and_then(WorkerEventStream::finish_record_boundary)
                        {
                            self.worker_protocol_fault = Some(fault);
                            self.pending_terminal = Some(terminal);
                            self.persist_supervisor_failure_diagnostic(
                                self.pending_terminal
                                    .as_ref()
                                    .expect("retained terminal must remain available"),
                            );
                            return Ok(ProcessOwnerEvent::WorkerProtocolFault(fault));
                        }
                        self.observed_terminal = Some(terminal.clone());
                        self.terminal_seen = true;
                        self.persist_supervisor_failure_diagnostic(&terminal);
                        Ok(ProcessOwnerEvent::Terminal(terminal))
                    }
                }
                kind if is_known_supervisor_lifecycle_kind(kind) => {
                    Ok(ProcessOwnerEvent::Lifecycle(value))
                }
                _ => Err(ProcessOwnerError::Protocol(
                    "supervisor emitted an unknown lifecycle event",
                )),
            };
        }
    }

    fn persist_supervisor_failure_diagnostic(&self, terminal: &ProcessOwnerTerminal) {
        let Some(failure) = terminal.failure() else {
            return;
        };
        // This log is private, bounded supporting evidence; it is never part of
        // process-tree authority. Once a terminal record has been retained, a
        // diagnostic I/O failure must not consume that record or prevent the
        // caller from confirming zero residency.
        let _ = self
            .launch
            .persist_service_diagnostic("supervisor", &supervisor_failure_diagnostic(failure));
        let _ = self
            .launch
            .persist_worker_diagnostic("supervisor", &supervisor_failure_diagnostic(failure));
    }

    pub fn wait_for_terminal<F>(
        &mut self,
        timeout: Duration,
        mut observe: F,
    ) -> Result<ProcessOwnerTerminal, ProcessOwnerError>
    where
        F: FnMut(&ProcessOwnerEvent),
    {
        let deadline = bounded_event_deadline(timeout)?;
        loop {
            match self.read_event_until(deadline)? {
                ProcessOwnerEvent::Terminal(terminal) => return Ok(terminal),
                event => observe(&event),
            }
        }
    }

    pub(crate) fn reject_current_worker_event(&mut self) -> Result<(), ProcessOwnerError> {
        if self.terminal_seen {
            return Err(ProcessOwnerError::InvalidState(
                "worker event was rejected after the terminal boundary",
            ));
        }
        reject_worker_event_for_durable_state(
            self.worker_events.as_mut(),
            &mut self.worker_protocol_fault,
        )
    }

    pub fn confirm_exit(
        &mut self,
        terminal: &ProcessOwnerTerminal,
    ) -> Result<ProcessTreeExit, ProcessOwnerError> {
        if self.supervisor_protocol_poisoned {
            return Err(ProcessOwnerError::Protocol(
                "poisoned supervisor protocol cannot mint tree-exit authority",
            ));
        }
        if self.exit_confirmation_minted {
            return Err(ProcessOwnerError::InvalidState(
                "tree-exit authority was already minted",
            ));
        }
        if !self.terminal_seen {
            return Err(ProcessOwnerError::InvalidState(
                "terminal receipt was not read from this live owner",
            ));
        }
        if self.observed_terminal.as_ref() != Some(terminal) {
            return Err(ProcessOwnerError::InvalidState(
                "terminal receipt belonged to a different live owner",
            ));
        }
        if let Err(error) = terminal.validate_zero_resident_release() {
            self.supervisor_protocol_poisoned = true;
            return Err(error);
        }
        if terminal.root_pid != self.root_pid {
            self.supervisor_protocol_poisoned = true;
            return Err(ProcessOwnerError::Protocol(
                "observed terminal receipt no longer matched the started process",
            ));
        }
        let status =
            wait_for_child_exit(&mut self.child, self.launch.limits.supervisor_exit_timeout)?;
        verify_supervisor_exit(status, terminal.code)?;

        // The reader owns the pipe and must confirm EOF within a second
        // bounded deadline. Any queued record after the terminal boundary
        // invalidates the receipt.
        let reader_end =
            confirm_supervisor_reader_end(&self.events, self.launch.limits.supervisor_exit_timeout);
        if matches!(&reader_end, Err(ProcessOwnerError::Protocol(_))) {
            self.supervisor_protocol_poisoned = true;
        }
        reader_end?;

        let classification = classify_process_exit(terminal, self.worker_protocol_fault);
        let receipt = ProcessTreeExit {
            generation: Some(ProcessAuthorityGeneration::Live(self.generation.clone())),
            started_boundary_accepted: self.started_boundary_accepted,
            supervisor_pid: self.supervisor_pid,
            root_pid: terminal.root_pid,
            purpose: self.launch.purpose.clone(),
            root_exit_code: terminal.target_exit_code,
            classification,
            failure: terminal.failure.clone(),
            stop_outcome: terminal.stop_outcome,
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: terminal.peak_job_commit_bytes,
                complete: terminal.peak_accounting_complete,
            },
            system_commit_guard: terminal.system_commit_guard,
            supervisor_error_count: terminal.supervisor_error_count,
            cleanup_error_count: terminal.cleanup_error_count,
            worker_protocol_fault: self.worker_protocol_fault,
        };
        self.exit_confirmation_minted = true;
        Ok(receipt)
    }
}

#[cfg(windows)]
fn verify_or_assign_supervisor_generation(
    child: &Child,
    generation: &CurrentGenerationMembership,
) -> Result<(), ProcessOwnerError> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, IsProcessInJob};

    let process = child.as_raw_handle() as HANDLE;
    let job = generation.raw_job_handle();
    let mut assigned = 0;
    if unsafe { IsProcessInJob(process, job, &mut assigned) } == 0 {
        return Err(ProcessOwnerError::GenerationContainment(
            io::Error::last_os_error(),
        ));
    }
    if assigned != 0 {
        return Ok(());
    }

    // This fallback is conservative: ordinary supervisors inherit membership
    // at CreateProcess because the runtime itself is already resident and the
    // generation job forbids breakaway. Retain the explicit assignment for an
    // anomalous platform result, then verify before sending activation.
    if unsafe { AssignProcessToJobObject(job, process) } == 0 {
        return Err(ProcessOwnerError::GenerationContainment(
            io::Error::last_os_error(),
        ));
    }
    if unsafe { IsProcessInJob(process, job, &mut assigned) } == 0 {
        return Err(ProcessOwnerError::GenerationContainment(
            io::Error::last_os_error(),
        ));
    }
    if assigned == 0 {
        return Err(ProcessOwnerError::GenerationContainment(io::Error::other(
            "Windows did not confirm outer generation membership",
        )));
    }
    Ok(())
}

impl Drop for RunningProcessOwner {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_some() {
            return;
        }
        // Dropping live authority requests termination of the pinned helper,
        // whose exit closes its kill-on-close Job Object. Reaping is capped so
        // a stuck OS process cannot hang the runtime destructor; no release or
        // completion capability is minted on this uncertain emergency path.
        terminate_and_reap_bounded(&mut self.child, FORCED_REAP_TIMEOUT);
    }
}

fn bounded_event_deadline(timeout: Duration) -> Result<Instant, ProcessOwnerError> {
    // A zero timeout is the controller's explicit non-blocking poll. It must
    // still consume an event that the supervisor reader has already queued;
    // only waits beyond the hard upper bound are invalid.
    if timeout > MAX_PROCESS_OWNER_EVENT_WAIT {
        return Err(ProcessOwnerError::InvalidEventWait);
    }
    Instant::now()
        .checked_add(timeout)
        .ok_or(ProcessOwnerError::InvalidEventWait)
}

fn terminal_wait_timeout(
    limits: ProcessOwnerLimits,
    force: bool,
) -> Result<Duration, ProcessOwnerError> {
    let cooperative_budget = if force {
        Duration::ZERO
    } else {
        limits.graceful_shutdown
    };
    cooperative_budget
        .checked_add(SUPERVISOR_TERMINAL_CLEANUP_BUDGET)
        .filter(|timeout| *timeout <= MAX_PROCESS_OWNER_EVENT_WAIT)
        .ok_or(ProcessOwnerError::InvalidEventWait)
}

fn recv_supervisor_read_until(
    receiver: &Receiver<SupervisorRead>,
    deadline: Instant,
) -> Result<SupervisorRead, ProcessOwnerError> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return match receiver.try_recv() {
            Ok(read) => Ok(read),
            Err(TryRecvError::Empty) => Err(ProcessOwnerError::EventWaitTimeout),
            Err(TryRecvError::Disconnected) => Err(ProcessOwnerError::MissingTerminalReceipt),
        };
    }
    match receiver.recv_timeout(remaining) {
        Ok(read) => Ok(read),
        Err(RecvTimeoutError::Timeout) => Err(ProcessOwnerError::EventWaitTimeout),
        Err(RecvTimeoutError::Disconnected) => Err(ProcessOwnerError::MissingTerminalReceipt),
    }
}

fn confirm_supervisor_reader_end(
    receiver: &Receiver<SupervisorRead>,
    timeout: Duration,
) -> Result<(), ProcessOwnerError> {
    let deadline = bounded_event_deadline(timeout)?;
    match recv_supervisor_read_until(receiver, deadline)? {
        SupervisorRead::End => Ok(()),
        SupervisorRead::Record(_) => Err(ProcessOwnerError::Protocol(
            "supervisor emitted data after its terminal record",
        )),
        SupervisorRead::Io(error) => Err(ProcessOwnerError::Control(error)),
        SupervisorRead::Protocol(message) => Err(ProcessOwnerError::Protocol(message)),
    }
}

fn terminate_and_reap_bounded(child: &mut Child, timeout: Duration) {
    let _ = child.kill();
    let Some(deadline) = Instant::now().checked_add(timeout) else {
        return;
    };
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {}
            Err(_) => return,
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return;
        }
        std::thread::sleep(remaining.min(CHILD_EXIT_POLL_INTERVAL));
    }
}

fn wait_for_child_exit(
    child: &mut Child,
    timeout: Duration,
) -> Result<ExitStatus, ProcessOwnerError> {
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(ProcessOwnerError::SupervisorExitTimeout)?;
    loop {
        if let Some(status) = child.try_wait().map_err(ProcessOwnerError::Control)? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            // Retain the live owner so a caller may retry this bounded check.
            // Dropping the owner remains the emergency kill-on-close path, but
            // a transient reap delay must not destroy its sole receipt.
            return Err(ProcessOwnerError::SupervisorExitTimeout);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        std::thread::sleep(remaining.min(CHILD_EXIT_POLL_INTERVAL));
    }
}

fn verify_supervisor_exit(
    status: ExitStatus,
    expected_terminal_code: Option<u32>,
) -> Result<(), ProcessOwnerError> {
    let Some(status_code) = status.code() else {
        return Err(ProcessOwnerError::ExitStatusMismatch);
    };
    let status_code = status_code as u32;
    // Rich post-create terminal receipts carry the exact expected helper exit
    // code. A minimal pre-start failure intentionally cannot: malformed
    // supervisor options exit 64, while Windows setup/CreateProcess failures
    // exit 1. In that case the trusted error record and subsequent pipe EOF
    // prove the pre-tree failure, while a successful helper exit would still
    // contradict the record and fail closed.
    if expected_terminal_code.map_or(status_code == 0, |expected| status_code != expected) {
        return Err(ProcessOwnerError::ExitStatusMismatch);
    }
    Ok(())
}

fn bounded_pid(value: Option<&Value>) -> Result<u32, ProcessOwnerError> {
    let pid = value
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or(ProcessOwnerError::Protocol(
            "supervisor record contained an invalid process id",
        ))?;
    Ok(pid)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LoopbackListenerOwnership {
    Owned(u32),
    Unowned(u32),
    Absent,
    Unavailable,
    ProcessExited,
}

fn parse_listener_ownership(
    value: &Value,
    expected_request_id: u64,
    expected_port: u16,
) -> Result<LoopbackListenerOwnership, ProcessOwnerError> {
    let object = value.as_object().ok_or(ProcessOwnerError::Protocol(
        "listener ownership record was not an object",
    ))?;
    const FIELDS: [&str; 5] = ["type", "requestId", "port", "status", "ownerPid"];
    if object.len() != FIELDS.len() || FIELDS.iter().any(|field| !object.contains_key(*field)) {
        return Err(ProcessOwnerError::Protocol(
            "listener ownership record had an invalid shape",
        ));
    }
    if object.get("type").and_then(Value::as_str) != Some("listener-ownership")
        || object.get("requestId").and_then(Value::as_u64) != Some(expected_request_id)
        || object
            .get("port")
            .and_then(Value::as_u64)
            .and_then(|port| u16::try_from(port).ok())
            != Some(expected_port)
    {
        return Err(ProcessOwnerError::Protocol(
            "listener ownership record did not match its request",
        ));
    }

    let owner_pid = match object.get("ownerPid") {
        Some(Value::Null) => None,
        value => Some(bounded_pid(value)?),
    };
    match (object.get("status").and_then(Value::as_str), owner_pid) {
        (Some("owned"), Some(owner_pid)) => Ok(LoopbackListenerOwnership::Owned(owner_pid)),
        (Some("unowned"), Some(owner_pid)) => Ok(LoopbackListenerOwnership::Unowned(owner_pid)),
        (Some("absent"), None) => Ok(LoopbackListenerOwnership::Absent),
        (Some("unavailable"), None) => Ok(LoopbackListenerOwnership::Unavailable),
        _ => Err(ProcessOwnerError::Protocol(
            "listener ownership record had an invalid status",
        )),
    }
}

/// A worker event parsed from the exact live owner's bounded stdout stream and
/// coupled to that owner's generation membership. Callers may inspect the
/// typed event, but only `process_owner` can mint the authority required for a
/// production durable transition.
pub struct OwnedWorkerEvent {
    generation: ProcessAuthorityGeneration,
    event: WorkerEvent,
}

impl OwnedWorkerEvent {
    fn from_process_owner(generation: CurrentGenerationMembership, event: WorkerEvent) -> Self {
        Self {
            generation: ProcessAuthorityGeneration::Live(generation),
            event,
        }
    }

    pub fn event(&self) -> &WorkerEvent {
        &self.event
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.generation.matches_scope(scope)
    }

    #[cfg(test)]
    pub(crate) fn for_test(scope: RuntimeGenerationScope, event: WorkerEvent) -> Self {
        Self {
            generation: ProcessAuthorityGeneration::Test(scope),
            event,
        }
    }
}

impl fmt::Debug for OwnedWorkerEvent {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = &self.generation;
        formatter
            .debug_struct("OwnedWorkerEvent")
            .field("event_kind", &owned_worker_event_kind(&self.event))
            .field("payload", &"<redacted typed worker event>")
            .field("generation", &"<opaque generation authority>")
            .finish()
    }
}

fn owned_worker_event_kind(event: &WorkerEvent) -> &'static str {
    match event {
        WorkerEvent::Ready { .. } => "ready",
        WorkerEvent::Heartbeat { .. } => "heartbeat",
        WorkerEvent::Progress { .. } => "progress",
        WorkerEvent::Checkpoint { .. } => "checkpoint",
        WorkerEvent::Artifact { .. } => "artifact",
        WorkerEvent::Complete { .. } => "complete",
        WorkerEvent::Failed { .. } => "failed",
        WorkerEvent::CancellationAcknowledged { .. } => "cancellation-acknowledged",
    }
}

#[derive(Debug)]
pub enum ProcessOwnerEvent {
    Lifecycle(Value),
    Worker(OwnedWorkerEvent),
    WorkerProtocolFault(WorkerProtocolFault),
    Terminal(ProcessOwnerTerminal),
}

fn classify_process_exit(
    terminal: &ProcessOwnerTerminal,
    worker_protocol_fault: Option<WorkerProtocolFault>,
) -> ProcessExitClassification {
    if terminal.failure.is_some() {
        ProcessExitClassification::SupervisorFailure
    } else if terminal.resource_exhausted {
        ProcessExitClassification::ResourceExhausted
    } else if worker_protocol_fault.is_some() {
        ProcessExitClassification::WorkerProtocolFault
    } else if terminal.supervisor_error_count != 0 || terminal.cleanup_error_count != 0 {
        ProcessExitClassification::SupervisorFailure
    } else if terminal.stop_outcome.is_some() {
        ProcessExitClassification::Stopped
    } else {
        ProcessExitClassification::TargetExit
    }
}

/// An opaque parsed terminal record. It is not itself tree-exit authority:
/// `RunningProcessOwner::confirm_exit` must additionally observe the pinned
/// supervisor process exit and pass its internal one-mint guard.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessSystemCommitGuardTerminationReason {
    ExpectedCommitDoesNotFit,
    EffectiveJobLimit,
    SystemCommitReserve,
    SystemCommitObservationUnavailable,
}

/// Closed numeric evidence emitted by the pinned supervisor for a guarded
/// development process tree. It contains no paths, commands, environment
/// data, or free-form diagnostic text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessSystemCommitGuardEvidence {
    pub architecture_reserve_floor_bytes: u64,
    pub launch_derived_reserve_bytes: u64,
    pub trusted_reserve_bytes: u64,
    pub launch_effective_reserve_bytes: u64,
    pub guard_band_bytes: u64,
    pub expected_commit_bytes: u64,
    pub configured_hard_limit_bytes: u64,
    pub effective_hard_limit_bytes: u64,
    pub launch_system_commit_bytes: u64,
    pub launch_system_commit_limit_bytes: u64,
    pub launch_free_commit_bytes: u64,
    pub pre_resume_system_commit_bytes: Option<u64>,
    pub pre_resume_system_commit_limit_bytes: Option<u64>,
    pub pre_resume_free_commit_bytes: Option<u64>,
    pub pre_resume_effective_hard_limit_bytes: Option<u64>,
    pub minimum_observed_free_commit_bytes: u64,
    pub maximum_observed_derived_reserve_bytes: u64,
    pub maximum_observed_effective_reserve_bytes: u64,
    pub termination_reason: Option<ProcessSystemCommitGuardTerminationReason>,
}

#[derive(Clone, PartialEq, Eq)]
pub struct ProcessOwnerTerminal {
    /// Rich post-create receipts carry the supervisor's exact exit code.
    /// Minimal pre-start failures omit it because the helper uses distinct
    /// nonzero exits for option rejection and Windows setup/spawn failure.
    code: Option<u32>,
    root_pid: Option<u32>,
    target_exit_code: Option<u32>,
    resource_exhausted: bool,
    failure: Option<ProcessSupervisorFailure>,
    stop_outcome: Option<ProcessStopOutcome>,
    zero_resident_confirmed: bool,
    peak_job_commit_bytes: Option<u64>,
    peak_accounting_complete: bool,
    system_commit_guard: Option<ProcessSystemCommitGuardEvidence>,
    supervisor_error_count: usize,
    cleanup_error_count: usize,
}

impl fmt::Debug for ProcessOwnerTerminal {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProcessOwnerTerminal")
            .field("code", &self.code)
            .field("root_pid", &self.root_pid)
            .field("resource_exhausted", &self.resource_exhausted)
            .field("failure", &self.failure)
            .field("stop_outcome", &self.stop_outcome)
            .field("zero_resident_confirmed", &self.zero_resident_confirmed)
            .field("peak_accounting_complete", &self.peak_accounting_complete)
            .field("system_commit_guard", &self.system_commit_guard)
            .field("supervisor_error_count", &self.supervisor_error_count)
            .field("cleanup_error_count", &self.cleanup_error_count)
            .finish()
    }
}

fn parse_system_commit_guard_evidence(
    value: Option<&Value>,
) -> Result<Option<ProcessSystemCommitGuardEvidence>, ProcessOwnerError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let object = value.as_object().ok_or(ProcessOwnerError::Protocol(
        "system commit guard receipt was not an object",
    ))?;
    const FIELDS: &[&str] = &[
        "architectureReserveFloorBytes",
        "launchDerivedReserveBytes",
        "trustedReserveBytes",
        "launchEffectiveReserveBytes",
        "guardBandBytes",
        "expectedCommitBytes",
        "configuredHardLimitBytes",
        "effectiveHardLimitBytes",
        "launchSystemCommitBytes",
        "launchSystemCommitLimitBytes",
        "launchFreeCommitBytes",
        "preResumeSystemCommitBytes",
        "preResumeSystemCommitLimitBytes",
        "preResumeFreeCommitBytes",
        "preResumeEffectiveHardLimitBytes",
        "minimumObservedFreeCommitBytes",
        "maximumObservedDerivedReserveBytes",
        "maximumObservedEffectiveReserveBytes",
        "terminationReason",
    ];
    if object.len() != FIELDS.len() || FIELDS.iter().any(|field| !object.contains_key(*field)) {
        return Err(ProcessOwnerError::Protocol(
            "system commit guard receipt had an invalid shape",
        ));
    }
    let number = |field: &'static str| {
        object
            .get(field)
            .and_then(Value::as_u64)
            .ok_or(ProcessOwnerError::Protocol(
                "system commit guard receipt contained an invalid number",
            ))
    };
    let optional_number = |field: &'static str| match object.get(field) {
        Some(Value::Null) => Ok(None),
        Some(value) => value.as_u64().map(Some).ok_or(ProcessOwnerError::Protocol(
            "system commit guard receipt contained an invalid optional number",
        )),
        None => Err(ProcessOwnerError::Protocol(
            "system commit guard receipt omitted an optional number",
        )),
    };
    let termination_reason = match object.get("terminationReason") {
        Some(Value::Null) => None,
        Some(Value::String(reason)) => Some(match reason.as_str() {
            "expected-commit-does-not-fit" => {
                ProcessSystemCommitGuardTerminationReason::ExpectedCommitDoesNotFit
            }
            "effective-job-limit" => ProcessSystemCommitGuardTerminationReason::EffectiveJobLimit,
            "system-commit-reserve" => {
                ProcessSystemCommitGuardTerminationReason::SystemCommitReserve
            }
            "system-commit-observation-unavailable" => {
                ProcessSystemCommitGuardTerminationReason::SystemCommitObservationUnavailable
            }
            _ => {
                return Err(ProcessOwnerError::Protocol(
                    "system commit guard receipt contained an invalid termination reason",
                ))
            }
        }),
        _ => {
            return Err(ProcessOwnerError::Protocol(
                "system commit guard receipt omitted its termination reason",
            ))
        }
    };
    let evidence = ProcessSystemCommitGuardEvidence {
        architecture_reserve_floor_bytes: number("architectureReserveFloorBytes")?,
        launch_derived_reserve_bytes: number("launchDerivedReserveBytes")?,
        trusted_reserve_bytes: number("trustedReserveBytes")?,
        launch_effective_reserve_bytes: number("launchEffectiveReserveBytes")?,
        guard_band_bytes: number("guardBandBytes")?,
        expected_commit_bytes: number("expectedCommitBytes")?,
        configured_hard_limit_bytes: number("configuredHardLimitBytes")?,
        effective_hard_limit_bytes: number("effectiveHardLimitBytes")?,
        launch_system_commit_bytes: number("launchSystemCommitBytes")?,
        launch_system_commit_limit_bytes: number("launchSystemCommitLimitBytes")?,
        launch_free_commit_bytes: number("launchFreeCommitBytes")?,
        pre_resume_system_commit_bytes: optional_number("preResumeSystemCommitBytes")?,
        pre_resume_system_commit_limit_bytes: optional_number("preResumeSystemCommitLimitBytes")?,
        pre_resume_free_commit_bytes: optional_number("preResumeFreeCommitBytes")?,
        pre_resume_effective_hard_limit_bytes: optional_number("preResumeEffectiveHardLimitBytes")?,
        minimum_observed_free_commit_bytes: number("minimumObservedFreeCommitBytes")?,
        maximum_observed_derived_reserve_bytes: number("maximumObservedDerivedReserveBytes")?,
        maximum_observed_effective_reserve_bytes: number("maximumObservedEffectiveReserveBytes")?,
        termination_reason,
    };
    let expected_derived = (evidence.launch_system_commit_limit_bytes / 10).clamp(
        SYSTEM_COMMIT_DERIVED_RESERVE_MIN_BYTES,
        SYSTEM_COMMIT_DERIVED_RESERVE_MAX_BYTES,
    );
    let expected_launch_reserve = SYSTEM_COMMIT_RESERVE_FLOOR_BYTES
        .max(expected_derived)
        .max(evidence.trusted_reserve_bytes);
    let expected_launch_free = evidence
        .launch_system_commit_limit_bytes
        .saturating_sub(evidence.launch_system_commit_bytes);
    let launch_effective_hard =
        evidence
            .configured_hard_limit_bytes
            .min(expected_launch_free.saturating_sub(
                expected_launch_reserve.saturating_add(SYSTEM_COMMIT_RESERVE_GUARD_BAND_BYTES),
            ));
    let pre_resume = match (
        evidence.pre_resume_system_commit_bytes,
        evidence.pre_resume_system_commit_limit_bytes,
        evidence.pre_resume_free_commit_bytes,
        evidence.pre_resume_effective_hard_limit_bytes,
    ) {
        (None, None, None, None) => None,
        (Some(commit), Some(limit), Some(free), applied_limit) => {
            let derived = (limit / 10).clamp(
                SYSTEM_COMMIT_DERIVED_RESERVE_MIN_BYTES,
                SYSTEM_COMMIT_DERIVED_RESERVE_MAX_BYTES,
            );
            let maximum_derived = expected_derived.max(derived);
            let effective_reserve = SYSTEM_COMMIT_RESERVE_FLOOR_BYTES
                .max(evidence.trusted_reserve_bytes)
                .max(maximum_derived);
            let candidate_limit = launch_effective_hard.min(free.saturating_sub(
                effective_reserve.saturating_add(SYSTEM_COMMIT_RESERVE_GUARD_BAND_BYTES),
            ));
            if free != limit.saturating_sub(commit)
                || applied_limit.is_some_and(|applied| {
                    free <= effective_reserve.saturating_add(SYSTEM_COMMIT_RESERVE_GUARD_BAND_BYTES)
                        || candidate_limit <= evidence.expected_commit_bytes
                        || applied != candidate_limit
                })
            {
                return Err(ProcessOwnerError::Protocol(
                    "system commit guard receipt had inconsistent pre-resume evidence",
                ));
            }
            Some((free, maximum_derived, candidate_limit, applied_limit))
        }
        _ => {
            return Err(ProcessOwnerError::Protocol(
                "system commit guard receipt had an incomplete pre-resume sample",
            ))
        }
    };
    let initial_effective_hard = pre_resume
        .and_then(|(_, _, _, applied_limit)| applied_limit)
        .unwrap_or(launch_effective_hard);
    let minimum_sampled_free = pre_resume.map_or(expected_launch_free, |(free, _, _, _)| {
        expected_launch_free.min(free)
    });
    let minimum_sampled_derived = pre_resume.map_or(expected_derived, |(_, derived, _, _)| derived);
    let expected_maximum_reserve = SYSTEM_COMMIT_RESERVE_FLOOR_BYTES
        .max(evidence.trusted_reserve_bytes)
        .max(evidence.maximum_observed_derived_reserve_bytes);
    let expected_denial_was_possible = launch_effective_hard <= evidence.expected_commit_bytes
        || pre_resume.is_some_and(|(_, _, candidate_limit, _)| {
            candidate_limit <= evidence.expected_commit_bytes
        });
    let reserve_threshold = evidence
        .maximum_observed_effective_reserve_bytes
        .saturating_add(evidence.guard_band_bytes);
    if evidence.architecture_reserve_floor_bytes != SYSTEM_COMMIT_RESERVE_FLOOR_BYTES
        || evidence.guard_band_bytes != SYSTEM_COMMIT_RESERVE_GUARD_BAND_BYTES
        || evidence.launch_derived_reserve_bytes != expected_derived
        || evidence.launch_effective_reserve_bytes != expected_launch_reserve
        || evidence.launch_free_commit_bytes != expected_launch_free
        // Before resume, the cap can only be the exact launch/pre-resume
        // result. Once resume succeeds, every guarded development supervisor
        // may tighten the live Job Object as external Windows commit is
        // consumed. One pinned supervisor at a time may hold the shared
        // dynamic-burst lease and expand above the manifest ceiling, within
        // the closed multiplier/absolute bound below. Zero is never a valid
        // guarded live limit.
        || if evidence.pre_resume_effective_hard_limit_bytes.is_some() {
            evidence.effective_hard_limit_bytes == 0
                || evidence.effective_hard_limit_bytes
                    > dynamic_commit_burst_ceiling(evidence.configured_hard_limit_bytes)
        } else {
            evidence.effective_hard_limit_bytes != initial_effective_hard
        }
        || evidence.minimum_observed_free_commit_bytes > minimum_sampled_free
        || evidence.maximum_observed_derived_reserve_bytes < minimum_sampled_derived
        || evidence.maximum_observed_derived_reserve_bytes > SYSTEM_COMMIT_DERIVED_RESERVE_MAX_BYTES
        || evidence.maximum_observed_effective_reserve_bytes != expected_maximum_reserve
        || evidence.expected_commit_bytes == 0
        || evidence.configured_hard_limit_bytes <= evidence.expected_commit_bytes
        || matches!(
            evidence.termination_reason,
            Some(ProcessSystemCommitGuardTerminationReason::ExpectedCommitDoesNotFit)
        ) && !expected_denial_was_possible
        || matches!(
            evidence.termination_reason,
            Some(ProcessSystemCommitGuardTerminationReason::SystemCommitReserve)
        ) && evidence.minimum_observed_free_commit_bytes > reserve_threshold
    {
        return Err(ProcessOwnerError::Protocol(
            "system commit guard receipt was internally inconsistent",
        ));
    }
    Ok(Some(evidence))
}

impl ProcessOwnerTerminal {
    fn parse(value: &Value, expected_root_pid: Option<u32>) -> Result<Self, ProcessOwnerError> {
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or(ProcessOwnerError::Protocol(
                "terminal receipt contained no event type",
            ))?;
        let mut post_create_resource_denial = false;
        let (code, failure) = match kind {
            "exit" => (
                Some(
                    value
                        .get("code")
                        .and_then(Value::as_u64)
                        .and_then(|value| u32::try_from(value).ok())
                        .ok_or(ProcessOwnerError::Protocol(
                            "terminal receipt contained an invalid exit code",
                        ))?,
                ),
                None,
            ),
            "error" => {
                let code = value
                    .get("supervisorExitCode")
                    .and_then(Value::as_u64)
                    .and_then(|value| u32::try_from(value).ok())
                    .ok_or(ProcessOwnerError::Protocol(
                        "failure receipt contained an invalid supervisor exit code",
                    ))?;
                let failure_code = value
                    .get("code")
                    .and_then(Value::as_str)
                    .filter(|code| !code.is_empty() && code.len() <= 256)
                    .ok_or(ProcessOwnerError::Protocol(
                        "failure receipt contained an invalid failure code",
                    ))?;
                let message = value
                    .get("message")
                    .and_then(Value::as_str)
                    .filter(|message| !message.is_empty())
                    .ok_or(ProcessOwnerError::Protocol(
                        "failure receipt contained an invalid failure message",
                    ))?;
                if failure_code == "BREADBOARD_RESOURCE_EXHAUSTED" {
                    post_create_resource_denial = true;
                    (Some(code), None)
                } else {
                    (
                        Some(code),
                        Some(safe_supervisor_failure(failure_code, message)),
                    )
                }
            }
            _ => {
                return Err(ProcessOwnerError::Protocol(
                    "terminal receipt had an invalid event type",
                ))
            }
        };
        let root_pid = Some(bounded_pid(value.get("rootPid"))?);
        if expected_root_pid.is_some_and(|expected| Some(expected) != root_pid)
            || (expected_root_pid.is_none() && kind != "error")
        {
            return Err(ProcessOwnerError::Protocol(
                "terminal receipt did not match the started process",
            ));
        }
        let target_exit_code = match value.get("targetExitCode") {
            Some(Value::Null) | None => None,
            Some(value) => Some(
                value
                    .as_u64()
                    .and_then(|value| u32::try_from(value).ok())
                    .ok_or(ProcessOwnerError::Protocol(
                        "terminal receipt contained an invalid target exit code",
                    ))?,
            ),
        };
        let resource_exhausted = value
            .get("resourceExhausted")
            .and_then(Value::as_bool)
            .ok_or(ProcessOwnerError::Protocol(
                "terminal receipt omitted resource classification",
            ))?;
        if post_create_resource_denial
            && (!resource_exhausted
                || code != Some(RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE)
                || expected_root_pid.is_some())
        {
            return Err(ProcessOwnerError::Protocol(
                "post-create resource denial receipt was invalid",
            ));
        }
        let stop_outcome = match value.get("stopOutcome") {
            None | Some(Value::Null) => None,
            Some(Value::String(outcome)) => Some(match outcome.as_str() {
                "graceful" => ProcessStopOutcome::Graceful,
                "forced" => ProcessStopOutcome::Forced,
                "forced-after-grace" => ProcessStopOutcome::ForcedAfterGrace,
                "parent-disconnect" => ProcessStopOutcome::ParentDisconnect,
                _ => {
                    return Err(ProcessOwnerError::Protocol(
                        "terminal receipt contained an invalid stop outcome",
                    ))
                }
            }),
            Some(_) => {
                return Err(ProcessOwnerError::Protocol(
                    "terminal receipt contained an invalid stop outcome",
                ))
            }
        };
        let zero_resident_confirmed = value
            .get("treeExitConfirmed")
            .and_then(Value::as_bool)
            .ok_or(ProcessOwnerError::Protocol(
                "terminal receipt omitted zero-resident confirmation",
            ))?;
        let peak_job_commit_bytes = value.get("peakJobCommitBytes").and_then(Value::as_u64);
        let peak_accounting_complete = value
            .get("peakJobCommitAccountingComplete")
            .and_then(Value::as_bool)
            .ok_or(ProcessOwnerError::Protocol(
                "terminal receipt omitted accounting completeness",
            ))?;
        let system_commit_guard =
            parse_system_commit_guard_evidence(value.get("systemCommitGuard"))?;
        if post_create_resource_denial
            && (target_exit_code != Some(RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE)
                || system_commit_guard
                    .and_then(|guard| guard.termination_reason)
                    .is_none())
        {
            return Err(ProcessOwnerError::Protocol(
                "post-create resource denial omitted exact guard evidence",
            ));
        }
        let supervisor_error_count = match value.get("supervisorErrors") {
            None => 0,
            Some(Value::Array(errors)) => errors.len(),
            Some(_) => {
                return Err(ProcessOwnerError::Protocol(
                    "terminal receipt contained invalid supervisor errors",
                ))
            }
        };
        let cleanup_error_count = match value.get("cleanupErrors") {
            None if failure.is_none() => 0,
            None => {
                return Err(ProcessOwnerError::Protocol(
                    "failure receipt omitted cleanup error accounting",
                ))
            }
            Some(Value::Array(errors)) => errors.len(),
            Some(_) => {
                return Err(ProcessOwnerError::Protocol(
                    "failure receipt contained invalid cleanup errors",
                ))
            }
        };
        Ok(Self {
            code,
            root_pid,
            target_exit_code,
            resource_exhausted,
            failure,
            stop_outcome,
            zero_resident_confirmed,
            peak_job_commit_bytes,
            peak_accounting_complete,
            system_commit_guard,
            supervisor_error_count,
            cleanup_error_count,
        })
    }

    /// Parses the supervisor's exact three-field error record emitted only
    /// before a target process exists. The pinned helper has one post-create
    /// cleanup epilogue and every error after CreateProcessW succeeds carries
    /// `rootPid` plus complete accounting, so accepting any additional or
    /// missing field here would make a truncated post-create record ambiguous.
    fn parse_pre_start_failure(value: &Value) -> Result<Self, ProcessOwnerError> {
        let object = value.as_object().ok_or(ProcessOwnerError::Protocol(
            "pre-start failure receipt was not an object",
        ))?;
        let legacy_shape = object.len() == 3
            && object.contains_key("type")
            && object.contains_key("code")
            && object.contains_key("message");
        let resource_shape = object.len() == 7
            && [
                "type",
                "code",
                "message",
                "supervisorExitCode",
                "resourceExhausted",
                "treeExitConfirmed",
                "systemCommitGuard",
            ]
            .iter()
            .all(|field| object.contains_key(*field));
        if !legacy_shape && !resource_shape {
            return Err(ProcessOwnerError::Protocol(
                "pre-start failure receipt had an invalid shape",
            ));
        }
        if object.get("type").and_then(Value::as_str) != Some("error") {
            return Err(ProcessOwnerError::Protocol(
                "pre-start failure receipt had an invalid event type",
            ));
        }
        if resource_shape {
            if object.get("code").and_then(Value::as_str) != Some("BREADBOARD_RESOURCE_EXHAUSTED")
                || object
                    .get("message")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
                || object.get("supervisorExitCode").and_then(Value::as_u64)
                    != Some(RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE as u64)
                || object.get("resourceExhausted").and_then(Value::as_bool) != Some(true)
                || object.get("treeExitConfirmed").and_then(Value::as_bool) != Some(true)
            {
                return Err(ProcessOwnerError::Protocol(
                    "pre-start resource exhaustion receipt was invalid",
                ));
            }
            let system_commit_guard =
                parse_system_commit_guard_evidence(object.get("systemCommitGuard"))?;
            if system_commit_guard.is_none() {
                return Err(ProcessOwnerError::Protocol(
                    "pre-start resource exhaustion omitted system commit evidence",
                ));
            }
            return Ok(Self {
                code: Some(RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE),
                root_pid: None,
                target_exit_code: None,
                resource_exhausted: true,
                failure: None,
                stop_outcome: None,
                zero_resident_confirmed: true,
                peak_job_commit_bytes: None,
                peak_accounting_complete: false,
                system_commit_guard,
                supervisor_error_count: 0,
                cleanup_error_count: 0,
            });
        }
        let failure_code = object
            .get("code")
            .and_then(Value::as_str)
            .filter(|code| !code.is_empty() && code.len() <= 256)
            .ok_or(ProcessOwnerError::Protocol(
                "pre-start failure receipt contained an invalid failure code",
            ))?;
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .filter(|message| !message.is_empty())
            .ok_or(ProcessOwnerError::Protocol(
                "pre-start failure receipt contained an invalid failure message",
            ))?;
        Ok(Self {
            code: None,
            root_pid: None,
            target_exit_code: None,
            resource_exhausted: false,
            failure: Some(safe_supervisor_failure(failure_code, message)),
            stop_outcome: None,
            // The minimal schema itself is emitted only on the helper's
            // pre-CreateProcess return path. The parent still must observe the
            // exact helper exit and protocol EOF in `confirm_exit` before this
            // becomes a ProcessTreeExit.
            zero_resident_confirmed: true,
            peak_job_commit_bytes: None,
            peak_accounting_complete: false,
            system_commit_guard: None,
            supervisor_error_count: 0,
            cleanup_error_count: 0,
        })
    }

    /// Validates only the evidence needed to release a durable worker
    /// reservation: the helper must have proven that its process tree has no
    /// residents and its terminal classification must be internally coherent.
    /// Final accounting and ancillary cleanup health are intentionally carried
    /// forward to the stricter completion-authority gate below; neither can
    /// invalidate an exact zero-resident proof and strand a reservation.
    fn validate_system_commit_guard_for_limits(
        &self,
        limits: ProcessOwnerLimits,
        _legacy_live_system_commit_reserve_victim: bool,
    ) -> Result<(), ProcessOwnerError> {
        match (limits.system_commit_guard, self.system_commit_guard) {
            (None, None) => Ok(()),
            (None, Some(_)) => Err(ProcessOwnerError::Protocol(
                "unguarded launch emitted system commit authority",
            )),
            (Some(_), None) if self.root_pid.is_none() && !self.resource_exhausted => Ok(()),
            (Some(_), None) => Err(ProcessOwnerError::Protocol(
                "guarded launch omitted system commit authority",
            )),
            (Some(config), Some(evidence)) => {
                let reserve_threshold = evidence
                    .maximum_observed_effective_reserve_bytes
                    .saturating_add(evidence.guard_band_bytes);
                let crossed_live_reserve = evidence.pre_resume_effective_hard_limit_bytes.is_some()
                    && evidence.minimum_observed_free_commit_bytes <= reserve_threshold;
                let claimed_live_reserve_termination =
                    matches!(
                        evidence.termination_reason,
                        Some(ProcessSystemCommitGuardTerminationReason::SystemCommitReserve)
                    ) && evidence.pre_resume_effective_hard_limit_bytes.is_some();
                let had_dynamic_burst =
                    evidence.effective_hard_limit_bytes > evidence.configured_hard_limit_bytes;
                // Pre-resume reserve denial remains valid for every guarded
                // development launch. After resume, only a tree whose closed
                // evidence proves it had borrowed beyond the manifest cap may
                // claim the shared-reserve victim classification. Other trees
                // are tightened in place rather than joining a kill-all wave.
                if evidence.expected_commit_bytes != config.expected_commit_bytes()
                    || evidence.trusted_reserve_bytes != config.trusted_reserve_bytes()
                    || evidence.configured_hard_limit_bytes != limits.hard_commit_bytes
                    || evidence.termination_reason.is_some() != self.resource_exhausted
                    || claimed_live_reserve_termination
                        && (!crossed_live_reserve || !had_dynamic_burst)
                {
                    return Err(ProcessOwnerError::Protocol(
                        "system commit guard receipt did not match its trusted launch",
                    ));
                }
                Ok(())
            }
        }
    }

    fn validate_zero_resident_release(&self) -> Result<(), ProcessOwnerError> {
        if !self.zero_resident_confirmed {
            return Err(ProcessOwnerError::Protocol(
                "zero resident processes were not proven",
            ));
        }
        if self.failure.is_some()
            && (self.resource_exhausted || self.code.is_some_and(|code| code != 1))
        {
            return Err(ProcessOwnerError::Protocol(
                "supervisor failure receipt had an invalid classification",
            ));
        }
        if self.failure.is_none() && !self.resource_exhausted && self.target_exit_code != self.code
        {
            return Err(ProcessOwnerError::Protocol(
                "supervisor exit code did not match the ordinary target exit",
            ));
        }
        if self.resource_exhausted && self.code != Some(RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE) {
            return Err(ProcessOwnerError::Protocol(
                "resource exhaustion had the wrong terminal exit code",
            ));
        }
        Ok(())
    }

    pub fn resource_exhausted(&self) -> bool {
        self.resource_exhausted
    }

    pub fn failure(&self) -> Option<&ProcessSupervisorFailure> {
        self.failure.as_ref()
    }

    /// Closed terminal classification before the retained owner mints its
    /// zero-resident tree-exit authority. Service lifecycle recovery uses this
    /// only to distinguish an ordinary target exit from shutdown, resource
    /// enforcement, and supervisor faults; it grants no process authority.
    pub fn classification(&self) -> ProcessExitClassification {
        classify_process_exit(self, None)
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct ProcessSupervisorFailure {
    code: String,
    message: String,
}

impl fmt::Debug for ProcessSupervisorFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProcessSupervisorFailure")
            .field("code", &self.code)
            .field("message", &"<redacted canonical supervisor message>")
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessStopOutcome {
    Graceful,
    Forced,
    ForcedAfterGrace,
    ParentDisconnect,
}

impl ProcessSupervisorFailure {
    pub fn code(&self) -> &str {
        &self.code
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessExitClassification {
    TargetExit,
    Stopped,
    ResourceExhausted,
    SupervisorFailure,
    WorkerProtocolFault,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessTreeAccounting {
    pub peak_private_commit_bytes: Option<u64>,
    pub complete: bool,
}

pub struct ProcessTreeExit {
    generation: Option<ProcessAuthorityGeneration>,
    started_boundary_accepted: bool,
    supervisor_pid: u32,
    root_pid: Option<u32>,
    purpose: ProcessOwnerPurpose,
    root_exit_code: Option<u32>,
    classification: ProcessExitClassification,
    failure: Option<ProcessSupervisorFailure>,
    stop_outcome: Option<ProcessStopOutcome>,
    accounting: ProcessTreeAccounting,
    system_commit_guard: Option<ProcessSystemCommitGuardEvidence>,
    supervisor_error_count: usize,
    cleanup_error_count: usize,
    worker_protocol_fault: Option<WorkerProtocolFault>,
}

impl fmt::Debug for ProcessTreeExit {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ProcessTreeExit")
            .field("authority", &"<opaque zero-resident release receipt>")
            .field("root_exit_code", &self.root_exit_code)
            .field("classification", &self.classification)
            .field("failure", &self.failure)
            .field("stop_outcome", &self.stop_outcome)
            .field("accounting", &self.accounting)
            .field("system_commit_guard", &self.system_commit_guard)
            .field("supervisor_error_count", &self.supervisor_error_count)
            .field("cleanup_error_count", &self.cleanup_error_count)
            .field("worker_protocol_fault", &self.worker_protocol_fault)
            .finish()
    }
}

impl ProcessTreeExit {
    /// Derives completion authority only from an ordinary successful target
    /// exit. Cancellation, hard-limit termination, supervisor failure, an
    /// invalid worker event stream, and a nonzero target exit remain valid
    /// zero-resident release receipts but can never become
    /// `WorkerCompletionProof` authority.
    pub fn into_completion_authority(
        self,
    ) -> Result<AuthoritativeProcessOwner, Box<ProcessTreeExit>> {
        if !self.started_boundary_accepted
            || self.root_pid.is_none()
            || self.classification != ProcessExitClassification::TargetExit
            || self.root_exit_code != Some(0)
            || !self.accounting.complete
            || self.accounting.peak_private_commit_bytes.is_none()
            || self.supervisor_error_count != 0
            || self.cleanup_error_count != 0
        {
            return Err(Box::new(self));
        }
        Ok(AuthoritativeProcessOwner {
            generation: self.generation,
            supervisor_pid: self.supervisor_pid,
            root_pid: self
                .root_pid
                .expect("accepted started boundary requires a root process id"),
            purpose: self.purpose,
            accounting: self.accounting,
            private: (),
        })
    }

    pub fn root_exit_code(&self) -> Option<u32> {
        self.root_exit_code
    }

    pub fn classification(&self) -> ProcessExitClassification {
        self.classification
    }

    pub fn failure(&self) -> Option<&ProcessSupervisorFailure> {
        self.failure.as_ref()
    }

    pub fn stop_outcome(&self) -> Option<ProcessStopOutcome> {
        self.stop_outcome
    }

    pub fn accounting(&self) -> ProcessTreeAccounting {
        self.accounting
    }

    pub fn system_commit_guard(&self) -> Option<ProcessSystemCommitGuardEvidence> {
        self.system_commit_guard
    }

    pub fn worker_protocol_fault(&self) -> Option<WorkerProtocolFault> {
        self.worker_protocol_fault
    }

    pub(crate) fn worker_identity(&self) -> Option<&WorkerIdentity> {
        match &self.purpose {
            ProcessOwnerPurpose::Worker(identity) => Some(identity),
            ProcessOwnerPurpose::Service { .. } => None,
        }
    }

    pub(crate) fn service_identity(&self) -> Option<(&str, u64)> {
        match &self.purpose {
            ProcessOwnerPurpose::Service {
                service_id,
                generation,
            } => Some((service_id, *generation)),
            ProcessOwnerPurpose::Worker(_) => None,
        }
    }

    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.generation
            .as_ref()
            .is_some_and(|generation| generation.matches_scope(scope))
    }

    pub(crate) fn started_boundary_accepted(&self) -> bool {
        self.started_boundary_accepted
    }

    #[cfg(test)]
    pub(crate) fn worker_release_for_test_in_scope(
        scope: RuntimeGenerationScope,
        identity: WorkerIdentity,
        classification: ProcessExitClassification,
    ) -> Self {
        Self {
            generation: Some(ProcessAuthorityGeneration::Test(scope)),
            started_boundary_accepted: false,
            supervisor_pid: 7,
            root_pid: None,
            purpose: ProcessOwnerPurpose::Worker(identity),
            root_exit_code: (classification == ProcessExitClassification::TargetExit).then_some(1),
            classification,
            failure: (classification == ProcessExitClassification::SupervisorFailure).then(|| {
                safe_supervisor_failure(
                    "WAIT_FAILED",
                    "test-only supervisor failure before started",
                )
            }),
            stop_outcome: (classification == ProcessExitClassification::Stopped)
                .then_some(ProcessStopOutcome::Forced),
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(0),
                complete: true,
            },
            system_commit_guard: None,
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: (classification
                == ProcessExitClassification::WorkerProtocolFault)
                .then_some(WorkerProtocolFault::InvalidRecord),
        }
    }

    #[cfg(test)]
    pub(crate) fn worker_release_after_started_for_test_in_scope(
        scope: RuntimeGenerationScope,
        identity: WorkerIdentity,
    ) -> Self {
        let mut receipt = Self::worker_release_for_test_in_scope(
            scope,
            identity,
            ProcessExitClassification::TargetExit,
        );
        receipt.started_boundary_accepted = true;
        receipt.root_pid = Some(42);
        receipt
    }

    #[cfg(test)]
    pub(crate) fn service_release_for_test_in_scope(
        scope: RuntimeGenerationScope,
        service_id: &str,
        generation: u64,
    ) -> Self {
        Self {
            generation: Some(ProcessAuthorityGeneration::Test(scope)),
            started_boundary_accepted: false,
            supervisor_pid: 7,
            root_pid: Some(42),
            purpose: ProcessOwnerPurpose::Service {
                service_id: service_id.into(),
                generation,
            },
            root_exit_code: None,
            classification: ProcessExitClassification::SupervisorFailure,
            failure: Some(safe_supervisor_failure(
                "WAIT_FAILED",
                "test-only service supervisor failure",
            )),
            stop_outcome: None,
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(0),
                complete: true,
            },
            system_commit_guard: None,
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn service_release_after_started_for_test_in_scope(
        scope: RuntimeGenerationScope,
        service_id: &str,
        generation: u64,
    ) -> Self {
        let mut receipt = Self::service_release_for_test_in_scope(scope, service_id, generation);
        receipt.started_boundary_accepted = true;
        receipt
    }

    #[cfg(test)]
    pub(crate) fn service_stopped_after_started_for_test_in_scope(
        scope: RuntimeGenerationScope,
        service_id: &str,
        generation: u64,
    ) -> Self {
        let mut receipt = Self::service_release_for_test_in_scope(scope, service_id, generation);
        receipt.started_boundary_accepted = true;
        receipt.classification = ProcessExitClassification::Stopped;
        receipt.failure = None;
        receipt.stop_outcome = Some(ProcessStopOutcome::Forced);
        receipt.accounting.complete = true;
        receipt
    }
}

/// Opaque worker-completion capability minted only after the existing native
/// supervisor proves zero Job Object residents, complete final accounting, no
/// cleanup failures, its own matching process exit, and an ordinary successful
/// target exit. It is neither serializable nor constructible by downstream
/// crates.
pub struct AuthoritativeProcessOwner {
    generation: Option<ProcessAuthorityGeneration>,
    supervisor_pid: u32,
    root_pid: u32,
    purpose: ProcessOwnerPurpose,
    accounting: ProcessTreeAccounting,
    private: (),
}

impl fmt::Debug for AuthoritativeProcessOwner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let _ = (
            &self.generation,
            self.supervisor_pid,
            self.root_pid,
            &self.purpose,
            self.accounting,
            &self.private,
        );
        formatter.write_str("AuthoritativeProcessOwner(<opaque zero-resident proof>)")
    }
}

impl AuthoritativeProcessOwner {
    pub(crate) fn matches_generation_scope(&self, scope: &RuntimeGenerationScope) -> bool {
        self.generation
            .as_ref()
            .is_some_and(|generation| generation.matches_scope(scope))
    }

    pub(crate) fn worker_identity(&self) -> Option<&WorkerIdentity> {
        match &self.purpose {
            ProcessOwnerPurpose::Worker(identity) => Some(identity),
            ProcessOwnerPurpose::Service { .. } => None,
        }
    }

    pub(crate) fn supervisor_pid(&self) -> u32 {
        self.supervisor_pid
    }

    pub(crate) fn root_pid(&self) -> u32 {
        self.root_pid
    }

    pub(crate) fn accounting(&self) -> ProcessTreeAccounting {
        self.accounting
    }

    /// Consumes unused success authority and restores the weaker zero-resident
    /// receipt used by idempotent durable transactions. This is required when
    /// durable result validation fails after a clean target exit: the job must
    /// not succeed, but its
    /// reservation must still be released by exact process-tree evidence.
    pub fn into_zero_resident_release(self) -> ProcessTreeExit {
        ProcessTreeExit {
            generation: self.generation,
            started_boundary_accepted: true,
            supervisor_pid: self.supervisor_pid,
            root_pid: Some(self.root_pid),
            purpose: self.purpose,
            root_exit_code: Some(0),
            classification: ProcessExitClassification::TargetExit,
            failure: None,
            stop_outcome: None,
            accounting: self.accounting,
            system_commit_guard: None,
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: None,
        }
    }

    #[cfg(test)]
    pub(crate) fn worker_for_test(scope: RuntimeGenerationScope, identity: WorkerIdentity) -> Self {
        Self {
            generation: Some(ProcessAuthorityGeneration::Test(scope)),
            supervisor_pid: 7,
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Worker(identity),
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1),
                complete: true,
            },
            private: (),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn terminal(overrides: Value) -> Value {
        let mut value = serde_json::json!({
            "type": "exit",
            "code": 0,
            "rootPid": 42,
            "targetExitCode": 0,
            "resourceExhausted": false,
            "stopOutcome": null,
            "treeExitConfirmed": true,
            "peakJobCommitBytes": 1024,
            "peakJobCommitAccountingComplete": true,
            "supervisorErrors": []
        });
        if let (Some(target), Some(overrides)) = (value.as_object_mut(), overrides.as_object()) {
            target.extend(overrides.clone());
        }
        value
    }

    fn failure_terminal(overrides: Value) -> Value {
        let mut value = serde_json::json!({
            "type": "error",
            "code": "WAIT_FAILED",
            "message": "authoritative supervision failed after spawn",
            "supervisorExitCode": 1,
            "rootPid": 42,
            "targetExitCode": null,
            "resourceExhausted": false,
            "stopOutcome": null,
            "treeExitConfirmed": true,
            "peakJobCommitBytes": 1024,
            "peakJobCommitAccountingComplete": true,
            "cleanupErrors": []
        });
        if let (Some(target), Some(overrides)) = (value.as_object_mut(), overrides.as_object()) {
            target.extend(overrides.clone());
        }
        value
    }

    fn pre_start_failure(overrides: Value) -> Value {
        let mut value = serde_json::json!({
            "type": "error",
            "code": "SPAWN_FAILED",
            "message": "CreateProcessW failed"
        });
        if let (Some(target), Some(overrides)) = (value.as_object_mut(), overrides.as_object()) {
            target.extend(overrides.clone());
        }
        value
    }

    fn system_commit_guard_evidence(
        launch_free_mb: u64,
        minimum_free_mb: u64,
        termination_reason: Option<&str>,
    ) -> Value {
        let pre_resume_free_mb =
            (termination_reason != Some("expected-commit-does-not-fit")).then_some(launch_free_mb);
        system_commit_guard_evidence_with_pre_resume(
            launch_free_mb,
            pre_resume_free_mb,
            minimum_free_mb,
            termination_reason,
        )
    }

    fn system_commit_guard_evidence_with_pre_resume(
        launch_free_mb: u64,
        pre_resume_free_mb: Option<u64>,
        minimum_free_mb: u64,
        termination_reason: Option<&str>,
    ) -> Value {
        let commit_limit_mb = 40_000;
        let derived_reserve_mb = 4_000;
        let effective_reserve_mb = 4_096;
        let launch_effective_hard_mb =
            8_192u64.min(launch_free_mb.saturating_sub(effective_reserve_mb + 256));
        let pre_resume_candidate_mb = pre_resume_free_mb.map(|free| {
            launch_effective_hard_mb.min(free.saturating_sub(effective_reserve_mb + 256))
        });
        let pre_resume_effective_hard_mb = pre_resume_candidate_mb.filter(|candidate| {
            pre_resume_free_mb.is_some_and(|free| free > effective_reserve_mb + 256)
                && *candidate > 3_072
        });
        let effective_hard_mb = pre_resume_effective_hard_mb.unwrap_or(launch_effective_hard_mb);
        serde_json::json!({
            "architectureReserveFloorBytes": 4_096 * MEBIBYTE_BYTES,
            "launchDerivedReserveBytes": derived_reserve_mb * MEBIBYTE_BYTES,
            "trustedReserveBytes": 4_096 * MEBIBYTE_BYTES,
            "launchEffectiveReserveBytes": effective_reserve_mb * MEBIBYTE_BYTES,
            "guardBandBytes": 256 * MEBIBYTE_BYTES,
            "expectedCommitBytes": 3_072 * MEBIBYTE_BYTES,
            "configuredHardLimitBytes": 8_192 * MEBIBYTE_BYTES,
            "effectiveHardLimitBytes": effective_hard_mb * MEBIBYTE_BYTES,
            "launchSystemCommitBytes": (commit_limit_mb - launch_free_mb) * MEBIBYTE_BYTES,
            "launchSystemCommitLimitBytes": commit_limit_mb * MEBIBYTE_BYTES,
            "launchFreeCommitBytes": launch_free_mb * MEBIBYTE_BYTES,
            "preResumeSystemCommitBytes": pre_resume_free_mb
                .map(|free| (commit_limit_mb - free) * MEBIBYTE_BYTES),
            "preResumeSystemCommitLimitBytes": pre_resume_free_mb
                .map(|_| commit_limit_mb * MEBIBYTE_BYTES),
            "preResumeFreeCommitBytes": pre_resume_free_mb.map(|free| free * MEBIBYTE_BYTES),
            "preResumeEffectiveHardLimitBytes": pre_resume_effective_hard_mb
                .map(|limit| limit * MEBIBYTE_BYTES),
            "minimumObservedFreeCommitBytes": minimum_free_mb * MEBIBYTE_BYTES,
            "maximumObservedDerivedReserveBytes": derived_reserve_mb * MEBIBYTE_BYTES,
            "maximumObservedEffectiveReserveBytes": effective_reserve_mb * MEBIBYTE_BYTES,
            "terminationReason": termination_reason,
        })
    }

    fn hot_dashboard_limits() -> ProcessOwnerLimits {
        ProcessOwnerLimits {
            soft_commit_bytes: 6_144 * MEBIBYTE_BYTES,
            hard_commit_bytes: 8_192 * MEBIBYTE_BYTES,
            graceful_shutdown: Duration::from_secs(15),
            supervisor_exit_timeout: Duration::from_secs(10),
            system_commit_guard: Some(
                ProcessOwnerSystemCommitGuard::development(
                    3_072 * MEBIBYTE_BYTES,
                    4_096 * MEBIBYTE_BYTES,
                )
                .unwrap(),
            ),
        }
    }

    fn exit_receipt(
        classification: ProcessExitClassification,
        root_exit_code: Option<u32>,
    ) -> ProcessTreeExit {
        ProcessTreeExit {
            generation: None,
            started_boundary_accepted: true,
            supervisor_pid: 7,
            root_pid: Some(42),
            purpose: ProcessOwnerPurpose::Worker(WorkerIdentity {
                job_id: "job_1".into(),
                attempt: 1,
                worker_instance_id: "worker_1".into(),
            }),
            root_exit_code,
            classification,
            failure: (classification == ProcessExitClassification::SupervisorFailure)
                .then(|| safe_supervisor_failure("WAIT_FAILED", "supervision failed")),
            stop_outcome: (classification == ProcessExitClassification::Stopped)
                .then_some(ProcessStopOutcome::Forced),
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1024),
                complete: true,
            },
            system_commit_guard: None,
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: (classification
                == ProcessExitClassification::WorkerProtocolFault)
                .then_some(WorkerProtocolFault::InvalidRecord),
        }
    }

    #[test]
    fn worker_and_service_supervisor_environment_profiles_are_closed() {
        let worker =
            TrustedProcessEnvironment::worker(TrustedWorkerEnvironment::minimal_for_test());
        assert_eq!(worker.supervisor_profile_argument(), "worker");

        assert_eq!(
            supervisor_service_environment_profile_argument(
                TrustedServiceEnvironmentProfile::Chatmock
            ),
            "chatmock"
        );
        assert_eq!(
            supervisor_service_environment_profile_argument(
                TrustedServiceEnvironmentProfile::Comfyui
            ),
            "comfyui"
        );
        assert_eq!(
            supervisor_service_environment_profile_argument(
                TrustedServiceEnvironmentProfile::Dashboard
            ),
            "dashboard"
        );
        assert_eq!(
            supervisor_service_environment_profile_argument(
                TrustedServiceEnvironmentProfile::Gbrain
            ),
            "gbrain"
        );
        assert_eq!(
            supervisor_service_environment_profile_argument(
                TrustedServiceEnvironmentProfile::TelegramGateway
            ),
            "telegram-gateway"
        );
        assert_eq!(
            supervisor_service_environment_profile_argument(
                TrustedServiceEnvironmentProfile::WhatsappGateway
            ),
            "whatsapp-gateway"
        );
        assert_eq!(
            supervisor_service_environment_profile_argument(
                TrustedServiceEnvironmentProfile::Hermes
            ),
            "hermes"
        );
        assert!(!format!("{worker:?}").contains('='));
    }

    #[cfg(windows)]
    #[test]
    fn worker_entrypoint_argv_uses_normal_path_without_replacing_its_pin() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let app = directory.path().join("app");
        let runtime = directory.path().join("runtime-root");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::create_dir_all(app.join("workers")).unwrap();
        std::fs::create_dir_all(&runtime).unwrap();
        let entrypoint = app.join("workers/entrypoint.mjs");
        std::fs::write(&entrypoint, b"trusted worker entrypoint").unwrap();
        let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
        let resolved = paths.resolve_app("workers/entrypoint.mjs").unwrap();
        let pin = paths.pin_app_file_for_launch(&resolved).unwrap();
        let canonical = pin.absolute().to_path_buf();

        let argument = worker_entrypoint_argument(Some(&pin)).unwrap().unwrap();
        assert!(!argument.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(std::fs::canonicalize(&argument).unwrap(), canonical);
        pin.revalidate().unwrap();
        assert_eq!(pin.absolute(), canonical);
    }

    #[test]
    fn supervisor_activation_record_is_one_exact_bounded_ndjson_record() {
        assert!(
            SUPERVISOR_ACTIVATION_RECORD.len()
                <= usize::try_from(MAX_PROCESS_OWNER_PROTOCOL_LINE_BYTES).unwrap()
        );
        assert!(SUPERVISOR_ACTIVATION_RECORD.ends_with(b"\n"));
        assert_eq!(
            SUPERVISOR_ACTIVATION_RECORD
                .iter()
                .filter(|byte| **byte == b'\n')
                .count(),
            1
        );
        let value: Value = serde_json::from_slice(
            &SUPERVISOR_ACTIVATION_RECORD[..SUPERVISOR_ACTIVATION_RECORD.len() - 1],
        )
        .unwrap();
        let object = value.as_object().unwrap();
        assert_eq!(object.len(), 2);
        assert_eq!(object.get("type"), Some(&Value::String("activate".into())));
        assert_eq!(object.get("protocolVersion"), Some(&Value::from(1)));
    }

    #[test]
    fn ownership_purpose_requires_an_exact_valid_worker_or_service_fence() {
        let worker = ProcessOwnerPurpose::Worker(WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        });
        assert!(worker.validate().is_ok());
        assert!(ProcessOwnerPurpose::Service {
            service_id: "hermes".into(),
            generation: 1,
        }
        .validate()
        .is_ok());
        assert!(ProcessOwnerPurpose::Service {
            service_id: "../hermes".into(),
            generation: 1,
        }
        .validate()
        .is_err());
        assert!(ProcessOwnerPurpose::Service {
            service_id: "hermes".into(),
            generation: 0,
        }
        .validate()
        .is_err());
    }

    #[test]
    fn fake_started_json_cannot_mint_and_residency_authority_is_single_use() {
        let fake_started = serde_json::json!({ "type": "started", "pid": 42 });
        assert_eq!(bounded_pid(fake_started.get("pid")).unwrap(), 42);

        let mut pending = None;
        let mut already_taken = false;
        assert!(matches!(
            take_residency_authority(&mut pending, &mut already_taken),
            Err(ProcessOwnerError::InvalidState(
                "process-tree residency authority is unavailable before started"
            ))
        ));

        let scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        pending = Some(ProcessTreeResidency::worker_for_test(
            scope.clone(),
            identity.clone(),
        ));
        let residency = take_residency_authority(&mut pending, &mut already_taken).unwrap();
        assert!(residency.matches_generation_scope(&scope));
        assert_eq!(residency.worker_identity(), Some(&identity));
        assert_eq!(
            format!("{residency:?}"),
            "ProcessTreeResidency(<opaque started-tree authority>)"
        );
        assert!(matches!(
            take_residency_authority(&mut pending, &mut already_taken),
            Err(ProcessOwnerError::InvalidState(
                "process-tree residency authority was already taken"
            ))
        ));
    }

    #[test]
    fn terminal_receipt_requires_exact_started_root_and_zero_residents() {
        let valid =
            ProcessOwnerTerminal::parse(&terminal(serde_json::json!({})), Some(42)).unwrap();
        assert!(valid.validate_zero_resident_release().is_ok());
        assert!(ProcessOwnerTerminal::parse(&terminal(serde_json::json!({})), Some(43)).is_err());

        let unconfirmed = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "treeExitConfirmed": false })),
            Some(42),
        )
        .unwrap();
        assert!(unconfirmed.validate_zero_resident_release().is_err());
    }

    #[test]
    fn terminal_binding_covers_the_complete_opaque_receipt() {
        let observed =
            ProcessOwnerTerminal::parse(&terminal(serde_json::json!({})), Some(42)).unwrap();
        assert_eq!(observed, observed.clone());
        let different_accounting = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "peakJobCommitBytes": 2048 })),
            Some(42),
        )
        .unwrap();
        assert_ne!(observed, different_accounting);
    }

    #[test]
    fn ancillary_failures_preserve_release_authority_but_block_completion() {
        let incomplete = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "peakJobCommitBytes": null,
                "peakJobCommitAccountingComplete": false
            })),
            Some(42),
        )
        .unwrap();
        assert!(incomplete.validate_zero_resident_release().is_ok());
        let mut incomplete_receipt = exit_receipt(ProcessExitClassification::TargetExit, Some(0));
        incomplete_receipt.accounting = ProcessTreeAccounting {
            peak_private_commit_bytes: None,
            complete: false,
        };
        assert!(incomplete_receipt.into_completion_authority().is_err());

        let cleanup_failure = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "supervisorErrors": [{"code":"JOB_CLEANUP_FAILED"}]
            })),
            Some(42),
        )
        .unwrap();
        assert!(cleanup_failure.validate_zero_resident_release().is_ok());
        assert_eq!(
            classify_process_exit(&cleanup_failure, None),
            ProcessExitClassification::SupervisorFailure
        );
        let cleanup_error = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "cleanupErrors": [{"code":"HANDLE_CLEANUP_FAILED"}]
            })),
            Some(42),
        )
        .unwrap();
        assert_eq!(
            classify_process_exit(&cleanup_error, None),
            ProcessExitClassification::SupervisorFailure
        );
        let mut cleanup_receipt = exit_receipt(ProcessExitClassification::TargetExit, Some(0));
        cleanup_receipt.supervisor_error_count = 1;
        assert!(cleanup_receipt.into_completion_authority().is_err());

        let post_spawn_cleanup_failure = ProcessOwnerTerminal::parse(
            &failure_terminal(serde_json::json!({
                "cleanupErrors": [{"code":"JOB_CLEANUP_FAILED"}]
            })),
            Some(42),
        )
        .unwrap();
        assert!(post_spawn_cleanup_failure
            .validate_zero_resident_release()
            .is_ok());
        assert_eq!(
            classify_process_exit(&post_spawn_cleanup_failure, None),
            ProcessExitClassification::SupervisorFailure
        );
        let mut failure_receipt = exit_receipt(ProcessExitClassification::SupervisorFailure, None);
        failure_receipt.cleanup_error_count = 1;
        assert!(failure_receipt.into_completion_authority().is_err());

        let mut otherwise_successful_cleanup_receipt =
            exit_receipt(ProcessExitClassification::TargetExit, Some(0));
        otherwise_successful_cleanup_receipt.cleanup_error_count = 1;
        assert!(otherwise_successful_cleanup_receipt
            .into_completion_authority()
            .is_err());
    }

    #[test]
    fn complete_post_spawn_failure_is_release_evidence_not_completion_authority() {
        let raw = "C:\\private\\service.exe --secret session-token-0123456789";
        let failure = ProcessOwnerTerminal::parse(
            &failure_terminal(serde_json::json!({ "message": raw })),
            None,
        )
        .unwrap();
        assert!(failure.validate_zero_resident_release().is_ok());
        assert_eq!(failure.root_pid, Some(42));
        assert_eq!(failure.failure().unwrap().code(), "WAIT_FAILED");
        assert_eq!(
            failure.failure().unwrap().message(),
            "Service process exit wait failed"
        );
        assert!(!format!("{failure:?}").contains(raw));

        let receipt = exit_receipt(ProcessExitClassification::SupervisorFailure, None);
        assert!(receipt.into_completion_authority().is_err());
    }

    #[test]
    fn exact_pre_start_failure_is_release_evidence_without_started_authority() {
        let raw = "C:\\private\\service.exe --secret session-token-0123456789";
        let failure = ProcessOwnerTerminal::parse_pre_start_failure(&pre_start_failure(
            serde_json::json!({ "message": raw }),
        ))
        .unwrap();
        assert!(failure.validate_zero_resident_release().is_ok());
        assert_eq!(failure.root_pid, None);
        assert_eq!(failure.code, None);
        assert_eq!(failure.failure().unwrap().code(), "SPAWN_FAILED");
        assert_eq!(
            failure.failure().unwrap().message(),
            "Service process could not be created"
        );
        assert!(!format!("{failure:?}").contains(raw));
        assert_eq!(
            classify_process_exit(&failure, None),
            ProcessExitClassification::SupervisorFailure
        );

        let mut receipt = exit_receipt(ProcessExitClassification::SupervisorFailure, None);
        receipt.started_boundary_accepted = false;
        receipt.root_pid = None;
        receipt.accounting = ProcessTreeAccounting {
            peak_private_commit_bytes: None,
            complete: false,
        };
        assert!(receipt.into_completion_authority().is_err());
    }

    #[test]
    fn pre_start_failure_parser_rejects_ambiguous_or_malformed_records() {
        assert!(
            ProcessOwnerTerminal::parse_pre_start_failure(&pre_start_failure(
                serde_json::json!({ "rootPid": 42 })
            ))
            .is_err()
        );
        assert!(
            ProcessOwnerTerminal::parse_pre_start_failure(&pre_start_failure(
                serde_json::json!({ "message": null })
            ))
            .is_err()
        );
        assert!(
            ProcessOwnerTerminal::parse_pre_start_failure(&pre_start_failure(
                serde_json::json!({ "type": "exit" })
            ))
            .is_err()
        );
    }

    #[test]
    fn guarded_terminal_receipt_is_typed_and_bound_to_the_trusted_hot_launch() {
        let limits = hot_dashboard_limits();
        let receipt = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "systemCommitGuard": system_commit_guard_evidence(13_000, 13_000, None),
            })),
            Some(42),
        )
        .unwrap();
        receipt
            .validate_system_commit_guard_for_limits(limits, true)
            .unwrap();
        let evidence = receipt.system_commit_guard.unwrap();
        assert_eq!(evidence.configured_hard_limit_bytes, 8_192 * MEBIBYTE_BYTES);
        assert_eq!(evidence.effective_hard_limit_bytes, 8_192 * MEBIBYTE_BYTES);
        assert_eq!(evidence.expected_commit_bytes, 3_072 * MEBIBYTE_BYTES);

        let mut tampered = system_commit_guard_evidence(13_000, 13_000, None);
        tampered["expectedCommitBytes"] = serde_json::json!(3_071 * MEBIBYTE_BYTES);
        let tampered = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "systemCommitGuard": tampered })),
            Some(42),
        )
        .unwrap();
        assert!(tampered
            .validate_system_commit_guard_for_limits(limits, true)
            .is_err());

        let mut rebalanced = system_commit_guard_evidence(10_000, 10_000, None);
        rebalanced["effectiveHardLimitBytes"] = serde_json::json!(8_192 * MEBIBYTE_BYTES);
        let rebalanced = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "systemCommitGuard": rebalanced })),
            Some(42),
        )
        .unwrap();
        rebalanced
            .validate_system_commit_guard_for_limits(limits, true)
            .unwrap();
        assert_eq!(
            rebalanced
                .system_commit_guard
                .unwrap()
                .effective_hard_limit_bytes,
            8_192 * MEBIBYTE_BYTES,
        );

        let mut borrowed = system_commit_guard_evidence(13_000, 13_000, None);
        borrowed["effectiveHardLimitBytes"] = serde_json::json!(12_000 * MEBIBYTE_BYTES);
        let borrowed = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "systemCommitGuard": borrowed })),
            Some(42),
        )
        .unwrap();
        borrowed
            .validate_system_commit_guard_for_limits(limits, false)
            .unwrap();

        for invalid_effective_limit in [0, 32_769 * MEBIBYTE_BYTES] {
            let mut invalid = system_commit_guard_evidence(10_000, 10_000, None);
            invalid["effectiveHardLimitBytes"] = serde_json::json!(invalid_effective_limit);
            assert!(ProcessOwnerTerminal::parse(
                &terminal(serde_json::json!({ "systemCommitGuard": invalid })),
                Some(42),
            )
            .is_err());
        }

        let crossed_live_reserve = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "systemCommitGuard": system_commit_guard_evidence(13_000, 4_352, None),
            })),
            Some(42),
        )
        .unwrap();
        crossed_live_reserve
            .validate_system_commit_guard_for_limits(limits, true)
            .unwrap();
        crossed_live_reserve
            .validate_system_commit_guard_for_limits(limits, false)
            .unwrap();
    }

    #[test]
    fn guard_denial_and_live_reserve_trip_are_nonretryable_resource_exhaustion_receipts() {
        let limits = hot_dashboard_limits();
        let pre_start = serde_json::json!({
            "type": "error",
            "code": "BREADBOARD_RESOURCE_EXHAUSTED",
            "message": "Guarded development process expected commit does not fit below the system reserve",
            "supervisorExitCode": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
            "resourceExhausted": true,
            "treeExitConfirmed": true,
            "systemCommitGuard": system_commit_guard_evidence(
                7_424,
                7_424,
                Some("expected-commit-does-not-fit"),
            ),
        });
        let denial = ProcessOwnerTerminal::parse_pre_start_failure(&pre_start).unwrap();
        denial
            .validate_system_commit_guard_for_limits(limits, true)
            .unwrap();
        denial.validate_zero_resident_release().unwrap();
        assert_eq!(
            classify_process_exit(&denial, None),
            ProcessExitClassification::ResourceExhausted
        );

        let post_create_pre_resume = failure_terminal(serde_json::json!({
            "code": "BREADBOARD_RESOURCE_EXHAUSTED",
            "message": "Guarded development process system commit reserve denied the suspended target before resume",
            "supervisorExitCode": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
            "targetExitCode": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
            "resourceExhausted": true,
            "systemCommitGuard": system_commit_guard_evidence_with_pre_resume(
                13_000,
                Some(7_424),
                7_424,
                Some("expected-commit-does-not-fit"),
            ),
        }));
        let pre_resume_denial = ProcessOwnerTerminal::parse(&post_create_pre_resume, None).unwrap();
        pre_resume_denial
            .validate_system_commit_guard_for_limits(limits, true)
            .unwrap();
        pre_resume_denial.validate_zero_resident_release().unwrap();
        assert_eq!(pre_resume_denial.root_pid, Some(42));
        assert_eq!(
            pre_resume_denial.code,
            Some(RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE)
        );
        assert!(pre_resume_denial.failure().is_none());
        assert_eq!(
            classify_process_exit(&pre_resume_denial, None),
            ProcessExitClassification::ResourceExhausted
        );
        assert!(ProcessOwnerTerminal::parse(&post_create_pre_resume, Some(42)).is_err());

        let mut live_trip_guard =
            system_commit_guard_evidence(13_000, 4_352, Some("system-commit-reserve"));
        live_trip_guard["effectiveHardLimitBytes"] = serde_json::json!(9_000 * MEBIBYTE_BYTES);
        let live_trip = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "code": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "targetExitCode": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "resourceExhausted": true,
                "systemCommitGuard": live_trip_guard,
            })),
            Some(42),
        )
        .unwrap();
        live_trip
            .validate_system_commit_guard_for_limits(limits, true)
            .unwrap();
        live_trip
            .validate_system_commit_guard_for_limits(limits, false)
            .unwrap();
        assert_eq!(
            classify_process_exit(&live_trip, None),
            ProcessExitClassification::ResourceExhausted
        );
    }

    #[test]
    fn completion_authority_requires_an_ordinary_zero_code_target_exit() {
        assert!(exit_receipt(ProcessExitClassification::TargetExit, Some(0))
            .into_completion_authority()
            .is_ok());
        let scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        let mut pre_started_exit = ProcessTreeExit::worker_release_for_test_in_scope(
            scope,
            WorkerIdentity {
                job_id: "job_1".into(),
                attempt: 1,
                worker_instance_id: "worker_1".into(),
            },
            ProcessExitClassification::TargetExit,
        );
        pre_started_exit.root_exit_code = Some(0);
        assert!(pre_started_exit.into_completion_authority().is_err());
        for (classification, code) in [
            (ProcessExitClassification::TargetExit, Some(23)),
            (ProcessExitClassification::Stopped, Some(0)),
            (ProcessExitClassification::ResourceExhausted, Some(73)),
            (ProcessExitClassification::SupervisorFailure, None),
            (ProcessExitClassification::WorkerProtocolFault, Some(0)),
        ] {
            assert!(exit_receipt(classification, code)
                .into_completion_authority()
                .is_err());
        }
    }

    #[test]
    fn unused_completion_authority_can_restore_its_release_receipt() {
        let authority = exit_receipt(ProcessExitClassification::TargetExit, Some(0))
            .into_completion_authority()
            .unwrap();
        let receipt = authority.into_zero_resident_release();
        assert_eq!(
            receipt.classification(),
            ProcessExitClassification::TargetExit
        );
        assert_eq!(receipt.root_exit_code(), Some(0));
        assert_eq!(receipt.accounting().peak_private_commit_bytes, Some(1024));
    }

    #[test]
    fn ordinary_terminal_requires_helper_and_target_exit_codes_to_match() {
        let mismatched = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "code": 0,
                "targetExitCode": 5
            })),
            Some(42),
        )
        .unwrap();
        assert!(mismatched.validate_zero_resident_release().is_err());
    }

    #[test]
    fn stopped_classification_requires_a_helper_authored_outcome() {
        let ordinary =
            ProcessOwnerTerminal::parse(&terminal(serde_json::json!({})), Some(42)).unwrap();
        assert_eq!(ordinary.stop_outcome, None);
        let stopped = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "stopOutcome": "forced-after-grace" })),
            Some(42),
        )
        .unwrap();
        assert_eq!(
            stopped.stop_outcome,
            Some(ProcessStopOutcome::ForcedAfterGrace)
        );
    }

    #[test]
    fn parsed_terminal_classification_separates_restartable_target_exit() {
        let ordinary =
            ProcessOwnerTerminal::parse(&terminal(serde_json::json!({})), Some(42)).unwrap();
        assert_eq!(
            ordinary.classification(),
            ProcessExitClassification::TargetExit
        );

        let stopped = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "stopOutcome": "forced-after-grace" })),
            Some(42),
        )
        .unwrap();
        assert_eq!(stopped.classification(), ProcessExitClassification::Stopped);

        let exhausted = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "code": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "targetExitCode": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "resourceExhausted": true
            })),
            Some(42),
        )
        .unwrap();
        assert_eq!(
            exhausted.classification(),
            ProcessExitClassification::ResourceExhausted
        );

        let supervisor_failure =
            ProcessOwnerTerminal::parse(&failure_terminal(serde_json::json!({})), Some(42))
                .unwrap();
        assert_eq!(
            supervisor_failure.classification(),
            ProcessExitClassification::SupervisorFailure
        );
    }

    #[test]
    fn raw_target_output_is_kept_only_in_the_bounded_private_buffer() {
        assert!(is_private_diagnostic_kind("stdout"));
        assert!(is_private_diagnostic_kind("stderr"));
        assert!(!is_private_diagnostic_kind("memory"));

        let mut diagnostics = PrivateDiagnosticBuffer::new();
        for sequence in 0..(MAX_PRIVATE_DIAGNOSTIC_RECORDS + 3) {
            diagnostics.record(
                32,
                serde_json::json!({ "type": "stdout", "sequence": sequence }),
            );
        }
        assert_eq!(diagnostics.len(), MAX_PRIVATE_DIAGNOSTIC_RECORDS);
        assert!(diagnostics.bytes <= MAX_PRIVATE_DIAGNOSTIC_BYTES);
    }

    #[test]
    fn supervisor_failure_diagnostics_are_closed_bounded_and_drop_untrusted_detail() {
        let raw = "C:\\private\\service.exe --token session-token-0123456789 PATH=secret";
        let failure = safe_supervisor_failure("SPAWN_FAILED", raw);
        assert_eq!(failure.code(), "SPAWN_FAILED");
        assert_eq!(failure.message(), "Service process could not be created");
        assert!(failure.code().len() <= MAX_SUPERVISOR_FAILURE_CODE_BYTES);
        assert!(failure.message().len() <= MAX_SUPERVISOR_FAILURE_MESSAGE_BYTES);

        let diagnostic = supervisor_failure_diagnostic(&failure);
        assert!(diagnostic.len() <= MAX_SUPERVISOR_FAILURE_DIAGNOSTIC_BYTES);
        assert!(diagnostic.contains("failure-code=SPAWN_FAILED"));

        let malformed = safe_supervisor_failure(
            "MALFORMED_PROTOCOL",
            "inherited environment variable is outside the selected profile",
        );
        assert_eq!(
            malformed.message(),
            "Supervisor environment profile rejected a requested variable"
        );
        let unknown_malformed = safe_supervisor_failure("MALFORMED_PROTOCOL", raw);
        assert_eq!(
            unknown_malformed.message(),
            "Supervisor launch protocol was invalid"
        );
        assert!(diagnostic.contains("failure-message=Service process could not be created"));
        for private in [
            "C:\\private\\service.exe",
            "--token",
            "session-token-0123456789",
            "PATH=secret",
        ] {
            assert!(!diagnostic.contains(private));
            assert!(!failure.message().contains(private));
            assert!(!format!("{failure:?}").contains(private));
        }
        assert!(!format!("{failure:?}").contains(failure.message()));

        for unsafe_code in [
            "",
            "spawn-failed",
            "SPAWN FAILED",
            "C:\\private\\service.exe",
            "SESSION_TOKEN_0123456789",
            "A_REALLY_LONG_SUPERVISOR_FAILURE_CODE_THAT_EXCEEDS_THE_EXPLICIT_SIXTY_FOUR_BYTE_BOUND",
        ] {
            let failure = safe_supervisor_failure(unsafe_code, raw);
            assert_eq!(failure.code(), UNCLASSIFIED_SUPERVISOR_FAILURE_CODE);
            assert_eq!(failure.message(), UNCLASSIFIED_SUPERVISOR_FAILURE_MESSAGE);
            let diagnostic = supervisor_failure_diagnostic(&failure);
            if !unsafe_code.is_empty() {
                assert!(!diagnostic.contains(unsafe_code));
            }
            assert!(!diagnostic.contains(raw));
        }
    }

    #[test]
    fn durable_service_diagnostics_redact_every_sealed_secret_value() {
        let secrets = vec![
            "session-token-0123456789".to_owned(),
            "api-key-abcdefghijk".to_owned(),
        ];
        let sanitized = redact_service_diagnostic(
            "failed session-token-0123456789 then api-key-abcdefghijk",
            &secrets,
        );
        assert_eq!(sanitized, "failed [REDACTED] then [REDACTED]");
        assert!(!sanitized.contains("session-token"));
        assert!(!sanitized.contains("api-key"));
    }

    #[test]
    fn durable_worker_diagnostic_is_fenced_and_redacts_sealed_environment_values() {
        let pairs = [
            (
                OsStr::new("GBRAIN_ADAPTER_SECRET"),
                OsStr::new("worker-secret-0123456789"),
            ),
            (
                OsStr::new("CHATMOCK_API_KEY"),
                OsStr::new("local-key-abcdef"),
            ),
            (OsStr::new("PATH"), OsStr::new("C:\\not-secret")),
        ];
        let redactions = diagnostic_redactions(pairs.into_iter());
        assert_eq!(redactions.len(), 2);
        assert!(!redactions.iter().any(|value| value.contains("not-secret")));

        let identity = WorkerIdentity {
            job_id: "job_upload_1".into(),
            attempt: 2,
            worker_instance_id: "worker_ingest_1".into(),
        };
        let sanitized = redact_service_diagnostic(
            "ingest failed with worker-secret-0123456789 via local-key-abcdef",
            &redactions,
        );
        let record = worker_diagnostic_record(&identity, "stderr", &sanitized);
        assert!(
            record.starts_with("[job=job_upload_1 attempt=2 worker=worker_ingest_1 stream=stderr]")
        );
        assert_eq!(record.matches("[REDACTED]").count(), 2);
        assert!(!record.contains("worker-secret-0123456789"));
        assert!(!record.contains("local-key-abcdef"));
        assert!(record.len() < MAX_DURABLE_WORKER_DIAGNOSTIC_BYTES);
    }

    #[test]
    fn worker_stdout_stream_parses_chunked_fenced_sequential_events_only() {
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        let ready = WorkerEvent::Ready {
            identity: identity.clone(),
            sequence: 1,
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
        };
        let heartbeat = WorkerEvent::Heartbeat {
            identity: identity.clone(),
            sequence: 2,
            stage: "working".into(),
        };
        let wire = format!(
            "{}\n{}\n",
            serde_json::to_string(&ready).unwrap(),
            serde_json::to_string(&heartbeat).unwrap()
        );
        let split = wire.find("working").unwrap();
        let mut stream = WorkerEventStream::new(identity.clone());
        assert_eq!(stream.push_stdout_chunk(&wire[..split]), None);
        assert_eq!(stream.pop_ready(), Some(ready));
        assert!(stream.pop_ready().is_none());
        assert_eq!(stream.push_stdout_chunk(&wire[split..]), None);
        assert_eq!(stream.pop_ready(), Some(heartbeat));
        assert_eq!(stream.finish_record_boundary(), None);

        let out_of_sequence = WorkerEvent::Heartbeat {
            identity,
            sequence: 4,
            stage: "late".into(),
        };
        assert_eq!(
            stream.push_stdout_chunk(&format!(
                "{}\n",
                serde_json::to_string(&out_of_sequence).unwrap()
            )),
            Some(WorkerProtocolFault::FenceOrSequenceMismatch)
        );
        assert_eq!(stream.push_stdout_chunk("still invalid\n"), None);
        assert_eq!(stream.finish_record_boundary(), None);
    }

    #[test]
    fn owned_worker_event_retains_generation_and_exposes_only_typed_observation() {
        let scope = RuntimeGenerationScope::from_trusted_data_root_identity(7, 11);
        let other = RuntimeGenerationScope::from_trusted_data_root_identity(7, 12);
        let event = WorkerEvent::Ready {
            identity: WorkerIdentity {
                job_id: "job_1".into(),
                attempt: 1,
                worker_instance_id: "worker_1".into(),
            },
            sequence: 1,
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
        };
        let owned = OwnedWorkerEvent::for_test(scope.clone(), event.clone());

        assert_eq!(owned.event(), &event);
        assert!(owned.matches_generation_scope(&scope));
        assert!(!owned.matches_generation_scope(&other));
        assert!(!format!("{owned:?}").contains("job_1"));

        let failure = OwnedWorkerEvent::for_test(
            scope,
            WorkerEvent::Failed {
                identity: event.identity().clone(),
                sequence: 2,
                code: "PRIVATE_CODE".into(),
                message: "private worker failure text".into(),
            },
        );
        let debug = format!("{failure:?}");
        assert!(debug.contains("failed"));
        assert!(!debug.contains("PRIVATE_CODE"));
        assert!(!debug.contains("private worker failure text"));
    }

    #[test]
    fn durable_state_rejection_poison_is_fixed_and_blocks_completion_authority() {
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        let ready = WorkerEvent::Ready {
            identity: identity.clone(),
            sequence: 1,
            protocol_version: breadboard_runtime_protocol::WIRE_PROTOCOL_VERSION,
        };
        let mut stream = WorkerEventStream::new(identity);
        assert_eq!(
            stream.push_stdout_chunk(&format!("{}\n", serde_json::to_string(&ready).unwrap())),
            None
        );
        let mut fault = None;
        reject_worker_event_for_durable_state(Some(&mut stream), &mut fault).unwrap();
        assert_eq!(fault, Some(WorkerProtocolFault::DurableStateViolation));
        assert!(stream.pop_ready().is_none());
        assert_eq!(stream.push_stdout_chunk("still invalid\n"), None);

        let terminal =
            ProcessOwnerTerminal::parse(&terminal(serde_json::json!({})), Some(42)).unwrap();
        assert_eq!(
            classify_process_exit(&terminal, Some(WorkerProtocolFault::DurableStateViolation)),
            ProcessExitClassification::WorkerProtocolFault
        );
    }

    #[test]
    fn worker_stdout_partial_and_oversized_lines_fail_closed() {
        let identity = WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        };
        let mut partial = WorkerEventStream::new(identity.clone());
        assert_eq!(partial.push_stdout_chunk("{\"type\":\"ready\""), None);
        assert_eq!(
            partial.finish_record_boundary(),
            Some(WorkerProtocolFault::PartialRecord)
        );
        assert_eq!(partial.finish_record_boundary(), None);

        let mut oversized = WorkerEventStream::new(identity);
        assert_eq!(
            oversized.push_stdout_chunk(&"x".repeat(MAX_WORKER_EVENT_LINE_BYTES + 1)),
            Some(WorkerProtocolFault::RecordTooLarge)
        );
    }

    #[test]
    fn worker_protocol_fault_is_release_evidence_but_never_completion_authority() {
        let receipt = exit_receipt(ProcessExitClassification::WorkerProtocolFault, Some(0));
        assert_eq!(
            receipt.worker_protocol_fault(),
            Some(WorkerProtocolFault::InvalidRecord)
        );
        assert!(receipt.into_completion_authority().is_err());
    }

    #[test]
    fn every_supervisor_worker_stdout_loss_signal_is_fatal() {
        assert!(is_worker_stdout_loss_event(
            "stream-truncated",
            Some("stdout"),
            true
        ));
        assert!(is_worker_stdout_loss_event(
            "stream-pressure",
            Some("stdout"),
            true
        ));
        assert!(!is_worker_stdout_loss_event(
            "stream-pressure",
            Some("stderr"),
            true
        ));
        assert!(!is_worker_stdout_loss_event(
            "stream-truncated",
            Some("stdout"),
            false
        ));
        let mut stream = WorkerEventStream::new(WorkerIdentity {
            job_id: "job_1".into(),
            attempt: 1,
            worker_instance_id: "worker_1".into(),
        });
        assert_eq!(
            stream.poison(WorkerProtocolFault::OutputLost),
            Some(WorkerProtocolFault::OutputLost)
        );
        assert_eq!(stream.poison(WorkerProtocolFault::OutputLost), None);
    }

    #[test]
    fn supervisor_lifecycle_vocabulary_is_closed() {
        for kind in [
            "memory",
            "soft-limit",
            "hard-limit",
            "stop-escalated",
            "listener-ownership",
            "stream-pressure",
            "stream-truncated",
        ] {
            assert!(is_known_supervisor_lifecycle_kind(kind), "{kind}");
        }
        for kind in ["unknown", "started", "exit", "error", "stdout", "stderr"] {
            assert!(!is_known_supervisor_lifecycle_kind(kind), "{kind}");
        }
    }

    #[test]
    fn deferred_lifecycle_replay_is_bounded_and_coalesces_memory_samples() {
        let mut deferred = VecDeque::new();
        for sample in 0..128 {
            defer_lifecycle_event(
                &mut deferred,
                serde_json::json!({ "type": "memory", "sample": sample }),
            )
            .unwrap();
        }
        assert_eq!(deferred.len(), 1);
        assert_eq!(deferred.front().unwrap()["sample"], 127);

        deferred.clear();
        for sequence in 0..MAX_BUFFERED_PROCESS_OWNER_EVENTS {
            defer_lifecycle_event(
                &mut deferred,
                serde_json::json!({ "type": "soft-limit", "sequence": sequence }),
            )
            .unwrap();
        }
        assert!(matches!(
            defer_lifecycle_event(&mut deferred, serde_json::json!({ "type": "hard-limit" })),
            Err(ProcessOwnerError::Protocol(_))
        ));
        assert_eq!(deferred.len(), MAX_BUFFERED_PROCESS_OWNER_EVENTS);
    }

    #[test]
    fn listener_ownership_evidence_is_strict_and_request_bound() {
        let owned = serde_json::json!({
            "type": "listener-ownership",
            "requestId": 7,
            "port": 3210,
            "status": "owned",
            "ownerPid": 42,
        });
        assert_eq!(
            parse_listener_ownership(&owned, 7, 3210).unwrap(),
            LoopbackListenerOwnership::Owned(42)
        );

        let absent = serde_json::json!({
            "type": "listener-ownership",
            "requestId": 8,
            "port": 3210,
            "status": "absent",
            "ownerPid": null,
        });
        assert_eq!(
            parse_listener_ownership(&absent, 8, 3210).unwrap(),
            LoopbackListenerOwnership::Absent
        );

        for malformed in [
            serde_json::json!({
                "type": "listener-ownership",
                "requestId": 9,
                "port": 3210,
                "status": "owned",
                "ownerPid": 42,
            }),
            serde_json::json!({
                "type": "listener-ownership",
                "requestId": 7,
                "port": 3211,
                "status": "owned",
                "ownerPid": 42,
            }),
            serde_json::json!({
                "type": "listener-ownership",
                "requestId": 7,
                "port": 3210,
                "status": "owned",
                "ownerPid": null,
            }),
            serde_json::json!({
                "type": "listener-ownership",
                "requestId": 7,
                "port": 3210,
                "status": "absent",
                "ownerPid": null,
                "extra": true,
            }),
        ] {
            assert!(matches!(
                parse_listener_ownership(&malformed, 7, 3210),
                Err(ProcessOwnerError::Protocol(_))
            ));
        }
    }

    #[test]
    fn malformed_private_stream_envelopes_are_supervisor_protocol_faults() {
        assert_eq!(
            private_diagnostic_data(&serde_json::json!({
                "type": "stdout",
                "data": "worker bytes"
            }))
            .unwrap(),
            "worker bytes"
        );
        assert!(matches!(
            private_diagnostic_data(&serde_json::json!({ "type": "stdout" })),
            Err(ProcessOwnerError::Protocol(_))
        ));
        assert!(matches!(
            private_diagnostic_data(&serde_json::json!({
                "type": "stderr",
                "data": 7
            })),
            Err(ProcessOwnerError::Protocol(_))
        ));
    }

    #[test]
    fn event_wait_deadlines_are_explicitly_bounded() {
        assert!(bounded_event_deadline(Duration::ZERO).is_ok());
        assert!(bounded_event_deadline(MAX_PROCESS_OWNER_EVENT_WAIT).is_ok());
        assert!(
            bounded_event_deadline(MAX_PROCESS_OWNER_EVENT_WAIT + Duration::from_secs(1)).is_err()
        );
    }

    #[test]
    fn zero_event_wait_is_a_real_nonblocking_poll() {
        let (sender, receiver) = mpsc::sync_channel(1);
        sender.send(SupervisorRead::End).unwrap();
        let queued_deadline = bounded_event_deadline(Duration::ZERO).unwrap();
        assert!(matches!(
            recv_supervisor_read_until(&receiver, queued_deadline),
            Ok(SupervisorRead::End)
        ));

        let empty_deadline = bounded_event_deadline(Duration::ZERO).unwrap();
        assert!(matches!(
            recv_supervisor_read_until(&receiver, empty_deadline),
            Err(ProcessOwnerError::EventWaitTimeout)
        ));
        drop(sender);
    }

    #[test]
    fn minimum_limits_include_fixed_forced_and_graceful_cleanup_budgets() {
        let limits = ProcessOwnerLimits {
            soft_commit_bytes: 0,
            hard_commit_bytes: 0,
            graceful_shutdown: MIN_PROCESS_OWNER_GRACEFUL_SHUTDOWN,
            supervisor_exit_timeout: MIN_SUPERVISOR_EXIT_TIMEOUT,
            system_commit_guard: None,
        }
        .validate()
        .unwrap();
        assert_eq!(
            terminal_wait_timeout(limits, true).unwrap(),
            SUPERVISOR_TERMINAL_CLEANUP_BUDGET
        );
        assert_eq!(
            terminal_wait_timeout(limits, false).unwrap(),
            SUPERVISOR_TERMINAL_CLEANUP_BUDGET + MIN_PROCESS_OWNER_GRACEFUL_SHUTDOWN
        );
    }

    #[test]
    fn hard_limit_classification_requires_the_reserved_exit_code() {
        let exhausted = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "code": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "targetExitCode": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "resourceExhausted": true
            })),
            Some(42),
        )
        .unwrap();
        assert!(exhausted.validate_zero_resident_release().is_ok());

        let ambiguous = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({ "resourceExhausted": true })),
            Some(42),
        )
        .unwrap();
        assert!(ambiguous.validate_zero_resident_release().is_err());

        let ordinary_exit_73 = ProcessOwnerTerminal::parse(
            &terminal(serde_json::json!({
                "code": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "targetExitCode": RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE,
                "resourceExhausted": false
            })),
            Some(42),
        )
        .unwrap();
        assert!(ordinary_exit_73.validate_zero_resident_release().is_ok());
        assert!(!ordinary_exit_73.resource_exhausted());
    }
}
