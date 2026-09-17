import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { WebContents } from "electron";
import { BrowserTranslation, type TranslationSegment } from "../src/main/browser-translation";

async function until(probe: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (probe()) return;
    await setImmediate();
  }
  assert.fail("translation did not make progress");
}

function fixture(batches = 6) {
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { url: "https://example.org/", framesInSubtree: [] as unknown[] },
    isDestroyed: () => false,
    isLoadingMainFrame: () => false,
    getURL: () => "https://example.org/",
  });
  contents.mainFrame.framesInSubtree.push(contents.mainFrame);
  const requests: Array<{ signal: AbortSignal; finish: () => void; fail: (error: Error) => void }> = [];
  const applied: number[] = [];
  let collected = 0, running = 0, peak = 0;
  const translation = new BrowserTranslation(contents as unknown as WebContents, (segments, _language, signal) => {
    running++;
    peak = Math.max(peak, running);
    return new Promise((resolve, reject) => requests.push({
      signal,
      finish: () => { running--; resolve(segments.map(segment => ({ id: segment.id, text: `Translated ${segment.id}` }))); },
      fail: error => { running--; reject(error); },
    }));
  }, () => {});
  // The scheduler owns requests and lifecycle; the document collector is its boundary.
  Object.assign(translation, {
    execute: async (_frame: unknown, operation: string, payload?: TranslationSegment[]) => {
      if (operation === "restore") return [];
      if (operation === "apply") { applied.push(...payload!.map(segment => segment.id)); return payload!.length; }
      if (collected >= batches) return [];
      const id = ++collected;
      return [{ id, text: `Texto ${id}`, context: "" }];
    },
  });
  return { contents, translation, requests, applied, peak: () => peak };
}

test("a free translation slot takes more work while a slower batch is still pending", async t => {
  const f = fixture();
  t.after(() => f.contents.emit("destroyed"));
  await f.translation.start("en");
  await until(() => f.requests.length === 3);
  f.requests[1]!.finish();
  await until(() => f.requests.length === 4);
  assert.deepEqual(f.applied, [2], "the completed batch becomes readable immediately");
  f.requests[2]!.finish();
  await until(() => f.requests.length === 5);
  f.requests[3]!.finish();
  await until(() => f.requests.length === 6);
  assert.equal(f.peak(), 3, "refilling never exceeds the existing provider limit");
  f.requests[4]!.finish();
  f.requests[5]!.finish();
  await until(() => f.applied.length === 5);
  assert.equal(f.translation.state.status, "translating", "pending text still counts as work");
  f.requests[0]!.finish();
  await until(() => f.translation.state.status === "translated");
  assert.equal(f.translation.state.translated, 6);
});

test("a failed pipelined request aborts siblings and rejects their late results", async t => {
  const f = fixture();
  t.after(() => f.contents.emit("destroyed"));
  await f.translation.start("en");
  await until(() => f.requests.length === 3);
  f.requests[1]!.fail(new Error("Provider unavailable"));
  await until(() => f.translation.state.status === "error");
  assert.ok(f.requests.every(request => request.signal.aborted));
  f.requests[0]!.finish();
  f.requests[2]!.finish();
  await setImmediate();
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.applied, []);
  assert.equal(f.translation.state.error, "Provider unavailable");
});

test("restoring during pipelined translation prevents more requests and late page edits", async t => {
  const f = fixture();
  t.after(() => f.contents.emit("destroyed"));
  await f.translation.start("en");
  await until(() => f.requests.length === 3);
  await f.translation.restore();
  f.requests.forEach(request => request.finish());
  await setImmediate();
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.applied, []);
  assert.equal(f.translation.state.status, "original");
});
