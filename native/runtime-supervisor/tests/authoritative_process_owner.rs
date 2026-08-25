#![cfg(windows)]

use breadboard_runtime_core::{
    ProcessExitClassification, ProcessOwnerError, ProcessOwnerEvent, Registry, RunningProcessOwner,
    RuntimeGenerationGuard, RuntimePaths, ServiceLaunchOutcome,
};
use breadboard_runtime_protocol::{
    ResourceClass, RestartPolicy, ServiceDefinition, ServiceManifest, ServiceStartupPolicy,
    WorkerManifest, SERVICE_MANIFEST_VERSION, WORKER_MANIFEST_VERSION,
};
use std::ffi::OsString;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, WAIT_FAILED, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    PROCESS_TERMINATE,
};

const OUTER_GENERATION_TEST_NAME: &str =
    "outer_generation_job_kills_the_helper_tree_when_the_runtime_is_terminated";
const OUTER_GENERATION_MODE_ENV: &str = "BREADBOARD_OUTER_GENERATION_TEST_MODE";
const OUTER_GENERATION_ROOT_ENV: &str = "BREADBOARD_OUTER_GENERATION_TEST_ROOT";
const OUTER_GENERATION_OWNER_MODE: &str = "owner";
const OUTER_GENERATION_SUCCESSOR_MODE: &str = "successor";
const OUTER_GENERATION_READY_PREFIX: &str = "BREADBOARD_OUTER_GENERATION_READY ";
const OUTER_GENERATION_SUCCESSOR_READY: &str = "BREADBOARD_OUTER_GENERATION_SUCCESSOR_READY";
const TEST_POLL_INTERVAL: Duration = Duration::from_millis(10);
const TEST_PROCESS_TIMEOUT: Duration = Duration::from_secs(10);
const PROCESS_SUSPEND_RESUME_ACCESS: u32 = 0x0800;
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

// Test-only causal-isolation primitive. Suspending the helper prevents its
// stdin-EOF thread from running after the runtime dies, so a signaled helper
// handle can only come from an external terminator: the outer generation Job
// Object in the passing path, or this test's exact-handle RAII cleanup.
#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtSuspendProcess(process_handle: HANDLE) -> i32;
    fn NtResumeProcess(process_handle: HANDLE) -> i32;
}

struct TestSubprocess {
    child: Child,
    lines: Receiver<String>,
    reader: Option<JoinHandle<()>>,
    observed: Vec<String>,
}

impl TestSubprocess {
    fn spawn(mode: &str, root: &Path) -> Self {
        let mut child = Command::new(std::env::current_exe().expect("current test executable"))
            .arg("--exact")
            .arg(OUTER_GENERATION_TEST_NAME)
            .arg("--nocapture")
            .arg("--test-threads=1")
            .env(OUTER_GENERATION_MODE_ENV, mode)
            .env(OUTER_GENERATION_ROOT_ENV, root)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn self-child test process");
        let stderr = child.stderr.take().expect("self-child marker pipe");
        let (sender, lines) = mpsc::channel();
        let reader = thread::Builder::new()
            .name(format!("outer-generation-{mode}-markers"))
            .spawn(move || {
                for line in BufReader::new(stderr).lines() {
                    let Ok(line) = line else { break };
                    if sender.send(line).is_err() {
                        break;
                    }
                }
            })
            .expect("start self-child stdout reader");
        Self {
            child,
            lines,
            reader: Some(reader),
            observed: Vec::new(),
        }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn wait_for_line<F>(&mut self, timeout: Duration, mut matches: F) -> Result<String, String>
    where
        F: FnMut(&str) -> bool,
    {
        let deadline = Instant::now() + timeout;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(format!(
                    "timed out waiting for subprocess marker; marker-pipe={:?}",
                    self.observed
                ));
            }
            match self.lines.recv_timeout(remaining) {
                Ok(line) => {
                    let matched = matches(&line);
                    self.observed.push(line.clone());
                    if matched {
                        return Ok(line);
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err(format!(
                        "timed out waiting for subprocess marker; marker-pipe={:?}",
                        self.observed
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(format!(
                        "subprocess exited before its marker; marker-pipe={:?}",
                        self.observed
                    ));
                }
            }
        }
    }

    fn wait_for_exit(&mut self, timeout: Duration) -> Result<ExitStatus, String> {
        let deadline = Instant::now() + timeout;
        loop {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    self.join_reader();
                    return Ok(status);
                }
                Ok(None) => {}
                Err(error) => return Err(format!("polling subprocess failed: {error}")),
            }
            if Instant::now() >= deadline {
                return Err(format!(
                    "subprocess {} did not exit before its deadline",
                    self.child.id()
                ));
            }
            thread::sleep(TEST_POLL_INTERVAL);
        }
    }

