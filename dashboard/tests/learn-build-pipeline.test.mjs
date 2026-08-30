import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLearnBuildWorkspace,
  defaultWorkspaceRoot,
  disposeLearnBuildWorkspace,
  fingerprintDurableGardenState,
  prepareLearnWorkspaceRoot,
  retainFailedLearnWorkspacesForJob,
  retainLearnBuildWorkspace,
  seedDurableInputs,
  temporaryWorkspaceRoot,
  verifyAuthoritativeSourceAnchorLedger,
} from "../src/lib/learn-build-workspace.ts";
import { buildCanonicalSourceAnchors } from "../src/lib/final-garden-state.ts";
import {
  createActiveBuildManifest,
  contractFingerprint,
  ownershipMetadata,
  pageIdForUnit,
  readActiveBuildManifest,
  writeActiveBuildManifest,
} from "../src/lib/learn-build-manifest.ts";
import {
  detectStructuralIssues,
  isActiveLearnerProjectionPath,
  reconcileActiveLearnStructure,
} from "../src/lib/learn-structure-reconciliation.ts";
import {
  isRecoverableLearnIssue,
  resetDisposableLearnProjections,
} from "../src/lib/learn-projection-reset.ts";
import {
  acquireGardenLearnLease,
  acquireGardenLearnLock,
  heartbeatGardenLearnLock,
  LOCK_STALE_MS,
  promoteStagingGarden,
  readGardenLearnLock,
  releaseGardenLearnLock,
  resumeGardenLearnLock,
} from "../src/lib/learn-atomic-promotion.ts";
import {
  learnFinalizationMode,
  runLearnConvergenceLoop,
} from "../src/lib/learn-convergence-loop.ts";

const roots = [];
test.after(() =>
  roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
);

function tmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  roots.push(dir);
  return dir;
}

function stableGardenLearnLockPath(gardenDir) {
  const garden = path.resolve(gardenDir);
  return path.join(
    path.dirname(garden),
    `.${path.basename(garden)}.learn-build.lock.json`,
  );
}

async function eventually(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("condition was not met before timeout");
}

function runLockContender(garden, jobId, buildId = `build-${jobId}`) {
  const moduleUrl = new URL(
    "../src/lib/learn-atomic-promotion.ts",
    import.meta.url,
  ).href;
  const script = [
    `import { acquireGardenLearnLock } from ${JSON.stringify(moduleUrl)};`,
    `const result = acquireGardenLearnLock(${JSON.stringify(garden)}, {`,
    `  gardenSlug: "g", jobId: ${JSON.stringify(jobId)}, buildId: ${JSON.stringify(buildId)}`,
    `});`,
    `process.stdout.write(JSON.stringify({ acquired: result.acquired }));`,
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", script],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`lock contender exited ${code}: ${stderr}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function unit(id, title, role = "core_concept") {
  return {
    id,
    title,
    role,
    learningQuestion: `What is ${title}?`,
    prerequisiteConcepts: [],
    newConcepts: [title],
    sourceAnchors: [],
    sourceFigures: [],
    sourceFormulas: [],
    sourceTables: [],
    zettelNotes: [],
    mustNotRepeat: [],
    expectedWordRange: [700, 1100],
  };
}

function writePage(gardenDir, rel, ownership, extra = "") {
  const abs = path.join(gardenDir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fm = [
    "---",
    `title: ${JSON.stringify(rel.split("/").pop().replace(/\.md$/, ""))}`,
    'knowledge_type: "learning-page"',
    'breadboardType: "learning_page"',
    'generated_by: "learn_button"',
    `learningUnitId: ${ownership.learningUnitId}`,
    `pageId: ${ownership.pageId ?? pageIdForUnit(ownership.learningUnitId)}`,
    `generatedByBuildId: ${ownership.generatedByBuildId}`,
    `generatedByJobId: ${ownership.generatedByJobId ?? "job1"}`,
    `contractFingerprint: ${ownership.contractFingerprint ?? "cf1"}`,
    `generationAttempt: ${ownership.generationAttempt ?? 1}`,
    extra,
    "---",
    "",
    "Body.",
  ]
    .filter(Boolean)
    .join("\n");
  fs.writeFileSync(abs, fm);
  return abs;
}

// ---------------------------------------------------------------------------
// Workspace isolation (Parts 1-2, tests 1-5 subset)
// ---------------------------------------------------------------------------

test("1/2. workspace seeds durable inputs and never copies the old learning tree", () => {
  const repo = tmp("repo");
  fs.mkdirSync(path.join(repo, "sources"), { recursive: true });
  fs.writeFileSync(path.join(repo, "sources", "s1.md"), "# Page 1\n");
  fs.mkdirSync(path.join(repo, "learning", "1. Old Section"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(repo, "learning", "1. Old Section", "1.1 Old.md"),
    "old page",
  );
  fs.mkdirSync(path.join(repo, ".breadboard"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".breadboard", "source-visuals.json"), "[]");
  fs.writeFileSync(
    path.join(repo, ".breadboard", "source-visual-source-index.json"),
    JSON.stringify({
      schemaVersion: 1,
      sourceIdentityMap: [{ sourceId: "s1", sourceIndex: 1 }],
    }),
  );
  fs.writeFileSync(path.join(repo, ".breadboard", "claims.json"), "{}");
  for (const name of [
    "visual-necessity-decisions.json",
    "visual-necessity-decisions.md",
    "visual-decision-records.json",
    "visual-contract-executability-reviews.json",
  ]) {
    fs.writeFileSync(
      path.join(repo, ".breadboard", name),
      "stale model output",
    );
  }

  const ws = createLearnBuildWorkspace({
    gardenSlug: "g1",
    jobId: "job1",
    mode: "generate",
    repositoryGardenDir: repo,
    contractFingerprint: "cf1",
    sourceSetFingerprint: "sf1",
    workspaceRoot: path.join(tmp("wsroot"), "ws"),
  });
  roots.push(ws.workspaceRoot);
  // durable inputs present
  assert.ok(fs.existsSync(path.join(ws.stagingGardenDir, "sources", "s1.md")));
  assert.ok(
    fs.existsSync(
      path.join(ws.stagingGardenDir, ".breadboard", "source-visuals.json"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(
        ws.stagingGardenDir,
        ".breadboard",
        "source-visual-source-index.json",
      ),
    ),
  );
  // old learning tree and disposable projections NOT copied
  assert.equal(
    fs.existsSync(path.join(ws.stagingGardenDir, "learning")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(ws.stagingGardenDir, ".breadboard", "claims.json")),
    false,
  );
  for (const name of [
    "visual-necessity-decisions.json",
    "visual-necessity-decisions.md",
    "visual-decision-records.json",
    "visual-contract-executability-reviews.json",
  ]) {
    assert.equal(
      fs.existsSync(path.join(ws.stagingGardenDir, ".breadboard", name)),
      false,
      `${name} must not seed a fresh staging run`,
    );
  }
});

test("1/2a. a failed workspace retains its exact staged candidate and lifecycle receipt", () => {
  const repo = tmp("repo-retained-workspace");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const workspaceRoot = path.join(tmp("retained-workspace-root"), "workspace");
  const ws = createLearnBuildWorkspace({
    gardenSlug: "g-retained",
    jobId: "job-retained",
    mode: "generate",
    repositoryGardenDir: repo,
    contractFingerprint: "cf-retained",
    sourceSetFingerprint: "sf-retained",
    workspaceRoot,
  });
  const stagedCandidate = path.join(ws.stagingGardenDir, "learning", "1.1 Candidate.md");
  fs.mkdirSync(path.dirname(stagedCandidate), { recursive: true });
  fs.writeFileSync(stagedCandidate, "# Exact generated candidate\n");

  retainLearnBuildWorkspace(ws, {
    reason: "generation_failure",
    failureStage: "  Running   final semantic critic  ",
    retainedAt: "2026-08-28T08:00:00.000Z",
  });

  assert.equal(fs.readFileSync(stagedCandidate, "utf8"), "# Exact generated candidate\n");
  const descriptor = JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, "build-workspace.json"), "utf8"),
  );
  assert.equal(descriptor.lifecycle, "retained_after_failure");
  assert.equal(descriptor.retentionReason, "generation_failure");
  assert.equal(descriptor.retentionStage, "Running final semantic critic");
  assert.equal(descriptor.retainedAt, "2026-08-28T08:00:00.000Z");

  disposeLearnBuildWorkspace(ws);
  assert.equal(fs.existsSync(workspaceRoot), false);
});

test("1/2b. abandoned-worker retention recognizes the exact default root", () => {
  const repo = tmp("repo-abandoned-retention");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const localAppData = tmp("local-app-data-abandoned-retention");
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const gardenSlug = `g-retained-${crypto.randomUUID()}`;
  const jobId = `job-retained-${crypto.randomUUID()}`;
  try {
    process.env.LOCALAPPDATA = localAppData;
    const ws = createLearnBuildWorkspace({
      gardenSlug,
      jobId,
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-abandoned-retained",
      sourceSetFingerprint: "sf-abandoned-retained",
    });
    const stagedCandidate = path.join(ws.stagingGardenDir, "learning", "candidate.md");
    fs.mkdirSync(path.dirname(stagedCandidate), { recursive: true });
    fs.writeFileSync(stagedCandidate, "retained\n");

    const retained = retainFailedLearnWorkspacesForJob({
      gardenSlug,
      jobId,
      reason: "abandoned_worker",
      failureStage: "Reconciling visuals",
      retainedAt: "2026-08-28T08:01:00.000Z",
    });

    assert.deepEqual(retained, [path.resolve(ws.workspaceRoot)]);
    assert.equal(fs.readFileSync(stagedCandidate, "utf8"), "retained\n");
    const descriptor = JSON.parse(
      fs.readFileSync(path.join(ws.workspaceRoot, "build-workspace.json"), "utf8"),
    );
    assert.equal(descriptor.lifecycle, "retained_after_failure");
    assert.equal(descriptor.retentionReason, "abandoned_worker");
    roots.push(ws.workspaceRoot);
  } finally {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  }
});

test("1/2c. a compatible retained candidate is cloned into the next job without resetting staged progress", () => {
  const repo = tmp("repo-retained-resume");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const runtimeRoot = tmp("retained-resume-runtime");
  const originalRuntimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
  const originalDataRoot = process.env.BREADBOARD_DATA_DIR;
  const gardenSlug = `g-resume-${crypto.randomUUID()}`;
  try {
    process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
    delete process.env.BREADBOARD_DATA_DIR;
    const retained = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-failed",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-resume",
      sourceSetFingerprint: "sf-resume",
    });
    const stagedPage = path.join(
      retained.stagingGardenDir,
      "learning",
      "3. Preserved",
      "3.1 Checkpoint.md",
    );
    const stagedCheckpoint = path.join(
      retained.stagingGardenDir,
      ".breadboard",
      "learn-run-snapshots",
      "checkpoint.json",
    );
    fs.mkdirSync(path.dirname(stagedPage), { recursive: true });
    fs.mkdirSync(path.dirname(stagedCheckpoint), { recursive: true });
    fs.writeFileSync(stagedPage, "# Preserved staged page\n");
    fs.writeFileSync(stagedCheckpoint, '{"progress":96}\n');
    retainLearnBuildWorkspace(retained, {
      reason: "generation_failure",
      failureStage: "Final critic",
      retainedAt: "2026-08-28T08:02:00.000Z",
    });
    fs.writeFileSync(
      path.join(repo, "durable.md"),
      "current durable input after retention\n",
    );

    const resumed = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-resumed",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-resume",
      sourceSetFingerprint: "sf-resume",
    });

    assert.notEqual(resumed.workspaceRoot, retained.workspaceRoot);
    assert.equal(resumed.lifecycle, "active");
    assert.equal(resumed.resumedFromBuildId, retained.buildId);
    assert.equal(resumed.resumedFromJobId, retained.jobId);
    assert.equal(resumed.resumedFromWorkspaceRoot, retained.workspaceRoot);
    assert.equal(
      fs.readFileSync(path.join(resumed.stagingGardenDir, "durable.md"), "utf8"),
      "current durable input after retention\n",
      "current durable inputs must overlay the preserved generated candidate",
    );
    assert.equal(
      fs.readFileSync(
        path.join(
          resumed.stagingGardenDir,
          "learning",
          "3. Preserved",
          "3.1 Checkpoint.md",
        ),
        "utf8",
      ),
      "# Preserved staged page\n",
    );
    assert.equal(
      fs.readFileSync(
        path.join(
          resumed.stagingGardenDir,
          ".breadboard",
          "learn-run-snapshots",
          "checkpoint.json",
        ),
        "utf8",
      ),
      '{"progress":96}\n',
    );
    assert.equal(fs.readFileSync(stagedPage, "utf8"), "# Preserved staged page\n");
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(retained.workspaceRoot, "build-workspace.json"),
          "utf8",
        ),
      ).lifecycle,
      "retained_after_failure",
    );
    roots.push(retained.workspaceRoot, resumed.workspaceRoot);
  } finally {
    if (originalRuntimeRoot === undefined) {
      delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    } else {
      process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = originalRuntimeRoot;
    }
    if (originalDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = originalDataRoot;
  }
});

