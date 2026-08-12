import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  ABANDONED_RUN_AFTER_MS,
  RUN_HEARTBEAT_INTERVAL_MS,
  isRuntimeRunAbandoned,
  runtimeRunLastSignalAt,
} from "../src/lib/hermes/run-liveness.ts";

const turnService = fs.readFileSync(
  new URL("../src/lib/conversations/turn-service.ts", import.meta.url),
  "utf8",
);
const branchRuntimeRoute = fs.readFileSync(
  new URL(
    "../src/app/api/hermes/sessions/[sessionId]/branch-runtime/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const recovery = fs.readFileSync(
  new URL("../src/lib/hermes/run-recovery.ts", import.meta.url),
  "utf8",
);

const NOW = Date.parse("2026-08-05T12:00:00.000Z");
const at = (msAgo) => new Date(NOW - msAgo).toISOString();

test("a beating pump keeps its run", () => {
  const run = { started_at: at(60 * 60_000), heartbeat_at: at(1_000) };
  assert.equal(runtimeRunLastSignalAt(run), NOW - 1_000);
  assert.equal(isRuntimeRunAbandoned(run, NOW), false);
});

test("a run whose pump stopped beating is abandoned", () => {
  // The incident: the process owning the pump went away mid-turn, the run
  // stayed active forever, and every later message in that conversation was
  // rejected with run_already_active.
  const run = {
    started_at: at(2 * ABANDONED_RUN_AFTER_MS),
    heartbeat_at: at(ABANDONED_RUN_AFTER_MS + 1),
  };
  assert.equal(isRuntimeRunAbandoned(run, NOW), true);
});

test("a just-dispatched run is given the same grace before its first beat", () => {
  // The stream opens before the prompt POST, so a run is briefly unclaimed.
  const fresh = { started_at: at(2_000), heartbeat_at: null };
  assert.equal(isRuntimeRunAbandoned(fresh, NOW), false);
  const stale = { started_at: at(ABANDONED_RUN_AFTER_MS + 1), heartbeat_at: null };
  assert.equal(isRuntimeRunAbandoned(stale, NOW), true);
});

test("an unreadable timestamp makes a run recoverable, never immortal", () => {
  assert.equal(
    isRuntimeRunAbandoned({ started_at: "not a date", heartbeat_at: null }, NOW),
    true,
  );
});

test("the grace period is many missed beats, so a stall cannot orphan a live turn", () => {
  assert.ok(ABANDONED_RUN_AFTER_MS / RUN_HEARTBEAT_INTERVAL_MS >= 12);
});

test("reclaiming frees the one-active-run slot the index enforces", () => {
  // The unique partial index is what turns a single orphan into a permanently
  // unusable conversation, so verify the reclaim's UPDATE actually releases it.
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE hermes_runs (
      id TEXT PRIMARY KEY,
      runtime_session_id INTEGER NOT NULL,
      instruction TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','completed','cancelled','error')),
      dispatch_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      heartbeat_at TEXT
    );
    CREATE UNIQUE INDEX idx_hermes_runs_one_active
      ON hermes_runs(runtime_session_id) WHERE status = 'active';
  `);
  const insert = db.prepare(
    "INSERT INTO hermes_runs (id, runtime_session_id, instruction, started_at) VALUES (?, ?, ?, ?)",
  );
  insert.run("orphan", 1, "how large is my downloads folder", at(ABANDONED_RUN_AFTER_MS * 3));
  assert.throws(() => insert.run("next", 1, "again", at(0)));

  const finished = db
    .prepare(
      "UPDATE hermes_runs SET status = 'error', finished_at = ? WHERE id = ? AND status = 'active'",
    )
    .run(new Date(NOW).toISOString(), "orphan");
  assert.equal(finished.changes, 1);
  insert.run("next", 1, "again", at(0));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM hermes_runs WHERE status = 'active'").get().n,
    1,
  );
  db.close();
});

test("both turn entry points clear debris before refusing a new message", () => {
  assert.match(turnService, /reclaimAbandonedRunForSession\(session\.row\.id\)/);
  assert.match(branchRuntimeRoute, /reclaimAbandonedRunForSession\(current\.row\.id\)/);
  // The refusal that remains is about a turn genuinely in flight, so it has to
  // tell the reader what to do about it.
  for (const source of [turnService, branchRuntimeRoute]) {
    assert.match(source, /Stop it or wait for it to finish/);
  }
});

test("recovery prefers resuming the pump so a finished answer is not lost", () => {
  // Hermes keeps the turn's result, so a run adopted after a restart can still
  // be persisted with its real answer instead of being reported as a failure.
  assert.match(recovery, /startSessionEventPump\(session\)/);
  // Every path still has to end the run, including the ones that cannot resume.
  assert.match(recovery, /reclaimAbandonedRun\(run\)/);
  assert.match(recovery, /finishRuntimeRun\(run\.id, "error"\)/);
  assert.match(recovery, /error: "runtime_run_abandoned"/);
});
