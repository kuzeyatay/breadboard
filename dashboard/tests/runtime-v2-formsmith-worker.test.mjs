import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

import {
  executeFormsmith,
} from "../scripts/runtime-v2-formsmith-executor.mjs";
import {
  expectedRuntimeV2FormsmithInputCount,
  validateRuntimeV2FormsmithRequest,
  validateRuntimeV2FormsmithScope,
} from "../scripts/runtime-v2-formsmith-worker.mjs";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(dashboardRoot, "..");
const stages = [
  { stage: "prepare", status: "running" },
  { stage: "prepare", status: "completed" },
  { stage: "depth", status: "running" },
  { stage: "depth", status: "completed" },
  { stage: "reconstruct", status: "running" },
  { stage: "reconstruct", status: "completed" },
];

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "formsmith-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "formsmith-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "formsmith-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "formsmith-stub",
        }));
        build.onResolve({ filter: /runtime-paths\.ts$/ }, () => ({
          path: "runtime-paths",
          namespace: "formsmith-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "formsmith-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /runtime-paths/, namespace: "formsmith-stub" }, () => ({
          loader: "js",
          contents: "export const repositoryRoot = () => process.cwd();",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "formsmith-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(code, message = code) {
                super(message);
                this.code = code;
              }
            }
            globalThis.__FormsmithRuntimeJobControlError = RuntimeJobControlError;
            const unused = async () => { throw new Error("use the injected Formsmith control"); };
            export const abandonRuntimeJobInput = unused;
            export const cancelRuntimeJob = unused;
            export const cancelRuntimeJobByIdempotencyKey = unused;
            export const inspectRuntimeJob = unused;
            export const isRuntimeV2ServiceControlConfigured = () => false;
            export const lookupRuntimeJobByIdempotencyKey = unused;
            export const readRuntimeJobOutput = unused;
            export const reserveRuntimeJobInput = unused;
            export const submitRuntimeJob = unused;
            export const uploadRuntimeJobInput = unused;
          `,
        }));
      },
    }],
  });
  const source = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}#formsmith-runtime-v2`);
}

const runtime = await loadClient();
let managerImport = 0;

async function loadRunManager() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "shaper", "run-manager.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "formsmith-manager-stubs",
      setup(build) {
        build.onResolve({ filter: /^\.\/artifact\.ts$/ }, () => ({
          path: "artifact",
          namespace: "formsmith-manager-stub",
        }));
        build.onResolve({ filter: /^\.\/uploads\.ts$/ }, () => ({
          path: "uploads",
          namespace: "formsmith-manager-stub",
        }));
        build.onResolve({ filter: /^\.\.\/runtime-paths\.ts$/ }, () => ({
          path: "runtime-paths",
          namespace: "formsmith-manager-stub",
        }));
        build.onResolve({ filter: /^\.\.\/runtime-v2\/formsmith-job\.ts$/ }, () => ({
          path: "formsmith-job",
          namespace: "formsmith-manager-stub",
        }));
        build.onLoad({ filter: /artifact/, namespace: "formsmith-manager-stub" }, () => ({
          loader: "js",
          contents: `
            export const openFormsmithArtifactContext = () => null;
            export const closeFormsmithArtifactContext = () => {};
            export const findPublishedFormsmithMesh = () => null;
            export const publishFormsmithMesh = () => { throw new Error("no fixture artifact context"); };
          `,
        }));
        build.onLoad({ filter: /uploads/, namespace: "formsmith-manager-stub" }, () => ({
          loader: "js",
          contents: "export const resolveFormsmithUpload = () => globalThis.__FormsmithManagerSource;",
        }));
        build.onLoad({ filter: /runtime-paths/, namespace: "formsmith-manager-stub" }, () => ({
          loader: "js",
          contents: "export const dashboardDataDir = () => globalThis.__FormsmithManagerDataRoot;",
        }));
        build.onLoad({ filter: /formsmith-job/, namespace: "formsmith-manager-stub" }, () => ({
          loader: "js",
          contents: `
            export const runFormsmithViaRuntime = (input) => globalThis.__FormsmithManagerRun(input);
            export const cancelFormsmithRuntimeRun = (input) => globalThis.__FormsmithManagerCancel(input);
          `,
        }));
      },
    }],
  });
  managerImport += 1;
  const source = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}#formsmith-manager-${managerImport}`);
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("The Formsmith manager fixture timed out.");
}

