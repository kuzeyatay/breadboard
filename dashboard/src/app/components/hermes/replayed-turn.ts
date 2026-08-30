// A message POST can outlive the client's patience while the server is still
// preparing the turn: the first attempt times out, the retry replays the same
// clientMessageId, and the server answers `replayed: true, status: "pending"`
// with no run id because the turn is reserved but not yet dispatched. That is
// not a failure — the turn is alive and the event stream is already attached —
// so the client keeps polling the same idempotent POST until the run exists
// (or the turn finishes) instead of marking the reply interrupted.

export interface ReplayedTurnBody {
  readonly accepted?: unknown;
  readonly replayed?: unknown;
  readonly status?: unknown;
  readonly runId?: unknown;
  readonly [key: string]: unknown;
}

export const REPLAYED_TURN_SETTLE_BUDGET_MS = 180_000;
export const REPLAYED_TURN_POLL_INTERVAL_MS = 2_000;

/** A replay whose turn is still being prepared: reserved, not dispatched. */
export function isPendingReplay(body: ReplayedTurnBody): boolean {
  return (
    body.replayed === true &&
    body.status === "pending" &&
    (typeof body.runId !== "string" || body.runId.length === 0)
  );
}

export interface SettleReplayedTurnOptions {
  readonly budgetMs?: number;
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/**
 * Re-dispatches the idempotent POST until the replay carries a run id, the
 * turn is reported complete, or the budget runs out. Any response that is not
 * a pending replay is returned as-is for the caller's ordinary handling.
 */
export async function settleReplayedTurn(
  body: ReplayedTurnBody,
  dispatch: () => Promise<Response>,
  options: SettleReplayedTurnOptions = {},
): Promise<ReplayedTurnBody> {
  if (!isPendingReplay(body)) return body;
  const budgetMs = options.budgetMs ?? REPLAYED_TURN_SETTLE_BUDGET_MS;
  const intervalMs = options.intervalMs ?? REPLAYED_TURN_POLL_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + budgetMs;
  let latest = body;
  while (now() < deadline) {
    if (options.signal?.aborted) return latest;
    await sleep(intervalMs);
    if (options.signal?.aborted || now() >= deadline) return latest;
    const response = await dispatch();
    if (!response.ok) return latest;
    const next = (await response.json().catch(() => ({}))) as ReplayedTurnBody;
    if (!isPendingReplay(next)) return next;
    latest = next;
  }
  return latest;
}
