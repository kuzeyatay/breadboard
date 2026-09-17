import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import type { WebContents } from "electron";
import { installRendererRecovery } from "../src/main/renderer-recovery";

function fixture() {
  const contents = Object.assign(new EventEmitter(), { isDestroyed: (): boolean => false });
  let recoveries = 0;
  const dispose = installRendererRecovery(contents as unknown as WebContents, () => { recoveries += 1; });
  return { contents, dispose, recoveries: () => recoveries };
}

test("renderer recovery waits past the crash notification and its microtasks", async () => {
  const f = fixture();
  f.contents.emit("render-process-gone");
  f.contents.emit("render-process-gone");
  assert.equal(f.recoveries(), 0);
  await Promise.resolve();
  assert.equal(f.recoveries(), 0);
  await nextTurn();
  assert.equal(f.recoveries(), 1, "duplicate notifications share one pending recovery");
  f.contents.emit("render-process-gone");
  await nextTurn();
  assert.equal(f.recoveries(), 2, "a later crash can still recover");
  f.dispose();
});

test("closing a crashed page cancels its pending recovery and listeners", async () => {
  const f = fixture();
  f.contents.emit("render-process-gone");
  f.contents.isDestroyed = () => true;
  f.contents.emit("destroyed");
  await nextTurn();
  assert.equal(f.recoveries(), 0);
  assert.deepEqual(f.contents.eventNames(), []);
});

test("navigation wins over pending crash recovery without being overwritten", async () => {
  const f = fixture();
  f.contents.emit("render-process-gone");
  f.contents.emit("did-start-navigation", {}, "https://example.test/new", false, true);
  await nextTurn();
  assert.equal(f.recoveries(), 0);
  f.contents.emit("render-process-gone");
  f.contents.emit("did-start-navigation", {}, "https://example.test/frame", false, false);
  await nextTurn();
  assert.equal(f.recoveries(), 1, "subframe navigation does not recover the main page");
  f.dispose();
});

test("retiring a recovery handler cancels it and leaves other listeners intact", async () => {
  const f = fixture();
  const diagnostic = () => {};
  f.contents.on("render-process-gone", diagnostic);
  f.contents.emit("render-process-gone");
  f.dispose();
  f.dispose();
  await nextTurn();
  assert.equal(f.recoveries(), 0);
  assert.deepEqual(f.contents.listeners("render-process-gone"), [diagnostic]);
  assert.equal(f.contents.listenerCount("did-start-navigation"), 0);
  assert.equal(f.contents.listenerCount("destroyed"), 0);
});
