import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  acquireGardenMutationLease,
  isGardenMutationBusyError,
  type GardenMutationLease,
} from "./garden-mutation-lease.ts";
import {
  knowledgeWriteTransactionRegistryRoot,
  recoverKnowledgeWriteTransactions,
} from "./knowledge.ts";

function isLiveIngestionRecoveryConflict(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
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
}): GardenMutationLease {
  const clusterDir = path.join(input.contentPath, input.clusterSlug);
  try {
    return acquireGardenMutationLease(clusterDir, input.operation);
  } catch (error) {
    if (
      !isGardenMutationBusyError(error) ||
      !error.conflict.jobId.startsWith("mutation:document-ingestion:")
    ) {
      throw error;
    }

    try {
      const registryRoot = knowledgeWriteTransactionRegistryRoot(
        input.dataRoot,
        input.contentPath,
        input.clusterSlug,
      );
      recoverKnowledgeWriteTransactions(
        input.contentPath,
        input.clusterSlug,
        registryRoot,
        path.join(input.dataRoot, "runtime", "jobs"),
      );
    } catch (recoveryError) {
      if (isLiveIngestionRecoveryConflict(recoveryError)) throw error;
      throw recoveryError;
    }

    return acquireGardenMutationLease(clusterDir, input.operation);
  }
}
