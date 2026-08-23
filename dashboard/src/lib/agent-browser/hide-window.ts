// Keeping the agents' browser off the screen and out of the taskbar.
//
// Three approaches were tried against a live browser before this one.
//
// `--no-startup-window` starts the browser with no window, which sounds ideal
// and is not: with no window Chromium has nothing holding it open and exits
// while idle, so the bridge is gone before the first command arrives. The
// window is what keeps the process alive.
//
// Off-screen at -32000,-32000 keeps it alive and still leaves a button on the
// taskbar, pointing at a window past the edge of every display. Clicking it
// does nothing. A control that is visible and dead is worse than either
// extreme, which is what prompted this.
//
// `ShowWindow(hwnd, SW_HIDE)` is what actually removes it, and the browser
// keeps serving commands normally — a hidden window is still a real window to
// Chromium and to every site.
//
// The watcher matches on the profile directory rather than a process id.
// Chromium hands work between processes as it starts, so the pid Node spawned
// is not reliably the pid that ends up owning the window, and a watcher bound
// to the wrong one exits immediately having hidden nothing.
//
// Windows-only by nature; nothing here runs elsewhere.

import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { agentBrowserProfileDir } from "./browser-profile.ts";

const WATCHER_SOURCE = String.raw`param([string]$ProfileDir)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BbWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
}
"@

function Get-BrowserPids {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ProfileDir) } |
    ForEach-Object { [uint32]$_.ProcessId }
}

$started = Get-Date
while ($true) {
  $owners = @(Get-BrowserPids)
  if ($owners.Count -eq 0) {
    # Nothing yet, or nothing left. Give the browser time to appear at the
    # start; once it has been seen and is gone, this watcher is finished.
    if (((Get-Date) - $started).TotalSeconds -gt 30 -and $script:seen) { break }
    if (((Get-Date) - $started).TotalSeconds -gt 120) { break }
  } else {
    $script:seen = $true
    $set = @{}
    foreach ($owner in $owners) { $set[$owner] = $true }
    $callback = [BbWin+EnumProc]{
      param($handle, $lparam)
      $owner = [uint32]0
      [void][BbWin]::GetWindowThreadProcessId($handle, [ref]$owner)
      if ($set.ContainsKey($owner) -and [BbWin]::IsWindowVisible($handle)) {
        [void][BbWin]::ShowWindow($handle, 0)
      }
      return $true
    }
    [void][BbWin]::EnumWindows($callback, [IntPtr]::Zero)
  }
  # Tight at first, so the window the launch creates is gone before anyone
  # registers it; slower afterwards, since later windows appear only when
  # OpenCLI opens a tab and a moment's delay there costs nothing.
  if (((Get-Date) - $started).TotalSeconds -lt 30) {
    Start-Sleep -Milliseconds 150
  } else {
    Start-Sleep -Milliseconds 1500
  }
}
`;

/** Where the watcher script is kept. Beside the profile it belongs to. */
export function windowHiderScriptPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.dirname(agentBrowserProfileDir(env)), "hide-agent-browser.ps1");
}

/**
 * Hide the windows of the browser Breadboard opened for its own use.
 *
 * Best effort, like everything else on this path: a run whose browser stays
 * visible is a cosmetic problem, and taking the run down over it would be a
 * real one. Returns whether a watcher was started — which is only that the
 * spawn was accepted, since `spawn` reports failures asynchronously.
 */
export function hideBackgroundBrowser(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== "win32") return false;
  try {
    const script = windowHiderScriptPath(env);
    mkdirSync(path.dirname(script), { recursive: true });
    // Rewritten every time rather than cached: it is small, and a stale copy
    // from an older version would be invisible and hard to explain.
    writeFileSync(script, WATCHER_SOURCE, "utf8");
    // Not detached. A detached child is silently never started in some
    // sandboxed environments — measured here: the watcher's first line never
    // ran, while the identical command as an ordinary child ran fine. An
    // unreferenced ordinary child keeps running for as long as it is useful and
    // stops Node waiting on it, which is all this needs.
    const child = execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        agentBrowserProfileDir(env),
      ],
      { windowsHide: true },
      () => {
        /* the watcher ending is normal: it exits when the browser does */
      },
    );
    child.unref();
    return true;
  } catch {
    return false;
  }
}
