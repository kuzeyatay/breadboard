import assert from "node:assert/strict";
import test from "node:test";
import { assistantResponseElapsedMs } from "../src/lib/assistant-activity-timing.ts";

test("live thinking uses the full wall-clock turn instead of early provider duration", () => {
  assert.equal(assistantResponseElapsedMs({
    activities: [{ startedAt: "2026-01-01T00:00:00.000Z" }],
    active: true,
    now: Date.parse("2026-01-01T00:00:09.000Z"),
    reportedDurationMs: 2_000,
  }), 9_000);
});

test("completed branch uses its own persisted duration instead of newer shared activity", () => {
  assert.equal(assistantResponseElapsedMs({
    activities: [
      {
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:08.000Z",
      },
      {
        startedAt: "2026-01-01T00:00:03.000Z",
        completedAt: "2026-01-01T00:00:05.000Z",
      },
    ],
    active: false,
    now: Date.parse("2026-01-01T00:00:12.000Z"),
    reportedDurationMs: 2_000,
  }), 2_000);
});

test("restored responses without activity timestamps use reported duration", () => {
  assert.equal(assistantResponseElapsedMs({
    activities: [],
    active: false,
    now: Date.parse("2026-01-01T00:00:12.000Z"),
    reportedDurationMs: 4_250,
  }), 4_250);
});
