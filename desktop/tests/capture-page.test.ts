import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebContents } from "electron";
import { capturePageWithFreshFrame } from "../src/main/capture-page";

test("overlapping captures serialize and release their debugger after failures", async () => {
  let attached = false;
  let active = 0;
  let attempts = 0;
  const contents = {
    isDestroyed: () => false,
    isCrashed: () => false,
    capturePage: () => assert.fail("Do not acquire a native visible capturer"),
    debugger: {
      isAttached: () => attached,
      attach: () => { assert.equal(attached, false); attached = true; },
      detach: () => { assert.equal(active, 0); attached = false; },
      sendCommand: async (method: string) => {
        if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 800, clientHeight: 600 } };
        assert.equal(method, "Page.captureScreenshot");
        assert.equal(active++, 0, "Only one screenshot may use the debugger at a time");
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        throw new Error("fixture render failure");
      },
    },
  } as unknown as WebContents;
  const captures = await Promise.allSettled([capturePageWithFreshFrame(contents), capturePageWithFreshFrame(contents)]);
  assert.equal(captures.every(result => result.status === "rejected" && /fixture render failure/.test(result.reason.message)), true);
  assert.equal(attempts, 2, "A failed capture does not poison later requests");
  assert.equal(attached, false);
});

test("capture preserves an existing debugger connection", async () => {
  const contents = {
    isDestroyed: () => false, isCrashed: () => false,
    debugger: {
      isAttached: () => true,
      attach: () => assert.fail("Already attached"),
      detach: () => assert.fail("Do not detach another debugger owner"),
      sendCommand: async () => { throw new Error("fixture render failure"); },
    },
  } as unknown as WebContents;
  await assert.rejects(capturePageWithFreshFrame(contents), /fixture render failure/);
});

for (const unavailable of ["destroyed", "crashed"]) {
  test(`a ${unavailable} page never reaches the native capture API`, async () => {
    await assert.rejects(capturePageWithFreshFrame({
      isDestroyed: () => unavailable === "destroyed",
      isCrashed: () => unavailable === "crashed",
      capturePage: () => { throw new Error("native capture must not run"); },
    } as unknown as WebContents), /no longer available/);
  });
}
