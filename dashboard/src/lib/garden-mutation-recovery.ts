import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  acquireGardenMutationLease,
  isGardenMutationBusyError,
  type GardenMutationLease,
  type GardenMutationLeaseOptions,
} from "./garden-mutation-lease-core.ts";
import type { GardenLearnLock } from "./learn-atomic-promotion.ts";
import { dashboardDataDir } from "./runtime-paths.ts";
import {
  knowledgeWriteTransactionRegistryRoot,
  recoverKnowledgeWriteTransactions,
} from "./knowledge-write-transaction.ts";

function isLiveIngestionRecoveryConflict(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

/** The recovery routine acquires its own fence before inspecting any journal. */
export function recoverGardenIngestionConflict(
  gardenDir: string,
  conflict: GardenLearnLock,
  dataRoot: string = dashboardDataDir(),
): boolean {
  if (!/^mutation:document-ingestion(?:-recovery|-commit-recovery)?:/.test(conflict.jobId)) {
    return false;
  }
  const resolvedGarden = path.resolve(gardenDir);
  const contentPath = path.dirname(resolvedGarden);
  const clusterSlug = path.basename(resolvedGarden);
  // New owners record the exact journal store. Older locks use the configured
  // dashboard/desktop data root, the same fallback as the ingestion worker.
  const registryRoot = conflict.ingestionRecovery?.registryRoot ??
    knowledgeWriteTransactionRegistryRoot(dataRoot, contentPath, clusterSlug);
  const runtimeJobsRoot = conflict.ingestionRecovery?.runtimeJobsRoot ??
    path.join(dataRoot, "runtime", "jobs");
  try {
    recoverKnowledgeWriteTransactions(contentPath, clusterSlug, registryRoot, runtimeJobsRoot);
    return true;
  } catch (error) {
    if (isLiveIngestionRecoveryConflict(error)) return false;
    throw error;
  }
}

/**
 * Recover a crashed ingestion before admitting an ordinary Garden edit.
 *
 * A live ingestion remains authoritative and produces the original busy
 * response. An expired ingestion is recovered through its rollback journal
 * before this function retries the edit, so a late rollback cannot clobber the
 * user's newer write.
 */
export function acquireGardenMutationLeaseWithIngestionRecovery(input: {
  contentPath: string;
  dataRoot: string;
  clusterSlug: string;
  operation: string;
  options?: GardenMutationLeaseOptions;
}): GardenMutationLease {
  const clusterDir = path.join(input.contentPath, input.clusterSlug);
  try {
    return acquireGardenMutationLease(clusterDir, input.operation, input.options);
  } catch (error) {
    if (
      !isGardenMutationBusyError(error) ||
      input.options?.recoverStaleProcessBoundLease === true
    ) {
      throw error;
    }

    if (!recoverGardenIngestionConflict(clusterDir, error.conflict, input.dataRoot)) throw error;

    return acquireGardenMutationLease(clusterDir, input.operation, input.options);
  }
}
