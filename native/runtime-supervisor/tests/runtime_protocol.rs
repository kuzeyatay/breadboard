use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

fn helper() -> Command {
    Command::new(env!("CARGO_BIN_EXE_runtime-supervisor"))
}

fn events(output: &[u8]) -> Vec<Value> {
    assert!(
        output.is_empty() || output.ends_with(b"\n"),
        "supervisor stdout must end at an NDJSON record boundary"
    );
    std::str::from_utf8(output)
        .expect("supervisor stdout must be UTF-8 JSON")
        .lines()
        .map(|line| {
            assert!(!line.trim().is_empty(), "blank protocol line");
            serde_json::from_str(line).expect("every supervisor stdout line must be JSON")
        })
        .collect()
}

#[test]
fn malformed_options_are_a_structured_terminal_error() {
    let output = helper()
        .arg("--not-an-option")
        .output()
        .expect("run helper");
    assert_eq!(output.status.code(), Some(64));
    let parsed = events(&output.stdout);
    assert_eq!(parsed[0]["type"], "error");
    assert_eq!(parsed[0]["code"], "MALFORMED_PROTOCOL");
}

#[test]
fn post_spawn_failure_source_keeps_zero_resident_release_evidence() {
    let source = include_str!("../src/main.rs");
    for required_field in [
        "\"supervisorExitCode\": 1",
        "\"rootPid\": process_info.dwProcessId",
        "\"targetExitCode\": target_exit_code",
        "\"resourceExhausted\": false",
        "\"stopOutcome\": stop_outcome",
        "\"treeExitConfirmed\": zero_resident_confirmed",
        "\"peakJobCommitBytes\": final_peak_job_commit_bytes",
        "\"peakJobCommitAccountingComplete\": final_peak_accounting_complete",
        "\"cleanupErrors\": cleanup_error_values",
    ] {
        assert!(
            source.contains(required_field),
            "post-spawn failure terminal omitted {required_field}"
        );
    }
}