function writeGlb(target) {
  const bytes = Buffer.alloc(12);
  bytes.write("glTF", 0, "ascii");
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.byteLength, 8);
  fs.writeFileSync(target, bytes);
  return bytes;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function terminateFixtureProcessTree(pids) {
  const exactPids = [...new Set(pids)].filter(
    (pid) => Number.isSafeInteger(pid) && pid > 0 && processExists(pid),
  );
  if (process.platform === "win32") {
    const windowsRoot = process.env.SYSTEMROOT ?? process.env.WINDIR;
    const taskkill = windowsRoot
      ? path.join(windowsRoot, "System32", "taskkill.exe")
      : null;
    if (taskkill && fs.existsSync(taskkill)) {
      for (const pid of exactPids) {
        spawnSync(taskkill, ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 5_000,
        });
      }
      return;
    }
  }
  for (const pid of exactPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The exact fixture process may already have crossed its exit boundary.
    }
  }
}

function executorFixture(bridgeSource) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-formsmith-worker-"));
  const shaperRoot = path.join(dataRoot, "immutable-shaper");
  for (const relative of [
    "infer_shape.py",
    path.join("experimental", "workaround_dataproc.py"),
    path.join("model", "flow_matching", "shaper_denoiser.py"),
    path.join("model", "dino_and_ray_feature_extractor.py"),
  ]) {
    const target = path.join(shaperRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# immutable fixture\n");
  }
  const bridge = path.join(dataRoot, "formsmith-bridge.cjs");
  fs.writeFileSync(bridge, bridgeSource);
  const inputBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const inputPath = path.join(dataRoot, "runtime", "jobs", "job_formsmith", "inputs", "image");
  fs.mkdirSync(path.dirname(inputPath), { recursive: true });
  fs.writeFileSync(inputPath, inputBytes);
  const workspacePath = path.join(
    dataRoot,
    "runtime",
    "jobs",
    "job_formsmith",
    "attempts",
    "1",
    "worker_formsmith",
    "workspace",
  );
  fs.mkdirSync(workspacePath, { recursive: true });
  const stateRoot = path.join(dataRoot, "runtime-v2", "services", "formsmith");
  const launch = {
    dataRoot,
    identity: { jobId: "job_formsmith", attempt: 1, workerInstanceId: "worker_formsmith" },
    executionScope: { userId: 17, gardenId: null, conversationId: "conversation_formsmith" },
    request: {
      protocolVersion: 1,
      operation: "reconstruct",
      filename: "object.png",
      sizeBytes: inputBytes.byteLength,
    },
    inputBlobs: [{
      uploadId: "upload_formsmith",
      displayName: "object.png",
      mediaType: "image/png",
      sizeBytes: inputBytes.byteLength,
      sha256: "a".repeat(64),
      relativePath: "inputs/image",
    }],
    workspacePath,
  };
  const env = {
    SHAPER_ROOT: shaperRoot,
    SHAPER_PYTHON: process.execPath,
    SHAPER_BRIDGE: bridge,
    SHAPER_STATE_ROOT: stateRoot,
    SHAPER_TOOL_PATH: path.dirname(process.execPath),
    ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
    ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
    ...(process.env.COMSPEC ? { COMSPEC: process.env.COMSPEC } : {}),
    ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
  };
  return { dataRoot, shaperRoot, stateRoot, inputPath, inputBytes, launch, env };
}

