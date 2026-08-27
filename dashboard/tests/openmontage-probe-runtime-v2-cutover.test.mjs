import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import esbuild from "esbuild";

import {
  OPENMONTAGE_SOURCE_COMMIT,
  canonicalOpenMontageStatus,
  executeRuntimeV2OpenMontageProbe,
  validateRuntimeV2OpenMontageProbeEnvironment,
  validateRuntimeV2OpenMontageProbeRequest,
  validateRuntimeV2OpenMontageProbeScope,
} from "../scripts/runtime-v2-openmontage-probe-worker.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src/lib/runtime-v2/openmontage-probe-job.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "openmontage-probe-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "openmontage-probe-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "openmontage-probe-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "openmontage-probe-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "openmontage-probe-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(input) { super(input.message); Object.assign(this, input); }
            }
            const unused = async () => { throw new Error("use the injected OpenMontage control"); };
            export const cancelRuntimeJob = unused;
            export const cancelRuntimeJobByIdempotencyKey = unused;
            export const inspectRuntimeJob = unused;
            export const readRuntimeJobOutput = unused;
            export const submitRuntimeJob = unused;
          `,
        }));
      },
    }],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#openmontage-probe`
  );
}

const client = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_openmontage_probe_1",
    jobType: "openmontage-probe",
    workerKind: "openmontage-probe-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "complete",
    attempt: 1,
    workerInstanceId: "worker_openmontage_probe_1",
    gardenId: null,
    conversationId: null,
    createdAt: 1,
    startedAt: 2,
    updatedAt: 3,
    finishedAt: 3,
    lastHeartbeatAt: 2,
    lastWorkerSequence: 4,
    progressCurrent: 100,
    progressTotal: 100,
    failureCode: null,
    failureMessage: null,
    resourceExhaustion: null,
    cancellationRequested: false,
    ...overrides,
  };
}

function status(root = path.resolve("runtime-v2/toolchains/openmontage"), overrides = {}) {
  const venv = path.resolve("runtime-v2/services/openmontage/.venv");
  return {
    ready: true,
    reason: "",
    clone: { found: true, path: root },
    python: {
      found: true,
      path: path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      source: "venv",
      version: "Python 3.12.9",
      dependencies: true,
      installable: true,
    },
    ffmpeg: { found: true, path: path.resolve("tools/ffmpeg"), source: "configured" },
    ffprobe: { found: true, path: path.resolve("tools/ffprobe"), source: "configured" },
    node: { found: true, version: "v24.1.0" },
    remotion: { found: false, path: path.join(root, "remotion-composer"), installable: true },
    codex: { found: true, version: "codex-cli 1.2.3" },
    tools: { available: 34, total: 102, reason: "" },
    providers: ["OPENAI_API_KEY", "RUNWAY_API_KEY"],
    ...overrides,
  };
}

function envelope(job, result, overrides = {}) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
      ...(overrides.identity ?? {}),
    },
    completionSequence: overrides.completionSequence ?? job.lastWorkerSequence,
    result,
  };
}

function calls() {
  return { submissions: [], cancellations: [], idempotencyCancellations: [] };
}

function control(job, result, state, outputOverrides = {}) {
  return {
    async submit(authority, submission) {
      state.submissions.push({
        authority: structuredClone(authority),
        submission: structuredClone(submission),
      });
      return structuredClone(job);
    },
    async inspect() {
      throw new Error("terminal fixture must not poll");
    },
    async readOutput(authority, jobId, kind) {
      return { jobId, kind, content: envelope(job, result, outputOverrides) };
    },
    async cancel(authority, jobId) {
      state.cancellations.push({ authority: structuredClone(authority), jobId });
      return { ...job, state: "cancelled" };
    },
    async cancelByIdempotencyKey(authority, idempotencyKey) {
      state.idempotencyCancellations.push({
        authority: structuredClone(authority),
        idempotencyKey,
      });
      return { jobId: null, state: "pending", accepted: true };
    },
  };
}