#[test]
fn activation_fence_precedes_private_job_and_target_creation_in_source() {
    let source = include_str!("../src/main.rs");
    let activated = source
        .find("control_input.wait_for_activation()?")
        .expect("activation fence");
    let private_job = source
        .find("let job = Handle(CreateJobObjectW")
        .expect("private Job Object creation");
    let target = source
        .find("let created = CreateProcessW")
        .expect("target creation");
    assert!(activated < private_job && private_job < target);
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Output};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    const ACTIVATION_RECORD: &[u8] = b"{\"type\":\"activate\",\"protocolVersion\":1}\n";

    fn powershell() -> PathBuf {
        PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    fn encode_powershell(source: &str) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes: Vec<u8> = source.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let mut result = String::new();
        for chunk in bytes.chunks(3) {
            let a = chunk[0];
            let b = *chunk.get(1).unwrap_or(&0);
            let c = *chunk.get(2).unwrap_or(&0);
            result.push(TABLE[(a >> 2) as usize] as char);
            result.push(TABLE[(((a & 3) << 4) | (b >> 4)) as usize] as char);
            result.push(if chunk.len() > 1 {
                TABLE[(((b & 15) << 2) | (c >> 6)) as usize] as char
            } else {
                '='
            });
            result.push(if chunk.len() > 2 {
                TABLE[(c & 63) as usize] as char
            } else {
                '='
            });
        }
        result
    }

    fn target(script: &str) -> Vec<String> {
        vec![
            "--cwd".into(),
            std::env::temp_dir().to_string_lossy().into_owned(),
            "--".into(),
            powershell().to_string_lossy().into_owned(),
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-EncodedCommand".into(),
            encode_powershell(script),
        ]
    }

    fn activate(child: &mut Child) {
        let stdin = child.stdin.as_mut().expect("helper stdin");
        stdin
            .write_all(ACTIVATION_RECORD)
            .and_then(|_| stdin.flush())
            .expect("activate helper");
    }

    fn activated_output(command: &mut Command) -> Output {
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        activate(&mut child);
        // Keep parent authority open until a finite target exits naturally.
        // `wait_with_output` would otherwise close Child::stdin first and turn
        // the successful activation into an immediate parent disconnect.
        let _runtime_parent = child.stdin.take().expect("helper stdin");
        child.wait_with_output().expect("run helper")
    }

    fn assert_activation_rejected(record: Option<&[u8]>, expected_code: &str) {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let marker = std::env::temp_dir().join(format!(
            "breadboard-supervisor-pre-activation-target-{unique}.txt"
        ));
        let marker_literal = marker.to_string_lossy().replace('\'', "''");
        let script = format!("Set-Content -LiteralPath '{marker_literal}' -Value 'target-started'");
        let mut child = helper()
            .args(target(&script))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        if let Some(record) = record {
            let stdin = child.stdin.as_mut().expect("helper stdin");
            // Oversized input can be rejected while this write is still in
            // progress, so BrokenPipe is an acceptable sender-side outcome.
            let _ = stdin.write_all(record).and_then(|_| stdin.flush());
        }
        drop(child.stdin.take());

        let output = child.wait_with_output().expect("wait for rejection");
        assert_eq!(output.status.code(), Some(1));
        let parsed = events(&output.stdout);
        assert_eq!(parsed.len(), 1, "unexpected pre-tree events: {parsed:#?}");
        assert_eq!(parsed[0]["type"], "error");
        assert_eq!(parsed[0]["code"], expected_code);
        assert!(
            !marker.exists(),
            "target ran despite rejected activation: {}",
            marker.display()
        );
        let _ = fs::remove_file(marker);
    }

    fn alive(pid: u32) -> bool {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code = 0;
            let result = GetExitCodeProcess(handle, &mut code) != 0 && code == STILL_ACTIVE as u32;
            CloseHandle(handle);
            result
        }
    }

    fn wait_for_pids(path: &Path, count: usize) -> Vec<u32> {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let pids = fs::read_to_string(path)
                .unwrap_or_default()
                .lines()
                .filter_map(|line| line.trim().parse().ok())
                .collect::<Vec<_>>();
            if pids.len() >= count {
                return pids;
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for fixture pids"
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn stdout_and_stderr_are_forwarded_as_json_lines() {
        let output = activated_output(helper().args(target(
            "[Console]::Out.WriteLine('hello-out'); [Console]::Error.WriteLine('hello-err')",
        )));
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let parsed = events(&output.stdout);
        assert_eq!(
            parsed.first().and_then(|event| event["type"].as_str()),
            Some("started")
        );
        let root_pid = parsed.first().and_then(|event| event["pid"].as_u64());
        assert!(parsed.iter().any(|event| event["type"] == "stdout"
            && event["data"].as_str().unwrap_or("").contains("hello-out")));
        assert!(parsed.iter().any(|event| event["type"] == "stderr"
            && event["data"].as_str().unwrap_or("").contains("hello-err")));
        assert!(parsed.iter().any(|event| {
            event["type"] == "exit"
                && event["treeExitConfirmed"] == true
                && event["rootPid"].as_u64() == root_pid
        }));
    }

    #[test]
    fn child_receives_only_the_fixed_trusted_environment() {
        let output = activated_output(
            helper()
            .env("BREADBOARD_SUPERVISOR_BLOCKED_TEST", "blocked")
            .args(target(
                "[Console]::Out.WriteLine(\"$env:SystemRoot|$env:BREADBOARD_SUPERVISOR_BLOCKED_TEST\")",
            )),
        );
        assert!(output.status.success());
        let parsed = events(&output.stdout);
        let data = parsed
            .iter()
            .filter(|event| event["type"] == "stdout")
            .filter_map(|event| event["data"].as_str())
            .find(|data| data.contains('|'))
            .expect("target environment output");
        let (system_root, blocked) = data.split_once('|').unwrap();
        assert!(!system_root.trim().is_empty());
        assert!(blocked.trim().is_empty());
    }

    #[test]
    fn excessive_stream_output_is_truncated_without_killing_the_service() {
        let output = activated_output(helper().args(target(
            "$chunk = 'x' * 8192; 1..140 | ForEach-Object { [Console]::Out.Write($chunk) }; exit 0",
        )));
        assert!(output.status.success());
        let parsed = events(&output.stdout);
        assert!(parsed.iter().any(|event| {
            event["type"] == "stream-truncated"
                && event["stream"] == "stdout"
                && event["limitBytes"] == 1024 * 1024
        }));
        assert!(parsed.iter().any(|event| event["type"] == "exit"));
    }

    #[test]
    fn unread_protocol_stdout_cannot_block_forced_tree_cleanup() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let marker =
            std::env::temp_dir().join(format!("breadboard-supervisor-unread-stdout-{unique}.txt"));
        let marker_literal = marker.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$chunk = 'x' * 8192; 1..200 | ForEach-Object {{ [Console]::Out.Write($chunk) }}; [Console]::Out.Flush(); Set-Content -LiteralPath '{marker_literal}' -Value 'ready'; Start-Sleep -Seconds 300"
        );
        let mut child = helper()
            .args(target(&script))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        activate(&mut child);

        // The marker is written only after the target has produced more output
        // than the supervisor's complete forwarding allowance. With helper
        // stdout deliberately unread, that proves protocol backpressure before
        // the forced stop is sent.
        let marker_deadline = Instant::now() + Duration::from_secs(15);
        while !marker.exists() {
            if Instant::now() >= marker_deadline {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&marker);
                panic!("target did not establish protocol-output pressure");
            }
            thread::sleep(Duration::from_millis(25));
        }
        thread::sleep(Duration::from_millis(250));
        writeln!(
            child.stdin.as_mut().expect("helper stdin"),
            "{{\"type\":\"stop\",\"force\":true}}"
        )
        .expect("write forced stop");

        let deadline = Instant::now() + Duration::from_secs(10);
        let status = loop {
            if let Some(status) = child.try_wait().expect("poll helper") {
                break status;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                let _ = fs::remove_file(&marker);
                panic!("supervisor remained blocked by unread protocol stdout");
            }
            thread::sleep(Duration::from_millis(25));
        };
        let _ = fs::remove_file(marker);
        assert_eq!(status.code(), Some(74));
    }

    #[test]
    fn malformed_control_input_does_not_bypass_a_forced_stop() {
        let mut child = helper()
            .args(target("Start-Sleep -Seconds 300"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        activate(&mut child);
        let stdin = child.stdin.as_mut().expect("helper stdin");
        writeln!(stdin, "not-json").expect("write malformed line");
        writeln!(stdin, "{{\"type\":\"stop\",\"force\":true}}").expect("write stop");
        let output = child.wait_with_output().expect("wait helper");
        assert!(matches!(output.status.code(), Some(0) | Some(1)));
        assert!(events(&output.stdout)
            .iter()
            .any(|event| event["type"] == "exit"));
    }

    #[test]
    fn graceful_stop_has_a_bounded_forced_fallback() {
        let mut child = helper()
            .args(["--graceful-timeout-ms", "200"])
            .args(target("Start-Sleep -Seconds 300"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        activate(&mut child);
        writeln!(
            child.stdin.as_mut().expect("helper stdin"),
            "{{\"type\":\"stop\",\"force\":false}}"
        )
        .expect("write stop");
        let started = Instant::now();
        let output = child.wait_with_output().expect("wait helper");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(events(&output.stdout)
            .iter()
            .any(|event| event["type"] == "exit"));
    }

    #[test]
    fn graceful_stop_is_forwarded_to_the_target_before_forcing() {
        let script = "$line = [Console]::In.ReadLine(); if ($line -eq '{\"type\":\"stop\",\"force\":false}') { [Console]::Out.WriteLine('graceful-stop-received'); exit 0 }; exit 9";
        let mut child = helper()
            .args(["--graceful-timeout-ms", "5000"])
            .args(target(script))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        child
            .stdin
            .as_mut()
            .expect("helper stdin")
            .write_all(
                b"{\"type\":\"activate\",\"protocolVersion\":1}\n{\"type\":\"stop\",\"force\":false}\n",
            )
            .expect("write activation and buffered stop");
        let started = Instant::now();
        let output = child.wait_with_output().expect("wait helper");
        assert!(output.status.success());
        assert!(started.elapsed() < Duration::from_secs(4));
        assert!(events(&output.stdout).iter().any(|event| {
            event["type"] == "stdout"
                && event["data"]
                    .as_str()
                    .unwrap_or("")
                    .contains("graceful-stop-received")
        }));
    }

    #[test]
    fn parent_disconnect_kills_parent_child_and_grandchild() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let pid_file = std::env::temp_dir().join(format!("breadboard-job-tree-{unique}.txt"));
        let literal = pid_file.to_string_lossy().replace('\'', "''");
        let grandchild =
            format!("Add-Content -LiteralPath '{literal}' -Value $PID; Start-Sleep -Seconds 300");
        let child = format!(
            "Add-Content -LiteralPath '{literal}' -Value $PID; Start-Process -FilePath $PSHOME\\powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','{}'); Start-Sleep -Seconds 300",
            encode_powershell(&grandchild),
        );
        let parent = format!(
            "Add-Content -LiteralPath '{literal}' -Value $PID; Start-Process -FilePath $PSHOME\\powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','{}'); Start-Sleep -Seconds 300",
            encode_powershell(&child),
        );
        let mut helper_child = helper()
            .args(target(&parent))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        activate(&mut helper_child);
        let pids = wait_for_pids(&pid_file, 3);
        assert!(pids.iter().all(|pid| alive(*pid)));
        drop(helper_child.stdin.take()); // Electron parent disconnected.
        let output = helper_child.wait_with_output().expect("wait helper");
        assert!(events(&output.stdout)
            .iter()
            .any(|event| { event["type"] == "exit" && event["treeExitConfirmed"] == true }));
        let deadline = Instant::now() + Duration::from_secs(10);
        while pids.iter().any(|pid| alive(*pid)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(
            pids.iter().all(|pid| !alive(*pid)),
            "a contained descendant survived: {pids:?}"
        );
        let _ = fs::remove_file(pid_file);
    }

    #[test]
    fn job_wide_hard_limit_is_reported_and_terminal() {
        let script = "$chunks = New-Object 'System.Collections.Generic.List[byte[]]'; while ($true) { $chunks.Add((New-Object byte[] (4MB))); Start-Sleep -Milliseconds 50 }";
        let mut child = helper()
            .args([
                "--soft-limit-bytes",
                "134217728",
                "--hard-limit-bytes",
                "201326592",
            ])
            .args(target(script))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn helper");
        activate(&mut child);
        // `Command::output` inherits the test runner's stdin, which may already
        // be at EOF and therefore truthfully means parent disconnect to the
        // supervisor. Keep an explicit parent pipe open while the Job Object
        // crosses both thresholds. Taking it out of `Child` prevents
        // `wait_with_output` from closing it before the supervised job exits.
        let _runtime_parent = child.stdin.take().expect("helper stdin");
        let output = child.wait_with_output().expect("run helper");
        let parsed = events(&output.stdout);
        assert!(
            parsed.iter().any(|event| event["type"] == "soft-limit"),
            "soft-limit event missing from supervisor protocol: {parsed:#?}"
        );
        assert!(parsed.iter().any(|event| event["type"] == "hard-limit"));
        assert!(parsed.iter().any(|event| {
            event["type"] == "exit"
                && event["code"] == 73
                && event["targetExitCode"].as_u64().is_some()
                && event["resourceExhausted"] == true
                && event["treeExitConfirmed"] == true
                && event["peakJobCommitAccountingComplete"] == true
        }));
        assert_eq!(output.status.code(), Some(73));
    }

    #[test]
    fn target_failure_is_reflected_in_the_helper_exit_status() {
        let output = activated_output(helper().args(target("exit 23")));
        assert_eq!(output.status.code(), Some(23));
        assert!(events(&output.stdout).iter().any(|event| {
            event["type"] == "exit"
                && event["code"] == 23
                && event["targetExitCode"] == 23
                && event["treeExitConfirmed"] == true
                && event["peakJobCommitAccountingComplete"] == true
        }));
    }

    #[test]
    fn activation_eof_exits_without_creating_a_target_tree() {
        assert_activation_rejected(None, "ACTIVATION_REQUIRED");
    }

    #[test]
    fn malformed_activation_exits_without_creating_a_target_tree() {
        assert_activation_rejected(Some(b"not-json\n"), "MALFORMED_ACTIVATION");
        assert_activation_rejected(
            Some(b"{\"type\":\"activate\",\"protocolVersion\":1}"),
            "MALFORMED_ACTIVATION",
        );
        assert_activation_rejected(
            Some(b"{\"type\":\"activate\",\"protocolVersion\":2}\n"),
            "MALFORMED_ACTIVATION",
        );
        assert_activation_rejected(
            Some(b"{\"type\":\"activate\",\"protocolVersion\":1,\"unexpected\":true}\n"),
            "MALFORMED_ACTIVATION",
        );
    }

    #[test]
    fn oversized_activation_exits_without_creating_a_target_tree() {
        let mut record = vec![b'x'; 257];
        record.push(b'\n');
        assert_activation_rejected(Some(&record), "ACTIVATION_TOO_LARGE");
    }
}