test("1/2d. a Runtime-archived retained candidate remains resumable after leaving the active builds root", () => {
  const repo = tmp("repo-runtime-archived-resume");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const runtimeRoot = tmp("runtime-archived-resume-root");
  const originalRuntimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
  const originalDataRoot = process.env.BREADBOARD_DATA_DIR;
  const gardenSlug = `g-runtime-archived-${crypto.randomUUID()}`;
  try {
    process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
    delete process.env.BREADBOARD_DATA_DIR;
    const retained = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-runtime-archived-failed",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-runtime-archived",
      sourceSetFingerprint: "sf-runtime-archived",
      stagingDirectoryName: gardenSlug,
    });
    const checkpointPath = path.join(
      retained.stagingGardenDir,
      ".breadboard",
      "learn-run-snapshots",
      "checkpoint.json",
    );
    const stagedPage = path.join(
      retained.stagingGardenDir,
      "learning",
      "1. Preserved",
      "1.1 Checkpoint.md",
    );
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
    fs.mkdirSync(path.dirname(stagedPage), { recursive: true });
    fs.writeFileSync(checkpointPath, '{"progress":96}\n');
    fs.writeFileSync(stagedPage, "# Preserved at 96%\n");
    retainLearnBuildWorkspace(retained, {
      reason: "generation_failure",
      failureStage: "Final critic",
      retainedAt: "2026-08-28T08:03:00.000Z",
    });

    const archivedRoot = path.join(
      runtimeRoot,
      "retained-builds",
      gardenSlug,
      retained.jobId,
    );
    fs.mkdirSync(path.dirname(archivedRoot), { recursive: true });
    fs.renameSync(retained.workspaceRoot, archivedRoot);
    const archivedDescriptorPath = path.join(
      archivedRoot,
      "build-workspace.json",
    );
    const archivedDescriptor = JSON.parse(
      fs.readFileSync(archivedDescriptorPath, "utf8"),
    );
    archivedDescriptor.workspaceRoot = archivedRoot;
    archivedDescriptor.stagingGardenDir = path.join(archivedRoot, gardenSlug);
    archivedDescriptor.stagingLearningDir = path.join(
      archivedDescriptor.stagingGardenDir,
      "learning",
    );
    fs.writeFileSync(
      archivedDescriptorPath,
      `${JSON.stringify(archivedDescriptor, null, 2)}\n`,
    );

    const resumed = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-runtime-archived-resumed",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-runtime-archived",
      sourceSetFingerprint: "sf-runtime-archived",
    });

    assert.equal(resumed.resumedFromJobId, retained.jobId);
    assert.equal(resumed.resumedFromWorkspaceRoot, archivedRoot);
    assert.equal(
      fs.readFileSync(
        path.join(
          resumed.stagingGardenDir,
          ".breadboard",
          "learn-run-snapshots",
          "checkpoint.json",
        ),
        "utf8",
      ),
      '{"progress":96}\n',
    );
    assert.equal(
      fs.readFileSync(
        path.join(archivedRoot, gardenSlug, ".breadboard", "learn-run-snapshots", "checkpoint.json"),
        "utf8",
      ),
      '{"progress":96}\n',
      "the archived source candidate must remain immutable after cloning",
    );
    roots.push(archivedRoot, resumed.workspaceRoot);
  } finally {
    if (originalRuntimeRoot === undefined) {
      delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    } else {
      process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = originalRuntimeRoot;
    }
    if (originalDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = originalDataRoot;
  }
});

test("1/2e. resume prefers an older publish-ready checkpoint over a newer deterministically invalid candidate", () => {
  const repo = tmp("repo-safe-retained-resume");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const runtimeRoot = tmp("safe-retained-resume-runtime");
  const originalRuntimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
  const originalDataRoot = process.env.BREADBOARD_DATA_DIR;
  const gardenSlug = `g-safe-resume-${crypto.randomUUID()}`;
  try {
    process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
    delete process.env.BREADBOARD_DATA_DIR;

    const safe = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-safe-99",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-safe-resume",
      sourceSetFingerprint: "sf-safe-resume",
    });
    fs.mkdirSync(path.join(safe.stagingGardenDir, ".breadboard"), { recursive: true });
    fs.mkdirSync(safe.stagingLearningDir, { recursive: true });
    fs.writeFileSync(path.join(safe.stagingGardenDir, ".breadboard", "acceptance-status.json"), JSON.stringify({
      deterministicPass: true,
      accepted: true,
      publishReady: true,
    }) + "\n");
    fs.writeFileSync(path.join(safe.stagingLearningDir, "checkpoint.txt"), "safe-99\n");
    retainLearnBuildWorkspace(safe, {
      reason: "generation_failure",
      failureStage: "Publishing",
      retainedAt: "2026-08-28T08:04:00.000Z",
    });

    const invalid = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-invalid-newer",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-safe-resume",
      sourceSetFingerprint: "sf-safe-resume",
    });
    fs.mkdirSync(path.join(invalid.stagingGardenDir, ".breadboard"), { recursive: true });
    fs.mkdirSync(invalid.stagingLearningDir, { recursive: true });
    fs.writeFileSync(path.join(invalid.stagingGardenDir, ".breadboard", "acceptance-status.json"), JSON.stringify({
      deterministicPass: false,
      accepted: false,
      publishReady: false,
    }) + "\n");
    fs.writeFileSync(path.join(invalid.stagingLearningDir, "checkpoint.txt"), "invalid-newer\n");
    retainLearnBuildWorkspace(invalid, {
      reason: "generation_failure",
      failureStage: "Semantic critic",
      retainedAt: "2026-08-28T08:05:00.000Z",
    });

    const resumed = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-safe-resumed",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-safe-resume",
      sourceSetFingerprint: "sf-safe-resume",
    });

    assert.equal(resumed.resumedFromJobId, safe.jobId);
    assert.equal(fs.readFileSync(path.join(resumed.stagingLearningDir, "checkpoint.txt"), "utf8"), "safe-99\n");
    assert.equal(
      fs.readFileSync(path.join(invalid.stagingLearningDir, "checkpoint.txt"), "utf8"),
      "invalid-newer\n",
      "the rejected candidate remains retained for audit",
    );
    roots.push(safe.workspaceRoot, invalid.workspaceRoot, resumed.workspaceRoot);
  } finally {
    if (originalRuntimeRoot === undefined) delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    else process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = originalRuntimeRoot;
    if (originalDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = originalDataRoot;
  }
});

