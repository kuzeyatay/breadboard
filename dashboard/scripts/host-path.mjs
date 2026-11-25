// The user's real tool PATH, for Breadboard processes that run under Runtime V2.
//
// Runtime V2 gives every service a closed PATH: Breadboard's bundled bin, node,
// bun and python folders, then System32 and Windows (see
// native/runtime-core/src/service_environment.rs, build_common_environment).
// That protects the services themselves, but it also leaked into everything
// they start on the user's behalf: the agent's terminal said `git` was "not
// recognized", and the MCP installer reported "Git is not installed" on a
// machine where Git was installed and on PATH.
//
// Codex never has this problem because its shells and MCP servers inherit the
// user's environment and resolve names with PATHEXT
// (codex-rs/rmcp-client/src/program_resolver.rs). This module rebuilds that
// environment: the closed PATH stays first, so bundled runtimes still win, and
// the user's Machine and User PATH from the registry, plus well-known install
// folders, follow it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CACHE_MS = 60_000;
let cache = null;

function envValue(env, name) {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key ? env[key] : undefined;
}

function systemRoot(env) {
  return envValue(env, "SystemRoot") ?? envValue(env, "windir") ?? "C:\\Windows";
}

/** Values for %VAR% expansion, with OS-derived fallbacks for the closed environment. */
function expansionValues(env) {
  const drive = envValue(env, "SystemDrive") ?? "C:";
  const home = envValue(env, "USERPROFILE") ?? os.homedir();
  return {
    SYSTEMROOT: systemRoot(env),
    WINDIR: systemRoot(env),
    SYSTEMDRIVE: drive,
    USERPROFILE: home,
    HOMEDRIVE: envValue(env, "HOMEDRIVE") ?? drive,
    HOMEPATH: envValue(env, "HOMEPATH") ?? home.slice(drive.length),
    APPDATA: envValue(env, "APPDATA") ?? path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: envValue(env, "LOCALAPPDATA") ?? path.join(home, "AppData", "Local"),
    PROGRAMDATA: envValue(env, "ProgramData") ?? `${drive}\\ProgramData`,
    PROGRAMFILES: envValue(env, "ProgramFiles") ?? `${drive}\\Program Files`,
    "PROGRAMFILES(X86)": envValue(env, "ProgramFiles(x86)") ?? `${drive}\\Program Files (x86)`,
    PROGRAMW6432: envValue(env, "ProgramW6432") ?? envValue(env, "ProgramFiles") ?? `${drive}\\Program Files`,
    USERNAME: envValue(env, "USERNAME") ?? os.userInfo().username,
  };
}

export function expandWindowsVariables(value, env = process.env) {
  const values = expansionValues(env);
  return value.replace(/%([^%]+)%/g, (match, name) => {
    const upper = String(name).toUpperCase();
    return values[upper] ?? envValue(env, name) ?? match;
  });
}

/** Parse `reg query … /v Path` output into its value, or "". */
export function parseRegQueryPath(output) {
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i.exec(line);
    if (match) return match[1].trim();
  }
  return "";
}

