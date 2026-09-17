import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  claudeSubscriptionModelId,
  claudeUsageRowsFromResponse,
  readClaudeUsageLimits,
} from "../src/lib/claude-usage-limits.ts";

const REFRESH_MS = 300_000;

test("recognizes only Claude models served by the subscription route", () => {
  assert.equal(
    claudeSubscriptionModelId("cliproxy/claude-sonnet-5"),
    "claude-sonnet-5",
  );
  assert.equal(
    claudeSubscriptionModelId("  CLIPROXY/CLAUDE-OPUS-5  "),
    "CLAUDE-OPUS-5",
  );
  assert.equal(claudeSubscriptionModelId("anthropic/claude-sonnet-5"), null);
  assert.equal(claudeSubscriptionModelId("cliproxy/gemini-3-pro"), null);
});

async function usageFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "claude-usage-test-"));
  const original = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = directory;
  t.after(async () => {
    if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = original;
    delete globalThis.__breadboardClaudeUsage;
    await fs.rm(directory, { recursive: true, force: true });
  });
  const credentials = (token, extra = {}) => fs.writeFile(path.join(directory, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: token, ...extra } }));
  await credentials("fixture-token");
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-07T12:00:00Z") });
  return { directory, cacheFile: path.join(directory, ".breadboard", "usage-cache.json"), credentials, read: (model = "cliproxy/claude-sonnet-test") => readClaudeUsageLimits(model) };
}

const usageReport = () => Response.json({ five_hour: { utilization: 24, resets_at: "2026-09-07T16:00:00Z" } });

test("expired OAuth wakes Claude once across models, rereads its token, and persists the recovered report", async (t) => {
  const { credentials, read } = await usageFixture(t);
  await credentials("expired-token", { refreshToken: "fixture-refresh", expiresAt: Date.now() - 1 });
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers.Authorization, "Bearer renewed-token");
    return usageReport();
  });
  const initial = await read();
  assert.equal(initial.recovery_required, true);
  assert.equal(initial.auth_required, undefined);
  assert.equal(initial.retry_at, undefined);
  assert.equal(fetchMock.mock.callCount(), 0, "never send a known-expired token");
  let recoveries = 0;
  const options = { recoverSession: async () => {
    recoveries++;
    await credentials("renewed-token", { refreshToken: "fixture-refresh", expiresAt: Date.now() + 3600000 });
  } };
  const results = await Promise.all(["sonnet", "opus", "haiku"].map((model) =>
    readClaudeUsageLimits(`cliproxy/claude-${model}`, new Date(), options)));
  assert.equal(recoveries, 1);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.ok(results.every((result) => result.available && !result.recovery_required && !result.error));
  delete globalThis.__breadboardClaudeUsage;
  assert.equal((await read()).available, true);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("an unexpected 401 can renew OAuth, while 403 reports access denial without generation", async (t) => {
  const { credentials } = await usageFixture(t);
  await credentials("old-token", { refreshToken: "fixture-refresh" });
  let status = 401;
  let recoveries = 0;
  t.mock.method(globalThis, "fetch", async () => status ? new Response(null, { status }) : usageReport());
  const options = { recoverSession: async () => { recoveries++; status = 0; } };
  assert.equal((await readClaudeUsageLimits("cliproxy/claude-test", new Date(), options)).available, true);
  assert.equal(recoveries, 1);
  t.mock.timers.tick(REFRESH_MS);
  status = 403;
  const denied = await readClaudeUsageLimits("cliproxy/claude-test", new Date(), options);
  assert.equal(denied.available, false);
  assert.equal(denied.auth_required, true);
  assert.match(denied.error, /does not have access/);
  assert.equal(recoveries, 1);
});

test("only an explicitly inactive session triggers a wake-up; malformed and throttled reports never do", async (t) => {
  await usageFixture(t);
  let mode = "inactive";
  let recoveries = 0;
  t.mock.method(globalThis, "fetch", async () => mode === "throttled"
    ? new Response(null, { status: 429, headers: { "Retry-After": "900" } })
    : mode === "inactive" ? Response.json({ five_hour: null, seven_day: { utilization: 42 } })
    : mode === "malformed" ? Response.json({}) : usageReport());
  const options = { recoverSession: async () => { recoveries++; mode = "ok"; } };
  const recovered = await readClaudeUsageLimits("cliproxy/claude-test", new Date(), options);
  assert.equal(recovered.limits[0].key, "five_hour");
  assert.equal(recoveries, 1);
  for (const next of ["malformed", "throttled"]) {
    t.mock.timers.tick(REFRESH_MS);
    mode = next;
    const stale = await readClaudeUsageLimits("cliproxy/claude-test", new Date(), options);
    assert.equal(stale.stale, true);
    assert.equal(stale.recovery_required, undefined);
    assert.equal(recoveries, 1);
  }
});

