import assert from "node:assert/strict";
import test from "node:test";
import {
  claudeSubscriptionModelId,
  claudeUsageRowsFromResponse,
} from "../src/lib/claude-usage-limits.ts";

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
