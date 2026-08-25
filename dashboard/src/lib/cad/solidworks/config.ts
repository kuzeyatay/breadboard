// Where the SolidWorks bridge lives on this machine.
//
// Three things have to be found before a SolidWorks build can be attempted, and
// each of them can be absent for a different reason a person can act on:
//
//   * the SolidworksMCP-python clone — configured, or a sibling of the repo,
//   * a Python that can run it — the clone's own venv, or `uv`,
//   * SolidWorks itself — installed, and separately, running.
//
// Nothing here starts a process or touches COM. Every function is a filesystem
// or registry read, so the settings page and `/api/cad/health` can call them
// freely. Breadboard never clones or installs anything: a missing clone is
// reported, not fetched.
//
// Server-only — it reads the filesystem. Imported by scripts as well as by the
// dashboard server, so it stays free of Next-only imports.

import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function pathExists(candidate: string): boolean {
  // These are runtime configuration/install probes, never bundle assets. The
  // ignore marker must annotate the bare fs argument: annotating a nested
  // path.join does not suppress Turbopack's dynamic-filesystem tracer.
  return existsSync(/* turbopackIgnore: true */ candidate);
}

function pathIsDirectory(candidate: string): boolean {
  return statSync(/* turbopackIgnore: true */ candidate).isDirectory();
}

function directoryEntries(candidate: string): string[] {
  return readdirSync(/* turbopackIgnore: true */ candidate);
}

/** Directory names the clone is known by, in the order they are tried. */
const CLONE_DIRECTORY_NAMES = ["SolidworksMCP-python", "solidworks-mcp-python"];

export interface SolidWorksPaths {
  /** The clone's root, or null when it could not be found. */
  clone: string | null;
  /** How the clone was located, for the setup message. */
  cloneSource: "env" | "sibling" | "none";
  /** The interpreter that can import `solidworks_mcp`, or null. */
  python: string | null;
  /** `uv`, used only when the clone has no virtual environment of its own. */
  uv: string | null;
}

function isClone(candidate: string): boolean {
  try {
    if (!pathIsDirectory(candidate)) return false;
  } catch {
    return false;
  }
  // Keep these suffixes explicit. A nested dynamic `path.join(candidate,
  // marker)` makes Turbopack conservatively enumerate every descendant of a
  // possible discovery root, including unrelated or access-restricted user
  // directories. These exact probes are runtime discovery, not build assets.
  return (
    pathExists(path.join(candidate, "src", "solidworks_mcp", "server.py")) &&
    pathExists(path.join(candidate, "src", "solidworks_mcp", "config.py")) &&
    pathExists(path.join(candidate, "pyproject.toml"))
  );
}

/** Breadboard's own directory for SolidWorks bridge state. Never the clone. */
export function solidworksHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_SOLIDWORKS_HOME?.trim();
  if (configured) return path.resolve(configured);
  const base = env.BREADBOARD_DATA_DIR?.trim() || path.join(os.homedir(), ".breadboard");
  return path.join(base, "solidworks");
}

/** Where generated parts are written. Breadboard-owned, never the user's tree. */
export function solidworksWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREADBOARD_SOLIDWORKS_WORKSPACE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(solidworksHome(env), "workspaces");
}

/**
 * The SolidworksMCP-python checkout.
 *
 * `BREADBOARD_SOLIDWORKS_MCP_PATH` is authoritative — an explicit setting must
 * work even when it points somewhere unusual. Auto-discovery only looks for the
 * clone beside the Breadboard repository, which is the layout the README
 * documents, and still verifies the markers before believing it.
 */
