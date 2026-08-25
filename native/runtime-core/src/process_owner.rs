use crate::{
    CurrentGenerationMembership, PathError, RuntimeGenerationScope, TrustedFilePin,
    TrustedLaunchDirectory,
};
use breadboard_runtime_protocol::{
    parse_worker_event, validate_identifier, WorkerEvent, WorkerIdentity,
    MAX_PROTOCOL_LINE_BYTES as MAX_WORKER_EVENT_LINE_BYTES,
};
use serde_json::Value;
use std::collections::VecDeque;
use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io::{self, BufRead, BufReader, Read, Write};
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
use std::process::{Child, ChildStdin, ChildStdout, ExitStatus};
#[cfg(windows)]
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender};
use std::time::{Duration, Instant};
use thiserror::Error;

pub const RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE: u32 = 73;
pub const MAX_PROCESS_OWNER_PROTOCOL_LINE_BYTES: u64 = 64 * 1024;
const MAX_TARGET_ARGUMENTS: usize = 4_096;
const TRUSTED_WINDOWS_ENVIRONMENT_NAMES: &[&str] = &["SystemRoot"];
const MAX_BUFFERED_PROCESS_OWNER_EVENTS: usize = 32;
const MAX_PRIVATE_DIAGNOSTIC_RECORDS: usize = 16;
const MAX_PRIVATE_DIAGNOSTIC_BYTES: usize = 256 * 1024;
const MIN_GRACEFUL_TIMEOUT: Duration = Duration::from_millis(100);
const MAX_GRACEFUL_TIMEOUT: Duration = Duration::from_secs(300);
const MIN_SUPERVISOR_EXIT_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_SUPERVISOR_EXIT_TIMEOUT: Duration = Duration::from_secs(30);
const SUPERVISOR_TERMINAL_CLEANUP_BUDGET: Duration = Duration::from_secs(8);
const MAX_PROCESS_OWNER_EVENT_WAIT: Duration = Duration::from_secs(24 * 60 * 60);
const FORCED_REAP_TIMEOUT: Duration = Duration::from_secs(1);
const CHILD_EXIT_POLL_INTERVAL: Duration = Duration::from_millis(10);
const SUPERVISOR_ACTIVATION_RECORD: &[u8] = b"{\"type\":\"activate\",\"protocolVersion\":1}\n";

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
}

