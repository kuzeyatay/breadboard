import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readUsageLimits,
  resolveUsageLimitsPath,
} from "../src/lib/usage-limits.ts";
import {
  usageLimitRowsWithFiveHour,
  usageLimitWindowLabel,
  visibleUsageLimitRows,
} from "../src/lib/usage-limit-display.ts";

function writeUsage(filePath, capturedAt, usedPercent) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        captured_at: capturedAt,
        primary: {
          used_percent: usedPercent,
          window_minutes: 300,
          resets_in_seconds: 3600,
        },
      },
      null,
      2,
    ),
  );
}

describe("usage limits reader", () => {
  test("uses the freshest discovered usage file when no explicit path is set", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-usage-"));
    const oldPath = path.join(home, ".chatgpt-local", "usage_limits.json");
    const freshPath = path.join(home, ".codex", "usage_limits.json");
    writeUsage(oldPath, "2026-07-03T10:00:00.000Z", 10);
    writeUsage(freshPath, "2026-07-03T10:05:00.000Z", 25);
    fs.utimesSync(oldPath, new Date("2026-07-03T10:00:00.000Z"), new Date("2026-07-03T10:00:00.000Z"));
    fs.utimesSync(freshPath, new Date("2026-07-03T10:05:00.000Z"), new Date("2026-07-03T10:05:00.000Z"));

    assert.equal(resolveUsageLimitsPath({}, home), freshPath);
    const payload = readUsageLimits({}, home, new Date("2026-07-03T10:06:00.000Z"));
    assert.equal(payload.available, true);
    assert.equal(payload.primary?.used_percent, 25);
    assert.equal(payload.stale, false);
  });

  test("respects an explicit usage file path and marks stale snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-usage-explicit-"));
    const explicitPath = path.join(root, "usage_limits.json");
    writeUsage(explicitPath, "2026-07-03T10:00:00.000Z", 90);

    const payload = readUsageLimits(
      { CHATMOCK_USAGE_LIMITS_PATH: explicitPath },
      root,
      new Date("2026-07-03T10:30:01.000Z"),
    );
    assert.equal(payload.available, true);
    assert.equal(payload.primary?.used_percent, 90);
    assert.equal(payload.stale, true);
  });
});

describe("usage limit display", () => {
  test("labels limits from their actual window length", () => {
    assert.equal(usageLimitWindowLabel({ window_minutes: 300 }, "fallback"), "5-hour limit");
    assert.equal(usageLimitWindowLabel({ window_minutes: 10_080 }, "fallback"), "Weekly limit");
    assert.equal(usageLimitWindowLabel({ window_minutes: 1_440 }, "fallback"), "Daily limit");
  });

  test("sorts real windows and removes zero-length placeholders", () => {
    const rows = visibleUsageLimitRows({
      primary: {
        used_percent: 24,
        window_minutes: 10_080,
        resets_in_seconds: 510_578,
      },
      secondary: {
        used_percent: 0,
        window_minutes: 0,
        resets_in_seconds: 0,
      },
    });

    assert.deepEqual(
      rows.map(({ key, label }) => ({ key, label })),
      [{ key: "primary", label: "Weekly limit" }],
    );
  });

  test("uses neutral fallback labels when upstream omits window metadata", () => {
    const rows = visibleUsageLimitRows({
      primary: { used_percent: 10 },
      secondary: { used_percent: 20 },
    });
    assert.deepEqual(rows.map((row) => row.label), ["Primary limit", "Secondary limit"]);
  });

  test("keeps an honest five-hour row when upstream does not report that window", () => {
    const rows = usageLimitRowsWithFiveHour({
      primary: {
        used_percent: 24,
        window_minutes: 10_080,
        resets_in_seconds: 510_578,
      },
      secondary: {
        used_percent: 0,
        window_minutes: 0,
        resets_in_seconds: 0,
      },
    });

    assert.deepEqual(
      rows.map(({ label, reported }) => ({ label, reported })),
      [
        { label: "5-hour limit", reported: false },
        { label: "Weekly limit", reported: true },
      ],
    );
  });

  test("uses actual five-hour data instead of the unavailable row when reported", () => {
    const rows = usageLimitRowsWithFiveHour({
      primary: { used_percent: 12, window_minutes: 300, resets_in_seconds: 900 },
      secondary: { used_percent: 24, window_minutes: 10_080, resets_in_seconds: 510_578 },
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].label, "5-hour limit");
    assert.equal(rows[0].reported, true);
    assert.equal(rows[0].window.used_percent, 12);
  });
});
