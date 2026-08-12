// Locating the cloned DeepTutor and the Python that can run it.
//
// Like the TradingAgents clone, this is a real Python package with a heavy
// dependency tree (llama-index, FAISS, PyMuPDF, FastAPI). Breadboard never
// installs it behind a run: the agent's settings dialog asks, the user agrees,
// and everything lands in `DeepTutor/.venv` — inside the clone, covered by its
// own .gitignore, and removable by deleting one directory.
//
// Two Breadboard-owned files drive it, both outside the clone so a `git pull`
// there never conflicts: `scripts/deeptutor-bridge.py` runs one turn and
// reports NDJSON, and `scripts/deeptutor-files-mcp.mjs` is the read-only file
// server the tutor reaches its material through.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface DeepTutorRuntime {
  /** Directory of the cloned repository — the cwd of every command. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface DeepTutorHealth {
  /** Ready to teach right now. */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** `import deeptutor` succeeds inside that environment. */
  packageInstalled: boolean;
  /** The MCP client the file server needs is importable there too. */
  mcpInstalled: boolean;
  /** The Python that would build the environment, when there is no venv yet. */
  systemPython: string | null;
  /** uv is on PATH — the only supported way to build the environment. */
  uvAvailable: boolean;
  /** The version string the clone reports, when it can be read. */
  version: string | null;
  /** Both Breadboard-owned scripts are present. */
  bridgeFound: boolean;
  fileServerFound: boolean;
  reason: string | null;
}

const PROBE_TIMEOUT_MS = 90_000;
const HEALTH_CACHE_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/** A directory is a DeepTutor clone when the package and its CLI are there. */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "deeptutor", "app", "facade.py")) &&
    fs.existsSync(path.join(candidate, "deeptutor_cli", "main.py")) &&
    fs.existsSync(path.join(candidate, "pyproject.toml"))
  );
}

export function resolveDeepTutorRoot(
  env: NodeJS.ProcessEnv = process.env,
): DeepTutorRuntime | null {
  const candidates: Array<{ root: string; source: DeepTutorRuntime["source"] }> = [];
  const explicit = configured(env.DEEP_TUTOR_ROOT);
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "DeepTutor"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "DeepTutor"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "DeepTutor"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

function ownScript(name: string): string | null {
  const candidates = [
    path.join(repositoryRoot(), "scripts", name),
    path.resolve(process.cwd(), "scripts", name),
    path.resolve(process.cwd(), "..", "scripts", name),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** The turn bridge, which is Breadboard's own file and not part of the clone. */
export function bridgeScriptPath(): string | null {
  return ownScript("deeptutor-bridge.py");
}

/** The read-only file server the tutor reads its material through. */
export function fileServerScriptPath(): string | null {
  return ownScript("deeptutor-files-mcp.mjs");
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
 * A Python that could stand in if uv is missing. The clone needs >=3.11,<3.14,
 * which the machine's default often is not — that is exactly why the build
 * goes through uv, which fetches its own 3.12. This is reported, not used.
 */
export function findSystemPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.DEEP_TUTOR_PYTHON);
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const name of ["python3", "python"]) {
    const found = resolveOnPath(name, env);
    // The Windows Store alias is a zero-byte reparse point that opens the Store
    // instead of running anything.
    if (found && safeSize(found) > 0) return found;
  }
  return null;
}

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

/** The Node that runs the file server. Under Electron, argv[0] is the shell. */
export function nodeExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = configured(env.DEEP_TUTOR_NODE);
  if (explicit && fs.existsSync(explicit)) return explicit;
  return resolveOnPath("node", env) ?? process.execPath;
}

/**
 * Environment for anything the clone runs. Under the desktop shell the
 * dashboard is Electron, so a spawned Node-launched process has to be told to
 * behave as Node; the encoding vars keep Python's own output UTF-8 on Windows,
 * where the bridge's JSON would otherwise be mangled by cp1252.
 */
