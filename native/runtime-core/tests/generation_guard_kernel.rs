#[cfg(windows)]
use breadboard_runtime_core::{
    CurrentGenerationMembership, GenerationGuardError, RuntimeGenerationGuard, RuntimePaths,
};

#[cfg(windows)]
use std::env;
#[cfg(windows)]
use std::fs;
#[cfg(windows)]
use std::io::{BufRead, BufReader, Read, Write};
#[cfg(windows)]
use std::path::Path;
#[cfg(windows)]
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
#[cfg(windows)]
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
#[cfg(windows)]
use std::thread::{self, JoinHandle};
#[cfg(windows)]
use std::time::{Duration, Instant};

#[cfg(windows)]
const TEST_NAME: &str = "runtime_generation_guard_uses_real_cross_process_kernel_authority";
#[cfg(windows)]
const CHILD_MODE_ENV: &str = "BREADBOARD_TEST_GENERATION_GUARD_CHILD_MODE";
#[cfg(windows)]
const DATA_ROOT_ENV: &str = "BREADBOARD_TEST_GENERATION_GUARD_DATA_ROOT";
#[cfg(windows)]
const APP_ROOT_ENV: &str = "BREADBOARD_TEST_GENERATION_GUARD_APP_ROOT";
#[cfg(windows)]
const RUNTIME_ROOT_ENV: &str = "BREADBOARD_TEST_GENERATION_GUARD_RUNTIME_ROOT";
#[cfg(windows)]
const CHILD_START_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(windows)]
const CHILD_EXIT_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(windows)]
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
#[cfg(windows)]
const POLL_INTERVAL: Duration = Duration::from_millis(10);

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChildMode {
    Hold,
    HoldAfterAcquireThreadExit,
    ExpectBusy,
    AcquireOnce,
    InheritedProbe,
}

#[cfg(windows)]
impl ChildMode {
    fn as_env(self) -> &'static str {
        match self {
            Self::Hold => "hold",
            Self::HoldAfterAcquireThreadExit => "hold-after-acquire-thread-exit",
            Self::ExpectBusy => "expect-busy",
            Self::AcquireOnce => "acquire-once",
            Self::InheritedProbe => "inherited-probe",
        }
    }

    fn from_env(value: &str) -> Self {
        match value {
            "hold" => Self::Hold,
            "hold-after-acquire-thread-exit" => Self::HoldAfterAcquireThreadExit,
            "expect-busy" => Self::ExpectBusy,
            "acquire-once" => Self::AcquireOnce,
            "inherited-probe" => Self::InheritedProbe,
            other => panic!("unknown generation-guard child mode {other:?}"),
        }
    }
}

#[cfg(windows)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StreamKind {
    Stdout,
    Stderr,
}

#[cfg(windows)]
enum OutputEvent {
    Line(StreamKind, String),
    Eof(StreamKind),
    ReadError(StreamKind, String),
}

#[cfg(windows)]
struct ChildSession {
    label: &'static str,
    child: Child,
    stdin: Option<ChildStdin>,
    output: Receiver<OutputEvent>,
    readers: Vec<JoinHandle<()>>,
    transcript: Vec<String>,
    exited: bool,
}

#[cfg(windows)]
impl ChildSession {
    fn spawn(
        label: &'static str,
        mode: ChildMode,
        data_root: &Path,
        app_root: &Path,
        runtime_root: &Path,
    ) -> Self {
        let mut child = Command::new(env::current_exe().expect("resolve integration-test binary"))
            .arg("--exact")
            .arg(TEST_NAME)
            .arg("--nocapture")
            .arg("--test-threads=1")
            .env(CHILD_MODE_ENV, mode.as_env())
            .env(DATA_ROOT_ENV, data_root)
            .env(APP_ROOT_ENV, app_root)
            .env(RUNTIME_ROOT_ENV, runtime_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|error| panic!("spawn {label}: {error}"));

        let stdin = child.stdin.take().expect("child stdin must be piped");
        let stdout = child.stdout.take().expect("child stdout must be piped");
        let stderr = child.stderr.take().expect("child stderr must be piped");
        let (sender, output) = mpsc::channel();
        let stdout_sender = sender.clone();
        let stdout_reader = thread::spawn(move || {
            read_output(StreamKind::Stdout, stdout, stdout_sender);
        });
        let stderr_reader = thread::spawn(move || {
            read_output(StreamKind::Stderr, stderr, sender);
        });

        Self {
            label,
            child,
            stdin: Some(stdin),
            output,
            readers: vec![stdout_reader, stderr_reader],
            transcript: Vec::new(),
            exited: false,
        }
    }