#[derive(Clone, PartialEq, Eq)]
pub enum ProcessOwnerPurpose {
    Worker(WorkerIdentity),
    Service {
        service_id: String,
        instance_id: String,
    },
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
        instance_id: &str,
    ) -> Self {
        Self {
            generation: ProcessAuthorityGeneration::Test(scope),
            supervisor_pid: 7,
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Service {
                service_id: service_id.into(),
                instance_id: instance_id.into(),
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
                instance_id,
            } => {
                validate_identifier("serviceId", service_id).map_err(|_| {
                    ProcessOwnerError::InvalidLaunch("service ownership fence was invalid")
                })?;
                validate_identifier("serviceInstanceId", instance_id).map_err(|_| {
                    ProcessOwnerError::InvalidLaunch("service ownership fence was invalid")
                })
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
        if !(MIN_GRACEFUL_TIMEOUT..=MAX_GRACEFUL_TIMEOUT).contains(&self.graceful_shutdown) {
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
        Ok(self)
    }
}

/// A complete launch selected by trusted registries and pinned filesystem
/// authorities. Arguments are caller data, but the supervisor, executable,
/// optional language entrypoint, and working directory cannot be supplied as
/// untrusted strings.
pub struct TrustedProcessLaunch {
    purpose: ProcessOwnerPurpose,
    supervisor: TrustedFilePin,
    executable: TrustedFilePin,
    entrypoint: Option<TrustedFilePin>,
    working_directory: TrustedLaunchDirectory,
    arguments: Vec<OsString>,
    environment: TrustedEnvironmentPolicy,
    limits: ProcessOwnerLimits,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct TrustedEnvironmentPolicy {
    private: (),
}

impl TrustedEnvironmentPolicy {
    fn minimal() -> Self {
        Self { private: () }
    }

    fn names(self) -> &'static [&'static str] {
        let _ = self.private;
        TRUSTED_WINDOWS_ENVIRONMENT_NAMES
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
            .field("argument_count", &self.arguments.len())
            .field("environment", &"<fixed trusted policy>")
            .field("limits", &self.limits)
            .finish()
    }
}

impl TrustedProcessLaunch {
    pub fn new(
        purpose: ProcessOwnerPurpose,
        supervisor: TrustedFilePin,
        executable: TrustedFilePin,
        entrypoint: Option<TrustedFilePin>,
        working_directory: TrustedLaunchDirectory,
        arguments: Vec<OsString>,
        limits: ProcessOwnerLimits,
    ) -> Result<Self, ProcessOwnerError> {
        if supervisor.authority_kind() != "runtime" || executable.authority_kind() != "runtime" {
            return Err(ProcessOwnerError::InvalidLaunch(
                "supervisor and executable must come from runtime-root authority",
            ));
        }
        if entrypoint
            .as_ref()
            .is_some_and(|entrypoint| entrypoint.authority_kind() != "application")
        {
            return Err(ProcessOwnerError::InvalidLaunch(
                "entrypoint must come from application-root authority",
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
        purpose.validate()?;
        let launch = Self {
            purpose,
            supervisor,
            executable,
            entrypoint,
            working_directory,
            arguments,
            environment: TrustedEnvironmentPolicy::minimal(),
            limits: limits.validate()?,
        };
        launch.revalidate_pins()?;
        Ok(launch)
    }

    fn revalidate_pins(&self) -> Result<(), ProcessOwnerError> {
        self.supervisor.revalidate()?;
        self.executable.revalidate()?;
        if let Some(entrypoint) = &self.entrypoint {
            entrypoint.revalidate()?;
        }
        self.working_directory.revalidate()?;
        Ok(())
    }

    #[cfg(windows)]
    fn child_environment(&self) -> Result<Vec<(String, OsString)>, ProcessOwnerError> {
        let mut values = Vec::with_capacity(self.environment.names().len());
        for &name in self.environment.names() {
            let value = std::env::var_os(name).ok_or(ProcessOwnerError::MissingEnvironment)?;
            values.push((name.to_string(), value));
        }
        values.sort_by(|left, right| {
            left.0
                .to_ascii_lowercase()
                .cmp(&right.0.to_ascii_lowercase())
        });
        Ok(values)
    }
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
            | "stream-pressure"
            | "stream-truncated"
    )
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
}

impl fmt::Debug for RunningProcessOwner {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RunningProcessOwner")
            .field("supervisor_pid", &self.supervisor_pid)
            .field("root_pid", &self.root_pid)
            .field("terminal_seen", &self.terminal_seen)
            .field("stop_requested", &self.stop_requested)
            .field("private_diagnostic_count", &self.private_diagnostics.len())
            .field("typed_worker_event_stream", &self.worker_events.is_some())
            .field("worker_protocol_fault", &self.worker_protocol_fault)
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
    #[cfg(windows)]
    pub fn spawn(
        generation: &CurrentGenerationMembership,
        launch: TrustedProcessLaunch,
    ) -> Result<Self, ProcessOwnerError> {
        launch.revalidate_pins()?;
        let environment = launch.child_environment()?;
        let mut command = Command::new(launch.supervisor.absolute());
        command
            .env_clear()
            .envs(environment)
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
            .arg(launch.working_directory.absolute());
        for &name in launch.environment.names() {
            command.arg("--inherit-env").arg(name);
        }
        command.arg("--").arg(launch.executable.absolute());
        if let Some(entrypoint) = &launch.entrypoint {
            command.arg(entrypoint.absolute());
        }
        command.args(&launch.arguments);

        // All launch authorities are revalidated immediately before the OS
        // opens the pinned supervisor image. The supervisor repeats the target
        // containment sequence as CREATE_SUSPENDED + atomic Job assignment +
        // membership verification + ResumeThread.
        launch.revalidate_pins()?;
        let mut child = command.spawn().map_err(ProcessOwnerError::Spawn)?;
        let supervisor_pid = child.id();
        if let Err(error) = assign_supervisor_to_generation(&child, generation) {
            terminate_and_reap_bounded(&mut child, FORCED_REAP_TIMEOUT);
            return Err(error);
        }
        let mut control = match child.stdin.take() {
            Some(control) => control,
            None => {
                terminate_and_reap_bounded(&mut child, FORCED_REAP_TIMEOUT);
                return Err(ProcessOwnerError::Protocol(
                    "supervisor stdin was unavailable",
                ));
            }
        };
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                terminate_and_reap_bounded(&mut child, FORCED_REAP_TIMEOUT);
                return Err(ProcessOwnerError::Protocol(
                    "supervisor stdout was unavailable",
                ));
            }
        };
        let events = match start_supervisor_reader(stdout) {
            Ok(events) => events,
            Err(error) => {
                terminate_and_reap_bounded(&mut child, FORCED_REAP_TIMEOUT);
                return Err(ProcessOwnerError::Control(error));
            }
        };
        if let Err(error) = control
            .write_all(SUPERVISOR_ACTIVATION_RECORD)
            .and_then(|_| control.flush())
        {
            terminate_and_reap_bounded(&mut child, FORCED_REAP_TIMEOUT);
            return Err(ProcessOwnerError::Control(error));
        }
        let worker_events = match &launch.purpose {
            ProcessOwnerPurpose::Worker(identity) => Some(WorkerEventStream::new(identity.clone())),
            ProcessOwnerPurpose::Service { .. } => None,
        };
        Ok(Self {
            child,
            control,
            events,
            private_diagnostics: PrivateDiagnosticBuffer::new(),
            worker_events,
            worker_protocol_fault: None,
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
        })
    }

    #[cfg(not(windows))]
    pub fn spawn(
        _generation: &CurrentGenerationMembership,
        _launch: TrustedProcessLaunch,
    ) -> Result<Self, ProcessOwnerError> {
        // Process groups alone cannot prove that a descendant did not call
        // setsid/setpgid and escape. Until the native runtime has an OS-backed
        // containment implementation for the target platform, refusing launch
        // is safer than minting false complete-tree authority.
        Err(ProcessOwnerError::UnsupportedPlatform)
    }

    pub fn supervisor_pid(&self) -> u32 {
        self.supervisor_pid
    }

    pub fn root_pid(&self) -> Option<u32> {
        self.root_pid
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
            return Ok(ProcessOwnerEvent::Worker(event));
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
                    return Ok(ProcessOwnerEvent::Worker(event));
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
                        terminal.validate_zero_resident_release()?;
                        if self.root_pid.is_none() {
                            self.root_pid = Some(terminal.root_pid);
                        }
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
                    } else {
                        self.terminal_seen = true;
                        let code = value
                            .get("code")
                            .and_then(Value::as_str)
                            .unwrap_or("RUNTIME_PROCESS_OWNER_ERROR")
                            .to_string();
                        Err(ProcessOwnerError::SupervisorRejected { code })
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
        if Some(terminal.root_pid) != self.root_pid {
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

        let classification = if terminal.failure.is_some() {
            ProcessExitClassification::SupervisorFailure
        } else if terminal.resource_exhausted {
            ProcessExitClassification::ResourceExhausted
        } else if self.worker_protocol_fault.is_some() {
            ProcessExitClassification::WorkerProtocolFault
        } else if terminal.stop_outcome.is_some() {
            ProcessExitClassification::Stopped
        } else {
            ProcessExitClassification::TargetExit
        };
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
            supervisor_error_count: terminal.supervisor_error_count,
            cleanup_error_count: terminal.cleanup_error_count,
            worker_protocol_fault: self.worker_protocol_fault,
        };
        self.exit_confirmation_minted = true;
        Ok(receipt)
    }
}

#[cfg(windows)]
fn assign_supervisor_to_generation(
    child: &Child,
    generation: &CurrentGenerationMembership,
) -> Result<(), ProcessOwnerError> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, IsProcessInJob};

    let process = child.as_raw_handle() as HANDLE;
    let job = generation.raw_job_handle();
    if unsafe { AssignProcessToJobObject(job, process) } == 0 {
        return Err(ProcessOwnerError::GenerationContainment(
            io::Error::last_os_error(),
        ));
    }
    let mut assigned = 0;
    if unsafe { IsProcessInJob(process, job, &mut assigned) } == 0 {
        return Err(ProcessOwnerError::GenerationContainment(
            io::Error::last_os_error(),
        ));
    }
    if assigned == 0 {
        return Err(ProcessOwnerError::GenerationContainment(io::Error::new(
            io::ErrorKind::Other,
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
    if timeout.is_zero() || timeout > MAX_PROCESS_OWNER_EVENT_WAIT {
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
        return Err(ProcessOwnerError::EventWaitTimeout);
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

fn verify_supervisor_exit(status: ExitStatus, terminal_code: u32) -> Result<(), ProcessOwnerError> {
    let Some(status_code) = status.code() else {
        return Err(ProcessOwnerError::ExitStatusMismatch);
    };
    if status_code as u32 != terminal_code {
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

#[derive(Debug)]
pub enum ProcessOwnerEvent {
    Lifecycle(Value),
    Worker(WorkerEvent),
    WorkerProtocolFault(WorkerProtocolFault),
    Terminal(ProcessOwnerTerminal),
}

/// An opaque parsed terminal record. It is not itself tree-exit authority:
/// `RunningProcessOwner::confirm_exit` must additionally observe the pinned
/// supervisor process exit and pass its internal one-mint guard.
#[derive(Clone, PartialEq, Eq)]
pub struct ProcessOwnerTerminal {
    code: u32,
    root_pid: u32,
    target_exit_code: Option<u32>,
    resource_exhausted: bool,
    failure: Option<ProcessSupervisorFailure>,
    stop_outcome: Option<ProcessStopOutcome>,
    zero_resident_confirmed: bool,
    peak_job_commit_bytes: Option<u64>,
    peak_accounting_complete: bool,
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
            .field("supervisor_error_count", &self.supervisor_error_count)
            .field("cleanup_error_count", &self.cleanup_error_count)
            .finish()
    }
}

impl ProcessOwnerTerminal {
    fn parse(value: &Value, expected_root_pid: Option<u32>) -> Result<Self, ProcessOwnerError> {
        let kind = value
            .get("type")
            .and_then(Value::as_str)
            .ok_or(ProcessOwnerError::Protocol(
                "terminal receipt contained no event type",
            ))?;
        let (code, failure) = match kind {
            "exit" => (
                value
                    .get("code")
                    .and_then(Value::as_u64)
                    .and_then(|value| u32::try_from(value).ok())
                    .ok_or(ProcessOwnerError::Protocol(
                        "terminal receipt contained an invalid exit code",
                    ))?,
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
                (
                    code,
                    Some(ProcessSupervisorFailure {
                        code: failure_code.to_string(),
                        message: message.to_string(),
                    }),
                )
            }
            _ => {
                return Err(ProcessOwnerError::Protocol(
                    "terminal receipt had an invalid event type",
                ))
            }
        };
        let root_pid = bounded_pid(value.get("rootPid"))?;
        if expected_root_pid.is_some_and(|expected| expected != root_pid)
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
            supervisor_error_count,
            cleanup_error_count,
        })
    }

    /// Validates only the evidence needed to release a durable worker
    /// reservation: the helper must have proven that its process tree has no
    /// residents and its terminal classification must be internally coherent.
    /// Final accounting and ancillary cleanup health are intentionally carried
    /// forward to the stricter completion-authority gate below; neither can
    /// invalidate an exact zero-resident proof and strand a reservation.
    fn validate_zero_resident_release(&self) -> Result<(), ProcessOwnerError> {
        if !self.zero_resident_confirmed {
            return Err(ProcessOwnerError::Protocol(
                "zero resident processes were not proven",
            ));
        }
        if self.failure.is_some() && (self.resource_exhausted || self.code != 1) {
            return Err(ProcessOwnerError::Protocol(
                "supervisor failure receipt had an invalid classification",
            ));
        }
        if self.failure.is_none()
            && !self.resource_exhausted
            && self.target_exit_code != Some(self.code)
        {
            return Err(ProcessOwnerError::Protocol(
                "supervisor exit code did not match the ordinary target exit",
            ));
        }
        if self.resource_exhausted && self.code != RESOURCE_EXHAUSTED_PROCESS_EXIT_CODE {
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessSupervisorFailure {
    code: String,
    message: String,
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
    root_pid: u32,
    purpose: ProcessOwnerPurpose,
    root_exit_code: Option<u32>,
    classification: ProcessExitClassification,
    failure: Option<ProcessSupervisorFailure>,
    stop_outcome: Option<ProcessStopOutcome>,
    accounting: ProcessTreeAccounting,
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
    pub fn into_completion_authority(self) -> Result<AuthoritativeProcessOwner, ProcessTreeExit> {
        if !self.started_boundary_accepted
            || self.classification != ProcessExitClassification::TargetExit
            || self.root_exit_code != Some(0)
            || !self.accounting.complete
            || self.accounting.peak_private_commit_bytes.is_none()
            || self.supervisor_error_count != 0
            || self.cleanup_error_count != 0
        {
            return Err(self);
        }
        Ok(AuthoritativeProcessOwner {
            generation: self.generation,
            supervisor_pid: self.supervisor_pid,
            root_pid: self.root_pid,
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

    pub fn worker_protocol_fault(&self) -> Option<WorkerProtocolFault> {
        self.worker_protocol_fault
    }

    pub(crate) fn worker_identity(&self) -> Option<&WorkerIdentity> {
        match &self.purpose {
            ProcessOwnerPurpose::Worker(identity) => Some(identity),
            ProcessOwnerPurpose::Service { .. } => None,
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
    pub(crate) fn worker_release_for_test(identity: WorkerIdentity) -> Self {
        Self {
            generation: None,
            started_boundary_accepted: true,
            supervisor_pid: 7,
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Worker(identity),
            root_exit_code: Some(1),
            classification: ProcessExitClassification::SupervisorFailure,
            failure: Some(ProcessSupervisorFailure {
                code: "TEST_FAILURE".into(),
                message: "test-only zero-resident release receipt".into(),
            }),
            stop_outcome: None,
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(0),
                complete: true,
            },
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: None,
        }
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
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Worker(identity),
            root_exit_code: (classification == ProcessExitClassification::TargetExit).then_some(1),
            classification,
            failure: (classification == ProcessExitClassification::SupervisorFailure).then(|| {
                ProcessSupervisorFailure {
                    code: "TEST_SUPERVISION_FAILED".into(),
                    message: "test-only supervisor failure before started".into(),
                }
            }),
            stop_outcome: (classification == ProcessExitClassification::Stopped)
                .then_some(ProcessStopOutcome::Forced),
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(0),
                complete: true,
            },
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
        receipt
    }

    #[cfg(test)]
    pub(crate) fn service_release_for_test_in_scope(
        scope: RuntimeGenerationScope,
        service_id: &str,
        instance_id: &str,
    ) -> Self {
        Self {
            generation: Some(ProcessAuthorityGeneration::Test(scope)),
            started_boundary_accepted: false,
            supervisor_pid: 7,
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Service {
                service_id: service_id.into(),
                instance_id: instance_id.into(),
            },
            root_exit_code: None,
            classification: ProcessExitClassification::SupervisorFailure,
            failure: Some(ProcessSupervisorFailure {
                code: "TEST_SUPERVISION_FAILED".into(),
                message: "test-only service supervisor failure".into(),
            }),
            stop_outcome: None,
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(0),
                complete: true,
            },
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: None,
        }
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
            root_pid: self.root_pid,
            purpose: self.purpose,
            root_exit_code: Some(0),
            classification: ProcessExitClassification::TargetExit,
            failure: None,
            stop_outcome: None,
            accounting: self.accounting,
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: None,
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
            "code": "SUPERVISION_FAILED",
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

    fn exit_receipt(
        classification: ProcessExitClassification,
        root_exit_code: Option<u32>,
    ) -> ProcessTreeExit {
        ProcessTreeExit {
            generation: None,
            started_boundary_accepted: true,
            supervisor_pid: 7,
            root_pid: 42,
            purpose: ProcessOwnerPurpose::Worker(WorkerIdentity {
                job_id: "job_1".into(),
                attempt: 1,
                worker_instance_id: "worker_1".into(),
            }),
            root_exit_code,
            classification,
            failure: (classification == ProcessExitClassification::SupervisorFailure).then(|| {
                ProcessSupervisorFailure {
                    code: "SUPERVISION_FAILED".into(),
                    message: "supervision failed".into(),
                }
            }),
            stop_outcome: (classification == ProcessExitClassification::Stopped)
                .then_some(ProcessStopOutcome::Forced),
            accounting: ProcessTreeAccounting {
                peak_private_commit_bytes: Some(1024),
                complete: true,
            },
            supervisor_error_count: 0,
            cleanup_error_count: 0,
            worker_protocol_fault: (classification
                == ProcessExitClassification::WorkerProtocolFault)
                .then_some(WorkerProtocolFault::InvalidRecord),
        }
    }

    #[test]
    fn launch_environment_policy_is_closed_and_minimal() {
        assert_eq!(TrustedEnvironmentPolicy::minimal().names(), &["SystemRoot"]);
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
            instance_id: "service_1".into(),
        }
        .validate()
        .is_ok());
        assert!(ProcessOwnerPurpose::Service {
            service_id: "../hermes".into(),
            instance_id: "service_1".into(),
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
        let failure =
            ProcessOwnerTerminal::parse(&failure_terminal(serde_json::json!({})), None).unwrap();
        assert!(failure.validate_zero_resident_release().is_ok());
        assert_eq!(failure.root_pid, 42);
        assert_eq!(failure.failure().unwrap().code(), "SUPERVISION_FAILED");

        let receipt = exit_receipt(ProcessExitClassification::SupervisorFailure, None);
        assert!(receipt.into_completion_authority().is_err());
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
        assert!(bounded_event_deadline(Duration::ZERO).is_err());
        assert!(bounded_event_deadline(MAX_PROCESS_OWNER_EVENT_WAIT).is_ok());
        assert!(
            bounded_event_deadline(MAX_PROCESS_OWNER_EVENT_WAIT + Duration::from_secs(1)).is_err()
        );
    }

    #[test]
    fn minimum_limits_include_fixed_forced_and_graceful_cleanup_budgets() {
        let limits = ProcessOwnerLimits {
            soft_commit_bytes: 0,
            hard_commit_bytes: 0,
            graceful_shutdown: MIN_GRACEFUL_TIMEOUT,
            supervisor_exit_timeout: MIN_SUPERVISOR_EXIT_TIMEOUT,
        }
        .validate()
        .unwrap();
        assert_eq!(
            terminal_wait_timeout(limits, true).unwrap(),
            SUPERVISOR_TERMINAL_CLEANUP_BUDGET
        );
        assert_eq!(
            terminal_wait_timeout(limits, false).unwrap(),
            SUPERVISOR_TERMINAL_CLEANUP_BUDGET + MIN_GRACEFUL_TIMEOUT
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