test("1/2f. resume prefers a newer deterministic-valid semantic checkpoint over an older publish-ready candidate", () => {
  const repo = tmp("repo-progress-retained-resume");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const runtimeRoot = tmp("progress-retained-resume-runtime");
  const originalRuntimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
  const originalDataRoot = process.env.BREADBOARD_DATA_DIR;
  const gardenSlug = `g-progress-resume-${crypto.randomUUID()}`;
  try {
    process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
    delete process.env.BREADBOARD_DATA_DIR;

    const published = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-published-older",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-progress-resume",
      sourceSetFingerprint: "sf-progress-resume",
    });
    fs.mkdirSync(path.join(published.stagingGardenDir, ".breadboard"), { recursive: true });
    fs.mkdirSync(published.stagingLearningDir, { recursive: true });
    fs.writeFileSync(path.join(published.stagingGardenDir, ".breadboard", "acceptance-status.json"), JSON.stringify({
      deterministicPass: true,
      accepted: true,
      publishReady: true,
    }) + "\n");
    fs.writeFileSync(path.join(published.stagingLearningDir, "checkpoint.txt"), "published-older\n");
    retainLearnBuildWorkspace(published, {
      reason: "generation_failure",
      failureStage: "Publishing",
      retainedAt: "2026-08-28T08:04:00.000Z",
    });

    const repaired = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-semantic-newer",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-progress-resume",
      sourceSetFingerprint: "sf-progress-resume",
    });
    fs.mkdirSync(path.join(repaired.stagingGardenDir, ".breadboard"), { recursive: true });
    fs.mkdirSync(repaired.stagingLearningDir, { recursive: true });
    fs.writeFileSync(path.join(repaired.stagingGardenDir, ".breadboard", "acceptance-status.json"), JSON.stringify({
      deterministicPass: true,
      accepted: false,
      publishReady: false,
    }) + "\n");
    fs.writeFileSync(path.join(repaired.stagingLearningDir, "checkpoint.txt"), "semantic-newer\n");
    retainLearnBuildWorkspace(repaired, {
      reason: "generation_failure",
      failureStage: "Semantic critic",
      retainedAt: "2026-08-28T08:05:00.000Z",
    });

    const resumed = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-progress-resumed",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-progress-resume",
      sourceSetFingerprint: "sf-progress-resume",
    });

    assert.equal(resumed.resumedFromJobId, repaired.jobId);
    assert.equal(fs.readFileSync(path.join(resumed.stagingLearningDir, "checkpoint.txt"), "utf8"), "semantic-newer\n");
    roots.push(published.workspaceRoot, repaired.workspaceRoot, resumed.workspaceRoot);
  } finally {
    if (originalRuntimeRoot === undefined) delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    else process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = originalRuntimeRoot;
    if (originalDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = originalDataRoot;
  }
});

test("1/2g. an inherited acceptance receipt cannot make a newer interrupted clone outrank its validated source", () => {
  const repo = tmp("repo-stale-acceptance-resume");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const runtimeRoot = tmp("stale-acceptance-resume-runtime");
  const originalRuntimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
  const originalDataRoot = process.env.BREADBOARD_DATA_DIR;
  const gardenSlug = `g-stale-acceptance-${crypto.randomUUID()}`;
  try {
    process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
    delete process.env.BREADBOARD_DATA_DIR;

    const safe = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-validated-source",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-stale-acceptance",
      sourceSetFingerprint: "sf-stale-acceptance",
    });
    fs.mkdirSync(safe.stagingLearningDir, { recursive: true });
    fs.mkdirSync(path.join(safe.stagingGardenDir, ".breadboard"), { recursive: true });
    const safeStatusPath = path.join(safe.stagingGardenDir, ".breadboard", "acceptance-status.json");
    fs.writeFileSync(safeStatusPath, JSON.stringify({
      deterministicPass: true,
      accepted: true,
      publishReady: true,
    }) + "\n");
    fs.writeFileSync(path.join(safe.stagingLearningDir, "checkpoint.txt"), "validated-source\n");
    retainLearnBuildWorkspace(safe, {
      reason: "generation_failure",
      failureStage: "Publishing",
      retainedAt: "2026-08-28T08:06:00.000Z",
    });

    const interrupted = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-interrupted-clone",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-stale-acceptance",
      sourceSetFingerprint: "sf-stale-acceptance",
    });
    assert.equal(interrupted.resumedFromJobId, safe.jobId);
    const inheritedStatusPath = path.join(interrupted.stagingGardenDir, ".breadboard", "acceptance-status.json");
    assert.equal(interrupted.inheritedAcceptanceStatusCleared, true);
    assert.equal(
      fs.existsSync(inheritedStatusPath),
      false,
      "a resumed job must not inherit the source job's acceptance authority",
    );
    fs.writeFileSync(path.join(interrupted.stagingLearningDir, "checkpoint.txt"), "interrupted-clone\n");
    retainLearnBuildWorkspace(interrupted, {
      reason: "abandoned_worker",
      failureStage: "Semantic repair",
      retainedAt: "2026-08-28T08:07:00.000Z",
    });

    const resumed = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-after-interruption",
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-stale-acceptance",
      sourceSetFingerprint: "sf-stale-acceptance",
    });

    assert.equal(resumed.resumedFromJobId, safe.jobId);
    assert.equal(fs.readFileSync(path.join(resumed.stagingLearningDir, "checkpoint.txt"), "utf8"), "validated-source\n");
    roots.push(safe.workspaceRoot, interrupted.workspaceRoot, resumed.workspaceRoot);
  } finally {
    if (originalRuntimeRoot === undefined) delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    else process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = originalRuntimeRoot;
    if (originalDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = originalDataRoot;
  }
});

test("1/2e. a supervised Learn worker uses its durable runtime root instead of OS temp", () => {
  const runtimeRoot = tmp("learn-worker-runtime-root");
  const originalRuntimeRoot = process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
  const originalDataRoot = process.env.BREADBOARD_DATA_DIR;
  try {
    process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
    delete process.env.BREADBOARD_DATA_DIR;
    assert.equal(
      defaultWorkspaceRoot("g-runtime", "job-runtime"),
      path.join(runtimeRoot, "builds", "g-runtime", "job-runtime"),
    );
  } finally {
    if (originalRuntimeRoot === undefined) {
      delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    } else {
      process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = originalRuntimeRoot;
    }
    if (originalDataRoot === undefined) delete process.env.BREADBOARD_DATA_DIR;
    else process.env.BREADBOARD_DATA_DIR = originalDataRoot;
  }
});

test("1a. default workspace falls back to OS temp when LOCALAPPDATA staging is unavailable", () => {
  const repo = tmp("repo-workspace-fallback");
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const blockedLocalAppData = path.join(
    tmp("blocked-local-appdata"),
    "not-a-directory",
  );
  fs.writeFileSync(blockedLocalAppData, "file blocks workspace descendants\n");
  const originalLocalAppData = process.env.LOCALAPPDATA;
  const gardenSlug = `g-fallback-${crypto.randomUUID()}`;
  const jobId = `job-fallback-${crypto.randomUUID()}`;

  try {
    process.env.LOCALAPPDATA = blockedLocalAppData;
    const ws = createLearnBuildWorkspace({
      gardenSlug,
      jobId,
      mode: "generate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-fallback",
      sourceSetFingerprint: "sf-fallback",
    });
    roots.push(ws.workspaceRoot);

    assert.equal(ws.workspaceRoot, temporaryWorkspaceRoot(gardenSlug, jobId));
    assert.ok(fs.existsSync(path.join(ws.stagingGardenDir, "durable.md")));
    assert.equal(
      path.resolve(ws.workspaceRoot).startsWith(path.resolve(repo)),
      false,
      "the fallback must remain outside the authoritative repository garden",
    );
  } finally {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  }
});

