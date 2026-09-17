import assert from "node:assert/strict";
import test from "node:test";

import { InteractionRecorder } from "../src/lib/performance/interaction-trace.ts";
import {
  formatPerformanceReport,
  percentile,
  summarizeInteractions,
} from "../src/lib/performance/summary.ts";

/** A recorder driven by a clock the test advances by hand. */
function harness(options = {}) {
  let clock = 1_000;
  const recorder = new InteractionRecorder({
    now: () => clock,
    wallClock: () => 1_700_000_000_000 + clock,
    ...options,
  });
  return {
    recorder,
    advance(ms) {
      clock += ms;
    },
    get clock() {
      return clock;
    },
  };
}

test("an interaction is measured from its input event through every stage", () => {
  const { recorder, advance } = harness();
  const interaction = recorder.begin("pdf-input-to-requested-page");
  advance(30);
  interaction.mark("document-opened");
  advance(120);
  interaction.mark("requested-page-rendered");
  advance(10);
  const record = interaction.end("usable");

  assert.equal(record.feature, "pdf-input-to-requested-page");
  assert.equal(record.durationMs, 160);
  assert.equal(record.outcome, "usable");
  assert.deepEqual(
    record.marks.map((mark) => [mark.name, mark.at]),
    [
      ["document-opened", 30],
      ["requested-page-rendered", 150],
    ],
  );
  assert.equal(interaction.open, false);
  assert.deepEqual(recorder.pending(), []);
});

test("queued input is measured from when the person acted, not when we noticed", () => {
  const { recorder, advance, clock } = harness();
  const inputAt = clock;
  advance(75); // the event sat in the queue behind a long task
  const interaction = recorder.begin("tab-input-to-visible", { startedAt: inputAt });
  advance(25);
  const record = interaction.end("usable");
  assert.equal(record.durationMs, 100);
});

test("the first interaction of a kind is cold and never mixed into warm results", () => {
  const { recorder, advance } = harness();
  const cold = recorder.begin("settings-input-to-controls");
  advance(800);
  cold.end("usable");
  for (const duration of [40, 60, 50]) {
    const warm = recorder.begin("settings-input-to-controls");
    advance(duration);
    warm.end("usable");
  }

  const report = summarizeInteractions(recorder.completed());
  const settings = report.features.find(
    (entry) => entry.feature === "settings-input-to-controls",
  );
  assert.equal(settings.cold.samples, 1);
  assert.equal(settings.cold.p50, 800);
  assert.equal(settings.warm.samples, 3);
  assert.equal(settings.warm.worst, 60);
});

test("a background refresh is recorded but is not the latency of showing content", () => {
  const { recorder, advance } = harness();
  const first = recorder.begin("settings-input-to-data");
  advance(90);
  first.end("usable");
  const refresh = recorder.begin("settings-input-to-data", { background: true });
  advance(4_000);
  refresh.end("usable");

  const [summary] = summarizeInteractions(recorder.completed()).features;
  assert.equal(summary.cold.samples, 1);
  assert.equal(summary.cold.p50, 90);
  assert.equal(summary.background.samples, 1);
  assert.equal(summary.background.p50, 4_000);
  assert.equal(summary.warm, null);
});

test("failures, cancellations, and timeouts stay in the results", () => {
  const { recorder, advance } = harness({ timeoutMs: 5_000 });
  recorder.begin("route-input-to-usable").end("usable");
  recorder.begin("route-input-to-usable").end("failed");
  recorder.begin("route-input-to-usable").end("cancelled");
  // Nobody ever closed this one: the person gave up and the content never came.
  recorder.begin("route-input-to-usable");
  advance(5_001);

  const report = summarizeInteractions(recorder.completed());
  const [summary] = report.features;
  assert.deepEqual(summary.outcomes, {
    usable: 1,
    failed: 1,
    cancelled: 1,
    timeout: 1,
  });
  assert.equal(report.totals.records, 4);
  assert.equal(summary.warm, null, "only successful displays are summarized as latency");
});

test("contention counters are attributed to the interaction that ran alongside them", () => {
  let counters = {
    longTaskMs: 0,
    requests: 0,
    duplicateRequests: 0,
    transferredBytes: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheStale: 0,
  };
  const { recorder, advance } = harness({ contention: { sample: () => ({ ...counters }) } });
  const before = recorder.begin("tab-input-to-visible");
  counters = { ...counters, longTaskMs: 12, requests: 3, duplicateRequests: 1, cacheHits: 2 };
  advance(40);
  const record = before.end("usable");
  assert.deepEqual(record.contention, {
    longTaskMs: 12,
    requests: 3,
    duplicateRequests: 1,
    transferredBytes: 0,
    cacheHits: 2,
    cacheMisses: 0,
    cacheStale: 0,
  });

  // Work that happened before this interaction opened belongs to the last one.
  counters = { ...counters, longTaskMs: 30 };
  const after = recorder.begin("tab-input-to-visible");
  advance(10);
  assert.equal(after.end("usable").contention.longTaskMs, 0);
});

test("retention is bounded and drops the oldest records first", () => {
  const { recorder } = harness({ limit: 3 });
  for (let index = 0; index < 6; index += 1) {
    recorder.begin("tab-input-to-visible").end("usable");
  }
  const kept = recorder.completed();
  assert.equal(kept.length, 3);
  assert.deepEqual(
    kept.map((record) => record.id),
    ["i4", "i5", "i6"],
  );
});

test("percentiles report a value that actually happened", () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  assert.equal(percentile([5], 0.95), 5);
  assert.ok(Number.isNaN(percentile([], 0.5)));
});

test("the report names the milestones that miss their budget", () => {
  const { recorder, advance } = harness();
  recorder.begin("tab-input-to-visible").end("usable"); // cold
  for (const duration of [40, 260, 45]) {
    const warm = recorder.begin("tab-input-to-visible");
    advance(duration);
    warm.end("usable");
  }
  const report = summarizeInteractions(recorder.completed());
  assert.deepEqual(
    report.overBudget.map((miss) => [miss.feature, miss.budgetMs]),
    [["tab-input-to-visible", 100]],
  );
  const text = formatPerformanceReport(report);
  assert.match(text, /OVER BUDGET tab-input-to-visible/u);
  assert.match(text, /budget p95 100ms/u);
});

test("an empty run says so instead of reporting zeros", () => {
  assert.equal(
    formatPerformanceReport(summarizeInteractions([])),
    "No interactions recorded.",
  );
});
