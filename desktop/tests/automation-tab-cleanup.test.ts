import assert from "node:assert/strict";
import { test } from "node:test";
import { AutomationTabCleanup } from "../src/main/automation-tab-cleanup";

test("desktop cleanup retries unavailable status and releases only confirmed owners", async () => {
  const owners = new Set(["finished", "active", "unknown"]);
  const released: string[] = [];
  let unavailable = true;
  const cleanup = new AutomationTabCleanup({
    owners: () => [...owners],
    finished: async () => {
      if (unavailable) throw new Error("dashboard restarting");
      return ["finished", "finished", "another-window-owner-not-requested"];
    },
    release: owner => { released.push(owner); owners.delete(owner); },
  });
  await assert.rejects(cleanup.reconcile(), /restarting/);
  assert.deepEqual(released, []);
  unavailable = false;
  await cleanup.reconcile();
  await cleanup.reconcile();
  assert.deepEqual(released, ["finished"]);
  assert.deepEqual([...owners], ["active", "unknown"]);
  cleanup.stop();
});

test("cleanup coalesces overlapping checks and ignores replies after shutdown", async () => {
  let finish!: (owners: string[]) => void;
  let signal: AbortSignal | undefined;
  const cleanup = new AutomationTabCleanup({
    owners: () => ["finished"],
    finished: (_owners, requestSignal) => {
      signal = requestSignal;
      return new Promise(resolve => { finish = resolve; });
    },
    release: () => assert.fail("a stopped monitor must not close tabs"),
  });
  const check = cleanup.reconcile();
  assert.equal(cleanup.reconcile(), check);
  cleanup.stop();
  assert.equal(signal?.aborted, true);
  finish(["finished"]);
  await check;
});

test("cleanup covers every owner in bounded batches and stays idle without AI tabs", async () => {
  let owners = Array.from({ length: 140 }, (_, i) => `task-${i}`);
  const calls: number[] = [], released: string[] = [];
  const cleanup = new AutomationTabCleanup({
    owners: () => owners,
    finished: async batch => { calls.push(batch.length); return batch; },
    release: owner => { released.push(owner); },
  });
  await cleanup.reconcile();
  assert.deepEqual(calls, [64, 64, 12]);
  assert.deepEqual(released, owners);
  owners = [];
  await cleanup.reconcile();
  assert.equal(calls.length, 3);
  cleanup.stop();
});