test("failed session recovery keeps its cooldown across tabs and restarts", async (t) => {
  const { credentials } = await usageFixture(t);
  await credentials("expired-token", { refreshToken: "fixture-refresh", expiresAt: Date.now() - 1 });
  let recoveries = 0;
  const options = { recoverSession: async () => { recoveries++; throw new Error("private CLI error"); } };
  const read = () => readClaudeUsageLimits("cliproxy/claude-test", new Date(), options);
  const first = await read();
  assert.equal(first.recovery_required, undefined);
  assert.equal(Date.parse(first.retry_at) - Date.now(), 900000);
  assert.ok(!JSON.stringify(first).includes("private CLI error"));
  delete globalThis.__breadboardClaudeUsage;
  t.mock.timers.tick(899999);
  assert.equal((await read()).available, false);
  assert.equal(recoveries, 1);
  t.mock.timers.tick(1);
  await read();
  assert.equal(recoveries, 2);
});

test("Claude shares a single OAuth request across tabs and models, retaining the capture time", async (t) => {
  const { read } = await usageFixture(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers["anthropic-beta"], "oauth-2025-04-20");
    await gate;
    return usageReport();
  });
  const reads = [read(), read("cliproxy/claude-opus-test"), read()];
  release();
  const results = await Promise.all(reads);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(results[1].model, "claude-opus-test");
  assert.equal(results[0].limits[0].limit.used_percent, 24);
  t.mock.timers.tick(30_000);
  const cached = await read();
  assert.equal(cached.captured_at, results[0].captured_at);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.ok(!JSON.stringify(cached).includes("fixture-token"));
  t.mock.timers.tick(REFRESH_MS - 30_000);
  await read();
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("Claude keeps the last report through 429, honors Retry-After, and recovers without extending the cooldown", async (t) => {
  const { read } = await usageFixture(t);
  let throttled = false;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => throttled
    ? new Response(null, { status: 429, headers: { "Retry-After": "900" } }) : usageReport());
  const first = await read();
  t.mock.timers.tick(REFRESH_MS);
  throttled = true;
  const stale = await read();
  assert.equal(stale.available, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.captured_at, first.captured_at);
  assert.deepEqual(stale.limits, first.limits);
  assert.match(stale.refresh_error, /temporarily limiting usage checks/);
  assert.equal(stale.retry_at, "2026-09-07T12:20:00.000Z");
  t.mock.timers.tick(120_000);
  assert.equal((await read()).retry_at, stale.retry_at);
  assert.equal(fetchMock.mock.callCount(), 2);
  throttled = false;
  t.mock.timers.tick(780_000);
  const recovered = await read();
  assert.equal(fetchMock.mock.callCount(), 3);
  assert.equal(recovered.stale, undefined);
  assert.equal(recovered.refresh_error, undefined);
  assert.equal(recovered.retry_at, undefined);
  assert.notEqual(recovered.captured_at, first.captured_at);
});

test("Claude backs off empty/zero Retry-After exponentially and resets after success", async (t) => {
  const { read } = await usageFixture(t);
  let throttled = true;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => throttled
    ? new Response(null, { status: 429, headers: { "Retry-After": "0" } }) : usageReport());
  const first = await read();
  assert.equal(first.available, false);
  assert.deepEqual(first.limits, []);
  assert.equal(Date.parse(first.retry_at) - Date.now(), REFRESH_MS);
  t.mock.timers.tick(REFRESH_MS);
  const second = await read();
  assert.equal(Date.parse(second.retry_at) - Date.now(), 2 * REFRESH_MS);
  t.mock.timers.tick(REFRESH_MS);
  await read();
  assert.equal(fetchMock.mock.callCount(), 2);
  t.mock.timers.tick(REFRESH_MS);
  throttled = false;
  assert.equal((await read()).available, true);
  t.mock.timers.tick(REFRESH_MS);
  throttled = true;
  assert.equal(Date.parse((await read()).retry_at) - Date.now(), REFRESH_MS);
});

test("Claude honors HTTP-date Retry-After even beyond the backoff cap", async (t) => {
  const { read } = await usageFixture(t);
  const until = new Date(Date.now() + 3_600_000);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "Retry-After": until.toUTCString() } }));
  assert.equal((await read()).retry_at, until.toISOString());
});

test("Claude keeps readings through network/malformed reports and drops cache when credentials change or expire", async (t) => {
  const { read, credentials } = await usageFixture(t);
  let mode = "ok";
  t.mock.method(globalThis, "fetch", async () => {
    if (mode === "network") throw new TypeError("offline");
    if (mode === "malformed") return Response.json({});
    if (mode === "unauthorized") return new Response(null, { status: 401 });
    return usageReport();
  });
  await read();
  for (mode of ["network", "malformed"]) {
    t.mock.timers.tick(REFRESH_MS);
    const stale = await read();
    assert.equal(stale.available, true);
    assert.equal(stale.stale, true);
  }
  await credentials("another-account");
  assert.equal((await read()).available, false);
  mode = "ok";
  t.mock.timers.tick(REFRESH_MS);
  assert.equal((await read()).available, true);
  mode = "unauthorized";
  t.mock.timers.tick(REFRESH_MS);
  const expired = await read();
  assert.equal(expired.available, false);
  assert.deepEqual(expired.limits, []);
  assert.match(expired.error, /sign-in has expired/);
});

