export interface TimedAssistantActivity {
  startedAt?: string;
  completedAt?: string;
}

export const ASSISTANT_LIVE_ACTIVITY_DELAY_MS = 5_000;

/** Keep the familiar initial Thinking beat before revealing a specific phase. */
export function assistantLiveActivityReady(elapsedMs: number | null): boolean {
  return (
    elapsedMs !== null && elapsedMs >= ASSISTANT_LIVE_ACTIVITY_DELAY_MS
  );
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
 *
 * `carriedDurationMs` is time this row inherits from an earlier phase that is
 * no longer on screen — a delegated worker's turn folded into the hand-back
 * that reports it. It is added to every branch below rather than substituted
 * into one, so the number counts up continuously across the seam instead of
 * restarting at zero and then jumping to the total when the row settles.
 */
export function assistantResponseElapsedMs(input: {
  activities: TimedAssistantActivity[];
  active: boolean;
  now: number;
  reportedDurationMs?: number;
  /** Durable beginning of the whole response, retained across chat switches. */
  responseStartedAt?: string;
  /** Start of a live phase, such as an external-agent hand-off. */
  activePhaseStartedAt?: string;
  /** Monotonic client fallback when restored phase metadata is unavailable. */
  activeFallbackStartedAtMs?: number;
  /** Time already spent by a preceding phase this row now speaks for. */
  carriedDurationMs?: number;
}): number | null {
  const carried =
    typeof input.carriedDurationMs === "number" &&
    Number.isFinite(input.carriedDurationMs)
      ? Math.max(0, input.carriedDurationMs)
      : 0;
  if (
    !input.active &&
    typeof input.reportedDurationMs === "number" &&
    Number.isFinite(input.reportedDurationMs)
  ) {
    return carried + Math.max(0, input.reportedDurationMs);
  }

  const starts = [
    ...input.activities.map((activity) => timestamp(activity.startedAt)),
    // Activities are rebuilt when a live chat is reopened. The assistant row
    // is durable, so its timestamp prevents that remount from resetting the
    // response clock to the time the reader came back.
    input.active ? timestamp(input.responseStartedAt) : null,
  ]
    .filter((value): value is number => value !== null);
  const startedAt = starts.length ? Math.min(...starts) : null;

  if (startedAt !== null) {
    const completions = input.activities
      .map((activity) => timestamp(activity.completedAt))
      .filter((value): value is number => value !== null);
    const completedAt = completions.length ? Math.max(...completions) : null;
    const end = input.active ? input.now : (completedAt ?? input.now);
    return carried + Math.max(0, end - startedAt);
  }

  if (input.active) {
    const phaseStartedAt =
      timestamp(input.activePhaseStartedAt) ??
      (typeof input.activeFallbackStartedAtMs === "number" &&
      Number.isFinite(input.activeFallbackStartedAtMs)
        ? input.activeFallbackStartedAtMs
        : null);
    if (phaseStartedAt !== null) {
      const baseDuration =
        typeof input.reportedDurationMs === "number" &&
        Number.isFinite(input.reportedDurationMs)
          ? Math.max(0, input.reportedDurationMs)
          : 0;
      return carried + baseDuration + Math.max(0, input.now - phaseStartedAt);
    }
  }

  if (
    typeof input.reportedDurationMs === "number" &&
    Number.isFinite(input.reportedDurationMs)
  ) {
    return carried + Math.max(0, input.reportedDurationMs);
  }
  return carried > 0 ? carried : null;
}
