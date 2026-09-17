import assert from "node:assert/strict";
import test from "node:test";
import { notchProviders, notchUsageRows, notchHeadline, notchPercent, notchRemaining, notchResetCopy, notchColor } from "../src/lib/usage-notch.ts";

test("notch discovers metered subscriptions from the Intelligence catalog without mixing API-provider budgets", () => {
  const providers = notchProviders(["gpt-test", "cliproxy/claude-test", "cliproxy/gemini-test", "cliproxy/gemini-other", "anthropic/claude-api", "openai/gpt-api", "default", "cliproxy/grok-test", "gpt-test"]);
  assert.deepEqual(providers.map(({ id, models }) => [id, models.length]), [["anthropic", 1], ["chatgpt", 1], ["google", 2]]);
  assert.deepEqual(notchProviders([]), []);
});

test("Gemini appears from live subscriptions before the Intelligence catalog has synced", () => {
  const providers = notchProviders(["gpt-test", "cliproxy/claude-test"], [
    "gemini-3-flash", "gemini-3.8-flash-high", "claude-test", "kimi-k2", "gpt-oss-120b-medium",
  ]);
  assert.deepEqual(providers, [
    { id: "anthropic", label: "Claude", models: ["cliproxy/claude-test"] },
    { id: "chatgpt", label: "ChatGPT", models: ["gpt-test"] },
    { id: "google", label: "Gemini", models: ["cliproxy/gemini-3-flash", "cliproxy/gemini-3.8-flash-high"] },
  ]);
  assert.equal(notchProviders([], ["gemini-3-flash"])[0].id, "google");
});

test("Claude always leads with the current session, independent of upstream row order", () => {
  const rows = notchUsageRows("anthropic", { provider: "anthropic", available: true, limits: [
    { key: "seven_day", label: "Current week (all models)", limit: { used_percent: 7 } },
    { key: "five_hour", label: "Current session", limit: { used_percent: 73 } },
  ] });
  assert.equal(notchHeadline("anthropic", rows), 73);
  assert.equal(rows[1].label, "All models");
  assert.equal(notchHeadline("anthropic", rows.slice(1)), null);
});

test("ChatGPT falls back to weekly usage when the five-hour allowance is unreported", () => {
  const rows = notchUsageRows("chatgpt", { available: true, primary: { used_percent: 52, window_minutes: 10080 }, secondary: { used_percent: 0, window_minutes: 0 } });
  assert.equal(notchHeadline("chatgpt", rows), 52);
  assert.equal(rows[0].used, null);
  assert.equal(rows[1].used, 52);
  assert.equal(rows[1].label, "Weekly limit");
  const missingSession = notchUsageRows("chatgpt", { available: true, primary: { window_minutes: 300 }, secondary: { used_percent: 0, window_minutes: 10080 } });
  assert.equal(notchHeadline("chatgpt", missingSession), 0);
});

test("ChatGPT prefers a reported session including zero and never invents missing usage", () => {
  for (const used_percent of [0, 21]) {
    const rows = notchUsageRows("chatgpt", { available: true, primary: { used_percent: 52, window_minutes: 10080 }, secondary: { used_percent, window_minutes: 300 } });
    assert.equal(notchHeadline("chatgpt", rows), used_percent);
  }
  assert.equal(notchHeadline("chatgpt", []), null);
  assert.equal(notchHeadline("chatgpt", notchUsageRows("chatgpt", { available: true, primary: { window_minutes: 10080 } })), null);
});

test("Google preserves separate account readings and summarizes the most-used account", () => {
  const rows = notchUsageRows("google", { provider: "google", available: true, accounts: [
    { account: "personal", limit: { used_percent: 15 } }, { account: "work", limit: { used_percent: 52 } },
  ] });
  assert.equal(notchHeadline("google", rows), 52);
  assert.equal(rows[0].label, "personal");
  assert.equal(rows[1].used, 52);
});

test("missing, invalid and mismatched readings never turn into a zero-percent allowance", () => {
  for (const value of [undefined, null, "", "50", NaN, Infinity]) assert.equal(notchPercent(value), null);
  assert.equal(notchPercent(0), 0);
  assert.equal(notchPercent(-1), 0);
  assert.equal(notchPercent(150), 100);
  assert.deepEqual(notchUsageRows("google", { available: true, provider: "anthropic" }), []);
  assert.deepEqual(notchUsageRows("chatgpt", { available: false, primary: { used_percent: 60 } }), []);
});

test("remaining allowance complements reported usage and preserves unknown readings", () => {
  for (const value of [undefined, null, "", "50", NaN, Infinity]) assert.equal(notchRemaining(value), null);
  assert.equal(notchRemaining(0), 100);
  assert.equal(notchRemaining(13), 87);
  assert.equal(notchRemaining(100), 0);
  assert.equal(notchRemaining(-1), 100);
  assert.equal(notchRemaining(150), 0);
});

test("countdowns use the snapshot time and mark expired windows without inventing a reset", () => {
  const captured = "2026-09-06T12:00:00Z";
  const now = Date.parse(captured) + 60000;
  assert.equal(notchResetCopy(captured, { resets_in_seconds: 3120 }, now), "Resets in 51 min");
  assert.equal(notchResetCopy(captured, { resets_in_seconds: 60 }, now), "Reset due");
  assert.equal(notchResetCopy(undefined, { resets_in_seconds: 60 }, now), "Reset not reported");
  assert.equal(notchResetCopy(captured, { resets_in_seconds: NaN }, now), "Reset not reported");
});

test("usage colors match the reference frame thresholds", () => {
  assert.equal(notchColor(21), "#00ff88");
  assert.equal(notchColor(52), "#f2ff00");
  assert.equal(notchColor(73), "#ff3f00");
  assert.equal(notchColor(100), "#ff3f00");
  assert.equal(notchColor(null), "#808080");
});
