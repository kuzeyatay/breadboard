use serde::Serialize;
use std::env;
use std::io::Write;

const MAX_TARGET_ARGUMENTS: usize = 4_096;
const MAX_WINDOWS_COMMAND_LINE_UTF16: usize = 32_767;
const MAX_ENVIRONMENT_NAME_BYTES: usize = 256;
const TRUSTED_INHERITED_ENVIRONMENT_NAMES: &[&str] = &["SystemRoot"];

#[derive(Debug, Clone, PartialEq, Eq)]
struct Options {
    soft_limit_bytes: u64,
    hard_limit_bytes: u64,
    graceful_timeout_ms: u64,
    cwd: String,
    inherited_environment: Vec<String>,
    command: String,
    args: Vec<String>,
}

fn parse_u64(name: &str, value: Option<String>) -> Result<u64, String> {
    value
        .ok_or_else(|| format!("missing value for {name}"))?
        .parse::<u64>()
        .map_err(|_| format!("invalid value for {name}"))
}

fn parse_options<I>(arguments: I) -> Result<Options, String>
where
    I: IntoIterator<Item = String>,
{
    let mut values = arguments.into_iter();
    let mut soft_limit_bytes = 0;
    let mut hard_limit_bytes = 0;
    let mut graceful_timeout_ms = 5_000;
    let mut cwd = None;
    let mut inherited_environment = Vec::new();
    let mut target = Vec::new();
    while let Some(value) = values.next() {
        match value.as_str() {
            "--soft-limit-bytes" => soft_limit_bytes = parse_u64(&value, values.next())?,
            "--hard-limit-bytes" => hard_limit_bytes = parse_u64(&value, values.next())?,
            "--graceful-timeout-ms" => graceful_timeout_ms = parse_u64(&value, values.next())?,
            "--cwd" => {
                let value = values
                    .next()
                    .ok_or_else(|| "missing value for --cwd".to_string())?;
                if cwd.replace(value).is_some() {
                    return Err("--cwd may be specified only once".to_string());
                }
            }
            "--inherit-env" => {
                let name = values
                    .next()
                    .ok_or_else(|| "missing value for --inherit-env".to_string())?;
                if !is_valid_environment_name(&name) {
                    return Err("invalid inherited environment variable name".to_string());
                }
                let canonical_name = TRUSTED_INHERITED_ENVIRONMENT_NAMES
                    .iter()
                    .copied()
                    .find(|trusted| trusted.eq_ignore_ascii_case(&name))
                    .ok_or_else(|| {
                        "inherited environment variable is outside the trusted policy"
                            .to_string()
                    })?;
                if inherited_environment
                    .iter()
                    .any(|existing: &String| existing.eq_ignore_ascii_case(canonical_name))
                {
                    return Err("duplicate inherited environment variable name".to_string());
                }
                inherited_environment.push(canonical_name.to_string());
            }
            "--" => {
                target.extend(values);
                break;
            }
            _ => return Err(format!("unknown option {value}")),
        }
    }
    let command = target.first().cloned().ok_or_else(|| "missing target command".to_string())?;
    if command.is_empty() {
        return Err("target command must not be empty".to_string());
    }
    if target.len() > MAX_TARGET_ARGUMENTS + 1 {
        return Err(format!("target has more than {MAX_TARGET_ARGUMENTS} arguments"));
    }
    if target.iter().any(|value| value.contains('\0')) {
        return Err("target command and arguments must not contain NUL".to_string());
    }
    let cwd = cwd.ok_or_else(|| "missing required --cwd".to_string())?;
    if cwd.is_empty() || cwd.contains('\0') {
        return Err("target working directory is invalid".to_string());
    }
    #[cfg(windows)]
    if !std::path::Path::new(&cwd).is_absolute() {
        return Err("target working directory must be absolute".to_string());
    }
    if soft_limit_bytes > 0 && hard_limit_bytes > 0 && soft_limit_bytes >= hard_limit_bytes {
        return Err("soft limit must be lower than hard limit".to_string());
    }
    if hard_limit_bytes > usize::MAX as u64 {
        return Err("hard limit cannot be represented on this platform".to_string());
    }
    Ok(Options {
        soft_limit_bytes,
        hard_limit_bytes,
        graceful_timeout_ms: graceful_timeout_ms.clamp(100, 300_000),
        cwd,
        inherited_environment,
        command,
        args: target.into_iter().skip(1).collect(),
    })
}

fn is_valid_environment_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ENVIRONMENT_NAME_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'=')
}

#[derive(Serialize)]
struct ErrorEvent<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    code: &'a str,
    message: &'a str,
}

fn write_json_line(value: &impl Serialize) -> Result<(), String> {
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();
    serde_json::to_writer(&mut stdout, value)
        .map_err(|error| format!("serializing protocol event failed: {error}"))?;
    stdout
        .write_all(b"\n")
        .and_then(|_| stdout.flush())
        .map_err(|error| format!("writing protocol event failed: {error}"))
}

fn main() {
    let options = match parse_options(env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            let _ = write_json_line(&ErrorEvent {
                kind: "error",
                code: "MALFORMED_PROTOCOL",
                message: &message,
            });
            std::process::exit(64);
        }
    };

    #[cfg(windows)]
    match windows_runtime::run(options) {
        Ok(code) => {
            // Rust forwards this value to ExitProcess on Windows. Preserve the
            // target's complete exit status instead of reporting success after
            // a failed child.
            std::process::exit(code as i32);
        }
        Err((code, message)) => {
            let _ = write_json_line(&ErrorEvent {
                kind: "error",
                code,
                message: &message,
            });
            std::process::exit(1);
        }
    }

    #[cfg(not(windows))]
    {
        let _ = options;
        let _ = write_json_line(&ErrorEvent {
            kind: "error",
            code: "UNSUPPORTED_PLATFORM",
            message: "runtime-supervisor is a Windows-only containment helper",
        });
        std::process::exit(69);
    }
}

