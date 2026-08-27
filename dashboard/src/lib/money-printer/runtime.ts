// Locating the cloned MoneyPrinterTurbo project and the Python that can run it.
//
// The clone is a real service, not a library: a FastAPI app (app/asgi.py)
// wrapping its own task pipeline — script, search terms, voiceover, subtitles,
// stock footage, cut — its own task queue and its own state store. Breadboard
// therefore drives the real thing over its documented HTTP API rather than
// reimplementing any of it, the same shape as the Vibe Trading and Socials Manager
// integrations.
//
// Nothing here installs anything behind a run. The dependency tree is heavy
// (moviepy, faster-whisper, streamlit, litellm), so the agent's settings ask,
// the user agrees, and everything lands in `MoneyPrinterTurbo/.venv`, which the
// clone's own .gitignore already covers and which `Remove environment` deletes
// again.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  dashboardDataDir,
  repositoryRoot,
  runtimeV2ServiceVenv,
} from "../runtime-paths.ts";

export interface MoneyPrinterRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface MoneyPrinterHealth {
  /** Ready to cut a video right now (possibly after starting the service). */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** `import app.asgi` succeeds inside that environment. */
  packageInstalled: boolean;
  /** The Python that would build the environment, when there is no venv yet. */
  systemPython: string | null;
  /** uv is on PATH — the fast path for building the environment. */
  uvAvailable: boolean;
  /** An ffmpeg the clone can encode with, or null when none was found. */
  ffmpegPath: string | null;
  /** The version the clone declares, when it can be read. */
  version: string | null;
  /** The supervised API service is up and answering. */
  serviceRunning: boolean;
  /** Where that service listens, once it has been started. */
  serviceUrl: string | null;
  /** Which footage libraries have a key, so a run knows what it can search. */
  footageSources: string[];
  reason: string | null;
}

const PROBE_TIMEOUT_MS = 120_000;
const HEALTH_CACHE_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/**
 * A directory is a MoneyPrinterTurbo clone when the ASGI app and the task
 * pipeline are both there. `pyproject.toml` alone would match half the Python
 * trees on disk.
 */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "app", "asgi.py")) &&
    fs.existsSync(path.join(candidate, "app", "services", "task.py")) &&
    fs.existsSync(path.join(candidate, "config.example.toml"))
  );
}

export function resolveMoneyPrinterRoot(
  env: NodeJS.ProcessEnv = process.env,
): MoneyPrinterRuntime | null {
  const candidates: Array<{ root: string; source: MoneyPrinterRuntime["source"] }> = [];
  const explicit = configured(env.MONEY_PRINTER_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({
    root: path.join(dashboardDataDir(), "runtime-v2", "toolchains", "money-printer"),
    source: "configured",
  });
  candidates.push({
    root: path.join(repositoryRoot(), "MoneyPrinterTurbo"),
    source: "repository",
  });
  candidates.push({ root: path.resolve(process.cwd(), "MoneyPrinterTurbo"), source: "cwd" });
  candidates.push({
    root: path.resolve(process.cwd(), "..", "MoneyPrinterTurbo"),
    source: "cwd",
  });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/** Where the clone writes every task's working files and finished videos. */
export function tasksDirectory(root: string): string {
  return path.join(root, "storage", "tasks");
}

export function venvDirectory(root: string): string {
  void root;
  return runtimeV2ServiceVenv("money-printer");
}

/** The Python inside the clone's virtual environment, if it has been built. */
export function venvPython(root: string): string | null {
  const candidate =
    process.platform === "win32"
      ? path.join(venvDirectory(root), "Scripts", "python.exe")
      : path.join(venvDirectory(root), "bin", "python");
  return fs.existsSync(candidate) ? candidate : null;
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

function safeSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * A Python that could build the environment. The Windows launcher (`py`) is
 * skipped because it is a shim resolving to the same interpreters `python`
 * already finds, and the Store alias is a zero-byte reparse point.
 */
export function findSystemPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.MONEY_PRINTER_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["python3", "python"]) {
    const found = resolveOnPath(name, env);
    if (found && safeSize(found) > 0) return found;
  }
  return null;
}

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

function executableName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}

/**
 * The ffmpeg this machine already has.
 *
 * Every stage after the voiceover goes through it, so a run without one fails
 * late and expensively. Checked in the order that costs least: an explicit
 * setting, the desktop shell's bundled binary, the portable copy Agent Reach
 * installs, then PATH — the same chain ViMax encodes its films with, so the two
 * video agents never disagree about which ffmpeg this machine has.
 */
export function resolveFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit =
    env.MONEY_PRINTER_FFMPEG_PATH?.trim() ||
    env.VIMAX_FFMPEG_PATH?.trim() ||
    env.HYPERFRAMES_FFMPEG_PATH?.trim();
  if (explicit && fs.existsSync(explicit)) return explicit;

  const root = repositoryRoot();
  const candidates = [
    path.join(root, "desktop", "node_modules", "ffmpeg-static", executableName("ffmpeg")),
    path.join(root, "desktop", "resources", "bin", executableName("ffmpeg")),
    path.join(root, "agent-reach", ".tools", "bin", executableName("ffmpeg")),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return resolveOnPath("ffmpeg", env);
}

