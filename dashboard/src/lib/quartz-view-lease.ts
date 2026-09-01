import "server-only";

import {
  acquireServiceLease,
  releaseSupervisorLease,
  type SupervisorLease,
} from "@/lib/supervisor-control";
import { ensureQuartzPublicationForView } from "@/lib/quartz-publish";

export const QUARTZ_VIEW_HEARTBEAT_MS = 20_000;
export const QUARTZ_VIEW_HOLD_TTL_MS = 70_000;
export const QUARTZ_VIEW_LEASE_ROTATION_MS = 5 * 60_000;

const MAX_ACTIVE_VIEWS_PER_USER = 8;

interface QuartzViewHold {
  readonly userId: number;
  lease: SupervisorLease;
  acquiredAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface QuartzViewLeaseState {
  readonly holds: Map<string, QuartzViewHold>;
  readonly operations: Map<string, Promise<unknown>>;
}

const stateGlobal = globalThis as typeof globalThis & {
  __breadboardQuartzViewLeaseState?: QuartzViewLeaseState;
};

function state(): QuartzViewLeaseState {
  if (!stateGlobal.__breadboardQuartzViewLeaseState) {
    stateGlobal.__breadboardQuartzViewLeaseState = {
      holds: new Map(),
      operations: new Map(),
    };
  }
  return stateGlobal.__breadboardQuartzViewLeaseState;
}

function holdKey(userId: number, viewId: string): string {
  return `${userId}:${viewId}`;
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

function scheduleExpiry(key: string, hold: QuartzViewHold): void {
  if (hold.timer) clearTimeout(hold.timer);
  const expectedExpiry = hold.expiresAt;
  const timer = setTimeout(() => {
    void serialize(key, async () => {
      const current = state().holds.get(key);
      if (!current || current !== hold || current.expiresAt !== expectedExpiry) return;
      if (current.expiresAt > Date.now()) {
        scheduleExpiry(key, current);
        return;
      }
      state().holds.delete(key);
      current.timer = null;
      await releaseSupervisorLease(current.lease);
    });
  }, Math.max(1, expectedExpiry - Date.now()));
  timer.unref?.();
  hold.timer = timer;
}

async function acquireQuartzLease(): Promise<SupervisorLease> {
  const lease = await acquireServiceLease("quartz", "active-garden-view");
  if (!lease) {
    const error = new Error("Quartz Runtime service control is unavailable.") as Error & {
      status: number;
    };
    error.status = 503;
    throw error;
  }
  return lease;
}

function activeViewCount(userId: number): number {
  let count = 0;
  for (const hold of state().holds.values()) {
    if (hold.userId === userId) count += 1;
  }
  return count;
}

/**
 * Acquire before rendering a Quartz frame and renew while the authenticated
 * view remains mounted. Native lease identifiers stay inside this server-only
 * module; callers receive only the bounded heartbeat interval.
 */
export async function renewQuartzViewLease(
  userId: number,
  viewId: string,
  now = Date.now(),
): Promise<{ expiresInMs: number }> {
  const key = holdKey(userId, viewId);
  return serialize(key, async () => {
    const leaseState = state();
    let hold = leaseState.holds.get(key);

    if (hold && hold.expiresAt <= now) {
      leaseState.holds.delete(key);
      if (hold.timer) clearTimeout(hold.timer);
      await releaseSupervisorLease(hold.lease);
      hold = undefined;
    }

    if (!hold) {
      if (activeViewCount(userId) >= MAX_ACTIVE_VIEWS_PER_USER) {
        const error = new Error("Too many active Quartz views.") as Error & { status: number };
        error.status = 429;
        throw error;
      }
      // Publish before starting the read-only server. On Windows this also
      // avoids making the initial public-tree promotion contend with an open
      // directory handle held by the static service.
      await ensureQuartzPublicationForView(userId);
      const lease = await acquireQuartzLease();
      hold = {
        userId,
        lease,
        acquiredAt: now,
        expiresAt: now + QUARTZ_VIEW_HOLD_TTL_MS,
        timer: null,
      };
      leaseState.holds.set(key, hold);
    } else if (now - hold.acquiredAt >= QUARTZ_VIEW_LEASE_ROTATION_MS) {
      // Acquire the replacement first so a visible frame never creates a
      // zero-lease idle-stop window during bounded native lease rotation.
      const replacement = await acquireQuartzLease();
      const previous = hold.lease;
      hold.lease = replacement;
      hold.acquiredAt = now;
      await releaseSupervisorLease(previous);
    }

    hold.expiresAt = now + QUARTZ_VIEW_HOLD_TTL_MS;
    scheduleExpiry(key, hold);
    return { expiresInMs: QUARTZ_VIEW_HOLD_TTL_MS };
  });
}

export async function releaseQuartzViewLease(userId: number, viewId: string): Promise<void> {
  const key = holdKey(userId, viewId);
  await serialize(key, async () => {
    const hold = state().holds.get(key);
    if (!hold) return;
    state().holds.delete(key);
    if (hold.timer) clearTimeout(hold.timer);
    hold.timer = null;
    await releaseSupervisorLease(hold.lease);
  });
}
