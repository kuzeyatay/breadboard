import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "../..");
const python = path.join(repository, "desktop/build-resources/runtimes/python/python.exe");
const source = path.join(repository, "LoopX");

test("LoopX completes a real tick with Rust Windows paths and bundled isolated Python", {
  skip: process.platform !== "win32" || !fs.existsSync(python) || !fs.existsSync(path.join(source, "loopx/entrypoint.py")),
  timeout: 60_000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-loopx-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const identity = { jobId: "job_loopx_paths", attempt: 1, workerInstanceId: "worker_paths" };
  const job = `runtime/jobs/${identity.jobId}`;
  const attempt = `${job}/attempts/1/${identity.workerInstanceId}`;
  fs.mkdirSync(path.join(root, attempt, "workspace"), { recursive: true });
  fs.writeFileSync(path.join(root, job, "input.json"), JSON.stringify({
    protocolVersion: 1, operation: "tick", conversationPublicId: "conv_path_regression",
    turnSequence: 1, objective: "Verify isolated runtime startup", outcome: "completed",
    toolCalls: 0, producedArtifact: false,
  }));
  fs.writeFileSync(path.join(root, attempt, "start.json"), JSON.stringify({
    protocolVersion: 1, identity,
    executionScope: { userId: 1, gardenId: null, conversationId: "conv_path_regression" },
    inputManifestPath: `${job}/input.json`, inputBlobs: [],
    workspacePath: `${attempt}/workspace`, checkpointPath: `${job}/checkpoint.json`, resultPath: `${job}/result.json`,
  }));
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    path.join(repository, "dashboard/scripts/runtime-v2-loopx-worker.mjs"), "start.json",
  ], {
    cwd: path.join(root, attempt), windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      BREADBOARD_LOOPX_ROOT: path.toNamespacedPath(source),
      BREADBOARD_LOOPX_PYTHON: path.toNamespacedPath(python),
      BREADBOARD_LOOPX_HOME: path.toNamespacedPath(path.join(root, "loopx-goals")),
      ENABLE_LOOPX: "1",
    },
  });
  const timer = setTimeout(() => child.kill(), 50_000);
  t.after(() => { clearTimeout(timer); if (child.exitCode === null) child.kill(); });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  clearTimeout(timer);
  assert.equal(code, 0, stderr);
  const events = stdout.trim().split(/\r?\n/u).map((line) => JSON.parse(line));
  assert.equal(events[0].type, "ready");
  assert.equal(events.at(-1).type, "complete", stderr);
  const result = JSON.parse(fs.readFileSync(path.join(root, job, "result.json"), "utf8"));
  assert.equal(result.result.ok, true, result.result.message);
  assert.equal(result.result.created, true);
  assert.equal(result.result.conversationPublicId, "conv_path_regression");
});
