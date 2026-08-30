import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import esbuild from "esbuild";

import {
  codexProbeApplicationLayout,
  executeRuntimeV2CodexProbe,
  validateRuntimeV2CodexProbeEnvironment,
  validateRuntimeV2CodexProbeRequest,
  validateRuntimeV2CodexProbeScope,
} from "../scripts/runtime-v2-codex-probe-worker.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src/lib/runtime-v2/codex-probe-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "codex-probe-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "codex-probe-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "codex-probe-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "codex-probe-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "codex-probe-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(input) { super(input.message); Object.assign(this, input); }
            }
            export async function submitRuntimeJob() { throw new Error("unexpected default submit"); }
            export async function inspectRuntimeJob() { throw new Error("unexpected default inspect"); }
            export async function readRuntimeJobOutput() { throw new Error("unexpected default output"); }
            export async function cancelRuntimeJob() { throw new Error("unexpected default cancel"); }
            export async function cancelRuntimeJobByIdempotencyKey() {
              throw new Error("unexpected default idempotency cancel");
            }
          `,
        }));
      },
    }],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#codex-probe`
  );
}

const client = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_codex_probe_1",
    jobType: "codex-probe",
    workerKind: "codex-probe-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "complete",
    attempt: 1,
    workerInstanceId: "worker_codex_probe_1",
    lastWorkerSequence: 3,
    gardenId: null,
    conversationId: null,
    failureMessage: null,
    resourceExhaustion: null,
    ...overrides,
  };
}

function resultContent(job, result = {}) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
    },
    completionSequence: job.lastWorkerSequence,
    result: {
      available: true,
      installed: true,
      version: "codex-cli 1.2.3",
      reason: null,
      ...result,
    },
  };
}

function controlFor(job, content = resultContent(job)) {
  const state = { submissions: [], outputReads: [] };
  return {
    state,
    control: {
      async submit(authority, submission) {
        state.submissions.push({ authority: structuredClone(authority), submission });
        return job;
      },
      async inspect() {
        return job;
      },
      async readOutput(authority, jobId, kind) {
        state.outputReads.push({ authority: structuredClone(authority), jobId, kind });
        return { jobId, kind, content };
      },
      async cancel() {
        return { ...job, state: "cancelled" };
      },
      async cancelByIdempotencyKey() {
        return { jobId: null, state: "pending", accepted: true };
      },
    },
  };
}

test("the Codex probe accepts only a fixed user-global observational contract", () => {
  const request = { protocolVersion: 1, operation: "status" };
  const scope = { userId: 17, gardenId: null, conversationId: null };
  const executable = path.resolve("tools/codex.exe");
  assert.equal(validateRuntimeV2CodexProbeRequest(request), request);
  assert.equal(validateRuntimeV2CodexProbeScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2CodexProbeEnvironment({ CODEX_BIN: executable }));
  for (const forged of [
    { ...request, executable },
    { ...request, argv: ["--version"] },
    { ...request, environment: { OPENAI_API_KEY: "secret" } },
    { ...request, operation: "run" },
  ]) assert.throws(
    () => validateRuntimeV2CodexProbeRequest(forged),
    /canonical Codex probe request/u,
  );
  assert.throws(
    () => validateRuntimeV2CodexProbeScope({ ...scope, gardenId: 9 }),
    /user-global scope/u,
  );
  assert.throws(
    () => validateRuntimeV2CodexProbeEnvironment({ CODEX_BIN: "codex" }),
    /sealed Codex executable path/u,
  );
});

