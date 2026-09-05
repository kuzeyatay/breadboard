import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createLearnRollbackTemporaryRoot,
  LEARN_ROLLBACK_TEMP_PREFIX,
  reclaimStaleLearnRollbackRoots,
  releaseLearnRollbackTemporaryRoot,
} from "../src/lib/learn-rollback-temp.ts";

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-rollback-temp-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("rollback temp roots carry a live owner and are removed on release", (t) => {
  const tempDir = fixtureRoot(t);
  const root = createLearnRollbackTemporaryRoot({ tempDir });
  assert.equal(path.dirname(root), tempDir);

  const farFuture = Date.now() + 48 * 60 * 60 * 1_000;
  const reclaim = reclaimStaleLearnRollbackRoots({
    tempDir,
    nowMs: farFuture,
    isProcessRunning: (pid) => pid === process.pid,
  });
  assert.deepEqual(reclaim.skippedActive, [root]);
  assert.equal(fs.existsSync(root), true);

  assert.equal(releaseLearnRollbackTemporaryRoot(root, { tempDir }), true);
  assert.equal(fs.existsSync(root), false);
});

test("stale legacy roots are reclaimed while recent and active roots survive", (t) => {
  const tempDir = fixtureRoot(t);
  const nowMs = Date.now();
  const old = new Date(nowMs - 48 * 60 * 60 * 1_000);

  const stale = fs.mkdtempSync(path.join(tempDir, LEARN_ROLLBACK_TEMP_PREFIX));
  fs.writeFileSync(path.join(stale, "large-copy.bin"), "stale");
  fs.utimesSync(stale, old, old);

  const recent = fs.mkdtempSync(path.join(tempDir, LEARN_ROLLBACK_TEMP_PREFIX));
  fs.writeFileSync(path.join(recent, "still-recent.bin"), "recent");

  const active = fs.mkdtempSync(path.join(tempDir, LEARN_ROLLBACK_TEMP_PREFIX));
  fs.writeFileSync(
    path.join(active, ".breadboard-rollback-owner.json"),
    `${JSON.stringify({ pid: 4242, createdAt: old.toISOString() })}\n`,
  );
  fs.utimesSync(active, old, old);

  const reclaim = reclaimStaleLearnRollbackRoots({
    tempDir,
    nowMs,
    isProcessRunning: (pid) => pid === 4242,
  });
  assert.deepEqual(reclaim.removed, [stale]);
  assert.deepEqual(reclaim.skippedActive, [active]);
  assert.deepEqual(reclaim.skippedRecent, [recent]);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(recent), true);
  assert.equal(fs.existsSync(active), true);
});

test("Learn rollback uses the managed temporary-root lifecycle", () => {
  const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "learn.ts"), "utf8");
  assert.match(source, /const temporaryRoot = createLearnRollbackTemporaryRoot\(\)/);
  assert.match(source, /finally \{\s*releaseLearnRollbackTemporaryRoot\(temporaryRoot\);\s*\}/);
  assert.match(
    source,
    /recoverAbandonedLearnJobs[\s\S]*?reclaimStaleLearnRollbackRoots\(\{ nowMs \}\)/,
  );
  assert.doesNotMatch(source, /path\.join\(os\.tmpdir\(\), "breadboard-learn-rollback-"\)/);
});