export function solidworksMcpPath(
  env: NodeJS.ProcessEnv = process.env,
): { path: string | null; source: SolidWorksPaths["cloneSource"] } {
  const configured = env.BREADBOARD_SOLIDWORKS_MCP_PATH?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    return { path: isClone(resolved) ? resolved : null, source: "env" };
  }
  // The dashboard runs from `<repo>/dashboard`, so both the repository root and
  // its parent are plausible homes for a sibling checkout.
  const dashboardRoot = process.cwd();
  const repoRoot = path.resolve(dashboardRoot, "..");
  const bases = [dashboardRoot, repoRoot, path.resolve(repoRoot, "..")];
  for (const base of bases) {
    for (const name of CLONE_DIRECTORY_NAMES) {
      const candidate = path.join(/* turbopackIgnore: true */ base, name);
      if (isClone(candidate)) return { path: candidate, source: "sibling" };
    }
  }
  return { path: null, source: "none" };
}

/** The clone's own interpreter, if its virtual environment was created. */
function clonePython(clone: string): string | null {
  const candidates =
    process.platform === "win32"
      ? [path.join(clone, ".venv", "Scripts", "python.exe")]
      : [path.join(clone, ".venv", "bin", "python3"), path.join(clone, ".venv", "bin", "python")];
  return candidates.find((candidate) => pathExists(candidate)) ?? null;
}

/** `uv`, looked for where its installers put it. Mirrors the clone's own script. */
function findUv(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.BREADBOARD_UV_PATH?.trim();
  if (explicit && pathExists(explicit)) return explicit;

  const executable = process.platform === "win32" ? "uv.exe" : "uv";
  const home = env.USERPROFILE?.trim() || os.homedir();
  const known = [
    path.join(home, ".local", "bin", executable),
    ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, "Programs", "uv", executable)] : []),
    ...(env.APPDATA ? [path.join(env.APPDATA, "Python", "Scripts", executable)] : []),
  ];
  for (const candidate of known) {
    if (pathExists(candidate)) return candidate;
  }
  for (const entry of (env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, executable);
    if (pathExists(candidate)) return candidate;
  }
  return null;
}

export function solidworksPaths(env: NodeJS.ProcessEnv = process.env): SolidWorksPaths {
  const located = solidworksMcpPath(env);
  if (!located.path) {
    return { clone: null, cloneSource: located.source, python: null, uv: null };
  }
  return {
    clone: located.path,
    cloneSource: located.source,
    python: clonePython(located.path),
    uv: findUv(env),
  };
}

/**
 * Where SolidWorks is installed.
 *
 * Read from the filesystem rather than from COM registration, because asking
 * COM whether a class exists is one `Dispatch` away from starting the
 * application — and this is called by a passive health check.
 */
export function solidworksInstallPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform !== "win32") return null;
  const configured = env.BREADBOARD_SOLIDWORKS_EXE?.trim();
  if (configured) return pathExists(configured) ? path.resolve(configured) : null;

  const programFiles = [
    env["ProgramFiles"],
    env["ProgramW6432"],
    env["ProgramFiles(x86)"],
    "C:\\Program Files",
  ].filter((entry): entry is string => Boolean(entry));

  const seen = new Set<string>();
  for (const base of programFiles) {
    const corp = path.join(base, "SOLIDWORKS Corp");
    if (seen.has(corp)) continue;
    seen.add(corp);
    let entries: string[];
    try {
      entries = directoryEntries(corp);
    } catch {
      continue;
    }
    // "SOLIDWORKS", "SOLIDWORKS 2026" and similar all sit under SOLIDWORKS Corp.
    for (const entry of entries) {
      if (!/^SOLIDWORKS/i.test(entry)) continue;
      const executable = path.join(corp, entry, "SLDWORKS.exe");
      if (pathExists(executable)) return executable;
    }
  }
  return null;
}

/**
 * The release year, taken from the install path when it says one.
 *
 * Absent rather than guessed: the bridge passes it to the clone only as a hint,
 * and a wrong year is worse than none.
 */
export function solidworksVersionHint(env: NodeJS.ProcessEnv = process.env): number | null {
  const configured = env.BREADBOARD_SOLIDWORKS_VERSION?.trim();
  if (configured) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100) return parsed;
  }
  const install = solidworksInstallPath(env);
  const matched = install ? /SOLIDWORKS[ _-]?(20\d{2})/i.exec(install) : null;
  return matched ? Number.parseInt(matched[1], 10) : null;
}