test("the finite worker returns bounded canonical availability evidence", async () => {
  const before = process.env.CODEX_BIN;
  process.env.CODEX_BIN = path.resolve("tools/codex.exe");
  const checkpoints = [];
  try {
    const status = await executeRuntimeV2CodexProbe(
      {
        request: { protocolVersion: 1, operation: "status" },
        executionScope: { userId: 17, gardenId: null, conversationId: null },
      },
      new AbortController().signal,
      { checkpoint: (value) => checkpoints.push(value) },
      {
        applicationLayout: () => ({ sourceRoot: path.resolve("src") }),
        loadAvailability: async () => ({
          available: false,
          installed: true,
          reason: "The clone exists but its executable is unavailable.",
        }),
      },
    );
    assert.deepEqual(status, {
      available: false,
      installed: true,
      version: null,
      reason: "The clone exists but its executable is unavailable.",
    });
    assert.deepEqual(checkpoints.map((item) => item.stage), ["preparing", "probing", "complete"]);
  } finally {
    if (before === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = before;
  }
});

test("the finite worker probes from private home, temp, and Codex directories without dashboard secrets", (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-codex-probe-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const workspacePath = path.join(
    dataRoot,
    "runtime",
    "jobs",
    "job_codex_probe_1",
    "attempts",
    "1",
    "worker_codex_probe_1",
    "workspace",
  );
  fs.mkdirSync(workspacePath, { recursive: true });
  const priorCwd = process.cwd();
  const before = { ...process.env };
  try {
    process.env.CODEX_BIN = path.resolve("tools/codex.exe");
    process.env.CHATMOCK_API_KEY = "must-not-reach-version-probe";
    process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "must-not-reach-version-probe";
    codexProbeApplicationLayout({ dataRoot, workspacePath });
    const privateRoot = path.join(workspacePath, "codex-probe-process");
    assert.equal(process.env.HOME, path.join(privateRoot, "home"));
    assert.equal(process.env.USERPROFILE, process.env.HOME);
    assert.equal(process.env.CODEX_HOME, path.join(privateRoot, "codex-home"));
    assert.equal(process.env.TMP, path.join(privateRoot, "tmp"));
    assert.equal(process.env.CHATMOCK_API_KEY, undefined);
    assert.equal(process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN, undefined);
  } finally {
    process.chdir(priorCwd);
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, before);
  }
});

test("the dashboard submits a zero-input probe and accepts only fenced output", async () => {
  const job = snapshot();
  const { control, state } = controlFor(job);
  const status = await client.runCodexProbeViaRuntime({ userId: 17, control });
  assert.deepEqual(status, {
    available: true,
    installed: true,
    version: "codex-cli 1.2.3",
    reason: null,
  });
  assert.deepEqual(state.submissions[0].authority, {
    userId: 17,
    gardenId: null,
    conversationId: null,
  });
  assert.deepEqual(state.submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "status",
  });
  assert.equal(state.submissions[0].submission.jobType, "codex-probe");
  assert.equal(state.submissions[0].submission.inputUploads, undefined);
  assert.match(
    state.submissions[0].submission.idempotencyKey,
    /^codex-probe-v2:[a-f0-9]{64}$/u,
  );
  assert.deepEqual(state.outputReads, [{
    authority: { userId: 17, gardenId: null, conversationId: null },
    jobId: job.jobId,
    kind: "result",
  }]);

  const forged = controlFor(job, {
    ...resultContent(job),
    identity: { ...resultContent(job).identity, workerInstanceId: "worker_other" },
  });
  await assert.rejects(
    client.runCodexProbeViaRuntime({ userId: 17, control: forged.control }),
    /unfenced Codex probe result/u,
  );
});

test("Codex and HyperFrames routes have no dashboard-process Codex probe fallback", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const routes = [
    read("src/app/api/codex/health/route.ts"),
    read("src/app/api/hyperframes/health/route.ts"),
    read("src/app/api/hyperframes/setup/route.ts"),
  ];
  for (const source of routes) {
    assert.match(source, /runCodexProbeViaRuntime/u);
    assert.match(source, /runtimeAuthorityErrorResponse/u);
    assert.doesNotMatch(source, /codex\/run-manager|runtimeAvailability\(|resolveCodexLauncher|spawnSync/u);
  }
  const hyperframesStatus = read("src/lib/hyperframes/setup.ts");
  assert.doesNotMatch(
    hyperframesStatus,
    /codex\/run-manager|resolveCodexLauncher|node:child_process|spawnSync/u,
  );

  const manifest = JSON.parse(read("../desktop/runtime-v2/manifests/workers.json"));
  const worker = manifest.workers.find((entry) => entry.kind === "codex-probe-node");
  assert.deepEqual(worker.jobTypes, ["codex-probe"]);
  assert.equal(worker.environmentSource, "outer-codex");
  assert.equal(worker.allowedEntrypoint, "dashboard/scripts/runtime-v2-codex-probe-worker.mjs");
  assert.equal(worker.minimumInputBlobs, 0);
  assert.equal(worker.maximumInputBlobs, 0);
  assert.equal(worker.exitAfterJob, true);

  for (const relative of [
    "../desktop/scripts/prepare-app-resources.mjs",
    "../desktop/scripts/verify-package.mjs",
  ]) {
    assert.match(read(relative), /"runtime-v2-codex-probe-worker\.mjs"/u);
  }
});