test("1aa. workspace setup retries EPERM, cleans the default root, and only then uses safe temp fallback", () => {
  const repo = tmp("repo-workspace-root-preparation");
  const primaryRoot = path.join(
    tmp("workspace-primary-unavailable"),
    "workspace",
  );
  const fallbackRoot = path.join(
    tmp("workspace-fallback-available"),
    "workspace",
  );
  let primaryRemoveAttempts = 0;
  const created = [];
  const fileSystem = {
    rmSync(directoryPath) {
      if (directoryPath === primaryRoot) {
        primaryRemoveAttempts += 1;
        throw Object.assign(new Error("temporary Windows scanner lock"), {
          code: "EPERM",
        });
      }
    },
    mkdirSync(directoryPath) {
      created.push(directoryPath);
      return directoryPath;
    },
  };

  const prepared = prepareLearnWorkspaceRoot({
    workspaceRoot: primaryRoot,
    fallbackWorkspaceRoot: fallbackRoot,
    repositoryGardenDir: repo,
    stagingDirectoryName: "staging",
    allowFallback: true,
    retryDelaysMs: [0, 0, 0, 0, 0],
    sleep() {},
    fileSystem,
  });

  assert.equal(prepared.workspaceRoot, fallbackRoot);
  assert.equal(prepared.usedFallback, true);
  // Six bounded setup attempts plus one best-effort cleanup before fallback.
  assert.equal(primaryRemoveAttempts, 7);
  assert.deepEqual(created, [path.join(fallbackRoot, "staging")]);

  assert.throws(
    () =>
      prepareLearnWorkspaceRoot({
        workspaceRoot: primaryRoot,
        fallbackWorkspaceRoot: fallbackRoot,
        repositoryGardenDir: repo,
        stagingDirectoryName: "staging",
        allowFallback: false,
        retryDelaysMs: [],
        sleep() {},
        fileSystem,
      }),
    (error) => error?.code === "EPERM",
  );

  assert.throws(
    () =>
      prepareLearnWorkspaceRoot({
        workspaceRoot: primaryRoot,
        fallbackWorkspaceRoot: path.join(repo, "unsafe-temp-workspace"),
        repositoryGardenDir: repo,
        stagingDirectoryName: "staging",
        allowFallback: true,
        retryDelaysMs: [],
        sleep() {},
        fileSystem,
      }),
    /outside the authoritative repository garden/,
  );
});

