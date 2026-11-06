import test from "node:test";
import assert from "node:assert/strict";
import { navigateBrowserFromHome } from "../src/lib/desktop-browser-tabs.ts";

function fixture(t, tabs = [{ id: 7, generation: 2, browser: { address: "" } }]) {
  const commands = [];
  globalThis.window = { breadboardDesktop: {
    getTabsState: async () => state,
    onTabsState: () => () => {},
    tabs: async command => { commands.push(command); return true; },
  } };
  t.after(() => { delete globalThis.window; });
  const state = { selfId: 7, activeId: 7, presentationRevision: 3, tabs };
  return { commands, state };
}

test("home uses the existing browser navigation, retaining its tab and back-to-home history", async t => {
  const { commands, state } = fixture(t);
  assert.equal(await navigateBrowserFromHome("https://example.com/saved?q=1#note", state), true);
  assert.deepEqual(commands, [{ type: "browser-navigate", input: "https://example.com/saved?q=1#note", targetTabId: 7, generation: 2, presentationRevision: 3 }]);
});

test("an app home becomes a browser in the same tab slot", async t => {
  const { commands, state } = fixture(t, [{ id: 7, generation: 2 }]);
  assert.equal(await navigateBrowserFromHome("https://example.com", state), true);
  assert.deepEqual(commands, [{ type: "browser", url: "https://example.com", replaceCurrent: true, targetTabId: 7, generation: 2, presentationRevision: 3 }]);
});

test("an unattached home cannot navigate a different selected tab", async t => {
  const { commands, state } = fixture(t);
  assert.equal(await navigateBrowserFromHome("https://example.com", { ...state, selfId: null }), false);
  assert.deepEqual(commands, []);
});

test("rejected and stalled handoffs release home for an inline retry", async t => {
  const { state } = fixture(t);
  window.breadboardDesktop.tabs = async () => { throw new Error("offline"); };
  assert.equal(await navigateBrowserFromHome("https://example.com", state), false);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  window.breadboardDesktop.tabs = () => new Promise(() => {});
  const pending = navigateBrowserFromHome("https://example.com", state);
  t.mock.timers.tick(10_000);
  assert.equal(await pending, false);
});
