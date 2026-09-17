import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { TAB_CHROME_PROBE, waitForTabChrome } from "../src/main/tab-chrome";
import { REVEAL_FRAME_PROBE, runInDocument, waitForRevealFrame } from "../src/main/first-paint";

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
  await waitForRevealFrame(page, 500);
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

test("a tab reveal bounds every wait after DOM-ready under one ceiling", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "..", "src", "main", "tab-manager.ts"), "utf8");
  const reveal = source.slice(source.indexOf("private async reveal("), source.indexOf("private async frameReady("));
  const race = reveal.indexOf("await Promise.race([");
  assert.ok(race > 0);
  assert.ok(reveal.indexOf("waitForTabChrome(") > race, "the tab-chrome wait must sit inside the ceiling race");
  assert.ok(reveal.indexOf("this.frameReady(tab)") > race, "the frame wait must sit inside the ceiling race");
  assert.doesNotMatch(reveal, /tab\.contents\.executeJavaScript/);
});
