#![cfg(windows)]

use breadboard_runtime_core::{
    AdmissionPolicy, DashboardControlEnvironment, DurableServiceOutboxClaim,
    DurableServiceStartResult, JobStore, ProcessOwnerEvent, Registry, RetainedServiceStopProgress,
    RuntimeGenerationGuard, RuntimePaths, RuntimeSchedulerAuthority, ServiceEndpointMap,
    ServiceLaunchRetentionDisposition, SystemCommit, TrustedDirectoryPin, TrustedOsEnvironment,
    TrustedServiceEnvironment, TrustedServiceEnvironmentSet,
};
use breadboard_runtime_protocol::{
    ResourceClass, RestartPolicy, RuntimeMode, RuntimeServiceState, ServiceDefinition,
    ServiceExecutableAuthority, ServiceHttpReadiness, ServiceInstallProbe,
    ServiceInstallProbeAuthority, ServiceInstallProbeFile, ServiceLaunchArgument,
    ServiceLaunchProfile, ServiceManifest, ServiceRequirement, ServiceResourceLimits,
    ServiceStartupPolicy, ServiceWorkingDirectoryPolicy, TrustedServiceEnvironmentSource,
    WorkerManifest, SERVICE_MANIFEST_VERSION, WORKER_MANIFEST_VERSION,
};
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
const GUARDED_HOT_SHUTDOWN_TEST_NAME: &str =
    "guarded_hot_dashboard_normal_stop_does_not_queue_terminal_behind_memory_telemetry";
const GUARDED_HOT_SHUTDOWN_CHILD_ENV: &str = "BREADBOARD_GUARDED_HOT_SHUTDOWN_TEST_CHILD";
const SUPERVISION_LOST_TEST_NAME: &str =
    "a_lost_supervisor_still_proves_zero_residency_and_finalizes_one_service";
const SUPERVISION_LOST_CHILD_ENV: &str = "BREADBOARD_SUPERVISION_LOST_TEST_CHILD";
const TEST_POLL_INTERVAL: Duration = Duration::from_millis(10);
const TEST_PROCESS_TIMEOUT: Duration = Duration::from_secs(10);
const PROCESS_SUSPEND_RESUME_ACCESS: u32 = 0x0800;
const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;
const AUTHORITATIVE_DATABASE_RELATIVE_PATH: &str = "runtime-services.sqlite3";
const CHATMOCK_TEST_PORT: u16 = 43_120;
const DASHBOARD_TEST_PORT: u16 = 43_121;
const HERMES_TEST_PORT: u16 = 43_122;
const DASHBOARD_CONTROL_TEST_PORT: u16 = 43_123;
const GBRAIN_TEST_PORT: u16 = 43_124;
const COMFYUI_TEST_PORT: u16 = 43_125;
const TELEGRAM_GATEWAY_TEST_PORT: u16 = 43_126;
const WHATSAPP_GATEWAY_TEST_PORT: u16 = 43_127;
const TEST_CONTROL_TOKEN: &str = "runtime-v2-supervisor-control-test-token";
const TEST_NEXT_AUTH_SECRET: &str = "runtime-v2-next-auth-test-secret";
const TEST_GBRAIN_ADAPTER_SECRET: &str = "runtime-v2-gbrain-adapter-test-secret";
const TEST_HERMES_SESSION_TOKEN: &str = "runtime-v2-hermes-session-test-token";
const TEST_HERMES_TOOL_SECRET: &str = "runtime-v2-hermes-tool-test-secret";
const TEST_HERMES_CAPABILITY_SECRET: &str = "runtime-v2-hermes-capability-test-secret";

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

fn literal_service_arguments(arguments: &[&str]) -> Vec<ServiceLaunchArgument> {
    arguments
        .iter()
        .map(|value| ServiceLaunchArgument::Literal {
            value: (*value).into(),
        })
        .collect()
}

fn service_launch_profiles_with_limits(
    allowed_executable: &str,
    arguments: Vec<ServiceLaunchArgument>,
    environment_source: TrustedServiceEnvironmentSource,
    resource_limits: ServiceResourceLimits,
) -> Vec<ServiceLaunchProfile> {
    vec![ServiceLaunchProfile {
        modes: vec![RuntimeMode::Lean, RuntimeMode::Hot, RuntimeMode::Packaged],
        executable_authority: ServiceExecutableAuthority::RuntimeRoot,
        allowed_executable: allowed_executable.into(),
        arguments,
        environment_source,
        working_directory: ServiceWorkingDirectoryPolicy::AppRoot,
        install_probe: ServiceInstallProbe::FilesPresent {
            files: vec![ServiceInstallProbeFile {
                authority: ServiceInstallProbeAuthority::RuntimeRoot,
                path: allowed_executable.into(),
            }],
        },
        resource_limits,
    }]
}

