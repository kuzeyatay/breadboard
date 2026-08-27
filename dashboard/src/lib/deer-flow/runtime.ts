import path from "node:path";
import { repositoryRoot, runtimeV2ServiceVenv } from "../runtime-paths.ts";
import {
  externalRuntimePathExists,
  externalRuntimeReadUtf8,
} from "../external-runtime-filesystem.ts";
import {
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  type SupervisedServiceLifecycleState,
} from "../supervisor-control.ts";
import { resolveManagedServiceEndpoint } from "../runtime-v2/managed-service-endpoint.ts";

export interface DeerFlowRuntime {
  root: string;
  source: "configured" | "repository" | "cwd";
}

export interface DeerFlowHealth {
  available: boolean;
  cloned: boolean;
  root: string | null;
  environmentReady: boolean;
  packageInstalled: boolean;
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
    externalRuntimePathExists(path.join(candidate, "backend", "app", "gateway", "app.py")) &&
    externalRuntimePathExists(path.join(candidate, "backend", "packages", "harness", "deerflow")) &&
    externalRuntimePathExists(path.join(candidate, "backend", "pyproject.toml"))
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
  return candidates.find((candidate) => isClone(candidate.root)) ?? null;
}

export function backendDirectory(root: string): string {
  return path.join(root, "backend");
}

export function venvDirectory(root: string): string {
  void root;
  return runtimeV2ServiceVenv("deer-flow");
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

export function uvPath(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveOnPath("uv", env);
}

export function stateRoot(): string {
  const configuredRoot = process.env.DEER_FLOW_STATE_DIR?.trim();
  return configuredRoot
    ? path.resolve(configuredRoot)
    : path.join(repositoryRoot(), ".runtime", "deer-flow");
}

export function cloneVersion(root: string): string | null {
  try {
    const manifest = externalRuntimeReadUtf8(path.join(backendDirectory(root), "pyproject.toml"));
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

async function externalServiceRunning(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", url), {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function probe(): Promise<DeerFlowHealth> {
  const runtime = resolveDeerFlowRoot();
  const environmentReady = Boolean(runtime && venvPython(runtime.root));
  let endpoint: ReturnType<typeof resolveManagedServiceEndpoint> = null;
  try {
    endpoint = resolveManagedServiceEndpoint("deer-flow");
  } catch {
    // A malformed/missing Runtime endpoint is reported as unavailable below.
  }

  let serviceRunning = false;
  let lifecycle: SupervisedServiceLifecycleState | null = null;
  if (isRuntimeV2ServiceControlConfigured()) {
    try {
      const snapshot = await readSupervisedServiceSnapshot("deer-flow");
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
      : environmentReady;
  const available =
    Boolean(endpoint) &&
    installed &&
    lifecycle !== "failed" &&
    lifecycle !== "resource-blocked";

  return {
    available,
    cloned: Boolean(runtime),
    root: runtime?.root ?? null,
    environmentReady,
    packageInstalled: installed,
    uvAvailable: Boolean(uvPath()),
    version: runtime ? cloneVersion(runtime.root) : null,
    serviceRunning,
    serviceUrl: null,
    reason: available
      ? null
      : !runtime
        ? "The DeerFlow clone was not found next to the dashboard."
        : !environmentReady
          ? "DeerFlow's environment is not installed. Build it from the agent's settings."
          : lifecycle === "resource-blocked"
            ? "DeerFlow is waiting for enough memory headroom."
            : lifecycle === "failed"
              ? "The DeerFlow Runtime service failed."
              : "The DeerFlow Runtime service is unavailable.",
  };
}

export async function health(options: { force?: boolean } = {}): Promise<DeerFlowHealth> {
  const cached = globalCache.__breadboardDeerFlowHealth;
  if (!options.force && cached && Date.now() - cached.at < HEALTH_CACHE_MS) {
    return cached.health;
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

export function invalidateHealth(): void {
  globalCache.__breadboardDeerFlowHealth = undefined;
}