test("1ab. failed fallback setup and failed descriptor writes clean their disposable roots", () => {
  const repo = tmp("repo-workspace-cleanup");
  const primaryRoot = path.join(tmp("workspace-primary-cleanup"), "workspace");
  const failedFallbackRoot = path.join(
    tmp("workspace-fallback-cleanup"),
    "workspace",
  );
  let fallbackRemoveAttempts = 0;
  const fileSystem = {
    rmSync(directoryPath) {
      if (directoryPath === primaryRoot) {
        throw Object.assign(new Error("primary root remains unavailable"), {
          code: "EPERM",
        });
      }
      if (directoryPath === failedFallbackRoot) fallbackRemoveAttempts += 1;
    },
    mkdirSync(directoryPath) {
      if (directoryPath === path.join(failedFallbackRoot, "staging")) {
        throw Object.assign(new Error("fallback setup stopped"), {
          code: "EPERM",
        });
      }
      return directoryPath;
    },
  };

  assert.throws(
    () =>
      prepareLearnWorkspaceRoot({
        workspaceRoot: primaryRoot,
        fallbackWorkspaceRoot: failedFallbackRoot,
        repositoryGardenDir: repo,
        stagingDirectoryName: "staging",
        allowFallback: true,
        retryDelaysMs: [],
        sleep() {},
        fileSystem,
      }),
    (error) => error?.code === "EPERM",
  );
  assert.equal(
    fallbackRemoveAttempts,
    2,
    "the partial fallback is reset once and removed again when setup fails",
  );

  const terminalPrimaryRoot = path.join(
    tmp("workspace-terminal-primary-cleanup"),
    "workspace",
  );
  let terminalPrimaryRemoveAttempts = 0;
  assert.throws(
    () =>
      prepareLearnWorkspaceRoot({
        workspaceRoot: terminalPrimaryRoot,
        repositoryGardenDir: repo,
        stagingDirectoryName: "staging",
        allowFallback: false,
        retryDelaysMs: [],
        sleep() {},
        fileSystem: {
          rmSync(directoryPath) {
            if (directoryPath === terminalPrimaryRoot)
              terminalPrimaryRemoveAttempts += 1;
          },
          mkdirSync() {
            throw Object.assign(new Error("disk full during primary setup"), {
              code: "ENOSPC",
            });
          },
        },
      }),
    (error) => error?.code === "ENOSPC",
  );
  assert.equal(
    terminalPrimaryRemoveAttempts,
    2,
    "a terminal primary setup failure is cleaned even when fallback is ineligible",
  );

  const descriptorRepo = tmp("repo-workspace-descriptor-cleanup");
  fs.writeFileSync(path.join(descriptorRepo, "durable.md"), "durable input\n");
  const descriptorWorkspaceRoot = path.join(
    tmp("workspace-descriptor-cleanup"),
    "workspace",
  );
  const descriptorPath = path.join(
    descriptorWorkspaceRoot,
    "build-workspace.json",
  );
  const originalWriteFileSync = fs.writeFileSync;
  try {
    fs.writeFileSync = (filePath, ...args) => {
      if (path.resolve(String(filePath)) === path.resolve(descriptorPath)) {
        throw Object.assign(new Error("descriptor write denied"), {
          code: "EPERM",
        });
      }
      return originalWriteFileSync(filePath, ...args);
    };
    assert.throws(
      () =>
        createLearnBuildWorkspace({
          gardenSlug: "g-descriptor-cleanup",
          jobId: "job-descriptor-cleanup",
          mode: "generate",
          repositoryGardenDir: descriptorRepo,
          contractFingerprint: "cf-descriptor-cleanup",
          sourceSetFingerprint: "sf-descriptor-cleanup",
          workspaceRoot: descriptorWorkspaceRoot,
        }),
      (error) => error?.code === "EPERM",
    );
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.equal(
    fs.existsSync(descriptorWorkspaceRoot),
    false,
    "a descriptor failure must not strand a workspace that was never returned",
  );
});

test("1c. generation workspace preserves the authoritative source-anchor ledger byte-for-byte", () => {
  const repo = tmp("repo-anchor-ledger");
  const breadboard = path.join(repo, ".breadboard");
  fs.mkdirSync(breadboard, { recursive: true });
  const ledgerBytes = Buffer.from(
    [
      "{\r\n",
      '  "sourceStructuralAnchors": [\r\n',
      "    {\r\n",
      '      "id": "text-engineering-electromagnetics-page-406",\r\n',
      '      "kind": "guidance",\r\n',
      '      "sourceId": "engineering-electromagnetics",\r\n',
      '      "page": 406,\r\n',
      '      "title": "Late-page boundary condition",\r\n',
      '      "exactText": "E_t is continuous across the boundary."\r\n',
      "    }\r\n",
      "  ]\r\n",
      "}\r\n",
    ].join(""),
    "utf8",
  );
  fs.writeFileSync(path.join(breadboard, "source-anchors.json"), ledgerBytes);

  const ws = createLearnBuildWorkspace({
    gardenSlug: "g-ledger",
    jobId: "job-ledger",
    mode: "generate",
    repositoryGardenDir: repo,
    contractFingerprint: "cf-ledger",
    sourceSetFingerprint: "sf-ledger",
    workspaceRoot: path.join(tmp("workspace-anchor-ledger"), "workspace"),
    requireAuthoritativeSourceAnchorLedger: true,
  });
  const stagedLedger = fs.readFileSync(
    path.join(ws.stagingGardenDir, ".breadboard", "source-anchors.json"),
  );

  assert.deepEqual(stagedLedger, ledgerBytes);
  assert.deepEqual(ws.authoritativeSourceAnchorLedger, {
    relativePath: ".breadboard/source-anchors.json",
    byteLength: ledgerBytes.byteLength,
    sha256: crypto.createHash("sha256").update(ledgerBytes).digest("hex"),
  });
  assert.equal(
    buildCanonicalSourceAnchors(ws.stagingGardenDir)[
      "text-engineering-electromagnetics-page-406"
    ]?.origin,
    "structural_ledger",
  );
  assert.doesNotThrow(() => verifyAuthoritativeSourceAnchorLedger(ws));
});

test("1d. required authoritative source-anchor ledger fails closed when missing", () => {
  const repo = tmp("repo-anchor-ledger-missing");
  const workspaceRoot = path.join(
    tmp("workspace-anchor-ledger-missing"),
    "workspace",
  );

  assert.throws(
    () =>
      createLearnBuildWorkspace({
        gardenSlug: "g-ledger-missing",
        jobId: "job-ledger-missing",
        mode: "generate",
        repositoryGardenDir: repo,
        contractFingerprint: "cf-ledger-missing",
        sourceSetFingerprint: "sf-ledger-missing",
        workspaceRoot,
        requireAuthoritativeSourceAnchorLedger: true,
      }),
    /Authoritative source-anchor ledger is missing/,
  );
  assert.equal(fs.existsSync(workspaceRoot), false);
});

test("1e. source-anchor ledger verification rejects staged or authoritative mutation", () => {
  const repo = tmp("repo-anchor-ledger-mutation");
  const authoritativePath = path.join(
    repo,
    ".breadboard",
    "source-anchors.json",
  );
  fs.mkdirSync(path.dirname(authoritativePath), { recursive: true });
  const original = Buffer.from('{"sourceTextConceptAnchors":[]}\n');
  fs.writeFileSync(authoritativePath, original);
  const ws = createLearnBuildWorkspace({
    gardenSlug: "g-ledger-mutation",
    jobId: "job-ledger-mutation",
    mode: "generate",
    repositoryGardenDir: repo,
    contractFingerprint: "cf-ledger-mutation",
    sourceSetFingerprint: "sf-ledger-mutation",
    workspaceRoot: path.join(
      tmp("workspace-anchor-ledger-mutation"),
      "workspace",
    ),
    requireAuthoritativeSourceAnchorLedger: true,
  });
  const stagedPath = path.join(
    ws.stagingGardenDir,
    ".breadboard",
    "source-anchors.json",
  );

  fs.writeFileSync(
    stagedPath,
    '{"sourceTextConceptAnchors":[{"id":"changed"}]}\n',
  );
  assert.throws(
    () => verifyAuthoritativeSourceAnchorLedger(ws),
    /not byte-for-byte identical/,
  );

  fs.writeFileSync(stagedPath, original);
  fs.writeFileSync(
    authoritativePath,
    '{"sourceTextConceptAnchors":[{"id":"changed"}]}\n',
  );
  assert.throws(
    () => verifyAuthoritativeSourceAnchorLedger(ws),
    /not byte-for-byte identical/,
  );
});

test("1f. the confirmed Learning Unit Contract receipt is seeded intact", () => {
  const repo = tmp("repo-contract-receipt");
  const breadboard = path.join(repo, ".breadboard");
  fs.mkdirSync(breadboard, { recursive: true });
  const recoveryReceipt = {
    integritySha256: "a".repeat(64),
    recoveredAt: "2026-08-23T00:00:00.000Z",
    recoveredLocatorIds: ["syllabus-1"],
  };
  const contract = {
    schemaVersion: 2,
    sourceSetHash: "source-set",
    sourceFormulaReviewSetHash: "review-set",
    sourceArtifactInventoryHash: "b".repeat(64),
    syllabusCoverageEvidenceRecoveryHash: recoveryReceipt.integritySha256,
    syllabusCoverageEvidenceRecovery: recoveryReceipt,
    learningUnits: [],
  };
  fs.writeFileSync(
    path.join(breadboard, "source-formula-review-set.json"),
    JSON.stringify({
      reviewSetHash: "review-set",
      formulaIds: [],
      sourceIds: [],
    }),
  );
  fs.writeFileSync(
    path.join(breadboard, "learning-unit-contract.json"),
    `${JSON.stringify(contract, null, 2)}\n`,
  );

  const ws = createLearnBuildWorkspace({
    gardenSlug: "g-contract-receipt",
    jobId: "job-contract-receipt",
    mode: "generate",
    repositoryGardenDir: repo,
    contractFingerprint: "cf-contract-receipt",
    sourceSetFingerprint: "sf-contract-receipt",
    workspaceRoot: path.join(tmp("workspace-contract-receipt"), "workspace"),
  });
  const stagedContract = JSON.parse(
    fs.readFileSync(
      path.join(
        ws.stagingGardenDir,
        ".breadboard",
        "learning-unit-contract.json",
      ),
      "utf8",
    ),
  );

  assert.deepEqual(stagedContract, contract);
  assert.equal(
    stagedContract.syllabusCoverageEvidenceRecoveryHash,
    recoveryReceipt.integritySha256,
  );
  assert.deepEqual(
    stagedContract.syllabusCoverageEvidenceRecovery,
    recoveryReceipt,
  );
  assert.equal(
    fingerprintDurableGardenState(repo),
    fingerprintDurableGardenState(ws.stagingGardenDir),
  );
});

test("4. seeding leaves the repository garden unchanged", () => {
  const repo = tmp("repo2");
  fs.mkdirSync(path.join(repo, "sources"), { recursive: true });
  fs.writeFileSync(path.join(repo, "sources", "s.md"), "x");
  fs.mkdirSync(path.join(repo, "learning"), { recursive: true });
  fs.writeFileSync(path.join(repo, "learning", "keep.md"), "keep");
  const staging = tmp("staging2");
  seedDurableInputs(repo, staging);
  assert.ok(fs.existsSync(path.join(repo, "learning", "keep.md"))); // repo untouched
  assert.equal(fs.existsSync(path.join(staging, "learning")), false); // learning not seeded
});

test("1b. mixed-case Windows names cannot seed stale Learn projections", () => {
  const repo = tmp("repo-case-seed");
  fs.mkdirSync(path.join(repo, "LEARNING"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "LEARNING", "stale.md"),
    "stale learner page",
  );
  const breadboard = path.join(repo, ".BreadBoard");
  fs.mkdirSync(breadboard, { recursive: true });
  fs.writeFileSync(path.join(breadboard, "CLAIMS.JSON"), "{}");
  fs.writeFileSync(path.join(breadboard, "CrItIc-RePoRt.Md"), "stale critic");
  fs.writeFileSync(path.join(breadboard, "SOURCE-VISUALS.JSON"), "[]");
  fs.writeFileSync(path.join(breadboard, "EVENTS.JSONL"), "");
  fs.writeFileSync(path.join(breadboard, "Manual-Other.json"), "{}");
  fs.writeFileSync(path.join(repo, "note.md"), "durable note");

  const workspaceParent = tmp("workspace-case-seed");
  const ws = createLearnBuildWorkspace({
    gardenSlug: "g-case",
    jobId: "job-case",
    mode: "generate",
    repositoryGardenDir: repo,
    contractFingerprint: "cf-case",
    sourceSetFingerprint: "sf-case",
    workspaceRoot: path.join(workspaceParent, "workspace"),
  });

  assert.equal(
    fs.existsSync(path.join(ws.stagingGardenDir, "LEARNING")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(ws.stagingGardenDir, ".breadboard", "CLAIMS.JSON")),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(ws.stagingGardenDir, ".breadboard", "CrItIc-RePoRt.Md"),
    ),
    false,
  );
  assert.ok(
    fs.existsSync(
      path.join(ws.stagingGardenDir, ".breadboard", "SOURCE-VISUALS.JSON"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(ws.stagingGardenDir, ".breadboard", "EVENTS.JSONL"),
    ),
  );
  assert.ok(
    fs.existsSync(
      path.join(ws.stagingGardenDir, ".breadboard", "Manual-Other.json"),
    ),
  );
  assert.ok(fs.existsSync(path.join(ws.stagingGardenDir, "note.md")));
  assert.equal(
    fingerprintDurableGardenState(repo),
    fingerprintDurableGardenState(ws.stagingGardenDir),
  );
});

test("2b. all-caps disposable paths stay excluded while canonical ledgers affect the durable fingerprint", () => {
  const garden = tmp("repo-case-fingerprint");
  fs.writeFileSync(path.join(garden, "note.md"), "durable note");
  const before = fingerprintDurableGardenState(garden);

  fs.mkdirSync(path.join(garden, "LEARNING"), { recursive: true });
  fs.writeFileSync(path.join(garden, "LEARNING", "STALE.MD"), "stale");
  fs.mkdirSync(path.join(garden, ".PREVIOUS-BUILDS"), { recursive: true });
  fs.writeFileSync(path.join(garden, ".PREVIOUS-BUILDS", "OLD.MD"), "old");
  const breadboard = path.join(garden, ".BREADBOARD");
  fs.mkdirSync(path.join(breadboard, "INTERNAL"), { recursive: true });
  fs.writeFileSync(path.join(breadboard, "INTERNAL", "STATE.JSON"), "{}");
  fs.writeFileSync(path.join(breadboard, "CLAIMS.JSON"), "{}");
  fs.writeFileSync(path.join(breadboard, "CRITIC-REPORT.MD"), "stale critic");
  fs.writeFileSync(path.join(breadboard, "EVENTS.JSONL"), "ignored event\n");
  fs.writeFileSync(path.join(breadboard, "LEARN-BUILD.LOCK.JSON"), "{}");
  assert.equal(fingerprintDurableGardenState(garden), before);
  fs.writeFileSync(path.join(breadboard, "SOURCE-ANCHORS.JSON"), "{}");
  const withSourceAnchors = fingerprintDurableGardenState(garden);
  assert.notEqual(withSourceAnchors, before);
  fs.writeFileSync(path.join(breadboard, "SOURCE-VISUALS.JSON"), "[]");
  assert.notEqual(fingerprintDurableGardenState(garden), withSourceAnchors);
});

// ---------------------------------------------------------------------------
// Manifest ownership (Part 3, tests 6-12 subset)
// ---------------------------------------------------------------------------

test("6/12. ownership metadata identifies a page by unit+build, not path", () => {
  const contract = [unit("U1", "Alpha"), unit("U2", "Beta")];
  const manifest = createActiveBuildManifest({
    buildId: "buildA",
    jobId: "job1",
    gardenSlug: "g",
    sourceSetFingerprint: "sf",
    contractFingerprint: contractFingerprint(contract),
    units: contract.map((u, i) => ({
      unitId: u.id,
      sectionId: "sec1",
      expectedPagePath: `learning/1. Sec/1.${i + 1} ${u.title}.md`,
    })),
    sectionIds: ["sec1"],
  });
  const meta = ownershipMetadata(manifest, "U1");
  assert.equal(meta.pageId, "page:U1");
  assert.equal(meta.generatedByBuildId, "buildA");
  assert.equal(meta.generationAttempt, 1);
});

test("manifest round-trips through disk", () => {
  const garden = tmp("gm");
  const manifest = createActiveBuildManifest({
    buildId: "b",
    jobId: "j",
    gardenSlug: "g",
    sourceSetFingerprint: "sf",
    contractFingerprint: "cf",
    units: [
      {
        unitId: "U1",
        sectionId: "s",
        expectedPagePath: "learning/1. S/1.1 A.md",
      },
    ],
    sectionIds: ["s"],
  });
  writeActiveBuildManifest(garden, manifest);
  const read = readActiveBuildManifest(garden);
  assert.equal(read.buildId, "b");
  assert.equal(read.units[0].pageId, "page:U1");
});

// ---------------------------------------------------------------------------
// Scan exclusions (Part 7, tests 16-17)
// ---------------------------------------------------------------------------

test("16/17. quarantine and canonical-shadow are excluded from active scans", () => {
  assert.equal(
    isActiveLearnerProjectionPath("learning/1. S/1.1 A.md", "b"),
    true,
  );
  assert.equal(
    isActiveLearnerProjectionPath(
      ".breadboard/quarantine/b/obsolete-pages/x.md",
      "b",
    ),
    false,
  );
  assert.equal(
    isActiveLearnerProjectionPath(".breadboard/canonical-shadow/y.md", "b"),
    false,
  );
  assert.equal(
    isActiveLearnerProjectionPath(".breadboard/backups/z.md", "b"),
    false,
  );
  assert.equal(
    isActiveLearnerProjectionPath("node_modules/pkg/readme.md", "b"),
    false,
  );
});

// ---------------------------------------------------------------------------
// Structural reconciliation (Parts 4-6, tests 7-11)
// ---------------------------------------------------------------------------

function gardenWithManifest(contract, buildId = "cur") {
  const garden = tmp("garden");
  const manifest = createActiveBuildManifest({
    buildId,
    jobId: "job1",
    gardenSlug: "g",
    sourceSetFingerprint: "sf",
    contractFingerprint: contractFingerprint(contract),
    units: contract.map((u, i) => ({
      unitId: u.id,
      sectionId: "sec1",
      expectedPagePath: `learning/1. Current/1.${i + 1} ${u.title}.md`,
    })),
    sectionIds: ["sec1"],
  });
  writeActiveBuildManifest(garden, manifest);
  return { garden, manifest };
}

test("7. a foreign-build page for a current unit is removed and flagged for regen", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Old/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "OLD_BUILD",
  });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(result.issuesBefore.some((i) => i.type === "foreign_build_page"));
  assert.equal(
    fs.existsSync(path.join(garden, "learning", "1. Old", "1.1 Alpha.md")),
    false,
  );
  assert.ok(result.pagesRegenerated.includes("U1"));
});

