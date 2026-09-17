import test from "node:test";
import assert from "node:assert/strict";

async function fixture() {
  const reads = [];
  let push;
  globalThis.window = { breadboardDesktop: {
    tabs: async () => true,
    getTabsState: () => new Promise(resolve => reads.push(resolve)),
    onTabsState: listener => { push = listener; return () => {}; },
  } };
  const store = await import(`../src/lib/desktop-browser-tabs.ts?test=${crypto.randomUUID()}`);
  const unsubscribe = store.subscribeDesktopTabs(() => {});
  const state = activeId => ({ enabled: true, selfId: 1, activeId, tabs: [], extensions: [] });
  reads.shift()(state(1));
  await new Promise(resolve => setImmediate(resolve));
  return { store, reads, push, state, unsubscribe };
}

test("a delayed refresh cannot replace a newer tab selection or resurrect closed tabs", async () => {
  const { store, reads, push, state, unsubscribe } = await fixture();
  try {
    const refresh = store.refreshDesktopTabsState();
    push(state(3));
    reads.shift()(state(2));
    await refresh;
    assert.equal(store.getDesktopTabsSnapshot().activeId, 3);
  } finally { unsubscribe(); delete globalThis.window; }
});

test("overlapping refreshes keep the latest request even when replies arrive out of order", async () => {
  const { store, reads, state, unsubscribe } = await fixture();
  try {
    const older = store.refreshDesktopTabsState();
    const newer = store.refreshDesktopTabsState();
    reads[1](state(3));
    await newer;
    reads[0](state(2));
    await older;
    assert.equal(store.getDesktopTabsSnapshot().activeId, 3);
  } finally { unsubscribe(); delete globalThis.window; }
});

test("a refresh from a disconnected renderer cannot overwrite a reconnected tab store", async () => {
  const { store, reads, state, unsubscribe } = await fixture();
  const refresh = store.refreshDesktopTabsState();
  unsubscribe();
  const disconnect = store.subscribeDesktopTabs(() => {});
  try {
    reads[1](state(3));
    await new Promise(resolve => setImmediate(resolve));
    reads[0](state(2));
    await refresh;
    assert.equal(store.getDesktopTabsSnapshot().activeId, 3);
  } finally { disconnect(); delete globalThis.window; }
});

test("reloading the UI module retains the tab strip while the next shell read is pending", async () => {
  const { store, state, unsubscribe } = await fixture();
  let disconnect;
  try {
    const restored = store.getDesktopTabsSnapshot();
    unsubscribe();
    const reloaded = await import(`../src/lib/desktop-browser-tabs.ts?test=${crypto.randomUUID()}`);
    disconnect = reloaded.subscribeDesktopTabs(() => {});
    assert.equal(reloaded.getDesktopTabsSnapshot(), restored);
    assert.deepEqual(reloaded.getDesktopTabsSnapshot(), state(1));
  } finally { disconnect?.(); unsubscribe(); delete globalThis.window; }
});

test("a failed refresh retries the read even with an existing push subscription", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, state, unsubscribe } = await fixture();
  try {
    let calls = 0;
    window.breadboardDesktop.getTabsState = async () => {
      if (++calls === 1) throw new Error("Shell temporarily unavailable");
      return state(2);
    };
    assert.equal(await store.refreshDesktopTabsState(), false);
    assert.equal(store.getDesktopTabsSnapshot().activeId, 1);
    t.mock.timers.tick(180);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(store.getDesktopTabsSnapshot().activeId, 2);
  } finally { unsubscribe(); delete globalThis.window; }
});

test("a stalled initial shell read recovers without waiting for a tab change", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, state, unsubscribe } = await fixture();
  unsubscribe();
  let calls = 0;
  window.breadboardDesktop.getTabsState = () => ++calls === 1
    ? new Promise(() => {}) : Promise.resolve(state(2));
  const disconnect = store.subscribeDesktopTabs(() => {});
  try {
    t.mock.timers.tick(2_000);
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(180);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    assert.equal(store.getDesktopTabsSnapshot().activeId, 2);
  } finally { disconnect(); delete globalThis.window; }
});

test("the cached strip respects disabled tabs and is never reused for another bridge", async () => {
  const { push, state, unsubscribe } = await fixture();
  try {
    push({ ...state(1), enabled: false });
    const reloaded = await import(`../src/lib/desktop-browser-tabs.ts?test=${crypto.randomUUID()}`);
    assert.equal(reloaded.getDesktopTabsSnapshot().enabled, false);
    window.breadboardDesktop = { ...window.breadboardDesktop };
    const anotherBridge = await import(`../src/lib/desktop-browser-tabs.ts?test=${crypto.randomUUID()}`);
    assert.equal(anotherBridge.getDesktopTabsSnapshot(), null);
  } finally { unsubscribe(); delete globalThis.window; }
});

test("a read that resolves after its timeout cannot roll back recovered tabs", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, reads, push, state, unsubscribe } = await fixture();
  try {
    const refresh = store.refreshDesktopTabsState();
    t.mock.timers.tick(2_000);
    assert.equal(await refresh, false);
    push(state(3));
    reads.shift()(state(2));
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(180);
    assert.equal(reads.length, 0, "a valid pushed state cancels unnecessary retries");
    assert.equal(store.getDesktopTabsSnapshot().activeId, 3);
  } finally { unsubscribe(); delete globalThis.window; }
});

test("a synchronous bridge error is retried and unmounting stops recovery work", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, unsubscribe } = await fixture();
  try {
    let calls = 0;
    window.breadboardDesktop.getTabsState = () => { calls++; throw new Error("Bridge unavailable"); };
    assert.equal(await store.refreshDesktopTabsState(), false);
    t.mock.timers.tick(180);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 2);
    unsubscribe();
    t.mock.timers.tick(10_000);
    assert.equal(calls, 2);
  } finally { unsubscribe(); delete globalThis.window; }
});

test("the desktop can recover after the initial retry budget is exhausted", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store, state, unsubscribe } = await fixture();
  try {
    let ready = false;
    window.breadboardDesktop.getTabsState = async () => {
      if (!ready) throw new Error("Shell busy");
      return state(2);
    };
    await store.refreshDesktopTabsState();
    for (let attempt = 0; attempt < 28; attempt++) {
      t.mock.timers.tick(180);
      await new Promise(resolve => setImmediate(resolve));
    }
    ready = true;
    t.mock.timers.tick(5_000);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(store.getDesktopTabsSnapshot().activeId, 2);
  } finally { unsubscribe(); delete globalThis.window; }
});
