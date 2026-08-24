// Do not let an accidental Client Component import turn this server-side
// control surface into browser code. Only non-NEXT_PUBLIC environment keys are
// read below, so the per-launch bearer is never compiled into a client bundle.
if (typeof window !== "undefined") {
  throw new Error("Breadboard supervisor control is server-only.");
}

const CONTROL_TIMEOUT_MS = 4 * 60_000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type SupervisedServiceId =
  | "hermes"
  | "quartz"
  | "gbrain"
  | "ui-tars"
  | "cad"
  | "colpali"
  | "humanizer"
  | "voicebox"
  | "scriberr";

export type SupervisedCapabilityId =
  | "learn-worker"
  | "document-ingestion"
  | "artifact-render"
  | "browser-agent"
  | "postiz-stack";

export interface SupervisorLease {
  id: string;
  targetId: string;
}

export interface ResourceExhaustionResult {
  code: "BREADBOARD_RESOURCE_EXHAUSTED";
  resource: "windows_commit";
  requiredHeadroomMb: number;
  availableHeadroomMb: number;
  retryable: false;
  state: "normal" | "constrained" | "critical" | "emergency";
}

export class SupervisorResourceExhaustedError extends Error {
  readonly result: ResourceExhaustionResult;

  constructor(result: ResourceExhaustionResult) {
    super(
      `Breadboard needs ${result.requiredHeadroomMb} MB of free Windows commit ` +
        `for this operation; ${result.availableHeadroomMb} MB is available.`,
    );
    this.name = "SupervisorResourceExhaustedError";
    this.result = result;
  }
}

interface Endpoint {
  origin: string;
  token: string;
}

function endpoint(env: NodeJS.ProcessEnv = process.env): Endpoint | null {
  const raw = env.BREADBOARD_SUPERVISOR_CONTROL_URL?.trim();
  const token = env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN?.trim();
  if (!raw || !token) return null;
  const url = new URL(raw);
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname)) {
    throw new Error("Breadboard supervisor control URL must use HTTP on loopback.");
  }
  return { origin: url.origin, token };
}

function isResourceResult(value: unknown): value is ResourceExhaustionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<ResourceExhaustionResult>;
  return (
    record.code === "BREADBOARD_RESOURCE_EXHAUSTED" &&
    record.resource === "windows_commit" &&
    typeof record.requiredHeadroomMb === "number" &&
    typeof record.availableHeadroomMb === "number" &&
    record.retryable === false
  );
}

async function control<T>(
  path: string,
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<T | null> {
  const target = endpoint(env);
  // Bare dashboard development has no Electron lifecycle owner. Preserve that
  // supported workflow; services launched by `npm run dev` remain external.
  if (!target) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTROL_TIMEOUT_MS);
  try {
    const response = await fetch(`${target.origin}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const result: unknown = await response.json().catch(() => null);
    if (isResourceResult(result)) throw new SupervisorResourceExhaustedError(result);
    if (!response.ok) throw new Error(`Supervisor control request failed (${response.status}).`);
    return result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function acquireServiceLease(
  serviceId: SupervisedServiceId,
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupervisorLease | null> {
  const result = await control<{ leaseId?: unknown; serviceId?: unknown }>(
    `/v1/services/${serviceId}/lease`,
    { reason },
    env,
  );
  if (!result) return null;
  if (typeof result.leaseId !== "string" || result.serviceId !== serviceId) {
    throw new Error("Supervisor returned an invalid service lease.");
  }
  return { id: result.leaseId, targetId: serviceId };
}

export async function acquireCapabilityLease(
  capabilityId: SupervisedCapabilityId,
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SupervisorLease | null> {
  const result = await control<{ leaseId?: unknown; capabilityId?: unknown }>(
    `/v1/capabilities/${capabilityId}/lease`,
    { reason },
    env,
  );
  if (!result) return null;
  if (typeof result.leaseId !== "string" || result.capabilityId !== capabilityId) {
    throw new Error("Supervisor returned an invalid capability lease.");
  }
  return { id: result.leaseId, targetId: capabilityId };
}

export async function releaseSupervisorLease(
  lease: SupervisorLease | string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const id = typeof lease === "string" ? lease : lease?.id;
  if (!id) return;
  await control(`/v1/leases/${encodeURIComponent(id)}/release`, {}, env).catch(() => null);
}

export async function withServiceLease<T>(
  serviceId: SupervisedServiceId,
  reason: string,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const lease = await acquireServiceLease(serviceId, reason, env);
  try {
    return await operation();
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}

export async function withCapabilityLease<T>(
  capabilityId: SupervisedCapabilityId,
  reason: string,
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const lease = await acquireCapabilityLease(capabilityId, reason, env);
  try {
    return await operation();
  } finally {
    await releaseSupervisorLease(lease, env);
  }
}
