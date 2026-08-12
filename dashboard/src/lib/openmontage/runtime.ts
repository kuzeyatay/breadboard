// Locating the pieces an OpenMontage run needs, and the environment they run in.
//
// OpenMontage is an *instruction-driven* production system: 102 Python tools, 13
// pipeline manifests and a library of stage-director skills, all orchestrated by
// whichever coding agent reads `AGENT_GUIDE.md`. Upstream's own words: "the AI
// agent IS the intelligence; Python exists only for tools and persistence."
// There is no `openmontage run` to wrap — so Breadboard supplies the missing
// half (a Codex process pinned to ChatMock) and this module supplies what that
// process needs underneath:
//
//   - a Python interpreter with the clone's dependencies installed;
//   - ffmpeg/ffprobe, which every edit and compose tool shells out to;
//   - Node/npx, for the Remotion and HyperFrames composition runtimes.
//
// None are bundled. Each resolves from an explicit environment variable first,
// then from something already on this machine — the clone's own `.venv`, Agent
// Reach's portable ffmpeg, the desktop shell's `ffmpeg-static` — so a working
// install needs no admin rights and no second copy of anything.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";

export interface ToolchainPiece {
  found: boolean;
  path: string;
  source: string;
}

export interface OpenMontageToolchain {
  /** The interpreter that runs the clone's tools, plus whether deps are in it. */
  python: ToolchainPiece & { version: string; dependencies: boolean };
  ffmpeg: ToolchainPiece;
  ffprobe: ToolchainPiece;
  /** Node powers the Remotion composer; without it only the ffmpeg path renders. */
  node: ToolchainPiece & { version: string };
  /** `remotion-composer/node_modules` — the React composition runtime. */
  remotion: ToolchainPiece;
}

export interface RuntimeAvailability {
  available: boolean;
  /** The clone exists, even when nothing has been installed into it yet. */
  cloned: boolean;
  root: string | null;
  toolchain: OpenMontageToolchain;
  /** Every missing piece, so the settings panel can list them all at once. */
  missing: string[];
  reason?: string;
}

const PROBE_TIMEOUT_MS = 20_000;

/** Modules from `requirements.txt` that every production path needs. */
const REQUIRED_MODULES = ["yaml", "pydantic", "jsonschema", "dotenv", "PIL", "numpy", "requests"];

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

function firstExisting(candidates: readonly (string | null)[]): string | null {
  return (
    candidates.find(
      (candidate): candidate is string => Boolean(candidate) && fs.existsSync(candidate as string),
    ) ?? null
  );
}

/**
 * The cloned repository — the source of truth for the tools, the pipeline
 * manifests and the skills. Identified by `AGENT_GUIDE.md` beside the tool
 * registry, so a directory that merely shares the name is not mistaken for it.
 */
export function resolveOpenMontageRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    configured(env.OPENMONTAGE_ROOT),
    path.join(repositoryRoot(), "OpenMontage"),
    path.resolve(process.cwd(), "OpenMontage"),
    path.resolve(process.cwd(), "..", "OpenMontage"),
  ];
  return (
    candidates.find(
      (candidate) =>
        Boolean(candidate) &&
        fs.existsSync(path.join(candidate as string, "AGENT_GUIDE.md")) &&
        fs.existsSync(path.join(candidate as string, "tools", "tool_registry.py")),
    ) ?? null
  );
}

/** Per-run production workspaces. Durable: a rendered video is a deliverable. */
export function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return (
    configured(env.OPENMONTAGE_WORKSPACE_ROOT) ??
    path.join(dashboardDataDir(), "openmontage-runs")
  );
}

/** The virtualenv Breadboard creates inside the clone for the Python tools. */
export function venvDirectory(env: NodeJS.ProcessEnv = process.env): string | null {
  const root = resolveOpenMontageRoot(env);
  return root ? path.join(root, ".venv") : null;
}

function venvPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const venv = venvDirectory(env);
  if (!venv) return null;
  return firstExisting([
    path.join(venv, "Scripts", "python.exe"),
    path.join(venv, "bin", "python3"),
    path.join(venv, "bin", "python"),
  ]);
}

/** The directory holding the venv's console scripts, for the spawn PATH. */
export function venvBinDirectory(env: NodeJS.ProcessEnv = process.env): string | null {
  const venv = venvDirectory(env);
  if (!venv) return null;
  return firstExisting([path.join(venv, "Scripts"), path.join(venv, "bin")]);
}

