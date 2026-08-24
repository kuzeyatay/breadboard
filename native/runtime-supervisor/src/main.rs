use serde::Serialize;
use std::env;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Options {
    soft_limit_bytes: u64,
    hard_limit_bytes: u64,
    graceful_timeout_ms: u64,
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
    let mut target = Vec::new();
    while let Some(value) = values.next() {
        match value.as_str() {
            "--soft-limit-bytes" => soft_limit_bytes = parse_u64(&value, values.next())?,
            "--hard-limit-bytes" => hard_limit_bytes = parse_u64(&value, values.next())?,
            "--graceful-timeout-ms" => graceful_timeout_ms = parse_u64(&value, values.next())?,
            "--" => {
                target.extend(values);
                break;
            }
            _ => return Err(format!("unknown option {value}")),
        }
    }
    let command = target.first().cloned().ok_or_else(|| "missing target command".to_string())?;
    if soft_limit_bytes > 0 && hard_limit_bytes > 0 && soft_limit_bytes >= hard_limit_bytes {
        return Err("soft limit must be lower than hard limit".to_string());
    }
    Ok(Options {
        soft_limit_bytes,
        hard_limit_bytes,
        graceful_timeout_ms: graceful_timeout_ms.clamp(100, 300_000),
        command,
        args: target.into_iter().skip(1).collect(),
    })
}

#[derive(Serialize)]
struct ErrorEvent<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    code: &'a str,
    message: &'a str,
}

fn main() {
    let options = match parse_options(env::args().skip(1)) {
        Ok(options) => options,
        Err(message) => {
            println!("{}", serde_json::to_string(&ErrorEvent {
                kind: "error",
                code: "MALFORMED_PROTOCOL",
                message: &message,
            }).expect("serialize error"));
            std::process::exit(64);
        }
    };

    #[cfg(windows)]
    if let Err((code, message)) = windows_runtime::run(options) {
        println!("{}", serde_json::to_string(&ErrorEvent {
            kind: "error",
            code,
            message: &message,
        }).expect("serialize error"));
        std::process::exit(1);
    }

    #[cfg(not(windows))]
    {
        let _ = options;
        println!("{}", serde_json::to_string(&ErrorEvent {
            kind: "error",
            code: "UNSUPPORTED_PLATFORM",
            message: "runtime-supervisor is a Windows-only containment helper",
        }).expect("serialize error"));
        std::process::exit(69);
    }
}

