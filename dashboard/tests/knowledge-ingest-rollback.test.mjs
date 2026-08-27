import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceRoot = path.join(dashboardRoot, "src");
process.env.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot;
await import("../scripts/learn-worker-import-hook.mjs");
const {
  createKnowledgeWriteTransaction,
  recoverCommittedKnowledgeWriteTransaction,
  recoverKnowledgeWriteTransactions,
  writeDocumentKnowledge,
} = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "knowledge.ts")).href
);
const { runIngest } = await import(
  pathToFileURL(
    path.join(sourceRoot, "lib", "runtime-v2", "ingest-executor.ts"),
  ).href
);
const { withGardenMutationLease } = await import(
  pathToFileURL(path.join(sourceRoot, "lib", "garden-mutation-lease.ts")).href
);

const ORIGINAL_FILES = new Map([
  [
    "learning/shared-concept.md",
    `---
title: "Shared Concept"
knowledge_type: "learning-page"
breadboardType: "learning_page"
---

# Shared Concept

Original lesson body.
`,
  ],
  ["learning/Topic Overview.md", "original topic overview\n"],
  ["learning/Learning Map.md", "original learning map\n"],
  [".breadboard/planning/Source Map.md", "original source map\n"],
  [".breadboard/planning/Scope Contract.md", "original scope contract\n"],
  ["sources/_index.md", "original sources index\n"],
  ["_index.md", "original garden index\n"],
]);

function createGardenFixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "knowledge-ingest-rollback-"),
  );
  const contentPath = path.join(root, "quartz", "content");
  const clusterSlug = "garden-1";
  const clusterDir = path.join(contentPath, clusterSlug);
  for (const [relativePath, content] of ORIGINAL_FILES) {
    const filePath = path.join(clusterDir, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
  return { root, contentPath, clusterSlug, clusterDir };
}

function extraction() {
  return {
    documentTitle: "New Course Material",
    summary: "A source-grounded summary of the new course material.",
    topics: [
      {
        title: "Shared Concept",
        slug: "shared-concept",
        explanation:
          "New details that would normally be merged into the existing lesson.",
        keyPoints: ["A new grounded point"],
        sourceEvidence: ["New source evidence"],
        locations: ["Page 1"],
        relatedTopics: [],
        tags: ["shared-concept"],
      },
    ],
    relationships: [],
    suggestedTags: ["shared-concept"],
  };
}

function listFiles(root) {
  const results = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else results.push(path.relative(root, absolute).replaceAll("\\", "/"));
    }
  };
  walk(root);
  return results.sort();
}

function assertGardenRestored(clusterDir) {
  assert.deepEqual(listFiles(clusterDir), [...ORIGINAL_FILES.keys()].sort());
  for (const [relativePath, original] of ORIGINAL_FILES) {
    assert.equal(
      fs.readFileSync(
        path.join(clusterDir, ...relativePath.split("/")),
        "utf8",
      ),
      original,
      relativePath,
    );
  }
}

async function writeFixtureKnowledge(fixture, options = {}) {
  return writeDocumentKnowledge({
    contentPath: fixture.contentPath,
    clusterSlug: fixture.clusterSlug,
    sourceTitle: "new-source",
    sourceFileName: "new-source.md",
    sourceType: "md",
    sourceLabel: "upload",
    markdownText: "# New source\n\nNew source material.",
    plainText: "New source material.",
    extraction: extraction(),
    ...options,
  });
}

