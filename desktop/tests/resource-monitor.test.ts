import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ResourceMonitor,
  describeBreach,
  treeBytesOf,
  type ProcessMemorySample,
  type ProcessMetricsProvider,
  type ResourceBreach,
  type ServiceResourceBudget,
} from "../src/main/resource-monitor";

const MB = 1024 * 1024;

function budget(overrides: Partial<ServiceResourceBudget> = {}): ServiceResourceBudget {
  return {
    warningBytes: 100 * MB,
    hardLimitBytes: 200 * MB,
    consecutiveSamplesBeforeAction: 3,
    sampleIntervalMs: 60_000,
    ...overrides,
  };
}

/** Provider that replays a scripted series of tree sizes for one pid. */
function scriptedProvider(pid: number, series: number[]): ProcessMetricsProvider {
  let index = 0;
  return {
    async sample(rootPids: number[]): Promise<Map<number, ProcessMemorySample>> {
      const result = new Map<number, ProcessMemorySample>();
      if (!rootPids.includes(pid)) return result;
      const bytes = series[Math.min(index, series.length - 1)] as number;
      index += 1;
      result.set(pid, {
        pid,
        rssBytes: bytes,
        privateBytes: bytes,
        descendantCount: 2,
        treeRssBytes: bytes,
        treePrivateBytes: bytes,
        sampledAt: Date.now(),
      });
      return result;
    },
  };
}

function collector(): { breaches: ResourceBreach[]; onBreach: (breach: ResourceBreach) => void } {
  const breaches: ResourceBreach[] = [];
  return { breaches, onBreach: (breach) => breaches.push(breach) };
}

test("a single transient spike produces no action", async () => {
  const { breaches, onBreach } = collector();
  // One sample far above the hard limit, then back to normal.
  const monitor = new ResourceMonitor({
    provider: scriptedProvider(1, [10 * MB, 900 * MB, 10 * MB, 10 * MB, 10 * MB]),
    onBreach,
    intervalMs: 3_600_000,
  });
  monitor.watch("spiky", 1, budget());
  for (let i = 0; i < 5; i += 1) await monitor.tick();
  assert.deepEqual(breaches, [], "one spike must not trip a 3-sample threshold");
  monitor.stop();
});

test("a warning is emitted only after the configured sustained threshold", async () => {
  const { breaches, onBreach } = collector();
  const monitor = new ResourceMonitor({
    provider: scriptedProvider(2, [150 * MB]),
    onBreach,
    intervalMs: 3_600_000,
  });
  monitor.watch("warn", 2, budget());

  await monitor.tick();
  assert.equal(breaches.length, 0, "1 of 3 samples");
  await monitor.tick();
  assert.equal(breaches.length, 0, "2 of 3 samples");
  await monitor.tick();
  assert.equal(breaches.length, 1, "3rd consecutive sample warns");
  assert.equal(breaches[0]?.kind, "warning");
  assert.equal(breaches[0]?.consecutiveSamples, 3);
  monitor.stop();
});

test("hysteresis stops a parked service warning on every sample", async () => {
  const { breaches, onBreach } = collector();
  const monitor = new ResourceMonitor({
    provider: scriptedProvider(3, [150 * MB]),
    onBreach,
    intervalMs: 3_600_000,
  });
  monitor.watch("parked", 3, budget());
  for (let i = 0; i < 20; i += 1) await monitor.tick();
  assert.equal(breaches.length, 1, `expected one warning, got ${breaches.length}`);
  monitor.stop();
});

test("a recovered service can warn again after dropping clear of the threshold", async () => {
  const { breaches, onBreach } = collector();
  const monitor = new ResourceMonitor({
    // over, over, over (warn) -> well under -> over, over, over (warn again)
    provider: scriptedProvider(4, [
      150 * MB, 150 * MB, 150 * MB,
      10 * MB,
      150 * MB, 150 * MB, 150 * MB,
    ]),
    onBreach,
    intervalMs: 3_600_000,
  });
  monitor.watch("recovering", 4, budget());
  for (let i = 0; i < 7; i += 1) await monitor.tick();
  assert.equal(breaches.length, 2);
  assert.ok(breaches.every((breach) => breach.kind === "warning"));
  monitor.stop();
});

test("a sustained hard-limit breach fires once and stops watching the dead pid", async () => {
  const { breaches, onBreach } = collector();
  const monitor = new ResourceMonitor({
    provider: scriptedProvider(5, [500 * MB]),
    onBreach,
    intervalMs: 3_600_000,
  });
  monitor.watch("runaway", 5, budget());
  await monitor.tick();
  await monitor.tick();
  assert.equal(breaches.length, 0, "hard limit also honours the sustained rule");
  await monitor.tick();

  const hard = breaches.filter((breach) => breach.kind === "hard-limit");
  assert.equal(hard.length, 1);
  assert.equal(hard[0]?.consecutiveSamples, 3);
  assert.deepEqual(monitor.watchedServiceIds(), [], "the breached service is unwatched");

  // Further ticks must not re-fire for a service that is being terminated.
  await monitor.tick();
  assert.equal(breaches.filter((breach) => breach.kind === "hard-limit").length, 1);
  monitor.stop();
});

