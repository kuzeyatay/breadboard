import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
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
  acquireGardenLearnLease,
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
const {
  createKnowledgeWriteTransaction,
  knowledgeWriteTransactionRegistryRoot,
  recoverKnowledgeWriteTransactions,
} = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "knowledge-write-transaction.ts")).href
);

function fixture(name, clusterSlug = "garden") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const dataRoot = path.join(root, "data");
  const contentPath = path.join(root, "content");
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

test("a live long-running ingestion keeps its lease beyond the former three-hour bound", () => {
  const input = fixture("garden-long-running-ingestion");
  const started = Date.now() - 3 * 60 * 60 * 1000 - 1;
  const ingestion = acquireGardenMutationLease(
    input.clusterDir,
    "document-ingestion",
    {
      ownerId: "job_long_running",
      now: () => started,
      processBoundStaleMs: INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
    },
  );

  try {
    assert.equal(
      INGESTION_GARDEN_MUTATION_PROCESS_BOUND_MS,
      24 * 60 * 60 * 1000,
    );
    assert.throws(
      () => acquireGardenMutationLease(input.clusterDir, "update-document"),
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

function crashedIngestion(input, state = "active", canonicalStore = false) {
  // Use a non-default store to prove that recovery follows the owning lease,
  // instead of guessing a Garden-specific or process-working-directory path.
  const registryRoot = canonicalStore
    ? knowledgeWriteTransactionRegistryRoot(input.dataRoot, input.contentPath, input.clusterSlug)
    : path.join(input.root, "custom-journals");
  const runtimeJobsRoot = canonicalStore
    ? path.join(input.dataRoot, "runtime", "jobs")
    : path.join(input.root, "custom-jobs");
  const transactionId = "job_crashed_writer";
  const target = path.join(input.clusterDir, "note.md");
  fs.writeFileSync(target, "original\n");
  const moduleUrl = pathToFileURL(path.join(sourceRoot, "lib", "knowledge-write-transaction.ts")).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs';
    import path from 'node:path';
    import { createHash } from 'node:crypto';
    const { createKnowledgeWriteTransaction } = await import(${JSON.stringify(moduleUrl)});
    const resultPath = path.join(${JSON.stringify(runtimeJobsRoot)}, ${JSON.stringify(transactionId)}, 'result.json');
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    const transaction = createKnowledgeWriteTransaction(
      ${JSON.stringify(input.contentPath)}, ${JSON.stringify(input.clusterSlug)},
      { registryRoot: ${JSON.stringify(registryRoot)}, transactionId: ${JSON.stringify(transactionId)}, resultPath },
    );
    transaction.captureFile(${JSON.stringify(target)});
    fs.writeFileSync(${JSON.stringify(target)}, ${JSON.stringify("ingested\n")});
    if (${JSON.stringify(state)} === 'committed') {
      const bytes = Buffer.from('completed result');
      transaction.prepareResult(createHash('sha256').update(bytes).digest('hex'));
      fs.writeFileSync(resultPath, bytes);
      transaction.commit();
    }
    process.exit(0);
  `], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { registryRoot, runtimeJobsRoot, transactionId, target };
}

for (const [slug, operation] of [
  ["physics-notes", "update-source-pdf"],
  ["biology-lab", "update-document"],
  ["a-new-garden", "add-garden-link"],
]) {
  test(`the common ${operation} path recovers a crashed writer in ${slug}`, () => {
    const input = fixture("garden-shared-recovery", slug);
    let edit;
    try {
      const crash = crashedIngestion(input);
      const oldToken = readGardenLearnLock(input.clusterDir).leaseId;
      edit = acquireGardenMutationLease(input.clusterDir, operation);
      assert.notEqual(edit.lock.leaseId, oldToken);
      assert.equal(fs.readFileSync(crash.target, "utf8"), "original\n");
      fs.writeFileSync(crash.target, "user edit after recovery\n");
      assert.equal(edit.release(), true);
      assert.deepEqual(recoverKnowledgeWriteTransactions(
        input.contentPath, input.clusterSlug, crash.registryRoot, crash.runtimeJobsRoot,
      ), []);
      assert.equal(fs.readFileSync(crash.target, "utf8"), "user edit after recovery\n");
    } finally {
      edit?.release();
      fs.rmSync(input.root, { recursive: true, force: true });
    }
  });
}

test("Learn publication recovers a committed ingestion without rolling it back", () => {
  const input = fixture("garden-learn-crash-recovery", "learning-garden");
  let result;
  try {
    const crash = crashedIngestion(input, "committed");
    result = acquireGardenLearnLease(input.clusterDir, {
      gardenSlug: input.clusterSlug, jobId: "learn-new", buildId: "learn-build-new",
    });
    assert.equal(result.acquired, true);
    assert.equal(fs.readFileSync(crash.target, "utf8"), "ingested\n");
    assert.equal(result.lease.release(), true);
    assert.equal(readGardenLearnLock(input.clusterDir), null);
  } finally {
    if (result?.acquired) result.lease.release();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("legacy locks recover from the configured data root for any Garden", () => {
  const input = fixture("garden-legacy-data-root", "existing-garden");
  const previousDataDir = process.env.BREADBOARD_DATA_DIR;
  let edit;
  try {
    const crash = crashedIngestion(input, "active", true);
    const lock = readGardenLearnLock(input.clusterDir);
    delete lock.ingestionRecovery;
    fs.writeFileSync(
      path.join(input.contentPath, `.${input.clusterSlug}.learn-build.lock.json`),
      JSON.stringify(lock),
    );
    process.env.BREADBOARD_DATA_DIR = input.dataRoot;
    edit = acquireGardenMutationLease(input.clusterDir, "update-document");
    assert.equal(fs.readFileSync(crash.target, "utf8"), "original\n");
    assert.equal(edit.release(), true);
  } finally {
    edit?.release();
    if (previousDataDir === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = previousDataDir;
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("a busy Garden does not block another Garden or replace a live writer", () => {
  const input = fixture("garden-live-write-isolation", "busy-garden");
  const other = path.join(input.contentPath, "other-garden");
  const resultPath = path.join(input.root, "jobs", "job_live", "result.json");
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.mkdirSync(other);
  const transaction = createKnowledgeWriteTransaction(input.contentPath, input.clusterSlug, {
    registryRoot: path.join(input.root, "registry"), transactionId: "job_live", resultPath,
  });
  const token = readGardenLearnLock(input.clusterDir).leaseId;
  try {
    assert.throws(() => acquireGardenMutationLease(input.clusterDir, "update-document"),
      (error) => error?.code === "GARDEN_MUTATION_BUSY");
    assert.equal(acquireGardenLearnLease(input.clusterDir, {
      gardenSlug: input.clusterSlug, jobId: "learn", buildId: "build",
    }).acquired, false);
    assert.equal(readGardenLearnLock(input.clusterDir).leaseId, token);
    const otherLease = acquireGardenMutationLease(other, "update-source-pdf");
    assert.equal(otherLease.release(), true);
  } finally {
    transaction.rollback();
    fs.rmSync(input.root, { recursive: true, force: true });
  }
});

test("failed journal recovery keeps subsequent writes fenced", () => {
  const input = fixture("garden-corrupt-journal", "damaged-garden");
  try {
    const crash = crashedIngestion(input);
    const journalPath = path.join(crash.registryRoot, crash.transactionId, "journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.entries[0].relativePath = "../outside.md";
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    assert.throws(() => acquireGardenMutationLease(input.clusterDir, "update-document"));
    assert.equal(fs.readFileSync(crash.target, "utf8"), "ingested\n");
    assert.ok(readGardenLearnLock(input.clusterDir));
    assert.throws(() => acquireGardenMutationLease(input.clusterDir, "update-source-pdf"),
      (error) => error?.code === "GARDEN_MUTATION_BUSY");
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
