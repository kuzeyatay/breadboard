import { test } from "node:test";
import assert from "node:assert/strict";
import { TabSurfaceCache, idleUnloadDelayMs, surfaceReservation, TAB_SURFACE_BUDGET_BYTES, warmBackgroundTabs } from "../src/main/tab-surface-cache";

test("LRU evicts only inactive surfaces within the reserved memory budget", () => {
  const cache = new TabSurfaceCache();
  const size = 40 * 1024 * 1024;
  for (const id of [1, 2, 3, 4, 5]) cache.touch(id, size);
  cache.touch(2, size);
  assert.deepEqual(cache.trim(new Set([5])), [1]);
  cache.setPressure("constrained");
  assert.equal(cache.canPrewarm, false);
  assert.deepEqual(cache.trim(new Set([5])), [3, 4, 2]);
  cache.touch(6, size);
  cache.setPressure("critical");
  assert.deepEqual(cache.trim(new Set([5])), [6]);
  cache.setPressure("normal");
  assert.equal(cache.budget, TAB_SURFACE_BUDGET_BYTES);
  assert.equal(cache.canPrewarm, true);
});

test("DPI resizing updates reservations without changing LRU order", () => {
  const cache = new TabSurfaceCache();
  cache.touch(1, surfaceReservation(1440, 920, 1));
  cache.touch(2, surfaceReservation(1440, 920, 1));
  cache.resize(1, surfaceReservation(3840, 2160, 2));
  assert.deepEqual(cache.trim(new Set([2])), [1]);
  cache.forget(2);
  assert.equal(cache.bytes, 0);
});

test("idle background tabs unload sooner as Windows commit runs out", () => {
  assert.equal(idleUnloadDelayMs("normal", null), 10 * 60_000);
  assert.equal(idleUnloadDelayMs("normal", 20_000), 10 * 60_000);
  assert.equal(idleUnloadDelayMs("normal", 6_000), 5 * 60_000);
  assert.equal(idleUnloadDelayMs("constrained", 20_000), 5 * 60_000);
  assert.equal(idleUnloadDelayMs("normal", 3_000), 0);
  assert.equal(idleUnloadDelayMs("critical", null), 0);
});

test("the few most recently left background tabs stay warm unless memory is short", () => {
  const tabs = [{ id: 1, backgroundSince: 100 }, { id: 2, backgroundSince: 400 }, { id: 3 }, { id: 4, backgroundSince: 300 }, { id: 5, backgroundSince: 200 }];
  assert.deepEqual([...warmBackgroundTabs(tabs, 60_000, 3)], [2, 4, 5]);
  assert.deepEqual([...warmBackgroundTabs(tabs, 0, 3)], []);
});
