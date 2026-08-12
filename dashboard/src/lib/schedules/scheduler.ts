// The in-process tick that fires due scheduled chats.
//
// Breadboard is a local-first app whose Next.js server is the only long-lived
// process, so the scheduler lives here rather than in a platform cron — the same
// place the skills-catalog refresh already runs (src/instrumentation-node.ts).
// The tick is idempotent twice over: `claimDue` advances `next_run_at` inside a
// transaction, so overlapping ticks cannot run the same job twice, and it takes
// an execution lease, so the *next* occurrence cannot start while this one is
// still in flight — including from a second process on the same database.

import type { ScheduledChatJobRow } from "./store.ts";

const TICK_INTERVAL_MS = 30_000;

type SchedulerGlobals = typeof globalThis & {
  __breadboardChatScheduler?: ReturnType<typeof setInterval>;
  __breadboardChatSchedulerRunning?: boolean;
};

const globals = globalThis as SchedulerGlobals;

/** Run every due job once. Returns the jobs it dispatched. */
export async function runDueScheduledChats(
  now: Date = new Date(),
): Promise<ScheduledChatJobRow[]> {
  // Loaded lazily so booting the server never pulls the whole agent-runtime
  // stack in through instrumentation — a tick that cannot load it just fails.
  const [{ getScheduledChatJobStore }, { runScheduledChatJob }] = await Promise.all([
    import("./instance.ts"),
    import("./runner.ts"),
  ]);
  const store = getScheduledChatJobStore();
  const due = store.claimDue(now);
  for (const job of due) {
    try {
      const result = await runScheduledChatJob(job);
      store.recordRun(job.id, {
        status: result.status,
        conversationId: result.conversationId,
        error: result.error ?? null,
        at: new Date(),
      });
    } catch (cause) {
      // The runner catches its own failures, so reaching here means something
      // outside it broke. Record it anyway: recordRun is what releases the
      // lease, and a job whose lease is only freed by expiry would sit out the
      // next quarter hour for a fault that has already passed.
      store.recordRun(job.id, {
        status: "failed",
        conversationId: null,
        error: cause instanceof Error ? cause.message : "The scheduled chat could not run.",
        at: new Date(),
      });
    }
  }
  return due;
}

/** Start the process-wide tick. Safe to call repeatedly (dev hot reloads). */
export function startScheduledChatScheduler(): void {
  if (globals.__breadboardChatScheduler) return;

  const tick = async () => {
    // Never overlap ticks: a slow runtime dispatch must not stack up timers.
    if (globals.__breadboardChatSchedulerRunning) return;
    globals.__breadboardChatSchedulerRunning = true;
    try {
      await runDueScheduledChats();
    } catch {
      // A failed tick is already recorded per job; the next tick retries.
    } finally {
      globals.__breadboardChatSchedulerRunning = false;
    }
  };

  // Catch up on anything that came due while the server was stopped, then settle
  // into the regular cadence.
  setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  timer.unref();
  globals.__breadboardChatScheduler = timer;
}
