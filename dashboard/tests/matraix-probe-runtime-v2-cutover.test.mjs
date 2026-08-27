import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import esbuild from "esbuild";

import {
  executeRuntimeV2MatraixProbe,
  matraixProbeChildEnvironment,
  validateRuntimeV2MatraixProbeEnvironment,
  validateRuntimeV2MatraixProbeRequest,
  validateRuntimeV2MatraixProbeScope,
} from "../scripts/runtime-v2-matraix-probe-worker.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.dirname(dashboardRoot);
const developmentPool = "persona/datasets/matraix-persona-dev-sample";
const productionPool = "persona/datasets/matraix-persona-1m";
const productionPoolCommand = [
  "huggingface-cli download MatrAIx2026/MatrAIx_Persona_1M_Public_Release",
  "--repo-type dataset",
  `--local-dir ${productionPool}/release`,
].join(" ");

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [
      path.join(dashboardRoot, "src", "lib", "runtime-v2", "matraix-probe-job.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "matraix-probe-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "matraix-probe-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "matraix-probe-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "matraix-probe-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "matraix-probe-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(input) { super(input.message); Object.assign(this, input); }
            }
            const unused = async () => { throw new Error("use the injected MatrAIx control"); };
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
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#matraix-probe`
  );
}

const client = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_matraix_probe_1",
    jobType: "matraix-probe",
    workerKind: "matraix-probe-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "complete",
    attempt: 1,
    workerInstanceId: "worker_matraix_probe_1",
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

