import assert from "node:assert/strict";
import test from "node:test";
import { codexUsagePayload, readCodexUsageReport } from "../src/lib/chatgpt-codex-usage.ts";
import { usageReserveModelLabel, usageReserveRows } from "../src/lib/usage-limit-display.ts";
import { notchHeadlineRow, notchReserveCopy, notchUsageRows } from "../src/lib/usage-notch.ts";

/** ChatMock's `/v1/settings/usage` answer for a Pro plan whose week is spent. */
function report(overrides = {}) {
  return {
    captured_at: "2026-09-14T08:00:00+00:00",
    account: "pro@example.com",
    plan: "pro",
    allowed: false,
    limit_reached: true,
    primary: { used_percent: 100, window_minutes: 10080, resets_in_seconds: 442123 },
    secondary: null,
    reserve: {
      name: "gpt-reserve",
      model: "gpt-5.6-luna",
      active: true,
      allowed: true,
      limit_reached: false,
      primary: { used_percent: 26, window_minutes: 10080, resets_in_seconds: 257851 },
      secondary: null,
    },
    banner: { type: "luna_reserve", title: "You’re now using Luna, a faster model for simpler tasks.", description: null },
    credits: { has_credits: false, unlimited: false, balance: 0 },
    ...overrides,
  };
}

test("the report becomes a usage payload that carries the Luna reserve", () => {
  const payload = codexUsagePayload(report(), new Date("2026-09-14T08:00:30Z"));
  assert.equal(payload.available, true);
  assert.equal(payload.source, "report");
  assert.equal(payload.account, "pro@example.com");
  assert.equal(payload.plan, "pro");
  assert.equal(payload.limit_reached, true);
  assert.equal(payload.age_seconds, 30);
  assert.deepEqual(payload.primary, { used_percent: 100, window_minutes: 10080, resets_in_seconds: 442123 });
  assert.equal(payload.secondary, undefined);
  assert.equal(payload.reserve.model, "gpt-5.6-luna");
  assert.equal(payload.reserve.active, true);
  assert.equal(payload.reserve.primary.used_percent, 26);
  assert.equal(payload.banner.type, "luna_reserve");
});

test("a report without windows or without a capture time is not a payload", () => {
  assert.equal(codexUsagePayload(report({ primary: null, secondary: null })), null);
  assert.equal(codexUsagePayload(report({ captured_at: "" })), null);
  assert.equal(codexUsagePayload({ error: { message: "nope" } }), null);
  assert.equal(codexUsagePayload(null), null);
});

test("reserve rows sit beneath the plan's own and name the model", () => {
  assert.equal(usageReserveModelLabel("gpt-5.6-luna"), "GPT-5.6 Luna");
  assert.equal(usageReserveModelLabel(null), "Reserve");
  const rows = usageReserveRows(codexUsagePayload(report()));
  assert.deepEqual(rows.map((row) => [row.key, row.label, row.reported]), [
    ["reserve", "GPT-5.6 Luna reserve · weekly limit", true],
  ]);
  assert.deepEqual(usageReserveRows({ reserve: null }), []);
  assert.deepEqual(usageReserveRows({}), []);
});

test("the notch ring follows the reserve while it is serving, and says so", () => {
  const data = codexUsagePayload(report());
  const rows = notchUsageRows("chatgpt", data);
  assert.deepEqual(rows.map((row) => [row.key, row.used]), [["five-hour", null], ["primary", 100], ["reserve", 26]]);
  assert.equal(notchHeadlineRow("chatgpt", rows, data).key, "reserve");
  assert.match(notchReserveCopy(data), /GPT-5\.6 Luna from its reserve pool/);

  const idle = codexUsagePayload(report({
    limit_reached: false,
    primary: { used_percent: 41, window_minutes: 10080, resets_in_seconds: 442123 },
    reserve: { ...report().reserve, active: false },
    banner: null,
  }));
  assert.equal(notchHeadlineRow("chatgpt", notchUsageRows("chatgpt", idle), idle).key, "primary");
  assert.equal(notchReserveCopy(idle), null);

  // A header snapshot never carries a reserve, so it never draws one.
  const headers = { available: true, source: "headers", primary: { used_percent: 12, window_minutes: 300 }, reserve: report().reserve };
  assert.deepEqual(notchUsageRows("chatgpt", headers).map((row) => row.key), ["primary"]);
});

test("concurrent report reads share one request and a failed read falls back to null", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-14T08:00:00Z") });
  const fetchMock = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "http://fixture.invalid/v1/settings/usage");
    assert.equal(options.cache, "no-store");
    return Response.json(report());
  });
  const results = await Promise.all([
    readCodexUsageReport("http://fixture.invalid/v1"),
    readCodexUsageReport("http://fixture.invalid/v1"),
  ]);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(results[0].reserve.active, true);
  assert.equal(results[1], results[0]);
  t.mock.timers.tick(10_001);
  fetchMock.mock.mockImplementation(async () => Response.json({ error: { message: "nope" } }, { status: 502 }));
  assert.equal(await readCodexUsageReport("http://fixture.invalid/v1"), null);
  assert.equal(fetchMock.mock.callCount(), 2);
  // The failure is remembered briefly so a burst of tabs does not retry in step.
  assert.equal(await readCodexUsageReport("http://fixture.invalid/v1"), null);
  assert.equal(fetchMock.mock.callCount(), 2);
  fetchMock.mock.mockImplementation(async () => { throw new TypeError("offline"); });
  t.mock.timers.tick(30_001);
  assert.equal(await readCodexUsageReport("http://fixture.invalid/v1"), null);
  assert.equal(fetchMock.mock.callCount(), 3);
});
