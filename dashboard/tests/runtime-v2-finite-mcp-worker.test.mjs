import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalRuntimeInput,
  loadRuntimeV2FiniteMcpLaunch,
} from "../scripts/runtime-v2-finite-mcp-worker-core.mjs";

function fixture(t, { inputCount = 1 } = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-finite-mcp-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const identity = { jobId: "job_test", attempt: 1, workerInstanceId: "worker_test" };
  const jobRoot = path.join(dataRoot, "runtime", "jobs", identity.jobId);
  const attemptRoot = path.join(
    jobRoot,
    "attempts",
    String(identity.attempt),
    identity.workerInstanceId,
  );
  const workspace = path.join(attemptRoot, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(jobRoot, "input.json"), '{"operation":"test"}\n');
  const inputBlobs = [];
  for (let index = 0; index < inputCount; index += 1) {
    const blobId = `blob_${index + 1}`;
    const relativePath = `runtime/jobs/${identity.jobId}/inputs/${blobId}/payload`;
    const payload = path.join(dataRoot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(payload), { recursive: true });
    const bytes = Buffer.from(`sealed-${index + 1}`, "utf8");
    fs.writeFileSync(payload, bytes);
    inputBlobs.push({
      blobId,
      relativePath,
      sizeBytes: bytes.byteLength,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      displayName: `track-${index + 1}.wav`,
      mediaType: "audio/wav",
    });
  }
  const manifest = {
    protocolVersion: 1,
    identity,
    executionScope: { userId: 7, gardenId: "garden", conversationId: "conversation" },
    inputManifestPath: `runtime/jobs/${identity.jobId}/input.json`,
    inputBlobs,
    workspacePath: `runtime/jobs/${identity.jobId}/attempts/1/${identity.workerInstanceId}/workspace`,
    checkpointPath: `runtime/jobs/${identity.jobId}/checkpoint.json`,
    resultPath: `runtime/jobs/${identity.jobId}/result.json`,
  };
  const start = path.join(attemptRoot, "start.json");
  fs.writeFileSync(start, `${JSON.stringify(manifest)}\n`);
  return { dataRoot, attemptRoot, workspace, manifest, start };
}

const validateRequest = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).join(",") !== "operation" ||
    value.operation !== "test"
  ) throw new Error("invalid test request");
  return value;
};

test("the shared finite MCP worker accepts only identity-bound sealed inputs", (t) => {
  const made = fixture(t);
  const launch = loadRuntimeV2FiniteMcpLaunch({
    argv: ["start.json"],
    launchDirectory: made.attemptRoot,
    validateRequest,
    expectedInputCount: () => 1,
  });
  assert.equal(launch.dataRoot, fs.realpathSync.native(made.dataRoot));
  assert.deepEqual(launch.executionScope, {
    userId: 7,
    gardenId: "garden",
    conversationId: "conversation",
  });
  assert.equal(canonicalRuntimeInput(launch, 0), path.join(
    made.dataRoot,
    ...made.manifest.inputBlobs[0].relativePath.split("/"),
  ));
  assert.throws(() => canonicalRuntimeInput(launch, 1), /input is unavailable/);
});

test("a finite worker may tighten the shared execution scope for a user-global operation", (t) => {
  const made = fixture(t, { inputCount: 0 });
  const manifest = JSON.parse(fs.readFileSync(made.start, "utf8"));
  manifest.executionScope = { userId: 7, gardenId: null, conversationId: null };
  fs.writeFileSync(made.start, `${JSON.stringify(manifest)}\n`);
  let examined = 0;
  const launch = loadRuntimeV2FiniteMcpLaunch({
    argv: ["start.json"],
    launchDirectory: made.attemptRoot,
    validateRequest,
    validateExecutionScope(value) {
      examined += 1;
      assert.deepEqual(value, { userId: 7, gardenId: null, conversationId: null });
      return value;
    },
    expectedInputCount: () => 0,
  });
  assert.equal(examined, 1);
  assert.deepEqual(launch.executionScope, manifest.executionScope);
});

test("the shared finite MCP worker rejects argv, path, size, and reparse escapes", (t) => {
  const made = fixture(t);
  const load = () => loadRuntimeV2FiniteMcpLaunch({
    argv: ["start.json"],
    launchDirectory: made.attemptRoot,
    validateRequest,
    expectedInputCount: () => 1,
  });
  assert.throws(() => loadRuntimeV2FiniteMcpLaunch({
    argv: ["start.json", "--command", "arbitrary.exe"],
    launchDirectory: made.attemptRoot,
    validateRequest,
    expectedInputCount: () => 1,
  }), /exactly the fixed start\.json argument/);

  const original = JSON.parse(fs.readFileSync(made.start, "utf8"));
  fs.writeFileSync(made.start, `${JSON.stringify({
    ...original,
    resultPath: "runtime/jobs/another-job/result.json",
  })}\n`);
  assert.throws(load, /resultPath is not identity-bound/);

  fs.writeFileSync(made.start, `${JSON.stringify(original)}\n`);
  const payload = path.join(
    made.dataRoot,
    ...made.manifest.inputBlobs[0].relativePath.split("/"),
  );
  fs.writeFileSync(payload, "tampered");
  const launch = load();
  assert.throws(() => canonicalRuntimeInput(launch, 0), /failed its integrity check/);

  fs.rmSync(made.workspace, { recursive: true, force: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-finite-mcp-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  try {
    fs.symlinkSync(outside, made.workspace, process.platform === "win32" ? "junction" : "dir");
    assert.throws(load, /private workspace is unavailable/);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    t.diagnostic("symlink creation is not permitted on this host; source still rejects symbolic workspaces");
  }
});
