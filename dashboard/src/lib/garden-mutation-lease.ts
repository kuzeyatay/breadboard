/**
 * Public entry points for Garden writers. Recovery is part of acquisition, so
 * routes and tools cannot accidentally omit it. Journal recovery itself uses
 * the non-recovering core to avoid recursively acquiring its own fence.
 */
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  acquireGardenLearnLease as acquireUnrecoveredGardenLearnLease,
  type GardenLearnLeaseOptions,
  type GardenLearnLeaseResult,
} from "./learn-atomic-promotion.ts";
import {
  acquireGardenMutationLeaseWithIngestionRecovery,
  recoverGardenIngestionConflict,
} from "./garden-mutation-recovery.ts";
import { dashboardDataDir } from "./runtime-paths.ts";
import type {
  GardenMutationLease,
  GardenMutationLeaseOptions,
} from "./garden-mutation-lease-core.ts";

export {
  assertGardenMutationWritePaths,
  GardenMutationBusyError,
  INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
  isGardenMutationBusyError,
  type GardenMutationLease,
  type GardenMutationLeaseOptions,
} from "./garden-mutation-lease-core.ts";

export function acquireGardenMutationLease(
  gardenDir: string,
  operation: string,
  options: GardenMutationLeaseOptions = {},
): GardenMutationLease {
  const resolvedGarden = path.resolve(gardenDir);
  return acquireGardenMutationLeaseWithIngestionRecovery({
    contentPath: path.dirname(resolvedGarden),
    clusterSlug: path.basename(resolvedGarden),
    dataRoot: dashboardDataDir(),
    operation,
    options,
  });
}

/** Learn and visualization publishers use the same crash recovery as edits. */
export function acquireGardenLearnLease(
  gardenDir: string,
  owner: Parameters<typeof acquireUnrecoveredGardenLearnLease>[1],
  options: GardenLearnLeaseOptions = {},
): GardenLearnLeaseResult {
  const acquired = acquireUnrecoveredGardenLearnLease(gardenDir, owner, options);
  if (
    acquired.acquired ||
    options.resumeLeaseId !== undefined ||
    options.refuseStaleProcessBoundTakeover === false ||
    !recoverGardenIngestionConflict(gardenDir, acquired.conflict)
  ) {
    return acquired;
  }
  return acquireUnrecoveredGardenLearnLease(gardenDir, owner, options);
}

export async function withGardenMutationLease<T>(
  gardenDir: string,
  operation: string,
  action: (lease: GardenMutationLease) => Promise<T> | T,
  options: GardenMutationLeaseOptions = {},
): Promise<T> {
  const lease = acquireGardenMutationLease(gardenDir, operation, options);
  try {
    return await action(lease);
  } finally {
    lease.release();
  }
}
