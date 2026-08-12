export interface TimedAssistantActivity {
  startedAt?: string;
  completedAt?: string;
}

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Measure the full user-visible turn, from its earliest activity until the
 * response reaches a terminal state. A completed message's persisted duration
 * is authoritative because the shared live activity list may already belong to
 * a newer response branch.
 */
export function assistantResponseElapsedMs(input: {
  activities: TimedAssistantActivity[];
  active: boolean;
  now: number;
  reportedDurationMs?: number;
}): number | null {
  if (
    !input.active &&
    typeof input.reportedDurationMs === "number" &&
    Number.isFinite(input.reportedDurationMs)
  ) {
    return Math.max(0, input.reportedDurationMs);
  }

  const starts = input.activities
    .map((activity) => timestamp(activity.startedAt))
    .filter((value): value is number => value !== null);
  const startedAt = starts.length ? Math.min(...starts) : null;

  if (startedAt !== null) {
    const completions = input.activities
      .map((activity) => timestamp(activity.completedAt))
      .filter((value): value is number => value !== null);
    const completedAt = completions.length ? Math.max(...completions) : null;
    const end = input.active ? input.now : (completedAt ?? input.now);
    return Math.max(0, end - startedAt);
  }

  return typeof input.reportedDurationMs === "number" &&
    Number.isFinite(input.reportedDurationMs)
    ? Math.max(0, input.reportedDurationMs)
    : null;
}
