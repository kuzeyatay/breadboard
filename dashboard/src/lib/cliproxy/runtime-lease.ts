import "server-only";

import {
  acquireServiceLease,
  releaseSupervisorLease,
  type SupervisorLease,
} from "../supervisor-control.ts";

const LOGIN_LEASE_DEFAULT_MS = 15 * 60_000;
const LOGIN_LEASE_MIN_MS = 60_000;
const LOGIN_LEASE_ROTATION_MS = 5 * 60_000;
const LOGIN_LEASE_ROTATION_RETRY_MS = 10_000;
const MAX_LOGIN_LEASES_PER_USER = 4;

interface LoginLease {
  readonly userId: number;
  readonly state: string;
  lease: SupervisorLease;
  acquiredAt: number;
  readonly expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RuntimeLeaseState {
  readonly loginLeases: Map<string, LoginLease>;
  readonly operations: Map<string, Promise<unknown>>;
}

const stateGlobal = globalThis as typeof globalThis & {
  __breadboardCliproxyRuntimeLeaseState?: RuntimeLeaseState;
};

function state(): RuntimeLeaseState {
  if (!stateGlobal.__breadboardCliproxyRuntimeLeaseState) {
    stateGlobal.__breadboardCliproxyRuntimeLeaseState = {
      loginLeases: new Map(),
      operations: new Map(),
    };
  }
  return stateGlobal.__breadboardCliproxyRuntimeLeaseState;
}

function key(userId: number, loginState: string): string {
  return `${userId}:${loginState}`;
}

function admissionKey(userId: number): string {
  return `login-admission:${userId}`;
}

async function serialize<T>(operationKey: string, operation: () => Promise<T>): Promise<T> {
  const runtimeState = state();
  const previous = runtimeState.operations.get(operationKey);
  const current = (async () => {
    if (previous) await previous.catch(() => undefined);
    return operation();
  })();
  runtimeState.operations.set(operationKey, current);
  try {
    return await current;
  } finally {
    if (runtimeState.operations.get(operationKey) === current) {
      runtimeState.operations.delete(operationKey);
    }
  }
}

async function acquire(reason: string): Promise<SupervisorLease> {
  const lease = await acquireServiceLease("cliproxy", reason);
  if (!lease) {
    const error = new Error("The subscription proxy Runtime service is unavailable.") as Error & {
      status: number;
    };
    error.status = 503;
    throw error;
  }
  return lease;
}

export async function withCliproxyLease<T>(
  reason: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lease = await acquire(reason);
  try {
    return await operation();
  } finally {
    await releaseSupervisorLease(lease);
  }
}

function schedule(entry: LoginLease, retryInMs?: number): void {
  if (entry.timer) clearTimeout(entry.timer);
  const now = Date.now();
  const delay = retryInMs ?? Math.min(
    Math.max(1, entry.acquiredAt + LOGIN_LEASE_ROTATION_MS - now),
    Math.max(1, entry.expiresAt - now),
  );
  const timer = setTimeout(() => {
    void serialize(key(entry.userId, entry.state), async () => {
      const current = state().loginLeases.get(key(entry.userId, entry.state));
      if (current !== entry) return;
      const currentTime = Date.now();
      if (currentTime >= current.expiresAt) {
        state().loginLeases.delete(key(entry.userId, entry.state));
        current.timer = null;
        await releaseSupervisorLease(current.lease);
        return;
      }
      try {
        const replacement = await acquire("subscription-login");
        const previous = current.lease;
        current.lease = replacement;
        current.acquiredAt = currentTime;
        await releaseSupervisorLease(previous);
        schedule(current);
      } catch {
        schedule(current, LOGIN_LEASE_ROTATION_RETRY_MS);
      }
    });
  }, delay);
  timer.unref?.();
  entry.timer = timer;
}

function activeLoginCount(userId: number): number {
  let count = 0;
  for (const entry of state().loginLeases.values()) {
    if (entry.userId === userId) count += 1;
  }
  return count;
}

/** Acquire before OAuth starts and retain until completion, cancel, or TTL. */
export async function beginCliproxyLogin<T extends { state: string; expiresIn?: number }>(
  userId: number,
  operation: () => Promise<T>,
): Promise<T> {
  return serialize(admissionKey(userId), async () => {
    if (activeLoginCount(userId) >= MAX_LOGIN_LEASES_PER_USER) {
      const error = new Error("Too many subscription sign-ins are active.") as Error & {
        status: number;
      };
      error.status = 429;
      throw error;
    }
    const lease = await acquire("subscription-login");
    try {
      const result = await operation();
      if (!/^[A-Za-z0-9._~:-]{1,512}$/.test(result.state)) {
        const error = new Error("The subscription proxy returned an invalid sign-in state.") as Error & {
          status: number;
        };
        error.status = 502;
        throw error;
      }
      const operationKey = key(userId, result.state);
      await serialize(operationKey, async () => {
        const existing = state().loginLeases.get(operationKey);
        if (existing) {
          if (existing.timer) clearTimeout(existing.timer);
          await releaseSupervisorLease(existing.lease);
        }
        const requestedMs = typeof result.expiresIn === "number" &&
          Number.isFinite(result.expiresIn) &&
          result.expiresIn > 0
        ? result.expiresIn * 1000
        : LOGIN_LEASE_DEFAULT_MS;
        const lifetimeMs = Math.min(
          Math.max(LOGIN_LEASE_MIN_MS, requestedMs),
          LOGIN_LEASE_DEFAULT_MS,
        );
        const now = Date.now();
        const entry: LoginLease = {
          userId,
          state: result.state,
          lease,
          acquiredAt: now,
          expiresAt: now + lifetimeMs,
          timer: null,
        };
        state().loginLeases.set(operationKey, entry);
        schedule(entry);
      });
      return result;
    } catch (error) {
      await releaseSupervisorLease(lease);
      throw error;
    }
  });
}

export async function pollCliproxyLogin(
  userId: number,
  loginState: string,
  operation: () => Promise<boolean>,
): Promise<boolean> {
  const operationKey = key(userId, loginState);
  return serialize(operationKey, async () => {
    let entry = state().loginLeases.get(operationKey);
    if (!entry) {
      entry = await serialize(admissionKey(userId), async () => {
        const resumed = state().loginLeases.get(operationKey);
        if (resumed) return resumed;
        if (activeLoginCount(userId) >= MAX_LOGIN_LEASES_PER_USER) {
          const error = new Error("Too many subscription sign-ins are active.") as Error & {
            status: number;
          };
          error.status = 429;
          throw error;
        }
        const lease = await acquire("subscription-login-resume");
        const now = Date.now();
        const created: LoginLease = {
          userId,
          state: loginState,
          lease,
          acquiredAt: now,
          expiresAt: now + LOGIN_LEASE_DEFAULT_MS,
          timer: null,
        };
        state().loginLeases.set(operationKey, created);
        schedule(created);
        return created;
      });
    }
    const complete = await operation();
    if (complete) {
      state().loginLeases.delete(operationKey);
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      await releaseSupervisorLease(entry.lease);
    }
    return complete;
  });
}

export async function releaseCliproxyLogin(userId: number, loginState: string): Promise<void> {
  const operationKey = key(userId, loginState);
  await serialize(operationKey, async () => {
    const entry = state().loginLeases.get(operationKey);
    if (!entry) return;
    state().loginLeases.delete(operationKey);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    await releaseSupervisorLease(entry.lease);
  });
}