test("8. an unknown-unit page (U24) is quarantined out of the active tree", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  writePage(garden, "learning/9. Obsolete/9.1 Ghost.md", {
    learningUnitId: "U24",
    generatedByBuildId: "cur",
  });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(
    result.issuesBefore.some(
      (i) => i.type === "unknown_learning_unit" && i.unitId === "U24",
    ),
  );
  assert.equal(
    fs.existsSync(path.join(garden, "learning", "9. Obsolete", "9.1 Ghost.md")),
    false,
  );
  assert.equal(result.pagesQuarantined.length, 1);
  // quarantined copy is under .breadboard/quarantine and NOT active
  assert.ok(result.pagesQuarantined[0].startsWith(".breadboard/quarantine/"));
  assert.equal(
    isActiveLearnerProjectionPath(result.pagesQuarantined[0], "cur"),
    false,
  );
});

test("9. a duplicate unit page keeps the manifest candidate and removes the other", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  // Manifest expects learning/1. Current/1.1 Alpha.md
  writePage(garden, "learning/1. Current/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  writePage(garden, "learning/1. Why Alpha Matters/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(result.issuesBefore.some((i) => i.type === "duplicate_unit_page"));
  assert.ok(
    fs.existsSync(path.join(garden, "learning", "1. Current", "1.1 Alpha.md")),
  );
  assert.equal(
    fs.existsSync(
      path.join(garden, "learning", "1. Why Alpha Matters", "1.1 Alpha.md"),
    ),
    false,
  );
  assert.ok(result.pagesKept.includes("learning/1. Current/1.1 Alpha.md"));
});

test("10. two older-build duplicates are both removed and the unit is regenerated", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. A/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "OLD1",
  });
  writePage(garden, "learning/1. B/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "OLD2",
  });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.equal(
    fs.existsSync(path.join(garden, "learning", "1. A", "1.1 Alpha.md")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(garden, "learning", "1. B", "1.1 Alpha.md")),
    false,
  );
  assert.ok(result.pagesRegenerated.includes("U1"));
});

test("11. a missing unit page is flagged for regeneration", () => {
  const contract = [unit("U1", "Alpha"), unit("U2", "Beta")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  const result = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.ok(
    result.issuesBefore.some(
      (i) => i.type === "missing_unit_page" && i.unitId === "U2",
    ),
  );
  assert.ok(result.pagesRegenerated.includes("U2"));
});

test("18. structural reconciliation is idempotent on a clean tree", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  const first = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.equal(first.changed, false);
  assert.deepEqual(detectStructuralIssues(garden, contract, manifest), []);
  const second = reconcileActiveLearnStructure(garden, contract, manifest);
  assert.equal(second.changed, false);
  assert.equal(second.passed, true);
});

// ---------------------------------------------------------------------------
// Projection reset (Part 8) and recoverable classification (Part 14)
// ---------------------------------------------------------------------------

test("19-24. projection reset removes disposable projections, preserves durable inputs", () => {
  const contract = [unit("U1", "Alpha")];
  const { garden, manifest } = gardenWithManifest(contract);
  fs.writeFileSync(path.join(garden, ".breadboard", "claims.json"), "{}");
  fs.writeFileSync(
    path.join(garden, ".breadboard", "source-visuals.json"),
    "[]",
  );
  fs.mkdirSync(path.join(garden, "sources"), { recursive: true });
  fs.writeFileSync(path.join(garden, "sources", "s.md"), "x");
  const result = resetDisposableLearnProjections(garden, manifest);
  assert.ok(result.removed.includes(".breadboard/claims.json"));
  assert.equal(
    fs.existsSync(path.join(garden, ".breadboard", "claims.json")),
    false,
  );
  assert.ok(
    fs.existsSync(path.join(garden, ".breadboard", "source-visuals.json")),
  ); // durable preserved
  assert.ok(result.preservedDurableInputs.includes("sources"));
});

test("35. recoverable vs terminal issue classification", () => {
  assert.equal(isRecoverableLearnIssue({ type: "duplicate_unit_page" }), true);
  assert.equal(isRecoverableLearnIssue({ type: "stale_claim_mapping" }), true);
  assert.equal(
    isRecoverableLearnIssue({ type: "source_evidence_unavailable" }),
    false,
  );
  assert.equal(
    isRecoverableLearnIssue({ type: "repair_budget_exhausted" }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Atomic promotion + garden lock (Parts 16-17, tests 44-50)
// ---------------------------------------------------------------------------

test("45/47. atomic promotion swaps in the staging tree without a mixed result", async () => {
  const parent = tmp("promote");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(path.join(staging, "learning"), { recursive: true });
  fs.writeFileSync(path.join(staging, "learning", "new.md"), "new");
  const dest = path.join(parent, "published");
  fs.mkdirSync(path.join(dest, "learning"), { recursive: true });
  fs.writeFileSync(path.join(dest, "learning", "old.md"), "old");
  const result = await promoteStagingGarden({
    stagingGardenDir: staging,
    destinationGardenDir: dest,
  });
  assert.equal(result.promoted, true);
  assert.ok(fs.existsSync(path.join(dest, "learning", "new.md")));
  assert.equal(fs.existsSync(path.join(dest, "learning", "old.md")), false); // fully swapped, not merged
});

test("46. failed manifest verification preserves the previous published garden", async () => {
  const parent = tmp("promote2");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "x.md"), "new");
  const dest = path.join(parent, "published");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "keep.md"), "old");
  const result = await promoteStagingGarden({
    stagingGardenDir: staging,
    destinationGardenDir: dest,
    verifyManifest: () => false,
  });
  assert.equal(result.promoted, false);
  assert.ok(fs.existsSync(path.join(dest, "keep.md"))); // previous preserved intact
});

test("46a. promoted candidate keeps the logical garden basename during verification", async () => {
  const parent = tmp("promote-logical-name");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "candidate.md"), "new");
  const destination = path.join(parent, "electromagnetism-1");

  let verifiedCandidate = "";
  const result = await promoteStagingGarden({
    stagingGardenDir: staging,
    destinationGardenDir: destination,
    verifyManifest: (candidate) => {
      verifiedCandidate = candidate;
      return path.basename(candidate) === path.basename(destination);
    },
  });

  assert.equal(result.promoted, true, result.reason);
  assert.equal(path.basename(verifiedCandidate), "electromagnetism-1");
  assert.equal(
    fs.readFileSync(path.join(destination, "candidate.md"), "utf8"),
    "new",
  );
});

