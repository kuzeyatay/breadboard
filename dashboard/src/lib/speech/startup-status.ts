/**
 * Reading of the Voicebox setup status file.
 *
 * The installer downloads multi-gigabyte wheels, so a single phase string
 * cannot distinguish "still downloading torch" from "was killed an hour ago".
 * Every writer of this file therefore heartbeats and records its pid, and this
 * module turns that into an honest `stalled` flag for the UI. Kept free of
 * server-only imports so the rules can be tested directly.
 */

export type VoiceboxStartupProgress = { receivedBytes: number; totalBytes: number };

export type VoiceboxStartupStatus = {
  phase: string;
  message: string;
  updatedAt: string;
  startedAt: string | null;
  /** 1-based position in the install plan, when setup is the one reporting. */
  step: number | null;
  totalSteps: number | null;
  /** What the current step is working on, e.g. `torch 2.11.0+cu128`. */
  detail: string | null;
  progress: VoiceboxStartupProgress | null;
  /** An in-progress phase whose writer stopped reporting: setup died. */
  stalled: boolean;
};

/** Phases that are an outcome, where a still `updatedAt` is expected. */
export const SETTLED_STARTUP_PHASES = new Set([
  "ready",
  "installed",
  "error",
  "stopped",
  "interrupted",
]);

/** Generous next to the writers' 5s heartbeat, so a slow disk never lies. */
export const HEARTBEAT_GRACE_MS = 60_000;

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function optionalProgress(value: unknown): VoiceboxStartupProgress | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const receivedBytes = optionalCount(record.receivedBytes);
  const totalBytes = optionalCount(record.totalBytes);
  if (receivedBytes === null || totalBytes === null || totalBytes === 0) return null;
  return { receivedBytes: Math.min(receivedBytes, totalBytes), totalBytes };
}

/** A recorded pid that no longer exists means the writer is gone for good. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

export function parseStartupStatus(
  raw: string,
  options: { now?: number; isAlive?: (pid: number) => boolean } = {},
): VoiceboxStartupStatus | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed.phase !== "string" ||
    typeof parsed.message !== "string" ||
    typeof parsed.updatedAt !== "string"
  ) {
    return null;
  }

  const now = options.now ?? Date.now();
  const isAlive = options.isAlive ?? processAlive;
  const updatedAtMs = Date.parse(parsed.updatedAt);
  const pid = optionalCount(parsed.pid);
  const writerGone = pid !== null && pid > 0 ? !isAlive(pid) : false;
  const overdue = Number.isFinite(updatedAtMs) && now - updatedAtMs > HEARTBEAT_GRACE_MS;

  return {
    phase: parsed.phase,
    message: parsed.message,
    updatedAt: parsed.updatedAt,
    startedAt: optionalString(parsed.startedAt),
    step: optionalCount(parsed.step),
    totalSteps: optionalCount(parsed.totalSteps),
    detail: optionalString(parsed.detail),
    progress: optionalProgress(parsed.progress),
    stalled: !SETTLED_STARTUP_PHASES.has(parsed.phase) && (writerGone || overdue),
  };
}
