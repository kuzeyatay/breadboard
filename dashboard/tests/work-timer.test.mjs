// The work timer's arithmetic: what the clock reads, what each control does to
// a session, and what survives a reload.

import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE_WORK_TIMER,
  WORK_TIMER_DEFAULT_MS,
  WORK_TIMER_PRESET_MINUTES,
  formatWorkTimer,
  parseWorkTimerSession,
  pauseWorkTimer,
  resetWorkTimer,
  setWorkTimerMinutes,
  settleWorkTimer,
  startWorkTimer,
  workTimerPhase,
  workTimerProgress,
  workTimerRemainingMs,
} from "../src/lib/work-timer.ts";

const T0 = 1_700_000_000_000;

test("the clock reads minutes and padded seconds, and never goes negative", () => {
  assert.equal(formatWorkTimer(25 * 60_000), "25:00");
  assert.equal(formatWorkTimer(65_000), "1:05");
  assert.equal(formatWorkTimer(9_000), "0:09");
  assert.equal(formatWorkTimer(0), "0:00");
  assert.equal(formatWorkTimer(-5_000), "0:00", "an overrun still reads as zero");
});

test("a fresh timer is idle, and shows its full length", () => {
  assert.equal(workTimerPhase(IDLE_WORK_TIMER), "idle");
  assert.equal(workTimerRemainingMs(IDLE_WORK_TIMER, T0), WORK_TIMER_DEFAULT_MS);
  assert.equal(workTimerProgress(IDLE_WORK_TIMER, T0), 0);
});

test("a running session counts down against the wall clock", () => {
  const running = startWorkTimer(IDLE_WORK_TIMER, T0);
  assert.equal(workTimerPhase(running), "running");
  assert.equal(formatWorkTimer(workTimerRemainingMs(running, T0)), "25:00");

  // Time passing is all it takes — nothing has to tick for the clock to move,
  // which is why closing the panel cannot stop the session.
  assert.equal(formatWorkTimer(workTimerRemainingMs(running, T0 + 60_000)), "24:00");
  assert.equal(workTimerProgress(running, T0 + 12.5 * 60_000), 0.5);
  assert.equal(workTimerRemainingMs(running, T0 + 60 * 60_000), 0, "and stops at zero");
});

test("pausing freezes the remainder, and resuming picks it back up", () => {
  const running = startWorkTimer(IDLE_WORK_TIMER, T0);
  const paused = pauseWorkTimer(running, T0 + 5 * 60_000);

  assert.equal(workTimerPhase(paused), "paused");
  assert.equal(formatWorkTimer(workTimerRemainingMs(paused, T0 + 5 * 60_000)), "20:00");
  assert.equal(
    formatWorkTimer(workTimerRemainingMs(paused, T0 + 90 * 60_000)),
    "20:00",
    "and stays put however long it is left alone",
  );

  const resumed = startWorkTimer(paused, T0 + 90 * 60_000);
  assert.equal(workTimerPhase(resumed), "running");
  assert.equal(
    formatWorkTimer(workTimerRemainingMs(resumed, T0 + 90 * 60_000)),
    "20:00",
    "resuming continues rather than restarting",
  );

  assert.deepEqual(pauseWorkTimer(paused, T0), paused, "pausing twice is a no-op");
});

test("a session that ran out is finished, and starting again begins a new one", () => {
  const running = startWorkTimer(IDLE_WORK_TIMER, T0);

  assert.deepEqual(
    settleWorkTimer(running, T0 + 60_000),
    running,
    "a session still in flight is left alone",
  );

  const finished = settleWorkTimer(running, T0 + 26 * 60_000);
  assert.equal(workTimerPhase(finished), "finished");
  assert.equal(workTimerRemainingMs(finished, T0 + 26 * 60_000), 0);
  assert.equal(workTimerProgress(finished, T0 + 26 * 60_000), 1);

  const restarted = startWorkTimer(finished, T0 + 26 * 60_000);
  assert.equal(formatWorkTimer(workTimerRemainingMs(restarted, T0 + 26 * 60_000)), "25:00");
});

test("resetting and choosing a length both clear the clock", () => {
  const running = startWorkTimer(IDLE_WORK_TIMER, T0);
  assert.equal(workTimerPhase(resetWorkTimer(running)), "idle");
  assert.equal(resetWorkTimer(running).durationMs, WORK_TIMER_DEFAULT_MS, "the length is kept");

  for (const minutes of WORK_TIMER_PRESET_MINUTES) {
    const chosen = setWorkTimerMinutes(minutes);
    assert.equal(workTimerPhase(chosen), "idle");
    assert.equal(formatWorkTimer(workTimerRemainingMs(chosen, T0)), `${minutes}:00`);
  }

  const midSession = setWorkTimerMinutes(5);
  assert.equal(
    workTimerPhase(startWorkTimer(midSession, T0)),
    "running",
    "and the new length is what runs",
  );
  assert.equal(formatWorkTimer(workTimerRemainingMs(startWorkTimer(midSession, T0), T0)), "5:00");
});

test("a stored session comes back, and a broken one is ignored rather than kept", () => {
  const running = startWorkTimer(setWorkTimerMinutes(15), T0);
  const restored = parseWorkTimerSession(JSON.stringify(running));
  assert.deepEqual(restored, running, "a reload lands mid-session");
  assert.equal(formatWorkTimer(workTimerRemainingMs(restored, T0 + 60_000)), "14:00");

  for (const bad of [
    null,
    "",
    "not json",
    "[]",
    '"a string"',
    "{}",
    JSON.stringify({ durationMs: 0 }),
    JSON.stringify({ durationMs: -1 }),
    JSON.stringify({ durationMs: "25" }),
  ]) {
    assert.equal(parseWorkTimerSession(bad), null, `${bad} is not a session`);
  }

  assert.deepEqual(
    parseWorkTimerSession(JSON.stringify({ durationMs: 60_000, endAt: "soon", remainingMs: -3 })),
    { durationMs: 60_000, endAt: null, remainingMs: null },
    "a usable length survives junk in the other fields, as an idle session",
  );
});

test("a session that ran out while the page was closed lands on finished", () => {
  const running = startWorkTimer(IDLE_WORK_TIMER, T0);
  const reloadedLater = settleWorkTimer(parseWorkTimerSession(JSON.stringify(running)), T0 + 86_400_000);
  assert.equal(workTimerPhase(reloadedLater), "finished");
});
