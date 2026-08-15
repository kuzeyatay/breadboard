// Locating the cloned shorts generator and everything a run of it needs.
//
// The clone is a small Python package with a heavy optional tree behind its
// local mode: yt-dlp, faster-whisper (which pulls CTranslate2 and a model
// download), and opencv. Breadboard never installs that behind a run — the
// agent's settings ask, the user agrees, and everything lands in
// `AI-Youtube-Shorts-Generator/.venv`, which the clone's own .gitignore already
// covers and which "Remove environment" deletes again.
//
// The clone shells out to a bare `ffmpeg` for both the cut and the audio mux,
// so a run also needs one on PATH. This repository already ships one (the
// desktop shell's ffmpeg-static, or Agent Reach's portable copy), and
// `shortsEnv` puts its directory at the front of PATH for the spawned Python
// rather than asking the machine to have installed one.
//
// The bridge script lives in the repository's scripts/ directory, not in the
// clone, so the checkout stays pristine and a `git pull` never conflicts.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dashboardDataDir, repositoryRoot } from "../runtime-paths.ts";
import { resolveFfmpeg } from "../vimax/video.ts";

export interface ShortsRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface ShortsHealth {
  /** Ready to cut a video right now. */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** Every local-mode dependency imports inside that environment. */
  dependenciesInstalled: boolean;
  /** Which of them did not, so the panel can say what is missing. */
  missing: string[];
  /** The Python that would build the environment, when there is no venv yet. */
  systemPython: string | null;
  /** uv is on PATH — the fast path for building the environment. */
  uvAvailable: boolean;
  /** The ffmpeg a run would cut with, if one was found. */
  ffmpeg: string | null;
  /** Breadboard's bridge script. */
  bridgeFound: boolean;
  reason: string | null;
}

const PROBE_TIMEOUT_MS = 90_000;
const HEALTH_CACHE_MS = 20_000;

/** Every local-mode import, in the order a run would hit them. */
const REQUIRED_MODULES: Array<{ module: string; label: string }> = [
  { module: "shorts_generator", label: "shorts_generator" },
  { module: "yt_dlp", label: "yt-dlp" },
  { module: "faster_whisper", label: "faster-whisper" },
  { module: "cv2", label: "opencv-python" },
  { module: "openai", label: "openai" },
];

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** A directory is the shorts clone when its package and CLI are both there. */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "shorts_generator", "pipeline.py")) &&
    fs.existsSync(path.join(candidate, "shorts_generator", "local", "clipper.py")) &&
    fs.existsSync(path.join(candidate, "main.py"))
  );
}

