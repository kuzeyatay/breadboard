import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MEMORY_ENV,
  freeCommitMb,
  resolveMemoryPolicy,
} from "../src/main/memory-policy";

test("the incident-class machine resolves the measured dashboard starting policy", () => {
  const policy = resolveMemoryPolicy({
    physicalTotalMb: 32 * 1024,
    commitLimitMb: 42_283,
    env: {},
  });
  assert.equal(policy.dashboardDevHeapMb, 6_144);
  assert.equal(policy.dashboardTreeSoftLimitMb, 11_264);
  assert.equal(policy.dashboardTreeHardLimitMb, 13_312);
  assert.ok(policy.minFreeCommitMb >= 8 * 1024);
  assert.ok(policy.criticalFreeCommitMb < policy.minFreeCommitMb);
  assert.ok(policy.emergencyFreeCommitMb < policy.criticalFreeCommitMb);
});

test("derived defaults scale down and preserve a committable reserve", () => {
  const machines: Array<[number, number]> = [
    [4_096, 5_500],
    [8_192, 10_240],
    [16_384, 22_000],
  ];
  for (const [physicalTotalMb, commitLimitMb] of machines) {
    const policy = resolveMemoryPolicy({ physicalTotalMb, commitLimitMb, env: {} });
    assert.ok(policy.dashboardDevHeapMb < policy.dashboardTreeSoftLimitMb);
    assert.ok(policy.dashboardTreeSoftLimitMb < policy.dashboardTreeHardLimitMb);
    assert.ok(policy.dashboardTreeHardLimitMb + policy.minFreeCommitMb <= commitLimitMb);
  }
});

test("all memory environment settings are strict and ordering is validated", () => {
  assert.throws(
    () => resolveMemoryPolicy({
      physicalTotalMb: 32_768,
      commitLimitMb: 42_283,
      env: { [MEMORY_ENV.dashboardHeapMb]: "6144mb" },
    }),
    new RegExp(MEMORY_ENV.dashboardHeapMb),
  );
  assert.throws(
    () => resolveMemoryPolicy({
      physicalTotalMb: 32_768,
      commitLimitMb: 42_283,
      env: {
        [MEMORY_ENV.dashboardHeapMb]: "8192",
        [MEMORY_ENV.dashboardSoftMb]: "8192",
        [MEMORY_ENV.dashboardHardMb]: "13312",
      },
    }),
    /heap < soft < hard/,
  );
  assert.throws(
    () => resolveMemoryPolicy({
      physicalTotalMb: 32_768,
      commitLimitMb: 42_283,
      env: {
        [MEMORY_ENV.minFreeCommitMb]: "4096",
        [MEMORY_ENV.criticalFreeCommitMb]: "4096",
      },
    }),
    /must be lower/,
  );
});

test("valid overrides are used exactly and commit headroom is calculated from commit", () => {
  const policy = resolveMemoryPolicy({
    physicalTotalMb: 32_768,
    commitLimitMb: 42_283,
    env: {
      [MEMORY_ENV.dashboardHeapMb]: "5120",
      [MEMORY_ENV.dashboardSoftMb]: "10240",
      [MEMORY_ENV.dashboardHardMb]: "12288",
      [MEMORY_ENV.minFreeCommitMb]: "8192",
      [MEMORY_ENV.criticalFreeCommitMb]: "4096",
      [MEMORY_ENV.sampleIntervalMs]: "5000",
    },
  });
  assert.equal(policy.dashboardDevHeapMb, 5_120);
  assert.equal(policy.dashboardTreeSoftLimitMb, 10_240);
  assert.equal(policy.dashboardTreeHardLimitMb, 12_288);
  assert.equal(policy.sampleIntervalMs, 5_000);
  assert.equal(freeCommitMb({
    sampledAt: 0,
    commitTotalMb: 36_000,
    commitLimitMb: 42_283,
    physicalTotalMb: 32_768,
    physicalAvailableMb: 4_000,
  }), 6_283);
});