function probe(command: string, args: readonly string[]): string | null {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: PROBE_TIMEOUT_MS,
    env: { ...process.env, NO_COLOR: "1", PYTHONIOENCODING: "utf-8" },
  });
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return output ? output.split(/\r?\n/)[0].slice(0, 120) : "";
}

function onPath(binary: string): string | null {
  const probeResult = spawnSync(
    process.platform === "win32" ? "where" : "which",
    [binary],
    { encoding: "utf8", windowsHide: true, timeout: PROBE_TIMEOUT_MS },
  );
  if (probeResult.error || probeResult.status !== 0) return null;
  const first = (probeResult.stdout ?? "").split(/\r?\n/).find((line) => line.trim());
  return first ? first.trim() : null;
}

/**
 * Does this interpreter have the clone's dependencies? Availability is about
 * whether a production can actually run, and a bare interpreter cannot import
 * a single OpenMontage tool.
 */
function hasDependencies(python: string): boolean {
  const result = spawnSync(
    python,
    ["-c", `import ${REQUIRED_MODULES.join(", ")}`],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    },
  );
  return !result.error && result.status === 0;
}

function resolvePython(env: NodeJS.ProcessEnv): OpenMontageToolchain["python"] {
  const explicit = configured(env.OPENMONTAGE_PYTHON);
  const candidates: { path: string; source: string }[] = [];
  if (explicit && fs.existsSync(explicit)) candidates.push({ path: explicit, source: "configured" });
  const venv = venvPython(env);
  if (venv) candidates.push({ path: venv, source: "venv" });
  for (const name of ["python", "python3"]) {
    const found = onPath(name);
    if (found) candidates.push({ path: found, source: "path" });
  }
  for (const candidate of candidates) {
    const version = probe(candidate.path, ["--version"]);
    if (version === null) continue;
    const dependencies = hasDependencies(candidate.path);
    // A venv without dependencies is still the right interpreter to report:
    // it is the one the setup panel installs into.
    if (dependencies || candidate.source === "venv") {
      return { found: true, path: candidate.path, source: candidate.source, version, dependencies };
    }
  }
  const fallback = candidates[0];
  return fallback
    ? {
        found: true,
        path: fallback.path,
        source: fallback.source,
        version: probe(fallback.path, ["--version"]) ?? "",
        dependencies: false,
      }
    : { found: false, path: "", source: "", version: "", dependencies: false };
}

/**
 * ffmpeg and ffprobe. Two portable copies already exist in this repository —
 * Agent Reach's tools directory and the desktop shell's `ffmpeg-static` — so
 * neither the person nor the agent has to install a third.
 */
function resolveMediaBinary(
  name: "ffmpeg" | "ffprobe",
  env: NodeJS.ProcessEnv,
): ToolchainPiece {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const explicitDir = configured(env.OPENMONTAGE_FFMPEG_PATH);
  const root = repositoryRoot();
  const candidates: { path: string | null; source: string }[] = [
    { path: explicitDir ? path.join(explicitDir, exe) : null, source: "configured" },
    { path: explicitDir, source: "configured" },
    { path: path.join(root, "agent-reach", ".tools", "bin", exe), source: "agent-reach" },
    {
      path: path.join(root, "desktop", "node_modules", `${name}-static`, exe),
      source: "ffmpeg-static",
    },
    { path: path.join(root, "desktop", "node_modules", "ffmpeg-static", exe), source: "ffmpeg-static" },
  ];
  for (const candidate of candidates) {
    if (candidate.path && fs.existsSync(candidate.path) && fs.statSync(candidate.path).isFile()) {
      return { found: true, path: candidate.path, source: candidate.source };
    }
  }
  const fromPath = onPath(name);
  return fromPath
    ? { found: true, path: fromPath, source: "path" }
    : { found: false, path: "", source: "" };
}

function resolveNode(env: NodeJS.ProcessEnv): OpenMontageToolchain["node"] {
  const explicit = configured(env.OPENMONTAGE_NODE);
  const candidate = explicit && fs.existsSync(explicit) ? explicit : (onPath("node") ?? process.execPath);
  const version = probe(candidate, ["--version"]);
  return version === null
    ? { found: false, path: "", source: "", version: "" }
    : {
        found: true,
        path: candidate,
        source: explicit ? "configured" : candidate === process.execPath ? "breadboard" : "path",
        version,
      };
}