#[cfg(windows)]
mod windows_runtime {
    use super::{Options, MAX_WINDOWS_COMMAND_LINE_UTF16};
    use serde::Deserialize;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::ffi::{c_void, OsStr, OsString};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use std::ptr::{null, null_mut};
    use std::sync::mpsc::{self, TryRecvError};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, SetHandleInformation, ERROR_MORE_DATA, ERROR_NOT_FOUND, HANDLE,
        HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT};
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, IsProcessInJob, QueryInformationJobObject, SetInformationJobObject,
        TerminateJobObject, JobObjectAssociateCompletionPortInformation,
        JobObjectBasicProcessIdList, JobObjectExtendedLimitInformation,
        JobObjectLimitViolationInformation, JobObjectNotificationLimitInformation,
        JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_BASIC_PROCESS_ID_LIST,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOBOBJECT_LIMIT_VIOLATION_INFORMATION,
        JOBOBJECT_NOTIFICATION_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_JOB_MEMORY,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::IO::{
        CancelSynchronousIo, CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::ProcessStatus::{
        GetPerformanceInfo, GetProcessMemoryInfo, PERFORMANCE_INFORMATION,
        PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
        InitializeProcThreadAttributeList, OpenProcess, ResumeThread, TerminateProcess,
        UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NEW_PROCESS_GROUP,
        CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT,
        PROCESS_INFORMATION,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
        PROC_THREAD_ATTRIBUTE_JOB_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW,
    };

    const ACTIVATION_PROTOCOL_VERSION: u32 = 1;
    const MAX_ACTIVATION_LINE_BYTES: u64 = 256;
    const MAX_CONTROL_LINE_BYTES: u64 = 64 * 1_024;
    const MAX_JOB_PROCESS_IDS: usize = 4_096;
    const JOB_COMPLETION_KEY: usize = 1;
    // windows-sys 0.59 exposes the Job Object structures and information
    // classes but not the winnt.h completion-message macros.
    const JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO: u32 = 4;
    const JOB_OBJECT_MSG_JOB_MEMORY_LIMIT: u32 = 10;
    const JOB_OBJECT_MSG_NOTIFICATION_LIMIT: u32 = 11;
    const FORWARDER_DRAIN_TIMEOUT: Duration = Duration::from_millis(500);
    const FORWARDER_CANCEL_TIMEOUT: Duration = Duration::from_millis(500);
    const PROTOCOL_TERMINAL_DELIVERY_TIMEOUT: Duration = Duration::from_millis(500);
    const PROTOCOL_WRITER_CANCEL_TIMEOUT: Duration = Duration::from_millis(250);
    const PROTOCOL_WRITER_POLL_INTERVAL: Duration = Duration::from_millis(5);
    const MAX_PROTOCOL_LINE_BYTES: usize = 64 * 1024;
    const MAX_PROTOCOL_QUEUE_BYTES: usize = 512 * 1024;
    const MAX_PROTOCOL_QUEUE_ITEMS: usize = 128;
    const TERMINAL_QUEUE_RESERVE_BYTES: usize = MAX_PROTOCOL_LINE_BYTES;
    const TERMINAL_QUEUE_RESERVE_ITEMS: usize = 4;
    const PROTOCOL_DELIVERY_FAILED_EXIT_CODE: u32 = 74;
    const MAX_FORWARDED_STREAM_BYTES: u64 = 1024 * 1024;
    const MAX_WINDOWS_ENVIRONMENT_UTF16: usize = 32_767;
    const REQUIRED_CHILD_ENVIRONMENT: &[&str] = &["SystemRoot"];

    pub(super) type SupervisorError = (&'static str, String);
    type ForwardResult = Result<(), SupervisorError>;

    #[derive(Debug, Deserialize)]
    #[serde(tag = "type", deny_unknown_fields)]
    enum ActivationMessage {
        #[serde(rename = "activate")]
        Activate {
            #[serde(rename = "protocolVersion")]
            protocol_version: u32,
        },
    }

    #[derive(Debug, Deserialize)]
    #[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
    enum ControlMessage {
        Stop { force: bool },
    }

    struct ControlInput {
        activation: mpsc::Receiver<Result<(), SupervisorError>>,
        stop: mpsc::Receiver<bool>,
        _thread: thread::JoinHandle<()>,
    }

    impl ControlInput {
        fn wait_for_activation(&self) -> Result<(), SupervisorError> {
            self.activation.recv().map_err(|_| {
                (
                    "ACTIVATION_READ_FAILED",
                    "control-input thread exited before reporting activation".into(),
                )
            })?
        }
    }

    fn read_activation<R: BufRead>(reader: &mut R) -> Result<(), SupervisorError> {
        let mut line = Vec::new();
        let count = reader
            .by_ref()
            .take(MAX_ACTIVATION_LINE_BYTES + 1)
            .read_until(b'\n', &mut line)
            .map_err(|error| {
                (
                    "ACTIVATION_READ_FAILED",
                    format!("failed to read supervisor activation: {error}"),
                )
            })?;
        if count == 0 {
            return Err((
                "ACTIVATION_REQUIRED",
                "supervisor stdin reached EOF before activation".into(),
            ));
        }
        if line.len() as u64 > MAX_ACTIVATION_LINE_BYTES {
            return Err((
                "ACTIVATION_TOO_LARGE",
                format!(
                    "supervisor activation exceeds {MAX_ACTIVATION_LINE_BYTES} bytes"
                ),
            ));
        }
        if line.last() != Some(&b'\n') {
            return Err((
                "MALFORMED_ACTIVATION",
                "supervisor activation must be newline terminated".into(),
            ));
        }
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        let activation = serde_json::from_slice::<ActivationMessage>(&line).map_err(|error| {
            (
                "MALFORMED_ACTIVATION",
                format!("supervisor activation is invalid: {error}"),
            )
        })?;
        match activation {
            ActivationMessage::Activate { protocol_version }
                if protocol_version == ACTIVATION_PROTOCOL_VERSION =>
            {
                Ok(())
            }
            ActivationMessage::Activate { protocol_version } => Err((
                "MALFORMED_ACTIVATION",
                format!(
                    "unsupported supervisor activation protocol version {protocol_version}"
                ),
            )),
        }
    }

    fn read_stop_or_disconnect<R: BufRead>(reader: &mut R) -> bool {
        let mut line = Vec::new();
        let read = reader
            .by_ref()
            .take(MAX_CONTROL_LINE_BYTES + 1)
            .read_until(b'\n', &mut line);
        let Ok(count) = read else { return true };
        if count == 0 || line.len() as u64 > MAX_CONTROL_LINE_BYTES {
            return true;
        }
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        match serde_json::from_slice::<ControlMessage>(&line) {
            Ok(ControlMessage::Stop { force }) => force,
            Err(_) => true,
        }
    }

    fn start_control_input() -> Result<ControlInput, SupervisorError> {
        let (activation_tx, activation_rx) =
            mpsc::sync_channel::<Result<(), SupervisorError>>(1);
        let (stop_tx, stop_rx) = mpsc::sync_channel::<bool>(1);
        let control_thread = thread::Builder::new()
            .name("runtime-supervisor-control".into())
            .spawn(move || {
                let stdin = std::io::stdin();
                let mut reader = BufReader::new(stdin.lock());
                let activation = read_activation(&mut reader);
                let activated = activation.is_ok();
                if activation_tx.send(activation).is_err() || !activated {
                    return;
                }

                // Keep the same buffered reader for the stop record. A parent
                // may write activation and stop in one kernel write, and a new
                // reader would discard stop bytes already buffered here.
                let _ = stop_tx.send(read_stop_or_disconnect(&mut reader));
            })
            .map_err(|error| {
                (
                    "CONTROL_THREAD_FAILED",
                    format!("failed to start control-input thread: {error}"),
                )
            })?;
        Ok(ControlInput {
            activation: activation_rx,
            stop: stop_rx,
            _thread: control_thread,
        })
    }

    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() { unsafe { CloseHandle(self.0); } }
        }
    }

    struct AttributeList {
        storage: Vec<usize>,
        pointer: *mut c_void,
    }

    impl AttributeList {
        unsafe fn for_handles_and_job(
            handles: &mut [HANDLE],
            jobs: &mut [HANDLE],
        ) -> Result<Self, (&'static str, String)> {
            let mut bytes = 0usize;
            let _ = InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes);
            if bytes == 0 {
                return Err((
                    "SPAWN_FAILED",
                    "InitializeProcThreadAttributeList did not report a buffer size".into(),
                ));
            }
            let words = bytes
                .checked_add(size_of::<usize>() - 1)
                .ok_or(("SPAWN_FAILED", "attribute-list size overflow".into()))?
                / size_of::<usize>();
            let mut storage = vec![0usize; words];
            let pointer = storage.as_mut_ptr().cast::<c_void>();
            if InitializeProcThreadAttributeList(pointer, 2, 0, &mut bytes) == 0 {
                return Err((
                    "SPAWN_FAILED",
                    "InitializeProcThreadAttributeList failed".into(),
                ));
            }
            if UpdateProcThreadAttribute(
                pointer,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_mut_ptr().cast::<c_void>(),
                std::mem::size_of_val(handles),
                null_mut(),
                null(),
            ) == 0
            {
                DeleteProcThreadAttributeList(pointer);
                return Err((
                    "SPAWN_FAILED",
                    "UpdateProcThreadAttribute(handle list) failed".into(),
                ));
            }
            if UpdateProcThreadAttribute(
                pointer,
                0,
                PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
                jobs.as_mut_ptr().cast::<c_void>(),
                std::mem::size_of_val(jobs),
                null_mut(),
                null(),
            ) == 0
            {
                DeleteProcThreadAttributeList(pointer);
                return Err((
                    "JOB_ASSIGN_FAILED",
                    "UpdateProcThreadAttribute(job list) failed".into(),
                ));
            }
            Ok(Self { storage, pointer })
        }
    }

    impl Drop for AttributeList {
        fn drop(&mut self) {
            // Keep the backing allocation alive until the OS-owned attribute
            // list has been deleted.
            let _ = self.storage.len();
            unsafe { DeleteProcThreadAttributeList(self.pointer) };
        }
    }

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
    }

    /// Creates a new environment block instead of inheriting the supervisor's
    /// complete ambient block. The trusted caller passes names only; values
    /// remain in the supervisor environment and never enter argv or protocol
    /// output.
    fn child_environment_block(
        allowlist: &[String],
    ) -> Result<Vec<u16>, SupervisorError> {
        let mut names = REQUIRED_CHILD_ENVIRONMENT
            .iter()
            .map(|name| (*name).to_string())
            .collect::<Vec<_>>();
        for name in allowlist {
            if !names
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(name))
            {
                names.push(name.clone());
            }
        }

        let mut variables = Vec::<(String, OsString)>::with_capacity(names.len());
        for name in names {
            let value = std::env::var_os(&name).ok_or((
                "SPAWN_FAILED",
                "an allowlisted child environment variable was unavailable".to_string(),
            ))?;
            variables.push((name, value));
        }
        variables.sort_by(|left, right| {
            left.0
                .to_ascii_lowercase()
                .cmp(&right.0.to_ascii_lowercase())
        });

        let mut block = Vec::<u16>::new();
        for (name, value) in variables {
            let mut entry = OsStr::new(&name).encode_wide().collect::<Vec<_>>();
            entry.push('=' as u16);
            entry.extend(value.as_os_str().encode_wide());
            if entry.contains(&0) {
                return Err((
                    "SPAWN_FAILED",
                    "an allowlisted child environment variable was invalid".to_string(),
                ));
            }
            entry.push(0);
            let final_size = block
                .len()
                .checked_add(entry.len())
                .and_then(|length| length.checked_add(1))
                .ok_or((
                    "SPAWN_FAILED",
                    "the allowlisted child environment is too large".to_string(),
                ))?;
            if final_size > MAX_WINDOWS_ENVIRONMENT_UTF16 {
                return Err((
                    "SPAWN_FAILED",
                    "the allowlisted child environment is too large".to_string(),
                ));
            }
            block.extend(entry);
        }
        // Every entry already ends in NUL; this is the second NUL that
        // terminates the complete environment block.
        block.push(0);
        Ok(block)
    }

    fn quote(value: &str) -> String {
        if !value.is_empty() && !value.chars().any(|c| c.is_whitespace() || c == '"') {
            return value.to_string();
        }
        let mut result = String::from("\"");
        let mut slashes = 0;
        for ch in value.chars() {
            if ch == '\\' {
                slashes += 1;
            } else if ch == '"' {
                result.push_str(&"\\".repeat(slashes * 2 + 1));
                result.push('"');
                slashes = 0;
            } else {
                result.push_str(&"\\".repeat(slashes));
                slashes = 0;
                result.push(ch);
            }
        }
        result.push_str(&"\\".repeat(slashes * 2));
        result.push('"');
        result
    }

    type TerminalReceipt = mpsc::Receiver<Result<(), String>>;

    struct QueuedProtocolLine {
        bytes: Vec<u8>,
        terminal_receipt: Option<mpsc::SyncSender<Result<(), String>>>,
    }

    impl QueuedProtocolLine {
        fn len(&self) -> usize {
            self.bytes.len()
        }
    }

    #[derive(Default)]
    struct ProtocolQueueState {
        lifecycle: VecDeque<QueuedProtocolLine>,
        logs: VecDeque<QueuedProtocolLine>,
        queued_bytes: usize,
        closed: bool,
        terminal_pending: bool,
        failed: Option<String>,
        dropped_log_events: u64,
        dropped_log_bytes: u64,
    }

    impl ProtocolQueueState {
        fn queued_items(&self) -> usize {
            self.lifecycle.len() + self.logs.len()
        }

        fn remove_oldest_log(&mut self) -> bool {
            let Some(line) = self.logs.pop_front() else {
                return false;
            };
            self.queued_bytes = self.queued_bytes.saturating_sub(line.len());
            self.record_dropped_log(line.len());
            true
        }

        fn record_dropped_log(&mut self, bytes: usize) {
            self.dropped_log_events = self.dropped_log_events.saturating_add(1);
            self.dropped_log_bytes = self.dropped_log_bytes.saturating_add(bytes as u64);
        }
    }

    #[derive(Clone, Copy)]
    struct DroppedLogStats {
        events: u64,
        bytes: u64,
    }

    struct ProtocolQueue {
        state: Mutex<ProtocolQueueState>,
        wake: Condvar,
    }

    impl ProtocolQueue {
        fn new() -> Self {
            Self {
                state: Mutex::new(ProtocolQueueState::default()),
                wake: Condvar::new(),
            }
        }

        fn enqueue(
            &self,
            line: QueuedProtocolLine,
            is_log: bool,
        ) -> Result<bool, SupervisorError> {
            let mut state = self.state.lock().map_err(|_| {
                (
                    "PROTOCOL_WRITE_FAILED",
                    "protocol queue mutex was poisoned".to_string(),
                )
            })?;
            if let Some(message) = state.failed.as_ref() {
                return Err(("PROTOCOL_WRITE_FAILED", message.clone()));
            }
            if state.closed {
                return Err((
                    "PROTOCOL_WRITE_FAILED",
                    "protocol writer was already closed".to_string(),
                ));
            }

            let byte_limit = MAX_PROTOCOL_QUEUE_BYTES - TERMINAL_QUEUE_RESERVE_BYTES;
            let item_limit = MAX_PROTOCOL_QUEUE_ITEMS - TERMINAL_QUEUE_RESERVE_ITEMS;
            let line_len = line.len();
            let exceeds_capacity = |state: &ProtocolQueueState| {
                state
                    .queued_bytes
                    .checked_add(line_len)
                    .map_or(true, |bytes| bytes > byte_limit)
                    || state.queued_items() >= item_limit
            };

            if is_log && exceeds_capacity(&state) {
                state.record_dropped_log(line_len);
                return Ok(false);
            }
            while exceeds_capacity(&state) && state.remove_oldest_log() {}
            if exceeds_capacity(&state) {
                return Err((
                    "PROTOCOL_QUEUE_FULL",
                    "protocol lifecycle queue exhausted its bounded capacity".to_string(),
                ));
            }

            state.queued_bytes += line_len;
            if is_log {
                state.logs.push_back(line);
            } else {
                state.lifecycle.push_back(line);
            }
            self.wake.notify_one();
            Ok(true)
        }

        fn begin_terminal(&self) -> Result<DroppedLogStats, SupervisorError> {
            let mut state = self.state.lock().map_err(|_| {
                (
                    "PROTOCOL_WRITE_FAILED",
                    "protocol queue mutex was poisoned".to_string(),
                )
            })?;
            if let Some(message) = state.failed.as_ref() {
                return Err(("PROTOCOL_WRITE_FAILED", message.clone()));
            }
            if state.closed || state.terminal_pending {
                return Err((
                    "PROTOCOL_WRITE_FAILED",
                    "protocol writer was already closed".to_string(),
                ));
            }

            // Close producer admission before clearing best-effort logs. Any
            // lifecycle event that won the lock first stays ahead of terminal;
            // late or detached producers fail closed.
            state.closed = true;
            state.terminal_pending = true;
            while state.remove_oldest_log() {}
            let stats = DroppedLogStats {
                events: state.dropped_log_events,
                bytes: state.dropped_log_bytes,
            };
            self.wake.notify_all();
            Ok(stats)
        }

        fn commit_terminal(
            &self,
            line: QueuedProtocolLine,
        ) -> Result<(), SupervisorError> {
            let mut state = self.state.lock().map_err(|_| {
                (
                    "PROTOCOL_WRITE_FAILED",
                    "protocol queue mutex was poisoned".to_string(),
                )
            })?;
            if let Some(message) = state.failed.as_ref() {
                return Err(("PROTOCOL_WRITE_FAILED", message.clone()));
            }
            if !state.closed || !state.terminal_pending {
                return Err((
                    "PROTOCOL_WRITE_FAILED",
                    "protocol terminal slot was unavailable".to_string(),
                ));
            }
            let line_len = line.len();
            let fits = state
                .queued_bytes
                .checked_add(line_len)
                .is_some_and(|bytes| bytes <= MAX_PROTOCOL_QUEUE_BYTES)
                && state.queued_items() < MAX_PROTOCOL_QUEUE_ITEMS;
            if !fits {
                state.terminal_pending = false;
                self.wake.notify_all();
                return Err((
                    "PROTOCOL_QUEUE_FULL",
                    "protocol terminal event exhausted its reserved capacity".to_string(),
                ));
            }
            state.queued_bytes += line_len;
            state.lifecycle.push_back(line);
            state.terminal_pending = false;
            self.wake.notify_all();
            Ok(())
        }

        fn abort_terminal(&self) {
            if let Ok(mut state) = self.state.lock() {
                state.terminal_pending = false;
            }
            self.wake.notify_all();
        }

        fn next_line(&self) -> Result<Option<QueuedProtocolLine>, String> {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "protocol queue mutex was poisoned".to_string())?;
            loop {
                if let Some(message) = state.failed.as_ref() {
                    return Err(message.clone());
                }
                let next = match state.lifecycle.pop_front() {
                    Some(line) => Some(line),
                    None => state.logs.pop_front(),
                };
                if let Some(line) = next {
                    state.queued_bytes = state.queued_bytes.saturating_sub(line.len());
                    return Ok(Some(line));
                }
                if state.closed && !state.terminal_pending {
                    return Ok(None);
                }
                state = self
                    .wake
                    .wait(state)
                    .map_err(|_| "protocol queue mutex was poisoned".to_string())?;
            }
        }

        fn close(&self) {
            if let Ok(mut state) = self.state.lock() {
                state.closed = true;
                state.terminal_pending = false;
                // Forwarders have already received their bounded stop window.
                // At protocol shutdown, queued logs are best-effort and must
                // not sit ahead of lifecycle or terminal delivery.
                while state.remove_oldest_log() {}
            }
            self.wake.notify_all();
        }

        fn fail(&self, message: String) {
            let Ok(mut state) = self.state.lock() else {
                self.wake.notify_all();
                return;
            };
            if state.failed.is_none() {
                state.failed = Some(message.clone());
            }
            state.closed = true;
            state.terminal_pending = false;
            let mut pending = std::mem::take(&mut state.lifecycle);
            pending.append(&mut state.logs);
            for mut line in pending {
                if let Some(receipt) = line.terminal_receipt.take() {
                    let _ = receipt.try_send(Err(message.clone()));
                }
            }
            state.queued_bytes = 0;
            self.wake.notify_all();
        }
    }

    #[derive(Clone)]
    struct ProtocolSink {
        queue: Arc<ProtocolQueue>,
    }

    impl ProtocolSink {
        fn serialize(value: serde_json::Value) -> Result<Vec<u8>, SupervisorError> {
            let mut bytes = serde_json::to_vec(&value).map_err(|error| {
                (
                    "PROTOCOL_WRITE_FAILED",
                    format!("serializing protocol event failed: {error}"),
                )
            })?;
            bytes.push(b'\n');
            if bytes.len() > MAX_PROTOCOL_LINE_BYTES {
                return Err((
                    "PROTOCOL_EVENT_TOO_LARGE",
                    format!(
                        "serialized protocol event exceeded {MAX_PROTOCOL_LINE_BYTES} bytes"
                    ),
                ));
            }
            Ok(bytes)
        }

        fn emit_lifecycle(&self, value: serde_json::Value) -> Result<(), SupervisorError> {
            let line = QueuedProtocolLine {
                bytes: Self::serialize(value)?,
                terminal_receipt: None,
            };
            self.queue.enqueue(line, false).map(|_| ())
        }

        fn emit_log(&self, value: serde_json::Value) -> Result<bool, SupervisorError> {
            let line = QueuedProtocolLine {
                bytes: Self::serialize(value)?,
                terminal_receipt: None,
            };
            self.queue.enqueue(line, true)
        }

        fn emit_terminal(
            &self,
            mut value: serde_json::Value,
        ) -> Result<TerminalReceipt, SupervisorError> {
            let dropped = self.queue.begin_terminal()?;
            let Some(object) = value.as_object_mut() else {
                self.queue.abort_terminal();
                return Err((
                    "PROTOCOL_WRITE_FAILED",
                    "terminal protocol event must be a JSON object".to_string(),
                ));
            };
            if dropped.events > 0 {
                object.insert(
                    "droppedProtocolLogEvents".to_string(),
                    dropped.events.into(),
                );
                object.insert(
                    "droppedProtocolLogBytes".to_string(),
                    dropped.bytes.into(),
                );
            }
            let bytes = match Self::serialize(value) {
                Ok(bytes) => bytes,
                Err(error) => {
                    self.queue.abort_terminal();
                    return Err(error);
                }
            };
            let (receipt_tx, receipt_rx) = mpsc::sync_channel(1);
            let line = QueuedProtocolLine {
                bytes,
                terminal_receipt: Some(receipt_tx),
            };
            self.queue.commit_terminal(line)?;
            Ok(receipt_rx)
        }
    }

    struct ProtocolWriter {
        sink: ProtocolSink,
        thread: Option<thread::JoinHandle<Result<(), String>>>,
    }

    impl ProtocolWriter {
        fn start() -> Result<Self, SupervisorError> {
            let queue = Arc::new(ProtocolQueue::new());
            let writer_queue = Arc::clone(&queue);
            let thread = thread::Builder::new()
                .name("runtime-supervisor-protocol-writer".into())
                .spawn(move || {
                    let stdout = std::io::stdout();
                    loop {
                        let Some(mut line) = writer_queue.next_line()? else {
                            return Ok(());
                        };
                        let result = {
                            let mut stdout = stdout.lock();
                            stdout
                                .write_all(&line.bytes)
                                .and_then(|_| stdout.flush())
                                .map_err(|error| {
                                    format!("writing protocol event failed: {error}")
                                })
                        };
                        match result {
                            Ok(()) => {
                                if let Some(receipt) = line.terminal_receipt.take() {
                                    let _ = receipt.try_send(Ok(()));
                                }
                            }
                            Err(message) => {
                                if let Some(receipt) = line.terminal_receipt.take() {
                                    let _ = receipt.try_send(Err(message.clone()));
                                }
                                writer_queue.fail(message.clone());
                                return Err(message);
                            }
                        }
                    }
                })
                .map_err(|error| {
                    (
                        "PROTOCOL_WRITE_FAILED",
                        format!("starting protocol writer failed: {error}"),
                    )
                })?;
            Ok(Self {
                sink: ProtocolSink { queue },
                thread: Some(thread),
            })
        }

        fn sink(&self) -> ProtocolSink {
            self.sink.clone()
        }

        fn finish(mut self, terminal_receipt: Option<TerminalReceipt>) -> bool {
            self.finish_inner(terminal_receipt)
        }

        fn finish_inner(&mut self, terminal_receipt: Option<TerminalReceipt>) -> bool {
            self.sink.queue.close();
            let had_terminal = terminal_receipt.is_some();
            let terminal_delivered = terminal_receipt.is_some_and(|receipt| {
                matches!(
                    receipt.recv_timeout(PROTOCOL_TERMINAL_DELIVERY_TIMEOUT),
                    Ok(Ok(()))
                )
            });

            let Some(thread) = self.thread.take() else {
                return terminal_delivered;
            };
            let graceful_timeout = if had_terminal && !terminal_delivered {
                Duration::from_millis(0)
            } else {
                PROTOCOL_TERMINAL_DELIVERY_TIMEOUT
            };
            let graceful_deadline = Instant::now() + graceful_timeout;
            while !thread.is_finished() && Instant::now() < graceful_deadline {
                thread::sleep(PROTOCOL_WRITER_POLL_INTERVAL);
            }
            if !thread.is_finished() {
                let _ = unsafe { CancelSynchronousIo(thread.as_raw_handle() as HANDLE) };
                let cancellation_deadline = Instant::now() + PROTOCOL_WRITER_CANCEL_TIMEOUT;
                while !thread.is_finished() && Instant::now() < cancellation_deadline {
                    thread::sleep(PROTOCOL_WRITER_POLL_INTERVAL);
                }
            }
            if thread.is_finished() {
                let _ = thread.join();
            } else {
                // A kernel/device write that ignores cancellation must not hold
                // process-tree cleanup or supervisor exit hostage.
                drop(thread);
            }
            terminal_delivered
        }
    }

    impl Drop for ProtocolWriter {
        fn drop(&mut self) {
            if self.thread.is_some() {
                let _ = self.finish_inner(None);
            }
        }
    }

    fn emit(output: &ProtocolSink, value: serde_json::Value) -> Result<(), SupervisorError> {
        output.emit_lifecycle(value)
    }

    fn emit_memory_sample(
        output: &ProtocolSink,
        value: serde_json::Value,
    ) -> Result<bool, SupervisorError> {
        output.emit_log(value)
    }

    pub(super) fn drain_utf8(
        pending: &mut Vec<u8>,
        end_of_stream: bool,
        mut emit_text: impl FnMut(String),
    ) {
        if pending.is_empty() {
            return;
        }
        if end_of_stream {
            emit_text(String::from_utf8_lossy(pending).into_owned());
            pending.clear();
            return;
        }
        if let Ok(text) = std::str::from_utf8(pending) {
            emit_text(text.to_owned());
            pending.clear();
            return;
        }

        // Decode an invalid read in one bounded chunk instead of emitting one
        // JSON event per bad byte. Preserve only a possibly incomplete final
        // scalar so it can be completed by the next pipe read.
        let retained = incomplete_utf8_suffix_len(pending);
        let decoded = pending.len() - retained;
        if decoded > 0 {
            emit_text(String::from_utf8_lossy(&pending[..decoded]).into_owned());
            pending.drain(..decoded);
        }
    }

    fn incomplete_utf8_suffix_len(bytes: &[u8]) -> usize {
        let maximum = bytes.len().min(3);
        for length in (1..=maximum).rev() {
            let suffix = &bytes[bytes.len() - length..];
            match std::str::from_utf8(suffix) {
                Err(error) if error.valid_up_to() == 0 && error.error_len().is_none() => {
                    return length;
                }
                _ => {}
            }
        }
        0
    }

    unsafe fn pipe() -> Result<(Handle, Handle), (&'static str, String)> {
        let mut read = null_mut();
        let mut write = null_mut();
        let mut security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        if CreatePipe(&mut read, &mut write, &mut security, 0) == 0 {
            return Err(("PIPE_FAILED", "CreatePipe failed".to_string()));
        }
        if SetHandleInformation(read, HANDLE_FLAG_INHERIT, 0) == 0 {
            CloseHandle(read);
            CloseHandle(write);
            return Err(("PIPE_FAILED", "SetHandleInformation failed".to_string()));
        }
        Ok((Handle(read), Handle(write)))
    }

    unsafe fn input_pipe() -> Result<(Handle, Handle), (&'static str, String)> {
        let mut read = null_mut();
        let mut write = null_mut();
        let mut security = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: 1,
        };
        if CreatePipe(&mut read, &mut write, &mut security, 0) == 0 {
            return Err(("PIPE_FAILED", "CreatePipe failed".to_string()));
        }
        if SetHandleInformation(write, HANDLE_FLAG_INHERIT, 0) == 0 {
            CloseHandle(read);
            CloseHandle(write);
            return Err(("PIPE_FAILED", "SetHandleInformation failed".to_string()));
        }
        Ok((Handle(read), Handle(write)))
    }

    fn into_file(handle: Handle) -> std::fs::File {
        let file = unsafe { std::fs::File::from_raw_handle(handle.0 as _) };
        std::mem::forget(handle);
        file
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(super) enum StreamReadErrorDisposition {
        Retry,
        EndOfStream,
        Fail,
    }

    pub(super) fn classify_stream_read_error(
        error: &std::io::Error,
    ) -> StreamReadErrorDisposition {
        match error.kind() {
            std::io::ErrorKind::Interrupted => StreamReadErrorDisposition::Retry,
            std::io::ErrorKind::BrokenPipe => StreamReadErrorDisposition::EndOfStream,
            _ => StreamReadErrorDisposition::Fail,
        }
    }

    struct Forwarder {
        stream: &'static str,
        cancellation_requested: Arc<AtomicBool>,
        thread: thread::JoinHandle<ForwardResult>,
    }

    impl Forwarder {
        fn is_finished(&self) -> bool {
            self.thread.is_finished()
        }

        fn cancel_blocking_io(&self) -> Result<(), SupervisorError> {
            self.cancellation_requested.store(true, Ordering::Release);
            if self.thread.is_finished() {
                return Ok(());
            }
            let cancelled = unsafe { CancelSynchronousIo(self.thread.as_raw_handle() as HANDLE) };
            if cancelled == 0 {
                let error = unsafe { GetLastError() };
                if error != ERROR_NOT_FOUND {
                    return Err((
                        "STREAM_FORWARD_CANCEL_FAILED",
                        format!(
                            "cancelling {} forwarding I/O failed with Windows error {error}",
                            self.stream
                        ),
                    ));
                }
            }
            Ok(())
        }

        fn join_finished(self) -> ForwardResult {
            match self.thread.join() {
                Ok(result) => result,
                Err(_) => Err((
                    "STREAM_FORWARD_FAILED",
                    format!("{} forwarding thread panicked", self.stream),
                )),
            }
        }
    }

    fn emit_decoded_stream(
        output: &ProtocolSink,
        stream: &'static str,
        pending: &mut Vec<u8>,
        end_of_stream: bool,
    ) -> Result<bool, SupervisorError> {
        let mut write_error = None;
        let mut fully_enqueued = true;
        drain_utf8(pending, end_of_stream, |data| {
            if write_error.is_none() {
                match output.emit_log(json!({ "type": stream, "data": data })) {
                    Ok(enqueued) => fully_enqueued &= enqueued,
                    Err(error) => write_error = Some(error),
                }
            }
        });
        match write_error {
            Some(error) => Err(error),
            None => Ok(fully_enqueued),
        }
    }

    fn report_stream_pressure(
        output: &ProtocolSink,
        stream: &'static str,
        pressure_reported: &mut bool,
        fully_enqueued: bool,
    ) -> ForwardResult {
        if fully_enqueued || *pressure_reported {
            return Ok(());
        }
        *pressure_reported = true;
        emit(output, json!({
            "type": "stream-pressure",
            "stream": stream,
            "message": "forwarded output was dropped because the bounded protocol queue was full",
        }))
    }

    fn forward_pending(
        output: &ProtocolSink,
        stream: &'static str,
        pending: &mut Vec<u8>,
        end_of_stream: bool,
        pressure_reported: &mut bool,
    ) -> ForwardResult {
        let fully_enqueued = emit_decoded_stream(output, stream, pending, end_of_stream)?;
        report_stream_pressure(output, stream, pressure_reported, fully_enqueued)
    }

    fn forward(
        handle: Handle,
        stream: &'static str,
        output: ProtocolSink,
    ) -> Result<Forwarder, SupervisorError> {
        // Convert the raw HANDLE into a standard-library owner before moving it
        // across the thread boundary. `File` is Send; windows-sys HANDLE is a
        // raw pointer and deliberately is not.
        let file = into_file(handle);
        let cancellation_requested = Arc::new(AtomicBool::new(false));
        let thread_cancellation = Arc::clone(&cancellation_requested);
        let thread = thread::Builder::new()
            .name(format!("runtime-supervisor-{stream}"))
            .spawn(move || {
                let mut file = file;
                let mut buffer = [0u8; 8192];
                // A UTF-8 scalar is at most four bytes, so at most three trailing
                // bytes survive between reads. Decode incrementally instead of
                // corrupting a multibyte scalar split at an arbitrary pipe read.
                let mut pending = Vec::with_capacity(buffer.len() + 3);
                let mut forwarded_bytes = 0_u64;
                let mut forwarding_enabled = true;
                let mut pressure_reported = false;
                loop {
                    if thread_cancellation.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    match file.read(&mut buffer) {
                        Ok(0) => {
                            forward_pending(
                                &output,
                                stream,
                                &mut pending,
                                true,
                                &mut pressure_reported,
                            )?;
                            return Ok(());
                        }
                        Ok(count) => {
                            if !forwarding_enabled {
                                // Keep draining the owned pipe so a verbose
                                // long-lived service cannot block, but retain
                                // the lifetime forwarding bound.
                                continue;
                            }
                            let remaining = MAX_FORWARDED_STREAM_BYTES
                                .saturating_sub(forwarded_bytes);
                            let accepted = usize::try_from(remaining.min(count as u64))
                                .unwrap_or(count);
                            if accepted > 0 {
                                pending.extend_from_slice(&buffer[..accepted]);
                                forwarded_bytes += accepted as u64;
                            }
                            forward_pending(
                                &output,
                                stream,
                                &mut pending,
                                false,
                                &mut pressure_reported,
                            )?;
                            if accepted != count {
                                // Flush at most the three-byte partial UTF-8
                                // suffix, then advertise truncation once. A
                                // persistent service remains alive; its later
                                // output is drained and discarded.
                                forward_pending(
                                    &output,
                                    stream,
                                    &mut pending,
                                    true,
                                    &mut pressure_reported,
                                )?;
                                emit(&output, json!({
                                    "type": "stream-truncated",
                                    "stream": stream,
                                    "forwardedBytes": forwarded_bytes,
                                    "limitBytes": MAX_FORWARDED_STREAM_BYTES,
                                }))?;
                                forwarding_enabled = false;
                            }
                        }
                        Err(_) if thread_cancellation.load(Ordering::Acquire) => return Ok(()),
                        Err(error) => match classify_stream_read_error(&error) {
                            StreamReadErrorDisposition::Retry => continue,
                            StreamReadErrorDisposition::EndOfStream => {
                                forward_pending(
                                    &output,
                                    stream,
                                    &mut pending,
                                    true,
                                    &mut pressure_reported,
                                )?;
                                return Ok(());
                            }
                            StreamReadErrorDisposition::Fail => {
                                return Err((
                                    "STREAM_FORWARD_FAILED",
                                    format!("{stream} pipe read failed: {error}"),
                                ));
                            }
                        },
                    }
                }
            })
            .map_err(|error| {
                (
                    "STREAM_FORWARD_FAILED",
                    format!("failed to start {stream} forwarding thread: {error}"),
                )
            })?;
        Ok(Forwarder {
            stream,
            cancellation_requested,
            thread,
        })
    }

    unsafe fn system_commit() -> Option<(u64, u64)> {
        let mut info: PERFORMANCE_INFORMATION = zeroed();
        info.cb = size_of::<PERFORMANCE_INFORMATION>() as u32;
        if GetPerformanceInfo(&mut info, info.cb) == 0 { return None; }
        let page = info.PageSize as u64;
        Some((info.CommitTotal as u64 * page, info.CommitLimit as u64 * page))
    }

    unsafe fn terminate_owned_job(
        job: HANDLE,
        exit_code: u32,
    ) -> Result<(), (&'static str, String)> {
        if TerminateJobObject(job, exit_code) == 0 {
            return Err((
                "JOB_TERMINATE_FAILED",
                format!(
                    "TerminateJobObject failed with Windows error {}",
                    GetLastError()
                ),
            ));
        }
        Ok(())
    }

    #[derive(Debug, Default, Clone, Copy)]
    struct JobNotifications {
        active_process_zero: bool,
        hard_limit_hit: bool,
        observed_job_commit_bytes: Option<u64>,
    }

    unsafe fn completion_port_for_job(
        job: HANDLE,
        hard_notification_bytes: u64,
    ) -> Result<Handle, (&'static str, String)> {
        let completion_port = Handle(CreateIoCompletionPort(
            INVALID_HANDLE_VALUE,
            null_mut(),
            0,
            1,
        ));
        if completion_port.0.is_null() {
            return Err((
                "JOB_CONFIG_FAILED",
                format!(
                    "CreateIoCompletionPort failed with Windows error {}",
                    GetLastError()
                ),
            ));
        }
        let association = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: JOB_COMPLETION_KEY as *mut c_void,
            CompletionPort: completion_port.0,
        };
        if SetInformationJobObject(
            job,
            JobObjectAssociateCompletionPortInformation,
            (&association as *const JOBOBJECT_ASSOCIATE_COMPLETION_PORT).cast::<c_void>(),
            size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32,
        ) == 0
        {
            return Err((
                "JOB_CONFIG_FAILED",
                format!(
                    "associating the Job Object completion port failed with Windows error {}",
                    GetLastError()
                ),
            ));
        }
        if hard_notification_bytes > 0 {
            let mut notification: JOBOBJECT_NOTIFICATION_LIMIT_INFORMATION = zeroed();
            notification.JobMemoryLimit = hard_notification_bytes;
            notification.LimitFlags = JOB_OBJECT_LIMIT_JOB_MEMORY;
            if SetInformationJobObject(
                job,
                JobObjectNotificationLimitInformation,
                (&notification as *const JOBOBJECT_NOTIFICATION_LIMIT_INFORMATION)
                    .cast::<c_void>(),
                size_of::<JOBOBJECT_NOTIFICATION_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                return Err((
                    "JOB_CONFIG_FAILED",
                    format!(
                        "configuring the guaranteed Job Object memory notification failed with Windows error {}",
                        GetLastError()
                    ),
                ));
            }
        }
        Ok(completion_port)
    }

    unsafe fn drain_job_notifications(
        completion_port: HANDLE,
        job: HANDLE,
    ) -> Result<JobNotifications, (&'static str, String)> {
        let mut result = JobNotifications::default();
        loop {
            let mut message = 0u32;
            let mut completion_key = 0usize;
            let mut overlapped: *mut OVERLAPPED = null_mut();
            let received = GetQueuedCompletionStatus(
                completion_port,
                &mut message,
                &mut completion_key,
                &mut overlapped,
                0,
            );
            if received == 0 {
                let error = GetLastError();
                if error == WAIT_TIMEOUT {
                    break;
                }
                return Err((
                    "JOB_NOTIFICATION_FAILED",
                    format!(
                        "GetQueuedCompletionStatus failed with Windows error {error}"
                    ),
                ));
            }
            if completion_key != JOB_COMPLETION_KEY {
                return Err((
                    "JOB_NOTIFICATION_FAILED",
                    "received a Job Object notification with an unexpected completion key".into(),
                ));
            }
            match message {
                JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => result.active_process_zero = true,
                JOB_OBJECT_MSG_JOB_MEMORY_LIMIT => result.hard_limit_hit = true,
                JOB_OBJECT_MSG_NOTIFICATION_LIMIT => {
                    // Querying the violation both records the exact job commit
                    // and rearms this guaranteed notification class. This job
                    // registers only a memory notification limit.
                    let mut violation: JOBOBJECT_LIMIT_VIOLATION_INFORMATION = zeroed();
                    if QueryInformationJobObject(
                        job,
                        JobObjectLimitViolationInformation,
                        (&mut violation as *mut JOBOBJECT_LIMIT_VIOLATION_INFORMATION)
                            .cast::<c_void>(),
                        size_of::<JOBOBJECT_LIMIT_VIOLATION_INFORMATION>() as u32,
                        null_mut(),
                    ) == 0
                    {
                        return Err((
                            "JOB_NOTIFICATION_FAILED",
                            format!(
                                "querying the Job Object limit violation failed with Windows error {}",
                                GetLastError()
                            ),
                        ));
                    }
                    if violation.ViolationLimitFlags & JOB_OBJECT_LIMIT_JOB_MEMORY != 0 {
                        result.hard_limit_hit = true;
                        result.observed_job_commit_bytes = Some(violation.JobMemory);
                    }
                }
                _ => {
                    // NEW_PROCESS and EXIT_PROCESS are expected bookkeeping
                    // messages. Full-tree completion is represented above by
                    // ACTIVE_PROCESS_ZERO; no unrecognized message changes a
                    // terminal classification.
                }
            }
        }
        Ok(result)
    }

    #[derive(Debug, Clone, Copy)]
    struct JobMemorySample {
        current_private_commit_bytes: Option<u64>,
        peak_job_commit_bytes: Option<u64>,
        process_count: Option<usize>,
        accounting_complete: bool,
    }

    unsafe fn job_process_ids(job: HANDLE) -> Option<Vec<usize>> {
        let mut capacity = 16usize;
        loop {
            let bytes = size_of::<JOBOBJECT_BASIC_PROCESS_ID_LIST>()
                .checked_add(
                    capacity
                        .checked_sub(1)?
                        .checked_mul(size_of::<usize>())?,
                )?;
            let words = bytes.checked_add(size_of::<usize>() - 1)? / size_of::<usize>();
            let mut storage = vec![0usize; words];
            let list = storage.as_mut_ptr().cast::<JOBOBJECT_BASIC_PROCESS_ID_LIST>();
            let mut returned_bytes = 0u32;
            let queried = QueryInformationJobObject(
                job,
                JobObjectBasicProcessIdList,
                list.cast::<c_void>(),
                u32::try_from(bytes).ok()?,
                &mut returned_bytes,
            );
            let assigned = (*list).NumberOfAssignedProcesses as usize;
            let returned = (*list).NumberOfProcessIdsInList as usize;
            if queried != 0 && returned <= capacity && assigned <= capacity {
                return Some(
                    std::slice::from_raw_parts((*list).ProcessIdList.as_ptr(), returned).to_vec(),
                );
            }

            let can_retry = (queried == 0 && GetLastError() == ERROR_MORE_DATA)
                || assigned > capacity
                || returned > capacity;
            if !can_retry || assigned > MAX_JOB_PROCESS_IDS || capacity >= MAX_JOB_PROCESS_IDS {
                return None;
            }
            let required = assigned.max(returned).max(capacity.saturating_mul(2));
            capacity = required.min(MAX_JOB_PROCESS_IDS);
        }
    }

    unsafe fn query_peak_job_commit(job: HANDLE) -> Result<u64, SupervisorError> {
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        if QueryInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &mut limits as *mut _ as *mut c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            null_mut(),
        ) == 0
        {
            return Err((
                "JOB_ACCOUNTING_FAILED",
                format!(
                    "querying Job Object peak commit failed with Windows error {}",
                    GetLastError()
                ),
            ));
        }
        Ok(limits.PeakJobMemoryUsed as u64)
    }

    unsafe fn peak_job_commit(job: HANDLE) -> Option<u64> {
        query_peak_job_commit(job).ok()
    }

    unsafe fn job_memory(job: HANDLE) -> JobMemorySample {
        let peak_job_commit_bytes = peak_job_commit(job);
        let Some(process_ids) = job_process_ids(job) else {
            return JobMemorySample {
                current_private_commit_bytes: None,
                peak_job_commit_bytes,
                process_count: None,
                accounting_complete: false,
            };
        };
        let mut current = 0u64;
        let mut complete = true;
        for process_id in &process_ids {
            let Ok(process_id) = u32::try_from(*process_id) else {
                complete = false;
                continue;
            };
            let process = Handle(OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                0,
                process_id,
            ));
            if process.0.is_null() {
                complete = false;
                continue;
            }
            let mut belongs_to_job = 0;
            if IsProcessInJob(process.0, job, &mut belongs_to_job) == 0 || belongs_to_job == 0 {
                complete = false;
                continue;
            }
            let mut counters: PROCESS_MEMORY_COUNTERS_EX = zeroed();
            counters.cb = size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
            if GetProcessMemoryInfo(
                process.0,
                (&mut counters as *mut PROCESS_MEMORY_COUNTERS_EX)
                    .cast::<PROCESS_MEMORY_COUNTERS>(),
                size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
            ) == 0
            {
                complete = false;
                continue;
            }
            let Some(updated) = current.checked_add(counters.PrivateUsage as u64) else {
                complete = false;
                continue;
            };
            current = updated;
        }
        JobMemorySample {
            current_private_commit_bytes: Some(current),
            peak_job_commit_bytes,
            process_count: Some(process_ids.len()),
            accounting_complete: complete,
        }
    }

    pub(super) fn zero_resident_receipt_allowed(
        root_was_verified_in_job: bool,
        active_process_zero_notification: bool,
        queried_process_count: Option<usize>,
        root_exit_observed: bool,
    ) -> bool {
        let tree_empty = active_process_zero_notification || queried_process_count == Some(0);
        tree_empty && (root_was_verified_in_job || root_exit_observed)
    }

    #[derive(Debug)]
    struct CleanupOutcome {
        hard_reported: bool,
        zero_resident_confirmed: bool,
        final_peak_job_commit_bytes: Option<u64>,
        final_peak_accounting_complete: bool,
        errors: Vec<SupervisorError>,
    }

    #[derive(Debug, Clone, Copy)]
    struct HardLimitEvidence {
        observed_job_commit_bytes: Option<u64>,
        configured_hard_limit_bytes: u64,
        source: &'static str,
    }

    fn emit_hard_limit(
        output: &ProtocolSink,
        evidence: HardLimitEvidence,
    ) -> Result<(), SupervisorError> {
        emit(output, json!({
            "type": "hard-limit",
            "jobCommitBytes": evidence.observed_job_commit_bytes,
            "configuredHardLimitBytes": evidence.configured_hard_limit_bytes,
            "source": evidence.source,
        }))
    }

    fn report_hard_limit(
        output: &ProtocolSink,
        hard_reported: &mut bool,
        observed_job_commit_bytes: Option<u64>,
        configured_hard_limit_bytes: u64,
        source: &'static str,
    ) -> Result<(), SupervisorError> {
        if *hard_reported {
            return Ok(());
        }
        *hard_reported = true;
        emit_hard_limit(
            output,
            HardLimitEvidence {
                observed_job_commit_bytes,
                configured_hard_limit_bytes,
                source,
            },
        )
    }

    fn record_hard_limit(
        hard_reported: &mut bool,
        pending_evidence: &mut Option<HardLimitEvidence>,
        evidence: HardLimitEvidence,
    ) {
        if *hard_reported {
            return;
        }
        *hard_reported = true;
        *pending_evidence = Some(evidence);
    }

    pub(super) fn final_peak_reaches_hard_trip(
        hard_trip: u64,
        final_peak_job_commit_bytes: Option<u64>,
    ) -> bool {
        hard_trip > 0
            && final_peak_job_commit_bytes.is_some_and(|peak| peak >= hard_trip)
    }

    pub(super) fn hard_trip_for_limit(hard_limit_bytes: u64) -> u64 {
        if hard_limit_bytes == 0 {
            return 0;
        }
        let whole_hundreds = hard_limit_bytes / 100;
        let remainder = hard_limit_bytes % 100;
        (whole_hundreds * 98 + remainder * 98 / 100).max(1)
    }

    fn poll_forwarder(forwarder: &mut Option<Forwarder>) -> ForwardResult {
        if forwarder
            .as_ref()
            .map_or(true, |forwarder| !forwarder.is_finished())
        {
            return Ok(());
        }
        match forwarder.take() {
            Some(forwarder) => forwarder.join_finished(),
            None => Ok(()),
        }
    }

    fn finish_forwarders_after_job_close(
        stdout_forward: Option<Forwarder>,
        stderr_forward: Option<Forwarder>,
        errors: &mut Vec<SupervisorError>,
    ) -> bool {
        let mut forwarders = [stdout_forward, stderr_forward];
        let mut all_stopped = true;
        let drain_deadline = Instant::now() + FORWARDER_DRAIN_TIMEOUT;
        while forwarders
            .iter()
            .flatten()
            .any(|forwarder| !forwarder.is_finished())
            && Instant::now() < drain_deadline
        {
            thread::sleep(Duration::from_millis(5));
        }

        for forwarder in forwarders.iter().flatten() {
            if !forwarder.is_finished() {
                if let Err(error) = forwarder.cancel_blocking_io() {
                    errors.push(error);
                }
            }
        }

        let cancel_deadline = Instant::now() + FORWARDER_CANCEL_TIMEOUT;
        while forwarders
            .iter()
            .flatten()
            .any(|forwarder| !forwarder.is_finished())
            && Instant::now() < cancel_deadline
        {
            thread::sleep(Duration::from_millis(5));
        }

        for forwarder in forwarders.into_iter().flatten() {
            if forwarder.is_finished() {
                if let Err(error) = forwarder.join_finished() {
                    errors.push(error);
                }
            } else {
                all_stopped = false;
                errors.push((
                    "STREAM_FORWARD_TIMEOUT",
                    format!(
                        "{} forwarding thread did not stop after Job Object close and I/O cancellation",
                        forwarder.stream
                    ),
                ));
                // Dropping JoinHandle detaches the still-stuck thread. Cleanup
                // remains bounded; process exit is the final containment backstop.
                drop(forwarder);
            }
        }
        all_stopped
    }

    pub(super) fn merge_supervision_and_cleanup(
        primary: Result<u32, SupervisorError>,
        mut cleanup_errors: Vec<SupervisorError>,
    ) -> Result<u32, SupervisorError> {
        if cleanup_errors.is_empty() {
            return primary;
        }
        match primary {
            Err((code, message)) => {
                let cleanup_detail = cleanup_errors
                    .iter()
                    .map(|(code, message)| format!("{code}: {message}"))
                    .collect::<Vec<_>>()
                    .join("; ");
                Err((
                    code,
                    format!("{message}; cleanup failures: {cleanup_detail}"),
                ))
            }
            Ok(target_code) => {
                let (code, message) = cleanup_errors.remove(0);
                if cleanup_errors.is_empty() {
                    Err((
                        code,
                        format!("target exited with code {target_code}; {message}"),
                    ))
                } else {
                    let additional_detail = cleanup_errors
                        .iter()
                        .map(|(code, message)| format!("{code}: {message}"))
                        .collect::<Vec<_>>()
                        .join("; ");
                    Err((
                        code,
                        format!(
                            "target exited with code {target_code}; {message}; additional cleanup failures: {additional_detail}"
                        ),
                    ))
                }
            }
        }
    }

    pub(super) fn normalize_terminal_code(
        target_code: u32,
        resource_exhausted: bool,
    ) -> u32 {
        if resource_exhausted {
            73
        } else {
            target_code
        }
    }

    pub(super) fn terminal_delivery_exit_code(
        intended_code: u32,
        resource_exhausted: bool,
        terminal_delivered: bool,
    ) -> u32 {
        if terminal_delivered || resource_exhausted {
            intended_code
        } else {
            PROTOCOL_DELIVERY_FAILED_EXIT_CODE
        }
    }

    unsafe fn cleanup_post_spawn(
        job: Handle,
        completion_port: HANDLE,
        process: HANDLE,
        process_in_job: bool,
        termination_sent: bool,
        exit_code: u32,
        hard_trip: u64,
        configured_hard_limit_bytes: u64,
        output: &ProtocolSink,
        child_control: Option<std::fs::File>,
        stdout_forward: Option<Forwarder>,
        stderr_forward: Option<Forwarder>,
        mut hard_reported: bool,
    ) -> CleanupOutcome {
        let mut errors = Vec::new();
        let mut pending_hard_limit = None;
        let job_handle = job.0;

        // Closing the parent copy of child stdin is the first cleanup action so
        // a cooperative target cannot remain blocked waiting for more control.
        drop(child_control);

        if !process_in_job && WaitForSingleObject(process, 0) != WAIT_OBJECT_0 {
            if TerminateProcess(process, exit_code) == 0 {
                errors.push((
                    "ROOT_TERMINATE_FAILED",
                    format!(
                        "terminating the unverified suspended root failed with Windows error {}",
                        GetLastError()
                    ),
                ));
            }
        }
        if !termination_sent {
            if let Err(error) = terminate_owned_job(job_handle, exit_code) {
                errors.push(error);
            }
        }

        let cleanup_deadline = Instant::now() + Duration::from_secs(5);
        let mut active_process_zero = false;
        let mut completion_port_usable = true;
        let mut process_wait_usable = true;
        let mut root_gone = false;
        let mut tree_gone = false;
        loop {
            if completion_port_usable {
                match drain_job_notifications(completion_port, job_handle) {
                    Ok(notifications) => {
                        active_process_zero |= notifications.active_process_zero;
                        if notifications.hard_limit_hit {
                            record_hard_limit(
                                &mut hard_reported,
                                &mut pending_hard_limit,
                                HardLimitEvidence {
                                    observed_job_commit_bytes: notifications
                                        .observed_job_commit_bytes
                                        .or_else(|| peak_job_commit(job_handle)),
                                    configured_hard_limit_bytes,
                                    source: "job-object-notification-during-cleanup",
                                },
                            );
                        }
                    }
                    Err(error) => {
                        errors.push(error);
                        completion_port_usable = false;
                    }
                }
            }

            tree_gone = active_process_zero
                || job_process_ids(job_handle).is_some_and(|process_ids| process_ids.is_empty());
            if process_in_job && tree_gone {
                root_gone = true;
            } else if process_wait_usable {
                match WaitForSingleObject(process, 0) {
                    WAIT_OBJECT_0 => root_gone = true,
                    WAIT_TIMEOUT => {}
                    WAIT_FAILED => {
                        errors.push((
                            "JOB_CLEANUP_FAILED",
                            format!(
                                "waiting for the root process during cleanup failed with Windows error {}",
                                GetLastError()
                            ),
                        ));
                        process_wait_usable = false;
                    }
                    unexpected => {
                        errors.push((
                            "JOB_CLEANUP_FAILED",
                            format!(
                                "root-process cleanup wait returned unexpected status {unexpected}"
                            ),
                        ));
                        process_wait_usable = false;
                    }
                }
            }

            if tree_gone && root_gone {
                break;
            }
            if Instant::now() >= cleanup_deadline {
                errors.push((
                    "JOB_CLEANUP_FAILED",
                    format!(
                        "owned process cleanup exceeded five seconds (rootGone={root_gone}, treeGone={tree_gone})"
                    ),
                ));
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }

        // Pick up anything that was queued between the last drain and the
        // process-list observation. Peak usage below provides the authoritative
        // committed-memory fallback if this zero-time drain still races.
        if completion_port_usable {
            match drain_job_notifications(completion_port, job_handle) {
                Ok(notifications) => {
                    if notifications.hard_limit_hit {
                        record_hard_limit(
                            &mut hard_reported,
                            &mut pending_hard_limit,
                            HardLimitEvidence {
                                observed_job_commit_bytes: notifications
                                    .observed_job_commit_bytes
                                    .or_else(|| peak_job_commit(job_handle)),
                                configured_hard_limit_bytes,
                                source: "job-object-notification-after-cleanup",
                            },
                        );
                    }
                }
                Err(error) => errors.push(error),
            }
        }

        let (final_peak_job_commit_bytes, final_peak_accounting_complete) =
            match query_peak_job_commit(job_handle) {
                Ok(peak) => (Some(peak), true),
                Err(error) => {
                    errors.push(error);
                    (None, false)
                }
            };
        if !hard_reported
            && final_peak_reaches_hard_trip(hard_trip, final_peak_job_commit_bytes)
        {
            record_hard_limit(
                &mut hard_reported,
                &mut pending_hard_limit,
                HardLimitEvidence {
                    observed_job_commit_bytes: final_peak_job_commit_bytes,
                    configured_hard_limit_bytes,
                    source: "job-object-final-peak",
                },
            );
        }
        // Peak accounting cannot reveal a single allocation refused by the
        // enforced cap when committed usage jumps from below `hard_trip` to
        // beyond the cap. Reliable classification of that case requires an
        // explicit worker OOM terminal signal in the runtime protocol.

        // Re-query at the exact receipt boundary. A prior ACTIVE_PROCESS_ZERO
        // notification is also irreversible: once a Job has no residents,
        // none remain that could add another process to it.
        let zero_resident_confirmed = zero_resident_receipt_allowed(
            process_in_job,
            active_process_zero,
            job_process_ids(job_handle).map(|process_ids| process_ids.len()),
            root_gone,
        );

        // Closing the Job Object before the final bounded forwarder wait makes
        // KILL_ON_JOB_CLOSE the last tree-containment backstop even when an
        // earlier TerminateJobObject call or cleanup observation failed.
        drop(job);
        let _ = finish_forwarders_after_job_close(
            stdout_forward,
            stderr_forward,
            &mut errors,
        );
        if let Some(evidence) = pending_hard_limit {
            if let Err(error) = emit_hard_limit(output, evidence) {
                errors.push(error);
            }
        }

        CleanupOutcome {
            hard_reported,
            zero_resident_confirmed,
            final_peak_job_commit_bytes,
            final_peak_accounting_complete,
            errors,
        }
    }

    pub fn run(options: Options) -> Result<u32, (&'static str, String)> {
        // The helper can be spawned before its parent assigns it to the outer
        // generation Job Object. It must remain inert until the parent proves
        // assignment and explicitly activates this exact protocol generation.
        // This wait happens before either the private Job Object or target
        // exists, so every activation failure is provably pre-tree.
        let control_input = start_control_input()?;
        control_input.wait_for_activation()?;
        unsafe {
            let protocol_writer = ProtocolWriter::start()?;
            let output = protocol_writer.sink();
            let job = Handle(CreateJobObjectW(null(), null()));
            if job.0.is_null() { return Err(("JOB_CREATE_FAILED", "CreateJobObjectW failed".into())); }

            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if options.hard_limit_bytes > 0 {
                limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
                limits.JobMemoryLimit = usize::try_from(options.hard_limit_bytes)
                    .map_err(|_| ("JOB_CONFIG_FAILED", "hard limit does not fit usize".into()))?;
            }
            if SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0 {
                return Err(("JOB_CONFIG_FAILED", "SetInformationJobObject failed".into()));
            }
            let hard_trip = hard_trip_for_limit(options.hard_limit_bytes);
            let completion_port = completion_port_for_job(job.0, hard_trip)?;

            let (stdout_read, stdout_write) = pipe()?;
            let (stderr_read, stderr_write) = pipe()?;
            let (child_stdin, child_stdin_write) = input_pipe()?;

            let command_line = std::iter::once(quote(&options.command))
                .chain(options.args.iter().map(|value| quote(value)))
                .collect::<Vec<_>>()
                .join(" ");
            if command_line.encode_utf16().count() + 1 > MAX_WINDOWS_COMMAND_LINE_UTF16 {
                return Err((
                    "MALFORMED_PROTOCOL",
                    format!(
                        "target command line exceeds the Windows {MAX_WINDOWS_COMMAND_LINE_UTF16}-UTF-16-unit limit"
                    ),
                ));
            }
            let mut command_line_wide = wide(OsStr::new(&command_line));
            let application = wide(OsStr::new(&options.command));
            let cwd_wide = wide(OsStr::new(&options.cwd));
            let mut environment = child_environment_block(&options.inherited_environment)?;
            let mut inherited_handles = [child_stdin.0, stdout_write.0, stderr_write.0];
            let mut job_list = [job.0];
            // PROC_THREAD_ATTRIBUTE_JOB_LIST assigns containment as part of
            // CreateProcess itself. This closes the crash window in which a
            // merely suspended but not-yet-assigned child could otherwise be
            // orphaned if the supervisor died between creation and assignment.
            let attributes =
                AttributeList::for_handles_and_job(&mut inherited_handles, &mut job_list)?;
            let mut startup: STARTUPINFOEXW = zeroed();
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = child_stdin.0;
            startup.StartupInfo.hStdOutput = stdout_write.0;
            startup.StartupInfo.hStdError = stderr_write.0;
            startup.lpAttributeList = attributes.pointer;
            let mut process_info: PROCESS_INFORMATION = zeroed();
            let created = CreateProcessW(
                application.as_ptr(), command_line_wide.as_mut_ptr(), null(), null(), 1,
                CREATE_SUSPENDED
                    | CREATE_NEW_PROCESS_GROUP
                    | CREATE_UNICODE_ENVIRONMENT
                    | EXTENDED_STARTUPINFO_PRESENT,
                environment.as_ptr().cast::<c_void>(), cwd_wide.as_ptr(),
                &startup.StartupInfo, &mut process_info,
            );
            // The target has its private OS-owned copy now. Erase the temporary
            // block immediately, including on CreateProcess failure.
            environment.fill(0);
            if created == 0 {
                return Err(("SPAWN_FAILED", "CreateProcessW failed".into()));
            }
            drop(attributes);
            let process = Handle(process_info.hProcess);
            let thread_handle = Handle(process_info.hThread);
            drop(stdout_write);
            drop(stderr_write);
            drop(child_stdin);
            let mut child_control = Some(into_file(child_stdin_write));
            let mut stdout_forward = None;
            let mut stderr_forward = None;
            let mut process_in_job = false;
            let mut hard_reported = false;
            let mut termination_sent = false;
            let mut requested_stop: Option<(bool, Instant)> = None;
            let mut stop_outcome: Option<&'static str> = None;
            // Once CreateProcessW succeeds, every ordinary failure becomes this
            // block's primary result. Nothing returns from `run` until the one
            // cleanup epilogue below has closed control input, made a bounded
            // tree-drain attempt, closed the owning Job Object, and either
            // joined each forwarder or recorded its cancellation timeout.
            let primary_result: Result<u32, SupervisorError> = 'supervision: {
                let mut belongs_to_job = 0;
                let assignment_query = IsProcessInJob(process.0, job.0, &mut belongs_to_job);
                if assignment_query == 0 || belongs_to_job == 0 {
                    let assignment_detail = if assignment_query == 0 {
                        format!("query failed with Windows error {}", GetLastError())
                    } else {
                        "query succeeded but reported that the process is not a member".into()
                    };
                    break 'supervision Err((
                        "JOB_ASSIGN_FAILED",
                        format!(
                            "CreateProcess did not atomically assign the suspended child to its Job Object ({assignment_detail})"
                        ),
                    ));
                }
                process_in_job = true;

                if ResumeThread(thread_handle.0) == u32::MAX {
                    break 'supervision Err((
                        "RESUME_FAILED",
                        format!(
                            "ResumeThread failed with Windows error {}",
                            GetLastError()
                        ),
                    ));
                }

                // The target may already have written into its kernel pipes,
                // but no forwarding thread exists yet. Emit `started` first so
                // target output can never overtake this lifecycle boundary.
                if let Err(error) = emit(
                    &output,
                    json!({ "type": "started", "pid": process_info.dwProcessId }),
                ) {
                    break 'supervision Err(error);
                }
                match forward(stdout_read, "stdout", output.clone()) {
                    Ok(forwarder) => stdout_forward = Some(forwarder),
                    Err(error) => break 'supervision Err(error),
                }
                match forward(stderr_read, "stderr", output.clone()) {
                    Ok(forwarder) => stderr_forward = Some(forwarder),
                    Err(error) => break 'supervision Err(error),
                }

                let mut soft_reported = false;
                let mut control_channel_open = true;
                loop {
                    if let Err(error) = poll_forwarder(&mut stdout_forward) {
                        break 'supervision Err(error);
                    }
                    if let Err(error) = poll_forwarder(&mut stderr_forward) {
                        break 'supervision Err(error);
                    }
                    match WaitForSingleObject(process.0, 250) {
                        WAIT_OBJECT_0 => break,
                        WAIT_TIMEOUT => {}
                        WAIT_FAILED => {
                            break 'supervision Err((
                                "WAIT_FAILED",
                                format!(
                                    "WaitForSingleObject failed with Windows error {}",
                                    GetLastError()
                                ),
                            ));
                        }
                        unexpected => {
                            break 'supervision Err((
                                "WAIT_FAILED",
                                format!(
                                    "WaitForSingleObject returned unexpected status {unexpected}"
                                ),
                            ));
                        }
                    }

                    let notifications = match drain_job_notifications(completion_port.0, job.0) {
                        Ok(notifications) => notifications,
                        Err(error) => break 'supervision Err(error),
                    };
                    if notifications.hard_limit_hit && !hard_reported {
                        if let Err(error) = report_hard_limit(
                            &output,
                            &mut hard_reported,
                            notifications
                                .observed_job_commit_bytes
                                .or_else(|| peak_job_commit(job.0)),
                            options.hard_limit_bytes,
                            "job-object-notification",
                        ) {
                            break 'supervision Err(error);
                        }
                        if !termination_sent {
                            match terminate_owned_job(job.0, 73) {
                                Ok(()) => termination_sent = true,
                                Err(error) => break 'supervision Err(error),
                            }
                        }
                    }

                    if control_channel_open {
                        match control_input.stop.try_recv() {
                            Ok(force) => {
                                requested_stop = Some((force, Instant::now()));
                                if force {
                                    if !termination_sent {
                                        match terminate_owned_job(job.0, 1) {
                                            Ok(()) => {
                                                termination_sent = true;
                                                stop_outcome = Some("forced");
                                            }
                                            Err(error) => break 'supervision Err(error),
                                        }
                                    }
                                } else {
                                    let cooperative_stop = child_control
                                        .as_mut()
                                        .is_some_and(|control| {
                                            control
                                                .write_all(b"{\"type\":\"stop\",\"force\":false}\n")
                                                .and_then(|_| control.flush())
                                                .is_ok()
                                        });
                                    let console_stop = !cooperative_stop
                                        && GenerateConsoleCtrlEvent(
                                            CTRL_BREAK_EVENT,
                                            process_info.dwProcessId,
                                        ) != 0;
                                    if cooperative_stop || console_stop {
                                        stop_outcome = Some("graceful");
                                    }
                                    if !cooperative_stop && !console_stop {
                                        if let Err(error) = emit(&output, json!({
                                            "type": "stop-escalated",
                                            "reason": "cooperative stdin and console stop delivery failed",
                                        })) {
                                            break 'supervision Err(error);
                                        }
                                        if !termination_sent {
                                            match terminate_owned_job(job.0, 1) {
                                                Ok(()) => {
                                                    termination_sent = true;
                                                    stop_outcome = Some("forced");
                                                }
                                                Err(error) => break 'supervision Err(error),
                                            }
                                        }
                                    }
                                }
                            }
                            Err(TryRecvError::Disconnected) => {
                                control_channel_open = false;
                                // A sender normally disconnects immediately after a
                                // valid stop command. Do not reinterpret that as a
                                // parent failure and bypass the configured grace
                                // window.
                                if requested_stop.is_none() {
                                    requested_stop = Some((true, Instant::now()));
                                    if !termination_sent {
                                        match terminate_owned_job(job.0, 1) {
                                            Ok(()) => {
                                                termination_sent = true;
                                                stop_outcome = Some("parent-disconnect");
                                            }
                                            Err(error) => break 'supervision Err(error),
                                        }
                                    }
                                }
                            }
                            Err(TryRecvError::Empty) => {}
                        }
                    }

                    if let Some((_, started)) = requested_stop {
                        if !termination_sent
                            && started.elapsed()
                                >= Duration::from_millis(options.graceful_timeout_ms)
                        {
                            match terminate_owned_job(job.0, 1) {
                                Ok(()) => {
                                    termination_sent = true;
                                    stop_outcome = Some("forced-after-grace");
                                }
                                Err(error) => break 'supervision Err(error),
                            }
                        }
                    }

                    let usage = job_memory(job.0);
                    if let Some(current) = usage.current_private_commit_bytes {
                        let system = system_commit();
                        if let Err(error) = emit_memory_sample(&output, json!({
                            "type": "memory",
                            "jobCommitBytes": current,
                            "peakJobCommitBytes": usage.peak_job_commit_bytes,
                            "processCount": usage.process_count,
                            "accountingComplete": usage.accounting_complete,
                            "systemCommitBytes": system.map(|value| value.0),
                            "systemCommitLimitBytes": system.map(|value| value.1),
                        })) {
                            break 'supervision Err(error);
                        }
                        if usage.accounting_complete
                            && options.soft_limit_bytes > 0
                            && current >= options.soft_limit_bytes
                            && !soft_reported
                        {
                            soft_reported = true;
                            if let Err(error) = emit(&output, json!({
                                "type": "soft-limit",
                                "jobCommitBytes": current,
                            })) {
                                break 'supervision Err(error);
                            }
                        } else if usage.accounting_complete
                            && soft_reported
                            && current < options.soft_limit_bytes.saturating_mul(9) / 10
                        {
                            soft_reported = false;
                        }
                        // Leave a small margin beneath the kernel-enforced Job
                        // memory ceiling. That makes the cause observable before
                        // a target allocation is refused.
                        if usage.accounting_complete
                            && hard_trip > 0
                            && current >= hard_trip
                            && !hard_reported
                        {
                            if let Err(error) = report_hard_limit(
                                &output,
                                &mut hard_reported,
                                Some(current),
                                options.hard_limit_bytes,
                                "job-accounting-sample",
                            ) {
                                break 'supervision Err(error);
                            }
                            if !termination_sent {
                                match terminate_owned_job(job.0, 73) {
                                    Ok(()) => termination_sent = true,
                                    Err(error) => break 'supervision Err(error),
                                }
                            }
                        }
                    }
                }

                let mut code = 1u32;
                if GetExitCodeProcess(process.0, &mut code) == 0 {
                    break 'supervision Err((
                        "EXIT_QUERY_FAILED",
                        format!(
                            "GetExitCodeProcess failed with Windows error {}",
                            GetLastError()
                        ),
                    ));
                }
                break 'supervision Ok(code);
            };

            let cleanup_exit_code = if hard_reported {
                73
            } else {
                match &primary_result {
                    Ok(code) => *code,
                    Err(_) => 1,
                }
            };
            let cleanup = cleanup_post_spawn(
                job,
                completion_port.0,
                process.0,
                process_in_job,
                termination_sent,
                cleanup_exit_code,
                hard_trip,
                options.hard_limit_bytes,
                &output,
                child_control.take(),
                stdout_forward.take(),
                stderr_forward.take(),
                hard_reported,
            );
            let resource_exhausted = cleanup.hard_reported;
            let zero_resident_confirmed = cleanup.zero_resident_confirmed;
            let final_peak_job_commit_bytes = cleanup.final_peak_job_commit_bytes;
            let final_peak_accounting_complete = cleanup.final_peak_accounting_complete;

            if resource_exhausted {
                let (target_exit_code, mut supervisor_errors) = match primary_result {
                    Ok(target_exit_code) => (Some(target_exit_code), Vec::new()),
                    Err((code, message)) => (
                        None,
                        vec![json!({ "code": code, "message": message })],
                    ),
                };
                supervisor_errors.extend(
                    cleanup
                        .errors
                        .into_iter()
                        .map(|(code, message)| json!({ "code": code, "message": message })),
                );
                let code = normalize_terminal_code(target_exit_code.unwrap_or(1), true);
                // Once exhaustion is proven, code 73 is the authoritative
                // process outcome even if stdout has disconnected. Ancillary
                // supervision/cleanup failures remain explicit in the event
                // whenever the protocol sink is still writable.
                let terminal_receipt = output
                    .emit_terminal(json!({
                        "type": "exit",
                        "code": code,
                        "rootPid": process_info.dwProcessId,
                        "targetExitCode": target_exit_code,
                        "signal": null,
                        "resourceExhausted": true,
                        "stopOutcome": stop_outcome,
                        "treeExitConfirmed": zero_resident_confirmed,
                        "peakJobCommitBytes": final_peak_job_commit_bytes,
                        "peakJobCommitAccountingComplete": final_peak_accounting_complete,
                        "supervisorErrors": supervisor_errors,
                    }))
                    .ok();
                let terminal_delivered = protocol_writer.finish(terminal_receipt);
                return Ok(terminal_delivery_exit_code(
                    code,
                    true,
                    terminal_delivered,
                ));
            }

            let target_exit_code = primary_result.as_ref().ok().copied();
            let cleanup_errors = cleanup.errors;
            let cleanup_error_values = cleanup_errors
                .iter()
                .map(|(code, message)| json!({ "code": code, "message": message }))
                .collect::<Vec<_>>();
            match merge_supervision_and_cleanup(primary_result, cleanup_errors) {
                Ok(target_exit_code) => {
                    let code = normalize_terminal_code(target_exit_code, false);
                    let terminal_receipt = output
                        .emit_terminal(json!({
                            "type": "exit",
                            "code": code,
                            "rootPid": process_info.dwProcessId,
                            "targetExitCode": target_exit_code,
                            "signal": null,
                            "resourceExhausted": resource_exhausted,
                            "stopOutcome": stop_outcome,
                            "treeExitConfirmed": zero_resident_confirmed,
                            "peakJobCommitBytes": final_peak_job_commit_bytes,
                            "peakJobCommitAccountingComplete": final_peak_accounting_complete,
                        }))
                        .ok();
                    let terminal_delivered = protocol_writer.finish(terminal_receipt);
                    Ok(terminal_delivery_exit_code(
                        code,
                        false,
                        terminal_delivered,
                    ))
                }
                Err((code, message)) => {
                    let terminal_receipt = output
                        .emit_terminal(json!({
                            "type": "error",
                            "code": code,
                            "message": message,
                            "supervisorExitCode": 1,
                            "rootPid": process_info.dwProcessId,
                            "targetExitCode": target_exit_code,
                            "signal": null,
                            "resourceExhausted": false,
                            "stopOutcome": stop_outcome,
                            "treeExitConfirmed": zero_resident_confirmed,
                            "peakJobCommitBytes": final_peak_job_commit_bytes,
                            "peakJobCommitAccountingComplete": final_peak_accounting_complete,
                            "cleanupErrors": cleanup_error_values,
                        }))
                        .ok();
                    let terminal_delivered = protocol_writer.finish(terminal_receipt);
                    Ok(terminal_delivery_exit_code(
                        1,
                        false,
                        terminal_delivered,
                    ))
                }
            }
        }
    }

    #[cfg(test)]
    mod protocol_queue_tests {
        use super::*;

        fn event(line: QueuedProtocolLine) -> serde_json::Value {
            serde_json::from_slice(&line.bytes)
                .expect("queued protocol line must remain valid NDJSON")
        }

        fn event_type(line: QueuedProtocolLine) -> String {
            let value = event(line);
            value["type"]
                .as_str()
                .expect("protocol event type")
                .to_string()
        }

        #[test]
        fn lifecycle_events_overtake_queued_logs_without_corrupting_ndjson() {
            let queue = Arc::new(ProtocolQueue::new());
            let sink = ProtocolSink {
                queue: Arc::clone(&queue),
            };
            assert!(sink
                .emit_log(json!({ "type": "stdout", "data": "queued log" }))
                .unwrap());
            sink.emit_lifecycle(json!({ "type": "soft-limit" }))
                .unwrap();

            assert_eq!(
                event_type(queue.next_line().unwrap().unwrap()),
                "soft-limit"
            );
            assert_eq!(
                event_type(queue.next_line().unwrap().unwrap()),
                "stdout"
            );
        }

        #[test]
        fn log_pressure_cannot_consume_terminal_queue_reserve() {
            let queue = Arc::new(ProtocolQueue::new());
            let sink = ProtocolSink {
                queue: Arc::clone(&queue),
            };
            let payload = "x".repeat(8 * 1024);
            let mut accepted = 0usize;
            loop {
                if !sink
                    .emit_log(json!({ "type": "stdout", "data": payload.as_str() }))
                    .unwrap()
                {
                    break;
                }
                accepted += 1;
                assert!(accepted <= MAX_PROTOCOL_QUEUE_ITEMS);
            }

            sink.emit_lifecycle(json!({ "type": "hard-limit" }))
                .unwrap();
            let _terminal_receipt = sink
                .emit_terminal(json!({ "type": "exit", "code": 73 }))
                .unwrap();
            assert!(sink
                .emit_lifecycle(json!({ "type": "soft-limit" }))
                .is_err());
            let state = queue.state.lock().unwrap();
            assert!(state.queued_bytes <= MAX_PROTOCOL_QUEUE_BYTES);
            assert!(state.queued_items() <= MAX_PROTOCOL_QUEUE_ITEMS);
            drop(state);
            queue.close();
            assert_eq!(
                event_type(queue.next_line().unwrap().unwrap()),
                "hard-limit"
            );
            let terminal = event(queue.next_line().unwrap().unwrap());
            assert_eq!(terminal["type"], "exit");
            assert!(terminal["droppedProtocolLogEvents"].as_u64().unwrap() > 0);
            assert!(terminal["droppedProtocolLogBytes"].as_u64().unwrap() > 0);
            assert!(queue.next_line().unwrap().is_none());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_requires_separator_and_command() {
        assert!(parse_options(Vec::<String>::new()).is_err());
        assert!(parse_options(["--".to_string()]).is_err());
    }

    #[test]
    fn limits_are_validated_without_inspecting_environment() {
        let result = parse_options([
            "--soft-limit-bytes",
            "200",
            "--hard-limit-bytes",
            "100",
            "--cwd",
            "C:\\trusted",
            "--",
            "cmd.exe",
        ]
        .into_iter()
        .map(str::to_string));
        assert_eq!(result.unwrap_err(), "soft limit must be lower than hard limit");
    }

    #[test]
    fn target_arguments_are_preserved() {
        let result = parse_options([
            "--soft-limit-bytes",
            "100",
            "--hard-limit-bytes",
            "200",
            "--cwd",
            "C:\\trusted",
            "--inherit-env",
            "SystemRoot",
            "--",
            "tool.exe",
            "a b",
        ]
        .into_iter()
        .map(str::to_string))
        .unwrap();
        assert_eq!(result.cwd, "C:\\trusted");
        assert_eq!(result.inherited_environment, vec!["SystemRoot"]);
        assert_eq!(result.command, "tool.exe");
        assert_eq!(result.args, vec!["a b"]);
    }

    #[test]
    fn cwd_and_environment_allowlist_are_fail_closed() {
        assert_eq!(
            parse_options(["--", "tool.exe"].into_iter().map(str::to_string)).unwrap_err(),
            "missing required --cwd"
        );
        assert_eq!(
            parse_options(
                [
                    "--cwd",
                    "C:\\trusted",
                    "--inherit-env",
                    "SECRET",
                    "--",
                    "tool.exe",
                ]
                .into_iter()
                .map(str::to_string)
            )
            .unwrap_err(),
            "inherited environment variable is outside the trusted policy"
        );
        assert!(parse_options(
            [
                "--cwd",
                "C:\\trusted",
                "--inherit-env",
                "SystemRoot",
                "--inherit-env",
                "systemroot",
                "--",
                "tool.exe",
            ]
            .into_iter()
            .map(str::to_string)
        )
        .is_err());
    }

    #[test]
    fn empty_and_nul_target_values_are_rejected() {
        assert!(parse_options(["--".to_string(), "".to_string()]).is_err());
        assert!(parse_options([
            "--".to_string(),
            "tool.exe".to_string(),
            "bad\0arg".to_string(),
        ])
        .is_err());
    }

    #[cfg(windows)]
    #[test]
    fn stream_read_errors_distinguish_retry_eof_and_failure() {
        use std::io::{Error, ErrorKind};
        use windows_runtime::StreamReadErrorDisposition::{EndOfStream, Fail, Retry};

        assert_eq!(
            windows_runtime::classify_stream_read_error(&Error::from(ErrorKind::Interrupted)),
            Retry
        );
        assert_eq!(
            windows_runtime::classify_stream_read_error(&Error::from(ErrorKind::BrokenPipe)),
            EndOfStream
        );
        assert_eq!(
            windows_runtime::classify_stream_read_error(&Error::new(
                ErrorKind::Other,
                "synthetic read failure",
            )),
            Fail
        );
    }

    #[cfg(windows)]
    #[test]
    fn cleanup_errors_append_without_replacing_the_primary_error() {
        let (code, message) = windows_runtime::merge_supervision_and_cleanup(
            Err(("PRIMARY_FAILURE", "primary detail".to_string())),
            vec![("JOB_CLEANUP_FAILED", "cleanup detail".to_string())],
        )
        .unwrap_err();

        assert_eq!(code, "PRIMARY_FAILURE");
        assert!(message.starts_with("primary detail"));
        assert!(message.contains("JOB_CLEANUP_FAILED: cleanup detail"));
    }

    #[cfg(windows)]
    #[test]
    fn forwarder_error_becomes_terminal_after_successful_supervision() {
        let (code, message) = windows_runtime::merge_supervision_and_cleanup(
            Ok(0),
            vec![("STREAM_FORWARD_FAILED", "stdout read failed".to_string())],
        )
        .unwrap_err();

        assert_eq!(code, "STREAM_FORWARD_FAILED");
        assert_eq!(message, "target exited with code 0; stdout read failed");
    }

    #[cfg(windows)]
    #[test]
    fn proven_resource_exhaustion_has_a_deterministic_nonzero_code() {
        assert_eq!(windows_runtime::normalize_terminal_code(0, true), 73);
        assert_eq!(windows_runtime::normalize_terminal_code(9, true), 73);
        assert_eq!(windows_runtime::normalize_terminal_code(9, false), 9);
    }

    #[cfg(windows)]
    #[test]
    fn missing_terminal_delivery_is_explicit_except_for_resource_exhaustion() {
        assert_eq!(
            windows_runtime::terminal_delivery_exit_code(0, false, false),
            74
        );
        assert_eq!(
            windows_runtime::terminal_delivery_exit_code(23, false, true),
            23
        );
        assert_eq!(
            windows_runtime::terminal_delivery_exit_code(73, true, false),
            73
        );
    }

    #[cfg(windows)]
    #[test]
    fn final_peak_fallback_uses_the_notification_threshold() {
        assert_eq!(windows_runtime::hard_trip_for_limit(0), 0);
        assert_eq!(windows_runtime::hard_trip_for_limit(100), 98);
        assert!(windows_runtime::hard_trip_for_limit(u64::MAX) > u64::MAX / 2);
        assert!(!windows_runtime::final_peak_reaches_hard_trip(0, Some(1_000)));
        assert!(!windows_runtime::final_peak_reaches_hard_trip(980, Some(979)));
        assert!(windows_runtime::final_peak_reaches_hard_trip(980, Some(980)));
        assert!(windows_runtime::final_peak_reaches_hard_trip(980, Some(1_000)));
        assert!(!windows_runtime::final_peak_reaches_hard_trip(980, None));
    }

    #[cfg(windows)]
    #[test]
    fn zero_resident_receipt_requires_exact_tree_and_root_evidence() {
        assert!(windows_runtime::zero_resident_receipt_allowed(
            true,
            true,
            None,
            false,
        ));
        assert!(windows_runtime::zero_resident_receipt_allowed(
            true,
            false,
            Some(0),
            false,
        ));
        assert!(windows_runtime::zero_resident_receipt_allowed(
            false,
            false,
            Some(0),
            true,
        ));
        assert!(!windows_runtime::zero_resident_receipt_allowed(
            true,
            false,
            None,
            true,
        ));
        assert!(!windows_runtime::zero_resident_receipt_allowed(
            false,
            true,
            Some(0),
            false,
        ));
    }

    #[cfg(windows)]
    #[test]
    fn stream_decoder_preserves_utf8_split_across_pipe_reads() {
        let expected = "before 🙂 after";
        let encoded = expected.as_bytes();
        let split = encoded
            .windows(4)
            .position(|window| window == "🙂".as_bytes())
            .expect("emoji bytes")
            + 2;
        let mut pending = Vec::new();
        let mut emitted = String::new();
        pending.extend_from_slice(&encoded[..split]);
        windows_runtime::drain_utf8(&mut pending, false, |text| emitted.push_str(&text));
        assert!(!pending.is_empty());
        pending.extend_from_slice(&encoded[split..]);
        windows_runtime::drain_utf8(&mut pending, true, |text| emitted.push_str(&text));
        assert_eq!(emitted, expected);
        assert!(pending.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn invalid_utf8_is_coalesced_into_one_bounded_log_event() {
        let mut pending = vec![0xff; 8 * 1024];
        let mut callbacks = 0usize;
        let mut replacements = 0usize;
        windows_runtime::drain_utf8(&mut pending, false, |text| {
            callbacks += 1;
            replacements += text.matches('\u{fffd}').count();
        });
        assert_eq!(callbacks, 1);
        assert_eq!(replacements, 8 * 1024);
        assert!(pending.is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn invalid_prefix_does_not_consume_an_incomplete_utf8_suffix() {
        let mut pending = vec![0xff, 0xf0, 0x9f];
        let mut emitted = String::new();
        windows_runtime::drain_utf8(&mut pending, false, |text| emitted.push_str(&text));
        assert_eq!(emitted, "\u{fffd}");
        assert_eq!(pending, vec![0xf0, 0x9f]);

        pending.extend_from_slice(&[0x99, 0x82]);
        windows_runtime::drain_utf8(&mut pending, true, |text| emitted.push_str(&text));
        assert_eq!(emitted, "\u{fffd}🙂");
        assert!(pending.is_empty());
    }
}
