import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import esbuild from "esbuild";

import {
  executeRuntimeV2PythonAgentProbe,
  validateRuntimeV2PythonAgentProbeEnvironment,
  validateRuntimeV2PythonAgentProbeRequest,
  validateRuntimeV2PythonAgentProbeResult,
  validateRuntimeV2PythonAgentProbeScope,
} from "../scripts/runtime-v2-python-agent-probe-worker-core.mjs";

const dashboardRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.dirname(dashboardRoot);

async function loadClient() {
  const built = await esbuild.build({
    entryPoints: [
      path.join(dashboardRoot, "src", "lib", "runtime-v2", "python-agent-probe-job.ts"),
    ],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "python-agent-probe-stubs",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "python-agent-probe-stub",
        }));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => ({
          path: "supervisor-control",
          namespace: "python-agent-probe-stub",
        }));
        build.onLoad({ filter: /server-only/, namespace: "python-agent-probe-stub" }, () => ({
          loader: "js",
          contents: "export {};",
        }));
        build.onLoad({ filter: /supervisor-control/, namespace: "python-agent-probe-stub" }, () => ({
          loader: "js",
          contents: `
            export class RuntimeJobControlError extends Error {
              constructor(input) { super(input.message); Object.assign(this, input); }
            }
            const unused = async () => { throw new Error("use the injected probe control"); };
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
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}#python-agent-probe`
  );
}

const client = await loadClient();

function snapshot(kind, overrides = {}) {
  return {
    jobId: `job_${kind}_probe_1`,
    jobType: `${kind}-probe`,
    workerKind: `${kind}-probe-node`,
    resourceClass: "document-processing",
    state: "succeeded",
    stage: "complete",
    attempt: 1,
    workerInstanceId: `worker_${kind}_probe_1`,
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

function legalHealth(overrides = {}) {
  return {
    available: true,
    cloned: true,
    root: path.join(repositoryRoot, "harvey-labs"),
    environmentReady: true,
    harnessImportable: true,
    pandocAvailable: true,
    shellAvailable: true,
    systemPython: path.resolve("runtime-v2", "services", "legal", ".venv", "python.exe"),
    uvAvailable: true,
    bridgeFound: true,
    reason: null,
    ...overrides,
  };
}

function shortsHealth(overrides = {}) {
  return {
    available: true,
    cloned: true,
    root: path.join(repositoryRoot, "AI-Youtube-Shorts-Generator"),
    environmentReady: true,
    dependenciesInstalled: true,
    missing: [],
    systemPython: path.resolve("runtime-v2", "services", "shorts", ".venv", "python.exe"),
    uvAvailable: true,
    ffmpeg: path.resolve("runtime-v2", "bin", "ffmpeg.exe"),
    bridgeFound: true,
    reason: null,
    ...overrides,
  };
}

function tradingagentsHealth(overrides = {}) {
  return {
    available: true,
    cloned: true,
    root: path.join(repositoryRoot, "tradingagents"),
    environmentReady: true,
    packageInstalled: true,
    systemPython: path.resolve(
      "runtime-v2",
      "services",
      "tradingagents",
      ".venv",
      "python.exe",
    ),
    uvAvailable: true,
    version: "0.1.0",
    bridgeFound: true,
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

test("the shared worker accepts only fixed user-global health contracts", () => {
  const request = { protocolVersion: 1, operation: "health" };
  const scope = { userId: 31, gardenId: null, conversationId: null };
  assert.equal(validateRuntimeV2PythonAgentProbeRequest(request), request);
  assert.equal(validateRuntimeV2PythonAgentProbeScope(scope), scope);
  assert.doesNotThrow(() => validateRuntimeV2PythonAgentProbeEnvironment("legal", {
    HARVEY_LABS_ROOT: path.join(repositoryRoot, "harvey-labs"),
  }));
  assert.doesNotThrow(() => validateRuntimeV2PythonAgentProbeEnvironment("shorts", {
    SHORTS_ROOT: path.join(repositoryRoot, "AI-Youtube-Shorts-Generator"),
    SHORTS_PYTHON: path.resolve("runtime-v2", "services", "shorts", ".venv", "python.exe"),
  }));
  assert.doesNotThrow(() => validateRuntimeV2PythonAgentProbeEnvironment("tradingagents", {
    TRADINGAGENTS_ROOT: path.join(repositoryRoot, "tradingagents"),
  }));
  for (const forged of [
    { ...request, adapter: "legal" },
    { ...request, executable: "python.exe" },
    { ...request, argv: ["-c", "chosen"] },
    { ...request, env: { OPENAI_API_KEY: "secret" } },
    { ...request, operation: "run" },
  ]) assert.throws(
    () => validateRuntimeV2PythonAgentProbeRequest(forged),
    /canonical Python agent probe request/u,
  );
  assert.throws(
    () => validateRuntimeV2PythonAgentProbeScope({ ...scope, gardenId: "chosen" }),
    /user-global scope/u,
  );
  assert.throws(
    () => validateRuntimeV2PythonAgentProbeEnvironment("shorts", {
      SHORTS_ROOT: "relative",
      SHORTS_PYTHON: "relative",
    }),
    /sealed Python agent/u,
  );
});

test("each client submits its own fresh sealed job and preserves exact health", async () => {
  for (const [kind, expected] of [
    ["legal", legalHealth()],
    ["shorts", shortsHealth()],
    ["tradingagents", tradingagentsHealth()],
  ]) {
    const job = snapshot(kind);
    const state = calls();
    assert.deepEqual(await client.runPythonAgentProbeViaRuntime({
      kind,
      userId: 31,
      control: control(job, expected, state),
    }), expected);
    assert.deepEqual(state.submissions[0].authority, {
      userId: 31,
      gardenId: null,
      conversationId: null,
    });
    assert.equal(state.submissions[0].submission.jobType, `${kind}-probe`);
    assert.deepEqual(state.submissions[0].submission.requestPayload, {
      protocolVersion: 1,
      operation: "health",
    });
    assert.equal(state.submissions[0].submission.inputUploads, undefined);
    assert.match(
      state.submissions[0].submission.idempotencyKey,
      new RegExp(`^${kind}-probe-v2:[a-f0-9]{64}$`, "u"),
    );
    assert.doesNotMatch(
      JSON.stringify(state.submissions[0].submission),
      /python|adapter|argv|executable|environment|OPENAI_API_KEY/u,
    );
    const second = calls();
    await client.runPythonAgentProbeViaRuntime({
      kind,
      userId: 31,
      control: control(job, expected, second),
    });
    assert.notEqual(
      state.submissions[0].submission.idempotencyKey,
      second.submissions[0].submission.idempotencyKey,
    );
  }
});

test("the historical 20-second cache, force refresh, and service-isolated single flight remain", async () => {
  client.invalidatePythonAgentProbe("legal");
  client.invalidatePythonAgentProbe("shorts");
  client.invalidatePythonAgentProbe("tradingagents");
  const legalJob = snapshot("legal");
  const first = calls();
  const expectedLegal = legalHealth({ pandocAvailable: false });
  assert.deepEqual(await client.legalHealthViaRuntime({
    userId: 31,
    control: control(legalJob, expectedLegal, first),
  }), expectedLegal);
  assert.equal(first.submissions.length, 1);

  const cached = calls();
  assert.deepEqual(await client.legalHealthViaRuntime({
    userId: 32,
    control: control(legalJob, legalHealth(), cached),
  }), expectedLegal);
  assert.equal(cached.submissions.length, 0);

  const refreshed = calls();
  const refreshedControl = control(legalJob, legalHealth(), refreshed);
  const [left, right] = await Promise.all([
    client.legalHealthViaRuntime({ userId: 31, force: true, control: refreshedControl }),
    client.legalHealthViaRuntime({ userId: 32, force: true, control: refreshedControl }),
  ]);
  assert.equal(refreshed.submissions.length, 1);
  assert.deepEqual(left, legalHealth());
  assert.deepEqual(right, left);

  const shortsState = calls();
  assert.deepEqual(await client.shortsHealthViaRuntime({
    userId: 31,
    control: control(snapshot("shorts"), shortsHealth(), shortsState),
  }), shortsHealth());
  assert.equal(shortsState.submissions.length, 1, "Legal cache never answers Shorts health");

  const tradingState = calls();
  assert.deepEqual(await client.tradingagentsHealthViaRuntime({
    userId: 31,
    control: control(
      snapshot("tradingagents"),
      tradingagentsHealth(),
      tradingState,
    ),
  }), tradingagentsHealth());
  assert.equal(tradingState.submissions.length, 1, "another service cache cannot answer Trading Agent");
});

test("forged fences, paths, and contradictory health metadata are rejected", async () => {
  for (const [kind, value, overrides] of [
    ["legal", legalHealth(), { identity: { workerInstanceId: "forged" } }],
    ["legal", legalHealth({ root: "../outside" }), {}],
    ["legal", legalHealth({ available: true, reason: "not ready" }), {}],
    ["legal", legalHealth({ environmentReady: false, systemPython: null }), {}],
    ["shorts", shortsHealth(), { completionSequence: 3 }],
    ["shorts", shortsHealth({ missing: ["x".repeat(300)] }), {}],
    ["shorts", shortsHealth({ dependenciesInstalled: true, missing: ["yt-dlp"] }), {}],
    ["shorts", shortsHealth({ ffmpeg: null }), {}],
    ["tradingagents", tradingagentsHealth({ version: "x".repeat(300) }), {}],
    ["tradingagents", tradingagentsHealth({ packageInstalled: false }), {}],
  ]) {
    await assert.rejects(
      client.runPythonAgentProbeViaRuntime({
        kind,
        userId: 31,
        control: control(snapshot(kind), value, calls(), overrides),
      }),
      /Legal Agent|Shorts|Trading Agent/u,
    );
  }
});

test("running and uncertain probes forward exact Runtime cancellation", async () => {
  const running = snapshot("legal", {
    state: "running",
    finishedAt: null,
    lastWorkerSequence: 2,
  });
  const state = calls();
  const abort = new AbortController();
  const current = control(running, legalHealth(), state);
  current.inspect = async () => structuredClone(running);
  const promise = client.runPythonAgentProbeViaRuntime({
    kind: "legal",
    userId: 31,
    signal: abort.signal,
    control: current,
  });
  queueMicrotask(() => abort.abort(new DOMException("Stopped", "AbortError")));
  await assert.rejects(promise, /Stopped|Aborted/u);
  assert.equal(state.cancellations.length, 1);

  const uncertain = calls();
  const uncertainAbort = new AbortController();
  const lost = control(running, legalHealth(), uncertain);
  lost.submit = async (authority, submission) => {
    uncertain.submissions.push({
      authority: structuredClone(authority),
      submission: structuredClone(submission),
    });
    uncertainAbort.abort(new DOMException("Stopped", "AbortError"));
    throw new Error("submit response was lost");
  };
  await assert.rejects(
    client.runPythonAgentProbeViaRuntime({
      kind: "legal",
      userId: 31,
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

test("one aborted cache waiter does not cancel a probe still observed by another waiter", async () => {
  client.invalidatePythonAgentProbe("legal");
  const running = snapshot("legal", {
    state: "running",
    finishedAt: null,
    lastWorkerSequence: 2,
  });
  const state = calls();
  const current = control(running, legalHealth(), state);
  current.inspect = async () => structuredClone(running);
  const leftAbort = new AbortController();
  const rightAbort = new AbortController();
  const left = client.legalHealthViaRuntime({
    userId: 31,
    force: true,
    signal: leftAbort.signal,
    control: current,
  });
  const right = client.legalHealthViaRuntime({
    userId: 32,
    force: true,
    signal: rightAbort.signal,
    control: current,
  });
  leftAbort.abort(new DOMException("Left stopped", "AbortError"));
  await assert.rejects(left, /Left stopped/u);
  assert.equal(state.cancellations.length, 0);
  rightAbort.abort(new DOMException("Right stopped", "AbortError"));
  await assert.rejects(right, /Right stopped/u);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(state.cancellations.length, 1);
});

test("all fixed workers use private homes and strip model, control, and proxy secrets", async (t) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-agent-probes-"));
  t.after(() => fs.rmSync(dataRoot, { recursive: true, force: true }));
  const names = [
    "HARVEY_LABS_ROOT",
    "LEGAL_AGENT_BASH",
    "SHORTS_ROOT",
    "SHORTS_PYTHON",
    "TRADINGAGENTS_ROOT",
    "BREADBOARD_RUNTIME_V2_VIMAX_FFMPEG_PATH",
    "CHATMOCK_API_KEY",
    "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
    "BREADBOARD_HERMES_SESSION_TOKEN",
    "BREADBOARD_HERMES_TOOL_SECRET",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_API_BASE",
    "GBRAIN_ADAPTER_SECRET",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "BREADBOARD_DATA_DIR",
    "BREADBOARD_DEVELOPMENT_DASHBOARD_DIR",
    "BREADBOARD_LEARN_SOURCE_ROOT",
    "BREADBOARD_REPO_ROOT",
    "BREADBOARD_QA_MODE",
    "NODE_ENV",
    "HOME",
    "USERPROFILE",
    "TMP",
    "TEMP",
    "TMPDIR",
  ];
  const before = new Map(names.map((name) => [name, process.env[name]]));
  const priorCwd = process.cwd();
  try {
    for (const kind of ["legal", "shorts", "tradingagents"]) {
      const workspace = path.join(dataRoot, "runtime", "jobs", `job_${kind}`, "workspace");
      fs.mkdirSync(workspace, { recursive: true });
      const python = path.join(
        dataRoot,
        "runtime-v2",
        "services",
        kind,
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, "fixed interpreter receipt\n");
      process.env.HARVEY_LABS_ROOT = path.join(repositoryRoot, "harvey-labs");
      process.env.SHORTS_ROOT = path.join(repositoryRoot, "AI-Youtube-Shorts-Generator");
      process.env.TRADINGAGENTS_ROOT = path.join(repositoryRoot, "tradingagents");
      process.env.SHORTS_PYTHON = path.join(
        dataRoot,
        "runtime-v2",
        "services",
        "shorts",
        ".venv",
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
      );
      process.env.CHATMOCK_API_KEY = "must-not-reach-probe";
      process.env.BREADBOARD_SUPERVISOR_CONTROL_TOKEN = "must-not-reach-probe";
      process.env.OPENAI_API_KEY = "must-not-reach-probe";
      process.env.HTTP_PROXY = "http://must-not-reach-probe.invalid";
      const expected = kind === "legal"
        ? legalHealth({ systemPython: python })
        : kind === "shorts"
          ? shortsHealth({ systemPython: python })
          : tradingagentsHealth({ systemPython: python });
      const checkpoints = [];
      let receivedLayout;
      let receivedSignal;
      const controller = new AbortController();
      const result = await executeRuntimeV2PythonAgentProbe(kind, {
        dataRoot,
        workspacePath: workspace,
        executionScope: { userId: 31, gardenId: null, conversationId: null },
        request: { protocolVersion: 1, operation: "health" },
        inputBlobs: [],
      }, controller.signal, {
        checkpoint(value) { checkpoints.push(value); },
      }, {
        async loadHealth(layout, signal) {
          receivedLayout = layout;
          receivedSignal = signal;
          for (const name of [
            "CHATMOCK_API_KEY",
            "BREADBOARD_SUPERVISOR_CONTROL_TOKEN",
            "OPENAI_API_KEY",
            "HTTP_PROXY",
          ]) assert.equal(process.env[name], undefined);
          assert.equal(process.env.HOME, path.join(workspace, `${kind}-probe-process`, "home"));
          assert.equal(process.env.TMP, path.join(workspace, `${kind}-probe-process`, "tmp"));
          assert.equal(process.env.BREADBOARD_QA_MODE, "1");
          return expected;
        },
      });
      assert.deepEqual(result, expected);
      assert.equal(receivedLayout.adapterId, kind);
      assert.equal(receivedLayout.dataRoot, dataRoot);
      assert.equal(receivedSignal, controller.signal);
      assert.deepEqual(checkpoints, [
        { stage: "preparing", percent: 10 },
        { stage: "probing", percent: 35 },
        { stage: "complete", percent: 100 },
      ]);
    }
  } finally {
    process.chdir(priorCwd);
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("health/setup routes delegate durably and cannot own Python or start services", () => {
  const read = (relative) => fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
  const clientSource = read("src/lib/runtime-v2/python-agent-probe-job.ts");
  const core = read("scripts/runtime-v2-python-agent-probe-worker-core.mjs");
  for (const kind of ["legal", "shorts", "tradingagents"]) {
    const healthRoute = read(`src/app/api/${kind}/health/route.ts`);
    const setupRoute = read(`src/app/api/${kind}/setup/route.ts`);
    assert.match(healthRoute, /requireUserId\(\)/u);
    assert.match(healthRoute, new RegExp(`${kind}HealthViaRuntime`, "iu"));
    assert.match(setupRoute, new RegExp(`invalidatePythonAgentProbe\\("${kind}"\\)`, "u"));
    for (const source of [healthRoute, setupRoute]) {
      assert.doesNotMatch(
        source,
        new RegExp(`@/lib/${kind}/runtime|node:child_process|spawn\\s*\\(|execFile`, "u"),
      );
    }
    assert.doesNotMatch(
      healthRoute,
      /runManagedSetupJob|acquireServiceLease|ensureService|startService|service-lease|persistent/u,
    );
    assert.match(
      read(`scripts/runtime-v2-${kind}-probe-worker.mjs`),
      new RegExp(`runRuntimeV2PythonAgentProbeWorker\\("${kind}"\\)`, "u"),
    );
  }
  assert.doesNotMatch(clientSource, /node:child_process|spawn\s*\(|execFile|process\.env/u);
  assert.match(core, /expectedInputCount:\s*\(\)\s*=>\s*0/u);
  assert.match(core, /runtime\.health\(\{ force: true, signal \}\)/u);
  assert.doesNotMatch(core, /launch\.request\.(?:adapter|executable|argv|env)/u);
  assert.doesNotThrow(() => validateRuntimeV2PythonAgentProbeResult("legal", legalHealth()));
  assert.doesNotThrow(() => validateRuntimeV2PythonAgentProbeResult("shorts", shortsHealth()));
  assert.doesNotThrow(() => validateRuntimeV2PythonAgentProbeResult(
    "tradingagents",
    tradingagentsHealth(),
  ));
});
