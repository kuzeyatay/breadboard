import assert from "node:assert/strict";
import test, { beforeEach, after } from "node:test";
import {
  BOTS_AUTH_CHANGED_EVENT, BOTS_CHANGED_EVENT, BOTS_CACHE_TTL_MS,
  invalidateBotsCache, loadCachedBots, peekCachedBots,
} from "../src/lib/bots/client-cache.ts";

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();
beforeEach(() => invalidateBotsCache());
after(() => { globalThis.window = originalWindow; });
const roster = [{ id: "sage", name: "Sage" }];

test("preload and simultaneous mounts share one request; fresh visits use memory", async t => {
  let resolve;
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise(done => { resolve = done; }));
  const preload = loadCachedBots();
  const mount = loadCachedBots();
  assert.equal(mount, preload);
  resolve(Response.json({ bots: roster }));
  assert.deepEqual(await mount, roster);
  assert.deepEqual(peekCachedBots(), roster);
  assert.deepEqual(await loadCachedBots(), roster);
  assert.equal(fetch.mock.callCount(), 1);
});

test("an empty roster is cached and expired entries are fetched again", async t => {
  let now = 100;
  t.mock.method(Date, "now", () => now);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ bots: [] }));
  assert.deepEqual(await loadCachedBots(), []);
  assert.deepEqual(await loadCachedBots(), []);
  assert.equal(fetch.mock.callCount(), 1);
  now += BOTS_CACHE_TTL_MS;
  assert.deepEqual(peekCachedBots(), [], "expiry keeps a valid empty roster visible");
  await loadCachedBots();
  assert.equal(fetch.mock.callCount(), 2);
});

test("the roster stays fresh for five minutes, then paints while one refresh runs", async t => {
  let now = 100;
  t.mock.method(Date, "now", () => now);
  let resolve;
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ bots: roster }));
  await loadCachedBots();
  now += 31_000;
  await loadCachedBots();
  assert.equal(fetch.mock.callCount(), 1, "returning after 30 seconds must still use memory");
  assert.equal(BOTS_CACHE_TTL_MS, 5 * 60_000);
  now += BOTS_CACHE_TTL_MS;
  fetch.mock.mockImplementation(() => new Promise(done => { resolve = done; }));
  const refresh = loadCachedBots();
  assert.deepEqual(peekCachedBots(), roster, "expired data is usable during revalidation");
  assert.equal(loadCachedBots(), refresh);
  resolve(Response.json({ bots: [] }));
  assert.deepEqual(await refresh, []);
  assert.deepEqual(peekCachedBots(), [], "refresh replaces the snapshot, including an empty roster");
  assert.equal(fetch.mock.callCount(), 2);
});

test("a failed background refresh preserves the last roster and can retry", async t => {
  let now = 100;
  t.mock.method(Date, "now", () => now);
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ bots: roster }));
  await loadCachedBots();
  now += BOTS_CACHE_TTL_MS;
  fetch.mock.mockImplementation(async () => { throw new Error("Network unavailable"); });
  await assert.rejects(loadCachedBots(), /Network unavailable/);
  assert.deepEqual(peekCachedBots(), roster);
  fetch.mock.mockImplementation(async () => Response.json({ bots: [] }));
  assert.deepEqual(await loadCachedBots(), []);
});

for (const status of [401, 403]) {
  test(`an expired session (${status}) discards the stale roster`, async t => {
    let now = 100;
    t.mock.method(Date, "now", () => now);
    const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ bots: roster }));
    await loadCachedBots();
    now += BOTS_CACHE_TTL_MS;
    fetch.mock.mockImplementation(async () => new Response(null, { status }));
    await assert.rejects(loadCachedBots(), { status });
    assert.equal(peekCachedBots(), null);
  });
}

test("failed preloads leave retry available and preserve server errors", async t => {
  let fail = true;
  t.mock.method(globalThis, "fetch", async () => fail
    ? Response.json({ error: "Please sign in." }, { status: 401 })
    : Response.json({ bots: roster }));
  await assert.rejects(loadCachedBots(), /Please sign in/);
  assert.equal(peekCachedBots(), null);
  fail = false;
  assert.deepEqual(await loadCachedBots(), roster);
});

test("malformed successful responses are never cached", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ bots: null }));
  await assert.rejects(loadCachedBots(), /Bots could not be loaded/);
  assert.equal(peekCachedBots(), null);
});

for (const event of [BOTS_CHANGED_EVENT, BOTS_AUTH_CHANGED_EVENT]) {
  test(`${event} clears saved data and rejects stale in-flight results`, async t => {
    const pending = [];
    t.mock.method(globalThis, "fetch", () => new Promise(resolve => pending.push(resolve)));
    const first = loadCachedBots();
    pending.shift()(Response.json({ bots: roster }));
    await first;
    window.dispatchEvent(new Event(event));
    assert.equal(peekCachedBots(), null);
    const old = loadCachedBots();
    const stale = assert.rejects(old, /bot list changed/);
    window.dispatchEvent(new Event(event));
    const fresh = loadCachedBots();
    assert.notEqual(old, fresh);
    pending.pop()(Response.json({ bots: [] }));
    await fresh;
    pending.shift()(Response.json({ bots: roster }));
    await stale;
    assert.deepEqual(peekCachedBots(), []);
  });
}
