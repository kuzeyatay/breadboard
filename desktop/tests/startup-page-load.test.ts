import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import type { WebContents } from "electron";
import { startupReadinessProbe, waitForStartupPageLoad, waitForStartupPageReady } from "../src/main/startup-page-load";

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

test("a pending navigation reports false at a diagnostic interval without stopping it", async () => {
  for (const url of ["", "https://example.com/slow"]) {
    const contents = page(url);
    const result = await waitForStartupPageLoad(contents as unknown as WebContents, 20);
    assert.equal(result, false);
    assert.equal(contents.isLoading(), true);
    assert.deepEqual(contents.eventNames(), []);
    // Completion after the ceiling is still owned by the tab's normal loader.
    contents.emit("did-finish-load");
  }
});

test("startup readiness bounds a wedged renderer and releases listeners on failure", async () => {
  const contents = Object.assign(page("http://localhost/new-tab", false), {
    mainFrame: { executeJavaScript: () => new Promise(() => {}) },
  });
  assert.equal(await waitForStartupPageReady(contents as unknown as WebContents, 20), false);
  assert.deepEqual(contents.eventNames(), []);
  for (const event of ["destroyed", "render-process-gone"]) {
    const pending = waitForStartupPageReady(contents as unknown as WebContents, 1_000);
    contents.emit(event);
    assert.equal(await pending, false);
    assert.deepEqual(contents.eventNames(), []);
  }
});

test("changing selection cancels readiness without waiting for a pending widget", async () => {
  const contents = Object.assign(page("http://localhost/new-tab", false), {
    mainFrame: { executeJavaScript: () => new Promise(() => {}) },
  });
  const controller = new AbortController();
  const pending = waitForStartupPageReady(contents as unknown as WebContents, 10_000, controller.signal);
  controller.abort();
  assert.equal(await pending, false);
  assert.deepEqual(contents.eventNames(), []);
});

test("a hydrated Terminal still waits for fonts and initial images to settle", async () => {
  let time = 0;
  const scheduled: Array<() => void> = [];
  const document = { documentElement: { hasAttribute: () => true, dataset: { breadboardStartup: "ready" } },
    fonts: { status: "loading" }, images: [{ loading: "eager", complete: false }] };
  let ready = false;
  const promise = vm.runInNewContext(startupReadinessProbe(2000), {
    document, Date: { now: () => time }, setTimeout: (fn: () => void) => scheduled.push(fn),
  }).then((value: boolean) => { ready = value; });
  const tick = async () => { time += 50; scheduled.shift()?.(); await Promise.resolve(); };
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(ready, false);
  document.fonts.status = "loaded";
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(ready, false);
  document.images[0]!.complete = true;
  for (let i = 0; i < 6; i++) await tick();
  await promise;
  assert.equal(ready, true);
});

test("a stalled optional site icon cannot hide a hydrated Terminal", async () => {
  let time = 0;const scheduled: Array<() => void> = [];
  const document = { documentElement: { hasAttribute: () => true, dataset: { breadboardStartup: "ready" } },
    fonts: { status: "loaded" }, images: [{ loading: "eager", complete: false,
      hasAttribute: (name: string) => name === "data-startup-optional" }] };
  const promise = vm.runInNewContext(startupReadinessProbe(2000), {
    document, Date: { now: () => time }, setTimeout: (fn: () => void) => scheduled.push(fn),
  });
  for (let i = 0; i < 6; i++) { time += 50; scheduled.shift()?.(); await Promise.resolve(); }
  assert.equal(await promise, true);
  assert.equal(document.images[0]!.complete, false);
});