test("46b. destination concurrency check aborts before swap", async () => {
  const parent = tmp("promote-concurrent");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "new.md"), "new");
  const dest = path.join(parent, "published");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "keep.md"), "concurrent edit");

  const result = await promoteStagingGarden({
    stagingGardenDir: staging,
    destinationGardenDir: dest,
    verifyCurrentDestination: () => false,
  });

  assert.equal(result.promoted, false);
  assert.match(result.reason, /destination changed while staging/);
  assert.equal(
    fs.readFileSync(path.join(dest, "keep.md"), "utf8"),
    "concurrent edit",
  );
  assert.equal(fs.existsSync(path.join(dest, "new.md")), false);
});

test("46c. caller may retain the previous tree until a second resource commits", async () => {
  const parent = tmp("promote-retained");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "new.md"), "new");
  const dest = path.join(parent, "published");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "old.md"), "old");

  const result = await promoteStagingGarden({
    stagingGardenDir: staging,
    destinationGardenDir: dest,
    retainPreviousUntilCallerCommit: true,
  });

  assert.equal(result.promoted, true);
  assert.ok(result.previousPreservedAt);
  assert.equal(
    fs.readFileSync(path.join(result.previousPreservedAt, "old.md"), "utf8"),
    "old",
  );
  assert.equal(fs.readFileSync(path.join(dest, "new.md"), "utf8"), "new");
});

test("47b. an active garden lock remains visible throughout atomic publication", async () => {
  const parent = tmp("promote-locked");
  const staging = path.join(parent, "staging");
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, "new.md"), "new");
  const dest = path.join(parent, "published");
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, "old.md"), "old");
  const lock = acquireGardenLearnLock(dest, {
    gardenSlug: "g",
    jobId: "publishing-job",
    buildId: "publishing-build",
  });
  assert.equal(lock.acquired, true);

  const result = await promoteStagingGarden({
    stagingGardenDir: staging,
    destinationGardenDir: dest,
  });
  assert.equal(result.promoted, true);
  assert.equal(readGardenLearnLock(dest)?.jobId, "publishing-job");
  const competitor = acquireGardenLearnLock(dest, {
    gardenSlug: "g",
    jobId: "competing-job",
    buildId: "competing-build",
  });
  assert.equal(competitor.acquired, false);
  releaseGardenLearnLock(dest, "publishing-job");
});

test("47c. a legacy in-garden lock is honored and migrated to stable storage", () => {
  const garden = tmp("legacy-lock");
  const legacyPath = path.join(garden, ".breadboard", "learn-build.lock.json");
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  const timestamp = new Date().toISOString();
  fs.writeFileSync(
    legacyPath,
    `${JSON.stringify({
      gardenSlug: "g",
      jobId: "legacy-job",
      buildId: "legacy-build",
      acquiredAt: timestamp,
      heartbeatAt: timestamp,
    })}\n`,
  );

  const blocked = acquireGardenLearnLock(garden, {
    gardenSlug: "g",
    jobId: "other-job",
    buildId: "other-build",
  });
  assert.equal(blocked.acquired, false);
  const resumed = acquireGardenLearnLock(garden, {
    gardenSlug: "g",
    jobId: "legacy-job",
    buildId: "legacy-build",
  });
  assert.equal(resumed.acquired, true);
  assert.equal(fs.existsSync(legacyPath), false);
  assert.equal(readGardenLearnLock(garden)?.jobId, "legacy-job");
  releaseGardenLearnLock(garden, "legacy-job");
});

test("48/50. a heartbeat keeps a long job fresh; a truly stale lock is recoverable", () => {
  const garden = tmp("lock");
  const started = Date.now();
  const first = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "job1", buildId: "b1" },
    started,
  );
  assert.equal(first.acquired, true);
  const second = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "job2", buildId: "b2" },
    started,
  );
  assert.equal(second.acquired, false);

  // The job has existed for more than five minutes, but its recent heartbeat
  // prevents another process from stealing valid ownership.
  assert.equal(
    heartbeatGardenLearnLock(garden, "job1", started + 4 * 60 * 1000),
    true,
  );
  const stillOwned = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "job2", buildId: "b2" },
    started + 6 * 60 * 1000,
  );
  assert.equal(stillOwned.acquired, false);

  // Once that heartbeat itself is stale, takeover is allowed.
  const takeover = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "job2", buildId: "b2" },
    started + 10 * 60 * 1000,
  );
  assert.equal(takeover.acquired, true);
  assert.equal(
    heartbeatGardenLearnLock(garden, "job1", started + 11 * 60 * 1000),
    false,
  );
  releaseGardenLearnLock(garden, "job1");
  assert.equal(readGardenLearnLock(garden)?.jobId, "job2");
  releaseGardenLearnLock(garden, "job2");
});

test("48b. atomic acquisition lets exactly one competing process win", async () => {
  const garden = tmp("lock-race");
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      runLockContender(garden, `job-${index}`),
    ),
  );
  assert.equal(results.filter((result) => result.acquired).length, 1);
  const winner = readGardenLearnLock(garden);
  assert.ok(winner);
  releaseGardenLearnLock(garden, winner.jobId);
});

test("48c. repeated public owner fields do not make a fresh lease reentrant", async () => {
  const garden = tmp("lock-same-owner-race");
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      runLockContender(garden, "same-job", "same-build"),
    ),
  );
  assert.equal(results.filter((result) => result.acquired).length, 1);
  const winner = readGardenLearnLock(garden);
  assert.ok(winner?.leaseId);
  releaseGardenLearnLock(garden, "same-job");
});

test("48d. only the returned lease token can explicitly resume a fresh owner", () => {
  const garden = tmp("lock-authenticated-resume");
  const first = acquireGardenLearnLock(garden, {
    gardenSlug: "g",
    jobId: "same-job",
    buildId: "same-build",
  });
  assert.equal(first.acquired, true);
  if (!first.acquired || !first.lock.leaseId) return;

  const ordinaryRetry = acquireGardenLearnLock(garden, {
    gardenSlug: "g",
    jobId: "same-job",
    buildId: "same-build",
  });
  assert.equal(ordinaryRetry.acquired, false);

  const authenticatedRetry = resumeGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "same-job", buildId: "same-build" },
    first.lock.leaseId,
  );
  assert.equal(authenticatedRetry.acquired, true);
  if (authenticatedRetry.acquired) {
    assert.equal(authenticatedRetry.lock.leaseId, first.lock.leaseId);
  }
  releaseGardenLearnLock(garden, "same-job");
});

test("49. the auto-renewing lease remains owned beyond the original stale boundary", async () => {
  const garden = tmp("lock-lease");
  const started = Date.now();
  let clock = started;
  const result = acquireGardenLearnLease(
    garden,
    { gardenSlug: "g", jobId: "long-job", buildId: "long-build" },
    { heartbeatIntervalMs: 10, now: () => clock },
  );
  assert.equal(result.acquired, true);
  if (!result.acquired) return;

  const duplicate = acquireGardenLearnLease(
    garden,
    { gardenSlug: "g", jobId: "long-job", buildId: "long-build" },
    { heartbeatIntervalMs: 10, now: () => clock },
  );
  assert.equal(duplicate.acquired, false);

  clock = started + LOCK_STALE_MS + 1000;
  await eventually(
    () => Date.parse(readGardenLearnLock(garden)?.heartbeatAt ?? "") === clock,
  );
  const competitor = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "other-job", buildId: "other-build" },
    clock + LOCK_STALE_MS - 1,
  );
  assert.equal(competitor.acquired, false);
  assert.equal(result.lease.lost, false);
  assert.equal(result.lease.release(), true);
  assert.equal(readGardenLearnLock(garden), null);
});

test("49b. a live process-bound mutation lease survives a blocked heartbeat but expires absolutely", () => {
  const garden = tmp("lock-process-bound");
  const started = Date.now();
  const processBoundMs = 10 * 60 * 1000;
  const original = acquireGardenLearnLease(
    garden,
    {
      gardenSlug: "g",
      jobId: "blocked-ingestion",
      buildId: "blocked-ingestion-build",
    },
    {
      now: () => started,
      processBoundStaleMs: processBoundMs,
    },
  );
  assert.equal(original.acquired, true);
  if (!original.acquired) return;

  const whileAlive = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "ordinary-edit", buildId: "ordinary-edit-build" },
    started + LOCK_STALE_MS + 1,
  );
  assert.equal(whileAlive.acquired, false);

  const ordinaryLearnAfterAbsoluteExpiry = acquireGardenLearnLease(
    garden,
    {
      gardenSlug: "g",
      jobId: "ordinary-learn",
      buildId: "ordinary-learn-build",
    },
    { now: () => started + processBoundMs + 1 },
  );
  assert.equal(ordinaryLearnAfterAbsoluteExpiry.acquired, false);

  const afterAbsoluteExpiry = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "recovery", buildId: "recovery-build" },
    started + processBoundMs + 1,
  );
  assert.equal(afterAbsoluteExpiry.acquired, true);
  assert.equal(original.lease.release(), false);
  assert.equal(readGardenLearnLock(garden)?.jobId, "recovery");
  releaseGardenLearnLock(garden, "recovery");
});

