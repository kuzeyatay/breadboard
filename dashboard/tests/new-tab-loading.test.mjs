import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readNewTabGardens, refreshNewTabGardenCounts } from "../src/lib/new-tab-gardens.ts";
import { countClusterMarkdown, countClusterMarkdownAsync } from "../src/lib/garden-directory.ts";
import { cachedGardenNoteCountAsync, invalidateGardenNoteCount, readCachedGardenNoteCount } from "../src/lib/garden-note-count-cache.ts";

test("the new-tab launcher returns links even while note counting is stalled", async () => {
  invalidateGardenNoteCount();
  let release;
  let calls = 0;
  const stalled = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const count = cachedGardenNoteCountAsync("/content", "math", stalled);
  const shared = cachedGardenNoteCountAsync("/content", "math", stalled);
  await Promise.resolve();
  const db = { prepare(sql) {
    assert.match(sql, /WHERE user_id = \?/);
    return { all(userId) {
      assert.equal(userId, 17);
      return [{ slug: "math", name: "Math", lastViewedAt: null, borderColor: null }];
    } };
  } };
  assert.deepEqual(readNewTabGardens(db, 17, "/content"), [{
    slug: "math", name: "Math", lastViewedAt: null, borderColor: "#a9c1b1", noteCount: null,
  }]);
  assert.equal(calls, 1, "simultaneous new tabs share the asynchronous walk");
  release(42);
  assert.deepEqual(await Promise.all([count, shared]), [42, 42]);
  assert.equal(readNewTabGardens(db, 17, "/content")[0].noteCount, 42);
});

test("a write during a count cannot repopulate an invalidated cache", async () => {
  invalidateGardenNoteCount();
  let release;
  const old = cachedGardenNoteCountAsync("/content", "math", () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  invalidateGardenNoteCount("math");
  await cachedGardenNoteCountAsync("/content", "math", async () => 8);
  release(3);
  await old;
  assert.equal(readCachedGardenNoteCount("/content", "math"), 8);
});

test("failed refreshes can retry, and expired counts remain available to the launcher", async () => {
  invalidateGardenNoteCount();
  await assert.rejects(cachedGardenNoteCountAsync("/content", "math", async () => { throw new Error("unavailable"); }));
  await cachedGardenNoteCountAsync("/content", "math", async () => 0, { now: () => 0 });
  assert.equal(readCachedGardenNoteCount("/content", "math"), 0);
  await cachedGardenNoteCountAsync("/content", "math", async () => 9, { now: () => 20_000 });
  assert.equal(readCachedGardenNoteCount("/content", "math"), 9);
});

test("background counts preserve garden exclusions and refresh real files", async () => {
  invalidateGardenNoteCount();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-new-tab-count-"));
  try {
    for (const file of ["math/one.md", "math/sources/two.md", "math/learning/three.md", "math/index.md", "math/sources/_index.md", "math/assets/ignored.md", "math/.private/ignored.md", "math/Internal/Concept Graph/ignored.md"]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "test");
    }
    assert.equal(await countClusterMarkdownAsync(path.join(root, "math")), 3);
    assert.equal(await countClusterMarkdownAsync(path.join(root, "math")), countClusterMarkdown(path.join(root, "math")));
    const gardens = [{ slug: "math", name: "Math", noteCount: null, lastViewedAt: null, borderColor: "#a9c1b1" }];
    assert.equal((await refreshNewTabGardenCounts(gardens, root))[0].noteCount, 3);
    fs.writeFileSync(path.join(root, "math/four.md"), "new note");
    invalidateGardenNoteCount("math");
    assert.equal((await refreshNewTabGardenCounts(gardens, root))[0].noteCount, 4);
    assert.equal((await refreshNewTabGardenCounts([{ ...gardens[0], slug: "../outside" }], root))[0].noteCount, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