    fn wait_for_stderr(&mut self, expected: &str, timeout: Duration) {
        let deadline = Instant::now()
            .checked_add(timeout)
            .expect("bounded child deadline");
        loop {
            let now = Instant::now();
            if now >= deadline {
                panic!(
                    "{} did not emit exact stderr marker {expected:?} before timeout; transcript:\n{}",
                    self.label,
                    self.transcript_text()
                );
            }
            let remaining = deadline.saturating_duration_since(now);
            match self.output.recv_timeout(remaining.min(POLL_INTERVAL)) {
                Ok(OutputEvent::Line(kind, line)) => {
                    self.transcript.push(format!("{kind:?}: {line}"));
                    if kind == StreamKind::Stderr && line == expected {
                        return;
                    }
                }
                Ok(OutputEvent::Eof(StreamKind::Stderr)) => {
                    self.transcript.push("Stderr: <EOF>".to_owned());
                    panic!(
                        "{} closed stderr before exact marker {expected:?}; transcript:\n{}",
                        self.label,
                        self.transcript_text()
                    );
                }
                Ok(OutputEvent::Eof(kind)) => {
                    self.transcript.push(format!("{kind:?}: <EOF>"));
                }
                Ok(OutputEvent::ReadError(kind, error)) => {
                    self.transcript
                        .push(format!("{kind:?}: <read error: {error}>"));
                }
                Err(RecvTimeoutError::Timeout) => match self.child.try_wait() {
                    Ok(Some(status)) => {
                        self.exited = true;
                        panic!(
                            "{} exited with {status} before exact marker {expected:?}; transcript:\n{}",
                            self.label,
                            self.transcript_text()
                        );
                    }
                    Ok(None) => {}
                    Err(error) => panic!("poll {} while awaiting marker: {error}", self.label),
                },
                Err(RecvTimeoutError::Disconnected) => {
                    panic!(
                        "{} disconnected before exact marker {expected:?}; transcript:\n{}",
                        self.label,
                        self.transcript_text()
                    );
                }
            }
        }
    }

    fn release(&mut self) {
        let mut stdin = self
            .stdin
            .take()
            .unwrap_or_else(|| panic!("{} stdin was already closed", self.label));
        stdin
            .write_all(b"RELEASE\n")
            .unwrap_or_else(|error| panic!("write release marker to {}: {error}", self.label));
        stdin
            .flush()
            .unwrap_or_else(|error| panic!("flush release marker to {}: {error}", self.label));
    }

    fn wait_for_success(&mut self, timeout: Duration) {
        let deadline = Instant::now()
            .checked_add(timeout)
            .expect("bounded child-exit deadline");
        let status = loop {
            match self.child.try_wait() {
                Ok(Some(status)) => {
                    self.exited = true;
                    break status;
                }
                Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                Ok(None) => {
                    panic!(
                        "{} did not exit before timeout; transcript:\n{}",
                        self.label,
                        self.transcript_text()
                    );
                }
                Err(error) => panic!("poll {} for exit: {error}", self.label),
            }
        };

        self.join_readers();
        self.drain_output();
        assert_success(self.label, status, &self.transcript);
    }

    fn join_readers(&mut self) {
        for reader in self.readers.drain(..) {
            let _ = reader.join();
        }
    }

    fn drain_output(&mut self) {
        while let Ok(event) = self.output.try_recv() {
            match event {
                OutputEvent::Line(kind, line) => {
                    self.transcript.push(format!("{kind:?}: {line}"));
                }
                OutputEvent::Eof(kind) => {
                    self.transcript.push(format!("{kind:?}: <EOF>"));
                }
                OutputEvent::ReadError(kind, error) => self
                    .transcript
                    .push(format!("{kind:?}: <read error: {error}>")),
            }
        }
    }

    fn transcript_text(&self) -> String {
        if self.transcript.is_empty() {
            "<empty>".to_owned()
        } else {
            self.transcript.join("\n")
        }
    }
}

#[cfg(windows)]
impl Drop for ChildSession {
    fn drop(&mut self) {
        self.stdin.take();
        if !self.exited {
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.exited = true;
        }
        self.join_readers();
        self.drain_output();
    }
}

