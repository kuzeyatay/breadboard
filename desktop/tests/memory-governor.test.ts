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
        requiredHeadroomMb: 10_000,
        availableHeadroomMb: 9_000,
        retryable: false,
        state: "normal",
      });
      return true;
    },
  );
});

test("heavyweight overlap is denied unless headroom covers both estimates", async () => {
  const metrics = new FakeMetrics();
  const governor = new MemoryGovernor({ policy, metrics });
  metrics.value = snapshot(15_000);
  await assert.rejects(() => governor.admit({
    id: "browser",
    estimatedColdStartCommitMb: 4_000,
    priority: 90,
    required: false,
    concurrencyGroup: "browser-automation",
    activeConcurrencyGroups: new Set(["local-model"]),
  }), ResourceExhaustionError);

  metrics.value = snapshot(16_000);
  await governor.admit({
    id: "browser",
    estimatedColdStartCommitMb: 4_000,
    priority: 90,
    required: false,
    concurrencyGroup: "browser-automation",
    activeConcurrencyGroups: new Set(["local-model"]),
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