function status(overrides = {}) {
  const root = path.join(repositoryRoot, "MatrAIx-Persona-8B");
  const venv = path.resolve("runtime-v2", "services", "matraix", ".venv");
  return {
    ready: true,
    reason: "",
    clone: { found: true, path: root },
    python: {
      found: true,
      path: path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
      version: "3.12.9",
      venv,
    },
    pools: [
      { pool: developmentPool, label: "Development sample", personas: 200, present: true },
      { pool: productionPool, label: "Persona 1M release", personas: 0, present: false },
    ],
    productionPoolCommand,
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

test("the MatrAIx probe accepts only its fixed user-global status contract", () => {
  const request = { protocolVersion: 1, operation: "status" };
  const scope = { userId: 17, gardenId: null, conversationId: null };
  assert.equal(validateRuntimeV2MatraixProbeRequest(request), request);
  assert.equal(validateRuntimeV2MatraixProbeScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2MatraixProbeEnvironment({
    MATRAIX_ROOT: path.join(repositoryRoot, "MatrAIx-Persona-8B"),
  }));
  for (const forged of [
    { ...request, argv: ["--check"] },
    { ...request, executable: "python.exe" },
    { ...request, env: { OPENAI_API_KEY: "secret" } },
    { ...request, operation: "run" },
  ]) assert.throws(
    () => validateRuntimeV2MatraixProbeRequest(forged),
    /canonical MatrAIx probe request/u,
  );
  assert.throws(
    () => validateRuntimeV2MatraixProbeScope({ ...scope, conversationId: "chosen" }),
    /user-global scope/u,
  );
  assert.throws(
    () => validateRuntimeV2MatraixProbeEnvironment({ MATRAIX_ROOT: "relative" }),
    /sealed MatrAIx source root/u,
  );
});

test("the client submits a fresh sealed job and preserves the exact setup status", async () => {
  const job = snapshot();
  const state = calls();
  const expected = status();
  assert.deepEqual(await client.runMatraixProbeViaRuntime({
    userId: 17,
    control: control(job, expected, state),
  }), expected);
  assert.deepEqual(state.submissions[0].authority, {
    userId: 17,
    gardenId: null,
    conversationId: null,
  });
  assert.deepEqual(state.submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "status",
  });
  assert.equal(state.submissions[0].submission.jobType, "matraix-probe");
  assert.equal(state.submissions[0].submission.inputUploads, undefined);
  assert.match(
    state.submissions[0].submission.idempotencyKey,
    /^matraix-probe-v2:[a-f0-9]{64}$/u,
  );
  assert.doesNotMatch(
    JSON.stringify(state.submissions[0].submission),
    /python|matraix-bridge|argv|executable|environment|OPENAI_API_KEY/u,
  );

  const second = calls();
  await client.runMatraixProbeViaRuntime({
    userId: 17,
    control: control(job, expected, second),
  });
  assert.notEqual(
    state.submissions[0].submission.idempotencyKey,
    second.submissions[0].submission.idempotencyKey,
    "every probe receives a fresh disposable worker job",
  );
});

test("forged fences, paths, and unbounded setup metadata are rejected", async () => {
  const job = snapshot();
  for (const [result, overrides] of [
    [status(), { identity: { workerInstanceId: "worker_forged" } }],
    [status(), { completionSequence: 3 }],
    [status({ clone: { found: true, path: "../outside" } }), {}],
    [status({ reason: "x".repeat(9 * 1024) }), {}],
    [status({ pools: [{ ...status().pools[0], personas: -1 }, status().pools[1]] }), {}],
    [status({ ready: true, python: { ...status().python, found: false, path: "" } }), {}],
  ]) {
    await assert.rejects(
      client.runMatraixProbeViaRuntime({
        userId: 17,
        control: control(job, result, calls(), overrides),
      }),
      /MatrAIx/u,
    );
  }
});

test("running and uncertain probes forward cancellation without a spawn fallback", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, status(), state);
  current.inspect = async () => structuredClone(running);
  const promise = client.runMatraixProbeViaRuntime({
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
    client.runMatraixProbeViaRuntime({
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

test("the worker runs only fixed check and catalog probes in a private closed environment", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-matraix-probe-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const workspace = path.join(dataRoot, "runtime", "jobs", "job_matraix_probe_1", "workspace");
  const venv = path.join(dataRoot, "runtime-v2", "services", "matraix", ".venv");
  const python = process.platform === "win32"
    ? path.join(venv, "Scripts", "python.exe")
    : path.join(venv, "bin", "python");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, "fixed test interpreter receipt\n");

  const names = [
    "MATRAIX_ROOT",
    "MATRAIX_WORKSPACE_ROOT",
    "CHATMOCK_API_KEY",
    "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
    "BREADBOARD_HERMES_SESSION_TOKEN",
    "BREADBOARD_HERMES_TOOL_SECRET",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "BREADBOARD_DATA_DIR",
    "BREADBOARD_REPO_ROOT",
    "NODE_ENV",
  ];
  const before = new Map(names.map((name) => [name, process.env[name]]));
  const priorCwd = process.cwd();
  try {
    process.env.MATRAIX_ROOT = path.join(repositoryRoot, "MatrAIx-Persona-8B");
    process.env.MATRAIX_WORKSPACE_ROOT = path.resolve("outside-runtime");
    process.env.CHATMOCK_API_KEY = "must-not-reach-python";
    process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "must-not-reach-python";
    process.env.OPENAI_API_KEY = "must-not-reach-python";
    process.env.HTTP_PROXY = "http://must-not-reach-python.invalid";
    const checkpoints = [];
    const calls = [];
    const controller = new AbortController();
    const result = await executeRuntimeV2MatraixProbe({
      dataRoot,
      workspacePath: workspace,
      executionScope: { userId: 17, gardenId: null, conversationId: null },
      request: { protocolVersion: 1, operation: "status" },
      inputBlobs: [],
    }, controller.signal, {
      checkpoint(value) { checkpoints.push(value); },
    }, {
      async runPython(layout, args, signal, timeoutMs, maximumStdoutBytes) {
        calls.push({ layout, args, signal, timeoutMs, maximumStdoutBytes });
        if (calls.length === 1) {
          return {
            code: 0,
            stdout: `${JSON.stringify({ event: "check.ok", python: "3.12.9" })}\n`,
            stderr: "",
            timedOut: false,
            truncated: false,
          };
        }
        return {
          code: 0,
          stdout: `${JSON.stringify({
            event: "catalog",
            pool: developmentPool,
            count: 200,
            dimensionCount: 1_290,
            sourceCounts: {},
            dimensions: [],
          })}\n`,
          stderr: "",
          timedOut: false,
          truncated: false,
        };
      },
    });
    const root = path.join(repositoryRoot, "MatrAIx-Persona-8B");
    const bridge = path.join(repositoryRoot, "scripts", "matraix-bridge.py");
    assert.deepEqual(result, {
      ready: true,
      reason: "",
      clone: { found: true, path: root },
      python: { found: true, path: python, version: "3.12.9", venv },
      pools: [
        {
          pool: developmentPool,
          label: "Development sample",
          personas: 200,
          present: fs.existsSync(path.join(root, ...developmentPool.split("/"))),
        },
        {
          pool: productionPool,
          label: "Persona 1M release",
          personas: 0,
          present: fs.existsSync(path.join(root, ...productionPool.split("/"), "release")),
        },
      ],
      productionPoolCommand,
    });
    assert.deepEqual(checkpoints, [
      { stage: "preparing", percent: 10 },
      { stage: "checking", percent: 25 },
      { stage: "cataloging", percent: 55 },
      { stage: "complete", percent: 100 },
    ]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].args, [bridge, "--root", root, "--check"]);
    assert.deepEqual(calls[1].args, [
      bridge,
      "--root",
      root,
      "--catalog",
      "--pool",
      developmentPool,
      "--top",
      "80",
    ]);
    assert.equal(calls[0].timeoutMs, 120_000);
    assert.equal(calls[0].maximumStdoutBytes, 1024 * 1024);
    assert.equal(calls[1].timeoutMs, 180_000);
    assert.equal(calls[1].maximumStdoutBytes, 32 * 1024 * 1024);
    assert.equal(calls[0].signal, controller.signal);
    const child = matraixProbeChildEnvironment(calls[0].layout);
    assert.equal(child.HOME, path.join(workspace, "matraix-probe-process", "home"));
    assert.equal(child.TMP, path.join(workspace, "matraix-probe-process", "tmp"));
    assert.equal(child.PATH.split(path.delimiter)[0], path.dirname(python));
    assert.deepEqual(
      Object.keys(child).filter((name) => /CHATMOCK|SUPERVISOR|HERMES|OPENAI|PROXY|MATRAIX/u.test(name)),
      [],
    );
    for (const name of [
      "CHATMOCK_API_KEY",
      "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
      "OPENAI_API_KEY",
      "HTTP_PROXY",
      "MATRAIX_WORKSPACE_ROOT",
    ]) assert.equal(process.env[name], undefined);
  } finally {
    process.chdir(priorCwd);
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("health and setup routes delegate status without a process or persistent-service fallback", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const healthRoute = read("src/app/api/matraix/health/route.ts");
  const setupRoute = read("src/app/api/matraix/setup/route.ts");
  const clientSource = read("src/lib/runtime-v2/matraix-probe-job.ts");
  const workerSource = read("scripts/runtime-v2-matraix-probe-worker.mjs");
  for (const source of [healthRoute, setupRoute]) {
    assert.match(source, /requireUserId\(\)/u);
    assert.match(source, /runMatraixProbeViaRuntime/u);
    assert.doesNotMatch(
      source,
      /@\/lib\/matraix\/(?:runtime|setup|catalog)|node:child_process|spawnSync|spawn\s*\(|execFile/u,
    );
  }
  assert.doesNotMatch(
    healthRoute,
    /runManagedSetupJob|acquireServiceLease|ensureService|startService|service-lease|persistent/u,
  );
  assert.match(setupRoute, /runManagedSetupJob/u);
  assert.doesNotMatch(clientSource, /node:child_process|spawnSync|spawn\s*\(|execFile|process\.env/u);
  assert.match(workerSource, /expectedInputCount:\s*\(\)\s*=>\s*0/u);
  assert.match(workerSource, /\[layout\.bridge, "--root", layout\.root, "--check"\]/u);
  assert.match(workerSource, /CHATMOCK_API_KEY/u);
});
