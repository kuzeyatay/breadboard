use serde_json::Value;
use std::io::Write;
use std::process::{Command, Stdio};

fn helper() -> Command {
    Command::new(env!("CARGO_BIN_EXE_runtime-supervisor"))
}

fn events(output: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(output)
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

#[test]
fn malformed_options_are_a_structured_terminal_error() {
    let output = helper().arg("--not-an-option").output().expect("run helper");
    assert_eq!(output.status.code(), Some(64));
    let parsed = events(&output.stdout);
    assert_eq!(parsed[0]["type"], "error");
    assert_eq!(parsed[0]["code"], "MALFORMED_PROTOCOL");
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::fs;
    use std::os::windows::process::ExitStatusExt;
    use std::path::{Path, PathBuf};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    fn powershell() -> PathBuf {
        PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe")
    }

    fn encode_powershell(source: &str) -> String {
        const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let bytes: Vec<u8> = source.encode_utf16().flat_map(u16::to_le_bytes).collect();
        let mut result = String::new();
        for chunk in bytes.chunks(3) {
            let a = chunk[0];
            let b = *chunk.get(1).unwrap_or(&0);
            let c = *chunk.get(2).unwrap_or(&0);
            result.push(TABLE[(a >> 2) as usize] as char);
            result.push(TABLE[(((a & 3) << 4) | (b >> 4)) as usize] as char);
            result.push(if chunk.len() > 1 { TABLE[(((b & 15) << 2) | (c >> 6)) as usize] as char } else { '=' });
            result.push(if chunk.len() > 2 { TABLE[(c & 63) as usize] as char } else { '=' });
        }
        result
    }

    fn target(script: &str) -> Vec<String> {
        vec![
            "--".into(),
            powershell().to_string_lossy().into_owned(),
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-EncodedCommand".into(),
            encode_powershell(script),
        ]
    }

    fn alive(pid: u32) -> bool {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() { return false; }
            let mut code = 0;
            let result = GetExitCodeProcess(handle, &mut code) != 0 && code == STILL_ACTIVE;
            CloseHandle(handle);
            result
        }
    }

    fn wait_for_pids(path: &Path, count: usize) -> Vec<u32> {
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let pids = fs::read_to_string(path).unwrap_or_default()
                .lines().filter_map(|line| line.trim().parse().ok()).collect::<Vec<_>>();
            if pids.len() >= count { return pids; }
            assert!(Instant::now() < deadline, "timed out waiting for fixture pids");
            thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn stdout_and_stderr_are_forwarded_as_json_lines() {
        let output = helper().args(target(
            "[Console]::Out.WriteLine('hello-out'); [Console]::Error.WriteLine('hello-err')",
        )).output().expect("run helper");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let parsed = events(&output.stdout);
        assert!(parsed.iter().any(|event| event["type"] == "stdout" && event["data"].as_str().unwrap_or("").contains("hello-out")));
        assert!(parsed.iter().any(|event| event["type"] == "stderr" && event["data"].as_str().unwrap_or("").contains("hello-err")));
        assert!(parsed.iter().any(|event| event["type"] == "exit"));
    }

    #[test]
    fn malformed_control_input_does_not_bypass_a_forced_stop() {
        let mut child = helper().args(target("Start-Sleep -Seconds 300"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().expect("spawn helper");
        let stdin = child.stdin.as_mut().expect("helper stdin");
        writeln!(stdin, "not-json").expect("write malformed line");
        writeln!(stdin, "{{\"type\":\"stop\",\"force\":true}}").expect("write stop");
        let output = child.wait_with_output().expect("wait helper");
        assert!(output.status.success() || output.status.into_raw() == 1);
        assert!(events(&output.stdout).iter().any(|event| event["type"] == "exit"));
    }

    #[test]
    fn graceful_stop_has_a_bounded_forced_fallback() {
        let mut child = helper()
            .args(["--graceful-timeout-ms", "200"])
            .args(target("Start-Sleep -Seconds 300"))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().expect("spawn helper");
        writeln!(child.stdin.as_mut().expect("helper stdin"), "{{\"type\":\"stop\",\"force\":false}}")
            .expect("write stop");
        let started = Instant::now();
        let output = child.wait_with_output().expect("wait helper");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(events(&output.stdout).iter().any(|event| event["type"] == "exit"));
    }

    #[test]
    fn parent_disconnect_kills_parent_child_and_grandchild() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let pid_file = std::env::temp_dir().join(format!("breadboard-job-tree-{unique}.txt"));
        let literal = pid_file.to_string_lossy().replace(''', "''");
        let grandchild = format!("Add-Content -LiteralPath '{literal}' -Value $PID; Start-Sleep -Seconds 300");
        let child = format!(
            "Add-Content -LiteralPath '{literal}' -Value $PID; Start-Process -FilePath $PSHOME\\powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','{}'); Start-Sleep -Seconds 300",
            encode_powershell(&grandchild),
        );
        let parent = format!(
            "Add-Content -LiteralPath '{literal}' -Value $PID; Start-Process -FilePath $PSHOME\\powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand','{}'); Start-Sleep -Seconds 300",
            encode_powershell(&child),
        );
        let mut helper_child = helper().args(target(&parent))
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().expect("spawn helper");
        let pids = wait_for_pids(&pid_file, 3);
        assert!(pids.iter().all(|pid| alive(*pid)));
        drop(helper_child.stdin.take()); // Electron parent disconnected.
        let output = helper_child.wait_with_output().expect("wait helper");
        assert!(events(&output.stdout).iter().any(|event| event["type"] == "exit"));
        let deadline = Instant::now() + Duration::from_secs(10);
        while pids.iter().any(|pid| alive(*pid)) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(pids.iter().all(|pid| !alive(*pid)), "a contained descendant survived: {pids:?}");
        let _ = fs::remove_file(pid_file);
    }

    #[test]
    fn job_wide_hard_limit_is_reported_and_terminal() {
        let script = "$chunks = New-Object 'System.Collections.Generic.List[byte[]]'; while ($true) { $chunks.Add((New-Object byte[] (4MB))); Start-Sleep -Milliseconds 50 }";
        let output = helper()
            .args(["--soft-limit-bytes", "134217728", "--hard-limit-bytes", "201326592"])
            .args(target(script)).output().expect("run helper");
        let parsed = events(&output.stdout);
        assert!(parsed.iter().any(|event| event["type"] == "soft-limit"));
        assert!(parsed.iter().any(|event| event["type"] == "hard-limit"));
        assert!(parsed.iter().any(|event| event["type"] == "exit" && event["resourceExhausted"] == true));
    }
}
