import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refreshChatgptUsage } from "../src/lib/chatgpt-usage-refresh.ts";

let fixtureId = 0;
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-usage-test-"));
  const original = process.env.CHATMOCK_USAGE_LIMITS_PATH;
  const file = path.join(directory, "usage.json");
  process.env.CHATMOCK_USAGE_LIMITS_PATH = file;
  t.after(async () => {
    if (original === undefined) delete process.env.CHATMOCK_USAGE_LIMITS_PATH;
    else process.env.CHATMOCK_USAGE_LIMITS_PATH = original;
    await fs.rm(directory, { recursive: true, force: true });
  });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-04T20:00:00Z") });
  const report = () => ({ captured_at: new Date().toISOString(), primary: { used_percent: 18, window_minutes: 300 } });
  const base = `http://fixture-${++fixtureId}.invalid/v1`;
  return { file, report, base, refresh: () => refreshChatgptUsage(base) };
}

test("concurrent manual refreshes only read the usage report and share its cooldown", async (t) => {
  const { refresh, report, base } = await fixture(t);
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `${base}/settings/usage`);
    assert.equal(options.method ?? "GET", "GET");
    assert.equal(options.body, undefined);
    return Response.json(report());
  });
  const results = await Promise.all([refresh(), refresh(), refresh()]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.ok(results.every(result => result.status === 200 && result.payload.refreshed && result.payload.source === "report"));
  await refresh();
  assert.equal(fetchMock.mock.callCount(), 1);
  t.mock.timers.tick(10_001);
  assert.notEqual((await refresh()).payload.captured_at, results[0].payload.captured_at);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("an overnight report outage preserves saved limits without any generation fallback", async (t) => {
  const { refresh, report, file, base } = await fixture(t);
  await fs.writeFile(file, JSON.stringify(report()));
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `${base}/settings/usage`);
    assert.equal(options.method ?? "GET", "GET");
    throw new TypeError("offline");
  });
  for (let minute = 0; minute < 9 * 60; minute++) {
    const result = await refresh();
    assert.equal(result.status, 502);
    assert.equal(result.payload.available, true);
    assert.equal(result.payload.primary.used_percent, 18);
    assert.equal(result.payload.refreshed, false);
    assert.equal(result.payload.stale, true);
    await refresh();
    t.mock.timers.tick(60_000);
  }
  assert.equal(fetchMock.mock.callCount(), 9 * 60);
});

test("rate-limited or malformed reports never trigger a model request or invent usage", async (t) => {
  const { refresh, base } = await fixture(t);
  let response = new Response("rate limited", { status: 429 });
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, `${base}/settings/usage`);
    assert.equal(options.method ?? "GET", "GET");
    return response;
  });
  const result = await refresh();
  assert.equal(result.status, 502);
  assert.equal(result.payload.available, false);
  assert.equal(result.payload.refreshed, false);
  t.mock.timers.tick(30_001);
  response = Response.json({});
  assert.equal((await refresh()).payload.available, false);
  assert.equal(fetchMock.mock.callCount(), 2);
});