    fn terminate_and_wait(&mut self, timeout: Duration) -> Result<ExitStatus, String> {
        if self
            .child
            .try_wait()
            .map_err(|error| format!("polling subprocess before termination failed: {error}"))?
            .is_none()
        {
            self.child
                .kill()
                .map_err(|error| format!("terminating subprocess failed: {error}"))?;
        }
        self.wait_for_exit(timeout)
    }

    fn join_reader(&mut self) {
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        self.observed.extend(self.lines.try_iter());
    }
}

impl Drop for TestSubprocess {
    fn drop(&mut self) {
        let running = self.child.try_wait().ok().flatten().is_none();
        if running {
            let _ = self.child.kill();
            let deadline = Instant::now() + Duration::from_secs(5);
            while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                thread::sleep(TEST_POLL_INTERVAL);
            }
        }
        if self.child.try_wait().ok().flatten().is_some() {
            self.join_reader();
        }
    }
}

struct TrackedProcess {
    pid: u32,
    handle: HANDLE,
    suspended: bool,
}

impl TrackedProcess {
    fn open(pid: u32) -> Self {
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION
                    | PROCESS_TERMINATE
                    | PROCESS_SUSPEND_RESUME_ACCESS
                    | SYNCHRONIZE_ACCESS,
                0,
                pid,
            )
        };
        assert!(
            !handle.is_null(),
            "OpenProcess({pid}) failed with Windows error {}",
            unsafe { GetLastError() }
        );
        Self {
            pid,
            handle,
            suspended: false,
        }
    }

    fn has_exited(&self) -> Result<bool, String> {
        match unsafe { WaitForSingleObject(self.handle, 0) } {
            WAIT_OBJECT_0 => Ok(true),
            WAIT_TIMEOUT => Ok(false),
            WAIT_FAILED => Err(format!(
                "waiting for process {} failed with Windows error {}",
                self.pid,
                unsafe { GetLastError() }
            )),
            status => Err(format!(
                "waiting for process {} returned unexpected status {status}",
                self.pid
            )),
        }
    }

    fn suspend(&mut self) -> Result<(), String> {
        if self.suspended {
            return Err(format!("process {} was already suspended", self.pid));
        }
        if self.has_exited()? {
            return Err(format!("process {} exited before suspension", self.pid));
        }
        let status = unsafe { NtSuspendProcess(self.handle) };
        if status < 0 {
            return Err(format!(
                "NtSuspendProcess({}) failed with NTSTATUS 0x{:08x}",
                self.pid, status as u32
            ));
        }
        self.suspended = true;
        Ok(())
    }

    fn resume_for_cleanup(&mut self) {
        if !self.suspended {
            return;
        }
        let status = unsafe { NtResumeProcess(self.handle) };
        if status >= 0 {
            self.suspended = false;
        }
    }
}