test("an uncommitted ingestion transaction restores merged and singleton knowledge files", async () => {
  const fixture = createGardenFixture();
  const previousPublish = process.env.QUARTZ_AUTO_PUBLISH;
  process.env.QUARTZ_AUTO_PUBLISH = "0";
  try {
    const transaction = createKnowledgeWriteTransaction(
      fixture.contentPath,
      fixture.clusterSlug,
    );
    const saved = await writeFixtureKnowledge(fixture, {
      knowledgeWriteTransaction: transaction,
    });

    assert.equal(saved.topics[0]?.action, "merged");
    assert.notEqual(
      fs.readFileSync(
        path.join(fixture.clusterDir, "learning", "shared-concept.md"),
        "utf8",
      ),
      ORIGINAL_FILES.get("learning/shared-concept.md"),
    );
    assert.notEqual(
      fs.readFileSync(
        path.join(fixture.clusterDir, "learning", "Topic Overview.md"),
        "utf8",
      ),
      ORIGINAL_FILES.get("learning/Topic Overview.md"),
    );

    transaction.rollback();
    assertGardenRestored(fixture.clusterDir);
  } finally {
    if (previousPublish === undefined) delete process.env.QUARTZ_AUTO_PUBLISH;
    else process.env.QUARTZ_AUTO_PUBLISH = previousPublish;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a legitimate Garden edit cannot race rollback and is preserved after the transaction releases", async () => {
  const fixture = createGardenFixture();
  const targetPath = path.join(
    fixture.clusterDir,
    "learning",
    "shared-concept.md",
  );
  const transaction = createKnowledgeWriteTransaction(
    fixture.contentPath,
    fixture.clusterSlug,
  );
  try {
    transaction.captureFile(targetPath);
    fs.writeFileSync(targetPath, "uncommitted ingestion mutation\n", "utf8");

    // Reads remain concurrent while a journaled writer owns the Garden.
    assert.equal(
      fs.readFileSync(targetPath, "utf8"),
      "uncommitted ingestion mutation\n",
    );

    let editRan = false;
    await assert.rejects(
      withGardenMutationLease(
        fixture.clusterDir,
        "adversarial-manual-edit",
        () => {
          editRan = true;
          fs.writeFileSync(targetPath, "legitimate concurrent edit\n", "utf8");
        },
      ),
      (error) => error?.code === "GARDEN_MUTATION_BUSY",
    );
    assert.equal(editRan, false);

    transaction.rollback();
    await withGardenMutationLease(
      fixture.clusterDir,
      "adversarial-manual-edit-retry",
      () => {
        fs.writeFileSync(
          targetPath,
          "legitimate edit after rollback\n",
          "utf8",
        );
      },
    );
    assert.equal(
      fs.readFileSync(targetPath, "utf8"),
      "legitimate edit after rollback\n",
    );
  } finally {
    try {
      transaction.rollback();
    } catch {
      // A completed rollback is intentionally idempotent.
    }
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("duplicate detection does not migrate a legacy root source outside the transaction", async () => {
  const fixture = createGardenFixture();
  const rootSourcePath = path.join(fixture.clusterDir, "legacy-root-source.md");
  const migratedSourcePath = path.join(
    fixture.clusterDir,
    "sources",
    "legacy-root-source.md",
  );
  fs.writeFileSync(
    rootSourcePath,
    `---
title: "Legacy root source"
knowledge_type: "source-document"
source_file: "legacy-root.md"
---

Legacy source body.
`,
    "utf8",
  );
  const transaction = createKnowledgeWriteTransaction(
    fixture.contentPath,
    fixture.clusterSlug,
  );
  try {
    const result = await runIngest({
      request: new Request("http://127.0.0.1/runtime-v2/ingest"),
      contentPath: fixture.contentPath,
      file: {
        name: "legacy-root.md",
        type: "text/markdown",
        size: 1,
        async readBuffer() {
          throw new Error("duplicate detection must not read the upload");
        },
        async text() {
          throw new Error("duplicate detection must not read the upload");
        },
      },
      normalizedClusterSlug: fixture.clusterSlug,
      filename: "legacy-root.md",
      ext: "md",
      nameWithoutExt: "legacy-root",
      source: "upload",
      model: "",
      isHandwriting: false,
      parseWithVlm: false,
      parseWithAnydoc: false,
      vlmTask: "transcribe",
      generateMap: false,
      createdFilePaths: [],
      createdMarkdownPaths: [],
      knowledgeWriteTransaction: transaction,
      emit() {},
    });
    assert.equal(result.duplicate, true);
    transaction.rollback();
    assert.equal(fs.existsSync(rootSourcePath), true);
    assert.equal(fs.existsSync(migratedSourcePath), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a failure after knowledge writes rolls back before it escapes", async () => {
  const fixture = createGardenFixture();
  const previousPublish = process.env.QUARTZ_AUTO_PUBLISH;
  process.env.QUARTZ_AUTO_PUBLISH = "0";
  const controller = new AbortController();
  try {
    await assert.rejects(
      writeFixtureKnowledge(fixture, {
        abortSignal: controller.signal,
        onProgress(step) {
          if (step.startsWith("Merging textbook page")) controller.abort();
        },
      }),
      (error) => error instanceof Error && error.name === "AbortError",
    );
    assertGardenRestored(fixture.clusterDir);
  } finally {
    if (previousPublish === undefined) delete process.env.QUARTZ_AUTO_PUBLISH;
    else process.env.QUARTZ_AUTO_PUBLISH = previousPublish;
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

function runAbruptTransactionStage({
  fixture,
  registryRoot,
  runtimeJobsRoot,
  transactionId,
  stage,
}) {
  const resultPath = path.join(runtimeJobsRoot, transactionId, "result.json");
  const targetPath = path.join(
    fixture.clusterDir,
    "learning",
    "shared-concept.md",
  );
  const assetDirectory = path.join(fixture.clusterDir, "assets");
  const assetPath = path.join(assetDirectory, "new-source.png");
  const hookUrl = pathToFileURL(
    path.join(dashboardRoot, "scripts", "learn-worker-import-hook.mjs"),
  );
  const knowledgeUrl = pathToFileURL(
    path.join(sourceRoot, "lib", "knowledge.ts"),
  );
  const script = `
    import fs from "node:fs";
    import path from "node:path";
    import { createHash } from "node:crypto";
    await import(${JSON.stringify(hookUrl.href)});
    const { createKnowledgeWriteTransaction } = await import(${JSON.stringify(knowledgeUrl.href)});
    if (["rollback-cleanup", "commit-cleanup"].includes(${JSON.stringify(stage)})) {
      const originalRmSync = fs.rmSync.bind(fs);
      fs.rmSync = (candidate, options) => {
        const name = path.basename(String(candidate));
        if (
          (${JSON.stringify(stage)} === "rollback-cleanup" &&
            name.startsWith(".cleanup.rolled-back.")) ||
          (${JSON.stringify(stage)} === "commit-cleanup" &&
            name.startsWith(".cleanup.committed."))
        ) {
          process.exit(${JSON.stringify(stage)} === "rollback-cleanup" ? 86 : 84);
        }
        return originalRmSync(candidate, options);
      };
    }
    if (${JSON.stringify(stage)} === "initialization-cleanup") {
      const originalRenameSync = fs.renameSync.bind(fs);
      fs.renameSync = (source, target) => {
        if (
          path.basename(String(source)).startsWith(".initializing.") &&
          path.basename(String(target)) === ${JSON.stringify(transactionId)}
        ) {
          process.exit(85);
        }
        return originalRenameSync(source, target);
      };
    }
    fs.mkdirSync(path.dirname(${JSON.stringify(resultPath)}), { recursive: true });
    const transaction = createKnowledgeWriteTransaction(
      ${JSON.stringify(fixture.contentPath)},
      ${JSON.stringify(fixture.clusterSlug)},
      {
        registryRoot: ${JSON.stringify(registryRoot)},
        transactionId: ${JSON.stringify(transactionId)},
        resultPath: ${JSON.stringify(resultPath)},
        retainCommittedJournal: true,
      },
    );
    const targetPath = ${JSON.stringify(targetPath)};
    const assetDirectory = ${JSON.stringify(assetDirectory)};
    const assetPath = ${JSON.stringify(assetPath)};
    transaction.captureFile(targetPath);
    fs.writeFileSync(targetPath, "mutated garden page\\n", "utf8");
    transaction.recordCreatedDirectory(assetDirectory);
    fs.mkdirSync(assetDirectory);
    transaction.captureFile(assetPath);
    fs.writeFileSync(assetPath, Buffer.from("new asset"));
    if (${JSON.stringify(stage)} === "rollback-cleanup") {
      transaction.rollback();
      process.exit(87);
    }
    const firstResult = Buffer.from(JSON.stringify({ result: "first" }));
    const secondResult = Buffer.from(JSON.stringify({ result: "second" }));
    if (${JSON.stringify(stage)} !== "active") {
      transaction.prepareResult(createHash("sha256").update(firstResult).digest("hex"));
    }
    if (!["active", "result-pending"].includes(${JSON.stringify(stage)})) {
      fs.mkdirSync(path.dirname(${JSON.stringify(resultPath)}), { recursive: true });
      fs.writeFileSync(${JSON.stringify(resultPath)}, firstResult);
    }
    if (["committed", "commit-cleanup", "reconciling-old", "reconciling-new", "terminal-written"].includes(${JSON.stringify(stage)})) {
      transaction.commit();
    }
    if (${JSON.stringify(stage)} === "commit-cleanup") {
      transaction.seal();
      process.exit(87);
    }
    if (["reconciling-old", "reconciling-new"].includes(${JSON.stringify(stage)})) {
      transaction.prepareResultReplacement(
        createHash("sha256").update(secondResult).digest("hex"),
      );
    }
    if (${JSON.stringify(stage)} === "reconciling-new") {
      fs.writeFileSync(${JSON.stringify(resultPath)}, secondResult);
    }
    process.exit(0);
  `;
  const child = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", script],
    {
      cwd: path.resolve(dashboardRoot, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        BREADBOARD_LEARN_SOURCE_ROOT: sourceRoot,
        QUARTZ_AUTO_PUBLISH: "0",
      },
      timeout: 15_000,
    },
  );
  assert.equal(
    child.status,
    stage === "rollback-cleanup"
      ? 86
      : stage === "commit-cleanup"
        ? 84
        : stage === "initialization-cleanup"
          ? 85
          : 0,
    child.stderr || child.stdout,
  );
  return { assetDirectory, assetPath, resultPath, targetPath };
}

test("a dead ingestion owner cannot admit an ordinary edit before recovery rollback", async () => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
  const transactionId = "job_crash_edit_fence";
  try {
    const { targetPath } = runAbruptTransactionStage({
      fixture,
      registryRoot,
      runtimeJobsRoot,
      transactionId,
      stage: "active",
    });
    let editRan = false;
    await assert.rejects(
      withGardenMutationLease(
        fixture.clusterDir,
        "ordinary-edit-before-recovery",
        () => {
          editRan = true;
          fs.writeFileSync(targetPath, "legitimate post-crash edit\n", "utf8");
        },
      ),
      (error) => error?.code === "GARDEN_MUTATION_BUSY",
    );
    assert.equal(editRan, false);
    assert.equal(fs.readFileSync(targetPath, "utf8"), "mutated garden page\n");

    assert.deepEqual(
      recoverKnowledgeWriteTransactions(
        fixture.contentPath,
        fixture.clusterSlug,
        registryRoot,
        runtimeJobsRoot,
      ),
      [{ transactionId, outcome: "rolled-back" }],
    );

    await withGardenMutationLease(
      fixture.clusterDir,
      "ordinary-edit-after-recovery",
      () =>
        fs.writeFileSync(targetPath, "legitimate post-recovery edit\n", "utf8"),
    );
    assert.equal(
      fs.readFileSync(targetPath, "utf8"),
      "legitimate post-recovery edit\n",
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fresh-process recovery removes an initialization directory left before publication", () => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
  const transactionId = "job_initialization_cleanup";
  try {
    runAbruptTransactionStage({
      fixture,
      registryRoot,
      runtimeJobsRoot,
      transactionId,
      stage: "initialization-cleanup",
    });
    const debris = fs
      .readdirSync(registryRoot)
      .filter((entry) => entry.startsWith(".initializing."));
    assert.equal(debris.length, 1);
    assertGardenRestored(fixture.clusterDir);

    assert.deepEqual(
      recoverKnowledgeWriteTransactions(
        fixture.contentPath,
        fixture.clusterSlug,
        registryRoot,
        runtimeJobsRoot,
      ),
      [],
    );
    assert.deepEqual(fs.readdirSync(registryRoot), []);
    assertGardenRestored(fixture.clusterDir);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

for (const stage of ["active", "result-pending"]) {
  test(`fresh-process recovery rolls back an ingestion stopped at ${stage}`, () => {
    const fixture = createGardenFixture();
    const registryRoot = path.join(fixture.root, "transaction-registry");
    const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
    const transactionId = `job_${stage.replaceAll("-", "_")}`;
    try {
      const paths = runAbruptTransactionStage({
        fixture,
        registryRoot,
        runtimeJobsRoot,
        transactionId,
        stage,
      });
      const journal = JSON.parse(
        fs.readFileSync(
          path.join(registryRoot, transactionId, "journal.json"),
          "utf8",
        ),
      );
      assert.deepEqual(
        journal.entries.map((entry) => [
          entry.relativePath,
          entry.original.kind,
        ]),
        [
          ["learning/shared-concept.md", "file"],
          ["assets/new-source.png", "absent"],
        ],
      );
      assert.deepEqual(journal.createdDirectories, ["assets"]);

      const recoveries = recoverKnowledgeWriteTransactions(
        fixture.contentPath,
        fixture.clusterSlug,
        registryRoot,
        runtimeJobsRoot,
      );
      assert.deepEqual(recoveries, [{ transactionId, outcome: "rolled-back" }]);
      assert.equal(fs.existsSync(paths.assetPath), false);
      assert.equal(fs.existsSync(paths.assetDirectory), false);
      assertGardenRestored(fixture.clusterDir);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("fresh-process recovery removes a rollback cleanup directory left by an abrupt exit", () => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
  const transactionId = "job_rollback_cleanup";
  try {
    runAbruptTransactionStage({
      fixture,
      registryRoot,
      runtimeJobsRoot,
      transactionId,
      stage: "rollback-cleanup",
    });
    const debris = fs
      .readdirSync(registryRoot)
      .filter((entry) => entry.startsWith(".cleanup.rolled-back."));
    assert.equal(debris.length, 1);
    assertGardenRestored(fixture.clusterDir);

    assert.deepEqual(
      recoverKnowledgeWriteTransactions(
        fixture.contentPath,
        fixture.clusterSlug,
        registryRoot,
        runtimeJobsRoot,
      ),
      [],
    );
    assert.deepEqual(fs.readdirSync(registryRoot), []);
    assertGardenRestored(fixture.clusterDir);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fresh-process recovery removes committed cleanup debris without rolling back the garden", () => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
  const transactionId = "job_commit_cleanup";
  try {
    const paths = runAbruptTransactionStage({
      fixture,
      registryRoot,
      runtimeJobsRoot,
      transactionId,
      stage: "commit-cleanup",
    });
    const debris = fs
      .readdirSync(registryRoot)
      .filter((entry) => entry.startsWith(".cleanup.committed."));
    assert.equal(debris.length, 1);
    assert.equal(
      fs.readFileSync(paths.targetPath, "utf8"),
      "mutated garden page\n",
    );

    assert.deepEqual(
      recoverKnowledgeWriteTransactions(
        fixture.contentPath,
        fixture.clusterSlug,
        registryRoot,
        runtimeJobsRoot,
      ),
      [],
    );
    assert.deepEqual(fs.readdirSync(registryRoot), []);
    const committed = recoverCommittedKnowledgeWriteTransaction(
      fixture.contentPath,
      fixture.clusterSlug,
      registryRoot,
      transactionId,
      paths.resultPath,
    );
    assert.ok(committed?.transaction);
    assert.equal(
      JSON.parse(committed.transaction.readCommittedResult()).result,
      "first",
    );
    committed.transaction.seal();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

for (const [stage, expectedResult] of [
  ["result-written", "first"],
  ["committed", "first"],
  ["terminal-written", "first"],
  ["reconciling-old", "first"],
  ["reconciling-new", "second"],
]) {
  test(`fresh-process recovery preserves an ingestion stopped at ${stage}`, () => {
    const fixture = createGardenFixture();
    const registryRoot = path.join(fixture.root, "transaction-registry");
    const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
    const transactionId = `job_${stage.replaceAll("-", "_")}`;
    try {
      const paths = runAbruptTransactionStage({
        fixture,
        registryRoot,
        runtimeJobsRoot,
        transactionId,
        stage,
      });
      const recoveries = recoverKnowledgeWriteTransactions(
        fixture.contentPath,
        fixture.clusterSlug,
        registryRoot,
        runtimeJobsRoot,
      );
      assert.equal(recoveries.length, 1);
      assert.equal(recoveries[0].transactionId, transactionId);
      assert.equal(recoveries[0].outcome, "committed");
      assert.equal(recoveries[0].transaction, undefined);
      assert.deepEqual(fs.readdirSync(registryRoot), []);
      assert.equal(
        fs.existsSync(
          path.join(path.dirname(paths.resultPath), "ingestion-commit.json"),
        ),
        true,
      );
      const committed = recoverCommittedKnowledgeWriteTransaction(
        fixture.contentPath,
        fixture.clusterSlug,
        registryRoot,
        transactionId,
        paths.resultPath,
      );
      assert.ok(committed?.transaction);
      assert.equal(
        JSON.parse(committed.transaction.readCommittedResult()).result,
        expectedResult,
      );
      assert.equal(
        fs.readFileSync(paths.targetPath, "utf8"),
        "mutated garden page\n",
      );
      assert.equal(fs.readFileSync(paths.assetPath, "utf8"), "new asset");
      committed.transaction.seal();
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}

test("knowledge journals reject escape and nonregular corruption without touching the garden", () => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
  const transactionId = "job_corrupt_journal";
  const outside = path.join(fixture.root, "outside.md");
  fs.writeFileSync(outside, "outside\n", "utf8");
  try {
    fs.mkdirSync(path.join(runtimeJobsRoot, transactionId), {
      recursive: true,
    });
    const transaction = createKnowledgeWriteTransaction(
      fixture.contentPath,
      fixture.clusterSlug,
      {
        registryRoot,
        transactionId,
        resultPath: path.join(runtimeJobsRoot, transactionId, "result.json"),
        retainCommittedJournal: true,
      },
    );
    assert.throws(
      () => transaction.captureFile(outside),
      /escaped the garden directory/u,
    );
    const directoryTarget = path.join(fixture.clusterDir, "directory-target");
    fs.mkdirSync(directoryTarget);
    assert.throws(
      () => transaction.captureFile(directoryTarget),
      /not a regular file/u,
    );
    transaction.rollback();

    const corruptTransactionId = "job_corrupt_recovery";
    const paths = runAbruptTransactionStage({
      fixture,
      registryRoot,
      runtimeJobsRoot,
      transactionId: corruptTransactionId,
      stage: "active",
    });
    const journalPath = path.join(
      registryRoot,
      corruptTransactionId,
      "journal.json",
    );
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    journal.entries[0].relativePath = "../outside.md";
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    assert.throws(
      () =>
        recoverKnowledgeWriteTransactions(
          fixture.contentPath,
          fixture.clusterSlug,
          registryRoot,
          runtimeJobsRoot,
        ),
      /invalid path/u,
    );
    assert.equal(
      fs.readFileSync(paths.targetPath, "utf8"),
      "mutated garden page\n",
    );
    assert.equal(fs.readFileSync(outside, "utf8"), "outside\n");
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a transaction rejects an aggregate backup beyond its durable disk bound before copying it", () => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const transactionId = "job_backup_bound";
  const resultPath = path.join(
    fixture.root,
    "runtime",
    "jobs",
    transactionId,
    "result.json",
  );
  const oversizedPath = path.join(fixture.clusterDir, "oversized-existing.md");
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(oversizedPath, "", "utf8");
  fs.truncateSync(oversizedPath, 512 * 1024 * 1024 + 1);
  const transaction = createKnowledgeWriteTransaction(
    fixture.contentPath,
    fixture.clusterSlug,
    {
      registryRoot,
      transactionId,
      resultPath,
      retainCommittedJournal: true,
    },
  );
  try {
    assert.throws(
      () => transaction.captureFile(oversizedPath),
      /backup bytes exceeded their bound/u,
    );
    assert.deepEqual(
      fs.readdirSync(path.join(registryRoot, transactionId, "backups")),
      [],
    );
    transaction.rollback();
    assert.equal(fs.statSync(oversizedPath).size, 512 * 1024 * 1024 + 1);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("recover-all never rolls back a live same-garden transaction", () => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const runtimeJobsRoot = path.join(fixture.root, "runtime", "jobs");
  const firstId = "job_live_owner";
  const secondId = "job_competing_owner";
  const targetPath = path.join(
    fixture.clusterDir,
    "learning",
    "shared-concept.md",
  );
  fs.mkdirSync(path.join(runtimeJobsRoot, firstId), { recursive: true });
  fs.mkdirSync(path.join(runtimeJobsRoot, secondId), { recursive: true });
  const first = createKnowledgeWriteTransaction(
    fixture.contentPath,
    fixture.clusterSlug,
    {
      registryRoot,
      transactionId: firstId,
      resultPath: path.join(runtimeJobsRoot, firstId, "result.json"),
      retainCommittedJournal: true,
    },
  );
  try {
    first.captureFile(targetPath);
    fs.writeFileSync(targetPath, "live mutation\n", "utf8");
    assert.throws(
      () =>
        recoverKnowledgeWriteTransactions(
          fixture.contentPath,
          fixture.clusterSlug,
          registryRoot,
          runtimeJobsRoot,
        ),
      /live ingestion transaction/u,
    );
    assert.throws(
      () =>
        createKnowledgeWriteTransaction(
          fixture.contentPath,
          fixture.clusterSlug,
          {
            registryRoot,
            transactionId: secondId,
            resultPath: path.join(runtimeJobsRoot, secondId, "result.json"),
            retainCommittedJournal: true,
          },
        ),
      (error) => error?.code === "EEXIST",
    );
    assert.equal(fs.readFileSync(targetPath, "utf8"), "live mutation\n");
    first.rollback();
    assertGardenRestored(fixture.clusterDir);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("knowledge journals reject symlinked garden paths", (t) => {
  const fixture = createGardenFixture();
  const registryRoot = path.join(fixture.root, "transaction-registry");
  const transactionId = "job_symlink_path";
  const outsideDirectory = path.join(fixture.root, "outside-directory");
  const indirectDirectory = path.join(fixture.clusterDir, "indirect-directory");
  fs.mkdirSync(outsideDirectory);
  fs.writeFileSync(
    path.join(outsideDirectory, "outside.md"),
    "outside\n",
    "utf8",
  );
  try {
    try {
      fs.symlinkSync(
        outsideDirectory,
        indirectDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) {
        t.skip(`symlinks are unavailable on this host: ${error.code}`);
        return;
      }
      throw error;
    }
    const resultPath = path.join(
      fixture.root,
      "runtime",
      "jobs",
      transactionId,
      "result.json",
    );
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    const transaction = createKnowledgeWriteTransaction(
      fixture.contentPath,
      fixture.clusterSlug,
      {
        registryRoot,
        transactionId,
        resultPath,
        retainCommittedJournal: true,
      },
    );
    assert.throws(
      () => transaction.captureFile(path.join(indirectDirectory, "outside.md")),
      /indirect directory/u,
    );
    assert.equal(
      fs.readFileSync(path.join(outsideDirectory, "outside.md"), "utf8"),
      "outside\n",
    );
    transaction.rollback();
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