export function resolveShortsRoot(env: NodeJS.ProcessEnv = process.env): ShortsRuntime | null {
  const candidates: Array<{ root: string; source: ShortsRuntime["source"] }> = [];
  const explicit = configured(env.SHORTS_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  const name = "AI-Youtube-Shorts-Generator";
  candidates.push({ root: path.join(repositoryRoot(), name), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), name), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", name), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** The bridge script, which is Breadboard's own file and not part of the clone. */
export function bridgeScriptPath(): string | null {
  const candidates = [
    path.join(repositoryRoot(), "scripts", "shorts-bridge.py"),
    path.resolve(process.cwd(), "scripts", "shorts-bridge.py"),
    path.resolve(process.cwd(), "..", "scripts", "shorts-bridge.py"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

export function venvDirectory(root: string): string {
  return path.join(root, ".venv");
}

/** The Python inside the clone's virtual environment, if it has been built. */
export function venvPython(root: string): string | null {
  const candidate =
    process.platform === "win32"
      ? path.join(venvDirectory(root), "Scripts", "python.exe")
      : path.join(venvDirectory(root), "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Where downloads, transcripts and whisper's model cache live.
 *
 * Deliberately outside the clone and stable across runs: a second run on the
 * same video reuses the download and the cached .srt instead of fetching and
 * transcribing it again, which is most of the wall clock of a run.
 */
export function workspaceDirectory(): string {
  const root = path.join(dashboardDataDir(), "shorts-work");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Find an executable on PATH, honouring PATHEXT on Windows. */
export function resolveOnPath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (path.isAbsolute(executable)) return fs.existsSync(executable) ? executable : null;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * A Python that could build the environment. The clone needs 3.9+, and the
 * Windows launcher (`py`) is skipped because it is a shim that resolves to the
 * same interpreters `python` already finds.
 */
export function findSystemPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.SHORTS_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["python3", "python"]) {
    const found = resolveOnPath(name, env);
    // The Windows Store alias is a zero-byte reparse point that opens the Store
    // instead of running anything.
    if (found && safeSize(found) > 0) return found;
  }
  return null;
}

function safeSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

/**
 * Environment for anything the clone runs.
 *
 * Under the desktop shell the dashboard is Electron, so a spawned Node-launched
 * process has to be told to behave as Node. The encoding vars keep Python's own
 * output UTF-8 on Windows, where the bridge's JSON would otherwise be mangled by
 * cp1252. And ffmpeg's directory goes to the front of PATH, because the clone
 * calls `ffmpeg` by name and this repository's copy is the one that is certain
 * to be there.
 */
export function shortsEnv(
  extra: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const ffmpeg = resolveFfmpeg(env);
  const searchPath = ffmpeg
    ? `${path.dirname(ffmpeg)}${path.delimiter}${env[pathKey] ?? ""}`
    : env[pathKey];
  return {
    ...env,
    [pathKey]: searchPath,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    ...extra,
  };
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Run one command for the clone. Never throws: every caller either reports the
 * failure to the user or turns it into a health reason.
 */
export function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    env?: Record<string, string | undefined>;
    maxOutputChars?: number;
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: shortsEnv(options.env ?? {}),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "spawn failed",
        timedOut: false,
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < limit) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 32_000) stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }, options.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: error.message, timedOut });
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

interface HealthCache {
  at: number;
  health: ShortsHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardShortsHealth?: HealthCache;
  __breadboardShortsHealthInFlight?: Promise<ShortsHealth>;
};

async function probe(): Promise<ShortsHealth> {
  const runtime = resolveShortsRoot();
  const bridgeFound = Boolean(bridgeScriptPath());
  const ffmpeg = resolveFfmpeg();
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      environmentReady: false,
      dependenciesInstalled: false,
      missing: [],
      systemPython: findSystemPython(),
      uvAvailable: Boolean(uvPath()),
      ffmpeg,
      bridgeFound,
      reason: "The AI-Youtube-Shorts-Generator clone was not found next to the dashboard.",
    };
  }

  const base = {
    cloned: true,
    root: runtime.root,
    uvAvailable: Boolean(uvPath()),
    ffmpeg,
    bridgeFound,
  };

  const python = venvPython(runtime.root);
  if (!python) {
    return {
      ...base,
      available: false,
      environmentReady: false,
      dependenciesInstalled: false,
      missing: REQUIRED_MODULES.map((item) => item.label),
      systemPython: findSystemPython(),
      reason:
        "Shorts is cloned but its Python environment has not been built yet. Build it from its settings.",
    };
  }

  // Importing every module is the only check that means anything: the venv can
  // exist with a half-finished install behind it, and faster-whisper in
  // particular fails at import time when its native library is missing.
  const script = REQUIRED_MODULES.map((item) => item.module)
    .map(
      (module) =>
        `try:\n import ${module}\nexcept Exception:\n missing.append(${JSON.stringify(module)})\n`,
    )
    .join("");
  const probeResult = await runCommand(
    python,
    ["-c", `missing = []\n${script}print("MISSING:" + ",".join(missing))`],
    { cwd: runtime.root, timeoutMs: PROBE_TIMEOUT_MS },
  );
  const reported = /MISSING:(.*)/.exec(probeResult.stdout)?.[1] ?? null;
  const missing =
    reported === null
      ? REQUIRED_MODULES.map((item) => item.label)
      : reported
          .split(",")
          .filter(Boolean)
          .map(
            (module) =>
              REQUIRED_MODULES.find((item) => item.module === module)?.label ?? module,
          );
  const dependenciesInstalled = reported !== null && missing.length === 0;

  if (!dependenciesInstalled) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      dependenciesInstalled: false,
      missing,
      systemPython: python,
      reason: probeResult.timedOut
        ? "The Shorts environment did not answer in time."
        : `The Shorts environment is missing ${missing.join(", ")}. Repair it from its settings.`,
    };
  }

  if (!bridgeFound) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      dependenciesInstalled: true,
      missing: [],
      systemPython: python,
      reason: "Breadboard's Shorts bridge script is missing from scripts/.",
    };
  }

  if (!ffmpeg) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      dependenciesInstalled: true,
      missing: [],
      systemPython: python,
      reason:
        "No ffmpeg was found on this machine, and every clip is cut and muxed with one.",
    };
  }

  return {
    ...base,
    available: true,
    environmentReady: true,
    dependenciesInstalled: true,
    missing: [],
    systemPython: python,
    reason: null,
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(options: { force?: boolean } = {}): Promise<ShortsHealth> {
  const cached = globalCache.__breadboardShortsHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    return cached.health;
  }
  if (globalCache.__breadboardShortsHealthInFlight) {
    return globalCache.__breadboardShortsHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardShortsHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardShortsHealthInFlight = undefined;
    });
  globalCache.__breadboardShortsHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardShortsHealth = undefined;
}
