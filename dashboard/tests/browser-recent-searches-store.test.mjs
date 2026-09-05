import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserRecentSearchesStore } from "../src/app/browser/browser-recent-searches-store.ts";
import { normalizeRecentSearches } from "../src/app/browser/browser-recent-searches.ts";
import { browserRecentSearchesControl } from "../src/lib/desktop-browser-tabs.ts";

function fixture(initial = null) {
  let disk = initial;
  const control = {
    read: async () => structuredClone(disk),
    write: async (items) => { disk = structuredClone(items); return true; },
  };
  function open(entries = {}, overrides = {}) {
    const cache = new Map(Object.entries(entries));
    const options = {
      key: "searches", legacyKey: "history", label: "recent searches", desktop: true,
      normalize: normalizeRecentSearches, control,
      storage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => { cache.set(key, value); } },
      ...overrides,
    };
    return createBrowserRecentSearchesStore(() => options);
  }
  return { open, control, disk: () => disk };
}

test("legacy history migrates and a fresh origin restores recent searches", async () => {
  const f = fixture();
  const first = f.open({ history: JSON.stringify(["coffee", "https://example.com/", "https://www.google.com/search?q=garden+design", "coffee"]) });
  assert.equal(await first.refresh(), true);
  assert.deepEqual(f.disk(), ["coffee", "garden design"]);
  const restarted = f.open();
  await restarted.refresh();
  assert.deepEqual(restarted.getSnapshot().items, ["coffee", "garden design"]);
  await restarted.remember("train times");
  const nextRestart = f.open();
  await nextRestart.refresh();
  assert.deepEqual(nextRestart.getSnapshot().items, ["train times", "coffee", "garden design"]);
});

test("removals and clearing persist and stale renderer history cannot revive them", async () => {
  const f = fixture(["coffee", "garden design"]);
  const store = f.open();
  await store.remove("coffee");
  const restarted = f.open({ searches: '["coffee","garden design"]' });
  await restarted.refresh();
  assert.deepEqual(restarted.getSnapshot().items, ["garden design"]);
  await restarted.clear();
  const stale = f.open({ history: '["coffee"]' });
  await stale.refresh();
  assert.deepEqual(stale.getSnapshot().items, []);
  assert.deepEqual(f.disk(), []);
});

test("current search cache takes precedence over older mixed history during migration", async () => {
  const f = fixture();
  await f.open({ searches: '["new search"]', history: '["old search"]' }).refresh();
  assert.deepEqual(f.disk(), ["new search"]);
});

test("startup restores and rapid searches serialize without losing or reordering entries", async () => {
  const f = fixture(["old search"]);
  const store = f.open();
  await Promise.all([store.refresh(), store.remember("first"), store.remember("second"), store.remember("first")]);
  assert.deepEqual(f.disk(), ["first", "second", "old search"]);
  await Promise.all([store.remember("third"), store.clear(), store.remember("after clear")]);
  assert.deepEqual(f.disk(), ["after clear"]);
});

test("each edit uses the latest saved list and retains the existing 80-search limit", async () => {
  const f = fixture(Array.from({ length: 80 }, (_, i) => `query ${i}`));
  const first = f.open();
  const second = f.open();
  await Promise.all([first.refresh(), second.refresh()]);
  await first.remember("from another tab");
  await second.remember("latest");
  assert.equal(f.disk().length, 80);
  assert.deepEqual(f.disk().slice(0, 3), ["latest", "from another tab", "query 0"]);
  await second.remember("https://example.com/");
  assert.deepEqual(f.disk().slice(0, 3), ["latest", "from another tab", "query 0"]);
});

test("simultaneous tabs preserve both searches and a removal across a restart", async () => {
  const f = fixture(["old search", "keep this"]);
  const first = f.open();
  const second = f.open();
  await Promise.all([first.remember("first tab"), second.remember("second tab")]);
  assert.deepEqual(new Set(f.disk()), new Set(["first tab", "second tab", "old search", "keep this"]));
  await Promise.all([first.remove("old search"), second.remember("latest")]);
  const restarted = f.open();
  await restarted.refresh();
  assert.deepEqual(new Set(restarted.getSnapshot().items), new Set(["latest", "first tab", "second tab", "keep this"]));
});

test("a search made within the results page survives restart without recording ordinary page URLs", async () => {
  const f = fixture();
  const first = f.open();
  await first.remember("https://www.google.com/search?q=coffee+nearby&source=hp");
  await first.remember("https://www.google.com/search?q=train+times");
  await first.remember("https://example.com/visited-page");
  const restarted = f.open();
  await restarted.refresh();
  assert.deepEqual(restarted.getSnapshot().items, ["train times", "coffee nearby"]);
});

test("failed saves remain visible and do not discard history or block subsequent saves", async () => {
  const f = fixture(["coffee"]);
  const store = f.open();
  await store.refresh();
  const write = f.control.write;
  f.control.write = async () => false;
  assert.equal(await store.clear(), false);
  assert.match(store.getSnapshot().error, /Couldn’t save your recent searches/);
  assert.deepEqual(store.getSnapshot().items, ["coffee"]);
  assert.deepEqual(f.disk(), ["coffee"]);
  f.control.write = write;
  assert.equal(await store.remember("garden design"), true);
  assert.equal(store.getSnapshot().error, null);
  assert.deepEqual(f.disk(), ["garden design", "coffee"]);
});

test("web browsers retain local persistence and older shells request a restart", async () => {
  const f = fixture();
  const web = f.open({}, { desktop: false, control: null });
  await web.remember("coffee");
  await web.refresh();
  assert.deepEqual(web.getSnapshot().items, ["coffee"]);
  const oldShell = f.open({}, { control: null });
  assert.equal(await oldShell.remember("coffee"), false);
  assert.match(oldShell.getSnapshot().error, /Restart Breadboard/);
});

test("recent-search bridge scopes reads and writes to the active profile", async () => {
  const previous = globalThis.window;
  try {
    const calls = [];
    globalThis.window = { breadboardDesktop: {
      getBrowserRecentSearches: async (owner) => { calls.push(["read", owner]); return ["coffee"]; },
      setBrowserRecentSearches: async (owner, items) => { calls.push(["write", owner, items]); return true; },
    } };
    const control = browserRecentSearchesControl("one@example.com");
    assert.deepEqual(await control.read(), ["coffee"]);
    assert.equal(await control.write([]), true);
    assert.deepEqual(calls, [["read", "one@example.com"], ["write", "one@example.com", []]]);
    globalThis.window = {};
    assert.equal(browserRecentSearchesControl("one@example.com"), null);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