impl Drop for TrackedProcess {
    fn drop(&mut self) {
        if self.has_exited() == Ok(false) {
            self.resume_for_cleanup();
            unsafe {
                let _ = TerminateProcess(self.handle, 1);
                let _ = WaitForSingleObject(self.handle, 5_000);
            }
        }
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

fn wait_for_processes_to_exit(processes: &[&TrackedProcess], timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if processes
            .iter()
            .all(|process| process.has_exited().unwrap_or(false))
        {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        thread::sleep(TEST_POLL_INTERVAL);
    }
}

fn generation_test_paths(root: &Path) -> (PathBuf, PathBuf, PathBuf) {
    (root.join("app"), root.join("data"), root.join("runtime"))
}

fn service_registry(service_id: &str, allowed_executable: &str) -> Registry {
    Registry::new(
        WorkerManifest {
            version: WORKER_MANIFEST_VERSION,
            workers: vec![],
        },
        ServiceManifest {
            version: SERVICE_MANIFEST_VERSION,
            services: vec![ServiceDefinition {
                id: service_id.into(),
                display_name: "Process owner test service".into(),
                capability_ids: vec!["process-owner-test".into()],
                allowed_executable: allowed_executable.into(),
                allowed_entrypoint: None,
                startup_policy: ServiceStartupPolicy::Eager,
                resource_class: ResourceClass::Core,
                dependencies: vec![],
                estimated_cold_start_commit_mb: 1,
                soft_commit_limit_mb: 0,
                hard_commit_limit_mb: 0,
                idle_ttl_ms: None,
                graceful_shutdown_ms: 500,
                restart_policy: RestartPolicy::Never,
            }],
        },
    )
    .unwrap()
}

fn write_pipe_marker(marker: &str) {
    let stderr = std::io::stderr();
    let mut stderr = stderr.lock();
    writeln!(stderr, "{marker}").expect("write self-child marker");
    stderr.flush().expect("flush self-child marker");
}

fn run_generation_owner_child(root: &Path) -> ! {
    let (app, data, runtime) = generation_test_paths(root);
    let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
    let generation_scope = paths.runtime_generation_scope();
    let (generation_guard, _prior_generation_drained) =
        RuntimeGenerationGuard::acquire(generation_scope, Duration::ZERO, TEST_PROCESS_TIMEOUT)
            .unwrap();
    let generation_membership = generation_guard.membership();
    let nested_cwd = data
        .join("runtime/services/outer_generation_test/outer_generation_owner_1")
        .into_os_string();
    let nested_command = runtime.join("bin/long-lived-target.exe").into_os_string();
    let launch = service_registry("outer_generation_test", "bin/long-lived-target.exe")
        .prepare_service_launch(
            &paths,
            "outer_generation_test",
            "outer_generation_owner_1",
            vec![
                OsString::from("--cwd"),
                nested_cwd,
                OsString::from("--"),
                nested_command,
            ],
        )
        .unwrap();
    let mut owner = match RunningProcessOwner::spawn_service(&generation_membership, launch) {
        ServiceLaunchOutcome::Running(owner) => owner,
        unexpected => panic!("service launch did not create its contained owner: {unexpected:?}"),
    };
    let target_pid = loop {
        match owner.read_event(TEST_PROCESS_TIMEOUT).unwrap() {
            ProcessOwnerEvent::Lifecycle(event)
                if event.get("type").and_then(|value| value.as_str()) == Some("started") =>
            {
                break event
                    .get("pid")
                    .and_then(|value| value.as_u64())
                    .and_then(|value| u32::try_from(value).ok())
                    .expect("started target pid");
            }
            ProcessOwnerEvent::Lifecycle(_) => {}
            unexpected => panic!("unexpected pre-start supervisor event: {unexpected:?}"),
        }
    };
    assert_eq!(owner.root_pid(), Some(target_pid));
    write_pipe_marker(&format!(
        "{OUTER_GENERATION_READY_PREFIX}runtimePid={} supervisorPid={} targetPid={target_pid}",
        std::process::id(),
        owner.supervisor_pid(),
    ));

    loop {
        std::hint::black_box((&generation_guard, &generation_membership, &owner));
        thread::park_timeout(Duration::from_secs(1));
    }
}

fn run_generation_successor_child(root: &Path) {
    let (app, data, runtime) = generation_test_paths(root);
    let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
    let generation_scope = paths.runtime_generation_scope();
    let (_generation_guard, _prior_generation_drained) = RuntimeGenerationGuard::acquire(
        generation_scope,
        Duration::from_secs(5),
        TEST_PROCESS_TIMEOUT,
    )
    .unwrap();
    write_pipe_marker(OUTER_GENERATION_SUCCESSOR_READY);
}

fn parse_generation_ready_marker(line: &str) -> (u32, u32, u32) {
    let fields = line
        .strip_prefix(OUTER_GENERATION_READY_PREFIX)
        .expect("outer-generation ready marker")
        .split_whitespace()
        .collect::<Vec<_>>();
    assert_eq!(fields.len(), 3, "malformed ready marker: {line}");
    let field = |index: usize, name: &str| {
        fields[index]
            .strip_prefix(name)
            .unwrap_or_else(|| panic!("malformed {name} field in marker: {line}"))
            .parse::<u32>()
            .unwrap_or_else(|_| panic!("invalid {name} field in marker: {line}"))
    };
    (
        field(0, "runtimePid="),
        field(1, "supervisorPid="),
        field(2, "targetPid="),
    )
}

#[test]
fn pinned_existing_supervisor_returns_a_bounded_zero_resident_exit_receipt() {
    let directory = tempfile::tempdir().unwrap();
    let app = directory.path().join("app");
    let data = directory.path().join("data");
    let runtime = directory.path().join("runtime");
    let bin = runtime.join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(&app).unwrap();
    fs::create_dir_all(&data).unwrap();

    let built_supervisor = env!("CARGO_BIN_EXE_runtime-supervisor");
    let pinned_supervisor_path = bin.join("runtime-supervisor.exe");
    let pinned_target_path = bin.join("finite-target.exe");
    fs::copy(built_supervisor, &pinned_supervisor_path).unwrap();
    fs::copy(built_supervisor, &pinned_target_path).unwrap();

    let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
    let generation_scope = paths.runtime_generation_scope();
    let (generation_guard, _prior_generation_drained) =
        RuntimeGenerationGuard::acquire(generation_scope, Duration::ZERO, Duration::from_secs(10))
            .unwrap();
    let generation_membership = generation_guard.membership();
    let registry = service_registry("process_owner_test", "bin/finite-target.exe");
    let foreign_data = directory.path().join("foreign-data");
    fs::create_dir_all(&foreign_data).unwrap();
    let foreign_paths = RuntimePaths::new(&foreign_data, &app, &runtime).unwrap();
    let foreign_request = registry
        .prepare_service_launch(
            &foreign_paths,
            "process_owner_test",
            "foreign_service_process_owner_test",
            vec![OsString::from("--not-an-option")],
        )
        .unwrap();
    assert!(matches!(
        RunningProcessOwner::spawn_service(&generation_membership, foreign_request),
        ServiceLaunchOutcome::NotCreated(ref denied)
            if matches!(denied.error(), ProcessOwnerError::GenerationScopeMismatch)
    ));
    assert!(!foreign_data
        .join("runtime/services/process_owner_test/foreign_service_process_owner_test")
        .exists());

    let launch = registry
        .prepare_service_launch(
            &paths,
            "process_owner_test",
            "service_process_owner_test",
            vec![OsString::from("--not-an-option")],
        )
        .unwrap();

    let mut owner = match RunningProcessOwner::spawn_service(&generation_membership, launch) {
        ServiceLaunchOutcome::Running(owner) => owner,
        unexpected => panic!("service launch did not create its contained owner: {unexpected:?}"),
    };
    let mut started_pid = None;
    let terminal = owner
        .wait_for_terminal(Duration::from_secs(10), |event| {
            if let ProcessOwnerEvent::Lifecycle(event) = event {
                if event.get("type").and_then(|value| value.as_str()) == Some("started") {
                    started_pid = event.get("pid").and_then(|value| value.as_u64());
                }
            }
        })
        .unwrap();
    assert!(started_pid.is_some());

    let exit = owner.confirm_exit(&terminal).unwrap();
    assert_eq!(exit.root_exit_code(), Some(64));
    assert_eq!(exit.classification(), ProcessExitClassification::TargetExit);
    assert!(exit.accounting().complete);
    assert!(owner.confirm_exit(&terminal).is_err());
    assert!(exit.into_completion_authority().is_err());
}

#[test]
fn outer_generation_job_kills_the_helper_tree_when_the_runtime_is_terminated() {
    if let Some(mode) = std::env::var_os(OUTER_GENERATION_MODE_ENV) {
        let root = PathBuf::from(
            std::env::var_os(OUTER_GENERATION_ROOT_ENV).expect("outer-generation self-child root"),
        );
        match mode.to_str().expect("UTF-8 outer-generation mode") {
            OUTER_GENERATION_OWNER_MODE => run_generation_owner_child(&root),
            OUTER_GENERATION_SUCCESSOR_MODE => run_generation_successor_child(&root),
            unexpected => panic!("unexpected outer-generation self-child mode: {unexpected}"),
        }
        return;
    }

    let directory = tempfile::tempdir().unwrap();
    let (app, data, runtime) = generation_test_paths(directory.path());
    let bin = runtime.join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(&app).unwrap();
    fs::create_dir_all(&data).unwrap();
    let built_supervisor = env!("CARGO_BIN_EXE_runtime-supervisor");
    fs::copy(built_supervisor, bin.join("runtime-supervisor.exe")).unwrap();
    // A second copy of the real supervisor is a deterministic long-lived
    // target: its options parse successfully, then it blocks awaiting its own
    // activation record. It creates no descendants before that activation.
    fs::copy(built_supervisor, bin.join("long-lived-target.exe")).unwrap();

    let mut runtime_child = TestSubprocess::spawn(OUTER_GENERATION_OWNER_MODE, directory.path());
    let runtime_child_pid = runtime_child.pid();
    let ready = runtime_child
        .wait_for_line(TEST_PROCESS_TIMEOUT, |line| {
            line.starts_with(OUTER_GENERATION_READY_PREFIX)
        })
        .unwrap();
    let (reported_runtime_pid, supervisor_pid, target_pid) = parse_generation_ready_marker(&ready);
    assert_eq!(reported_runtime_pid, runtime_child_pid);
    assert_ne!(supervisor_pid, target_pid);

    // Open stable process handles before killing the runtime. Cleanup uses
    // these handles, never a potentially reused PID, if an assertion fails.
    let mut supervisor = TrackedProcess::open(supervisor_pid);
    let target = TrackedProcess::open(target_pid);
    assert!(!supervisor.has_exited().unwrap(), "helper was not alive");
    assert!(!target.has_exited().unwrap(), "target was not alive");

    // Causal isolation: a suspended helper cannot execute its control-reader
    // EOF path when runtime termination closes stdin. If the outer generation
    // Job does not kill it, both this handle and its blocked target stay live.
    supervisor.suspend().unwrap();
    assert!(supervisor.suspended, "helper suspension was not retained");
    assert!(
        !supervisor.has_exited().unwrap(),
        "helper exited while establishing suspension"
    );
    assert!(
        !target.has_exited().unwrap(),
        "target exited while establishing helper suspension"
    );

    let runtime_status = runtime_child
        .terminate_and_wait(TEST_PROCESS_TIMEOUT)
        .unwrap();
    assert!(
        !runtime_status.success(),
        "forcibly terminated runtime unexpectedly reported success"
    );
    let drained_by_last_handle_close =
        wait_for_processes_to_exit(&[&supervisor, &target], TEST_PROCESS_TIMEOUT);

    // Always run the successor before asserting the close-driven drain. If the
    // assertion fails, successor acquisition explicitly drains the named outer
    // job; the stable process-handle guards are the final no-dangling fallback.
    let mut successor = TestSubprocess::spawn(OUTER_GENERATION_SUCCESSOR_MODE, directory.path());
    let successor_marker = successor.wait_for_line(TEST_PROCESS_TIMEOUT, |line| {
        line == OUTER_GENERATION_SUCCESSOR_READY
    });
    let successor_status = if successor_marker.is_ok() {
        successor.wait_for_exit(TEST_PROCESS_TIMEOUT)
    } else {
        successor.terminate_and_wait(TEST_PROCESS_TIMEOUT)
    };

    assert!(
        drained_by_last_handle_close,
        "outer generation Job Object did not terminate helper {supervisor_pid} and target {target_pid} after runtime {runtime_child_pid} exited"
    );
    assert!(
        target.has_exited().unwrap(),
        "target PID {target_pid} survived"
    );
    assert!(
        supervisor.has_exited().unwrap(),
        "helper PID {supervisor_pid} survived"
    );
    assert!(
        successor_marker.is_ok(),
        "successor did not acquire the same generation scope: {successor_marker:?}"
    );
    assert!(
        successor_status.as_ref().is_ok_and(ExitStatus::success),
        "successor generation process failed: {successor_status:?}"
    );
}
