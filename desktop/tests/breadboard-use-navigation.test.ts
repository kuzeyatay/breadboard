import { test } from "node:test";
import assert from "node:assert/strict";
import type { TabManager } from "../src/main/tab-manager";
import { BreadboardUseBridge } from "../src/main/breadboard-use";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let activeId = 2;
  let closed = false;
  const commands: unknown[] = [];
  const gestures: boolean[] = [];
  const captured: unknown[] = [];
  const page = { ok: true, value: { elements: [{ ref: "e1", name: "Search" }] } };
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 100, height: 100 }),
    toJPEG: () => Buffer.from("image"),
  };
  let read = async () => page;
  let capture = async () => image;
  const contents = {
    id: 1, getURL: () => "http://localhost/previous", getTitle: () => "Previous tab",
    isDestroyed: () => false, isCrashed: () => false, isLoading: () => false, isLoadingMainFrame: () => false,
    executeJavaScript: (_script: string, userGesture: boolean) => { gestures.push(userGesture); return read(); },
    capturePage: (_bounds: unknown, options: unknown) => { captured.push(options); return capture(); },
  };
  const tabs = {
    breadboardUseTargets: () => closed ? [] : [
      { contents, chrome: contents, tabId: 1, kind: "app", active: activeId === 1 },
    ],
    handleCommand: (_sender: unknown, command: { type: string; id: number }) => {
      commands.push(command);
      if (command.type === "activate") activeId = command.id;
      return true;
    },
  } as unknown as TabManager;
  const bridge = new BreadboardUseBridge({ tabs, dataRoot: "unused", dashboardUrl: () => "http://localhost" });
  return {
    call: (action: string) => bridge.execute({ action, targetId: 1 }, "session"),
    select: (id: number) => { activeId = id; },
    close: () => { closed = true; },
    active: () => activeId,
    delayRead: (work: () => Promise<typeof page>) => { read = work; },
    delayCapture: (work: () => Promise<typeof image>) => { capture = work; },
    commands, gestures, captured, page, image,
  };
}

test("repeated background snapshots preserve the selected tab without granting user activation", async () => {
  const f = fixture();
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

test("background screenshots fail promptly without requesting a frame or switching tabs", async () => {
  const f = fixture();
  await assert.rejects(f.call("screenshot"), /background.*snapshot/);
  await assert.rejects(f.call("click"), /Activate/);
  assert.deepEqual(f.captured, []);
  assert.deepEqual(f.commands, []);
  assert.equal(f.active(), 2);
});

test("explicit activation still permits inspection of the selected tab", async () => {
  const f = fixture();
  await f.call("activate");
  assert.equal(f.active(), 1);
  assert.equal((await f.call("snapshot")).active, true);
  assert.equal((await f.call("screenshot")).active, true);
  assert.deepEqual(f.captured, [{ stayHidden: true }]);
  assert.deepEqual(f.commands, [{ type: "activate", id: 1 }]);
});

test("a snapshot finishing after a user tab switch preserves that newer selection", async () => {
  const f = fixture();
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

test("closing a tab during its snapshot does not resurrect it", async () => {
  const f = fixture();
  const pending = deferred<typeof f.page>();
  f.delayRead(() => pending.promise);
  const result = f.call("snapshot");
  f.close();
  pending.resolve(f.page);
  await assert.rejects(result, /target tab closed/);
  assert.equal(f.active(), 2);
  assert.deepEqual(f.commands, []);
});

test("a screenshot finishing after a tab switch never reactivates its old target", async () => {
  const f = fixture();
  const started = deferred<void>();
  const pending = deferred<typeof f.image>();
  f.select(1);
  f.delayCapture(() => { started.resolve(); return pending.promise; });
  const result = f.call("screenshot");
  await started.promise;
  f.select(2);
  pending.resolve(f.image);
  await assert.rejects(result, /active tab changed/);
  assert.equal(f.active(), 2);
  assert.deepEqual(f.commands, []);
});
