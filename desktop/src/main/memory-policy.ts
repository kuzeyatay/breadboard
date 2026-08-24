import * as os from "node:os";

export const MIB = 1024 * 1024;

export const MEMORY_ENV = {
  dashboardHeapMb: "BREADBOARD_DASHBOARD_DEV_HEAP_MB",
  dashboardSoftMb: "BREADBOARD_DASHBOARD_TREE_SOFT_LIMIT_MB",
  dashboardHardMb: "BREADBOARD_DASHBOARD_TREE_HARD_LIMIT_MB",
  minFreeCommitMb: "BREADBOARD_MIN_FREE_COMMIT_MB",
  criticalFreeCommitMb: "BREADBOARD_CRITICAL_FREE_COMMIT_MB",
  sampleIntervalMs: "BREADBOARD_MEMORY_SAMPLE_INTERVAL_MS",
} as const;

export interface SystemMemorySnapshot {
  sampledAt: number;
  commitTotalMb: number;
  commitLimitMb: number;
  physicalTotalMb: number;
  physicalAvailableMb: number;
  /** Optional attribution supplied by the QA/native provider. */
  dockerWslCommitMb?: number;
}

export interface MemoryPolicy {
  dashboardDevHeapMb: number;
  dashboardTreeSoftLimitMb: number;
  dashboardTreeHardLimitMb: number;
  minFreeCommitMb: number;
  criticalFreeCommitMb: number;
  emergencyFreeCommitMb: number;
  sampleIntervalMs: number;
  recoveryHysteresisMb: number;
}

export interface ResolveMemoryPolicyInput {
  physicalTotalMb: number;
  commitLimitMb: number;
  env?: NodeJS.ProcessEnv;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.round(value)));
}

function plainInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  bounds: { min: number; max: number },
): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`${key} must be a whole number between ${bounds.min} and ${bounds.max}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(`${key} must be between ${bounds.min} and ${bounds.max}.`);
  }
  return parsed;
}

/**
 * Resolve every desktop memory threshold together.
 *
 * A 32 GiB / ~41 GiB-commit machine lands near 6144 / 11264 / 13312 MiB for
 * dashboard heap/soft/hard, while smaller machines scale down and retain an
 * explicit OS/application reserve. Environment overrides are strict: a typo
 * must stop startup with the exact bad key rather than silently reinstating an
 * unsafe inherited policy.
 */
export function resolveMemoryPolicy(input: ResolveMemoryPolicyInput): MemoryPolicy {
  const env = input.env ?? process.env;
  if (!Number.isFinite(input.physicalTotalMb) || input.physicalTotalMb < 2048) {
    throw new Error("Detected physical memory is invalid or below 2048 MB.");
  }
  if (!Number.isFinite(input.commitLimitMb) || input.commitLimitMb < 3072) {
    throw new Error("Detected Windows commit limit is invalid or below 3072 MB.");
  }

  const physical = Math.floor(input.physicalTotalMb);
  const commit = Math.floor(input.commitLimitMb);
  const minFreeDefault = clamp(commit * 0.2, 1536, 12288);
  const criticalDefault = clamp(commit * 0.1, 768, 6144);
  const emergencyDefault = clamp(commit * 0.05, 512, 3072);

  const minFreeCommitMb =
    plainInteger(env, MEMORY_ENV.minFreeCommitMb, { min: 1024, max: 32768 }) ??
    minFreeDefault;
  const criticalFreeCommitMb =
    plainInteger(env, MEMORY_ENV.criticalFreeCommitMb, { min: 512, max: 16384 }) ??
    criticalDefault;
  if (criticalFreeCommitMb >= minFreeCommitMb) {
    throw new Error(
      `${MEMORY_ENV.criticalFreeCommitMb} (${criticalFreeCommitMb}) must be lower than ` +
        `${MEMORY_ENV.minFreeCommitMb} (${minFreeCommitMb}).`,
    );
  }

  const usableCommit = Math.max(1024, commit - minFreeCommitMb);
  const heapDefault = clamp(
    Math.min(physical * 0.1875, usableCommit * 0.185),
    1024,
    6144,
  );
  const heap =
    plainInteger(env, MEMORY_ENV.dashboardHeapMb, { min: 512, max: 16384 }) ??
    heapDefault;
  const softDefault = clamp(
    Math.min(physical * 0.35, usableCommit * 0.34, heap + 5120),
    heap + 1024,
    11264,
  );
  const soft =
    plainInteger(env, MEMORY_ENV.dashboardSoftMb, { min: 1024, max: 24576 }) ??
    softDefault;
  const hardDefault = clamp(
    Math.min(physical * 0.416, usableCommit * 0.4, soft + 2048),
    soft + 512,
    13312,
  );
  const hard =
    plainInteger(env, MEMORY_ENV.dashboardHardMb, { min: 1536, max: 28672 }) ??
    hardDefault;

  if (!(heap < soft && soft < hard)) {
    throw new Error(
      `Dashboard memory limits must satisfy heap < soft < hard; resolved ` +
        `${heap} < ${soft} < ${hard} MB.`,
    );
  }
  if (hard + minFreeCommitMb > commit) {
    throw new Error(
      `Dashboard hard limit (${hard} MB) plus the free-commit reserve ` +
        `(${minFreeCommitMb} MB) exceeds the detected commit limit (${commit} MB).`,
    );
  }

  const sampleIntervalMs =
    plainInteger(env, MEMORY_ENV.sampleIntervalMs, { min: 1000, max: 300000 }) ??
    15000;

  return {
    dashboardDevHeapMb: heap,
    dashboardTreeSoftLimitMb: soft,
    dashboardTreeHardLimitMb: hard,
    minFreeCommitMb,
    criticalFreeCommitMb,
    emergencyFreeCommitMb: Math.min(emergencyDefault, criticalFreeCommitMb - 256),
    sampleIntervalMs,
    recoveryHysteresisMb: clamp(commit * 0.015, 256, 1024),
  };
}

export function policyFromSnapshot(
  snapshot: Pick<SystemMemorySnapshot, "physicalTotalMb" | "commitLimitMb">,
  env: NodeJS.ProcessEnv = process.env,
): MemoryPolicy {
  return resolveMemoryPolicy({ ...snapshot, env });
}

/** Physical-only fallback used before the Windows native metric source exists. */
export function fallbackMemoryPolicy(env: NodeJS.ProcessEnv = process.env): MemoryPolicy {
  const physicalTotalMb = Math.floor(os.totalmem() / MIB);
  // A conservative fallback: never assume more commit than physical memory.
  return resolveMemoryPolicy({ physicalTotalMb, commitLimitMb: physicalTotalMb, env });
}

export function freeCommitMb(snapshot: SystemMemorySnapshot): number {
  return Math.max(0, snapshot.commitLimitMb - snapshot.commitTotalMb);
}

export function sanitizedPolicySummary(policy: MemoryPolicy): Record<string, number> {
  return {
    dashboardDevHeapMb: policy.dashboardDevHeapMb,
    dashboardTreeSoftLimitMb: policy.dashboardTreeSoftLimitMb,
    dashboardTreeHardLimitMb: policy.dashboardTreeHardLimitMb,
    minFreeCommitMb: policy.minFreeCommitMb,
    criticalFreeCommitMb: policy.criticalFreeCommitMb,
    emergencyFreeCommitMb: policy.emergencyFreeCommitMb,
    sampleIntervalMs: policy.sampleIntervalMs,
  };
}
