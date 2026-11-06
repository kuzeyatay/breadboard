import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { TabManager } from "../src/main/tab-manager";
import { BreadboardUseBridge } from "../src/main/breadboard-use";
import * as pageCapture from "../src/main/capture-page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(t: TestContext) {
  let activeId = 2;
  let closed = false;
  const commands: unknown[] = [];
  const browserUrls: unknown[] = [];
  const appPages: unknown[] = [];
  const gestures: boolean[] = [];
  const captured: unknown[] = [];
  let preparations = 0;
  const page = { ok: true, value: { elements: [{ ref: "e1", name: "Search" }] } };
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 100, height: 100 }),
    toJPEG: () => Buffer.from("image"),
  };
  let read = async () => page;
  let capture = async () => image;
  const contents = Object.assign(new EventEmitter(), {
    id: 1, getURL: () => "http://localhost/previous", getTitle: () => "Previous tab",
    isDestroyed: () => false, isCrashed: () => false, isLoading: () => false, isLoadingMainFrame: () => false,
    executeJavaScript: (_script: string, userGesture: boolean) => { gestures.push(userGesture); return read(); },
  });
  t.mock.method(pageCapture, "capturePageWithFreshFrame", (target: unknown) => {
    captured.push(target);
    return capture();
  });
  const tabs = {
    breadboardUseTargets: () => closed ? [] : [
      { contents, chrome: contents, tabId: 1, kind: "app", active: activeId === 1 },
    ],
    handleCommand: (_sender: unknown, command: { type: string; id: number }) => {
      commands.push(command);
      if (command.type === "activate") activeId = command.id;
      return true;
    },
    openBreadboardUseBrowser: (_sender: unknown, url: string) => { browserUrls.push(url); return true; },
    openBreadboardUseApp: (_sender: unknown, url: string, owner: string) => { appPages.push({ url, owner }); return true; },
    prepareBreadboardUseInput: async () => {
      preparations++;
      return () => { preparations--; };
    },
  } as unknown as TabManager;
  const bridge = new BreadboardUseBridge({ tabs, dataRoot: "unused", dashboardUrl: () => "http://localhost" });
  return {
    call: (action: string) => bridge.execute({ action, targetId: 1 }, "session"),
    open: (url: string) => bridge.execute({ action: "open", targetId: 1, surface: "browser", url }, "session"),
    openSurface: (surface: string) => bridge.execute({ action: "open", targetId: 1, surface }, "session", "run"),
    select: (id: number) => { activeId = id; },
    close: () => { closed = true; },
    active: () => activeId,
    delayRead: (work: () => Promise<typeof page>) => { read = work; },
    delayCapture: (work: () => Promise<typeof image>) => { capture = work; },
    preparations: () => preparations,
    commands, browserUrls, appPages, gestures, captured, page, image, contents,
  };
}

test("repeated background snapshots preserve the selected tab without granting user activation", async t => {
  const f = fixture(t);
  for (let i = 0; i < 3; i++) {
    const result = await f.call("snapshot");
    assert.equal(result.targetId, 1);
    assert.equal(result.active, false);
    assert.deepEqual(result.elements, f.page.value.elements);
    assert.equal(f.active(), 2);
  }
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.gestures, [false, false, false]);
});

test("artifact viewer URLs use the signed-in app while websites and API previews stay isolated", async t => {
  const f = fixture(t);
  const viewer = "http://localhost/artifacts/art_example-123/pdf?conversationId=conv_test";
  await f.open(viewer);
  assert.deepEqual(f.appPages, [{ url: viewer, owner: JSON.stringify(["session", "session"]) }]);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.browserUrls, []);
  for (const url of ["https://example.test/artifacts/art_example/pdf", "http://localhost/api/hermes/artifacts/art_example/preview", "http://localhost/artifacts/art_example/html"]) await f.open(url);
  assert.equal(f.commands.length, 0);
  assert.equal(f.browserUrls.length, 3);
  await assert.rejects(f.open("file:///C:/private.txt"), /http and https/);
});

test("every app surface opens an owned background page without selecting or navigating a user tab", async t => {
  const f = fixture(t);
  const routes = { garden: "/garden", dashboard: "/dashboard", home: "/new-tab", settings: "/settings", profile: "/settings",
    calendar: "/calendar", plan: "/plan", workflows: "/workflows", processes: "/processes" };
  for (const [surface, route] of Object.entries(routes)) {
    await f.openSurface(surface);
    assert.deepEqual(f.appPages.at(-1), { url: `http://localhost${route}`, owner: JSON.stringify(["session", "run"]) });
  }
  for (const url of ["http://localhost/garden/signals/lesson?note=lti", "http://localhost/gardens/signals", "http://localhost/profile"]) {
    await f.open(url);
    assert.deepEqual(f.appPages.at(-1), { url, owner: JSON.stringify(["session", "session"]) });
  }
  assert.equal(f.active(), 2);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.browserUrls, []);
});

test("background screenshots capture the requested page without allowing input or switching tabs", async t => {
  const f = fixture(t);
  const result = await f.call("screenshot");
  assert.equal(result.active, false);
  assert.ok(result.screenshot);
  await assert.rejects(f.call("click"), /Activate/);
  assert.deepEqual(f.captured, [f.contents]);
  assert.equal(f.preparations(), 0);
  assert.equal(f.contents.listenerCount("did-start-navigation"), 0);
  assert.deepEqual(f.commands, []);
  assert.equal(f.active(), 2);
});

test("explicit activation still permits inspection of the selected tab", async t => {
  const f = fixture(t);
  await f.call("activate");
  assert.equal(f.active(), 1);
  assert.equal((await f.call("snapshot")).active, true);
  assert.equal((await f.call("screenshot")).active, true);
  assert.deepEqual(f.captured, [f.contents]);
  assert.equal(f.preparations(), 0);
  assert.deepEqual(f.commands, [{ type: "activate", id: 1 }]);
});

test("a snapshot finishing after a user tab switch preserves that newer selection", async t => {
  const f = fixture(t);
  const pending = deferred<typeof f.page>();
  f.select(1);
  f.delayRead(() => pending.promise);
  const result = f.call("snapshot");
  f.select(2);
  pending.resolve(f.page);
  assert.equal((await result).active, false);
  assert.equal(f.active(), 2);
  assert.deepEqual(f.commands, []);
});

test("closing a tab during its snapshot does not resurrect it", async t => {
  const f = fixture(t);
  const pending = deferred<typeof f.page>();
  f.delayRead(() => pending.promise);
  const result = f.call("snapshot");
  f.close();
  pending.resolve(f.page);
  await assert.rejects(result, /target tab closed/);
  assert.equal(f.active(), 2);
  assert.deepEqual(f.commands, []);
});

test("a screenshot finishing after a tab switch never reactivates its old target", async t => {
  const f = fixture(t);
  const started = deferred<void>();
  const pending = deferred<typeof f.image>();
  f.select(1);
  f.delayCapture(() => { started.resolve(); return pending.promise; });
  const result = f.call("screenshot");
  await started.promise;
  f.select(2);
  pending.resolve(f.image);
  assert.equal((await result).active, false);
  assert.equal(f.preparations(), 0);
  assert.equal(f.contents.listenerCount("did-start-navigation"), 0);
  assert.equal(f.active(), 2);
  assert.deepEqual(f.commands, []);
});
