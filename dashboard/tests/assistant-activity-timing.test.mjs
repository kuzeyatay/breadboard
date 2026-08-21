import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSISTANT_LIVE_ACTIVITY_DELAY_MS,
  assistantLiveActivityReady,
  assistantResponseElapsedMs,
} from "../src/lib/assistant-activity-timing.ts";

test("specific live activity waits for the five-second Thinking beat", () => {
  assert.equal(ASSISTANT_LIVE_ACTIVITY_DELAY_MS, 5_000);
  assert.equal(assistantLiveActivityReady(null), false);
  assert.equal(assistantLiveActivityReady(4_999), false);
  assert.equal(assistantLiveActivityReady(5_000), true);
});

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

test("an active delegated worker keeps counting from its durable turn start", () => {
  assert.equal(
    assistantResponseElapsedMs({
      activities: [],
      active: true,
      now: Date.parse("2026-01-01T00:00:12.000Z"),
      reportedDurationMs: 5_000,
      activePhaseStartedAt: "2026-01-01T00:00:05.000Z",
    }),
    12_000,
  );
});

test("an active phase falls back to time since mount instead of stale message time", () => {
  assert.equal(
    assistantResponseElapsedMs({
      activities: [],
      active: true,
      now: 20_000,
      reportedDurationMs: 4_000,
      activeFallbackStartedAtMs: 18_000,
    }),
    6_000,
  );
});

test("a reopened live response keeps counting from its durable message start", () => {
  assert.equal(
    assistantResponseElapsedMs({
      activities: [],
      active: true,
      now: Date.parse("2026-01-01T00:00:12.000Z"),
      responseStartedAt: "2026-01-01T00:00:02.000Z",
      activeFallbackStartedAtMs: Date.parse("2026-01-01T00:00:11.000Z"),
    }),
    10_000,
  );
});

test("the durable response start outranks activity rebuilt after navigation", () => {
  assert.equal(
    assistantResponseElapsedMs({
      activities: [{ startedAt: "2026-01-01T00:00:11.000Z" }],
      active: true,
      now: Date.parse("2026-01-01T00:00:12.000Z"),
      responseStartedAt: "2026-01-01T00:00:02.000Z",
    }),
    10_000,
  );
});

// A delegation ends with two turns and one visible row: the turn that delegated
// is hidden, and the hand-back that reports its result is what the person sees.
// Its own duration is only the synthesis, so the row has to carry the rest or
// it claims fifteen seconds for an operation that ran for minutes.
test("a hand-back row reports the whole operation, not just its synthesis", () => {
  assert.equal(
    assistantResponseElapsedMs({
      activities: [],
      active: false,
      now: Date.parse("2026-01-01T00:05:00.000Z"),
      reportedDurationMs: 15_000,
      carriedDurationMs: 297_000,
    }),
    312_000,
  );
});

// The number has to climb continuously across the seam. Counting the synthesis
// from zero and only adding the rest once the row settled would show the clock
// running backwards and then jumping.
test("a carried duration counts on from where the delegation left off", () => {
  assert.equal(
    assistantResponseElapsedMs({
      activities: [{ startedAt: "2026-01-01T00:05:00.000Z" }],
      active: true,
      now: Date.parse("2026-01-01T00:05:04.000Z"),
      carriedDurationMs: 297_000,
    }),
    301_000,
  );
});

// Nothing carried is the ordinary turn, and it must be untouched.
test("an ordinary turn is unaffected by the carried-duration input", () => {
  assert.equal(
    assistantResponseElapsedMs({
      activities: [],
      active: false,
      now: Date.parse("2026-01-01T00:00:12.000Z"),
      reportedDurationMs: 4_250,
      carriedDurationMs: undefined,
    }),
    4_250,
  );
});
