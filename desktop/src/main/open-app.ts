import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { shell } from "electron";
import { findShortcut, normalize } from "./open-app-match";

// Launches desktop apps for the agent from the Electron main process.
//
// Agent commands run under Runtime V2 inside a kill-on-close Job Object with
// breakaway disabled, so anything `Start-Process` starts is killed when that
// command's job closes. This process is not in that job: what it launches is
// an ordinary, visible, independent app, as when the user starts it.

export interface OpenAppRequest {
  target: string;
  args?: string[];
  cwd?: string;
}

export interface OpenAppResult {
  launched: true;
  method: "executable" | "shortcut" | "file";
  resolvedPath: string;
  pid?: number;
  note: string;
}

const LAUNCH_SETTLE_MS = 1_500;

function startMenuRoots(): string[] {
  if (process.platform !== "win32") return [];
  const programData = process.env.ProgramData ?? "C:\\ProgramData";
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return [
    path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(os.homedir(), "Desktop"),
    path.join(process.env.PUBLIC ?? "C:\\Users\\Public", "Desktop"),
  ];
}

function listShortcuts(root: string, depth = 0, found: string[] = []): string[] {
  if (depth > 4 || found.length > 4_000) return found;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listShortcuts(full, depth + 1, found);
    else if (/\.(?:lnk|url|appref-ms)$/i.test(entry.name)) found.push(full);
  }
  return found;
}

function spawnDetached(executable: string, args: readonly string[], cwd: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    // Electron's own variables must not make a child Electron/Node app behave
    // like a helper of this one.
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(?:ELECTRON_|NODE_OPTIONS$)/.test(key)) delete env[key];
    const child = spawn(executable, [...args], { cwd, env, detached: true, windowsHide: false, stdio: "ignore", shell: false });
    let settled = false;
    child.once("error", (error) => { if (!settled) { settled = true; reject(error); } });
    child.once("spawn", () => {
      child.unref();
      // A GUI app that dies immediately (missing licence, bad args) exits
      // within the settle window; report that instead of a false success.
      const timer = setTimeout(() => { if (!settled) { settled = true; resolve(child.pid); } }, LAUNCH_SETTLE_MS);
      child.once("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // A launcher stub that hands off to a running instance exits 0.
        if (code === 0) resolve(undefined);
        else reject(new Error(`${path.basename(executable)} exited immediately with code ${code}.`));
      });
    });
  });
}

/** A bare program name ("notepad", "code") on PATH, including WindowsApps aliases. */
function resolveOnPath(name: string): string | null {
  if (!/^[\w.-]{1,64}$/.test(name)) return null;
  const candidates = /\.exe$/i.test(name) ? [name] : [`${name}.exe`];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    for (const candidate of candidates) {
      const full = path.join(directory, candidate);
      try { if (fs.statSync(full).isFile()) return full; } catch { /* App-execution aliases stat as files; others are absent. */ }
    }
  }
  return null;
}

async function openWithShell(target: string): Promise<void> {
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

export async function openApp(request: OpenAppRequest): Promise<OpenAppResult> {
  const target = request.target.trim().replace(/^"(.*)"$/, "$1");
  const args = request.args ?? [];
  if (path.isAbsolute(target)) {
    if (!fs.existsSync(target)) throw new Error(`Nothing exists at ${target}.`);
    if (/\.(?:exe|com|bat|cmd)$/i.test(target)) {
      const cwd = request.cwd && fs.existsSync(request.cwd) ? request.cwd : path.dirname(target);
      const pid = await spawnDetached(target, args, cwd);
      return { launched: true, method: "executable", resolvedPath: target, ...(pid ? { pid } : {}),
        note: "Started as an independent, visible process." };
    }
    if (args.length) throw new Error("Arguments are only supported for an .exe target; pass the executable path instead.");
    await openWithShell(target);
    return { launched: true, method: /\.(?:lnk|url|appref-ms)$/i.test(target) ? "shortcut" : "file", resolvedPath: target,
      note: "Opened through Windows, as a double-click would." };
  }
  const shortcuts = startMenuRoots().flatMap((root) => listShortcuts(root));
  const shortcut = findShortcut(target, shortcuts);
  if (!shortcut) {
    // Store apps (Windows 11 Notepad, Calculator) and PATH tools have no Start
    // menu .lnk but resolve as executables or app-execution aliases.
    const onPath = resolveOnPath(target);
    if (onPath) {
      const cwd = request.cwd && fs.existsSync(request.cwd) ? request.cwd : os.homedir();
      const pid = await spawnDetached(onPath, args, cwd);
      return { launched: true, method: "executable", resolvedPath: onPath, ...(pid ? { pid } : {}),
        note: "Resolved on PATH and started as an independent, visible process." };
    }
    const near = shortcuts
      .map((file) => path.basename(file).replace(/\.(?:lnk|url|appref-ms)$/i, ""))
      .filter((label) => normalize(target).split(" ").some((word) => word.length > 2 && normalize(label).includes(word)))
      .slice(0, 8);
    throw new Error(`No Start menu app matches "${target}".${near.length ? ` Close matches: ${near.join("; ")}.` : ""} Pass an absolute .exe path instead.`);
  }
  if (args.length) {
    const resolved = shell.readShortcutLink(shortcut);
    if (resolved.target && /\.exe$/i.test(resolved.target) && fs.existsSync(resolved.target)) {
      const cwd = request.cwd && fs.existsSync(request.cwd) ? request.cwd : resolved.cwd || path.dirname(resolved.target);
      const pid = await spawnDetached(resolved.target, [...(resolved.args ? resolved.args.split(" ").filter(Boolean) : []), ...args], cwd);
      return { launched: true, method: "executable", resolvedPath: resolved.target, ...(pid ? { pid } : {}),
        note: `Resolved from the shortcut ${path.basename(shortcut)}.` };
    }
  }
  await openWithShell(shortcut);
  return { launched: true, method: "shortcut", resolvedPath: shortcut, note: "Opened from the Start menu shortcut." };
}