fn service_registry(
    service_id: &str,
    allowed_executable: &str,
    arguments: Vec<ServiceLaunchArgument>,
    environment_source: TrustedServiceEnvironmentSource,
) -> Registry {
    service_registry_with_profile(
        service_id,
        allowed_executable,
        arguments,
        environment_source,
        RuntimeMode::Lean,
        ServiceResourceLimits {
            estimated_cold_start_commit_mb: 1,
            soft_commit_limit_mb: 256,
            hard_commit_limit_mb: 512,
        },
        500,
    )
}

fn service_registry_with_profile(
    service_id: &str,
    allowed_executable: &str,
    arguments: Vec<ServiceLaunchArgument>,
    environment_source: TrustedServiceEnvironmentSource,
    mode: RuntimeMode,
    resource_limits: ServiceResourceLimits,
    graceful_shutdown_ms: u64,
) -> Registry {
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
                requirement: ServiceRequirement::Required,
                launch_profiles: service_launch_profiles_with_limits(
                    allowed_executable,
                    arguments,
                    environment_source,
                    resource_limits,
                ),
                readiness: ServiceHttpReadiness {
                    path: "/health".into(),
                    expected_body_contains: None,
                    request_timeout_ms: 100,
                    poll_interval_ms: 100,
                    startup_timeout_ms: 1_000,
                },
                startup_policy: ServiceStartupPolicy::Eager,
                resource_class: ResourceClass::Core,
                dependencies: vec![],
                maximum_concurrent_leases: 1,
                maximum_lease_ms: 1_000,
                idle_ttl_ms: None,
                graceful_shutdown_ms,
                restart_policy: RestartPolicy::Never,
                restart_bounds: None,
            }],
        },
        mode,
    )
    .unwrap()
}

struct ServiceEnvironmentFixture {
    _config_root: TrustedDirectoryPin,
    endpoints: ServiceEndpointMap,
    environments: TrustedServiceEnvironmentSet,
}

impl ServiceEnvironmentFixture {
    fn new(root: &Path, paths: &RuntimePaths) -> Self {
        Self::new_for_mode(root, paths, RuntimeMode::Lean)
    }

    fn new_for_mode(root: &Path, paths: &RuntimePaths, mode: RuntimeMode) -> Self {
        let config_root_path = root.join("config");
        fs::create_dir_all(&config_root_path).unwrap();
        fs::write(
            config_root_path.join("desktop-config.json"),
            serde_json::to_vec(&serde_json::json!({
                "version": 2,
                "nextAuthSecret": TEST_NEXT_AUTH_SECRET,
                "gbrainMode": "preferred",
                "gbrainAdapterSecret": TEST_GBRAIN_ADAPTER_SECRET,
                "hermesSessionToken": TEST_HERMES_SESSION_TOKEN,
                "hermesToolSecret": TEST_HERMES_TOOL_SECRET,
                "hermesCapabilitySecret": TEST_HERMES_CAPABILITY_SECRET,
                "initialInviteCode": "BREAD0123456789"
            }))
            .unwrap(),
        )
        .unwrap();

        let config_root = TrustedDirectoryPin::pin_existing("configuration", config_root_path)
            .expect("pin integration-test configuration root");
        let endpoints = ServiceEndpointMap::new(
            [
                CHATMOCK_TEST_PORT,
                COMFYUI_TEST_PORT,
                DASHBOARD_TEST_PORT,
                GBRAIN_TEST_PORT,
                HERMES_TEST_PORT,
                TELEGRAM_GATEWAY_TEST_PORT,
                WHATSAPP_GATEWAY_TEST_PORT,
                43_128,
                43_129,
                43_130,
                43_131,
                43_132,
                43_133,
                43_134,
                43_135,
                43_136,
                43_137,
                43_138,
                43_139,
                43_140,
                43_141,
                43_142,
                43_143,
                43_144,
                43_145,
                43_146,
                43_147,
                43_148,
                43_149,
                43_150,
                43_151,
                43_152,
                43_158,
            ],
            [43_153, 43_154, 43_155, 43_156, 43_157],
        )
        .unwrap();
        let dashboard_control = DashboardControlEnvironment::new(
            format!("http://127.0.0.1:{DASHBOARD_CONTROL_TEST_PORT}"),
            TEST_CONTROL_TOKEN,
        )
        .unwrap();
        let os_environment = TrustedOsEnvironment::capture_electron_gated()
            .expect("capture the Electron-gated OS environment");
        let environments = TrustedServiceEnvironmentSet::load(
            mode,
            paths,
            &config_root,
            &endpoints,
            dashboard_control,
            os_environment,
        )
        .unwrap();

        Self {
            _config_root: config_root,
            endpoints,
            environments,
        }
    }