#[cfg(windows)]
mod windows_runtime {
    use super::Options;
    use serde_json::json;
    use std::ffi::{c_void, OsStr};
    use std::io::{BufRead, BufReader, Read};
    use std::mem::{size_of, zeroed};
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::FromRawHandle;
    use std::ptr::{null, null_mut};
    use std::sync::mpsc::{self, TryRecvError};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, WAIT_OBJECT_0};
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_GENERIC_WRITE,
        FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Console::{GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, QueryInformationJobObject,
        SetInformationJobObject, TerminateJobObject, JobObjectExtendedLimitInformation,
        JobObjectMemoryUsageInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOBOBJECT_MEMORY_USAGE_INFORMATION, JOB_OBJECT_LIMIT_JOB_MEMORY,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Pipes::CreatePipe;
    use windows_sys::Win32::System::ProcessStatus::{GetPerformanceInfo, PERFORMANCE_INFORMATION};
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, GetExitCodeProcess, ResumeThread, SetHandleInformation,
        WaitForSingleObject, CREATE_NEW_PROCESS_GROUP, CREATE_SUSPENDED, HANDLE_FLAG_INHERIT,
        PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
    };

    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() { unsafe { CloseHandle(self.0); } }
        }
    }

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(Some(0)).collect()
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

    fn emit(output: &Arc<Mutex<()>>, value: serde_json::Value) {
        let _guard = output.lock().expect("event output mutex poisoned");
        println!("{value}");
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

    fn forward(
        handle: Handle,
        stream: &'static str,
        output: Arc<Mutex<()>>,
    ) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            let mut file = unsafe { std::fs::File::from_raw_handle(handle.0 as _) };
            std::mem::forget(handle);
            let mut buffer = [0u8; 8192];
            loop {
                match file.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => emit(&output, json!({
                        "type": stream,
                        "data": String::from_utf8_lossy(&buffer[..count]),
                    })),
                }
            }
        });
    }

    unsafe fn system_commit() -> Option<(u64, u64)> {
        let mut info: PERFORMANCE_INFORMATION = zeroed();
        info.cb = size_of::<PERFORMANCE_INFORMATION>() as u32;
        if GetPerformanceInfo(&mut info, info.cb) == 0 { return None; }
        let page = info.PageSize as u64;
        Some((info.CommitTotal as u64 * page, info.CommitLimit as u64 * page))
    }

    pub fn run(options: Options) -> Result<(), (&'static str, String)> {
        unsafe {
            let output = Arc::new(Mutex::new(()));
            let job = Handle(CreateJobObjectW(null(), null()));
            if job.0.is_null() { return Err(("JOB_CREATE_FAILED", "CreateJobObjectW failed".into())); }

            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if options.hard_limit_bytes > 0 {
                limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
                limits.JobMemoryLimit = options.hard_limit_bytes as usize;
            }
            if SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0 {
                return Err(("JOB_CONFIG_FAILED", "SetInformationJobObject failed".into()));
            }

            let (stdout_read, stdout_write) = pipe()?;
            let (stderr_read, stderr_write) = pipe()?;
            let nul_path = wide(OsStr::new("NUL"));
            let child_stdin = Handle(CreateFileW(
                nul_path.as_ptr(), FILE_GENERIC_READ | FILE_GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE, null(), OPEN_EXISTING,
                FILE_ATTRIBUTE_NORMAL, null_mut(),
            ));
            if child_stdin.0.is_null() { return Err(("SPAWN_FAILED", "could not open NUL".into())); }

            let command_line = std::iter::once(quote(&options.command))
                .chain(options.args.iter().map(|value| quote(value)))
                .collect::<Vec<_>>()
                .join(" ");
            let mut command_line_wide = wide(OsStr::new(&command_line));
            let application = wide(OsStr::new(&options.command));
            let cwd = std::env::current_dir().map_err(|error| ("SPAWN_FAILED", error.to_string()))?;
            let cwd_wide = wide(cwd.as_os_str());
            let mut startup: STARTUPINFOW = zeroed();
            startup.cb = size_of::<STARTUPINFOW>() as u32;
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = child_stdin.0;
            startup.hStdOutput = stdout_write.0;
            startup.hStdError = stderr_write.0;
            let mut process_info: PROCESS_INFORMATION = zeroed();
            if CreateProcessW(
                application.as_ptr(), command_line_wide.as_mut_ptr(), null(), null(), 1,
                CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP, null(), cwd_wide.as_ptr(),
                &startup, &mut process_info,
            ) == 0 {
                return Err(("SPAWN_FAILED", "CreateProcessW failed".into()));
            }
            let process = Handle(process_info.hProcess);
            let thread_handle = Handle(process_info.hThread);
            if AssignProcessToJobObject(job.0, process.0) == 0 {
                TerminateJobObject(job.0, 1);
                return Err(("JOB_ASSIGN_FAILED", "AssignProcessToJobObject failed".into()));
            }
            if ResumeThread(thread_handle.0) == u32::MAX {
                TerminateJobObject(job.0, 1);
                return Err(("RESUME_FAILED", "ResumeThread failed".into()));
            }
            drop(stdout_write);
            drop(stderr_write);
            let stdout_forward = forward(stdout_read, "stdout", Arc::clone(&output));
            let stderr_forward = forward(stderr_read, "stderr", Arc::clone(&output));
            emit(&output, json!({ "type": "started", "pid": process_info.dwProcessId }));

            let (control_tx, control_rx) = mpsc::channel::<bool>();
            thread::spawn(move || {
                let stdin = std::io::stdin();
                for line in BufReader::new(stdin.lock()).lines() {
                    let Ok(line) = line else { break };
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
                    if value.get("type").and_then(|v| v.as_str()) == Some("stop") {
                        let _ = control_tx.send(value.get("force").and_then(|v| v.as_bool()).unwrap_or(false));
                        return;
                    }
                }
                let _ = control_tx.send(true); // Electron disconnected: close the job now.
            });

            let mut soft_reported = false;
            let mut hard_reported = false;
            let mut requested_stop: Option<(bool, Instant)> = None;
            loop {
                if WaitForSingleObject(process.0, 250) == WAIT_OBJECT_0 { break; }
                match control_rx.try_recv() {
                    Ok(force) => {
                        if force {
                            TerminateJobObject(job.0, 1);
                        } else {
                            let _ = GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, process_info.dwProcessId);
                            requested_stop = Some((false, Instant::now()));
                        }
                    }
                    Err(TryRecvError::Disconnected) => { TerminateJobObject(job.0, 1); }
                    Err(TryRecvError::Empty) => {}
                }
                if let Some((_, started)) = requested_stop {
                    if started.elapsed() >= Duration::from_millis(options.graceful_timeout_ms) {
                        TerminateJobObject(job.0, 1);
                    }
                }
                let mut usage: JOBOBJECT_MEMORY_USAGE_INFORMATION = zeroed();
                if QueryInformationJobObject(
                    job.0, JobObjectMemoryUsageInformation,
                    &mut usage as *mut _ as *mut c_void,
                    size_of::<JOBOBJECT_MEMORY_USAGE_INFORMATION>() as u32, null_mut(),
                ) != 0 {
                    let current = usage.JobMemory as u64;
                    let peak = usage.PeakJobMemoryUsed as u64;
                    let system = system_commit();
                    emit(&output, json!({
                        "type": "memory",
                        "jobCommitBytes": current,
                        "peakJobCommitBytes": peak,
                        "systemCommitBytes": system.map(|value| value.0),
                        "systemCommitLimitBytes": system.map(|value| value.1),
                    }));
                    if options.soft_limit_bytes > 0 && current >= options.soft_limit_bytes && !soft_reported {
                        soft_reported = true;
                        emit(&output, json!({ "type": "soft-limit", "jobCommitBytes": current }));
                    } else if soft_reported && current < options.soft_limit_bytes.saturating_mul(9) / 10 {
                        soft_reported = false;
                    }
                    // Leave a small margin beneath the kernel-enforced Job
                    // memory ceiling. That makes the cause observable before
                    // a target allocation is refused, so Electron can persist
                    // a terminal resource-exhaustion result and must not retry.
                    let hard_trip = options.hard_limit_bytes.saturating_mul(98) / 100;
                    if hard_trip > 0 && current >= hard_trip && !hard_reported {
                        hard_reported = true;
                        emit(&output, json!({
                            "type": "hard-limit",
                            "jobCommitBytes": current,
                            "configuredHardLimitBytes": options.hard_limit_bytes,
                        }));
                        TerminateJobObject(job.0, 73);
                    }
                }
            }
            let mut code = 1u32;
            GetExitCodeProcess(process.0, &mut code);
            // If a wrapper exits before one of its descendants, do not let the
            // descendant retain our inherited pipe handles or outlive the
            // service root. Closing those handles also lets the forwarding
            // threads drain deterministically before the final event.
            TerminateJobObject(job.0, code);
            let _ = stdout_forward.join();
            let _ = stderr_forward.join();
            emit(&output, json!({
                "type": "exit",
                "code": code,
                "signal": null,
                "resourceExhausted": hard_reported,
            }));
            Ok(())
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
            "--soft-limit-bytes", "200", "--hard-limit-bytes", "100", "--", "cmd.exe",
        ].into_iter().map(str::to_string));
        assert_eq!(result.unwrap_err(), "soft limit must be lower than hard limit");
    }

    #[test]
    fn target_arguments_are_preserved() {
        let result = parse_options([
            "--soft-limit-bytes", "100", "--hard-limit-bytes", "200", "--", "tool.exe", "a b",
        ].into_iter().map(str::to_string)).unwrap();
        assert_eq!(result.command, "tool.exe");
        assert_eq!(result.args, vec!["a b"]);
    }
}
