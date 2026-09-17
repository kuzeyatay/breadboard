import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refreshChatgptUsage } from "../src/lib/chatgpt-usage-refresh.ts";

let fixtureUser = 0;

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
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-07T12:00:00Z") });
  const report = () => fs.writeFile(file, JSON.stringify({ captured_at: new Date().toISOString(), primary: { used_percent: 18, window_minutes: 300 } }));
  const userId = ++fixtureUser;
  return { report, refresh: () => refreshChatgptUsage("http://fixture.invalid/v1", userId) };
}

test("new-tab ChatGPT refreshes share one probe and a brief cooldown then fetch anew", async (t) => {
  const { refresh, report } = await fixture(t);
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.equal(JSON.parse(options.body).stream, false);
    await report();
    return new Response("OK");
  });
  const results = await Promise.all([refresh(), refresh(), refresh()]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.ok(results.every((result) => result.status === 200 && result.payload.refreshed));
  assert.deepEqual(await refresh(), results[0]);
  t.mock.timers.tick(10_001);
  const next = await refresh();
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(next.payload.refreshed, true);
  assert.notEqual(next.payload.captured_at, results[0].payload.captured_at);
});

test("failed automatic probes preserve saved limits and cool down across tabs", async (t) => {
  const { refresh, report } = await fixture(t);
  await report();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline"); });
  const first = await refresh();
  assert.equal(first.status, 502);
  assert.equal(first.payload.available, true);
  assert.equal(first.payload.refreshed, false);
  t.mock.timers.tick(30_000);
  await refresh();
  assert.equal(fetchMock.mock.callCount(), 1);
  t.mock.timers.tick(30_000);
  await refresh();
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("rate-limited probes still accept fresh usage headers captured by ChatMock", async (t) => {
  const { refresh, report } = await fixture(t);
  t.mock.method(globalThis, "fetch", async () => {
    await report();
    return new Response("rate limited", { status: 429 });
  });
  const result = await refresh();
  assert.equal(result.status, 200);
  assert.equal(result.payload.refreshed, true);
  assert.equal(result.payload.primary.used_percent, 18);
});
