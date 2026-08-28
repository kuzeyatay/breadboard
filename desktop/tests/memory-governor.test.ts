import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MemoryGovernor,
  ResourceExhaustionError,
  type SystemMemoryMetricSource,
} from "../src/main/memory-governor";
import type { MemoryPolicy, SystemMemorySnapshot } from "../src/main/memory-policy";

const policy: MemoryPolicy = {
  dashboardDevHeapMb: 6_144,
  dashboardTreeSoftLimitMb: 11_264,
  dashboardTreeHardLimitMb: 13_312,
  minFreeCommitMb: 8_000,
  criticalFreeCommitMb: 4_000,
  emergencyFreeCommitMb: 2_000,
  sampleIntervalMs: 15_000,
  recoveryHysteresisMb: 500,
};

function snapshot(freeMb: number): SystemMemorySnapshot {
  return {
    sampledAt: Date.now(),
    commitTotalMb: 42_000 - freeMb,
    commitLimitMb: 42_000,
    physicalTotalMb: 32_000,
    physicalAvailableMb: 4_000,
  };
}

class FakeMetrics implements SystemMemoryMetricSource {
  value = snapshot(20_000);
  async sample(): Promise<SystemMemorySnapshot> { return this.value; }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class ControlledMetrics implements SystemMemoryMetricSource {
  readonly samples: Deferred<SystemMemorySnapshot>[] = [];

  sample(): Promise<SystemMemorySnapshot> {
    const next = deferred<SystemMemorySnapshot>();
    this.samples.push(next);
    return next.promise;
  }
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("governor transitions use free commit and recover with hysteresis", async () => {
  const metrics = new FakeMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  assert.equal(governor.stateFor(snapshot(9_000)), "normal");
  assert.equal(governor.stateFor(snapshot(7_999), "normal"), "constrained");
  assert.equal(governor.stateFor(snapshot(3_999), "constrained"), "critical");
  assert.equal(governor.stateFor(snapshot(1_999), "critical"), "emergency");
  assert.equal(governor.stateFor(snapshot(8_200), "constrained"), "constrained");
  assert.equal(governor.stateFor(snapshot(8_500), "constrained"), "normal");

  metrics.value = snapshot(7_000);
  await governor.refresh();
  assert.equal(governor.state, "constrained");
});

test("concurrent refresh callers await one shared in-flight sample", async () => {
  const metrics = new ControlledMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  const prime = governor.refresh();
  const cached = snapshot(8_500);
  metrics.samples[0]!.resolve(cached);
  assert.strictEqual(await prime, cached);

  const first = governor.refresh();
  let secondSettled = false;
  const second = governor.refresh();
  void second.then(() => { secondSettled = true; });

  assert.equal(metrics.samples.length, 2);
  await nextTurn();
  assert.equal(secondSettled, false);
  const fresh = snapshot(12_000);
  metrics.samples[1]!.resolve(fresh);
  assert.strictEqual(await first, fresh);
  assert.strictEqual(await second, fresh);
  assert.strictEqual(governor.snapshot, fresh);
});

test("causal refresh drains the current sample then coalesces one subsequent sample", async () => {
  const metrics = new ControlledMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  const olderRefresh = governor.refresh();
  const firstFreshRefresh = governor.refresh({ afterCurrentSample: true });
  const secondFreshRefresh = governor.refresh({ afterCurrentSample: true });

  assert.equal(metrics.samples.length, 1);
  const older = snapshot(5_000);
  metrics.samples[0]!.resolve(older);
  assert.strictEqual(await olderRefresh, older);
  await nextTurn();
  assert.equal(metrics.samples.length, 2);

  const newer = snapshot(13_000);
  metrics.samples[1]!.resolve(newer);
  assert.strictEqual(await firstFreshRefresh, newer);
  assert.strictEqual(await secondFreshRefresh, newer);
  assert.strictEqual(governor.snapshot, newer);
});

test("a failed excluded sample does not replace the required subsequent sample", async () => {
  const metrics = new ControlledMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  const olderRefresh = governor.refresh();
  const olderFailure = assert.rejects(olderRefresh, /stale sampler failed/);
  const freshRefresh = governor.refresh({ afterCurrentSample: true });

  metrics.samples[0]!.reject(new Error("stale sampler failed"));
  await olderFailure;
  await nextTurn();
  assert.equal(metrics.samples.length, 2);

  const newer = snapshot(14_000);
  metrics.samples[1]!.resolve(newer);
  assert.strictEqual(await freshRefresh, newer);
});

test("admission ignores a periodic sample begun during the preceding serialized startup", async () => {
  const metrics = new ControlledMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  const request = {
    id: "serialized-start",
    estimatedColdStartCommitMb: 2_000,
    priority: 90,
    required: false,
  };

  const firstAdmission = governor.admit(request);
  metrics.samples[0]!.resolve(snapshot(12_000));
  await firstAdmission;

  // This periodic sample starts while the first admitted service is still
  // reaching readiness. The next serialized admission must not use it because
  // it cannot include the preceding startup's final commit footprint.
  const stalePeriodicRefresh = governor.refresh();
  const nextAdmission = governor.admit(request);
  const denial = assert.rejects(
    nextAdmission,
    (error: unknown) => {
      assert.ok(error instanceof ResourceExhaustionError);
      assert.equal(error.result.denialReason, "headroom");
      assert.equal(error.result.availableHeadroomMb, 9_000);
      return true;
    },
  );

  metrics.samples[1]!.resolve(snapshot(20_000));
  await stalePeriodicRefresh;
  await nextTurn();
  assert.equal(metrics.samples.length, 3);

  metrics.samples[2]!.resolve(snapshot(9_000));
  await denial;
});

test("admission preserves the reserve and returns a structured terminal result", async () => {
  const metrics = new FakeMetrics();
  metrics.value = snapshot(9_000);
  const governor = new MemoryGovernor({ policy, metrics });
  await assert.rejects(
    () => governor.admit({
      id: "model",
      estimatedColdStartCommitMb: 2_000,
      priority: 50,
      required: false,
      concurrencyGroup: "local-model",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResourceExhaustionError);
      assert.deepEqual(error.result, {
        code: "BREADBOARD_RESOURCE_EXHAUSTED",
        resource: "windows_commit",
        denialReason: "headroom",
        requiredHeadroomMb: 10_000,
        availableHeadroomMb: 9_000,
        reserveHeadroomMb: 8_000,
        incomingEstimateMb: 2_000,
        overlapHeadroomMb: 0,
        retryable: false,
        state: "normal",
      });
      return true;
    },
  );
});

test("active heavyweight groups do not impose a static admission limit", async () => {
  const metrics = new FakeMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  metrics.value = snapshot(40_000);
  const cases = [
    {
      id: "unequal-estimate",
      estimatedColdStartCommitMb: 250,
      concurrencyGroup: "browser-automation" as const,
      activeConcurrencyGroups: new Set(["local-model"] as const),
    },
    {
      id: "same-group",
      estimatedColdStartCommitMb: 4_000,
      concurrencyGroup: "browser-automation" as const,
      activeConcurrencyGroups: new Set(["browser-automation"] as const),
    },
    {
      id: "multiple-active-groups",
      estimatedColdStartCommitMb: 1,
      concurrencyGroup: "media-processing" as const,
      activeConcurrencyGroups: new Set(["local-model", "docker-stack"] as const),
    },
  ];

  for (const current of cases) {
    await governor.admit({
      ...current,
      priority: 100,
      required: true,
    });
  }

  await governor.admit({
    id: "no-active-heavyweight",
    estimatedColdStartCommitMb: 4_000,
    priority: 90,
    required: false,
    concurrencyGroup: "browser-automation",
    activeConcurrencyGroups: new Set(),
  });
});

test("critical and emergency states block new optional work", async () => {
  const metrics = new FakeMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  for (const freeMb of [3_500, 1_500]) {
    metrics.value = snapshot(freeMb);
    await assert.rejects(() => governor.admit({
      id: `optional-${freeMb}`,
      estimatedColdStartCommitMb: 0,
      priority: 100,
      required: false,
    }), ResourceExhaustionError);
  }
});

test("bounded foreground work may consume the soft reserve but preserves critical headroom", async () => {
  const metrics = new FakeMetrics();
  const governor = new MemoryGovernor({ policy, metrics });

  // The declared 6,144 MB foreground budget may consume the soft reserve: at
  // 11,000 MB free it leaves 4,856 MB, below the 8,000 MB minimum reserve but
  // still above the 4,000 MB critical floor.
  metrics.value = snapshot(11_000);
  await governor.admit({
    id: "foreground-learn",
    estimatedColdStartCommitMb: 6_144,
    priority: 70,
    required: false,
    reserveFloor: "critical",
    concurrencyGroup: "large-generation",
  });

  metrics.value = snapshot(10_143);
  await assert.rejects(
    () => governor.admit({
      id: "foreground-learn",
      estimatedColdStartCommitMb: 6_144,
      priority: 70,
      required: false,
      reserveFloor: "critical",
      concurrencyGroup: "large-generation",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResourceExhaustionError);
      assert.equal(error.result.requiredHeadroomMb, 10_144);
      assert.equal(error.result.reserveHeadroomMb, 4_000);
      assert.equal(error.result.incomingEstimateMb, 6_144);
      assert.equal(error.result.denialReason, "headroom");
      return true;
    },
  );

  // A critical machine never starts optional work, even if a zero estimate
  // would make the arithmetic fit exactly.
  metrics.value = snapshot(3_500);
  await assert.rejects(() => governor.admit({
    id: "foreground-learn",
    estimatedColdStartCommitMb: 0,
    priority: 100,
    required: false,
    reserveFloor: "critical",
  }), ResourceExhaustionError);
});

test("local soft-limit pressure cannot be bypassed with a critical reserve floor", async () => {
  const metrics = new FakeMetrics();
  metrics.value = snapshot(9_000);
  const governor = new MemoryGovernor({ policy, metrics });
  const foreground = {
    id: "foreground-learn",
    estimatedColdStartCommitMb: 3_000,
    priority: 70,
    required: false,
    reserveFloor: "critical" as const,
    concurrencyGroup: "large-generation" as const,
  };

  await governor.admit(foreground);
  governor.constrainNewHeavyWork();
  await assert.rejects(
    () => governor.admit(foreground),
    (error: unknown) => {
      assert.ok(error instanceof ResourceExhaustionError);
      assert.equal(error.result.state, "constrained");
      assert.equal(error.result.denialReason, "pressure");
      return true;
    },
  );
});

test("interval sampling failures are contained and reported through onError", async () => {
  const failure = new Error("metric source unavailable");
  const observed = deferred<unknown>();
  let governor!: MemoryGovernor;
  const guard = setTimeout(() => observed.resolve(new Error("timed out")), 1_000);
  const metrics: SystemMemoryMetricSource = {
    async sample(): Promise<SystemMemorySnapshot> {
      throw failure;
    },
  };
  governor = new MemoryGovernor({
    policy,
    metrics,
    intervalMs: 1,
    onError: (error) => {
      governor.stop();
      observed.resolve(error);
      throw new Error("diagnostic callback failed");
    },
  });

  governor.start();
  const reported = await observed.promise;
  clearTimeout(guard);
  assert.strictEqual(reported, failure);
  await nextTurn();
});
