import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { waitForStartupPageLoad } from "../src/main/startup-page-load";

function page(url = "", loading = true, destroyed = false) {
  return Object.assign(new EventEmitter(), {
    getURL: () => url,
    isLoading: () => loading,
    isDestroyed: () => destroyed,
  });
}

test("startup waits past DOM readiness, subframe errors, and redirects", async () => {
  const contents = page();
  let ready = false;
  const pending = waitForStartupPageLoad(contents as unknown as WebContents).then((loaded) => {
    ready = true;
    return loaded;
  });
  contents.emit("dom-ready");
  contents.emit("did-fail-load", {}, -105, "subresource", "https://example.com", false);
  contents.emit("did-fail-load", {}, -3, "redirect", "https://example.com", true);
  await Promise.resolve();
  assert.equal(ready, false);
  contents.emit("did-finish-load");
  assert.equal(await pending, true);
  assert.deepEqual(contents.eventNames(), []);
});

test("already loaded pages are ready but an empty initial document is not", async () => {
  assert.equal(await waitForStartupPageLoad(page("https://example.com", false) as unknown as WebContents), true);
  const contents = page("", false);
  let ready = false;
  const pending = waitForStartupPageLoad(contents as unknown as WebContents).then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  contents.emit("did-finish-load");
  await pending;
});

test("a base tab enrolled during did-finish-load settles on the following stop event", async () => {
  const contents = page("https://example.com");
  const pending = waitForStartupPageLoad(contents as unknown as WebContents);
  contents.isLoading = () => false;
  contents.emit("did-stop-loading");
  assert.equal(await pending, true);
  assert.deepEqual(contents.eventNames(), []);
});

test("failed, crashed, and destroyed pages release startup waiters and listeners", async () => {
  for (const event of ["did-fail-load", "render-process-gone", "destroyed"]) {
    const contents = page();
    const pending = waitForStartupPageLoad(contents as unknown as WebContents);
    contents.emit(event, {}, -105, "offline", "https://example.com", true);
    assert.equal(await pending, false);
    assert.deepEqual(contents.eventNames(), []);
  }
  assert.equal(await waitForStartupPageLoad(page("", true, true) as unknown as WebContents), false);
});
