import assert from "node:assert/strict";
import test from "node:test";

import {
  cachedGardenNoteCount,
  invalidateGardenNoteCount,
} from "../src/lib/garden-note-count-cache.ts";

/** A counter that records how often the real directory walk would have run. */
function counter(value = 7) {
  const state = { calls: 0, value };
  return {
    state,
    count: () => {
      state.calls += 1;
      return state.value;
    },
  };
}

function clock(start = 1_000) {
  const state = { now: start };
  return { now: () => state.now, advance: (ms) => (state.now += ms) };
}

test("a Garden in several lists is walked once, not once per list", () => {
  invalidateGardenNoteCount();
  const { state, count } = counter(42);
  const time = clock();
  // The dashboard draws the private, public, and organization lists in one read.
  const counts = [0, 1, 2].map(() =>
    cachedGardenNoteCount("/content", "telecom-1", count, { now: time.now }),
  );
  assert.deepEqual(counts, [42, 42, 42]);
  assert.equal(state.calls, 1);
});

test("a stale count is recounted after the freshness window", () => {
  invalidateGardenNoteCount();
  const { state, count } = counter();
  const time = clock();
  cachedGardenNoteCount("/content", "math-1", count, { now: time.now });
  time.advance(9_000);
  cachedGardenNoteCount("/content", "math-1", count, { now: time.now });
  assert.equal(state.calls, 1, "still inside the window");
  time.advance(2_000);
  cachedGardenNoteCount("/content", "math-1", count, { now: time.now });
  assert.equal(state.calls, 2, "the window is the reconciliation path");
});

test("writing to a Garden makes its count stop being reused", () => {
  invalidateGardenNoteCount();
  const first = counter(3);
  const time = clock();
  cachedGardenNoteCount("/content", "math-1", first.count, { now: time.now });
  cachedGardenNoteCount("/content", "other", first.count, { now: time.now });
  assert.equal(first.state.calls, 2);

  invalidateGardenNoteCount("math-1");
  const second = counter(4);
  assert.equal(
    cachedGardenNoteCount("/content", "math-1", second.count, { now: time.now }),
    4,
    "the changed Garden is recounted",
  );
  assert.equal(
    cachedGardenNoteCount("/content", "other", second.count, { now: time.now }),
    3,
    "an untouched Garden keeps its count",
  );
  assert.equal(second.state.calls, 1);
});

test("Gardens with the same name under different content roots stay separate", () => {
  invalidateGardenNoteCount();
  const time = clock();
  const live = counter(10);
  const other = counter(99);
  assert.equal(
    cachedGardenNoteCount("/live", "math-1", live.count, { now: time.now }),
    10,
  );
  assert.equal(
    cachedGardenNoteCount("/elsewhere", "math-1", other.count, { now: time.now }),
    99,
  );
});

test("counting is never skipped for a Garden that was never counted", () => {
  invalidateGardenNoteCount();
  const { state, count } = counter(0);
  const time = clock();
  assert.equal(
    cachedGardenNoteCount("/content", "empty-garden", count, { now: time.now }),
    0,
  );
  assert.equal(state.calls, 1, "zero is a real answer and is cached like any other");
  cachedGardenNoteCount("/content", "empty-garden", count, { now: time.now });
  assert.equal(state.calls, 1);
});