test("the OpenMontage probe accepts only its fixed pinned user-global status contract", () => {
  const request = { protocolVersion: 1, operation: "status" };
  const scope = { userId: 17, gardenId: null, conversationId: null };
  assert.equal(validateRuntimeV2OpenMontageProbeRequest(request), request);
  assert.equal(validateRuntimeV2OpenMontageProbeScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2OpenMontageProbeEnvironment({
    OPENMONTAGE_SOURCE_COMMIT,
    CODEX_BIN: path.resolve("tools/codex"),
    OPENMONTAGE_FFMPEG_PATH: path.resolve("tools"),
  }));
  for (const forged of [
    { ...request, executable: "python" },
    { ...request, argv: ["--version"] },
    { ...request, env: { OPENAI_API_KEY: "secret" } },
    { ...request, operation: "install" },
  ]) assert.throws(
    () => validateRuntimeV2OpenMontageProbeRequest(forged),
    /canonical OpenMontage probe request/u,
  );
  assert.throws(
    () => validateRuntimeV2OpenMontageProbeScope({ ...scope, gardenId: 9 }),
    /user-global scope/u,
  );
  assert.throws(
    () => validateRuntimeV2OpenMontageProbeEnvironment({
      OPENMONTAGE_SOURCE_COMMIT: "renderer-chosen",
    }),
    /pinned OpenMontage source receipt/u,
  );
});

test("the client submits a fresh zero-input job and preserves the exact setup status", async () => {
  const job = snapshot();
  const expected = status();
  const first = calls();
  assert.deepEqual(await client.runOpenMontageProbeViaRuntime({
    userId: 17,
    control: control(job, expected, first),
  }), expected);
  assert.deepEqual(first.submissions[0].authority, {
    userId: 17,
    gardenId: null,
    conversationId: null,
  });
  assert.deepEqual(first.submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "status",
  });
  assert.equal(first.submissions[0].submission.jobType, "openmontage-probe");
  assert.equal(first.submissions[0].submission.inputUploads, undefined);
  assert.match(
    first.submissions[0].submission.idempotencyKey,
    /^openmontage-probe-v2:[a-f0-9]{64}$/u,
  );
  assert.doesNotMatch(
    JSON.stringify(first.submissions[0].submission),
    /python|ffmpeg|codex|argv|executable|environment|OPENAI_API_KEY/u,
  );
  const second = calls();
  await client.runOpenMontageProbeViaRuntime({
    userId: 17,
    control: control(job, expected, second),
  });
  assert.notEqual(
    first.submissions[0].submission.idempotencyKey,
    second.submissions[0].submission.idempotencyKey,
  );
});

test("forged fences, paths, provider names, and status invariants are rejected", async () => {
  const job = snapshot();
  for (const [result, overrides] of [
    [status(), { identity: { workerInstanceId: "worker_forged" } }],
    [status(), { completionSequence: 3 }],
    [status("../outside"), {}],
    [status(undefined, { reason: "x".repeat(9 * 1024) }), {}],
    [status(undefined, { providers: ["AWS_SECRET_ACCESS_KEY"] }), {}],
    [status(undefined, { tools: { available: 103, total: 102, reason: "" } }), {}],
    [status(undefined, { ready: true, codex: { found: false, version: "" } }), {}],
  ]) {
    await assert.rejects(
      client.runOpenMontageProbeViaRuntime({
        userId: 17,
        control: control(job, result, calls(), overrides),
      }),
      /OpenMontage/u,
    );
  }
  assert.throws(
    () => canonicalOpenMontageStatus(status(undefined, {
      remotion: { found: false, path: "relative", installable: true },
    })),
    /OpenMontage/u,
  );
});

