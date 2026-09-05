import test from "node:test";
import assert from "node:assert/strict";
import { reorderBrowserBookmarks } from "../src/app/browser/browser-bookmark-order.ts";
import { loadSavedBrowserItems, saveBrowserItems } from "../src/app/browser/browser-saved-items.ts";

const bookmarks = ["one", "two", "three", "four"].map((title) => ({
  title, url: `https://${title}.example/`, iconUrl: `https://${title}.example/favicon.ico`,
}));
const [one, two, three, four] = bookmarks;

test("bookmarks can move left, right, first, and last without changing their contents", () => {
  assert.deepEqual(reorderBrowserBookmarks(bookmarks, four.url, one.url), [four, one, two, three]);
  assert.deepEqual(reorderBrowserBookmarks(bookmarks, three.url, two.url), [one, three, two, four]);
  assert.deepEqual(reorderBrowserBookmarks(bookmarks, one.url, four.url), [two, three, one, four]);
  assert.deepEqual(reorderBrowserBookmarks(bookmarks, two.url, null), [one, three, four, two]);
  assert.deepEqual(bookmarks.map((item) => item.title), ["one", "two", "three", "four"]);
});

test("cancelled, unchanged, and stale drag targets do not change the saved order", () => {
  for (const [source, before] of [[one.url, one.url], [one.url, two.url], [four.url, null], ["missing", one.url], [one.url, "missing"]]) {
    assert.equal(reorderBrowserBookmarks(bookmarks, source, before), bookmarks);
  }
});

test("a reordered bookmark list restores from durable storage with a fresh cache", async () => {
  let disk = structuredClone(bookmarks);
  const options = {
    key: "bookmarks", desktop: true, normalize: (items) => items,
    storage: { getItem: () => null, setItem: () => {} },
    control: { read: async () => disk, write: async (items) => { disk = structuredClone(items); return true; } },
  };
  const reordered = reorderBrowserBookmarks(bookmarks, four.url, one.url);
  await saveBrowserItems(options, reordered);
  assert.deepEqual(await loadSavedBrowserItems(options), [four, one, two, three]);
  options.control.write = async () => false;
  await assert.rejects(saveBrowserItems(options, bookmarks), /Couldn’t save/);
  assert.deepEqual(await loadSavedBrowserItems(options), reordered);
});
