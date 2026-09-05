import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bindRuntimeV2LearnRequest,
  loadRuntimeV2LearnLaunch,
  parseRuntimeV2StopRecord,
  serializeRuntimeV2LearnResult,
  validateRuntimeV2LearnRequest,
} from "../scripts/runtime-v2-learn-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");

function fixture() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-v2-learn-worker-"));
  const identity = {
    jobId: "job_learn_1",
    attempt: 2,
    workerInstanceId: "worker_learn_1",
  };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  const contentPath = path.join(dataRoot, "quartz", "content");
  fs.mkdirSync(path.join(attemptRoot, "workspace"), { recursive: true });
  fs.mkdirSync(contentPath, { recursive: true });
  const request = {
    operation: "humanizer",
    contentPath,
    enabled: true,
  };
  const executionScope = {
    userId: 1,
    gardenId: "garden-1",
    conversationId: null,
  };
  fs.writeFileSync(path.join(jobRoot, "input.json"), JSON.stringify(request));
  fs.writeFileSync(
    path.join(attemptRoot, "start.json"),
    JSON.stringify({
      protocolVersion: 1,
      identity,
      executionScope,
      inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
      inputBlobs: [],
      workspacePath:
        `runtime/jobs/${identity.jobId}/attempts/${identity.attempt}/` +
        `${identity.workerInstanceId}/workspace`,
      checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
      resultPath: `runtime/jobs/${identity.jobId}/result.json`,
    }),
  );
  return {
    attemptRoot,
    contentPath,
    dataRoot,
    executionScope,
    identity,
    request,
  };
}