#[cfg(windows)]
fn read_output(kind: StreamKind, stream: impl Read, sender: mpsc::Sender<OutputEvent>) {
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                let _ = sender.send(OutputEvent::Eof(kind));
                return;
            }
            Ok(_) => {
                while line.ends_with(['\n', '\r']) {
                    line.pop();
                }
                if sender.send(OutputEvent::Line(kind, line)).is_err() {
                    return;
                }
            }
            Err(error) => {
                let _ = sender.send(OutputEvent::ReadError(kind, error.to_string()));
                return;
            }
        }
    }
}

#[cfg(windows)]
fn assert_success(label: &str, status: ExitStatus, transcript: &[String]) {
    assert!(
        status.success(),
        "{label} failed with {status}; transcript:\n{}",
        if transcript.is_empty() {
            "<empty>".to_owned()
        } else {
            transcript.join("\n")
        }
    );
}

#[cfg(windows)]
fn assert_spawn_inherits_generation(
    membership: &CurrentGenerationMembership,
    paths: &RuntimePaths,
) {
    let mut probe = Command::new(env::current_exe().expect("resolve integration-test binary"))
        .arg("--exact")
        .arg(TEST_NAME)
        .arg("--nocapture")
        .arg("--test-threads=1")
        .env(CHILD_MODE_ENV, ChildMode::InheritedProbe.as_env())
        .env(DATA_ROOT_ENV, paths.data_root())
        .env(APP_ROOT_ENV, paths.app_root())
        .env(RUNTIME_ROOT_ENV, paths.runtime_root())
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn inherited-membership probe");
    assert!(
        membership
            .contains_child_process(&probe)
            .expect("query inherited child generation membership"),
        "a child must be born inside the generation job before any explicit assignment"
    );
    probe
        .stdin
        .take()
        .expect("probe stdin")
        .write_all(b"RELEASE\n")
        .expect("release inherited-membership probe");

    let deadline = Instant::now() + CHILD_EXIT_TIMEOUT;
    loop {
        match probe.try_wait() {
            Ok(Some(status)) => {
                assert!(
                    status.success(),
                    "inherited-membership probe failed: {status}"
                );
                break;
            }
            Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
            Ok(None) => {
                let _ = probe.kill();
                let _ = probe.wait();
                panic!("inherited-membership probe did not exit before timeout");
            }
            Err(error) => panic!("poll inherited-membership probe: {error}"),
        }
    }
}

#[cfg(windows)]
fn run_child(mode: ChildMode) {
    let data_root = env::var_os(DATA_ROOT_ENV).expect("child data-root environment");
    let app_root = env::var_os(APP_ROOT_ENV).expect("child app-root environment");
    let runtime_root = env::var_os(RUNTIME_ROOT_ENV).expect("child runtime-root environment");
    let paths = RuntimePaths::new(data_root, app_root, runtime_root)
        .expect("establish child RuntimePaths authority");

    match mode {
        ChildMode::ExpectBusy => match RuntimeGenerationGuard::acquire(
            paths.runtime_generation_scope(),
            Duration::ZERO,
            DRAIN_TIMEOUT,
        ) {
            Err(GenerationGuardError::OwnerBusy) => {
                eprintln!("OWNER_BUSY");
            }
            Err(error) => panic!("expected OwnerBusy, got {error:?}"),
            Ok(_) => panic!("competing child acquired an already-owned generation scope"),
        },
        ChildMode::AcquireOnce => {
            let (_guard, proof) = RuntimeGenerationGuard::acquire(
                paths.runtime_generation_scope(),
                Duration::ZERO,
                DRAIN_TIMEOUT,
            )
            .expect("fresh child must acquire generation scope");
            assert!(proof.matches_scope(&paths.runtime_generation_scope()));
            eprintln!("ACQUIRED");
        }
        ChildMode::Hold => {
            let (guard, proof) = RuntimeGenerationGuard::acquire(
                paths.runtime_generation_scope(),
                Duration::ZERO,
                DRAIN_TIMEOUT,
            )
            .expect("owner child must acquire generation scope");
            assert!(proof.matches_scope(&paths.runtime_generation_scope()));
            assert_spawn_inherits_generation(&guard.membership(), &paths);
            eprintln!("READY");
            std::io::stderr().flush().expect("flush READY marker");

            let mut command = String::new();
            std::io::stdin()
                .read_line(&mut command)
                .expect("read release marker");
            assert_eq!(command, "RELEASE\n", "unexpected parent command");
            eprintln!("RELEASED");
        }
        ChildMode::HoldAfterAcquireThreadExit => {
            let scope = paths.runtime_generation_scope();
            let acquiring_thread = thread::spawn(move || {
                let (_guard, proof) =
                    RuntimeGenerationGuard::acquire(scope.clone(), Duration::ZERO, DRAIN_TIMEOUT)
                        .expect("owner thread must acquire generation scope");
                assert!(proof.matches_scope(&scope));
            });
            acquiring_thread
                .join()
                .expect("generation acquiring thread must exit normally");
            eprintln!("READY_AFTER_ACQUIRE_THREAD_EXIT");
            std::io::stderr()
                .flush()
                .expect("flush thread-exit READY marker");

            let mut command = String::new();
            std::io::stdin()
                .read_line(&mut command)
                .expect("read release marker");
            assert_eq!(command, "RELEASE\n", "unexpected parent command");
            eprintln!("RELEASED");
        }
        ChildMode::InheritedProbe => {
            let mut command = String::new();
            std::io::stdin()
                .read_line(&mut command)
                .expect("read inherited-probe release marker");
            assert_eq!(command, "RELEASE\n", "unexpected probe command");
        }
    }
    std::io::stderr().flush().expect("flush child marker");
}

