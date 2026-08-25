#![cfg(windows)]

use breadboard_runtime_core::{
    ProcessExitClassification, ProcessOwnerEvent, ProcessOwnerLimits, ProcessOwnerPurpose,
    RunningProcessOwner, RuntimeGenerationGuard, RuntimePaths, TrustedProcessLaunch,
};
use std::ffi::OsString;
use std::fs;
use std::time::Duration;

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
    let (generation_guard, _prior_generation_drained) = RuntimeGenerationGuard::acquire(
        generation_scope,
        Duration::ZERO,
        Duration::from_secs(10),
    )
    .unwrap();
    let generation_membership = generation_guard.membership();
    let supervisor = paths
        .pin_runtime_file_for_launch(
            &paths.resolve_runtime("bin/runtime-supervisor.exe").unwrap(),
        )
        .unwrap();
    let target = paths
        .pin_runtime_file_for_launch(&paths.resolve_runtime("bin/finite-target.exe").unwrap())
        .unwrap();
    let cwd = paths
        .prepare_launch_directory("runtime/process-owner-test")
        .unwrap();
    let launch = TrustedProcessLaunch::new(
        ProcessOwnerPurpose::Service {
            service_id: "process_owner_test".into(),
            instance_id: "service_process_owner_test".into(),
        },
        supervisor,
        target,
        None,
        cwd,
        vec![OsString::from("--not-an-option")],
        ProcessOwnerLimits {
            soft_commit_bytes: 0,
            hard_commit_bytes: 0,
            graceful_shutdown: Duration::from_millis(500),
            supervisor_exit_timeout: Duration::from_secs(10),
        },
    )
    .unwrap();

    let mut owner = RunningProcessOwner::spawn(&generation_membership, launch).unwrap();
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
