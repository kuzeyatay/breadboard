// Locating the cloned DeerFlow project and the Python that can run its Gateway.
//
// The clone is a full application, not a library: a FastAPI Gateway with an
// embedded LangGraph runtime, a sandbox, subagent delegation, skills and memory.
// Breadboard therefore drives the real thing over HTTP/SSE rather than
// reimplementing any of it — the same shape as the Vibe Trading and Socials Manager
// integrations.
//
// Only the Gateway is started. The clone's own Next.js frontend and its nginx
// reverse proxy exist to give DeerFlow a chat UI of its own; Breadboard already
// has one, and `deer-flow/scripts/serve.sh` is what a user runs when they want
// the upstream experience instead.
//
// Nothing here installs anything behind a run. The dependency tree is heavy
// (LangGraph, LangChain, FastAPI, e2b, the whole harness workspace), so the
// agent's settings ask, the user agrees, and everything lands in
// `deer-flow/backend/.venv`, which the clone's own .gitignore already covers and
// which "Remove environment" deletes again.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { repositoryRoot } from "../runtime-paths.ts";

export interface DeerFlowRuntime {
  /** Directory of the cloned repository — the project root DeerFlow resolves. */
  root: string;
  /** How the clone was found; surfaced in health so a mislocation is obvious. */
  source: "configured" | "repository" | "cwd";
}

export interface DeerFlowHealth {
  /** Ready to answer a prompt right now (possibly after starting the Gateway). */
  available: boolean;
  /** The clone exists, even when its environment is not built. */
  cloned: boolean;
  root: string | null;
  /** The virtual environment exists and has a Python executable. */
  environmentReady: boolean;
  /** `import app.gateway.app` succeeds inside that environment. */
  packageInstalled: boolean;
  /** uv is on PATH — the only supported way to build this environment. */
  uvAvailable: boolean;
  /** The version string the clone reports, when it can be read. */
  version: string | null;
  /** The supervised Gateway is up and answering /health. */
  serviceRunning: boolean;
  /** Where that Gateway listens, once it has been started. */
  serviceUrl: string | null;
  reason: string | null;
}

// Importing the Gateway imports LangGraph, LangChain and the whole harness, so
// a cold probe is genuinely slow the first time.
const PROBE_TIMEOUT_MS = 180_000;
const HEALTH_CACHE_MS = 20_000;

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

/**
 * A directory is a DeerFlow clone when the Gateway app and the harness package
 * are both there. `pyproject.toml` alone would match half the Python trees on
 * disk.
 */
export function isClone(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "backend", "app", "gateway", "app.py")) &&
    fs.existsSync(path.join(candidate, "backend", "packages", "harness", "deerflow")) &&
    fs.existsSync(path.join(candidate, "backend", "pyproject.toml"))
  );
}