test("Claude restores its last reading and cooldown in a new server process without an upstream request", async (t) => {
  const { read, directory, cacheFile } = await usageFixture(t);
  t.mock.method(globalThis, "fetch", async () => usageReport());
  const first = await read();
  t.mock.timers.tick(REFRESH_MS);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "Retry-After": "1800" } }));
  const stale = await read();
  const saved = await fs.readFile(cacheFile, "utf8");
  assert.ok(!saved.includes("fixture-token"));
  assert.ok(!saved.includes("accessToken"));

  const moduleUrl = new URL("../src/lib/claude-usage-limits.ts", import.meta.url).href;
  const script = `
    import { readClaudeUsageLimits } from ${JSON.stringify(moduleUrl)};
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("Must honor persisted cooldown"); };
    const data = await readClaudeUsageLimits("cliproxy/claude-opus-test", new Date(${Date.now()}));
    console.log(JSON.stringify({ calls, data }));
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: directory }, timeout: 15_000,
  });
  const restarted = JSON.parse(stdout);
  assert.equal(restarted.calls, 0);
  assert.equal(restarted.data.stale, true);
  assert.equal(restarted.data.model, "claude-opus-test");
  assert.equal(restarted.data.retry_at, stale.retry_at);
  assert.equal(restarted.data.captured_at, first.captured_at);
  assert.deepEqual(restarted.data.limits, first.limits);
});

test("Claude preserves first-load backoff across restarts and resumes at its deadline", async (t) => {
  const { read } = await usageFixture(t);
  let throttled = true;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => throttled
    ? new Response(null, { status: 429 }) : usageReport());
  const first = await read();
  delete globalThis.__breadboardClaudeUsage;
  t.mock.timers.tick(REFRESH_MS - 1);
  const restarted = await read();
  assert.equal(restarted.available, false);
  assert.equal(restarted.retry_at, first.retry_at);
  assert.equal(fetchMock.mock.callCount(), 1);
  t.mock.timers.tick(1);
  const second = await read();
  assert.equal(Date.parse(second.retry_at) - Date.now(), 2 * REFRESH_MS);
  delete globalThis.__breadboardClaudeUsage;
  t.mock.timers.tick(2 * REFRESH_MS);
  throttled = false;
  assert.equal((await read()).available, true);
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("Claude persists fresh readings but never restores another credential's report or a revoked report", async (t) => {
  const { read, credentials } = await usageFixture(t);
  let unauthorized = false;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => unauthorized ? new Response(null, { status: 401 }) : usageReport());
  const first = await read();
  delete globalThis.__breadboardClaudeUsage;
  assert.equal((await read()).captured_at, first.captured_at);
  assert.equal(fetchMock.mock.callCount(), 1);
  await credentials("different-account");
  unauthorized = true;
  assert.equal((await read()).available, false);
  assert.equal(fetchMock.mock.callCount(), 2);
  delete globalThis.__breadboardClaudeUsage;
  assert.equal((await read()).available, false);
  assert.equal(fetchMock.mock.callCount(), 2);

  unauthorized = false;
  t.mock.timers.tick(REFRESH_MS);
  assert.equal((await read()).available, true);
  unauthorized = true;
  t.mock.timers.tick(REFRESH_MS);
  await read();
  delete globalThis.__breadboardClaudeUsage;
  assert.deepEqual((await read()).limits, []);
});

test("Claude still fetches when the disk cache is corrupt or unwritable", async (t) => {
  const { read, cacheFile } = await usageFixture(t);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => usageReport());
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(cacheFile, "{broken");
  assert.equal((await read()).available, true);
  await fs.unlink(cacheFile);
  await fs.mkdir(cacheFile); // A directory at the file path makes atomic replacement fail on every platform.
  delete globalThis.__breadboardClaudeUsage;
  assert.equal((await read()).available, true);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("converts Anthropic's session and weekly utilization into shared meters", () => {
  const rows = claudeUsageRowsFromResponse(
    {
      five_hour: {
        utilization: 16,
        resets_at: "2026-08-21T22:49:59.000Z",
      },
      seven_day: {
        utilization: 52,
        resets_at: "2026-08-27T04:59:59.000Z",
      },
    },
    new Date("2026-08-21T20:49:59.000Z"),
  );

  assert.deepEqual(rows, [
    {
      key: "five_hour",
      label: "Current session",
      limit: { used_percent: 16, resets_in_seconds: 7200 },
    },
    {
      key: "seven_day",
      label: "Current week (all models)",
      limit: { used_percent: 52, resets_in_seconds: 461400 },
    },
  ]);
});

test("ignores unreported windows and clamps malformed utilization", () => {
  assert.deepEqual(
    claudeUsageRowsFromResponse(
      {
        five_hour: { utilization: 140, resets_at: "not-a-date" },
        seven_day: { utilization: null },
      },
      new Date(0),
    ),
    [
      {
        key: "five_hour",
        label: "Current session",
        limit: { used_percent: 100 },
      },
    ],
  );
});