test("50b. an old fenced lease cannot release a stale takeover with the same job id", () => {
  const garden = tmp("lock-fence");
  const started = Date.now();
  const original = acquireGardenLearnLease(
    garden,
    { gardenSlug: "g", jobId: "resumed-job", buildId: "old-build" },
    { now: () => started },
  );
  assert.equal(original.acquired, true);
  if (!original.acquired) return;

  const takeover = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "resumed-job", buildId: "new-build" },
    started + LOCK_STALE_MS + 1,
  );
  assert.equal(takeover.acquired, true);
  assert.equal(original.lease.release(), false);
  assert.equal(readGardenLearnLock(garden)?.buildId, "new-build");
  releaseGardenLearnLock(garden, "resumed-job");
});

test("50c. lease ownership confirmation reports an exact fenced owner", () => {
  const garden = tmp("lock-confirm-owned");
  const result = acquireGardenLearnLease(garden, {
    gardenSlug: "g",
    jobId: "confirmed-job",
    buildId: "confirmed-build",
  });
  assert.equal(result.acquired, true);
  if (!result.acquired) return;

  assert.equal(result.lease.confirmOwnership(), "owned");
  assert.equal(result.lease.lost, false);
  assert.equal(result.lease.release(), true);
});

test("50d. guard contention and unreadable state remain uncertain, not lost", () => {
  const garden = tmp("lock-confirm-uncertain");
  const result = acquireGardenLearnLease(garden, {
    gardenSlug: "g",
    jobId: "uncertain-job",
    buildId: "uncertain-build",
  });
  assert.equal(result.acquired, true);
  if (!result.acquired) return;

  const stableLock = stableGardenLearnLockPath(garden);
  const mutationGuard = `${stableLock}.guard`;
  fs.mkdirSync(mutationGuard);
  try {
    assert.equal(result.lease.confirmOwnership(), "uncertain");
    assert.equal(result.lease.lost, false);
  } finally {
    fs.rmSync(mutationGuard, { recursive: true, force: true });
  }

  const expectedLock = result.lease.lock;
  fs.writeFileSync(stableLock, "{temporarily incomplete", "utf8");
  assert.equal(result.lease.confirmOwnership(), "uncertain");
  assert.equal(result.lease.lost, false);

  fs.writeFileSync(
    stableLock,
    `${JSON.stringify(expectedLock, null, 2)}\n`,
    "utf8",
  );
  assert.equal(result.lease.confirmOwnership(), "owned");
  assert.equal(result.lease.release(), true);
});

test("50e. same-job replacement token is definitive fenced ownership loss", () => {
  const garden = tmp("lock-confirm-token-loss");
  const started = Date.now();
  const original = acquireGardenLearnLease(
    garden,
    { gardenSlug: "g", jobId: "reused-job", buildId: "old-build" },
    { now: () => started },
  );
  assert.equal(original.acquired, true);
  if (!original.acquired) return;

  const replacement = acquireGardenLearnLock(
    garden,
    { gardenSlug: "g", jobId: "reused-job", buildId: "new-build" },
    started + LOCK_STALE_MS + 1,
  );
  assert.equal(replacement.acquired, true);
  if (!replacement.acquired) return;
  assert.notEqual(replacement.lock.leaseId, original.lease.lock.leaseId);

  assert.equal(original.lease.confirmOwnership(), "lost");
  assert.equal(original.lease.lost, true);
  assert.equal(readGardenLearnLock(garden)?.leaseId, replacement.lock.leaseId);
  releaseGardenLearnLock(garden, "reused-job");
});

// ---------------------------------------------------------------------------
// Convergence loop (Parts 9-11, 19, tests 25-35 subset)
// ---------------------------------------------------------------------------

test("11 (flag). LEARN_FINALIZATION_MODE defaults to legacy", () => {
  const prev = process.env.LEARN_FINALIZATION_MODE;
  delete process.env.LEARN_FINALIZATION_MODE;
  assert.equal(learnFinalizationMode(), "legacy");
  process.env.LEARN_FINALIZATION_MODE = "convergent";
  assert.equal(learnFinalizationMode(), "convergent");
  if (prev === undefined) delete process.env.LEARN_FINALIZATION_MODE;
  else process.env.LEARN_FINALIZATION_MODE = prev;
});

function convergenceWorkspace(contract, buildId = "cur") {
  const { garden, manifest } = gardenWithManifest(contract, buildId);
  const ws = {
    buildId,
    jobId: "job1",
    gardenSlug: "g",
    mode: "generate",
    repositoryGardenDir: garden,
    workspaceRoot: garden,
    stagingGardenDir: garden,
    stagingLearningDir: path.join(garden, "learning"),
    contractFingerprint: "cf",
    sourceSetFingerprint: "sf",
    createdAt: new Date().toISOString(),
  };
  return { ws, garden, manifest };
}

test("25/32. structural cleanup precedes semantics; loop stops accepted at zero blockers", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  let fp = 0;
  const result = await runLearnConvergenceLoop(ws, contract, {
    runSemanticPass: async () => ({
      issues: [],
      deterministicOperations: [],
      modelPackets: [],
      modelDecisionsReceived: 0,
      modelDecisionsVerified: 0,
      modelDecisionsRejected: 0,
      changedFiles: [],
    }),
    stateFingerprint: () => String(fp),
  });
  assert.equal(result.passed, true);
  assert.equal(result.stoppedReason, "accepted");
  assert.equal(result.finalBlockerCount, 0);
});

test("26/28. deterministic structural repair happens before ChatMock; a verified model repair commits", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  // A foreign page will be removed structurally in round 1; regen restores it.
  writePage(garden, "learning/1. Old/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "OLD",
  });
  let semanticCalls = 0;
  let fp = 0;
  const result = await runLearnConvergenceLoop(ws, contract, {
    regenerateUnitPages: async (unitIds) => {
      for (const id of unitIds)
        writePage(garden, `learning/1. Current/1.1 Alpha.md`, {
          learningUnitId: id,
          generatedByBuildId: "cur",
        });
      fp += 1;
      return unitIds.map((id) => `learning/1. Current/1.1 Alpha.md#${id}`);
    },
    runSemanticPass: async ({ round }) => {
      semanticCalls += 1;
      // Round 1 leaves one recoverable semantic blocker that a verified model
      // repair clears in round 2.
      if (round === 1) {
        fp += 1;
        return {
          issues: [
            {
              issueId: "sem:1",
              type: "contract_page_anchor",
              severity: "blocking",
              reason: "anchor drift",
            },
          ],
          deterministicOperations: [],
          modelPackets: [{}],
          modelDecisionsReceived: 1,
          modelDecisionsVerified: 1,
          modelDecisionsRejected: 0,
          changedFiles: ["learning/1. Current/1.1 Alpha.md"],
        };
      }
      fp += 1;
      return {
        issues: [],
        deterministicOperations: [],
        modelPackets: [],
        modelDecisionsReceived: 0,
        modelDecisionsVerified: 0,
        modelDecisionsRejected: 0,
        changedFiles: [],
      };
    },
    stateFingerprint: () => String(fp),
  });
  assert.equal(result.passed, true);
  assert.ok(semanticCalls >= 2);
  assert.equal(result.verifiedChatMockRepairs, 1);
});

test("33. loop stops on proven no-progress instead of churning", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  const result = await runLearnConvergenceLoop(
    ws,
    contract,
    {
      runSemanticPass: async () => ({
        issues: [
          {
            issueId: "sem:stuck",
            type: "contract_page_anchor",
            severity: "blocking",
            reason: "cannot fix",
          },
        ],
        deterministicOperations: [],
        modelPackets: [],
        modelDecisionsReceived: 0,
        modelDecisionsVerified: 0,
        modelDecisionsRejected: 0,
        changedFiles: [],
      }),
      stateFingerprint: () => "constant", // never changes → no progress
    },
    { enableChatMockRepairs: false },
  );
  assert.equal(result.passed, false);
  assert.equal(result.stoppedReason, "no_progress");
});

test("chatmock-unavailable with a non-deterministic blocker stops as chatmock_unavailable", async () => {
  const contract = [unit("U1", "Alpha")];
  const { ws, garden } = convergenceWorkspace(contract);
  writePage(garden, "learning/1. Current/1.1 Alpha.md", {
    learningUnitId: "U1",
    generatedByBuildId: "cur",
  });
  const result = await runLearnConvergenceLoop(ws, contract, {
    runSemanticPass: async () => ({
      issues: [
        {
          issueId: "sem:amb",
          type: "section_semantic_mismatch",
          severity: "blocking",
          reason: "ambiguous",
        },
      ],
      deterministicOperations: [],
      modelPackets: [],
      modelDecisionsReceived: 0,
      modelDecisionsVerified: 0,
      modelDecisionsRejected: 0,
      changedFiles: [],
      chatMockUnavailable: true,
    }),
    stateFingerprint: () => "s",
  });
  assert.equal(result.stoppedReason, "chatmock_unavailable");
});
