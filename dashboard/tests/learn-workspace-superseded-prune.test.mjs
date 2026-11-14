import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createLearnBuildWorkspace,
  pruneSupersededLearnBuildWorkspaces,
  retainLearnBuildWorkspace,
  sweepSupersededLearnBuildWorkspaces,
} from "../src/lib/learn-build-workspace.ts";

function withRuntimeRoot(run) {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "superseded-prune-"));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "superseded-prune-repo-"));
  fs.writeFileSync(path.join(repo, "durable.md"), "durable input\n");
  const saved = { runtime: process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR, data: process.env.BREADBOARD_DATA_DIR };
  process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = runtimeRoot;
  delete process.env.BREADBOARD_DATA_DIR;
  try {
    run({ repo, gardenSlug: `g-superseded-${crypto.randomUUID()}` });
  } finally {
    if (saved.runtime === undefined) delete process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR;
    else process.env.BREADBOARD_LEARN_WORKER_RUNTIME_DIR = saved.runtime;
    if (saved.data !== undefined) process.env.BREADBOARD_DATA_DIR = saved.data;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

function workspace(repo, gardenSlug, jobId) {
  return createLearnBuildWorkspace({
    gardenSlug,
    jobId,
    mode: "regenerate",
    repositoryGardenDir: repo,
    contractFingerprint: "cf",
    sourceSetFingerprint: "sf",
  });
}

function writeReceipts(ws, pages) {
  fs.mkdirSync(ws.stagingLearningDir, { recursive: true });
  const file = path.join(ws.stagingGardenDir, ".breadboard", "Internal", "learn-accepted-pages.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, pages: Object.fromEntries(pages.map((page) => [page, {}])) }));
}

function retain(ws, at) {
  retainLearnBuildWorkspace(ws, { reason: "generation_failure", retainedAt: at });
}

test("a resume source is kept while its resumed run is still active", () => {
  withRuntimeRoot(({ repo, gardenSlug }) => {
    const first = workspace(repo, gardenSlug, "job-a");
    writeReceipts(first, ["1.1", "1.2"]);
    retain(first, "2026-10-14T10:00:00.000Z");
    const resumed = workspace(repo, gardenSlug, "job-b");
    assert.equal(resumed.resumedFromJobId, "job-a");

    assert.deepEqual(sweepSupersededLearnBuildWorkspaces(), []);
    assert.ok(fs.existsSync(first.workspaceRoot), "source of a running resume must survive");
    assert.ok(fs.existsSync(resumed.workspaceRoot), "active workspace must survive");
  });
});

test("a receipt superset alone cannot dispose unique ancestor bytes", () => {
  withRuntimeRoot(({ repo, gardenSlug }) => {
    const first = workspace(repo, gardenSlug, "job-a");
    writeReceipts(first, ["1.1"]);
    retain(first, "2026-10-14T10:00:00.000Z");
    const second = workspace(repo, gardenSlug, "job-b");
    writeReceipts(second, ["1.1", "1.2"]);
    retain(second, "2026-10-14T11:00:00.000Z");
    const third = workspace(repo, gardenSlug, "job-c");
    assert.equal(third.resumedFromJobId, "job-b");
    writeReceipts(third, ["1.1", "1.2", "1.3"]);
    // A new receipt is not proof that every old draft and output survived.
    retain(third, "2026-10-14T12:00:00.000Z");

    assert.ok(fs.existsSync(first.workspaceRoot));
    assert.ok(fs.existsSync(second.workspaceRoot));
    assert.ok(fs.existsSync(third.workspaceRoot), "newest complete copy always survives");
  });
});

test("an ancestor with a receipt its successor lacks is kept", () => {
  withRuntimeRoot(({ repo, gardenSlug }) => {
    const first = workspace(repo, gardenSlug, "job-a");
    writeReceipts(first, ["1.1", "1.2"]);
    retain(first, "2026-10-14T10:00:00.000Z");
    const second = workspace(repo, gardenSlug, "job-b");
    writeReceipts(second, ["1.1"]);
    retain(second, "2026-10-14T11:00:00.000Z");

    assert.deepEqual(pruneSupersededLearnBuildWorkspaces({ gardenSlug }), []);
    assert.ok(fs.existsSync(first.workspaceRoot), "a lesson only the ancestor holds must not be lost");
  });
});

test("unrelated retained workspaces and active trees are never touched", () => {
  withRuntimeRoot(({ repo, gardenSlug }) => {
    const unrelated = createLearnBuildWorkspace({
      gardenSlug,
      jobId: "job-other-contract",
      mode: "regenerate",
      repositoryGardenDir: repo,
      contractFingerprint: "cf-other",
      sourceSetFingerprint: "sf",
    });
    retain(unrelated, "2026-10-14T09:00:00.000Z");
    const active = workspace(repo, gardenSlug, "job-active");
    assert.equal(active.resumedFromJobId, undefined);

    assert.deepEqual(pruneSupersededLearnBuildWorkspaces({ gardenSlug }), []);
    assert.ok(fs.existsSync(unrelated.workspaceRoot));
    assert.ok(fs.existsSync(active.workspaceRoot));
  });
});

test("a deterministically corrupt successor never supersedes a valid checkpoint", () => {
  withRuntimeRoot(({ repo, gardenSlug }) => {
    const valid = workspace(repo, gardenSlug, "job-a");
    writeReceipts(valid, ["1.1"]);
    fs.writeFileSync(path.join(valid.stagingGardenDir, ".breadboard", "acceptance-status.json"), JSON.stringify({ deterministicPass: true }));
    retain(valid, "2026-10-14T10:00:00.000Z");
    const corrupt = workspace(repo, gardenSlug, "job-b");
    assert.equal(corrupt.resumedFromJobId, "job-a");
    writeReceipts(corrupt, ["1.1", "1.2"]);
    fs.writeFileSync(path.join(corrupt.stagingGardenDir, ".breadboard", "acceptance-status.json"), JSON.stringify({ deterministicPass: false }));
    retain(corrupt, "2026-10-14T11:00:00.000Z");

    assert.ok(fs.existsSync(valid.workspaceRoot), "the valid checkpoint must survive a corrupt successor");
  });
});
