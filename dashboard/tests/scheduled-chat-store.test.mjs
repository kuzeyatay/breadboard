import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import {
  LEASE_SECONDS,
  MAX_SCHEDULES_PER_USER,
  ScheduleError,
  ScheduledChatJobStore,
  presentScheduledChatJob,
} from "../src/lib/schedules/store.ts";

function createStore() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT);
    INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com');
  `);
  const store = new ScheduledChatJobStore(db);
  store.rawDatabase = db;
  return store;
}

const at = (year, month, day, hour, minute) =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

const terminalJob = {
  title: "Morning briefing",
  prompt: "Summarize what changed since yesterday.",
  cron: "0 9 * * *",
  surface: "dashboard_terminal",
};

test("a created schedule is armed with its first future run", () => {
  const store = createStore();
  const row = store.create(1, terminalJob, at(2026, 7, 30, 8, 0));
  assert.equal(row.enabled, 1);
  assert.deepEqual(new Date(row.next_run_at), at(2026, 7, 30, 9, 0));

  const presented = presentScheduledChatJob(row);
  assert.equal(presented.cronDescription, "At 09:00 every day");
  assert.equal(presented.surface, "dashboard_terminal");
  assert.equal(presented.gardenSlug, null);
  assert.equal(presented.model, "gpt-5.6-sol");
  assert.equal(presented.reasoningEffort, "high");
  assert.equal(presented.title, terminalJob.prompt);
  assert.equal(presented.conversationPolicy, "always_open");
});

test("an availability watch uses the prompt as its title and waits to open a chat", () => {
  const store = createStore();
  const prompt = "notify me when 2027 Turkish GP tickets become available";
  const row = store.create(1, {
    ...terminalJob,
    title: "Notify me when 2027 Turkish GP",
    prompt,
  });

  assert.equal(row.title, prompt);
  assert.equal(row.conversation_policy, "open_when_objective_met");
  const presented = presentScheduledChatJob(row);
  assert.equal(presented.title, prompt);
  assert.equal(presented.conversationPolicy, "open_when_objective_met");
});

test("the additive migration repairs an existing summarized watch", () => {
  const store = createStore();
  const prompt = "notify me when 2027 Turkish GP tickets become available";
  const row = store.create(1, { ...terminalJob, prompt });
  store.rawDatabase.prepare(`
    UPDATE scheduled_chat_jobs
    SET title = 'Notify me when 2027 Turkish GP', conversation_policy = 'always_open'
    WHERE id = ?
  `).run(row.id);

  const migrated = new ScheduledChatJobStore(store.rawDatabase, "migration-test")
    .require(1, row.id);
  assert.equal(migrated.title, prompt);
  assert.equal(migrated.conversation_policy, "open_when_objective_met");
});

test("a one-time schedule fires once and disarms while its chat is running", () => {
  const store = createStore();
  const createdAt = at(2026, 8, 31, 12, 0);
  const dueAt = at(2026, 8, 31, 13, 30);
  const row = store.create(1, {
    ...terminalJob,
    cron: "30 13 31 8 *",
    oneShot: true,
    runAt: dueAt.toISOString(),
  }, createdAt);

  let presented = presentScheduledChatJob(row, createdAt);
  assert.equal(presented.oneShot, true);
  assert.equal(presented.cronDescription, "Once");
  assert.deepEqual(new Date(presented.nextRunAt), dueAt);
  assert.equal(store.claimDue(at(2026, 8, 31, 13, 29)).length, 0);

  const claimed = store.claimDue(dueAt);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].enabled, 0, "claiming atomically prevents another firing");
  assert.equal(store.claimDue(dueAt).length, 0);
  presented = presentScheduledChatJob(store.require(1, row.id), dueAt);
  assert.equal(presented.running, true);
  assert.deepEqual(new Date(presented.nextRunAt), dueAt);

  store.recordRun(row.id, { status: "ok", conversationId: "conv_once", at: dueAt });
  presented = presentScheduledChatJob(store.require(1, row.id), dueAt);
  assert.equal(presented.enabled, false);
  assert.equal(presented.running, false);
  assert.equal(presented.nextRunAt, null);
});

test("a schedule keeps the intelligence selected when it was created", () => {
  const store = createStore();
  const row = store.create(1, {
    ...terminalJob,
    model: "gpt-5.6-terra",
    reasoningEffort: "max",
  });

  assert.equal(row.model, "gpt-5.6-terra");
  assert.equal(row.reasoning_effort, "max");
  assert.equal(presentScheduledChatJob(row).reasoningEffort, "max");
  assert.throws(
    () => store.update(1, row.id, { reasoningEffort: "impossible" }),
    ScheduleError,
  );
});

test("a messaging reminder keeps its direct delivery contract", () => {
  const store = createStore();
  const row = store.create(1, {
    ...terminalJob,
    prompt: "drink water",
    deliveryChannel: "telegram",
    deliveryMode: "reminder",
  });
  assert.equal(row.delivery_channel, "telegram");
  assert.equal(row.delivery_mode, "reminder");

  const edited = store.update(1, row.id, { prompt: "stretch" });
  assert.equal(edited.prompt, "stretch");
  assert.equal(edited.delivery_channel, "telegram");
  assert.equal(edited.delivery_mode, "reminder");
  assert.throws(
    () => store.create(1, { ...terminalJob, deliveryChannel: "telegram" }),
    ScheduleError,
  );
});

test("a reminder can target Breadboard chat when no phone link is available", () => {
  const store = createStore();
  const row = store.create(1, {
    ...terminalJob,
    prompt: "Physics starts at 10:00",
    deliveryMode: "reminder",
    deliveryChannel: null,
  });
  assert.equal(row.delivery_channel, null);
  assert.equal(row.delivery_mode, "reminder");
  assert.equal(row.conversation_policy, "always_open");
  assert.throws(
    () => store.create(1, { ...terminalJob, deliveryChannel: "telegram" }),
    /needs a delivery mode/,
  );
});

test("a garden schedule keeps its garden and a terminal schedule cannot have one", () => {
  const store = createStore();
  const garden = store.create(1, { ...terminalJob, surface: "garden_chat", gardenSlug: "physics" });
  assert.equal(garden.garden_slug, "physics");

  assert.throws(
    () => store.create(1, { ...terminalJob, surface: "garden_chat" }),
    ScheduleError,
  );

  const moved = store.update(1, garden.id, { surface: "dashboard_terminal" });
  assert.equal(moved.garden_slug, null);
});

test("invalid input is rejected as a 400, not stored", () => {
  const store = createStore();
  assert.throws(() => store.create(1, { ...terminalJob, cron: "0 99 * * *" }), (error) => {
    assert.ok(error instanceof ScheduleError);
    assert.equal(error.status, 400);
    return true;
  });
  assert.equal(
    store.create(1, { ...terminalJob, title: "  " }).title,
    terminalJob.prompt,
    "legacy custom titles cannot replace the prompt",
  );
  assert.throws(() => store.create(1, { ...terminalJob, prompt: "" }), ScheduleError);
  assert.equal(store.list(1).length, 1);
});

test("schedules are per user and never leak across accounts", () => {
  const store = createStore();
  const mine = store.create(1, terminalJob);
  store.create(2, { ...terminalJob, title: "Someone else's" });

  assert.deepEqual(store.list(1).map((row) => row.title), [terminalJob.prompt]);
  assert.equal(store.get(2, mine.id), null);
  assert.equal(store.delete(2, mine.id), false);
  assert.throws(() => store.require(2, mine.id), ScheduleError);
});

test("claiming a due job advances it once, so two ticks cannot double-fire", () => {
  const store = createStore();
  store.create(1, terminalJob, at(2026, 7, 30, 8, 0));

  const firstTick = store.claimDue(at(2026, 7, 30, 9, 0));
  assert.equal(firstTick.length, 1);
  assert.deepEqual(new Date(firstTick[0].next_run_at), at(2026, 7, 31, 9, 0));

  const secondTick = store.claimDue(at(2026, 7, 30, 9, 0));
  assert.equal(secondTick.length, 0);
});

test("a job missed while the server was down fires once, not once per missed run", () => {
  const store = createStore();
  store.create(1, terminalJob, at(2026, 7, 20, 8, 0));

  // Nine days of downtime; the catch-up tick must not replay nine runs.
  const claimed = store.claimDue(at(2026, 7, 29, 12, 0));
  assert.equal(claimed.length, 1);
  assert.deepEqual(new Date(claimed[0].next_run_at), at(2026, 7, 30, 9, 0));
  assert.equal(store.claimDue(at(2026, 7, 29, 12, 0)).length, 0);
});

// ---------------------------------------------------------- execution leases

test("a job still running is not claimed again at its next occurrence", () => {
  const store = createStore();
  // Every minute, so the next occurrence arrives long before a slow run ends.
  store.create(1, { ...terminalJob, cron: "* * * * *" }, at(2026, 7, 30, 8, 0));

  const first = store.claimDue(at(2026, 7, 30, 9, 0));
  assert.equal(first.length, 1);
  assert.ok(first[0].lease_owner, "claiming takes a lease");

  // A minute later the schedule is due again — but the previous firing has not
  // reported back, so it must not start a second one on top of it.
  assert.equal(
    store.claimDue(at(2026, 7, 30, 9, 1)).length,
    0,
    "the lease outlives the occurrence that took it",
  );
});

test("finishing a run releases the lease so the next occurrence can fire", () => {
  const store = createStore();
  const row = store.create(1, { ...terminalJob, cron: "* * * * *" }, at(2026, 7, 30, 8, 0));

  store.claimDue(at(2026, 7, 30, 9, 0));
  assert.equal(store.holdsLease(row.id, at(2026, 7, 30, 9, 0)), true);

  store.recordRun(row.id, { status: "ok", conversationId: "conv-1" });
  assert.equal(store.holdsLease(row.id, at(2026, 7, 30, 9, 0)), false);
  assert.equal(store.claimDue(at(2026, 7, 30, 9, 1)).length, 1);
});

test("a lease from a dead process expires, so the schedule recovers on its own", () => {
  const store = createStore();
  store.create(1, { ...terminalJob, cron: "* * * * *" }, at(2026, 7, 30, 8, 0));

  store.claimDue(at(2026, 7, 30, 9, 0));
  // The process holding it never comes back. Well inside the lease, nothing runs.
  assert.equal(store.claimDue(at(2026, 7, 30, 9, 5)).length, 0);
  // Past it, the job is claimable again rather than stuck forever.
  const recovered = store.claimDue(
    new Date(at(2026, 7, 30, 9, 0).getTime() + (LEASE_SECONDS + 60) * 1000),
  );
  assert.equal(recovered.length, 1);
});

test("two processes on one database cannot both claim the same job", () => {
  const store = createStore();
  // A second store over the same handle is exactly what the desktop app and the
  // dev server are: different owners, one file.
  const other = new ScheduledChatJobStore(store.rawDatabase, "another-process");
  store.create(1, terminalJob, at(2026, 7, 30, 8, 0));

  const mine = store.claimDue(at(2026, 7, 30, 9, 0));
  const theirs = other.claimDue(at(2026, 7, 30, 9, 0));
  assert.equal(mine.length + theirs.length, 1, "exactly one of them gets the job");
});

test("a run that overran its lease cannot release the new holder's claim", () => {
  const store = createStore();
  const other = new ScheduledChatJobStore(store.rawDatabase, "another-process");
  const row = store.create(1, { ...terminalJob, cron: "* * * * *" }, at(2026, 7, 30, 8, 0));

  store.claimDue(at(2026, 7, 30, 9, 0));
  // The original overruns; the lease lapses and the other process takes over.
  const takeover = new Date(at(2026, 7, 30, 9, 0).getTime() + (LEASE_SECONDS + 60) * 1000);
  assert.equal(other.claimDue(takeover).length, 1);

  // The original finally finishes. It has lost the job and must say so.
  assert.equal(store.releaseLease(row.id), false);
  assert.equal(other.holdsLease(row.id, takeover), true);
});

test("a schedule reports whether a firing is in flight", () => {
  const store = createStore();
  const clock = at(2026, 7, 30, 9, 0);
  const row = store.create(1, terminalJob, at(2026, 7, 30, 8, 0));
  assert.equal(presentScheduledChatJob(store.require(1, row.id), clock).running, false);

  store.claimDue(clock);
  assert.equal(presentScheduledChatJob(store.require(1, row.id), clock).running, true);

  store.recordRun(row.id, { status: "ok" });
  assert.equal(presentScheduledChatJob(store.require(1, row.id), clock).running, false);

  // An abandoned lease stops claiming to be a run once it lapses.
  store.claimDue(clock);
  const afterLease = new Date(clock.getTime() + (LEASE_SECONDS + 60) * 1000);
  assert.equal(presentScheduledChatJob(store.require(1, row.id), afterLease).running, false);
});

test("paused schedules never come due and resume from now", () => {
  const store = createStore();
  const row = store.create(1, terminalJob, at(2026, 7, 30, 8, 0));

  store.update(1, row.id, { enabled: false }, at(2026, 7, 30, 8, 30));
  assert.equal(store.claimDue(at(2026, 8, 5, 12, 0)).length, 0);
  assert.equal(presentScheduledChatJob(store.require(1, row.id)).nextRunAt, null);

  const resumed = store.update(1, row.id, { enabled: true }, at(2026, 8, 5, 12, 0));
  assert.deepEqual(new Date(resumed.next_run_at), at(2026, 8, 6, 9, 0));
});

test("editing the cadence recomputes the next run from now", () => {
  const store = createStore();
  const row = store.create(1, terminalJob, at(2026, 7, 30, 8, 0));
  const updated = store.update(1, row.id, { cron: "0 18 * * *" }, at(2026, 7, 30, 8, 30));
  assert.deepEqual(new Date(updated.next_run_at), at(2026, 7, 30, 18, 0));
});

test("run outcomes are recorded for the dashboard dock", () => {
  const store = createStore();
  const row = store.create(1, terminalJob);

  store.recordRun(row.id, { status: "ok", conversationId: "conv_abc", at: at(2026, 7, 30, 9, 0) });
  let presented = presentScheduledChatJob(store.require(1, row.id));
  assert.equal(presented.lastStatus, "ok");
  assert.equal(presented.lastConversationId, "conv_abc");
  assert.equal(presented.runCount, 1);
  assert.equal(presented.lastError, null);

  store.recordRun(row.id, { status: "failed", error: "The agent runtime is unavailable." });
  presented = presentScheduledChatJob(store.require(1, row.id));
  assert.equal(presented.lastStatus, "failed");
  assert.equal(presented.lastError, "The agent runtime is unavailable.");
  assert.equal(presented.runCount, 2);
});

test("a watch disarms itself after its objective is met", () => {
  const store = createStore();
  const row = store.create(1, {
    ...terminalJob,
    prompt: "notify me when 2027 Turkish GP tickets become available",
  });

  store.recordRun(row.id, {
    status: "ok",
    conversationId: null,
    objectiveDecision: "pending",
  });
  assert.equal(store.require(1, row.id).enabled, 1);

  store.recordRun(row.id, {
    status: "ok",
    conversationId: "conv_tickets",
    objectiveDecision: "met",
  });
  assert.equal(store.require(1, row.id).enabled, 0);
});

test("a corrupt expression is disabled rather than retried every tick", () => {
  const store = createStore();
  const row = store.create(1, terminalJob, at(2026, 7, 30, 8, 0));
  // Only reachable by a direct database edit; the store and API both validate.
  store.rawDatabase
    .prepare("UPDATE scheduled_chat_jobs SET cron_expression = ? WHERE id = ?")
    .run("not a cron", row.id);

  assert.equal(store.claimDue(at(2026, 7, 30, 9, 0)).length, 0);
  const disabled = store.require(1, row.id);
  assert.equal(disabled.enabled, 0);
  assert.equal(disabled.last_status, "failed");
});

test("the per-user schedule cap is enforced", () => {
  const store = createStore();
  for (let index = 0; index < MAX_SCHEDULES_PER_USER; index += 1) {
    store.create(1, { ...terminalJob, title: `Job ${index}` });
  }
  assert.throws(() => store.create(1, terminalJob), (error) => {
    assert.equal(error.status, 409);
    return true;
  });
  // The cap is per user, so another account is unaffected.
  assert.ok(store.create(2, terminalJob).id > 0);
});