    fn mint_for_registry(
        &self,
        registry: &Registry,
        service_id: &str,
    ) -> (u16, TrustedServiceEnvironment) {
        self.mint_for_registry_in_mode(registry, service_id, RuntimeMode::Lean)
    }

    fn mint_for_registry_in_mode(
        &self,
        registry: &Registry,
        service_id: &str,
        mode: RuntimeMode,
    ) -> (u16, TrustedServiceEnvironment) {
        let launch_profile = registry
            .service(service_id)
            .unwrap()
            .launch_profile(mode)
            .expect("validated service launch profile for integration-test mode");
        let port = self
            .endpoints
            .port_for(launch_profile.environment_source)
            .get();
        let environment = self
            .environments
            .prepare_for_launch_profile(service_id, launch_profile)
            .unwrap();
        (port, environment)
    }
}

fn open_authoritative_store(paths: &RuntimePaths) -> JobStore {
    let database_path = paths
        .resolve_data(AUTHORITATIVE_DATABASE_RELATIVE_PATH)
        .unwrap();
    let database_pin = paths.pin_data_file_for_update(&database_path).unwrap();
    JobStore::open_authoritative(database_pin, paths.runtime_generation_scope()).unwrap()
}

fn mint_eager_start_claim(
    store: &JobStore,
    registry: &Registry,
    service_id: &str,
) -> DurableServiceOutboxClaim {
    let registration = registry.durable_service_registration(service_id).unwrap();
    let admission_profile = registry
        .durable_service_admission_profile(service_id)
        .unwrap();
    store.register_durable_service(&registration, 100).unwrap();
    assert_eq!(
        store
            .begin_eager_durable_service_start(
                &registration,
                &admission_profile,
                101,
                AdmissionPolicy::default(),
                || {
                    Ok(SystemCommit {
                        total_mb: 0,
                        limit_mb: 64 * 1024,
                    })
                },
            )
            .unwrap(),
        DurableServiceStartResult::Queued
    );
    store
        .claim_next_durable_service_intent(1_000, 102)
        .unwrap()
        .expect("eager service StartTree intent")
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
    let nested_cwd_path = data.join("runtime/targets/outer_generation_owner_1");
    fs::create_dir_all(&nested_cwd_path).unwrap();
    let nested_cwd = nested_cwd_path.to_string_lossy().into_owned();
    let nested_command = runtime
        .join("bin/long-lived-target.exe")
        .to_string_lossy()
        .into_owned();
    let registry = service_registry(
        "dashboard",
        "bin/long-lived-target.exe",
        literal_service_arguments(&["--cwd", &nested_cwd, "--", &nested_command]),
        TrustedServiceEnvironmentSource::Dashboard,
    );
    let environment_fixture = ServiceEnvironmentFixture::new(root, &paths);
    let store = open_authoritative_store(&paths);
    let start_claim = mint_eager_start_claim(&store, &registry, "dashboard");
    let (service_port, environment) = environment_fixture.mint_for_registry(&registry, "dashboard");
    let launch = registry
        .prepare_service_launch(
            &paths,
            &RuntimeSchedulerAuthority::from_current_generation(&generation_membership),
            "dashboard",
            service_port,
            environment,
            None,
        )
        .unwrap();
    assert_eq!(
        store
            .acknowledge_and_launch_durable_service_start(
                start_claim,
                103,
                &generation_membership,
                launch,
            )
            .unwrap(),
        ServiceLaunchRetentionDisposition::Retained
    );
    let target_pid = loop {
        match store
            .read_retained_durable_service_launch_event("dashboard", 1, TEST_PROCESS_TIMEOUT)
            .unwrap()
        {
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
    let (supervisor_pid, root_pid) = store
        .retained_durable_service_launch_pids("dashboard", 1)
        .unwrap();
    assert_eq!(root_pid, Some(target_pid));
    write_pipe_marker(&format!(
        "{OUTER_GENERATION_READY_PREFIX}runtimePid={} supervisorPid={} targetPid={target_pid}",
        std::process::id(),
        supervisor_pid,
    ));

    loop {
        std::hint::black_box((&generation_guard, &generation_membership, &store));
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
fn pinned_supervisor_returns_bounded_post_start_and_pre_start_exit_receipts() {
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
    let store = open_authoritative_store(&paths);
    let environment_fixture = ServiceEnvironmentFixture::new(directory.path(), &paths);
    let registry = service_registry(
        "dashboard",
        "bin/finite-target.exe",
        literal_service_arguments(&["--not-an-option"]),
        TrustedServiceEnvironmentSource::Dashboard,
    );
    let start_claim = mint_eager_start_claim(&store, &registry, "dashboard");
    let (service_port, environment) = environment_fixture.mint_for_registry(&registry, "dashboard");
    let launch = registry
        .prepare_service_launch(
            &paths,
            &RuntimeSchedulerAuthority::from_current_generation(&generation_membership),
            "dashboard",
            service_port,
            environment,
            None,
        )
        .unwrap();

    assert_eq!(
        store
            .acknowledge_and_launch_durable_service_start(
                start_claim,
                103,
                &generation_membership,
                launch,
            )
            .unwrap(),
        ServiceLaunchRetentionDisposition::Retained
    );
    let started = store
        .read_retained_durable_service_launch_event("dashboard", 1, Duration::from_secs(10))
        .unwrap();
    let ProcessOwnerEvent::Lifecycle(started) = started else {
        panic!("unexpected first supervisor event: {started:?}");
    };
    assert_eq!(
        started.get("type").and_then(|value| value.as_str()),
        Some("started")
    );
    assert!(started
        .get("pid")
        .and_then(|value| value.as_u64())
        .is_some());
    let terminal = loop {
        match store
            .read_retained_durable_service_launch_event("dashboard", 1, Duration::from_secs(10))
            .unwrap()
        {
            ProcessOwnerEvent::Terminal(terminal) => break terminal,
            ProcessOwnerEvent::Lifecycle(_) => {}
            unexpected => panic!("unexpected post-start supervisor event: {unexpected:?}"),
        }
    };
    let snapshot = store
        .confirm_and_finish_retained_durable_service_exit("dashboard", 1, &terminal, 104)
        .unwrap();
    assert_eq!(snapshot.status.state, RuntimeServiceState::Failed);
    assert_eq!(
        snapshot.status.last_error.as_deref(),
        Some("Service process exited unexpectedly")
    );

    // Generation ownership is deliberately process-lifetime. Exercise the
    // pre-CreateProcess failure in the same runtime generation instead of
    // attempting to mint a second guard in this test process.
    fs::write(bin.join("invalid-target.exe"), b"not a Windows executable").unwrap();
    let registry = service_registry(
        "chatmock",
        "bin/invalid-target.exe",
        vec![],
        TrustedServiceEnvironmentSource::Chatmock,
    );
    let start_claim = mint_eager_start_claim(&store, &registry, "chatmock");
    let (service_port, environment) = environment_fixture.mint_for_registry(&registry, "chatmock");
    let launch = registry
        .prepare_service_launch(
            &paths,
            &RuntimeSchedulerAuthority::from_current_generation(&generation_membership),
            "chatmock",
            service_port,
            environment,
            None,
        )
        .unwrap();

    assert_eq!(
        store
            .acknowledge_and_launch_durable_service_start(
                start_claim,
                103,
                &generation_membership,
                launch,
            )
            .unwrap(),
        ServiceLaunchRetentionDisposition::Retained
    );
    let terminal = match store
        .read_retained_durable_service_launch_event("chatmock", 1, Duration::from_secs(10))
        .unwrap()
    {
        ProcessOwnerEvent::Terminal(terminal) => terminal,
        unexpected => panic!("unexpected pre-start supervisor event: {unexpected:?}"),
    };
    let (_, root_pid) = store
        .retained_durable_service_launch_pids("chatmock", 1)
        .unwrap();
    assert_eq!(root_pid, None);
    assert_eq!(terminal.failure().unwrap().code(), "SPAWN_FAILED");

    let snapshot = store
        .confirm_and_finish_retained_durable_service_exit("chatmock", 1, &terminal, 104)
        .unwrap();
    assert_eq!(snapshot.status.state, RuntimeServiceState::Failed);
    assert_eq!(
        snapshot.status.last_error.as_deref(),
        Some("Service process tree supervision failed")
    );
}

#[test]
fn guarded_hot_dashboard_normal_stop_does_not_queue_terminal_behind_memory_telemetry() {
    if std::env::var_os(GUARDED_HOT_SHUTDOWN_CHILD_ENV).is_some() {
        run_guarded_hot_dashboard_normal_stop();
        return;
    }
    let status =
        Command::new(std::env::current_exe().expect("current integration-test executable"))
            .arg("--exact")
            .arg(GUARDED_HOT_SHUTDOWN_TEST_NAME)
            .arg("--nocapture")
            .arg("--test-threads=1")
            .env(GUARDED_HOT_SHUTDOWN_CHILD_ENV, "1")
            .status()
            .expect("spawn isolated guarded-Hot shutdown integration test");
    assert!(
        status.success(),
        "isolated guarded-Hot shutdown integration test failed with {status}"
    );
}

fn run_guarded_hot_dashboard_normal_stop() {
    let directory = tempfile::tempdir().unwrap();
    let app = directory.path().join("app");
    let data = directory.path().join("data");
    let runtime = directory.path().join("runtime");
    let bin = runtime.join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(&app).unwrap();
    fs::create_dir_all(&data).unwrap();

    let built_supervisor = env!("CARGO_BIN_EXE_runtime-supervisor");
    fs::copy(built_supervisor, bin.join("runtime-supervisor.exe")).unwrap();
    let system_root = PathBuf::from(std::env::var_os("SystemRoot").expect("Windows SystemRoot"));
    fs::copy(
        system_root.join("System32/ping.exe"),
        bin.join("guarded-target.exe"),
    )
    .unwrap();

    let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
    let generation_scope = paths.runtime_generation_scope();
    let (generation_guard, _prior_generation_drained) =
        RuntimeGenerationGuard::acquire(generation_scope, Duration::ZERO, TEST_PROCESS_TIMEOUT)
            .unwrap();
    let generation_membership = generation_guard.membership();
    let store = open_authoritative_store(&paths);
    let environment_fixture =
        ServiceEnvironmentFixture::new_for_mode(directory.path(), &paths, RuntimeMode::Hot);
    let registry = service_registry_with_profile(
        "dashboard",
        "bin/guarded-target.exe",
        literal_service_arguments(&["-t", "127.0.0.1"]),
        TrustedServiceEnvironmentSource::Dashboard,
        RuntimeMode::Hot,
        ServiceResourceLimits {
            estimated_cold_start_commit_mb: 1,
            soft_commit_limit_mb: 0,
            hard_commit_limit_mb: 64,
        },
        1_000,
    );
    let start_claim = mint_eager_start_claim(&store, &registry, "dashboard");
    let (service_port, environment) =
        environment_fixture.mint_for_registry_in_mode(&registry, "dashboard", RuntimeMode::Hot);
    let launch = registry
        .prepare_service_launch(
            &paths,
            &RuntimeSchedulerAuthority::from_current_generation(&generation_membership),
            "dashboard",
            service_port,
            environment,
            None,
        )
        .unwrap();
    assert_eq!(
        store
            .acknowledge_and_launch_durable_service_start(
                start_claim,
                103,
                &generation_membership,
                launch,
            )
            .unwrap(),
        ServiceLaunchRetentionDisposition::Retained
    );

    loop {
        match store
            .read_retained_durable_service_launch_event("dashboard", 1, TEST_PROCESS_TIMEOUT)
            .unwrap()
        {
            ProcessOwnerEvent::Lifecycle(event)
                if event.get("type").and_then(|value| value.as_str()) == Some("started") =>
            {
                break;
            }
            ProcessOwnerEvent::Lifecycle(_) => {}
            unexpected => panic!("unexpected guarded-dashboard startup event: {unexpected:?}"),
        }
    }

    assert_eq!(store.begin_durable_service_shutdown(104).unwrap(), 1);
    let stop_claim = store
        .claim_next_durable_service_intent(1_000, 105)
        .unwrap()
        .expect("Hot dashboard StopTree intent");
    let (_, stop_progress) = store
        .acknowledge_and_bind_retained_durable_service_stop(stop_claim, 106, false)
        .unwrap();
    assert_eq!(stop_progress, RetainedServiceStopProgress::Bound);

    // Match the service controller's 100 ms cadence. Before telemetry was
    // separated from the 25 ms system-commit guard, this consumer accumulated
    // roughly forty memory records during the one-second grace period and did
    // not reach the already-valid terminal until about four seconds later.
    let stop_started = Instant::now();
    let mut memory_events = 0_usize;
    let terminal = loop {
        let event = store
            .read_retained_durable_service_launch_event("dashboard", 1, TEST_PROCESS_TIMEOUT)
            .unwrap_or_else(|error| {
                panic!("guarded Hot dashboard process-owner event failed: {error:?}")
            });
        match event {
            ProcessOwnerEvent::Terminal(terminal) => break terminal,
            ProcessOwnerEvent::Lifecycle(event) => {
                if event.get("type").and_then(|value| value.as_str()) == Some("memory") {
                    memory_events += 1;
                }
            }
            unexpected => panic!("unexpected guarded-dashboard stop event: {unexpected:?}"),
        }
        thread::sleep(Duration::from_millis(100));
    };
    assert!(!terminal.resource_exhausted());
    assert!(terminal.failure().is_none());
    let snapshot = store
        .confirm_and_finish_retained_durable_service_exit("dashboard", 1, &terminal, 107)
        .unwrap_or_else(|error| {
            panic!("guarded Hot dashboard terminal confirmation failed: {error:?}")
        });
    let elapsed = stop_started.elapsed();

    assert_eq!(
        snapshot.status.state,
        RuntimeServiceState::AvailableButStopped
    );
    assert_eq!(snapshot.status.last_error, None);
    assert!(
        memory_events <= 12,
        "guarded stop emitted {memory_events} memory records before its terminal"
    );
    assert!(
        elapsed < Duration::from_secs(3),
        "guarded stop terminal remained backlogged for {elapsed:?}"
    );
}

#[test]
fn a_lost_supervisor_still_proves_zero_residency_and_finalizes_one_service() {
    if std::env::var_os(SUPERVISION_LOST_CHILD_ENV).is_some() {
        run_supervision_lost_is_finalized_from_the_job_kill();
        return;
    }
    let status =
        Command::new(std::env::current_exe().expect("current integration-test executable"))
            .arg("--exact")
            .arg(SUPERVISION_LOST_TEST_NAME)
            .arg("--nocapture")
            .arg("--test-threads=1")
            .env(SUPERVISION_LOST_CHILD_ENV, "1")
            .status()
            .expect("spawn isolated supervision-loss integration test");
    assert!(
        status.success(),
        "isolated supervision-loss integration test failed with {status}"
    );
}

/// Kills a live supervisor outright, the way commit exhaustion does, and shows
/// the two properties the containment path depends on: the target tree dies
/// with the supervisor's Job Object handle, and the durable generation can be
/// finalized from that kill alone. Before this path existed, the missing
/// receipt propagated as a fatal engine error and the whole runtime exited 70.
fn run_supervision_lost_is_finalized_from_the_job_kill() {
    let directory = tempfile::tempdir().unwrap();
    let app = directory.path().join("app");
    let data = directory.path().join("data");
    let runtime = directory.path().join("runtime");
    let bin = runtime.join("bin");
    fs::create_dir_all(&bin).unwrap();
    fs::create_dir_all(&app).unwrap();
    fs::create_dir_all(&data).unwrap();

    let built_supervisor = env!("CARGO_BIN_EXE_runtime-supervisor");
    fs::copy(built_supervisor, bin.join("runtime-supervisor.exe")).unwrap();
    let system_root = PathBuf::from(std::env::var_os("SystemRoot").expect("Windows SystemRoot"));
    fs::copy(
        system_root.join("System32/ping.exe"),
        bin.join("guarded-target.exe"),
    )
    .unwrap();

    let paths = RuntimePaths::new(&data, &app, &runtime).unwrap();
    let generation_scope = paths.runtime_generation_scope();
    let (generation_guard, _prior_generation_drained) =
        RuntimeGenerationGuard::acquire(generation_scope, Duration::ZERO, TEST_PROCESS_TIMEOUT)
            .unwrap();
    let generation_membership = generation_guard.membership();
    let store = open_authoritative_store(&paths);
    let environment_fixture =
        ServiceEnvironmentFixture::new_for_mode(directory.path(), &paths, RuntimeMode::Hot);
    let registry = service_registry_with_profile(
        "dashboard",
        "bin/guarded-target.exe",
        literal_service_arguments(&["-t", "127.0.0.1"]),
        TrustedServiceEnvironmentSource::Dashboard,
        RuntimeMode::Hot,
        ServiceResourceLimits {
            estimated_cold_start_commit_mb: 1,
            soft_commit_limit_mb: 0,
            hard_commit_limit_mb: 64,
        },
        1_000,
    );
    let start_claim = mint_eager_start_claim(&store, &registry, "dashboard");
    let (service_port, environment) =
        environment_fixture.mint_for_registry_in_mode(&registry, "dashboard", RuntimeMode::Hot);
    let launch = registry
        .prepare_service_launch(
            &paths,
            &RuntimeSchedulerAuthority::from_current_generation(&generation_membership),
            "dashboard",
            service_port,
            environment,
            None,
        )
        .unwrap();
    assert_eq!(
        store
            .acknowledge_and_launch_durable_service_start(
                start_claim,
                103,
                &generation_membership,
                launch,
            )
            .unwrap(),
        ServiceLaunchRetentionDisposition::Retained
    );

    loop {
        match store
            .read_retained_durable_service_launch_event("dashboard", 1, TEST_PROCESS_TIMEOUT)
            .unwrap()
        {
            ProcessOwnerEvent::Lifecycle(event)
                if event.get("type").and_then(|value| value.as_str()) == Some("started") =>
            {
                break;
            }
            ProcessOwnerEvent::Lifecycle(_) => {}
            unexpected => panic!("unexpected dashboard startup event: {unexpected:?}"),
        }
    }

    let (supervisor_pid, root_pid) = store
        .retained_durable_service_launch_pids("dashboard", 1)
        .unwrap();
    let root_pid = root_pid.expect("an accepted started boundary carries a root process id");
    assert_ne!(supervisor_pid, root_pid);
    let supervisor = TrackedProcess::open(supervisor_pid);
    let target = TrackedProcess::open(root_pid);
    assert_eq!(target.has_exited(), Ok(false));

    // Nothing cooperative: the supervisor is destroyed exactly as the OS
    // destroys it when the machine runs out of commit.
    assert_ne!(
        unsafe { TerminateProcess(supervisor.handle, 1) },
        0,
        "terminating supervisor {supervisor_pid} failed with Windows error {}",
        unsafe { GetLastError() }
    );
    assert!(
        wait_for_processes_to_exit(&[&supervisor, &target], TEST_PROCESS_TIMEOUT),
        "supervisor {supervisor_pid} died but its Job Object left target {root_pid} resident"
    );

    // The engine polls with a zero timeout, so reproduce that exactly: the
    // stream is gone, and it reports the loss rather than an ordinary wait.
    let deadline = Instant::now() + TEST_PROCESS_TIMEOUT;
    loop {
        match store.read_retained_durable_service_launch_event("dashboard", 1, Duration::ZERO) {
            Ok(ProcessOwnerEvent::Lifecycle(_)) => {}
            Ok(unexpected) => panic!("unexpected post-kill supervisor event: {unexpected:?}"),
            Err(error) => {
                assert!(
                    error
                        .to_string()
                        .contains("exited before a zero-resident receipt"),
                    "unexpected post-kill event error: {error:?}"
                );
                break;
            }
        }
        assert!(
            Instant::now() < deadline,
            "supervisor event stream never ended after {supervisor_pid} was terminated"
        );
        thread::sleep(TEST_POLL_INTERVAL);
    }

    let snapshot = store
        .finish_retained_durable_service_supervision_lost("dashboard", 1, 108)
        .unwrap_or_else(|error| panic!("supervision-lost finalization failed: {error:?}"));
    assert_eq!(snapshot.status.state, RuntimeServiceState::Failed);
    assert_eq!(
        snapshot.status.last_error.as_deref(),
        Some("Service process tree supervision failed")
    );

    // The authority is spent: a second finalization can never fabricate a
    // further exit for the same generation.
    assert!(store
        .finish_retained_durable_service_supervision_lost("dashboard", 1, 109)
        .is_err());
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
