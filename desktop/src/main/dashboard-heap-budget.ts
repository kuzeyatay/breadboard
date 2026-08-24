import * as os from "node:os";
import {
  MEMORY_ENV,
  MIB,
  resolveMemoryPolicy,
  type MemoryPolicy,
} from "./memory-policy";

export const MIN_DASHBOARD_HEAP_MB = 512;
export const MAX_DASHBOARD_HEAP_MB = 16384;
export const SYSTEM_RESERVE_MB = 8192;
export const DASHBOARD_SHARE_OF_REMAINDER = 0.18;
export const MIN_OVERRIDE_MB = MIN_DASHBOARD_HEAP_MB;
export const MAX_OVERRIDE_MB = MAX_DASHBOARD_HEAP_MB;
export const DASHBOARD_HEAP_OVERRIDE_ENV = MEMORY_ENV.dashboardHeapMb;
export const LEGACY_DASHBOARD_HEAP_OVERRIDE_ENV = "BREADBOARD_DASHBOARD_MAX_OLD_SPACE_MB";

export interface DashboardHeapBudgetInput {
  totalMemoryBytes: number;
  /** Optional commit limit; physical * 1.32 is used only for legacy callers. */
  commitLimitBytes?: number;
  override?: string | undefined;
}

/** Strict parser retained as a small testable unit. */
export function parseHeapOverrideMb(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(
      `${DASHBOARD_HEAP_OVERRIDE_ENV} must be a whole number between ` +
        `${MIN_OVERRIDE_MB} and ${MAX_OVERRIDE_MB}.`,
    );
  }
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < MIN_OVERRIDE_MB || value > MAX_OVERRIDE_MB) {
    throw new Error(
      `${DASHBOARD_HEAP_OVERRIDE_ENV} must be between ` +
        `${MIN_OVERRIDE_MB} and ${MAX_OVERRIDE_MB}.`,
    );
  }
  return value;
}

export function resolveDashboardHeapBudgetMb(input: DashboardHeapBudgetInput): number {
  const physicalTotalMb = Math.floor(input.totalMemoryBytes / MIB);
  const commitLimitMb = Math.floor(
    (input.commitLimitBytes ?? input.totalMemoryBytes * 1.32) / MIB,
  );
  return resolveMemoryPolicy({
    physicalTotalMb,
    commitLimitMb,
    env: input.override === undefined
      ? {}
      : { [DASHBOARD_HEAP_OVERRIDE_ENV]: input.override },
  }).dashboardDevHeapMb;
}

const OLD_SPACE_FLAG = /^--max[-_]old[-_]space[-_]size(=|$)/;

/** Replace every inherited old-space flag and preserve unrelated options. */
export function applyMaxOldSpaceSize(inherited: string | undefined, budgetMb: number): string {
  const tokens = (inherited ?? "").trim().split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!OLD_SPACE_FLAG.test(token)) {
      kept.push(token);
      continue;
    }
    if (!token.includes("=") && /^\d+$/.test(tokens[index + 1] ?? "")) index += 1;
  }
  kept.push(`--max-old-space-size=${budgetMb}`);
  return kept.join(" ");
}

export function dashboardDevNodeOptions(
  inherited: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  totalMemoryBytes: number = os.totalmem(),
  resolvedPolicy?: MemoryPolicy,
): string {
  let policy = resolvedPolicy;
  if (!policy) {
    const selected = env[DASHBOARD_HEAP_OVERRIDE_ENV] ?? env[LEGACY_DASHBOARD_HEAP_OVERRIDE_ENV];
    policy = resolveMemoryPolicy({
      physicalTotalMb: Math.floor(totalMemoryBytes / MIB),
      commitLimitMb: Math.floor((totalMemoryBytes * 1.32) / MIB),
      env: selected === undefined
        ? env
        : { ...env, [DASHBOARD_HEAP_OVERRIDE_ENV]: selected },
    });
  }
  return applyMaxOldSpaceSize(inherited, policy.dashboardDevHeapMb);
}