test("running and uncertain probes forward cancellation with no direct fallback", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, status(), state);
  current.inspect = async () => structuredClone(running);
  const promise = client.runOpenMontageProbeViaRuntime({
    userId: 17,
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped|Aborted/u);
  assert.equal(state.cancellations.length, 1);

  const uncertain = calls();
  const uncertainAbort = new AbortController();
  const lost = control(running, status(), uncertain);
  lost.submit = async (authority, submission) => {
    uncertain.submissions.push({
      authority: structuredClone(authority),
      submission: structuredClone(submission),
    });
    uncertainAbort.abort(new DOMException("Stopped", "AbortError"));
    throw new Error("submit response was lost");
  };
  await assert.rejects(
    client.runOpenMontageProbeViaRuntime({
      userId: 17,
      signal: uncertainAbort.signal,
      control: lost,
    }),
    /Stopped|Aborted/u,
  );
  assert.equal(uncertain.cancellations.length, 0);
  assert.equal(uncertain.idempotencyCancellations.length, 1);
  assert.equal(
    uncertain.idempotencyCancellations[0].idempotencyKey,
    uncertain.submissions[0].submission.idempotencyKey,
  );
});

test("the worker uses only managed source, venv, remotion, private paths, and closed trusted env", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openmontage-probe-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const workspace = path.join(dataRoot, "runtime", "jobs", "job_openmontage_probe_1", "workspace");
  const root = path.join(dataRoot, "runtime-v2", "toolchains", "openmontage");
  const venv = path.join(dataRoot, "runtime-v2", "services", "openmontage", ".venv");
  const media = path.join(dataRoot, "runtime-v2", "tools", "media");
  for (const relative of [
    "AGENT_GUIDE.md",
    "requirements.txt",
    "tools/tool_registry.py",
    "remotion-composer/package.json",
    "remotion-composer/package-lock.json",
  ]) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "fixture\n");
  }
  fs.mkdirSync(path.join(root, "remotion-composer", "node_modules"), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(venv, { recursive: true });
  fs.mkdirSync(media, { recursive: true });
  const before = { ...process.env };
  const priorCwd = process.cwd();
  try {
    process.env.OPENMONTAGE_SOURCE_COMMIT = OPENMONTAGE_SOURCE_COMMIT;
    process.env.OPENMONTAGE_FFMPEG_PATH = media;
    process.env.OPENAI_API_KEY = "trusted-provider-key";
    process.env.CHATMOCK_API_KEY = "must-not-reach-probe";
    process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "must-not-reach-probe";
    process.env.AWS_SECRET_ACCESS_KEY = "must-not-reach-probe";
    process.env.HTTP_PROXY = "http://must-not-reach-probe.invalid";
    const checkpoints = [];
    let observed;
    const expected = status(root, {
      providers: ["OPENAI_API_KEY"],
      remotion: {
        found: true,
        path: path.join(root, "remotion-composer"),
        installable: true,
      },
    });
    const result = await executeRuntimeV2OpenMontageProbe({
      dataRoot,
      workspacePath: workspace,
      executionScope: { userId: 17, gardenId: null, conversationId: null },
      request: { protocolVersion: 1, operation: "status" },
      inputBlobs: [],
    }, new AbortController().signal, {
      checkpoint(value) { checkpoints.push(value); },
    }, {
      async loadStatus(layout, signal) {
        observed = { layout, signal, environment: { ...process.env } };
        return expected;
      },
    });
    assert.deepEqual(result, expected);
    assert.deepEqual(checkpoints, [
      { stage: "preparing", percent: 10 },
      { stage: "probing", percent: 30 },
      { stage: "complete", percent: 100 },
    ]);
    assert.equal(observed.layout.root, root);
    assert.equal(observed.layout.venv, venv);
    assert.equal(observed.environment.OPENMONTAGE_ROOT, root);
    assert.equal(observed.environment.OPENMONTAGE_NODE, process.execPath);
    assert.equal(observed.environment.OPENMONTAGE_FFMPEG_PATH, media);
    assert.equal(observed.environment.OPENMONTAGE_SOURCE_COMMIT, OPENMONTAGE_SOURCE_COMMIT);
    assert.equal(observed.environment.OPENAI_API_KEY, "trusted-provider-key");
    for (const name of [
      "CHATMOCK_API_KEY",
      "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "HTTP_PROXY",
      "OPENMONTAGE_WORKSPACE_ROOT",
    ]) assert.equal(observed.environment[name], undefined);
    assert.equal(observed.environment.HOME, path.join(workspace, "openmontage-probe-process/home"));
    assert.equal(observed.environment.TMP, path.join(workspace, "openmontage-probe-process/tmp"));
  } finally {
    process.chdir(priorCwd);
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, before);
  }
});

