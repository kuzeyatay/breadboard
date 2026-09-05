import test from "node:test";
import assert from "node:assert/strict";
import { loadSavedBrowserItems, saveBrowserItems } from "../src/app/browser/browser-saved-items.ts";

const item = { title: "Example", url: "https://example.com/", iconUrl: "https://example.com/favicon.ico" };
const normalize = (value) => Array.isArray(value) ? value : [];
function cache(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; } };
}

test("saved sites restore from disk with a completely fresh origin cache", async () => {
  let disk = null;
  const control = { read: async () => disk, write: async (items) => { disk = structuredClone(items); return true; } };
  const initial = { key: "sites", normalize, desktop: true, storage: cache(), control };
  await saveBrowserItems(initial, [item]);
  const freshOrigin = { ...initial, storage: cache() };
  assert.deepEqual(await loadSavedBrowserItems(freshOrigin), [item]);
  await saveBrowserItems(freshOrigin, []);
  assert.deepEqual(await loadSavedBrowserItems({ ...initial, storage: cache(JSON.stringify([item])) }), []);
});

test("legacy sites migrate once and never replace an existing disk collection", async () => {
  let disk = null;
  let writes = 0;
  const options = {
    key: "sites", normalize, desktop: true, storage: cache(JSON.stringify([item])),
    control: { read: async () => disk, write: async (items) => { disk = items; writes++; return true; } },
  };
  assert.deepEqual(await loadSavedBrowserItems(options), [item]);
  assert.equal(writes, 1);
  options.storage = cache(JSON.stringify([{ ...item, title: "Stale renderer copy" }]));
  assert.deepEqual(await loadSavedBrowserItems(options), [item]);
  assert.equal(writes, 1);
});

test("empty startup cache does not initialize or erase disk state", async () => {
  let writes = 0;
  await loadSavedBrowserItems({ key: "sites", normalize, desktop: true, storage: cache(), control: {
    read: async () => null, write: async () => { writes++; return true; },
  } });
  assert.equal(writes, 0);
});

test("blocked localStorage cannot prevent a native read, migration, or save", async () => {
  const storage = { getItem: () => { throw new Error("Blocked"); }, setItem: () => { throw new Error("Quota"); } };
  let disk = [item];
  const options = { key: "sites", normalize, desktop: true, storage, control: {
    read: async () => disk, write: async (items) => { disk = items; return true; },
  } };
  assert.deepEqual(await loadSavedBrowserItems(options), [item]);
  assert.deepEqual(await saveBrowserItems(options, []), []);
  options.storage = { getItem: () => JSON.stringify([item]), setItem: storage.setItem };
  disk = null;
  assert.deepEqual(await loadSavedBrowserItems(options), [item]);
  assert.deepEqual(disk, [item]);
});

test("rejected saves keep the previous cached and durable collection", async () => {
  const storage = cache(JSON.stringify([item]));
  const options = { key: "sites", normalize, desktop: true, storage, control: {
    read: async () => [item], write: async () => false,
  } };
  await assert.rejects(saveBrowserItems(options, []), /Couldn’t save/);
  assert.deepEqual(JSON.parse(storage.getItem()), [item]);
  await assert.rejects(loadSavedBrowserItems({ ...options, control: { ...options.control, read: async () => { throw new Error("Unavailable"); } } }), /Couldn’t load/);
});

test("an older desktop cannot falsely report an origin-only save as durable", async () => {
  const options = { key: "sites", normalize, desktop: true, storage: cache(), control: null };
  await assert.rejects(saveBrowserItems(options, [item]), /Restart Breadboard/);
  await assert.rejects(loadSavedBrowserItems(options), /Restart Breadboard/);
  const web = { ...options, desktop: false };
  await saveBrowserItems(web, [item]);
  assert.deepEqual(await loadSavedBrowserItems(web), [item]);
});
