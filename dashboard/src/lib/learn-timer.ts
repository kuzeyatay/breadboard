export interface LearnTimerState {
  elapsedMs: number;
  startedAt?: string;
}

export interface LearnWorkflowAttempt {
  id: string;
  status: string;
  createdAt: string;
}

export interface LearnTimerAttempt extends LearnWorkflowAttempt {
  elapsedMs: number;
}

function boundedLearnProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Learn progress is a durable high-water mark. A resumed worker may replay
 * idempotent preparation stages, but doing so must never make the UI imply that
 * accepted work was lost.
 */
export function monotonicLearnProgress(
  currentProgress: number,
  requestedProgress: number,
): number {
  return Math.max(
    boundedLearnProgress(currentProgress),
    boundedLearnProgress(requestedProgress),
  );
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

/**
 * Sum every attempt in the current confirmed-map publication chain. A
 * successful publication closes the chain, so a later run on the same map
 * starts at zero while retries and service restarts before that publication
 * retain their accumulated active time.
 */
export function cumulativeLearnWorkflowElapsedMs(
  attempts: LearnTimerAttempt[],
  currentJobId: string,
): number {
  return currentLearnWorkflowAttempts(attempts, currentJobId).reduce(
    (total, attempt) =>
      total + (Number.isFinite(attempt.elapsedMs) ? Math.max(0, Math.trunc(attempt.elapsedMs)) : 0),
    0,
  );
}

/** Select the retry chain shared by cumulative time and token projections. */
export function currentLearnWorkflowAttempts<T extends LearnWorkflowAttempt>(
  attempts: T[],
  currentJobId: string,
): T[] {
  const ordered = [...attempts].sort((a, b) => {
    const byCreatedAt = (timestamp(a.createdAt) ?? 0) - (timestamp(b.createdAt) ?? 0);
    return byCreatedAt || a.id.localeCompare(b.id);
  });
  const currentIndex = ordered.findIndex((attempt) => attempt.id === currentJobId);
  if (currentIndex < 0) return [];

  let chainStart = 0;
  for (let index = 0; index < currentIndex; index += 1) {
    if (ordered[index]?.status === "complete") chainStart = index + 1;
  }
  return ordered.slice(chainStart, currentIndex + 1);
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