function registryPath(env) {
  const reg = path.join(systemRoot(env), "System32", "reg.exe");
  if (!fs.existsSync(reg)) return [];
  const read = (key) => {
    try {
      return parseRegQueryPath(execFileSync(reg, ["query", key, "/v", "Path"], {
        encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
      }));
    } catch {
      return "";
    }
  };
  // Machine first, then User, exactly as Windows composes a new session's PATH.
  return [
    read("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
    read("HKCU\\Environment"),
  ].flatMap((value) => value.split(";")).map((entry) => expandWindowsVariables(entry.trim(), env)).filter(Boolean);
}

/** Parse every value of `reg query <key>` output into { name: value }. */
export function parseRegQueryValues(output) {
  const values = {};
  for (const line of String(output).split(/\r?\n/)) {
    const match = /^\s{4}(\S(?:.*?\S)?)\s{4}REG_(?:EXPAND_)?SZ\s{4}(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

// Codex's default exclude (shell_environment.rs): never forward credentials.
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL/i;

/**
 * The variables the user set in Windows (Machine, then User overriding), the
 * part of Codex's inherited environment that Runtime V2 drops: JAVA_HOME,
 * license-server modes, SDK roots. PATH and TEMP are handled elsewhere, and
 * anything that looks like a secret is excluded like Codex does.
 */
export function registryUserEnvironment(env = process.env) {
  if (process.platform !== "win32") return {};
  const reg = path.join(systemRoot(env), "System32", "reg.exe");
  if (!fs.existsSync(reg)) return {};
  const read = (key) => {
    try {
      return parseRegQueryValues(execFileSync(reg, ["query", key], {
        encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: ["ignore", "pipe", "ignore"],
      }));
    } catch {
      return {};
    }
  };
  const merged = {
    ...read("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"),
    ...read("HKCU\\Environment"),
  };
  const result = {};
  for (const [name, value] of Object.entries(merged)) {
    if (/^(PATH|PATHEXT|TEMP|TMP|HOME|USERPROFILE|USERNAME|USERDOMAIN|COMPUTERNAME|WINDIR|SYSTEMROOT|COMSPEC|OS|PROCESSOR_.*|NUMBER_OF_PROCESSORS|DRIVERDATA|PSMODULEPATH)$/i.test(name)) continue;
    if (SECRET_NAME.test(name)) continue;
    result[name] = expandWindowsVariables(value, env);
  }
  return result;
}

/** Install folders that are often missing from PATH even when the tool is installed. */
export function wellKnownToolDirectories(env = process.env) {
  const values = expansionValues(env);
  const home = values.USERPROFILE;
  if (process.platform !== "win32") {
    return [path.join(home, ".local", "bin"), path.join(home, ".cargo", "bin"), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
  }
  const local = values.LOCALAPPDATA;
  const programs = [values.PROGRAMFILES, values.PROGRAMW6432, values["PROGRAMFILES(X86)"]];
  const gitHubDesktopGit = (() => {
    // GitHub Desktop bundles its own Git under a versioned app folder.
    const root = path.join(local, "GitHubDesktop");
    try {
      const app = fs.readdirSync(root).filter((name) => /^app-/.test(name)).sort().at(-1);
      return app ? path.join(root, app, "resources", "app", "git", "cmd") : "";
    } catch { return ""; }
  })();
  return [
    ...programs.flatMap((root) => [path.join(root, "Git", "cmd"), path.join(root, "nodejs"), path.join(root, "GitHub CLI"), path.join(root, "Docker", "Docker", "resources", "bin")]),
    path.join(local, "Programs", "Git", "cmd"),
    gitHubDesktopGit,
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, "scoop", "shims"),
    path.join(values.PROGRAMDATA, "chocolatey", "bin"),
    path.join(values.APPDATA, "npm"),
    path.join(local, "Programs", "Python", "Launcher"),
    path.join(local, "Microsoft", "WinGet", "Links"),
    path.join(local, "Microsoft", "WindowsApps"),
  ].filter(Boolean);
}

function windowsKey(entry) {
  return path.resolve(entry).replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * The search path for user tools: the process's own PATH first (Breadboard's
 * bundled runtimes keep priority), then the user's registry PATH, then
 * well-known install folders. Only existing directories, each once.
 */
export function hostSearchPath(env = process.env, { now = Date.now() } = {}) {
  const base = String(envValue(env, "PATH") ?? "").split(path.delimiter).filter(Boolean);
  if (cache && cache.base === base.join(path.delimiter) && now - cache.at < CACHE_MS) return cache.value;
  const extra = process.platform === "win32" ? registryPath(env) : [];
  const seen = new Set();
  const value = [];
  for (const entry of [...base, ...extra, ...wellKnownToolDirectories(env)]) {
    const key = process.platform === "win32" ? windowsKey(entry) : path.resolve(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    // Keep the caller's own entries even if absent (they are its contract);
    // add only discovered directories that actually exist.
    if (!base.includes(entry)) {
      try { if (!fs.statSync(entry).isDirectory()) continue; } catch { continue; }
    }
    value.push(entry);
  }
  cache = { base: base.join(path.delimiter), at: now, value };
  return value;
}

/**
 * The directories to search for a tool given an env: the host search path for
 * the real process environment, and exactly the given PATH for an injected one
 * (tests and callers that deliberately pin a PATH keep that contract).
 */
export function toolSearchPath(env = process.env) {
  if (env === process.env) return hostSearchPath(env);
  return String(envValue(env, "PATH") ?? "").split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
}

/** A copy of env whose PATH also reaches the user's installed tools. */
export function withHostPath(env = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.toUpperCase() !== "PATH" && value !== undefined) result[key] = value;
  }
  result[process.platform === "win32" ? "Path" : "PATH"] = hostSearchPath(env).join(path.delimiter);
  if (process.platform === "win32") {
    // One spelling only: Windows children see whichever comes first otherwise.
    result.PATH = result.Path;
    delete result.Path;
  }
  return result;
}

/**
 * Resolve a bare program name ("git", "npx", "uvx") to an absolute path the
 * way a user's own shell would, including .cmd/.bat shims via PATHEXT.
 * Returns null when it is genuinely not installed.
 */
export function resolveHostExecutable(name, env = process.env) {
  if (!name) return null;
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;
  const extensions = process.platform === "win32"
    ? (/\.[a-z0-9]+$/i.test(name) ? [""] : [".exe", ".cmd", ".bat", ".com", ""])
    : [""];
  for (const directory of hostSearchPath(env)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension);
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {
        // App-execution aliases (WindowsApps\winget.exe) are reparse points
        // that stat cannot follow but lstat still sees.
        try { if (fs.lstatSync(candidate).isSymbolicLink() || fs.lstatSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
      }
    }
  }
  return null;
}

/** Test seam. */
export function resetHostPathCacheForTest() {
  cache = null;
}
