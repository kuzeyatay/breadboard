import crypto from "node:crypto";
import { externalRuntimePath as path } from "./external-runtime-path.ts";
import {
  acquireGardenLearnLease,
  type GardenLearnLease,
  type GardenLearnLock,
  type GardenLearnLeaseOptions,
} from "./learn-atomic-promotion.ts";

/** Runtime V2 bounds ingestion at two hours; leave one hour for recovery. */
export const INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS = 3 * 60 * 60 * 1000;

export type GardenMutationLease = GardenLearnLease;

export interface GardenMutationLeaseOptions
  extends Pick<
    GardenLearnLeaseOptions,
    "heartbeatIntervalMs" | "now" | "processBoundStaleMs"
  > {
  ownerId?: string;
  /** Only crash-journal recovery may replace a dead process-bound owner. */
  recoverStaleProcessBoundLease?: boolean;
}

export class GardenMutationBusyError extends Error {
  readonly code = "GARDEN_MUTATION_BUSY";
  readonly status = 409;
  readonly conflict: GardenLearnLock;

  constructor(conflict: GardenLearnLock) {
    super("Garden is busy with another write. Try again shortly.");
    this.name = "GardenMutationBusyError";
    this.conflict = conflict;
  }
}

function boundedOwnerField(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[\r\n\0]/g, " ")
    .slice(0, 256);
  return normalized || fallback;
}

/**
 * Acquire the canonical sibling lease used by Learn publication and every
 * ordinary Garden writer. Reads intentionally do not take this lease.
 */
export function acquireGardenMutationLease(
  gardenDir: string,
  operation: string,
  options: GardenMutationLeaseOptions = {},
): GardenMutationLease {
  const resolvedGarden = path.resolve(gardenDir);
  const ownerId = boundedOwnerField(
    options.ownerId ?? crypto.randomUUID(),
    crypto.randomUUID(),
  );
  const acquired = acquireGardenLearnLease(
    resolvedGarden,
    {
      gardenSlug: path.basename(resolvedGarden),
      jobId: `mutation:${boundedOwnerField(operation, "garden-write")}:${ownerId}`,
      buildId: `mutation-${crypto.randomUUID()}`,
    },
    {
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      now: options.now,
      processBoundStaleMs: options.processBoundStaleMs,
      refuseStaleProcessBoundTakeover:
        options.recoverStaleProcessBoundLease !== true,
    },
  );
  if (!acquired.acquired) throw new GardenMutationBusyError(acquired.conflict);
  return acquired.lease;
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

export function isGardenMutationBusyError(
  error: unknown,
): error is GardenMutationBusyError {
  return (
    error instanceof GardenMutationBusyError ||
    (error instanceof Error &&
      "code" in error &&
      error.code === "GARDEN_MUTATION_BUSY")
  );
}
