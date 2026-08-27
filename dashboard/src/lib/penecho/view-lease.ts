import "server-only";

import {
  acquireServiceLease,
  releaseSupervisorLease,
  type SupervisorLease,
} from "../supervisor-control.ts";
import {
  ensurePenechoService,
  penechoRuntimeManaged,
  type PenechoService,
} from "./service.ts";

export const PENECHO_VIEW_HEARTBEAT_MS = 20_000;
export const PENECHO_VIEW_HOLD_TTL_MS = 70_000;
export const PENECHO_VIEW_LEASE_ROTATION_MS = 5 * 60_000;

const MAX_ACTIVE_VIEWS_PER_ORIGIN = 16;
const MAX_ACTIVE_VIEWS_GLOBAL = 128;

interface PenechoViewHold {
  readonly origin: string;
  lease: SupervisorLease | null;
  acquiredAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  service: PenechoService;
}

interface PenechoViewLeaseState {
  readonly holds: Map<string, PenechoViewHold>;
  readonly operations: Map<string, Promise<unknown>>;
}

const stateGlobal = globalThis as typeof globalThis & {
  __breadboardPenechoViewLeaseState?: PenechoViewLeaseState;
};

function state(): PenechoViewLeaseState {
  if (!stateGlobal.__breadboardPenechoViewLeaseState) {
    stateGlobal.__breadboardPenechoViewLeaseState = {
      holds: new Map(),
      operations: new Map(),
    };
  }
  return stateGlobal.__breadboardPenechoViewLeaseState;
}

function key(origin: string, viewId: string): string {
  return `${origin}:${viewId}`;
}

async function serialize<T>(
  operationKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const leaseState = state();
  const previous = leaseState.operations.get(operationKey);
  const current = (async () => {
    if (previous) await previous.catch(() => undefined);
    return operation();
  })();
  leaseState.operations.set(operationKey, current);
  try {
    return await current;
  } finally {
    if (leaseState.operations.get(operationKey) === current) {
      leaseState.operations.delete(operationKey);
    }
  }
}

function scheduleExpiry(operationKey: string, hold: PenechoViewHold): void {
  if (hold.timer) clearTimeout(hold.timer);
  const expectedExpiry = hold.expiresAt;
  const timer = setTimeout(
    () => {
      void serialize(operationKey, async () => {
        const current = state().holds.get(operationKey);
        if (
          !current ||
          current !== hold ||
          current.expiresAt !== expectedExpiry
        )
          return;
        if (current.expiresAt > Date.now()) {
          scheduleExpiry(operationKey, current);
          return;
        }
        state().holds.delete(operationKey);
        current.timer = null;
        await releaseSupervisorLease(current.lease);
      });
    },
    Math.max(1, expectedExpiry - Date.now()),
  );
  timer.unref?.();
  hold.timer = timer;
}

function activeOriginCount(origin: string): number {
  let count = 0;
  for (const hold of state().holds.values()) {
    if (hold.origin === origin) count += 1;
  }
  return count;
}

async function acquirePenechoLease(): Promise<SupervisorLease> {
  const lease = await acquireServiceLease("penecho", "active-whiteboard-view");
  if (!lease) {
    const error = new Error(
      "The PenEcho Runtime service is unavailable.",
    ) as Error & {
      status: number;
    };
    error.status = 503;
    throw error;
  }
  return lease;
}

/**
 * Acquire before returning an iframe URL and renew while that frame remains
 * mounted. The native lease identifier never leaves this server-only module.
 */
export async function renewPenechoViewLease(
  origin: string,
  viewId: string,
  now = Date.now(),
): Promise<{ expiresInMs: number; service: PenechoService }> {
  const operationKey = key(origin, viewId);
  return serialize(operationKey, async () => {
    const leaseState = state();
    let hold = leaseState.holds.get(operationKey);

    if (hold && hold.expiresAt <= now) {
      leaseState.holds.delete(operationKey);
      if (hold.timer) clearTimeout(hold.timer);
      await releaseSupervisorLease(hold.lease);
      hold = undefined;
    }

    if (!hold) {
      if (
        leaseState.holds.size >= MAX_ACTIVE_VIEWS_GLOBAL ||
        activeOriginCount(origin) >= MAX_ACTIVE_VIEWS_PER_ORIGIN
      ) {
        const error = new Error(
          "Too many active PenEcho whiteboard views.",
        ) as Error & {
          status: number;
        };
        error.status = 429;
        throw error;
      }

      const lease = penechoRuntimeManaged()
        ? await acquirePenechoLease()
        : null;
      let service: PenechoService;
      try {
        service = await ensurePenechoService();
      } catch (error) {
        await releaseSupervisorLease(lease);
        throw error;
      }
      hold = {
        origin,
        lease,
        service,
        acquiredAt: now,
        expiresAt: now + PENECHO_VIEW_HOLD_TTL_MS,
        timer: null,
      };
      leaseState.holds.set(operationKey, hold);
    } else if (
      hold.lease &&
      now - hold.acquiredAt >= PENECHO_VIEW_LEASE_ROTATION_MS
    ) {
      const replacement = await acquirePenechoLease();
      const previous = hold.lease;
      hold.lease = replacement;
      hold.acquiredAt = now;
      await releaseSupervisorLease(previous);
    }

    hold.expiresAt = now + PENECHO_VIEW_HOLD_TTL_MS;
    scheduleExpiry(operationKey, hold);
    return { expiresInMs: PENECHO_VIEW_HOLD_TTL_MS, service: hold.service };
  });
}

export async function releasePenechoViewLease(
  origin: string,
  viewId: string,
): Promise<void> {
  const operationKey = key(origin, viewId);
  await serialize(operationKey, async () => {
    const hold = state().holds.get(operationKey);
    if (!hold) return;
    state().holds.delete(operationKey);
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = null;
    await releaseSupervisorLease(hold.lease);
  });
}