test("Runtime V2 Learn launch accepts only the exact fenced start-file layout", () => {
  const current = fixture();
  try {
    const launch = loadRuntimeV2LearnLaunch(["start.json"], current.attemptRoot);
    assert.deepEqual(launch.identity, current.identity);
    assert.deepEqual(launch.executionScope, current.executionScope);
    assert.deepEqual(launch.request, current.request);
    assert.equal(launch.dataRoot, fs.realpathSync.native(current.dataRoot));
    assert.equal(
      launch.resultRelativePath,
      `runtime/jobs/${current.identity.jobId}/result.json`,
    );
    assert.throws(
      () => loadRuntimeV2LearnLaunch(["other.json"], current.attemptRoot),
      /exactly the fixed start\.json argument/u,
    );

    const startPath = path.join(current.attemptRoot, "start.json");
    const stale = JSON.parse(fs.readFileSync(startPath, "utf8"));
    stale.identity.workerInstanceId = "worker_stale";
    fs.writeFileSync(startPath, JSON.stringify(stale));
    assert.throws(
      () => loadRuntimeV2LearnLaunch(["start.json"], current.attemptRoot),
      /not bound to its exact identity/u,
    );
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime V2 Learn request and result preserve the legacy operation fence", () => {
  const current = fixture();
  try {
    const scoped = bindRuntimeV2LearnRequest(
      current.request,
      current.executionScope,
      current.contentPath,
    );
    assert.equal(validateRuntimeV2LearnRequest(scoped, current.contentPath), scoped);
    assert.equal(scoped.userId, current.executionScope.userId);
    assert.equal(scoped.gardenId, current.executionScope.gardenId);
    const guidedPlan = {
      operation: "plan",
      baseURL: "http://127.0.0.1:43120/v1",
      model: "gpt-test",
      includedSourceIds: ["source-1"],
      syllabusSourceId: null,
      sourceOnly: true,
      includeSourceSnapshots: false,
      autoConfirmTopicMap: false,
      userInstruction: "Redo only topics after Maxwell's equations.",
    };
    assert.equal(
      bindRuntimeV2LearnRequest(
        guidedPlan,
        current.executionScope,
        current.contentPath,
      ).userInstruction,
      guidedPlan.userInstruction,
    );
    assert.throws(
      () =>
        bindRuntimeV2LearnRequest(
          { ...guidedPlan, userInstruction: "x".repeat(4_001) },
          current.executionScope,
          current.contentPath,
        ),
      /planning request is invalid/u,
    );
    for (const invalidGardenId of [
      "garden with space",
      "garden\nnewline",
      "gárden",
      "g".repeat(257),
    ]) {
      assert.throws(
        () =>
          bindRuntimeV2LearnRequest(
            current.request,
            { ...current.executionScope, gardenId: invalidGardenId },
            current.contentPath,
          ),
        /execution scope is invalid/u,
      );
    }
    assert.throws(
      () =>
        bindRuntimeV2LearnRequest(
          { ...current.request, userId: 99 },
          current.executionScope,
          current.contentPath,
        ),
      /must not duplicate authenticated userId/u,
    );
    assert.throws(
      () =>
        bindRuntimeV2LearnRequest(
          { ...current.request, contentPath: path.join(current.dataRoot, "foreign") },
          current.executionScope,
          current.contentPath,
        ),
      /mismatches its garden data authority/u,
    );
    const repair = {
      operation: "repair",
      baseURL: "http://127.0.0.1:43120/v1",
      model: "gpt-test",
      request: { gardenId: current.executionScope.gardenId, mode: "repair" },
    };
    assert.equal(
      bindRuntimeV2LearnRequest(
        repair,
        current.executionScope,
        current.contentPath,
      ).request.gardenId,
      current.executionScope.gardenId,
    );
    assert.throws(
      () =>
        bindRuntimeV2LearnRequest(
          { ...repair, request: { ...repair.request, gardenId: "other-garden" } },
          current.executionScope,
          current.contentPath,
        ),
      /repair request is invalid/u,
    );
    const recovery = bindRuntimeV2LearnRequest(
      { operation: "recovery" },
      { userId: null, gardenId: null, conversationId: null },
      current.contentPath,
    );
    assert.deepEqual(recovery, {
      operation: "recovery",
      contentPath: current.contentPath,
    });
    assert.throws(
      () =>
        bindRuntimeV2LearnRequest(
          { operation: "recovery" },
          current.executionScope,
          current.contentPath,
        ),
      /unscoped native scheduler authority/u,
    );
    assert.throws(
      () =>
        bindRuntimeV2LearnRequest(
          { operation: "recovery", executable: "node" },
          { userId: null, gardenId: null, conversationId: null },
          current.contentPath,
        ),
      /unscoped native scheduler authority/u,
    );
    const bytes = serializeRuntimeV2LearnResult({
      identity: current.identity,
      completionSequence: 4,
      operation: "humanizer",
      learnJobId: "learn-job-1",
      value: { enabled: true },
    });
    assert.deepEqual(JSON.parse(bytes.toString("utf8")), {
      protocolVersion: 1,
      identity: current.identity,
      completionSequence: 4,
      result: {
        operation: "humanizer",
        learnJobId: "learn-job-1",
        value: { enabled: true },
      },
    });
  } finally {
    fs.rmSync(current.dataRoot, { recursive: true, force: true });
  }
});

test("Runtime V2 Learn cooperative cancellation accepts one exact stdin record", () => {
  assert.deepEqual(parseRuntimeV2StopRecord('{"type":"stop","force":false}\n'), {
    type: "stop",
    force: false,
  });
  for (const invalid of [
    '{"type":"stop","force":true}\n',
    '{"type":"stop","force":false,"extra":1}\n',
    '{"type":"stop","force":false}',
    '{}\n',
  ]) {
    assert.throws(() => parseRuntimeV2StopRecord(invalid), /stop record/u);
  }
});

test("Runtime V2 Learn permits two finite native-owned workers with packaged staging", () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "desktop", "runtime-v2", "manifests", "workers.json"),
      "utf8",
    ),
  );
  const workerKinds = manifest.workers.map(({ kind }) => kind);
  assert.equal(new Set(workerKinds).size, workerKinds.length);
  for (const required of [
    "learn-node",
    "document-ingestion-node",
    "quartz-publish-node",
  ]) {
    assert.ok(workerKinds.includes(required), required);
  }
  const worker = manifest.workers.find(({ kind }) => kind === "learn-node");
  assert.deepEqual(worker.jobTypes, ["learn"]);
  assert.equal(worker.allowedEntrypoint, "dashboard/scripts/runtime-v2-learn-worker.mjs");
  assert.equal(worker.maximumConcurrency, 2);
  assert.equal(worker.exitAfterJob, true);

  const source = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-learn-worker.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /node:child_process|\b(?:fork|spawn)\s*\(|detached\s*:|process\.send|process\.on\(["']message/u);
  assert.match(source, /executeAdmittedLearnOperation/u);
  assert.match(source, /cancellationAcknowledged/u);
  assert.match(source, /completionSequence/u);
  assert.match(source, /createRuntimeV2WorkerEventWriter/u);
  assert.match(source, /sourceRoot: layout\.quartzSourceRoot/u);
  assert.match(
    source,
    /temporaryDirectory = path\.join\(launch\.dataRoot, "runtime-v2", "temp"\)[\s\S]*?fs\.mkdirSync\(temporaryDirectory, \{ recursive: true \}\)[\s\S]*?process\.env\.TEMP = temporaryDirectory[\s\S]*?process\.env\.TMP = temporaryDirectory/u,
  );
  const eventWriter = fs.readFileSync(
    path.join(dashboardRoot, "scripts", "runtime-v2-worker-events.mjs"),
    "utf8",
  );
  assert.match(eventWriter, /cancellation-acknowledged/u);
  assert.match(eventWriter, /node:worker_threads/u);
  assert.doesNotMatch(eventWriter, /setInterval/u);

  const staging = fs.readFileSync(
    path.join(repoRoot, "desktop", "scripts", "prepare-app-resources.mjs"),
    "utf8",
  );
  assert.match(staging, /"runtime-v2-learn-worker\.mjs"/u);
  assert.match(staging, /"runtime-v2-worker-events\.mjs"/u);
  assert.match(staging, /"learn-worker-import-hook\.mjs"/u);
  assert.match(staging, /worker-src/u);
});
