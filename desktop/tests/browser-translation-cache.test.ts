import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserTranslationCache } from "../src/main/browser-translation-cache";
import type { TranslatePageBatch } from "../src/main/browser-translation";

test("translation reuses repeated text across page IDs while isolating sites, languages and context", async () => {
  const cache = new BrowserTranslationCache();
  const signal = new AbortController().signal;
  const batch = [{ id: 1, text: "Hola", context: "Hola mundo" }, { id: 2, text: "Hola", context: "Hola mundo" }];
  let calls = 0;
  const translate: TranslatePageBatch = async segments => {
    calls++;
    assert.equal(segments.length, 1, "identical text/context in a batch is sent once");
    return segments.map(segment => ({ id: segment.id, text: "Hello" }));
  };
  assert.deepEqual(await cache.translate(batch, "en", "example.org", signal, translate), [{ id: 1, text: "Hello" }, { id: 2, text: "Hello" }]);
  assert.deepEqual(await cache.translate([{ ...batch[0]!, id: 99 }], "en", "example.org", signal, translate), [{ id: 99, text: "Hello" }]);
  assert.equal(calls, 1, "another page uses cached text without a provider request");
  await cache.translate(batch, "nl", "example.org", signal, translate);
  await cache.translate(batch, "en", "other.org", signal, translate);
  await cache.translate([{ ...batch[0]!, context: "Different sentence" }], "en", "example.org", signal, translate);
  assert.equal(calls, 4);
  cache.clear();
  await cache.translate(batch, "en", "example.org", signal, translate);
  assert.equal(calls, 5);
});

test("failed or cancelled translations never enter the cache", async () => {
  const cache = new BrowserTranslationCache();
  const batch = [{ id: 1, text: "Hola", context: "" }];
  const controller = new AbortController();
  await assert.rejects(cache.translate(batch, "en", "example.org", controller.signal, async () => []), /incomplete/);
  await assert.rejects(cache.translate(batch, "en", "example.org", controller.signal, async () => {
    controller.abort();
    return [{ id: 1, text: "Wrong" }];
  }), { name: "AbortError" });
  let called = false;
  assert.deepEqual(await cache.translate(batch, "en", "example.org", new AbortController().signal, async () => {
    called = true;
    return [{ id: 1, text: "Hello" }];
  }), [{ id: 1, text: "Hello" }]);
  assert.ok(called);
});
