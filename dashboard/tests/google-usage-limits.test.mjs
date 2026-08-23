import assert from "node:assert/strict";
import test from "node:test";
import {
  antigravityModelId,
  googleLimitWindowFromModels,
} from "../src/lib/cliproxy/google-usage-limits.ts";

test("recognizes only Google models served by the subscription proxy", () => {
  assert.equal(
    antigravityModelId("cliproxy/gemini-3.1-pro-high"),
    "gemini-3.1-pro-high",
  );
  assert.equal(antigravityModelId("google/gemini-3.1-pro-high"), null);
  assert.equal(antigravityModelId("cliproxy/claude-sonnet-4-6"), null);
  assert.equal(antigravityModelId("gpt-5.6-sol"), null);
});

test("converts Google's remaining fraction and reset timestamp for one model", () => {
  const window = googleLimitWindowFromModels(
    {
      models: {
        "gemini-3.1-pro-high": {
          quotaInfo: {
            remainingFraction: 0.8812518,
            resetTime: "2026-08-21T21:44:17.000Z",
          },
        },
      },
    },
    "gemini-3.1-pro-high",
    new Date("2026-08-21T20:44:17.000Z"),
  );

  assert.ok(window);
  assert.ok(Math.abs(window.used_percent - 11.87482) < 0.000001);
  assert.equal(window.resets_in_seconds, 3600);
});

test("ignores missing models and clamps malformed fractions", () => {
  const payload = {
    models: {
      "gemini-3-flash": { quotaInfo: { remainingFraction: 1.5 } },
    },
  };
  assert.deepEqual(
    googleLimitWindowFromModels(payload, "GEMINI-3-FLASH", new Date(0)),
    { used_percent: 0 },
  );
  assert.equal(
    googleLimitWindowFromModels(payload, "gemini-3.1-pro-high", new Date(0)),
    null,
  );
});
