import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  promoteStagingGarden,
  type AtomicPromotionResult,
  type GardenLearnLease,
} from "./learn-atomic-promotion.ts";

export interface DetachedGardenMutation {
  temporaryRoot: string;
  stagingGardenDir: string;
  sourceFingerprint: string;
}

/**
 * Hash the complete published garden, including generated artifacts and their
 * active pointers. The fenced lease keeps legitimate writers out; this hash is
 * the final optimistic check against legacy or otherwise unfenced writers.
 */
export function fingerprintPublishedGarden(gardenDir: string): string {
  const root = path.resolve(gardenDir);
  const records: string[] = [];

  const visit = (directory: string, relative = ""): void => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relative
        ? `${relative}/${entry.name}`
        : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        records.push(`directory\0${relativePath}`);
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        records.push(
          `file\0${relativePath}\0${crypto
            .createHash("sha256")
            .update(fs.readFileSync(absolutePath))
            .digest("hex")}`,
        );
      } else {
        throw new Error(
          `Garden contains an unsupported filesystem entry: ${relativePath}`,
        );
      }
    }
  };

  visit(root);
  return crypto.createHash("sha256").update(records.join("\n")).digest("hex");
}

/** Clone a live garden without exposing any candidate writes to readers. */
export function createDetachedGardenMutation(
  gardenDir: string,
  operationName: string,
): DetachedGardenMutation {
  const sourceFingerprint = fingerprintPublishedGarden(gardenDir);
  const safeOperationName =
    operationName.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") ||
    "mutation";
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `breadboard-${safeOperationName}-`),
  );
  const stagingGardenDir = path.join(temporaryRoot, path.basename(gardenDir));

  try {
    fs.cpSync(gardenDir, stagingGardenDir, { recursive: true, force: true });
    if (fingerprintPublishedGarden(stagingGardenDir) !== sourceFingerprint) {
      throw new Error(
        "The garden changed while its detached mutation candidate was being prepared.",
      );
    }
    return { temporaryRoot, stagingGardenDir, sourceFingerprint };
  } catch (error) {
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch {
      // The original exception remains authoritative.
    }
    throw error;
  }
}

/**
 * Publish one complete candidate tree. A lost/uncertain fenced lease or any
 * live-tree drift rejects the candidate before the destination is renamed.
 */
export async function promoteDetachedGardenMutation(input: {
  mutation: DetachedGardenMutation;
  destinationGardenDir: string;
  lease: GardenLearnLease;
  recoveryOwnerId: string;
  verifyCandidate?: (candidateGardenDir: string) => boolean;
}): Promise<AtomicPromotionResult> {
  return promoteStagingGarden({
    stagingGardenDir: input.mutation.stagingGardenDir,
    destinationGardenDir: input.destinationGardenDir,
    recoveryOwnerId: input.recoveryOwnerId,
    verifyCurrentDestination: (destinationDir) =>
      input.lease.heartbeat() &&
      fingerprintPublishedGarden(destinationDir) ===
        input.mutation.sourceFingerprint,
    verifyManifest: input.verifyCandidate,
  });
}

/** Best-effort disposal never writes to the live garden. */
export function disposeDetachedGardenMutation(
  mutation: DetachedGardenMutation | undefined,
): void {
  if (!mutation) return;
  try {
    fs.rmSync(mutation.temporaryRoot, { recursive: true, force: true });
  } catch {
    // A detached candidate is never indexed or served. Startup temp cleanup can
    // remove a residue that is still locked by an antivirus/indexer.
  }
}
