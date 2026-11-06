import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-staging-prune-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
// learn.ts uses the @/ alias; register the hook the Learn worker uses.
await import("../scripts/learn-worker-import-hook.mjs");
const { pruneSettledGardenStagingCopies } = await import("../src/lib/learn.ts");

test("settled gardens lose their promotion leftovers; a half-swapped garden keeps its copy", (t) => {
  // Live 2026-09-30: nothing pruned these, and failed telecom-1 runs filled C:.
  // The open SQLite file keeps the root locked on Windows until exit.
  t.after(() => { try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {} });
  const content = path.join(dataRoot, "content");
  fs.mkdirSync(path.join(content, "g1"), { recursive: true });
  for (const name of [".g1.incoming-a", ".g1.previous-b", ".g1.failed-commit-c", ".g2.previous-d"]) {
    fs.mkdirSync(path.join(content, name, "assets"), { recursive: true });
  }
  const removed = pruneSettledGardenStagingCopies(content);
  assert.deepEqual(removed.sort(), [".g1.failed-commit-c", ".g1.incoming-a", ".g1.previous-b"]);
  assert.equal(fs.existsSync(path.join(content, ".g2.previous-d")), true, "g2 has no live tree, so its copy is the garden");
  assert.equal(fs.existsSync(path.join(content, "g1")), true);
});
