// The work timer's arithmetic and its stored shape, kept free of React so both
// can be exercised directly — the same split `navbar-shortcuts.ts` uses.
//
// A session is held as wall-clock rather than as a ticking number: `endAt` is
// when it runs out, so closing the panel, switching pages, or reloading cannot
// make the countdown drift or stop. Pausing trades that end time for a frozen
// `remainingMs`, and `remainingMs === 0` is the finished session.

export const WORK_TIMER_STORAGE_KEY = "breadboard:work-timer";

export const WORK_TIMER_DEFAULT_MS = 25 * 60_000;
export const BREAK_TIMER_DEFAULT_MS = 5 * 60_000;
export const WORK_TIMER_MIN_MINUTES = 1;
export const WORK_TIMER_MAX_MINUTES = 999;

export type WorkTimerMode = "work" | "break";

export interface WorkTimerSession {
  /** The kind of session currently on the clock. */
  mode: WorkTimerMode;
  /** Snapshot used by the current countdown, even if a future length changes. */
  durationMs: number;
  workDurationMs: number;
  breakDurationMs: number;
  /** Wall-clock end while running; null when idle, paused, or finished. */
  endAt: number | null;
  /** Frozen remainder while paused, 0 once finished; null when idle. */
  remainingMs: number | null;
}

export const IDLE_WORK_TIMER: WorkTimerSession = {
  mode: "work",
  durationMs: WORK_TIMER_DEFAULT_MS,
  workDurationMs: WORK_TIMER_DEFAULT_MS,
  breakDurationMs: BREAK_TIMER_DEFAULT_MS,
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
  return { ...session, endAt: now + base, remainingMs: null };
}

export function pauseWorkTimer(session: WorkTimerSession, now: number): WorkTimerSession {
  if (session.endAt === null) return { ...session };
  return {
    ...session,
    endAt: null,
    remainingMs: Math.max(0, session.endAt - now),
  };
}

export function resetWorkTimer(session: WorkTimerSession): WorkTimerSession {
  const durationMs =
    session.mode === "work" ? session.workDurationMs : session.breakDurationMs;
  return { ...session, durationMs, endAt: null, remainingMs: null };
}

function normalizedMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return WORK_TIMER_MIN_MINUTES;
  return Math.min(
    WORK_TIMER_MAX_MINUTES,
    Math.max(WORK_TIMER_MIN_MINUTES, Math.round(minutes)),
  );
}

/**
 * Change either saved length. An active countdown keeps its original snapshot;
 * an idle clock updates immediately when its own mode changes.
 */
export function setWorkTimerMinutes(
  session: WorkTimerSession,
  mode: WorkTimerMode,
  minutes: number,
): WorkTimerSession {
  const configuredMs = normalizedMinutes(minutes) * 60_000;
  const next = {
    ...session,
    ...(mode === "work"
      ? { workDurationMs: configuredMs }
      : { breakDurationMs: configuredMs }),
  };
  const phase = workTimerPhase(session);
  return session.mode === mode && (phase === "idle" || phase === "finished")
    ? { ...next, durationMs: configuredMs, endAt: null, remainingMs: null }
    : next;
}

/** Choosing Work or Break clears the clock and loads that saved length. */
export function setWorkTimerMode(
  session: WorkTimerSession,
  mode: WorkTimerMode,
): WorkTimerSession {
  if (session.mode === mode) return { ...session };
  const durationMs = mode === "work" ? session.workDurationMs : session.breakDurationMs;
  return { ...session, mode, durationMs, endAt: null, remainingMs: null };
}

/** Move from a completed work session to break, or from break back to work. */
export function advanceWorkTimer(session: WorkTimerSession): WorkTimerSession {
  return setWorkTimerMode(session, session.mode === "work" ? "break" : "work");
}

/** A running session whose end has passed is finished, not still running. */
export function settleWorkTimer(session: WorkTimerSession, now: number): WorkTimerSession {
  if (session.endAt === null || session.endAt > now) return { ...session };
  return { ...session, endAt: null, remainingMs: 0 };
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
  const validDuration = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  const durationMs = candidate.durationMs;
  if (!validDuration(durationMs)) {
    return null;
  }

  const mode: WorkTimerMode = candidate.mode === "break" ? "break" : "work";
  // Stored sessions from the original work-only timer have no mode-specific
  // settings. Their current duration becomes the work preference and Break
  // receives the new default.
  const workDurationMs = validDuration(candidate.workDurationMs)
    ? candidate.workDurationMs
    : mode === "work"
      ? durationMs
      : WORK_TIMER_DEFAULT_MS;
  const breakDurationMs = validDuration(candidate.breakDurationMs)
    ? candidate.breakDurationMs
    : mode === "break"
      ? durationMs
      : BREAK_TIMER_DEFAULT_MS;
  const endAt = candidate.endAt;
  const remainingMs = candidate.remainingMs;
  return {
    mode,
    durationMs,
    workDurationMs,
    breakDurationMs,
    endAt: typeof endAt === "number" && Number.isFinite(endAt) ? endAt : null,
    remainingMs:
      typeof remainingMs === "number" && Number.isFinite(remainingMs) && remainingMs >= 0
        ? remainingMs
        : null,
  };
}
