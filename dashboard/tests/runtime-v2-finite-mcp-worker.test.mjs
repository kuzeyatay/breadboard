import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";

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

test("cancellation suppresses late checkpoints after acknowledgement", async (t) => {
  const made = fixture(t, { inputCount: 0 });
  const entry = path.join(made.dataRoot, "late-checkpoint.mjs");
  fs.writeFileSync(entry, `
    import { runRuntimeV2FiniteMcpWorker } from ${JSON.stringify(new URL("../scripts/runtime-v2-finite-mcp-worker-core.mjs", import.meta.url).href)};
    await runRuntimeV2FiniteMcpWorker({
      name: "late-checkpoint-test", validateRequest: value => value, expectedInputCount: () => 0,
      async execute(launch, signal, progress) {
        progress.checkpoint({ percent: 10 });
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
        await new Promise(resolve => setTimeout(resolve, 60));
        progress.checkpoint({ percent: 90 });
        return { complete: false };
      }
    });
  `);
  const child = spawn(process.execPath, [entry, "start.json"], { cwd: made.attemptRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = "";
  let stderr = "";
  let sent = false;
  child.stdout.on("data", chunk => {
    stdout += chunk;
    if (!sent && stdout.includes('"type":"progress"')) {
      sent = true;
      child.stdin.write('{"type":"stop","force":false}\n');
    }
  });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("worker cancellation timed out")); }, 10_000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", value => { clearTimeout(timer); resolve(value); });
  });
  assert.equal(code, 0, stderr);
  const events = stdout.trim().split("\n").map(JSON.parse);
  assert.equal(events.at(-1).type, "cancellation-acknowledged");
  assert.equal(events.some(event => event.current === 90), false);
  const checkpoint = JSON.parse(fs.readFileSync(path.join(made.dataRoot, made.manifest.checkpointPath), "utf8"));
  assert.equal(checkpoint.snapshot.percent, 10);
});

test("identical checkpoint percentages publish one bounded progress event", async (t) => {
  const made = fixture(t, { inputCount: 0 });
  const entry = path.join(made.dataRoot, "duplicate-progress.mjs");
  fs.writeFileSync(entry, `
    import { runRuntimeV2FiniteMcpWorker } from ${JSON.stringify(new URL("../scripts/runtime-v2-finite-mcp-worker-core.mjs", import.meta.url).href)};
    await runRuntimeV2FiniteMcpWorker({
      name: "duplicate-progress-test", validateRequest: value => value, expectedInputCount: () => 0,
      async execute(launch, signal, progress) {
        for (const percent of [12, 12, 12, 13, 13, 13]) progress.checkpoint({ percent });
        return { complete: true };
      }
    });
  `);
  const child = spawn(process.execPath, [entry, "start.json"], {
    cwd: made.attemptRoot,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("worker completion timed out")); }, 10_000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("exit", value => { clearTimeout(timer); resolve(value); });
  });
  assert.equal(code, 0, stderr);
  const events = stdout.trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    events.filter(event => event.type === "progress").map(event => event.current),
    [12, 13],
  );
  assert.equal(events.filter(event => event.type === "checkpoint").length, 1);
  assert.equal(events.at(-1).type, "complete");
});
