import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  deepResearchMode,
  resolveDeepResearchConfig,
} from "./config.ts";

type RuntimeState = {
  child: ChildProcess | null;
  startup: Promise<boolean> | null;
};

const globalRuntime = globalThis as typeof globalThis & {
  __breadboardDeepResearchRuntime?: RuntimeState;
};
const runtime =
  globalRuntime.__breadboardDeepResearchRuntime ??
  ({ child: null, startup: null } satisfies RuntimeState);
globalRuntime.__breadboardDeepResearchRuntime = runtime;

function autostartEnabled(env: NodeJS.ProcessEnv): boolean {
  return !/^(0|false|no|off)$/i.test(
    env.DEEP_RESEARCH_AUTOSTART?.trim() ?? "",
  );
}

function loopbackServiceUrl(env: NodeJS.ProcessEnv): URL | null {
  try {
    const url = new URL(resolveDeepResearchConfig(env).serviceUrl);
    if (url.protocol !== "http:") return null;
    if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function repoCandidates(env: NodeJS.ProcessEnv): string[] {
  return [
    env.BREADBOARD_REPO_ROOT?.trim(),
    process.cwd(),
    path.resolve(process.cwd(), ".."),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

/**
 * The Hermes interpreter, handed to the engine for keyless search.
 *
 * The engine's fallback backend queries DuckDuckGo, which answers a plain HTTP
 * client with a challenge page often enough to be unreliable. Hermes already
 * carries `ddgs`, which gets through because it impersonates a browser's TLS
 * fingerprint, so the engine borrows that interpreter rather than shipping a
 * scraper that works half the time. Absent it, the engine scrapes directly.
 */
function ddgsPython(env: NodeJS.ProcessEnv): string | null {
  const relative =
    process.platform === "win32"
      ? path.join(".venv", "Scripts", "python.exe")
      : path.join(".venv", "bin", "python");
  for (const root of repoCandidates(env)) {
    const interpreter = path.join(root, "hermes-agent", relative);
    if (fs.existsSync(interpreter)) return interpreter;
  }
  return null;
}

function resolveEngine(env: NodeJS.ProcessEnv): {
  root: string;
  entry: string;
  tsx: string;
} | null {
  const candidates = repoCandidates(env);
  for (const root of candidates) {
    const engineRoot = path.join(root, "deep-research");
    const entry = path.join(engineRoot, "src", "api.ts");
    const tsx = path.join(
      engineRoot,
      "node_modules",
      "tsx",
      "dist",
      "cli.mjs",
    );
    if (fs.existsSync(entry) && fs.existsSync(tsx)) {
      return { root: engineRoot, entry, tsx };
    }
  }
  return null;
}

async function responds(url: URL): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(new URL("/health", url), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const health = (await response.json().catch(() => null)) as {
      status?: unknown;
      engine?: unknown;
    } | null;
    // Several Breadboard sidecars expose /health. A 200 alone is not identity:
    // accepting Postiz here made Deep Research look started on the wrong port.
    return (
      health?.status === "ok" &&
      health.engine === "open-deep-research"
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function startLocalService(env: NodeJS.ProcessEnv): Promise<boolean> {
  if (deepResearchMode(env) === "disabled" || !autostartEnabled(env)) {
    return false;
  }
  const serviceUrl = loopbackServiceUrl(env);
  const engine = resolveEngine(env);
  const config = resolveDeepResearchConfig(env);
  if (!serviceUrl || !engine || !config.secret.trim()) return false;
  if (await responds(serviceUrl)) return true;

  if (!runtime.child || runtime.child.exitCode !== null) {
    // Next's development worker is replaced during hot reloads. Keep a research
    // run alive across that transient parent exit; the next worker reuses the
    // authenticated loopback service after its health check.
    const surviveWorkerRestart = env.NODE_ENV === "development";
    const child = spawn(process.execPath, [engine.tsx, engine.entry], {
      cwd: engine.root,
      detached: surviveWorkerRestart,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...env,
        DEEP_RESEARCH_HOST: "127.0.0.1",
        DEEP_RESEARCH_PORT:
          serviceUrl.port || (serviceUrl.protocol === "http:" ? "80" : "443"),
        DEEP_RESEARCH_SECRET: config.secret,
        CHATMOCK_BASE_URL:
          env.CHATMOCK_BASE_URL?.trim() || "http://127.0.0.1:8765/v1",
        CHATMOCK_API_KEY: env.CHATMOCK_API_KEY?.trim() || "local",
        CHATMOCK_MODEL: env.CHATMOCK_MODEL?.trim() || "default",
        CONTEXT_SIZE: env.CONTEXT_SIZE?.trim() || "128000",
        DEEP_RESEARCH_STEP_TIMEOUT_MS:
          env.DEEP_RESEARCH_STEP_TIMEOUT_MS?.trim() || "180000",
        DEEP_RESEARCH_MAX_CONCURRENT_RUNS:
          env.DEEP_RESEARCH_MAX_CONCURRENT_RUNS?.trim() || "2",
        DEEP_RESEARCH_SEARCH_PROVIDER:
          env.DEEP_RESEARCH_SEARCH_PROVIDER?.trim() || "auto",
        ...(ddgsPython(env)
          ? { DEEP_RESEARCH_DDGS_PYTHON: ddgsPython(env) as string }
          : {}),
        DEEP_RESEARCH_SEARCH_TIMEOUT_MS:
          env.DEEP_RESEARCH_SEARCH_TIMEOUT_MS?.trim() || "300000",
        DEEP_RESEARCH_CONCURRENCY:
          env.DEEP_RESEARCH_CONCURRENCY?.trim() || "2",
      },
    });
    runtime.child = child;
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal) {
        console.error(
          `[deep-research] local service exited (code=${code ?? "none"}, signal=${signal ?? "none"})`,
        );
      }
      if (runtime.child === child) runtime.child = null;
    });
    child.once("error", (error) => {
      console.error(`[deep-research] local service failed to start: ${error.message}`);
      if (runtime.child === child) runtime.child = null;
    });
    if (surviveWorkerRestart) child.unref();
  }

  // `tsx` plus the engine imports can take several seconds on a cold Windows
  // start. Keep the first launch inside this request long enough for the real
  // service to bind instead of racing it with an immediate POST /runs.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await responds(serviceUrl)) return true;
    if (!runtime.child || runtime.child.exitCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  return false;
}

/**
 * Recover the bundled/local Deep Research sidecar when a chat first selects
 * the agent. Concurrent health checks share one startup attempt.
 */
export async function ensureDeepResearchService(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const serviceUrl = loopbackServiceUrl(env);
  if (!serviceUrl) return false;
  if (await responds(serviceUrl)) return true;
  if (!runtime.startup) {
    runtime.startup = startLocalService(env).finally(() => {
      runtime.startup = null;
    });
  }
  return runtime.startup;
}