/**
 * Environment for anything the clone runs. Under the desktop shell the
 * dashboard is Electron, so a spawned Node-launched process has to be told to
 * behave as Node; the encoding vars keep Python's own output UTF-8 on Windows,
 * where the clone's Chinese log lines would otherwise crash the writer under
 * cp1252.
 */
export function moneyPrinterEnv(
  extra: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const ffmpeg = resolveFfmpeg(env);
  return {
    ...env,
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONUNBUFFERED: "1",
    // moviepy, pydub and the clone's own encoder all read this one variable, so
    // pointing it at the repository's ffmpeg is enough for every stage.
    ...(ffmpeg ? { IMAGEIO_FFMPEG_EXE: ffmpeg } : {}),
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
        env: moneyPrinterEnv(options.env ?? {}),
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

export function cloneVersion(root: string): string | null {
  try {
    const manifest = fs.readFileSync(path.join(root, "pyproject.toml"), "utf8");
    return /^version\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? null;
  } catch {
    return null;
  }
}

interface HealthCache {
  at: number;
  health: MoneyPrinterHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardMoneyPrinterHealth?: HealthCache;
  __breadboardMoneyPrinterHealthInFlight?: Promise<MoneyPrinterHealth>;
};

/**
 * Read the live service state without importing ./service.ts, which imports this
 * module. Set by the supervisor; absent means nothing has been started yet.
 */
const globalService = globalThis as typeof globalThis & {
  __breadboardMoneyPrinterServiceUrl?: string | null;
};

export function currentServiceUrl(): string | null {
  return globalService.__breadboardMoneyPrinterServiceUrl ?? null;
}

export function setCurrentServiceUrl(url: string | null): void {
  globalService.__breadboardMoneyPrinterServiceUrl = url;
}

async function probe(availableSources: () => string[]): Promise<MoneyPrinterHealth> {
  const runtime = resolveMoneyPrinterRoot();
  const serviceUrl = currentServiceUrl();
  const ffmpegPath = resolveFfmpeg();
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      environmentReady: false,
      packageInstalled: false,
      systemPython: findSystemPython(),
      uvAvailable: Boolean(uvPath()),
      ffmpegPath,
      version: null,
      serviceRunning: false,
      serviceUrl: null,
      footageSources: availableSources(),
      reason: "The MoneyPrinterTurbo clone was not found next to the dashboard.",
    };
  }

  const base = {
    cloned: true,
    root: runtime.root,
    version: cloneVersion(runtime.root),
    uvAvailable: Boolean(uvPath()),
    ffmpegPath,
    serviceUrl,
    footageSources: availableSources(),
  };

  const python = venvPython(runtime.root);
  if (!python) {
    return {
      ...base,
      available: false,
      environmentReady: false,
      packageInstalled: false,
      systemPython: findSystemPython(),
      serviceRunning: false,
      reason:
        "MoneyPrinter is cloned but its Python environment has not been built yet. Build it from its settings.",
    };
  }

  // Importing the app is the only check that means anything: the venv can exist
  // with a half-finished install behind it, and this tree's heaviest
  // dependencies (moviepy, faster-whisper) are exactly the ones that fail.
  const probeResult = await runCommand(python, ["-c", "import app.asgi, uvicorn; print('ok')"], {
    cwd: runtime.root,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const packageInstalled = probeResult.code === 0 && probeResult.stdout.includes("ok");

  if (!packageInstalled) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: false,
      systemPython: python,
      serviceRunning: false,
      reason: probeResult.timedOut
        ? "The MoneyPrinter environment did not answer in time."
        : `The MoneyPrinter environment exists but its API server does not import. ${
            probeResult.stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? ""
          }`.trim(),
    };
  }

  if (!ffmpegPath) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: true,
      systemPython: python,
      serviceRunning: Boolean(serviceUrl),
      reason:
        "No ffmpeg was found, and every stage after the voiceover needs one. Install ffmpeg or set MONEY_PRINTER_FFMPEG_PATH.",
    };
  }

  return {
    ...base,
    // The service is started on demand by the first run, so a stopped service is
    // not a reason to refuse the agent. Nor is an empty key list: a run can
    // still cut from local footage and say so.
    available: true,
    environmentReady: true,
    packageInstalled: true,
    systemPython: python,
    serviceRunning: Boolean(serviceUrl),
    reason: null,
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(
  options: { force?: boolean; availableSources?: () => string[] } = {},
): Promise<MoneyPrinterHealth> {
  const sources = options.availableSources ?? (() => []);
  const cached = globalCache.__breadboardMoneyPrinterHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    // The service can come up or die between probes, and that is cheap to read.
    return {
      ...cached.health,
      serviceRunning: Boolean(currentServiceUrl()),
      serviceUrl: currentServiceUrl(),
      footageSources: sources(),
    };
  }
  if (globalCache.__breadboardMoneyPrinterHealthInFlight) {
    return globalCache.__breadboardMoneyPrinterHealthInFlight;
  }
  const request = probe(sources)
    .then((result) => {
      globalCache.__breadboardMoneyPrinterHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardMoneyPrinterHealthInFlight = undefined;
    });
  globalCache.__breadboardMoneyPrinterHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardMoneyPrinterHealth = undefined;
}
