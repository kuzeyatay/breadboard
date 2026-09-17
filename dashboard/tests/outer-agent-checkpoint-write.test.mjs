import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicReplace } from "../scripts/runtime-v2-outer-agent-worker-core.mjs";

function checkpoint(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-checkpoint-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "checkpoint.json");
  const previous = JSON.stringify({ status: "running", events: ["research collected"] });
  const next = Buffer.from(JSON.stringify({ status: "completed", events: ["research collected", "report"] }));
  fs.writeFileSync(file, previous);
  return { root, file, previous, next };
}

for (const code of ["EPERM", "EACCES", "EBUSY"]) {
  test(`a transient Windows ${code} preserves the checkpoint and completes the same write`, (t) => {
    const { root, file, previous, next } = checkpoint(t);
    const waits = [];
    const pendingPaths = new Set();
    let attempts = 0;
    atomicReplace(file, next, 1024, "checkpoint", {
      platform: "win32",
      renameSync(pending, destination) {
        pendingPaths.add(pending);
        assert.equal(destination, file);
        assert.equal(fs.readFileSync(file, "utf8"), previous);
        assert.deepEqual(fs.readFileSync(pending), next);
        if (++attempts <= 3) throw Object.assign(new Error("temporarily locked"), { code });
        fs.renameSync(pending, destination);
      },
      waitSync: (ms) => waits.push(ms),
    });
    assert.equal(attempts, 4);
    assert.deepEqual(waits, [10, 25, 50]);
    assert.equal(pendingPaths.size, 1, "retry the durable bytes, never rerun research");
    assert.deepEqual(fs.readFileSync(file), next);
    assert.deepEqual(fs.readdirSync(root), ["checkpoint.json"]);
  });
}

test("a persistent lock fails within a bounded retry window and keeps the previous checkpoint", (t) => {
  const { root, file, previous, next } = checkpoint(t);
  const error = Object.assign(new Error("checkpoint stays locked"), { code: "EPERM" });
  const waits = [];
  let attempts = 0;
  assert.throws(() => atomicReplace(file, next, 1024, "checkpoint", {
    platform: "win32",
    renameSync() { attempts++; throw error; },
    waitSync: (ms) => waits.push(ms),
  }), (thrown) => thrown === error);
  assert.equal(attempts, 8);
  assert.equal(waits.reduce((sum, ms) => sum + ms, 0), 1585);
  assert.equal(fs.readFileSync(file, "utf8"), previous);
  assert.deepEqual(fs.readdirSync(root), ["checkpoint.json"]);
});

for (const [platform, code] of [["win32", "ENOSPC"], ["linux", "EPERM"]]) {
  test(`${platform} ${code} fails immediately without changing the checkpoint`, (t) => {
    const { file, previous, next } = checkpoint(t);
    const error = Object.assign(new Error("write failed"), { code });
    let attempts = 0;
    assert.throws(() => atomicReplace(file, next, 1024, "checkpoint", {
      platform,
      renameSync() { attempts++; throw error; },
      waitSync() { assert.fail("must not retry this error"); },
    }), (thrown) => thrown === error);
    assert.equal(attempts, 1);
    assert.equal(fs.readFileSync(file, "utf8"), previous);
  });
}

test("invalid checkpoint sizes are rejected before touching durable state", (t) => {
  const { root, file, previous } = checkpoint(t);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(1025)]) {
    assert.throws(() => atomicReplace(file, bytes, 1024, "checkpoint"), /bounded envelope/);
  }
  assert.equal(fs.readFileSync(file, "utf8"), previous);
  assert.deepEqual(fs.readdirSync(root), ["checkpoint.json"]);
});