function successBridge() {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'let input = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => { input += chunk; });',
    'process.stdin.on("end", () => {',
    '  const request = JSON.parse(input);',
    '  if (process.cwd() !== request.workspace) process.exit(31);',
    '  fs.mkdirSync(request.shaperStateRoot, { recursive: true });',
    '  fs.writeFileSync(path.join(request.shaperStateRoot, "worker-owned-state"), "ok");',
    '  const events = [',
    '    ["prepare", "started"], ["prepare", "completed"],',
    '    ["depth", "started"], ["depth", "completed"],',
    '    ["reconstruct", "started"], ["reconstruct", "completed"],',
    '  ];',
    '  for (const [stage, status] of events) console.log(JSON.stringify({ event: `stage.${status}`, stage }));',
    '  const mesh = path.join(request.workspace, "formsmith.glb");',
    '  const bytes = Buffer.alloc(12);',
    '  bytes.write("glTF", 0, "ascii");',
    '  bytes.writeUInt32LE(2, 4);',
    '  bytes.writeUInt32LE(bytes.length, 8);',
    '  fs.writeFileSync(mesh, bytes);',
    '  console.log(JSON.stringify({ event: "result", mesh, sizeBytes: bytes.length }));',
    '});',
  ].join("\n");
}

function hangingProcessTreeBridge() {
  return [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    'const { spawn } = require("node:child_process");',
    'const descendant = spawn(process.execPath, ["-e", "process.stdin.resume(); setInterval(() => {}, 1000)"], { cwd: process.cwd(), stdio: "ignore" });',
    'fs.writeFileSync(path.join(process.cwd(), "process-tree.json"), JSON.stringify([process.pid, descendant.pid]));',
    "process.stdin.resume(); setInterval(() => {}, 1000);",
  ].join("\n");
}

function snapshot(overrides = {}) {
  return {
    jobId: "job_formsmith_1",
    jobType: "formsmith",
    workerKind: "formsmith-node",
    resourceClass: "local-model",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_formsmith_1",
    gardenId: null,
    conversationId: "conversation_formsmith",
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 8,
    progressCurrent: 100,
    progressTotal: 100,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
    ...overrides,
  };
}

function resultEnvelope(job, result, identity = {}) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
      ...identity,
    },
    completionSequence: job.lastWorkerSequence,
    result,
  };
}

function stagePath(dataRoot, job) {
  return path.join(
    dataRoot,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "formsmith-stage",
  );
}

