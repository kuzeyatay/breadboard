import path from "node:path";
import { repositoryRoot, runtimeV2ServiceVenv } from "../runtime-paths.ts";
import {
  externalRuntimePathExists,
  externalRuntimeReadUtf8,
  externalRuntimeStat,
} from "../external-runtime-filesystem.ts";
import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  type SupervisedServiceLifecycleState,
} from "../supervisor-control.ts";
import { resolveManagedServiceEndpoint } from "../runtime-v2/managed-service-endpoint.ts";

export interface VibeTradingRuntime {
  root: string;
  source: "configured" | "repository" | "cwd";
}

export interface VibeTradingHealth {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  packageInstalled: boolean;
  systemPython: string | null;
  uvAvailable: boolean;
  version: string | null;
  serviceRunning: boolean;
  serviceUrl: string | null;
  reason: string | null;
}

const HEALTH_CACHE_MS = 5_000;
const RUNNING_STATES = new Set<SupervisedServiceLifecycleState>([
  "starting",
  "healthy",
  "degraded",
  "ready",
  "busy",
]);

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
}

export function isClone(candidate: string): boolean {
  return (
    externalRuntimePathExists(path.join(candidate, "agent", "api_server.py")) &&
    externalRuntimePathExists(path.join(candidate, "agent", "src", "agent", "loop.py")) &&
    externalRuntimePathExists(path.join(candidate, "pyproject.toml"))
  );
}

export function resolveVibeTradingRoot(
  env: NodeJS.ProcessEnv = process.env,
): VibeTradingRuntime | null {
  const candidates: Array<{ root: string; source: VibeTradingRuntime["source"] }> = [];
  const explicit = configured(env.VIBE_TRADING_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({ root: path.join(repositoryRoot(), "Vibe-Trading"), source: "repository" });
  candidates.push({ root: path.resolve(process.cwd(), "Vibe-Trading"), source: "cwd" });
  candidates.push({ root: path.resolve(process.cwd(), "..", "Vibe-Trading"), source: "cwd" });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

export function agentDirectory(root: string): string {
  return path.join(root, "agent");
}

export function venvDirectory(root: string): string {
  void root;
  return runtimeV2ServiceVenv("vibe-trading");
}

export function venvPython(root: string): string | null {
  const candidate =
    process.platform === "win32"
      ? path.join(venvDirectory(root), "Scripts", "python.exe")
      : path.join(venvDirectory(root), "bin", "python");
  return externalRuntimePathExists(candidate) ? candidate : null;
}

export function resolveOnPath(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (path.isAbsolute(executable)) return externalRuntimePathExists(executable) ? executable : null;
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const directories = (env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`);
      if (externalRuntimePathExists(candidate)) return candidate;
    }
  }
  return null;
}

function safeSize(file: string): number {
  try {
    return externalRuntimeStat(file).size;
  } catch {
    return 0;
  }
}

export function findSystemPython(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = configured(env.VIBE_TRADING_PYTHON);
  if (explicit && externalRuntimePathExists(explicit)) return explicit;
  for (const name of ["python3", "python"]) {
    const found = resolveOnPath(name, env);
    if (found && safeSize(found) > 0) return found;
  }
  return null;
}

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

export function cloneVersion(root: string): string | null {
  try {
    const manifest = externalRuntimeReadUtf8(path.join(root, "pyproject.toml"));
    return /^version\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? null;
  } catch {
    return null;
  }
}

interface HealthCache {
  at: number;
  health: VibeTradingHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardVibeTradingHealth?: HealthCache;
  __breadboardVibeTradingHealthInFlight?: Promise<VibeTradingHealth>;
};

async function externalServiceRunning(url: string, apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", url), {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function probe(): Promise<VibeTradingHealth> {
  const runtime = resolveVibeTradingRoot();
  const python = runtime ? venvPython(runtime.root) : null;
  let endpoint: ReturnType<typeof resolveManagedServiceEndpoint> = null;
  try {
    endpoint = resolveManagedServiceEndpoint("vibe-trading");
  } catch {
    // Reported as unavailable below without leaking configuration.
  }

  let lifecycle: SupervisedServiceLifecycleState | null = null;
  let serviceRunning = false;
  if (isRuntimeV2ServiceControlConfigured()) {
    try {
      const snapshot = await readSupervisedServiceSnapshot("vibe-trading");
      lifecycle = snapshot?.state ?? null;
      serviceRunning = lifecycle !== null && RUNNING_STATES.has(lifecycle);
    } catch {
      lifecycle = null;
    }
  } else if (endpoint) {
    serviceRunning = await externalServiceRunning(endpoint.url, endpoint.apiKey);
  }

  const installed =
    lifecycle !== null
      ? lifecycle !== "installation-unavailable"
      : Boolean(python);
  const available =
    Boolean(endpoint) &&
    installed &&
    lifecycle !== "failed" &&
    lifecycle !== "resource-blocked";

  return {
    available,
    cloned: Boolean(runtime),
    root: runtime?.root ?? null,
    environmentReady: Boolean(python),
    packageInstalled: installed,
    systemPython: python ?? findSystemPython(),
    uvAvailable: Boolean(uvPath()),
    version: runtime ? cloneVersion(runtime.root) : null,
    serviceRunning,
    serviceUrl: null,
    reason: available
      ? null
      : !runtime
        ? "The Vibe-Trading clone was not found next to the dashboard."
        : !python
          ? "Vibe Trading's environment is not installed. Build it from its settings."
          : lifecycle === "resource-blocked"
            ? "Vibe Trading is waiting for enough memory headroom."
            : lifecycle === "failed"
              ? "The Vibe Trading Runtime service failed."
              : "The Vibe Trading Runtime service is unavailable.",
  };
}

export async function health(options: { force?: boolean } = {}): Promise<VibeTradingHealth> {
  const cached = globalCache.__breadboardVibeTradingHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    return cached.health;
  }
  if (globalCache.__breadboardVibeTradingHealthInFlight) {
    return globalCache.__breadboardVibeTradingHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardVibeTradingHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardVibeTradingHealthInFlight = undefined;
    });
  globalCache.__breadboardVibeTradingHealthInFlight = request;
  return request;
}

export function invalidateHealth(): void {
  globalCache.__breadboardVibeTradingHealth = undefined;
}
