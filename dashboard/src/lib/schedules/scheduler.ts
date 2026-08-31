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
  await Promise.all(due.map(async (job) => {
    try {
      const result = await runScheduledChatJob(job, { waitForCompletion: true });
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
  }));
  return due;
}
