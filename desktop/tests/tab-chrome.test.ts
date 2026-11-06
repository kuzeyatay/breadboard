import { test } from "node:test";
import assert from "node:assert/strict";
import { TAB_CHROME_PROBE, waitForTabChrome } from "../src/main/tab-chrome";
import { allowBackgroundFrames, REVEAL_FRAME_PROBE, runInDocument, waitForRevealFrame } from "../src/main/first-paint";

/** A page that is DOM-ready but whose document never stops loading. Electron's
 * `webContents.executeJavaScript` parks every call behind `did-stop-loading`
 * on such a page; the main frame's own `executeJavaScript` runs at once. */
function streamingPage(chromeReady: boolean) {
  const parked: Array<() => void> = [];
  const frameCalls: string[] = [];
  return {
    parked,
    frameCalls,
    isDestroyed: () => false,
    executeJavaScript: () => new Promise<unknown>((resolve) => { parked.push(() => resolve(true)); }),
    mainFrame: {
      executeJavaScript: async (code: string) => {
        frameCalls.push(code);
        if (code === TAB_CHROME_PROBE) return chromeReady;
        return undefined;
      },
    },
  };
}

test("the tab-chrome probe runs in the current document, not behind did-stop-loading", async () => {
  const page = streamingPage(true);
  let settled = false;
  await Promise.race([
    waitForTabChrome(page, () => true).then(() => { settled = true; }),
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
  assert.equal(settled, true, "a DOM-ready page still streaming its document must be probeable");
  assert.equal(page.parked.length, 0, "no probe may queue behind did-stop-loading");
  assert.deepEqual(page.frameCalls, [TAB_CHROME_PROBE]);
});

test("a page that never mounts its strip stops holding the outgoing page after the ceiling", async () => {
  const page = streamingPage(false);
  const started = Date.now();
  await waitForTabChrome(page, () => true, 120);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 100 && elapsed < 2_000, `ceiling must end the wait, took ${elapsed}ms`);
  assert.ok(page.frameCalls.length >= 1);
});

test("a cancelled reveal ends the tab-chrome wait immediately", async () => {
  const page = streamingPage(false);
  let pending = true;
  const wait = waitForTabChrome(page, () => pending, 60_000);
  pending = false;
  await Promise.race([wait, new Promise((_, reject) => setTimeout(() => reject(new Error("wait outlived its reveal")), 2_000))]);
});

test("the reveal-frame probe also runs in the current document", async () => {
  const page = streamingPage(true);
  assert.equal(await waitForRevealFrame(page, 500), true);
  assert.equal(page.parked.length, 0);
  assert.deepEqual(page.frameCalls, [REVEAL_FRAME_PROBE]);
});

test("a page without a main frame falls back to the contents", async () => {
  const calls: string[] = [];
  const page = {
    isDestroyed: () => false,
    executeJavaScript: async (code: string) => { calls.push(code); return true; },
  };
  assert.equal(await runInDocument(page, "1"), true);
  const disposed = {
    isDestroyed: () => false,
    executeJavaScript: async (code: string) => { calls.push(code); return true; },
    get mainFrame(): never { throw new Error("Render frame was disposed before WebFrameMain could be accessed"); },
  };
  assert.equal(await runInDocument(disposed, "2"), true);
  assert.deepEqual(calls, ["1", "2"]);
});

test("a timed-out or discarded document never confirms a reveal frame", async () => {
  const page = { isDestroyed: () => false, executeJavaScript: () => new Promise(() => {}) };
  assert.equal(await waitForRevealFrame(page, 20), false);
  assert.equal(await waitForRevealFrame({ ...page, executeJavaScript: async () => { throw new Error("Document replaced"); } }), false);
  assert.equal(await waitForRevealFrame({ ...page, isDestroyed: () => true }), false);
});

test("a foreground frame can arrive late, but cancellation retires its handoff", async () => {
  let finish!: () => void;
  const page = {
    isDestroyed: () => false,
    executeJavaScript: () => new Promise<void>(resolve => { finish = resolve; }),
  };
  const controller = new AbortController();
  let settled = false;
  const wait = waitForRevealFrame(page, null, controller.signal).then(ready => { settled = true; return ready; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, false);
  finish();
  assert.equal(await wait, true);

  const cancelled = waitForRevealFrame(page, null, controller.signal);
  controller.abort();
  assert.equal(await cancelled, false);
  finish();
  assert.equal(await cancelled, false, "late completion cannot turn cancellation into success");
});

test("overlapping startup and reveal waits restore throttling only after both finish", async () => {
  for (const initiallyThrottled of [true, false]) {
    let throttled = initiallyThrottled;
    let finish!: () => void;
    const page = {
      isDestroyed: () => false,
      getBackgroundThrottling: () => throttled,
      setBackgroundThrottling: (value: boolean) => { throttled = value; },
      executeJavaScript: () => new Promise<void>(resolve => { finish = resolve; }),
    };
    const startupDone = allowBackgroundFrames(page);
    const controller = new AbortController();
    const reveal = waitForRevealFrame(page, null, controller.signal);
    startupDone();
    assert.equal(throttled, false, "startup cleanup cannot starve a pending reveal");
    controller.abort();
    assert.equal(await reveal, false);
    assert.equal(throttled, initiallyThrottled);
    finish();
    await Promise.resolve();
    assert.equal(throttled, initiallyThrottled, "late frames cannot release the same lease twice");
  }
});
