// The in-process tick that pushes review questions out.
//
// Modelled on ../schedules/scheduler.ts, and started from the same place
// (src/instrumentation-node.ts), because Breadboard's Next.js server is the only
// long-lived process — there is no platform cron to lean on.
//
// The rule is "from the user's send hour onward, keep exactly one question in
// flight until the day's budget is spent". That makes the loop conversational
// rather than a morning dump: answer one and the next arrives within a tick,
// ignore one and nothing further is sent. Every guard that decides whether to
// send lives in sendNextReview, so this file only has to decide *whether it is
// yet time* and never double-fires.

const TICK_INTERVAL_MS = 30_000;

type SchedulerGlobals = typeof globalThis & {
  __breadboardReviewScheduler?: ReturnType<typeof setInterval>;
  __breadboardReviewSchedulerRunning?: boolean;
};

const globals = globalThis as SchedulerGlobals;

export interface ReviewTickResult {
  considered: number;
  sent: number;
}

/** Run one pass over every user with delivery configured. */
export async function runDueReviews(now: Date = new Date()): Promise<ReviewTickResult> {
  // Loaded lazily so booting the server never pulls the messaging bridges in
  // through instrumentation — a tick that cannot load them just fails.
  const [{ getReviewStore }, { sendNextReview, toLocalDate }] = await Promise.all([
    import("./instance.ts"),
    import("./delivery.ts"),
  ]);
  const store = getReviewStore();
  const localDate = toLocalDate(now);
  const result: ReviewTickResult = { considered: 0, sent: 0 };

  for (const user of store.usersWithDelivery()) {
    // Before the chosen hour, nothing goes out. Compared against the server's
    // local clock, which on a local-first desktop app is the user's own.
    if (now.getHours() < user.sendHour) continue;
    result.considered += 1;
    try {
      const outcome = await sendNextReview({
        store,
        userId: user.userId,
        now,
        localDate,
      });
      result.sent += outcome.sent;
    } catch {
      // A user whose channel is mid-reconnect must not stop the others; the
      // next tick retries in half a minute and the card is still due.
    }
  }
  return result;
}

/** Start the process-wide tick. Safe to call repeatedly (dev hot reloads). */
export function startReviewScheduler(): void {
  if (globals.__breadboardReviewScheduler) return;

  const tick = async () => {
    // Never overlap ticks: a slow bridge send must not stack up timers.
    if (globals.__breadboardReviewSchedulerRunning) return;
    globals.__breadboardReviewSchedulerRunning = true;
    try {
      await runDueReviews();
    } catch {
      // Nothing to record here: every card stays due, so the next tick retries.
    } finally {
      globals.__breadboardReviewSchedulerRunning = false;
    }
  };

  setTimeout(() => void tick(), 10_000);
  const timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  timer.unref();
  globals.__breadboardReviewScheduler = timer;
}
