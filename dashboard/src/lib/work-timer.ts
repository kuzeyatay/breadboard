// The work timer's arithmetic and its stored shape, kept free of React so both
// can be exercised directly — the same split `navbar-shortcuts.ts` uses.
//
// A session is held as wall-clock rather than as a ticking number: `endAt` is
// when it runs out, so closing the panel, switching pages, or reloading cannot
// make the countdown drift or stop. Pausing trades that end time for a frozen
// `remainingMs`, and `remainingMs === 0` is the finished session.

export const WORK_TIMER_STORAGE_KEY = "breadboard:work-timer";

export const WORK_TIMER_PRESET_MINUTES = [25, 15, 5] as const;
export const WORK_TIMER_DEFAULT_MS = 25 * 60_000;

export interface WorkTimerSession {
  durationMs: number;
  /** Wall-clock end while running; null when idle, paused, or finished. */
  endAt: number | null;
  /** Frozen remainder while paused, 0 once finished; null when idle. */
  remainingMs: number | null;
}

export const IDLE_WORK_TIMER: WorkTimerSession = {
  durationMs: WORK_TIMER_DEFAULT_MS,
  endAt: null,
  remainingMs: null,
};

export type WorkTimerPhase = "idle" | "running" | "paused" | "finished";

export function formatWorkTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function workTimerPhase(session: WorkTimerSession): WorkTimerPhase {
  if (session.endAt !== null) return "running";
  if (session.remainingMs === null) return "idle";
  return session.remainingMs > 0 ? "paused" : "finished";
}

/** What the clock reads at `now`, never past zero. */
export function workTimerRemainingMs(session: WorkTimerSession, now: number): number {
  if (session.endAt !== null) return Math.max(0, session.endAt - now);
  if (session.remainingMs !== null) return Math.max(0, session.remainingMs);
  return session.durationMs;
}

/** How much of the session is done, 0–1, for the progress bar. */
export function workTimerProgress(session: WorkTimerSession, now: number): number {
  if (session.durationMs <= 0) return 0;
  const remaining = workTimerRemainingMs(session, now);
  return Math.min(1, Math.max(0, 1 - remaining / session.durationMs));
}

/**
 * Start, or resume a paused session from where it stopped. A finished session
 * starts over rather than resuming at zero.
 */
export function startWorkTimer(session: WorkTimerSession, now: number): WorkTimerSession {
  const base =
    session.remainingMs !== null && session.remainingMs > 0
      ? session.remainingMs
      : session.durationMs;
  return { durationMs: session.durationMs, endAt: now + base, remainingMs: null };
}

export function pauseWorkTimer(session: WorkTimerSession, now: number): WorkTimerSession {
  if (session.endAt === null) return { ...session };
  return {
    durationMs: session.durationMs,
    endAt: null,
    remainingMs: Math.max(0, session.endAt - now),
  };
}

export function resetWorkTimer(session: WorkTimerSession): WorkTimerSession {
  return { durationMs: session.durationMs, endAt: null, remainingMs: null };
}

/** Choosing a length always clears whatever was on the clock. */
export function setWorkTimerMinutes(minutes: number): WorkTimerSession {
  return { durationMs: Math.max(1, Math.round(minutes)) * 60_000, endAt: null, remainingMs: null };
}

/** A running session whose end has passed is finished, not still running. */
export function settleWorkTimer(session: WorkTimerSession, now: number): WorkTimerSession {
  if (session.endAt === null || session.endAt > now) return { ...session };
  return { durationMs: session.durationMs, endAt: null, remainingMs: 0 };
}

/**
 * Read a session back out of storage. Anything unrecognisable is treated as no
 * session at all, so a bad value cannot wedge the timer on every page load.
 */
export function parseWorkTimerSession(raw: string | null): WorkTimerSession | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const candidate = parsed as Record<string, unknown>;
  const durationMs = candidate.durationMs;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }

  const endAt = candidate.endAt;
  const remainingMs = candidate.remainingMs;
  return {
    durationMs,
    endAt: typeof endAt === "number" && Number.isFinite(endAt) ? endAt : null,
    remainingMs:
      typeof remainingMs === "number" && Number.isFinite(remainingMs) && remainingMs >= 0
        ? remainingMs
        : null,
  };
}
