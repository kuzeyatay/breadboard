import {
  acquireServiceLease,
  isRuntimeV2ServiceControlConfigured,
  readSupervisedServiceSnapshot,
  releaseSupervisorLease,
  type SupervisorLease,
  type SupervisedServiceId,
} from "../supervisor-control.ts";

export type RuntimeAgentServiceId = Extract<
  SupervisedServiceId,
  "deep-research" | "deer-flow" | "vibe-trading" | "stock-analyst"
>;

const LEASE_ROTATION_MS = 5 * 60_000;
const ROTATION_RETRY_MS = 10_000;
const LEASE_GRACE_MS = 2 * 60_000;
const MAX_OPERATION_MS = 2 * 60 * 60_000;
const ALREADY_RUNNING = new Set([
  "starting",
  "healthy",
  "degraded",
  "ready",
  "busy",
]);

interface ActiveLease {
  readonly key: string;
  readonly serviceId: RuntimeAgentServiceId;
  readonly userId: number;
  readonly runId: string;
  readonly coldStart: boolean;
  lease: SupervisorLease;
  acquiredAt: number;
  readonly expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface LeaseState {
  readonly leases: Map<string, ActiveLease>;
  readonly operations: Map<string, Promise<unknown>>;
}

const leaseGlobal = globalThis as typeof globalThis & {
  __breadboardRuntimeAgentServiceLeases?: LeaseState;
};

function state(): LeaseState {
  if (!leaseGlobal.__breadboardRuntimeAgentServiceLeases) {
    leaseGlobal.__breadboardRuntimeAgentServiceLeases = {
      leases: new Map(),
      operations: new Map(),
    };
  }
  return leaseGlobal.__breadboardRuntimeAgentServiceLeases;
}

function leaseKey(serviceId: RuntimeAgentServiceId, runId: string): string {
  return `${serviceId}:${runId}`;
}

async function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const leaseState = state();
  const previous = leaseState.operations.get(key);
  const current = (async () => {
    if (previous) await previous.catch(() => undefined);
    return operation();
  })();
  leaseState.operations.set(key, current);
  try {
    return await current;
  } finally {
    if (leaseState.operations.get(key) === current) {
      leaseState.operations.delete(key);
    }
  }
}

function schedule(entry: ActiveLease, retryInMs?: number): void {
  if (entry.timer) clearTimeout(entry.timer);
  const now = Date.now();
  const delay = retryInMs ?? Math.min(
    Math.max(1, entry.acquiredAt + LEASE_ROTATION_MS - now),
    Math.max(1, entry.expiresAt - now),
  );
  const timer = setTimeout(() => {
    void serialize(entry.key, async () => {
      const current = state().leases.get(entry.key);
      if (current !== entry) return;
      const currentTime = Date.now();
      if (currentTime >= current.expiresAt) {
        state().leases.delete(entry.key);
        current.timer = null;
        await releaseSupervisorLease(current.lease);
        return;
      }
      try {
        const replacement = await acquireServiceLease(
          current.serviceId,
          `active-${current.serviceId}-run`,
        );
        if (!replacement) {
          schedule(current, ROTATION_RETRY_MS);
          return;
        }
        const previous = current.lease;
        current.lease = replacement;
        current.acquiredAt = currentTime;
        await releaseSupervisorLease(previous);
        schedule(current);
      } catch {
        // The original admission error was already returned by the run-start
        // request. Keep its current claim and retry within the bounded hold.
        schedule(current, ROTATION_RETRY_MS);
      }
    });
  }, delay);
  timer.unref?.();
  entry.timer = timer;
}

/**
 * Acquire before a managed run is admitted and keep the claim independently
 * of any one browser/SSE connection. A dashboard without Runtime V2 can still
 * address an explicitly configured external endpoint, but it never starts it.
 */
export async function holdRuntimeAgentServiceLease(
  serviceId: RuntimeAgentServiceId,
  userId: number,
  runId: string,
  requestedOperationMs = MAX_OPERATION_MS - LEASE_GRACE_MS,
): Promise<boolean> {
  if (!isRuntimeV2ServiceControlConfigured()) return false;
  const key = leaseKey(serviceId, runId);
  return serialize(key, async () => {
    const existing = state().leases.get(key);
    if (existing) return existing.userId === userId;

    const before = await readSupervisedServiceSnapshot(serviceId).catch(() => null);
    const coldStart = !before || !ALREADY_RUNNING.has(before.state);
    const lease = await acquireServiceLease(serviceId, `active-${serviceId}-run`);
    if (!lease) return false;
    const now = Date.now();
    const finiteRequested = Number.isFinite(requestedOperationMs)
      ? requestedOperationMs
      : MAX_OPERATION_MS - LEASE_GRACE_MS;
    const boundedOperationMs = Math.min(
      Math.max(5_000, finiteRequested),
      MAX_OPERATION_MS - LEASE_GRACE_MS,
    );
    const entry: ActiveLease = {
      key,
      serviceId,
      userId,
      runId,
      coldStart,
      lease,
      acquiredAt: now,
      expiresAt: now + boundedOperationMs + LEASE_GRACE_MS,
      timer: null,
    };
    state().leases.set(key, entry);
    schedule(entry);
    return true;
  });
}

/** Whether this admission had to wake a stopped service. External mode is warm. */
export function runtimeAgentServiceLeaseWasColdStart(
  serviceId: RuntimeAgentServiceId,
  userId: number,
  runId: string,
): boolean {
  const entry = state().leases.get(leaseKey(serviceId, runId));
  return Boolean(entry && entry.userId === userId && entry.coldStart);
}

/** Recreate a bounded claim after a dashboard worker restart. */
export function ensureRuntimeAgentServiceLease(
  serviceId: RuntimeAgentServiceId,
  userId: number,
  runId: string,
  requestedOperationMs?: number,
): Promise<boolean> {
  return holdRuntimeAgentServiceLease(serviceId, userId, runId, requestedOperationMs);
}

export async function releaseRuntimeAgentServiceLease(
  serviceId: RuntimeAgentServiceId,
  userId: number,
  runId: string,
): Promise<void> {
  const key = leaseKey(serviceId, runId);
  await serialize(key, async () => {
    const entry = state().leases.get(key);
    if (!entry || entry.userId !== userId) return;
    state().leases.delete(key);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    await releaseSupervisorLease(entry.lease);
  });
}
