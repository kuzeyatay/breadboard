// Whether anyone is still driving a run.
//
// A `hermes_runs` row is the only durable record that a turn is in flight, and
// the pump that owns it lives in a Node process that can disappear: a dev
// server restart, the desktop app quitting, a crash. Nothing about
// `status = 'active'` expires on its own, so a run whose pump vanished stayed
// active forever — and because a unique partial index allows one active run per
// runtime session, that one orphan rejected every later turn in the
// conversation with `run_already_active` for good.
//
// The pump therefore stamps `heartbeat_at` for as long as it is driving the
// run, and this module decides from that stamp alone whether the owner is still
// there. The stamp lives in SQLite rather than in process memory because the
// owner is routinely a different process from the one asking.

/** How often a live pump refreshes its claim on the run it is driving. */
export const RUN_HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * How long a run may go unclaimed before another caller may take it over.
 * Twenty-four missed beats: far longer than a stalled event loop or a slow
 * SQLite writer, short enough that a person who waits out a broken turn and
 * sends again is never told to wait for a pump that no longer exists.
 */
export const ABANDONED_RUN_AFTER_MS = 120_000;

export interface RunLivenessFields {
  started_at: string;
  heartbeat_at?: string | null;
}

/**
 * Last moment a pump proved it owned this run. Runs created before heartbeats
 * existed — and runs whose pump died before its first beat — fall back to their
 * start, which is exactly the grace period a just-dispatched turn needs.
 */
export function runtimeRunLastSignalAt(run: RunLivenessFields): number {
  const heartbeat = run.heartbeat_at ? Date.parse(run.heartbeat_at) : Number.NaN;
  if (Number.isFinite(heartbeat)) return heartbeat;
  const started = Date.parse(run.started_at);
  // An unreadable timestamp must not make a run immortal: with no evidence that
  // anyone is driving it, treating it as abandoned is the recoverable answer.
  return Number.isFinite(started) ? started : 0;
}

export function isRuntimeRunAbandoned(
  run: RunLivenessFields,
  now = Date.now(),
): boolean {
  return now - runtimeRunLastSignalAt(run) > ABANDONED_RUN_AFTER_MS;
}