#[cfg(windows)]
#[test]
fn runtime_generation_guard_uses_real_cross_process_kernel_authority() {
    if let Some(mode) = env::var_os(CHILD_MODE_ENV) {
        run_child(ChildMode::from_env(&mode.to_string_lossy()));
        return;
    }

    let directory = tempfile::Builder::new()
        .prefix("breadboard-generation-kernel-")
        .tempdir()
        .expect("create generation-guard integration root");
    let data_a = directory.path().join("data-a");
    let data_b = directory.path().join("data-b");
    let app = directory.path().join("app");
    let runtime = directory.path().join("runtime");
    for root in [&data_a, &data_b, &app, &runtime] {
        fs::create_dir(root).expect("create integration root");
    }

    let paths_a = RuntimePaths::new(&data_a, &app, &runtime).expect("pin first data root");
    let same_paths_a = RuntimePaths::new(&data_a, &app, &runtime).expect("repin first data root");
    let paths_b = RuntimePaths::new(&data_b, &app, &runtime).expect("pin second data root");
    assert_eq!(
        paths_a.runtime_generation_scope(),
        same_paths_a.runtime_generation_scope()
    );
    assert_ne!(
        paths_a.runtime_generation_scope(),
        paths_b.runtime_generation_scope()
    );

    let mut owner_a = ChildSession::spawn(
        "first-scope owner",
        ChildMode::HoldAfterAcquireThreadExit,
        &data_a,
        &app,
        &runtime,
    );
    owner_a.wait_for_stderr("READY_AFTER_ACQUIRE_THREAD_EXIT", CHILD_START_TIMEOUT);

    let mut competing_a = ChildSession::spawn(
        "first-scope competitor",
        ChildMode::ExpectBusy,
        &data_a,
        &app,
        &runtime,
    );
    competing_a.wait_for_stderr("OWNER_BUSY", CHILD_START_TIMEOUT);
    competing_a.wait_for_success(CHILD_EXIT_TIMEOUT);

    let mut owner_b = ChildSession::spawn(
        "distinct-scope owner",
        ChildMode::Hold,
        &data_b,
        &app,
        &runtime,
    );
    owner_b.wait_for_stderr("READY", CHILD_START_TIMEOUT);

    owner_a.release();
    owner_a.wait_for_stderr("RELEASED", CHILD_EXIT_TIMEOUT);
    owner_a.wait_for_success(CHILD_EXIT_TIMEOUT);

    let mut successor_a = ChildSession::spawn(
        "first-scope successor",
        ChildMode::AcquireOnce,
        &data_a,
        &app,
        &runtime,
    );
    successor_a.wait_for_stderr("ACQUIRED", CHILD_START_TIMEOUT);
    successor_a.wait_for_success(CHILD_EXIT_TIMEOUT);

    owner_b.release();
    owner_b.wait_for_stderr("RELEASED", CHILD_EXIT_TIMEOUT);
    owner_b.wait_for_success(CHILD_EXIT_TIMEOUT);
}

#[cfg(not(windows))]
#[test]
fn runtime_generation_guard_kernel_integration_is_windows_only() {
    // The production guard deliberately reports UnsupportedPlatform elsewhere.
}
