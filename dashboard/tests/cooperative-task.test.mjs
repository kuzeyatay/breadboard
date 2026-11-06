import assert from "node:assert/strict";
import test from "node:test";
import { runCooperatively } from "../src/lib/cooperative-task.ts";

test("long scans yield to other requests without losing their result", async t => {
  let clock = 0;
  t.mock.method(performance, "now", () => clock += 2);
  // Framework-local immediates must not make the scan a microtask-only loop.
  t.mock.method(globalThis, "setImmediate", callback => queueMicrotask(callback));
  let served = false;
  setTimeout(() => { served = true; }, 0);
  function* scan() {
    for (let entry = 0; entry < 80; entry++) yield;
    assert.equal(served, true);
    return 42;
  }
  assert.equal(await runCooperatively(scan()), 42);
});

test("failed scans close resources and propagate the original error", async () => {
  let closed = false;
  const error = new Error("disk unavailable");
  function* scan() {
    try { yield; throw error; }
    finally { closed = true; }
  }
  await assert.rejects(runCooperatively(scan()), error);
  assert.equal(closed, true);
});
