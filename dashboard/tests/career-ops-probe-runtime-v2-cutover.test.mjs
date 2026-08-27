import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import esbuild from "esbuild";

import {
  executeRuntimeV2CareerOpsProbe,
  validateRuntimeV2CareerOpsProbeEnvironment,
  validateRuntimeV2CareerOpsProbeRequest,
  validateRuntimeV2CareerOpsProbeScope,
} from "../scripts/runtime-v2-career-ops-probe-worker.mjs";
import { careerOpsDoctorEnv } from "../src/lib/career-ops/runtime.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.dirname(dashboardRoot);

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [
      path.join(dashboardRoot, "src", "lib", "runtime-v2", "career-ops-probe-job.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "career-ops-probe-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "career-probe-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "career-probe-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "career-probe-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "career-probe-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(input) { super(input.message); Object.assign(this, input); }
            }
            const unused = async () => { throw new Error("use the injected Career Ops control"); };
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
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#career-ops-probe`
  );
}

const client = await loadClient();

function snapshot(overrides = {}) {
  return {
    jobId: "job_career_probe_1",
    jobType: "career-ops-probe",
    workerKind: "career-ops-probe-node",
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "finalizing",
    attempt: 1,
    workerInstanceId: "worker_career_probe_1",
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

function health(overrides = {}) {
  return {
    available: true,
    cloned: true,
    root: path.resolve("runtime-v2", "toolchains", "career-ops"),
    dependenciesInstalled: true,
    browsersInstalled: true,
    onboarding: {
      onboardingNeeded: false,
      missing: [],
      warnings: [],
      autoCopied: ["modes/_profile.md"],
    },
    modeCount: 26,
    trackedApplications: 7,
    reason: null,
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
      return {
        jobId,
        kind,
        content: envelope(job, result, outputOverrides),
      };
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

test("the Career Ops probe accepts only its fixed user-global doctor contract", () => {
  const request = { protocolVersion: 1, operation: "doctor" };
  const scope = { userId: 17, gardenId: null, conversationId: null };
  assert.equal(validateRuntimeV2CareerOpsProbeRequest(request), request);
  assert.equal(validateRuntimeV2CareerOpsProbeScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2CareerOpsProbeEnvironment({
    CAREER_OPS_ROOT: path.resolve("career-ops"),
    PLAYWRIGHT_BROWSERS_PATH: path.resolve("runtime-v2", "career-ops-browsers"),
  }));
  for (const forged of [
    { ...request, argv: ["doctor.mjs"] },
    { ...request, executable: "node.exe" },
    { ...request, env: { CHATMOCK_API_KEY: "secret" } },
    { ...request, operation: "serve" },
  ]) assert.throws(
    () => validateRuntimeV2CareerOpsProbeRequest(forged),
    /canonical Career Ops probe request/u,
  );
  assert.throws(
    () => validateRuntimeV2CareerOpsProbeScope({ ...scope, conversationId: "chosen" }),
    /user-global scope/u,
  );
  assert.throws(
    () => validateRuntimeV2CareerOpsProbeEnvironment({
      CAREER_OPS_ROOT: "relative",
      PLAYWRIGHT_BROWSERS_PATH: "relative",
    }),
    /sealed Career Ops probe paths/u,
  );
});

test("the client submits a fresh sealed probe and preserves the exact health result", async () => {
  const job = snapshot();
  const state = calls();
  const expected = health();
  const answer = await client.runCareerOpsProbeViaRuntime({
    userId: 17,
    control: control(job, expected, state),
  });
  assert.deepEqual(answer, expected);
  assert.deepEqual(state.submissions[0].authority, {
    userId: 17,
    gardenId: null,
    conversationId: null,
  });
  assert.deepEqual(state.submissions[0].submission.requestPayload, {
    protocolVersion: 1,
    operation: "doctor",
  });
  assert.equal(state.submissions[0].submission.jobType, "career-ops-probe");
  assert.equal(state.submissions[0].submission.inputUploads, undefined);
  assert.match(
    state.submissions[0].submission.idempotencyKey,
    /^career-ops-probe-v2:[a-f0-9]{64}$/u,
  );
  assert.doesNotMatch(
    JSON.stringify(state.submissions[0].submission),
    /doctor\.mjs|node\.exe|argv|executable|environment|CHATMOCK_API_KEY/u,
  );

  const second = calls();
  await client.runCareerOpsProbeViaRuntime({
    userId: 17,
    control: control(job, expected, second),
  });
  assert.notEqual(
    state.submissions[0].submission.idempotencyKey,
    second.submissions[0].submission.idempotencyKey,
    "every uncached probe uses a fresh disposable job",
  );
});

test("the 30-second cache, force refresh, and single flight remain intact", async () => {
  client.invalidateCareerOpsHealth();
  const job = snapshot();
  const first = calls();
  const expected = health({ trackedApplications: 11 });
  const initial = await client.careerOpsHealthViaRuntime({
    userId: 17,
    control: control(job, expected, first),
  });
  assert.deepEqual(initial, expected);
  assert.equal(first.submissions.length, 1);

  const cached = calls();
  assert.deepEqual(await client.careerOpsHealthViaRuntime({
    userId: 17,
    control: control(job, health({ trackedApplications: 99 }), cached),
  }), expected);
  assert.equal(cached.submissions.length, 0);

  const refreshed = calls();
  const current = control(job, health({ trackedApplications: 12 }), refreshed);
  const [left, right] = await Promise.all([
    client.careerOpsHealthViaRuntime({ userId: 17, force: true, control: current }),
    client.careerOpsHealthViaRuntime({ userId: 18, force: true, control: current }),
  ]);
  assert.equal(refreshed.submissions.length, 1, "concurrent refreshes share one probe");
  assert.equal(left.trackedApplications, 12);
  assert.deepEqual(right, left);
});

test("forged fences and unbounded health metadata are rejected", async () => {
  const job = snapshot();
  for (const [result, overrides] of [
    [health(), { identity: { workerInstanceId: "worker_forged" } }],
    [health(), { completionSequence: 3 }],
    [health({ root: "../outside" }), {}],
    [health({ modeCount: -1 }), {}],
    [health({ onboarding: { ...health().onboarding, warnings: ["x".repeat(3_000)] } }), {}],
    [health({ available: true, onboarding: null }), {}],
  ]) {
    await assert.rejects(
      client.runCareerOpsProbeViaRuntime({
        userId: 17,
        control: control(job, result, calls(), overrides),
      }),
      /Career Ops/u,
    );
  }
});

test("running and uncertain probes forward cancellation without a spawn fallback", async () => {
  const running = snapshot({ state: "running", finishedAt: null, lastWorkerSequence: 2 });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, health(), state);
  current.inspect = async () => structuredClone(running);
  const promise = client.runCareerOpsProbeViaRuntime({
    userId: 17,
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped|Aborted/u);
  assert.equal(state.cancellations.length, 1);

  const uncertain = calls();
  const uncertainAbort = new AbortController();
  const lost = control(running, health(), uncertain);
  lost.submit = async (authority, submission) => {
    uncertain.submissions.push({
      authority: structuredClone(authority),
      submission: structuredClone(submission),
    });
    uncertainAbort.abort(new DOMException("Stopped", "AbortError"));
    throw new Error("submit response was lost");
  };
  await assert.rejects(
    client.runCareerOpsProbeViaRuntime({
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

test("the worker runs the fixed doctor in the managed Runtime workspace with a closed child env", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-career-probe-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const managed = path.join(dataRoot, "runtime-v2", "toolchains", "career-ops");
  const browserRoot = path.join(dataRoot, "runtime-v2", "toolchains", "career-ops-browsers");
  const workspace = path.join(dataRoot, "runtime", "jobs", "job_career_probe_1", "workspace");
  fs.mkdirSync(path.join(managed, "modes"), { recursive: true });
  fs.mkdirSync(path.join(managed, ".agents", "skills", "career-ops"), { recursive: true });
  fs.mkdirSync(path.join(managed, "node_modules", "js-yaml"), { recursive: true });
  fs.mkdirSync(path.join(managed, "data"), { recursive: true });
  fs.mkdirSync(path.join(browserRoot, "chromium-123"), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(managed, "modes", "evaluate.md"), "# Evaluate\n");
  fs.writeFileSync(path.join(managed, ".agents", "skills", "career-ops", "SKILL.md"), "# Career Ops\n");
  fs.writeFileSync(
    path.join(managed, "data", "applications.md"),
    "| ID | Role |\n|---|---|\n| 1 | SRE |\n| 2 | Platform |\n",
  );
  fs.writeFileSync(path.join(managed, "doctor.mjs"), `
    import fs from "node:fs";
    import path from "node:path";
    fs.writeFileSync("doctor-receipt.json", JSON.stringify({
      script: path.basename(process.argv[1]),
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      chatmock: process.env.CHATMOCK_API_KEY ?? null,
      supervisor: process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN ?? null,
      proxy: process.env.HTTP_PROXY ?? null,
      careerRoot: process.env.CAREER_OPS_ROOT ?? null,
      playwright: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
      home: process.env.HOME ?? null,
      temporary: process.env.TMP ?? null,
    }));
    console.log(JSON.stringify({
      onboardingNeeded: false,
      missing: [],
      warnings: ["ready"],
      autoCopied: ["modes/_profile.md"],
    }));
  `);

  const names = [
    "CAREER_OPS_ROOT",
    "PLAYWRIGHT_BROWSERS_PATH",
    "CHATMOCK_API_KEY",
    "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "BREADBOARD_DATA_DIR",
    "BREADBOARD_DEVELOPMENT_DASHBOARD_DIR",
    "BREADBOARD_LEARN_SOURCE_ROOT",
    "BREADBOARD_REPO_ROOT",
    "NODE_ENV",
  ];
  const before = new Map(names.map((name) => [name, process.env[name]]));
  const priorCwd = process.cwd();
  try {
    process.env.CAREER_OPS_ROOT = path.join(repositoryRoot, "career-ops");
    process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
    process.env.CHATMOCK_API_KEY = "must-not-reach-doctor";
    process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "must-not-reach-doctor";
    process.env.HTTP_PROXY = "http://must-not-reach-doctor.invalid";
    const checkpoints = [];
    const result = await executeRuntimeV2CareerOpsProbe({
      dataRoot,
      workspacePath: workspace,
      executionScope: { userId: 17, gardenId: null, conversationId: null },
      request: { protocolVersion: 1, operation: "doctor" },
      inputBlobs: [],
    }, new AbortController().signal, {
      checkpoint(value) { checkpoints.push(value); },
    });
    assert.deepEqual(result, {
      available: true,
      cloned: true,
      root: managed,
      dependenciesInstalled: true,
      browsersInstalled: true,
      onboarding: {
        onboardingNeeded: false,
        missing: [],
        warnings: ["ready"],
        autoCopied: ["modes/_profile.md"],
      },
      modeCount: 1,
      trackedApplications: 2,
      reason: null,
    });
    assert.deepEqual(checkpoints, [
      { stage: "preparing", percent: 10 },
      { stage: "probing", percent: 35 },
      { stage: "complete", percent: 100 },
    ]);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(managed, "doctor-receipt.json"), "utf8")),
      {
        script: "doctor.mjs",
        argv: ["--json"],
        cwd: managed,
        chatmock: null,
        supervisor: null,
        proxy: null,
        careerRoot: null,
        playwright: browserRoot,
        home: path.join(workspace, "career-ops-probe-process", "home"),
        temporary: path.join(workspace, "career-ops-probe-process", "tmp"),
      },
    );
  } finally {
    process.chdir(priorCwd);
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("the doctor environment is closed and the health route cannot start a service", () => {
  const child = careerOpsDoctorEnv({
    NODE_ENV: "production",
    CHATMOCK_API_KEY: "secret",
    BREADBOARD_SUPERVISOR_CONTROL_TOKEN: "control",
    HTTP_PROXY: "http://proxy.invalid",
    CAREER_OPS_ROOT: path.resolve("career-ops"),
    PLAYWRIGHT_BROWSERS_PATH: path.resolve("browsers"),
    SystemRoot: "C:\\Windows",
  });
  assert.deepEqual(child, {
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CI: "1",
    PLAYWRIGHT_BROWSERS_PATH: path.resolve("browsers"),
    SystemRoot: "C:\\Windows",
  });

  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const healthRoute = read("src/app/api/career-ops/health/route.ts");
  const setupRoute = read("src/app/api/career-ops/setup/route.ts");
  const clientSource = read("src/lib/runtime-v2/career-ops-probe-job.ts");
  const workerSource = read("scripts/runtime-v2-career-ops-probe-worker.mjs");
  assert.match(healthRoute, /requireUserId\(\)/u);
  assert.match(healthRoute, /careerOpsHealthViaRuntime/u);
  assert.match(setupRoute, /invalidateCareerOpsHealth/u);
  for (const source of [healthRoute, setupRoute]) {
    assert.doesNotMatch(source, /career-ops\/runtime|node:child_process|spawn\s*\(|execFile\s*\(/u);
  }
  assert.doesNotMatch(
    healthRoute,
    /acquireServiceLease|ensureService|startService|service-lease|persistent/u,
  );
  assert.doesNotMatch(clientSource, /node:child_process|spawn\s*\(|execFile\s*\(|process\.env/u);
  assert.match(workerSource, /expectedInputCount:\s*\(\)\s*=>\s*0/u);
  assert.match(workerSource, /probeCareerOpsHealth/u);
  assert.match(workerSource, /CHATMOCK_API_KEY/u);
  assert.match(read("src/lib/career-ops/runtime.ts"), /\["doctor\.mjs", "--json"\]/u);
});
