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

export interface StockAnalystRuntime {
  root: string;
  source: "configured" | "repository" | "cwd";
}

export interface StockAnalystHealth {
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
    externalRuntimePathExists(path.join(candidate, "main.py")) &&
    externalRuntimePathExists(path.join(candidate, "server.py")) &&
    externalRuntimePathExists(path.join(candidate, "api", "app.py")) &&
    externalRuntimePathExists(path.join(candidate, "api", "v1", "endpoints", "agent.py"))
  );
}

export function resolveStockAnalystRoot(
  env: NodeJS.ProcessEnv = process.env,
): StockAnalystRuntime | null {
  const candidates: Array<{ root: string; source: StockAnalystRuntime["source"] }> = [];
  const explicit = configured(env.STOCK_ANALYST_ROOT);
  if (env.BREADBOARD_QA_MODE === "1") {
    return explicit && isClone(explicit)
      ? { root: explicit, source: "configured" }
      : null;
  }
  if (explicit) candidates.push({ root: explicit, source: "configured" });
  candidates.push({
    root: path.join(repositoryRoot(), "daily_stock_analysis"),
    source: "repository",
  });
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

export function venvDirectory(root: string): string {
  void root;
  return runtimeV2ServiceVenv("stock-analyst");
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
  const explicit = configured(env.STOCK_ANALYST_PYTHON);
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

export function stateHome(): string {
  const configuredHome = process.env.STOCK_ANALYST_HOME?.trim();
  if (configuredHome) return path.resolve(configuredHome);
  const dataRoot = process.env.BREADBOARD_DATA_DIR?.trim();
  return dataRoot
    ? path.join(path.resolve(dataRoot), "runtime", "stock-analyst")
    : path.join(repositoryRoot(), ".runtime", "stock-analyst");
}

export function cloneVersion(root: string): string | null {
  try {
    const manifest = JSON.parse(
      externalRuntimeReadUtf8(path.join(root, "apps", "dsa-desktop", "package.json")),
    ) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

interface HealthCache {
  at: number;
  health: StockAnalystHealth;
}

const globalCache = globalThis as typeof globalThis & {
  __breadboardStockAnalystHealth?: HealthCache;
  __breadboardStockAnalystHealthInFlight?: Promise<StockAnalystHealth>;
};

async function externalServiceRunning(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/api/v1/health", url), {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function probe(): Promise<StockAnalystHealth> {
  const runtime = resolveStockAnalystRoot();
  const python = runtime ? venvPython(runtime.root) : null;
  let endpoint: ReturnType<typeof resolveManagedServiceEndpoint> = null;
  try {
    endpoint = resolveManagedServiceEndpoint("stock-analyst");
  } catch {
    // Reported as unavailable below without exposing configuration.
  }

  let lifecycle: SupervisedServiceLifecycleState | null = null;
  let serviceRunning = false;
  if (isRuntimeV2ServiceControlConfigured()) {
    try {
      const snapshot = await readSupervisedServiceSnapshot("stock-analyst");
      lifecycle = snapshot?.state ?? null;
      serviceRunning = lifecycle !== null && RUNNING_STATES.has(lifecycle);
    } catch {
      lifecycle = null;
    }
  } else if (endpoint) {
    serviceRunning = await externalServiceRunning(endpoint.url);
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
        ? "The daily_stock_analysis clone was not found next to the dashboard."
        : !python
          ? "Stock Analyst's environment is not installed. Build it from its settings."
          : lifecycle === "resource-blocked"
            ? "Stock Analyst is waiting for enough memory headroom."
            : lifecycle === "failed"
              ? "The Stock Analyst Runtime service failed."
              : "The Stock Analyst Runtime service is unavailable.",
  };
}

export async function health(options: { force?: boolean } = {}): Promise<StockAnalystHealth> {
  const cached = globalCache.__breadboardStockAnalystHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    return cached.health;
  }
  if (globalCache.__breadboardStockAnalystHealthInFlight) {
    return globalCache.__breadboardStockAnalystHealthInFlight;
  }
  const request = probe()
    .then((result) => {
      globalCache.__breadboardStockAnalystHealth = { at: Date.now(), health: result };
      return result;
    })
    .finally(() => {
      globalCache.__breadboardStockAnalystHealthInFlight = undefined;
    });
  globalCache.__breadboardStockAnalystHealthInFlight = request;
  return request;
}

export function invalidateHealth(): void {
  globalCache.__breadboardStockAnalystHealth = undefined;
}