test("a provider that reports nothing usable never triggers an action", async () => {
  const { breaches, onBreach } = collector();
  const monitor = new ResourceMonitor({
    provider: {
      async sample(pids) {
        const result = new Map<number, ProcessMemorySample>();
        for (const pid of pids) {
          // Platform could not measure: no tree figures at all.
          result.set(pid, { pid, descendantCount: 0, sampledAt: Date.now() });
        }
        return result;
      },
    },
    onBreach,
    intervalMs: 3_600_000,
  });
  monitor.watch("unmeasurable", 6, budget());
  for (let i = 0; i < 10; i += 1) await monitor.tick();
  assert.deepEqual(breaches, []);
  monitor.stop();
});

test("a failing provider surfaces the error and takes no action", async () => {
  const { breaches, onBreach } = collector();
  const errors: unknown[] = [];
  const monitor = new ResourceMonitor({
    provider: {
      async sample() {
        throw new Error("powershell unavailable");
      },
    },
    onBreach,
    onError: (error) => errors.push(error),
    intervalMs: 3_600_000,
  });
  monitor.watch("broken", 7, budget());
  await monitor.tick();
  assert.equal(breaches.length, 0);
  assert.equal(errors.length, 1);
  monitor.stop();
});

test("unwatch and stop release every timer and reference", async () => {
  const { onBreach } = collector();
  const monitor = new ResourceMonitor({
    provider: scriptedProvider(8, [500 * MB]),
    onBreach,
    intervalMs: 3_600_000,
  });
  monitor.watch("a", 8, budget());
  monitor.watch("b", 9, budget());
  assert.deepEqual(monitor.watchedServiceIds().sort(), ["a", "b"]);
  monitor.unwatch("a");
  assert.deepEqual(monitor.watchedServiceIds(), ["b"]);
  monitor.stop();
  assert.deepEqual(monitor.watchedServiceIds(), []);
  // After stop, watch() is inert: a stopped monitor must never restart itself.
  monitor.watch("c", 10, budget());
  assert.deepEqual(monitor.watchedServiceIds(), []);
});

test("sample history stays bounded regardless of run length", async () => {
  const seen: number[] = [];
  const monitor = new ResourceMonitor({
    provider: scriptedProvider(11, [150 * MB]),
    onBreach: (breach) => seen.push(breach.trendBytes.length),
    intervalMs: 3_600_000,
  });
  // consecutiveSamplesBeforeAction=1 so every sample past the line reports.
  monitor.watch("long", 11, budget({ consecutiveSamplesBeforeAction: 1, hardLimitBytes: 10 * 1024 * MB }));
  for (let i = 0; i < 200; i += 1) await monitor.tick();
  monitor.stop();
  assert.ok(seen.length > 0);
  assert.ok(Math.max(...seen) <= 12, `history must stay bounded, saw ${Math.max(...seen)}`);
});

test("tree bytes prefer Windows commit over RSS", () => {
  assert.equal(
    treeBytesOf({ pid: 1, descendantCount: 0, sampledAt: 0, treeRssBytes: 10, treePrivateBytes: 20 }),
    20,
  );
  assert.equal(treeBytesOf({ pid: 1, descendantCount: 0, sampledAt: 0, treeRssBytes: 10 }), 10);
  assert.equal(treeBytesOf({ pid: 1, descendantCount: 0, sampledAt: 0 }), undefined);
});

test("the breach diagnostic is bounded and carries no command line or environment", () => {
  const line = describeBreach(
    {
      serviceId: "dashboard",
      kind: "hard-limit",
      sample: {
        pid: 4242,
        descendantCount: 3,
        treePrivateBytes: 11 * 1024 * MB,
        treeRssBytes: 10 * 1024 * MB,
        sampledAt: Date.now(),
      },
      budget: budget({ hardLimitBytes: 10 * 1024 * MB }),
      consecutiveSamples: 3,
      trendBytes: Array.from({ length: 12 }, (_, index) => (index + 1) * 1024 * MB),
    },
    2,
  );
  assert.match(line, /memory hard-limit for "dashboard"/);
  assert.match(line, /pid=4242/);
  assert.match(line, /descendants=3/);
  assert.match(line, /restarts=2/);
  assert.match(line, /trend=/);
  assert.ok(line.length < 400, `diagnostic should stay short, got ${line.length} chars`);
  // Only the trailing six trend points are printed, not the whole ring.
  assert.equal((line.match(/->/g) ?? []).length, 5);
});