export function resolveDeerFlowRoot(
  env: NodeJS.ProcessEnv = process.env,
): DeerFlowRuntime | null {
  const candidates: Array<{ root: string; source: DeerFlowRuntime["source"] }> = [];
  const explicit = configured(env.DEER_FLOW_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "deer-flow"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "deer-flow"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "deer-flow"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

/**
 * The clone's `backend/` directory — the cwd and import root of the Gateway.
 * It has to be the working directory rather than just be on PYTHONPATH:
 * `backend/sitecustomize.py` is what installs the Windows selector event-loop
 * policy the Gateway needs, and Python only imports it from sys.path.
 */
export function backendDirectory(root: string): string {
  return path.join(root, "backend");
}

export function venvDirectory(root: string): string {
  return path.join(backendDirectory(root), ".venv");
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

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

/** Breadboard's own state directory for this agent, never the clone's. */
export function stateRoot(): string {
  const configured = process.env.DEER_FLOW_STATE_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(repositoryRoot(), ".runtime", "deer-flow");
}

/**
 * Environment for anything the clone runs. Under the desktop shell the
 * dashboard is Electron, so a spawned Node-launched process has to be told to
 * behave as Node; the encoding vars keep Python's own output UTF-8 on Windows,
 * where a report full of typographic quotes would otherwise be mangled by
 * cp1252.
 */
export function deerFlowEnv(
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
  },
): Promise<CommandResult> {
  const limit = options.maxOutputChars ?? 200_000;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        windowsHide: true,
        env: deerFlowEnv(options.env ?? {}),
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
    const manifest = fs.readFileSync(path.join(backendDirectory(root), "pyproject.toml"), "utf8");
    return /^version\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? null;
  } catch {
    return null;
  }
}

interface HealthCache {
  at: number;
  health: DeerFlowHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardDeerFlowHealth?: HealthCache;
  __breadboardDeerFlowHealthInFlight?: Promise<DeerFlowHealth>;
};

/**
 * Read the live Gateway state without importing ./service.ts, which imports this
 * module. Set by the service; absent means nothing has been started yet.
 */
const globalService = globalThis as typeof globalThis & {
  __breadboardDeerFlowServiceUrl?: string | null;
};

export function currentServiceUrl(): string | null {
  return globalService.__breadboardDeerFlowServiceUrl ?? null;
}

export function setCurrentServiceUrl(url: string | null): void {
  globalService.__breadboardDeerFlowServiceUrl = url;
}

async function probe(): Promise<DeerFlowHealth> {
  const runtime = resolveDeerFlowRoot();
  const serviceUrl = currentServiceUrl();
  if (!runtime) {
    return {
      available: false,
      cloned: false,
      root: null,
      environmentReady: false,
      packageInstalled: false,
      uvAvailable: Boolean(uvPath()),
      version: null,
      serviceRunning: false,
      serviceUrl: null,
      reason: "The DeerFlow clone was not found next to the dashboard.",
    };
  }

  const base = {
    cloned: true,
    root: runtime.root,
    version: cloneVersion(runtime.root),
    uvAvailable: Boolean(uvPath()),
    serviceUrl,
  };

  const python = venvPython(runtime.root);
  if (!python) {
    return {
      ...base,
      available: false,
      environmentReady: false,
      packageInstalled: false,
      serviceRunning: false,
      reason:
        "DeerFlow is cloned but its Python environment has not been built yet. Build it from the agent's settings.",
    };
  }

  // Importing the Gateway is the only check that means anything: the venv can
  // exist with a half-finished sync behind it, and this workspace has two local
  // packages (deerflow-harness, deerflow-extension-api) that a partial install
  // silently leaves out.
  const probeResult = await runCommand(
    python,
    ["-c", "import app.gateway.app, uvicorn; print('ok')"],
    {
      cwd: backendDirectory(runtime.root),
      timeoutMs: PROBE_TIMEOUT_MS,
      env: { PYTHONPATH: backendDirectory(runtime.root) },
    },
  );
  const packageInstalled = probeResult.code === 0 && probeResult.stdout.includes("ok");

  if (!packageInstalled) {
    return {
      ...base,
      available: false,
      environmentReady: true,
      packageInstalled: false,
      serviceRunning: false,
      reason: probeResult.timedOut
        ? "The DeerFlow environment did not answer in time."
        : `The DeerFlow environment exists but its Gateway does not import. ${
            probeResult.stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? ""
          }`.trim(),
    };
  }

  return {
    ...base,
    // The Gateway is started on demand by the first run, so a stopped service is
    // not a reason to refuse the agent.
    available: true,
    environmentReady: true,
    packageInstalled: true,
    serviceRunning: Boolean(serviceUrl),
    reason: null,
  };
}

/** Cached because the probe really starts a Python interpreter. */
export async function health(options: { force?: boolean } = {}): Promise<DeerFlowHealth> {
  const cached = globalCache.__breadboardDeerFlowHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    // The Gateway can come up or die between probes, and that is cheap to read.
    return {
      ...cached.health,
      serviceRunning: Boolean(currentServiceUrl()),
      serviceUrl: currentServiceUrl(),
    };
  }
  if (globalCache.__breadboardDeerFlowHealthInFlight) {
    return globalCache.__breadboardDeerFlowHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardDeerFlowHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardDeerFlowHealthInFlight = undefined;
    });
  globalCache.__breadboardDeerFlowHealthInFlight = request;
  return request;
}

/** Drop the cached probe so the next read reflects a setup step just taken. */
export function invalidateHealth(): void {
  globalCache.__breadboardDeerFlowHealth = undefined;
}