function relativeTo(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

function calls() {
  return { reservations: [], uploads: [], submissions: [], cancellations: [], keyCancellations: [], abandoned: [] };
}

function injectedControl(job, result, state, options = {}) {
  return {
    configured: () => true,
    async lookup(authority, key) {
      if (options.lookup === "found") return structuredClone(job);
      if (options.lookup === "running") return structuredClone(job);
      const ErrorType = globalThis.__FormsmithRuntimeJobControlError;
      throw new ErrorType("JOB_NOT_FOUND", `missing ${key}`);
    },
    async reserve(authority, request) {
      state.reservations.push({ authority: structuredClone(authority), request: structuredClone(request) });
      return {
        uploadId: "upload_formsmith_1",
        expiresAt: Date.now() + 60_000,
        maximumBytes: request.declaredSizeBytes,
        ...request,
      };
    },
    async upload(authority, reservation, body) {
      const reader = body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      state.uploads.push({ authority: structuredClone(authority), bytes });
      return {
        uploadId: reservation.uploadId,
        sizeBytes: bytes.byteLength,
        sha256: "b".repeat(64),
        displayName: reservation.displayName,
        mediaType: reservation.mediaType,
      };
    },
    async abandon(authority, uploadId) {
      state.abandoned.push({ authority: structuredClone(authority), uploadId });
    },
    async submit(authority, submission) {
      state.submissions.push({ authority: structuredClone(authority), submission: structuredClone(submission) });
      return structuredClone(job);
    },
    async inspect() {
      return structuredClone(job);
    },
    async readOutput(authority, jobId, kind) {
      if (kind === "checkpoint") {
        return {
          jobId,
          kind,
          content: {
            protocolVersion: 1,
            identity: { jobId: job.jobId, attempt: job.attempt, workerInstanceId: job.workerInstanceId },
            snapshot: { operation: "reconstruct", stages: [] },
          },
        };
      }
      return { jobId, kind, content: resultEnvelope(job, result, options.identity) };
    },
    async cancel(authority, jobId) {
      state.cancellations.push({ authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
    async cancelByIdempotencyKey(authority, key) {
      state.keyCancellations.push({ authority: structuredClone(authority), key });
      return { disposition: "cancelled" };
    },
  };
}

function clientFixture(t) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-formsmith-client-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const source = path.join(dataRoot, "source.png");
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(source, image);
  const job = snapshot();
  const stage = stagePath(dataRoot, job);
  fs.mkdirSync(stage, { recursive: true });
  const mesh = path.join(stage, "formsmith.glb");
  writeGlb(mesh);
  const result = {
    ok: true,
    operation: "reconstruct",
    meshRelativePath: relativeTo(dataRoot, mesh),
    meshSizeBytes: fs.statSync(mesh).size,
    durationMs: 123,
    stages,
  };
  const request = { uploadId: "a".repeat(32), filename: "object.png", sizeBytes: image.byteLength };
  return { dataRoot, source, image, job, stage, mesh, result, request };
}

test("Formsmith worker admits only the exact authenticated fixed protocol", () => {
  const reconstruct = {
    protocolVersion: 1,
    operation: "reconstruct",
    filename: "object.png",
    sizeBytes: 8,
  };
  assert.equal(expectedRuntimeV2FormsmithInputCount(validateRuntimeV2FormsmithRequest(reconstruct)), 1);
  assert.equal(expectedRuntimeV2FormsmithInputCount(validateRuntimeV2FormsmithRequest({
    protocolVersion: 1,
    operation: "probe",
  })), 0);
  assert.deepEqual(validateRuntimeV2FormsmithScope({
    userId: 17,
    gardenId: null,
    conversationId: "conversation_formsmith",
  }), {
    userId: 17,
    gardenId: null,
    conversationId: "conversation_formsmith",
  });
  assert.throws(
    () => validateRuntimeV2FormsmithRequest({ ...reconstruct, executable: "python.exe" }),
    /canonical Formsmith reconstruction request/u,
  );
  assert.throws(
    () => validateRuntimeV2FormsmithRequest({ ...reconstruct, filename: "../object.png" }),
    /canonical Formsmith reconstruction request/u,
  );
  assert.throws(
    () => validateRuntimeV2FormsmithScope({ userId: 17, gardenId: null, conversationId: null, env: {} }),
    /authenticated Runtime scope/u,
  );
});

test("Formsmith executor keeps source immutable and returns only a private GLB path", async (t) => {
  const value = executorFixture(successBridge());
  t.after(() => fs.rmSync(value.dataRoot, { recursive: true, force: true }));
  const sourceBefore = fs.readdirSync(value.shaperRoot, { recursive: true }).sort();
  const checkpoints = [];
  const result = await executeFormsmith(
    value.launch,
    new AbortController().signal,
    { checkpoint: (checkpoint) => checkpoints.push(structuredClone(checkpoint)) },
    value.inputPath,
    { env: value.env },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.stages, stages);
  assert.deepEqual(checkpoints.at(-1), { operation: "reconstruct", stages });
  assert.match(result.meshRelativePath, /workspace\/formsmith-stage\/formsmith\.glb$/u);
  assert.equal(fs.existsSync(path.join(value.stateRoot, "worker-owned-state")), true);
  assert.deepEqual(fs.readdirSync(value.shaperRoot, { recursive: true }).sort(), sourceBefore);
  assert.doesNotMatch(JSON.stringify(result), /base64|data:image|SHAPER_ROOT|SHAPER_PYTHON/u);
});

test("Formsmith executor cancellation terminates its Python process tree", async (t) => {
  const value = executorFixture(hangingProcessTreeBridge());
  let cleaned = false;
  let ownedPids = [];
  t.after(() => {
    if (!cleaned) {
      terminateFixtureProcessTree(ownedPids);
      fs.rmSync(value.dataRoot, { recursive: true, force: true });
    }
  });
  const controller = new AbortController();
  const execution = executeFormsmith(
    value.launch,
    controller.signal,
    { checkpoint() {} },
    value.inputPath,
    { env: value.env },
  );
  const processLedger = path.join(
    value.launch.workspacePath,
    "formsmith-stage",
    "process-tree.json",
  );
  await waitUntil(() => fs.existsSync(processLedger));
  ownedPids = JSON.parse(fs.readFileSync(processLedger, "utf8"));
  assert.equal(ownedPids.length, 2);
  assert.ok(ownedPids.every(processExists));
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(
    execution,
    (error) => error?.name === "AbortError",
  );
  assert.ok(ownedPids.every((pid) => !processExists(pid)), JSON.stringify(ownedPids));
  fs.rmSync(value.dataRoot, { recursive: true, force: true });
  cleaned = true;
});

test("concurrent Formsmith cancellations independently drain every owned tree", async (t) => {
  const fixtures = Array.from({ length: 3 }, () => executorFixture(hangingProcessTreeBridge()));
  const controllers = fixtures.map(() => new AbortController());
  const processLedgers = fixtures.map((value) => path.join(
    value.launch.workspacePath,
    "formsmith-stage",
    "process-tree.json",
  ));
  const ownedTrees = fixtures.map(() => []);
  let cleaned = false;
  t.after(() => {
    if (cleaned) return;
    for (const ownedPids of ownedTrees) terminateFixtureProcessTree(ownedPids);
    for (const value of fixtures) {
      fs.rmSync(value.dataRoot, { recursive: true, force: true });
    }
  });

  const executions = fixtures.map((value, index) => executeFormsmith(
    value.launch,
    controllers[index].signal,
    { checkpoint() {} },
    value.inputPath,
    { env: value.env },
  ));
  await Promise.all(processLedgers.map((ledger) => waitUntil(() => fs.existsSync(ledger))));
  for (const [index, ledger] of processLedgers.entries()) {
    ownedTrees[index] = JSON.parse(fs.readFileSync(ledger, "utf8"));
    assert.equal(ownedTrees[index].length, 2);
    assert.ok(ownedTrees[index].every(processExists));
  }

  for (const controller of controllers) {
    controller.abort(new DOMException("Stopped", "AbortError"));
  }
  const outcomes = await Promise.allSettled(executions);
  assert.ok(outcomes.every(
    (outcome) => outcome.status === "rejected" && outcome.reason?.name === "AbortError",
  ));
  assert.ok(ownedTrees.flat().every((pid) => !processExists(pid)), JSON.stringify(ownedTrees));

  for (const value of fixtures) {
    fs.rmSync(value.dataRoot, { recursive: true, force: true });
  }
  cleaned = true;
});

test("Formsmith executor refuses a cache symlink outside Runtime state", async (t) => {
  const value = executorFixture(successBridge());
  t.after(() => fs.rmSync(value.dataRoot, { recursive: true, force: true }));
  fs.mkdirSync(value.stateRoot, { recursive: true });
  const outside = path.join(value.dataRoot, "outside-cache");
  fs.mkdirSync(outside);
  try {
    fs.symlinkSync(outside, path.join(value.stateRoot, "cache"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    t.skip(`directory links are unavailable on this host: ${error.code ?? "unknown"}`);
    return;
  }
  await assert.rejects(
    executeFormsmith(
      value.launch,
      new AbortController().signal,
      { checkpoint() {} },
      value.inputPath,
      { env: value.env },
    ),
    (error) => error?.code === "formsmith_runtime_unavailable",
  );
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("Formsmith client uploads one image and accepts only a fenced private-stage GLB", async (t) => {
  const value = clientFixture(t);
  const state = calls();
  const delivered = [];
  const answer = await runtime.runFormsmithViaRuntime({
    userId: 17,
    conversationId: "conversation_formsmith",
    runId: `fmsrun_${"c".repeat(32)}`,
    request: value.request,
    sourcePath: value.source,
    onStage: (stage) => delivered.push(stage),
    env: { BREADBOARD_DATA_DIR: value.dataRoot },
    control: injectedControl(value.job, value.result, state),
  });
  assert.equal(answer.meshPath, fs.realpathSync.native(value.mesh));
  assert.deepEqual(delivered, stages);
  assert.equal(state.uploads.length, 1);
  assert.deepEqual(state.uploads[0].bytes, value.image);
  assert.equal(state.submissions.length, 1);
  assert.deepEqual(state.submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "reconstruct",
    filename: "object.png",
    sizeBytes: value.image.byteLength,
  });
  assert.deepEqual(state.submissions[0].submission.inputUploads, [{ uploadId: "upload_formsmith_1" }]);
  assert.equal(
    state.submissions[0].submission.idempotencyKey,
    `formsmith-v2:17:fmsrun_${"c".repeat(32)}`,
  );
  assert.doesNotMatch(
    JSON.stringify(state.submissions[0]),
    /executable|argv|sourcePath|SHAPER_ROOT|SHAPER_PYTHON|environment/u,
  );
  answer.cleanup();
  assert.equal(fs.existsSync(value.stage), false);
});

test("Formsmith client resumes an idempotent Runtime job without reopening the upload", async (t) => {
  const value = clientFixture(t);
  const state = calls();
  const answer = await runtime.runFormsmithViaRuntime({
    userId: 17,
    conversationId: "conversation_formsmith",
    runId: `fmsrun_${"d".repeat(32)}`,
    request: value.request,
    sourcePath: path.join(value.dataRoot, "already-expired.png"),
    onStage() {},
    env: { BREADBOARD_DATA_DIR: value.dataRoot },
    control: injectedControl(value.job, value.result, state, { lookup: "found" }),
  });
  assert.equal(answer.meshPath, fs.realpathSync.native(value.mesh));
  assert.equal(state.reservations.length, 0);
  assert.equal(state.uploads.length, 0);
  assert.equal(state.submissions.length, 0);
});

test("Formsmith health is an authenticated zero-input Runtime probe", async () => {
  const job = snapshot({
    jobId: "job_formsmith_probe",
    jobType: "formsmith-probe",
    workerKind: "formsmith-probe-node",
    resourceClass: "document-processing",
    conversationId: null,
    lastWorkerSequence: 3,
  });
  const health = {
    available: true,
    cloned: true,
    root: "C:\\sealed\\ShapeR",
    python: "C:\\data\\formsmith\\python.exe",
    bridgeFound: true,
    dependenciesInstalled: true,
    cudaAvailable: true,
    missing: [],
    reason: null,
  };
  const submissions = [];
  const control = {
    configured: () => true,
    async submit(authority, submission) {
      submissions.push({ authority: structuredClone(authority), submission: structuredClone(submission) });
      return structuredClone(job);
    },
    async inspect() { throw new Error("terminal probe must not poll"); },
    async readOutput(authority, jobId, kind) {
      return {
        jobId,
        kind,
        content: resultEnvelope(job, { ok: true, operation: "probe", health }),
      };
    },
    async cancel() { throw new Error("terminal probe must not cancel"); },
  };
  const answer = await runtime.probeShapeRViaRuntime({ userId: 17, control });
  assert.deepEqual(answer, health);
  assert.deepEqual(submissions[0].authority, { userId: 17, gardenId: null, conversationId: null });
  assert.deepEqual(submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "probe",
  });
  assert.equal(submissions[0].submission.jobType, "formsmith-probe");
  assert.deepEqual(submissions[0].submission.inputUploads, []);
  assert.doesNotMatch(JSON.stringify(submissions[0]), /SHAPER_|python\.exe|sealed\\ShapeR/u);
});

test("Formsmith manager recovers one durable run and preserves its event contract", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-formsmith-manager-"));
  t.after(() => {
    delete globalThis.__breadboardFormsmithRuns;
    delete globalThis.__FormsmithManagerDataRoot;
    delete globalThis.__FormsmithManagerSource;
    delete globalThis.__FormsmithManagerRun;
    delete globalThis.__FormsmithManagerCancel;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  globalThis.__FormsmithManagerDataRoot = dataRoot;
  globalThis.__FormsmithManagerSource = path.join(dataRoot, "source.png");
  fs.writeFileSync(globalThis.__FormsmithManagerSource, "fixture");
  globalThis.__FormsmithManagerCancel = async () => {};
  globalThis.__FormsmithManagerRun = async () => new Promise(() => {});
  delete globalThis.__breadboardFormsmithRuns;
  const beforeRestart = await loadRunManager();
  const started = beforeRestart.startFormsmithRun({
    userId: 17,
    conversationPublicId: "conversation_formsmith",
    request: { uploadId: "a".repeat(32), filename: "object.png", sizeBytes: 7 },
  });
  await waitUntil(() => beforeRestart.getFormsmithEventsSince(17, started.runId)
    .some((event) => event.type === "run.started"));

  // Simulate losing the dashboard heap while the native idempotent job remains.
  delete globalThis.__breadboardFormsmithRuns;
  let cleaned = false;
  globalThis.__FormsmithManagerRun = async (input) => {
    for (const stage of stages) input.onStage(stage);
    return {
      meshPath: path.join(dataRoot, "formsmith.glb"),
      meshRoot: dataRoot,
      sizeBytes: 12,
      durationMs: 100,
      cleanup: () => { cleaned = true; },
    };
  };
  const afterRestart = await loadRunManager();
  const completedEvents = await waitUntil(() => {
    const events = afterRestart.getFormsmithEventsSince(17, started.runId);
    return events.some((event) => event.type === "run.completed") ? events : null;
  });
  assert.deepEqual(completedEvents.map((event) => event.type), [
    "run.started",
    ...stages.map(() => "stage.updated"),
    "run.completed",
  ]);
  assert.equal(completedEvents.filter((event) => event.type === "run.started").length, 1);
  assert.deepEqual(
    completedEvents.filter((event) => event.type === "stage.updated").map((event) => event.payload),
    stages,
  );
  assert.equal(cleaned, true);
  assert.equal(afterRestart.isFormsmithTerminal(17, started.runId), true);
});

test("Formsmith manager aborts the card and the idempotent Runtime job together", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-formsmith-abort-"));
  t.after(() => {
    delete globalThis.__breadboardFormsmithRuns;
    delete globalThis.__FormsmithManagerDataRoot;
    delete globalThis.__FormsmithManagerSource;
    delete globalThis.__FormsmithManagerRun;
    delete globalThis.__FormsmithManagerCancel;
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });
  globalThis.__FormsmithManagerDataRoot = dataRoot;
  globalThis.__FormsmithManagerSource = path.join(dataRoot, "source.png");
  fs.writeFileSync(globalThis.__FormsmithManagerSource, "fixture");
  const cancellations = [];
  globalThis.__FormsmithManagerCancel = async (input) => { cancellations.push(structuredClone(input)); };
  globalThis.__FormsmithManagerRun = async (input) => new Promise((resolve, reject) => {
    input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true });
  });
  delete globalThis.__breadboardFormsmithRuns;
  const manager = await loadRunManager();
  const started = manager.startFormsmithRun({
    userId: 17,
    conversationPublicId: "conversation_formsmith",
    request: { uploadId: "b".repeat(32), filename: "object.png", sizeBytes: 7 },
  });
  await waitUntil(() => manager.getFormsmithEventsSince(17, started.runId)
    .some((event) => event.type === "run.started"));
  assert.equal(manager.abortFormsmithRun(17, started.runId), true);
  const events = manager.getFormsmithEventsSince(17, started.runId);
  assert.equal(events.at(-1).type, "run.aborted");
  assert.equal(events.some((event) => event.type === "run.failed"), false);
  await waitUntil(() => cancellations.length === 1);
  assert.deepEqual(cancellations[0], {
    userId: 17,
    conversationId: "conversation_formsmith",
    runId: started.runId,
  });
});

test("Formsmith rejects a forged worker fence and forwards cancellation", async (t) => {
  const value = clientFixture(t);
  await assert.rejects(
    runtime.runFormsmithViaRuntime({
      userId: 17,
      conversationId: "conversation_formsmith",
      runId: `fmsrun_${"e".repeat(32)}`,
      request: value.request,
      sourcePath: value.source,
      onStage() {},
      env: { BREADBOARD_DATA_DIR: value.dataRoot },
      control: injectedControl(value.job, value.result, calls(), {
        lookup: "found",
        identity: { workerInstanceId: "worker_forged" },
      }),
    }),
    /sealed Formsmith contract|unfenced Formsmith output/u,
  );

  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const controller = new AbortController();
  const promise = runtime.runFormsmithViaRuntime({
    userId: 17,
    conversationId: "conversation_formsmith",
    runId: `fmsrun_${"f".repeat(32)}`,
    request: value.request,
    sourcePath: path.join(value.dataRoot, "already-sealed.png"),
    signal: controller.signal,
    onStage() {},
    env: { BREADBOARD_DATA_DIR: value.dataRoot },
    control: injectedControl(running, value.result, state, { lookup: "running" }),
  });
  setTimeout(() => controller.abort(new DOMException("Stopped", "AbortError")), 20);
  await assert.rejects(promise, (error) => error?.code === "formsmith_cancelled");
  assert.equal(state.cancellations.length, 1);
  assert.equal(state.cancellations[0].jobId, running.jobId);
});

test("Formsmith source closure has no dashboard subprocess or fallback path", () => {
  const worker = fs.readFileSync(path.join(dashboardRoot, "scripts", "runtime-v2-formsmith-worker.mjs"), "utf8");
  const executor = fs.readFileSync(path.join(dashboardRoot, "scripts", "runtime-v2-formsmith-executor.mjs"), "utf8");
  const client = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "runtime-v2", "formsmith-job.ts"), "utf8");
  const manager = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "shaper", "run-manager.ts"), "utf8");
  const health = fs.readFileSync(path.join(dashboardRoot, "src", "lib", "shaper", "runtime.ts"), "utf8");
  const bridge = fs.readFileSync(path.join(repositoryRoot, "scripts", "shaper-bridge.py"), "utf8");
  const dino = fs.readFileSync(path.join(repositoryRoot, "ShapeR", "model", "dino_and_ray_feature_extractor.py"), "utf8");
  assert.match(worker, /runtime-v2-formsmith-executor\.mjs/u);
  assert.match(worker, /runtime-v2-finite-mcp-worker-core\.mjs/u);
  assert.match(client, /submitRuntimeJob/u);
  assert.match(manager, /runFormsmithViaRuntime/u);
  assert.match(health, /probeShapeRViaRuntime/u);
  for (const source of [manager, health]) {
    assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\bexecFile\s*\(/u);
  }
  assert.match(executor, /SHAPER_STATE_ROOT/u);
  assert.match(bridge, /shaperStateRoot/u);
  assert.match(dino, /SHAPER_TORCH_HUB_DIR/u);
});
