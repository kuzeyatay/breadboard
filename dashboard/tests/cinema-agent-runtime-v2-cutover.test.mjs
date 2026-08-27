import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

async function loadClient() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "runtime-v2", "cinema-agent-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "cinema-runtime-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({ path: "supervisor", namespace: "stub" }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
          loader: "js",
          contents: args.path === "server-only"
            ? "export {};"
            : `
              export class RuntimeJobControlError extends Error { constructor(code) { super(code); this.code = code; } }
              const unused = async () => { throw new Error("use injected control"); };
              export const cancelRuntimeJob = unused;
              export const inspectRuntimeJobForStatus = unused;
              export const readRuntimeJobOutput = unused;
              export const submitRuntimeJob = unused;
            `,
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#cinema-client`);
}

const client = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_cinema_1",
    jobType: "vimax-run",
    workerKind: "vimax-node",
    resourceClass: "large-generation",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_cinema_1",
    gardenId: null,
    conversationId: "conv_vimax_1",
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 4,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
    ...overrides,
  };
}

function controlFor(job, output, calls) {
  return {
    async submit(authority, submission) {
      calls.push({ type: "submit", authority: structuredClone(authority), submission: structuredClone(submission) });
      return structuredClone(job);
    },
    async inspect() {
      throw new Error("terminal fixture must not poll");
    },
    async readOutput(authority, jobId, kind) {
      calls.push({ type: "output", authority: structuredClone(authority), jobId, kind });
      return { jobId, kind, content: output };
    },
    async cancel(authority, jobId) {
      calls.push({ type: "cancel", authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
  };
}

test("a ViMax run submits one fixed profile and replays its fenced terminal projection", async () => {
  const job = snapshot();
  const calls = [];
  const events = [
    { sequenceNumber: 1, type: "run.started", payload: { brief: "film" }, at: "2026-08-26T00:00:00.000Z" },
    { sequenceNumber: 2, type: "run.completed", payload: { summary: "done" }, at: "2026-08-26T00:00:01.000Z" },
  ];
  const projection = {
    protocolVersion: 1,
    identity: { jobId: job.jobId, attempt: 1, workerInstanceId: job.workerInstanceId },
    scope: { userId: 17, gardenId: null, conversationId: job.conversationId },
    agentKind: "vimax",
    status: "completed",
    events,
  };
  const requestPayload = {
    operation: "run",
    runId: `vmxrun_${"a".repeat(32)}`,
    conversationPublicId: job.conversationId,
    brief: "film",
    parsed: {},
    model: "test",
  };
  const replayed = [];
  const outcome = await client.runCinemaAgentJob({
    kind: "vimax",
    userId: 17,
    conversationId: job.conversationId,
    runId: requestPayload.runId,
    requestPayload,
    onEvents: (next, status) => replayed.push({ next: structuredClone(next), status }),
    control: controlFor(job, {
      protocolVersion: 1,
      identity: { jobId: job.jobId, attempt: job.attempt, workerInstanceId: job.workerInstanceId },
      completionSequence: job.lastWorkerSequence,
      run: projection,
    }, calls),
  });
  assert.deepEqual(outcome, { status: "completed", failureMessage: null });
  assert.deepEqual(replayed, [{ next: events, status: "completed" }]);
  const submitted = calls.find((entry) => entry.type === "submit");
  assert.equal(submitted.submission.jobType, "vimax-run");
  assert.deepEqual(submitted.submission.inputUploads, []);
  assert.deepEqual(submitted.authority, { userId: 17, gardenId: null, conversationId: "conv_vimax_1" });
  assert.doesNotMatch(JSON.stringify(submitted), /executable|argv|environment|apiKey|CONTROL_TOKEN/u);
});

test("worker identity and profile mismatches are rejected before events reach the UI", async () => {
  const job = snapshot({ workerKind: "attacker-selected" });
  await assert.rejects(
    client.runCinemaAgentJob({
      kind: "vimax",
      userId: 17,
      conversationId: "conv_vimax_1",
      runId: `vmxrun_${"c".repeat(32)}`,
      requestPayload: { operation: "run" },
      onEvents: () => assert.fail("forged events must not be forwarded"),
      control: controlFor(job, {}, []),
    }),
    /outside its sealed profile scope/u,
  );
});

test("Vox health is user-scoped and accepts only its fenced result envelope", async () => {
  const job = snapshot({
    jobId: "job_vox_health_1",
    jobType: "vox-director-run",
    workerKind: "vox-director-node",
    conversationId: null,
  });
  const calls = [];
  const health = { ok: true, status: "ready", available: true };
  const result = await client.inspectVoxDirectorRuntimeHealth({
    userId: 23,
    baseUrl: "http://127.0.0.1:8765/v1",
    checkpoint: null,
    voiceProfileId: null,
    control: controlFor(job, {
      protocolVersion: 1,
      identity: { jobId: job.jobId, attempt: job.attempt, workerInstanceId: job.workerInstanceId },
      completionSequence: job.lastWorkerSequence,
      health,
    }, calls),
  });
  assert.deepEqual(result, health);
  const submitted = calls.find((entry) => entry.type === "submit");
  assert.equal(submitted.submission.jobType, "vox-director-run");
  assert.equal(submitted.submission.requestPayload.operation, "health");
  assert.deepEqual(submitted.authority, { userId: 23, gardenId: null, conversationId: null });
});

test("an abort after submission cancels the native-owned job before returning", async () => {
  const controller = new AbortController();
  const job = snapshot({ state: "running", stage: "vimax-production", finishedAt: null });
  const calls = [];
  const projection = {
    protocolVersion: 1,
    identity: { jobId: job.jobId, attempt: job.attempt, workerInstanceId: job.workerInstanceId },
    scope: { userId: 17, gardenId: null, conversationId: job.conversationId },
    agentKind: "vimax",
    status: "queued",
    events: [],
  };
  const control = controlFor(job, projection, calls);
  const submit = control.submit;
  control.submit = async (...args) => {
    const submitted = await submit(...args);
    controller.abort();
    return submitted;
  };
  const outcome = await client.runCinemaAgentJob({
    kind: "vimax",
    userId: 17,
    conversationId: job.conversationId,
    runId: `vmxrun_${"d".repeat(32)}`,
    requestPayload: { operation: "run" },
    signal: controller.signal,
    onEvents: () => {},
    control,
  });
  assert.deepEqual(outcome, { status: "aborted", failureMessage: null });
  assert.equal(calls.filter((entry) => entry.type === "cancel").length, 1);
});

test("all Next boundaries use Runtime façades and cannot own cinema descendants", () => {
  const routeFiles = [
    "src/app/api/vimax/runs/route.ts",
    "src/app/api/vimax/runs/[runId]/events/route.ts",
    "src/app/api/vimax/runs/[runId]/abort/route.ts",
    "src/app/api/vox-director/runs/route.ts",
    "src/app/api/vox-director/runs/[runId]/events/route.ts",
    "src/app/api/vox-director/runs/[runId]/abort/route.ts",
  ];
  for (const file of routeFiles) {
    const body = source(file);
    assert.match(body, /runtime-run-manager\.ts/u, `${file} bypasses the Runtime façade`);
    assert.doesNotMatch(body, /node:child_process|\bspawn\s*\(|\bexecFile\s*\(/u);
  }
  const health = source("src/app/api/vox-director/health/route.ts");
  assert.match(health, /inspectVoxDirectorRuntimeHealth/u);
  assert.doesNotMatch(health, /audio-backend|vox-director\/runtime|vimax\/video|node:child_process/u);
  for (const file of [
    "src/lib/vimax/runtime-run-manager.ts",
    "src/lib/vox-director/runtime-run-manager.ts",
    "src/lib/runtime-v2/cinema-agent-job.ts",
  ]) {
    const body = source(file);
    assert.doesNotMatch(body, /node:child_process|\bspawn\s*\(|\bexecFile\s*\(/u, file);
  }
});

test("the complete pipelines are worker-loaded and fixed descendants have no PATH discovery", () => {
  const adapters = source("scripts/runtime-v2-cinema-agent-adapters.mjs");
  const workerCore = source("scripts/runtime-v2-cinema-agent-worker-core.mjs");
  assert.match(adapters, /startRuntimeWorkerRun\(/u);
  assert.match(adapters, /lib", "vimax", "run-manager\.ts/u);
  assert.match(adapters, /lib", "vox-director", "run-manager\.ts/u);
  assert.match(workerCore, /const packagedSourceRoot = path\.join\(packagedDashboardRoot, "worker-src"\)/u);
  assert.match(workerCore, /process\.env\.BREADBOARD_LEARN_SOURCE_ROOT = sourceRoot/u);
  assert.match(workerCore, /learn-worker-import-hook\.mjs/u);
  const codeOnly = (body) => body.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/^\s*\/\/.*$/gmu, "");
  const vimaxVideo = codeOnly(source("src/lib/vimax/video.ts"));
  const voxRuntime = codeOnly(source("src/lib/vox-director/runtime.ts"));
  assert.doesNotMatch(vimaxVideo, /\bwhere\b|\bwhich\b|spawnSyncQuiet/u);
  assert.doesNotMatch(voxRuntime, /whichSync|cachedWhich|\["python", "python3"/u);
  assert.match(voxRuntime, /PYTHONNOUSERSITE: "1"/u);
  assert.doesNotMatch(voxRuntime, /return \{\s*\.\.\.env/u);
  assert.match(source("src/lib/conversations/external-agent-cancel.ts"), /vimax\/runtime-run-manager\.ts/u);
  assert.match(source("src/lib/conversations/external-agent-cancel.ts"), /vox-director\/runtime-run-manager\.ts/u);
});