export function deepTutorEnv(
  extra: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
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
    onChild?: (kill: () => void) => void;
    onStdout?: (chunk: string) => void;
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: deepTutorEnv(options.env ?? {}),
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
    options.onChild?.(() => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      options.onStdout?.(chunk);
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
  for (const relative of [
    ["deeptutor", "__version__.py"],
    ["pyproject.toml"],
  ]) {
    try {
      const text = fs.readFileSync(path.join(root, ...relative), "utf8");
      const found =
        /__version__\s*=\s*["']([^"']+)["']/.exec(text)?.[1] ??
        /^version\s*=\s*"([^"]+)"/m.exec(text)?.[1];
      if (found) return found;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

interface HealthCache {
  at: number;
  health: DeepTutorHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardDeepTutorHealth?: HealthCache;
  __breadboardDeepTutorHealthInFlight?: Promise<DeepTutorHealth>;
};

async function probe(): Promise<DeepTutorHealth> {
  const runtime = resolveDeepTutorRoot();
  const bridgeFound = Boolean(bridgeScriptPath());
  const fileServerFound = Boolean(fileServerScriptPath());
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      environmentReady: false,
      packageInstalled: false,
      mcpInstalled: false,
      systemPython: findSystemPython(),
      uvAvailable: Boolean(uvPath()),
      version: null,
      bridgeFound,
      fileServerFound,
      reason: "The DeepTutor clone was not found next to the dashboard.",
    };
  }

  const base = {
    cloned: true,
    root: runtime.root,
    version: cloneVersion(runtime.root),
    uvAvailable: Boolean(uvPath()),
    bridgeFound,
    fileServerFound,
  };

  const python = venvPython(runtime.root);
  if (!python) {
    return {
      ...base,
      available: false,
      environmentReady: false,
      packageInstalled: false,
      mcpInstalled: false,
      systemPython: findSystemPython(),
      reason:
        "Deep Tutor is cloned but its Python environment has not been built yet. Build it from its settings.",
    };
  }

  // Importing the package is the only check that means anything: the venv can
  // exist with a half-finished install behind it. `mcp` is checked in the same
  // breath because without it the tutor can start and then be blind to every
  // file — a failure that would otherwise look like a bad answer.
  const probeResult = await runCommand(
    python,
    [
      "-c",
      "import importlib.util as u; import deeptutor; from deeptutor.app import DeepTutorApp;"
        + " print('ok mcp' if u.find_spec('mcp') else 'ok')",
    ],
    { cwd: runtime.root, timeoutMs: PROBE_TIMEOUT_MS },
  );
  const packageInstalled = probeResult.code === 0 && probeResult.stdout.includes("ok");
  const mcpInstalled = probeResult.stdout.includes("ok mcp");

  if (!packageInstalled) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: false,
      mcpInstalled: false,
      systemPython: python,
      reason: probeResult.timedOut
        ? "The Deep Tutor environment did not answer in time."
        : `The Deep Tutor environment exists but the package does not import. ${
            probeResult.stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? ""
          }`.trim(),
    };
  }

  if (!bridgeFound || !fileServerFound) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: true,
      mcpInstalled,
      systemPython: python,
      reason: `Breadboard's Deep Tutor ${
        bridgeFound ? "file server" : "bridge"
      } script is missing from scripts/.`,
    };
  }

  return {
    ...base,
    available: true,
    environmentReady: true,
    packageInstalled: true,
    mcpInstalled,
    systemPython: python,
    // Runnable without `mcp`, just not able to read anything — worth saying,
    // not worth blocking on.
    reason: mcpInstalled
      ? null
      : "Deep Tutor can answer but cannot read your material: the `mcp` package is missing from its environment. Rebuild it from its settings.",
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(options: { force?: boolean } = {}): Promise<DeepTutorHealth> {
  const cached = globalCache.__breadboardDeepTutorHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    return cached.health;
  }
  if (globalCache.__breadboardDeepTutorHealthInFlight) {
    return globalCache.__breadboardDeepTutorHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardDeepTutorHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardDeepTutorHealthInFlight = undefined;
    });
  globalCache.__breadboardDeepTutorHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardDeepTutorHealth = undefined;
}
