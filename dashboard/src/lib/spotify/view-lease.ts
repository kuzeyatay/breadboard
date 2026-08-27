import "server-only";

import {
  SupervisorResourceExhaustedError,
  acquireServiceLease,
  releaseSupervisorLease,
  type SupervisorLease,
} from "../supervisor-control.ts";
import {
  SpotifyPlaybackRuntimeError,
  ensureSpotifyPlaybackRuntimeSession,
  releaseSpotifyPlaybackRuntimeSession,
  spotifyPlaybackViewId,
  type SpotifyPlaybackRuntimeStatus,
} from "./runtime-service.ts";

export const SPOTIFY_PLAYBACK_VIEW_HEARTBEAT_MS = 20_000;
export const SPOTIFY_PLAYBACK_VIEW_HOLD_TTL_MS = 70_000;
export const SPOTIFY_PLAYBACK_VIEW_LEASE_ROTATION_MS = 5 * 60_000;

const MAX_ACTIVE_VIEWS_PER_USER = 8;
const MAX_ACTIVE_VIEWS_GLOBAL = 128;

type SpotifyPlaybackViewHold = {
  readonly userId: number;
  readonly viewId: string;
  lease: SupervisorLease;
  acquiredAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type SpotifyPlaybackViewLeaseState = {
  holds: Map<string, SpotifyPlaybackViewHold>;
  operations: Map<string, Promise<unknown>>;
};

const globalState = globalThis as typeof globalThis & {
  __breadboardSpotifyPlaybackViewLeaseState?: SpotifyPlaybackViewLeaseState;
};

function state(): SpotifyPlaybackViewLeaseState {
  if (!globalState.__breadboardSpotifyPlaybackViewLeaseState) {
    globalState.__breadboardSpotifyPlaybackViewLeaseState = {
      holds: new Map(),
      operations: new Map(),
    };
  }
  return globalState.__breadboardSpotifyPlaybackViewLeaseState;
}

function positiveUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError("Spotify playback user scope is invalid.");
  }
  return value;
}

function key(userId: number, viewId: string): string {
  return `${positiveUserId(userId)}:${spotifyPlaybackViewId(viewId)}`;
}

function unavailable(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 503 });
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

async function releaseHold(hold: SpotifyPlaybackViewHold): Promise<void> {
  if (hold.timer) clearTimeout(hold.timer);
  hold.timer = null;
  await releaseSpotifyPlaybackRuntimeSession({
    userId: hold.userId,
    viewId: hold.viewId,
  }).catch(() => undefined);
  await releaseSupervisorLease(hold.lease);
}

function scheduleExpiry(
  operationKey: string,
  hold: SpotifyPlaybackViewHold,
): void {
  if (hold.timer) clearTimeout(hold.timer);
  const expectedExpiry = hold.expiresAt;
  const timer = setTimeout(() => {
    void serialize(operationKey, async () => {
      const current = state().holds.get(operationKey);
      if (
        !current ||
        current !== hold ||
        current.expiresAt !== expectedExpiry
      ) {
        return;
      }
      if (current.expiresAt > Date.now()) {
        scheduleExpiry(operationKey, current);
        return;
      }
      state().holds.delete(operationKey);
      await releaseHold(current);
    });
  }, Math.max(1, expectedExpiry - Date.now()));
  timer.unref?.();
  hold.timer = timer;
}

function activeViewCount(userId: number): number {
  let count = 0;
  for (const hold of state().holds.values()) {
    if (hold.userId === userId) count += 1;
  }
  return count;
}

async function acquirePlaybackLease(): Promise<SupervisorLease> {
  try {
    const lease = await acquireServiceLease(
      "spotify-playback",
      "active-spotify-playback-view",
    );
    if (!lease) {
      throw unavailable("Breadboard's protected-audio player is unavailable.");
    }
    return lease;
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) {
      throw unavailable(
        "Breadboard does not have enough memory headroom to start Spotify playback.",
      );
    }
    if (error instanceof Error && "status" in error) throw error;
    throw unavailable("Breadboard's protected-audio player is unavailable.");
  }
}

async function ensureSession(input: {
  userId: number;
  viewId: string;
  ticket: string;
}): Promise<SpotifyPlaybackRuntimeStatus> {
  try {
    const result = await ensureSpotifyPlaybackRuntimeSession(input);
    if (result.status === "unavailable") {
      throw unavailable(
        result.error || "Breadboard could not start Spotify playback.",
      );
    }
    return result;
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    if (error instanceof SpotifyPlaybackRuntimeError) {
      throw unavailable(error.message);
    }
    throw unavailable("Breadboard could not start Spotify playback.");
  }
}

/**
 * Keep the Runtime service and this user's browser session alive while an
 * authenticated inline player remains mounted. Native lease IDs and the
 * signed engine ticket never leave server-only code.
 */
export async function renewSpotifyPlaybackViewLease(input: {
  userId: number;
  viewId: string;
  ticket: string;
  now?: number;
}): Promise<{ expiresInMs: number }> {
  const userId = positiveUserId(input.userId);
  const viewId = spotifyPlaybackViewId(input.viewId);
  const operationKey = key(userId, viewId);
  const now = input.now ?? Date.now();

  return serialize(operationKey, async () => {
    const leaseState = state();
    let hold = leaseState.holds.get(operationKey);

    if (hold && hold.expiresAt <= now) {
      leaseState.holds.delete(operationKey);
      await releaseHold(hold);
      hold = undefined;
    }

    if (!hold) {
      if (
        leaseState.holds.size >= MAX_ACTIVE_VIEWS_GLOBAL ||
        activeViewCount(userId) >= MAX_ACTIVE_VIEWS_PER_USER
      ) {
        throw Object.assign(new Error("Too many active Spotify players."), {
          status: 429,
        });
      }
      const lease = await acquirePlaybackLease();
      try {
        await ensureSession({ userId, viewId, ticket: input.ticket });
      } catch (error) {
        await releaseSupervisorLease(lease);
        throw error;
      }
      hold = {
        userId,
        viewId,
        lease,
        acquiredAt: now,
        expiresAt: now + SPOTIFY_PLAYBACK_VIEW_HOLD_TTL_MS,
        timer: null,
      };
      leaseState.holds.set(operationKey, hold);
    } else {
      if (
        now - hold.acquiredAt >=
        SPOTIFY_PLAYBACK_VIEW_LEASE_ROTATION_MS
      ) {
        const replacement = await acquirePlaybackLease();
        const previous = hold.lease;
        hold.lease = replacement;
        hold.acquiredAt = now;
        await releaseSupervisorLease(previous);
      }
      await ensureSession({ userId, viewId, ticket: input.ticket });
    }

    hold.expiresAt = now + SPOTIFY_PLAYBACK_VIEW_HOLD_TTL_MS;
    scheduleExpiry(operationKey, hold);
    return { expiresInMs: SPOTIFY_PLAYBACK_VIEW_HOLD_TTL_MS };
  });
}

export async function releaseSpotifyPlaybackViewLease(input: {
  userId: number;
  viewId: string;
}): Promise<void> {
  const operationKey = key(input.userId, input.viewId);
  await serialize(operationKey, async () => {
    const hold = state().holds.get(operationKey);
    if (!hold) return;
    state().holds.delete(operationKey);
    await releaseHold(hold);
  });
}
