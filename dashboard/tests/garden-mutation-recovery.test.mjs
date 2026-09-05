import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(dashboardRoot, "src");
process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
await import("../scripts/learn-worker-import-hook.mjs");
const {
  acquireGardenMutationLease,
  INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
} = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "garden-mutation-lease.ts")).href
);
const { acquireGardenMutationLeaseWithIngestionRecovery } = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "garden-mutation-recovery.ts"))
    .href
);
const { readGardenLearnLock } = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "learn-atomic-promotion.ts")).href
);

function fixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const dataRoot = path.join(root, "data");
  const contentPath = path.join(root, "content");
  const clusterSlug = "garden";
  const clusterDir = path.join(contentPath, clusterSlug);
  fs.mkdirSync(clusterDir, { recursive: true });
  return { root, dataRoot, contentPath, clusterSlug, clusterDir };
}

test("an ordinary edit recovers an expired ingestion lease before retrying", () => {
  const input = fixture("garden-expired-ingestion-recovery");
  const started = Date.now() - INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS - 1;
  const ingestion = acquireGardenMutationLease(
    input.clusterDir,
    "document-ingestion",
    {
      ownerId: "job_expired",
      now: () => started,
      processBoundStaleMs: INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
    },
  );

  try {
    const edit = acquireGardenMutationLeaseWithIngestionRecovery({
      ...input,
      operation: "create-folder",
    });
    assert.equal(edit.lock.jobId.startsWith("mutation:create-folder:"), true);
    assert.equal(ingestion.release(), false);
    assert.equal(edit.release(), true);
    assert.equal(readGardenLearnLock(input.clusterDir), null);
  } finally {
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("an ordinary edit keeps waiting when the ingestion owner is live", () => {
  const input = fixture("garden-live-ingestion-recovery");
  const ingestion = acquireGardenMutationLease(
    input.clusterDir,
    "document-ingestion",
    {
      ownerId: "job_live",
      processBoundStaleMs: INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
    },
  );

  try {
    assert.throws(
      () =>
        acquireGardenMutationLeaseWithIngestionRecovery({
          ...input,
          operation: "create-folder",
        }),
      (error) => error?.code === "GARDEN_MUTATION_BUSY",
    );
    assert.equal(
      readGardenLearnLock(input.clusterDir)?.leaseId,
      ingestion.lock.leaseId,
    );
  } finally {
    ingestion.release();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});
