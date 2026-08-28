// Inline agent cards are remounted whenever their chat leaves the viewport.
// Their elapsed clocks therefore cannot own their start time in component
// state. Keep the durable server timestamp by run id so every card resumes the
// same clock after chat switches, dock closes, and renderer recovery.

const MAX_REMEMBERED_RUNS = 256;
const startedAtByRunId = new Map<string, number>();

export function rememberExternalRunStartedAt(
  runId: string,
  startedAt: string | undefined,
): void {
  const normalizedRunId = runId.trim();
  const parsed = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (!normalizedRunId || !Number.isFinite(parsed)) return;

  const current = startedAtByRunId.get(normalizedRunId);
  // A later status snapshot must never move an existing clock forward.
  if (current === undefined || parsed < current) {
    startedAtByRunId.set(normalizedRunId, parsed);
  }
  while (startedAtByRunId.size > MAX_REMEMBERED_RUNS) {
    const oldest = startedAtByRunId.keys().next().value as string | undefined;
    if (!oldest) break;
    startedAtByRunId.delete(oldest);
  }
}

export function externalRunStartedAtMs(runId: string): number {
  return startedAtByRunId.get(runId.trim()) ?? Date.now();
}