/** Remotion is one of three render runtimes and the only one needing install. */
function resolveRemotion(env: NodeJS.ProcessEnv): ToolchainPiece {
  const root = resolveOpenMontageRoot(env);
  if (!root) return { found: false, path: "", source: "" };
  const composer = path.join(root, "remotion-composer");
  const modules = path.join(composer, "node_modules");
  return fs.existsSync(modules)
    ? { found: true, path: composer, source: "clone" }
    : { found: false, path: composer, source: "" };
}

export function resolveToolchain(env: NodeJS.ProcessEnv = process.env): OpenMontageToolchain {
  return {
    python: resolvePython(env),
    ffmpeg: resolveMediaBinary("ffmpeg", env),
    ffprobe: resolveMediaBinary("ffprobe", env),
    node: resolveNode(env),
    remotion: resolveRemotion(env),
  };
}

/**
 * Can a production run at all?
 *
 * Python with the clone's dependencies and ffmpeg are the floor: without the
 * first no OpenMontage tool imports, and without the second the tool registry
 * reports 14 of 102 tools available — no `video_compose`, which is to say no
 * way to turn a plan into a video. Node and Remotion are not required: the
 * ffmpeg composition path renders without them.
 */
export function runtimeAvailability(env: NodeJS.ProcessEnv = process.env): RuntimeAvailability {
  const root = resolveOpenMontageRoot(env);
  const toolchain = resolveToolchain(env);
  const missing: string[] = [];
  if (!root) missing.push("the OpenMontage clone");
  if (!toolchain.python.found) missing.push("Python");
  else if (!toolchain.python.dependencies) missing.push("the Python dependencies");
  if (!toolchain.ffmpeg.found) missing.push("ffmpeg");
  const available = missing.length === 0;
  return {
    available,
    cloned: Boolean(root),
    root,
    toolchain,
    missing,
    reason: available
      ? undefined
      : `OpenMontage needs ${missing.join(", ")}. Open the settings beside the palette entry to install what is missing.`,
  };
}

/**
 * The environment a production runs in.
 *
 * `OPENMONTAGE_PROJECTS_DIR` is the load-bearing one: upstream reads it in
 * `lib/paths.py` and every checkpoint, artifact and project marker follows it.
 * Pointing it at a per-run directory is what keeps a production's output out of
 * the clone's own working tree while the agent still reads instructions from
 * the clone by their documented relative paths.
 *
 * Prepending the venv and ffmpeg directories to PATH means a bare `python` or
 * `ffmpeg` — which is what every skill and tool docstring tells the agent to
 * type — resolves to the interpreter that has the dependencies and the binary
 * that is actually on this machine.
 */
export function openMontageEnv(
  toolchain: OpenMontageToolchain,
  input: { projectsDirectory: string },
  env: NodeJS.ProcessEnv = process.env,
  extraPathEntries: readonly string[] = [],
): NodeJS.ProcessEnv {
  // Windows carries PATH as `Path`, and spreading `env` into a plain object
  // drops the case-insensitive lookup that makes both names work — writing
  // "PATH" beside an inherited "Path" would leave the real one untouched.
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const prefixes = [
    ...extraPathEntries,
    venvBinDirectory(env) ?? "",
    toolchain.ffmpeg.found ? path.dirname(toolchain.ffmpeg.path) : "",
    toolchain.ffprobe.found ? path.dirname(toolchain.ffprobe.path) : "",
  ].filter((dir, index, all) => dir && all.indexOf(dir) === index);
  const root = resolveOpenMontageRoot(env);
  return {
    ...env,
    [pathKey]: [...prefixes, env[pathKey] ?? ""].filter(Boolean).join(path.delimiter),
    OPENMONTAGE_PROJECTS_DIR: input.projectsDirectory,
    // Tools import as `tools.<name>` and `lib.<name>`; the clone must be
    // importable no matter which directory a command is run from.
    PYTHONPATH: [root, env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    // The tool registry carries its own ASCII scrubber for exactly this: the
    // Windows console defaults to cp1252 and a skill name with an em dash in it
    // crashes the process on print. Ask for UTF-8 instead of working around it.
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    NO_COLOR: "1",
  };
}
