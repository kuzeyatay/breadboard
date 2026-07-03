import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readUsageLimits,
  resolveUsageLimitsPath,
} from "../src/lib/usage-limits.ts";

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
