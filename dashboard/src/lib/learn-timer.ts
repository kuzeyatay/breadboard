export interface LearnTimerState {
  elapsedMs: number;
  startedAt?: string;
}

const RUNNING_STATUSES = new Set([
  'idle',
  'planning',
  'analyzing_issues',
  'repairing',
  'revalidating',
  'publishing_repair',
  'generating_learning_pages',
  'generating_textbook',
  'generating_visuals',
  'writing_quartz',
  'building_navigation',
]);

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function learnTimerRunsForStatus(status: string): boolean {
  return RUNNING_STATUSES.has(status);
}

/** Persist a stopwatch transition. Waiting for map confirmation and every
 * terminal status stop the clock; starting generation creates a new running
 * interval that can later be added to the planning interval. */
export function transitionLearnTimer(
  current: LearnTimerState,
  nextStatus: string,
  at: string,
): LearnTimerState {
  const atMs = timestamp(at) ?? Date.now();
  const startedMs = timestamp(current.startedAt);
  let elapsedMs = Math.max(0, Math.trunc(current.elapsedMs));

  if (startedMs !== null && !learnTimerRunsForStatus(nextStatus)) {
    elapsedMs += Math.max(0, atMs - startedMs);
  }

  if (!learnTimerRunsForStatus(nextStatus)) {
    return { elapsedMs };
  }
  return {
    elapsedMs,
    startedAt: startedMs === null ? at : current.startedAt,
  };
}

export function currentLearnElapsedMs(
  timer: LearnTimerState,
  nowMs = Date.now(),
): number {
  const startedMs = timestamp(timer.startedAt);
  return (
    Math.max(0, Math.trunc(timer.elapsedMs)) +
    (startedMs === null ? 0 : Math.max(0, nowMs - startedMs))
  );
}

export function formatLearnElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}
