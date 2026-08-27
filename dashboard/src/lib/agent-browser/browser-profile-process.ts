// Worker-only process ownership for Agent Reach's hidden OpenCLI bridge.
// Person-visible profile windows are owned by the dedicated Runtime V2
// agent-browser-profile job; Next routes must never import this module.

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  agentBrowserProfileDir,
  browserProfileMarkerPath,
  normalizeBrowserProfileStartUrl,
  resolveBrowserExecutable,
  signInWindow,
  type SignInWindow,
} from "./browser-profile.ts";
import { hideBackgroundBrowser } from "./hide-window.ts";
import {
  installedOpenCliExtension,
  openCliExtensionArgs,
} from "./opencli-extension.ts";

function openBackgroundBridgeWindow(env: NodeJS.ProcessEnv): SignInWindow {
  const startUrl = normalizeBrowserProfileStartUrl("https://example.com/");
  const executable = resolveBrowserExecutable(env);
  if (!executable) throw new Error("browser_not_found");
  const directory = agentBrowserProfileDir(env);
  mkdirSync(directory, { recursive: true });
  const extension = installedOpenCliExtension(env);
  const child = spawn(
    executable,
    [
      `--user-data-dir=${directory}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...(extension ? openCliExtensionArgs(extension.path) : []),
      ...(startUrl ? [startUrl] : []),
    ],
    // This helper is imported only by a disposable Runtime worker. Keeping the
    // browser attached lets Rust's Job Object remain the final tree reaper.
    { detached: false, stdio: "ignore", windowsHide: false },
  );
  if (typeof child.pid !== "number") throw new Error("browser_launch_failed");
  const state: SignInWindow = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    executable,
    background: true,
  };
  hideBackgroundBrowser(env);
  try {
    writeFileSync(browserProfileMarkerPath(env), JSON.stringify(state), "utf8");
  } catch (error) {
    try { child.kill(); } catch { /* already gone */ }
    throw error;
  }
  return state;
}

/** Ensure Agent Reach has an extension-backed browser while its Runtime job runs. */
export function ensureBridgeWindow(env: NodeJS.ProcessEnv = process.env): {
  window: SignInWindow | null;
  opened: boolean;
} {
  const existing = signInWindow(env);
  if (existing) return { window: existing, opened: false };
  if (!installedOpenCliExtension(env)) return { window: null, opened: false };
  try {
    return { window: openBackgroundBridgeWindow(env), opened: true };
  } catch {
    return { window: null, opened: false };
  }
}

/** Ask only a background bridge created by this Runtime worker to close. */
export function closeBridgeWindow(env: NodeJS.ProcessEnv = process.env): void {
  const current = signInWindow(env);
  if (!current?.background) return;
  try {
    if (process.platform === "win32") {
      const systemRoot = env.SystemRoot?.trim() || env.WINDIR?.trim();
      if (!systemRoot) return;
      spawn(path.join(systemRoot, "System32", "taskkill.exe"), ["/PID", String(current.pid)], {
        detached: false,
        stdio: "ignore",
        windowsHide: true,
        env: { NODE_ENV: "production", SystemRoot: systemRoot, WINDIR: systemRoot },
      });
    } else {
      process.kill(current.pid, "SIGTERM");
    }
  } catch {
    /* Native cancellation remains the final tree reaper. */
  }
}