test("the worker does not claim the staged application clone before managed setup exists", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openmontage-missing-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const workspace = path.join(dataRoot, "runtime", "jobs", "job_openmontage_probe_1", "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const managedRoot = path.join(dataRoot, "runtime-v2", "toolchains", "openmontage");
  const expected = {
    ready: false,
    reason:
      "OpenMontage needs the OpenMontage clone, Python, ffmpeg. Open the settings beside the palette entry to install what is missing.",
    clone: { found: false, path: "" },
    python: {
      found: false,
      path: "",
      source: "",
      version: "",
      dependencies: false,
      installable: false,
    },
    ffmpeg: { found: false, path: "", source: "" },
    ffprobe: { found: false, path: "", source: "" },
    node: { found: true, version: "v24.1.0" },
    remotion: {
      found: false,
      path: path.join(managedRoot, "remotion-composer"),
      installable: false,
    },
    codex: { found: false, version: "" },
    tools: {
      available: 0,
      total: 0,
      reason: "Install the dependencies to read the tool registry.",
    },
    providers: [],
  };
  const before = { ...process.env };
  const priorCwd = process.cwd();
  try {
    process.env.OPENMONTAGE_SOURCE_COMMIT = OPENMONTAGE_SOURCE_COMMIT;
    const result = await executeRuntimeV2OpenMontageProbe({
      dataRoot,
      workspacePath: workspace,
      executionScope: { userId: 17, gardenId: null, conversationId: null },
      request: { protocolVersion: 1, operation: "status" },
      inputBlobs: [],
    }, new AbortController().signal, { checkpoint() {} }, {
      async loadStatus(layout) {
        assert.equal(layout.root, null);
        assert.equal(process.env.OPENMONTAGE_ROOT, managedRoot);
        assert.notEqual(process.env.OPENMONTAGE_ROOT, path.resolve(dashboardRoot, "..", "OpenMontage"));
        return expected;
      },
    });
    assert.deepEqual(result, expected);
  } finally {
    process.chdir(priorCwd);
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, before);
  }
});

test("health and setup preserve their response shapes through Runtime with no Next spawn fallback", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const health = read("src/app/api/openmontage/health/route.ts");
  const setup = read("src/app/api/openmontage/setup/route.ts");
  const worker = read("scripts/runtime-v2-openmontage-probe-worker.mjs");
  const clientSource = read("src/lib/runtime-v2/openmontage-probe-job.ts");
  for (const source of [health, setup]) {
    assert.match(source, /requireUserId\(\)/u);
    assert.match(source, /runOpenMontageProbeViaRuntime/u);
    assert.match(source, /runtimeAuthorityErrorResponse/u);
    assert.doesNotMatch(
      source,
      /@\/lib\/openmontage\/(?:runtime|setup)|node:child_process|spawnSync|spawn\s*\(|execFile/u,
    );
  }
  assert.match(health, /available:\s*status\.ready/u);
  assert.match(health, /reason:\s*status\.reason \|\| null/u);
  assert.doesNotMatch(
    health,
    /runManagedSetupJob|acquireServiceLease|ensureService|startService|persistent/u,
  );
  assert.match(setup, /action !== "install-dependencies" && action !== "install-remotion"/u);
  assert.match(setup, /serviceId:\s*"openmontage"/u);
  assert.match(setup, /message:\s*result\.message/u);
  assert.doesNotMatch(clientSource, /node:child_process|spawnSync|spawn\s*\(|execFile|process\.env/u);
  assert.match(worker, /expectedInputCount:\s*\(\)\s*=>\s*0/u);
  assert.match(worker, /4eab34c5cfcccaa4f1970554928feccce73ee930/u);
});
