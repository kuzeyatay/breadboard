import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import Database from "better-sqlite3";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-run-contention-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const runs = await import("../src/lib/hermes/run-store.ts");
const writer = new Database(db.name, { timeout: 1 });

after(() => {
  writer.close();
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

test("recording an accepted PDF turn survives a competing progress write", () => {
  const session = db.prepare(`INSERT INTO hermes_runtime_sessions
    (surface, agent_name, workspace_key) VALUES (?, ?, ?)`)
    .run("dashboard_terminal", "breadboard-terminal", "pdf:contention");
  const run = runs.beginRuntimeRun({
    runtimeSessionId: Number(session.lastInsertRowid),
    instruction: "What does the subscript p stand for?",
    dispatch: { clientMessageId: "pdf-follow-up", runtimeText: "selected equation", variant: "ultra" },
  });
  const heartbeat = "2026-10-02T08:31:22.000Z";
  const writeProgress = () => writer.prepare("UPDATE hermes_runs SET heartbeat_at = ? WHERE id = ?")
    .run(heartbeat, run.id);
  const prepare = db.prepare;
  let competingWriteAttempted = false;
  // Force another connection to write after the request reads its snapshot.
  // With a deferred transaction that write commits, and the request's update
  // fails with SQLITE_BUSY_SNAPSHOT despite the configured busy timeout.
  db.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    if (sql === "SELECT * FROM hermes_runs WHERE id = ?" && !competingWriteAttempted) {
      const get = statement.get;
      statement.get = function (...args) {
        const row = get.apply(this, args);
        competingWriteAttempted = true;
        try { writeProgress(); }
        catch (error) { assert.match(error.code, /^SQLITE_BUSY/); }
        return row;
      };
    }
    return statement;
  };
  const submittedAt = new Date("2026-10-02T08:31:20.000Z");
  try {
    assert.equal(runs.markRuntimeRunSubmitted(run.id, submittedAt), true);
  } finally {
    db.prepare = prepare;
  }
  assert.equal(competingWriteAttempted, true);
  // The other writer can finish as soon as the acknowledgement commits.
  writeProgress();
  assert.deepEqual(runs.parseRuntimeRunDispatch(runs.getRuntimeRun(run.id)), {
    clientMessageId: "pdf-follow-up", runtimeText: "selected equation", variant: "ultra",
    submittedAt: submittedAt.toISOString(),
  });
  assert.equal(runs.getRuntimeRun(run.id).heartbeat_at, heartbeat);
  assert.equal(runs.markRuntimeRunSubmitted(run.id, new Date()), false);
  assert.equal(runs.markRuntimeRunSubmitted("missing-run"), false);
  assert.equal(runs.parseRuntimeRunDispatch(runs.getRuntimeRun(run.id)).submittedAt, submittedAt.toISOString());
});
