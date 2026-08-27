import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  executeRuntimeV2OuterAgentAdapter,
  expectedRuntimeV2OuterAgentInputCount,
  RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS,
  validateRuntimeV2OpenPlanterRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { resolveOpenPlanterArtifactPath } from
  "../src/lib/openplanter/runtime-run-manager.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relativePath) => fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8");

function canonicalRequest(overrides = {}) {
  return {
    task: "Map the evidence and report the strongest ownership link",
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "User: Earlier we narrowed this to three entities.",
    ...overrides,
  };
}

test("OpenPlanter uses one sealed no-input outer-agent adapter", () => {
  const request = validateRuntimeV2OpenPlanterRequest(canonicalRequest());
  assert.equal(expectedRuntimeV2OuterAgentInputCount("openplanter", request), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS.openplanter, {
    id: "openplanter",
    workerKind: "outer-openplanter-node",
    jobType: "openplanter-run",
    scopePrefix: "oa_openplanter_",
    maximumInputs: 0,
  });
  for (const override of [
    { argv: ["attacker.py"] },
    { executable: "python.exe" },
    { env: { OPENPLANTER_ROOT: "elsewhere" } },
    { apiKey: "renderer-secret" },
    { runtimeWorkspacePath: "C:\\other" },
  ]) {
    assert.throws(
      () => validateRuntimeV2OpenPlanterRequest({ ...canonicalRequest(), ...override }),
      /invalid/u,
    );
  }
});

function fakeManagerSource() {
  return `
import fs from "node:fs";
import path from "node:path";
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  fs.writeFileSync(path.join(input.runtimeWorkspacePath, "launch-receipt.json"), JSON.stringify({
    runId: input.runtimeJobId,
    task: input.task,
    context: input.conversationContext,
    apiKey: input.apiKey,
    workspace: input.runtimeWorkspacePath,
  }));
  const run = { terminal: false, sequence: 1, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: { task: input.task, model: input.model },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: ++run.sequence,
      type: "run.completed",
      payload: { summary: "mapped" },
      at: new Date().toISOString(),
    });
  }, 25);
  return { runId: input.runtimeJobId, status: "running" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  run.terminal = true;
  run.events.push({
    sequenceNumber: ++run.sequence,
    type: "run.aborted",
    payload: { summary: "OpenPlanter investigation stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`;
}

async function fakeWorkerRun({ abort = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openplanter-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "openplanter", "run-manager.ts");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(managerPath, fakeManagerSource());
  const controller = new AbortController();
  const updates = [];
  const promise = executeRuntimeV2OuterAgentAdapter({
    adapterId: "openplanter",
    launch: {
      identity: {
        jobId: "job_openplanter_1",
        attempt: 1,
        workerInstanceId: "worker_openplanter_1",
      },
      executionScope: {
        userId: 7,
        gardenId: null,
        conversationId: `oa_openplanter_${"a".repeat(32)}`,
      },
      request: canonicalRequest(),
      inputBlobs: [],
      inputPaths: [],
      workspacePath,
    },
    sourceRoot,
    signal: controller.signal,
    update: (events, status) => updates.push({ events, status }),
  });
  if (abort) setTimeout(() => controller.abort(), 5);
  try {
    const outcome = await promise;
    const receipt = JSON.parse(fs.readFileSync(path.join(workspacePath, "launch-receipt.json")));
    return { outcome, updates, receipt, workspacePath };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the worker adapter preserves context/progress and acknowledges Runtime cancellation", async () => {
  const completed = await fakeWorkerRun();
  assert.equal(completed.outcome.status, "completed");
  assert.equal(completed.receipt.runId, "job_openplanter_1");
  assert.equal(completed.receipt.context, canonicalRequest().conversationContext);
  assert.equal(completed.receipt.apiKey, "local");
  assert.equal(completed.receipt.workspace, completed.workspacePath);
  assert.ok(completed.updates.flatMap((entry) => entry.events)
    .some((event) => event.type === "run.completed"));

  const aborted = await fakeWorkerRun({ abort: true });
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.updates.flatMap((entry) => entry.events)
    .some((event) => event.type === "run.aborted"));
});

test("durable artifact receipts fence the attempt, session, path, and exact size", () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openplanter-artifact-"));
  const job = {
    jobId: "job_openplanter_artifact_1",
    attempt: 1,
    workerInstanceId: "worker_openplanter_artifact_1",
  };
  const sessionId = "20260826-120000-a1b2c3";
  const relativePath = "artifacts/outputs/result.md";
  const artifactPath = path.join(
    dataRoot,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    "1",
    job.workerInstanceId,
    "workspace",
    ".openplanter",
    "sessions",
    sessionId,
    ...relativePath.split("/"),
  );
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, "durable result\n");
  const record = {
    id: "0123456789abcdefabcd",
    name: "result.md",
    path: relativePath,
    kind: "md",
    size: fs.statSync(artifactPath).size,
    preview: "durable result",
  };
  const event = {
    sequenceNumber: 3,
    type: "artifacts.updated",
    payload: { sessionId, artifacts: [record] },
    at: new Date().toISOString(),
  };
  try {
    const resolved = resolveOpenPlanterArtifactPath({
      dataRoot,
      job,
      events: [event],
      artifactId: record.id,
    });
    assert.equal(resolved?.canonicalPath, fs.realpathSync.native(artifactPath));
    assert.equal(resolved?.record.name, "result.md");

    fs.appendFileSync(artifactPath, "tamper");
    assert.equal(resolveOpenPlanterArtifactPath({
      dataRoot,
      job,
      events: [event],
      artifactId: record.id,
    }), null);
    const traversal = {
      ...event,
      payload: { sessionId, artifacts: [{ ...record, path: "../../outside.md" }] },
    };
    assert.equal(resolveOpenPlanterArtifactPath({
      dataRoot,
      job,
      events: [traversal],
      artifactId: record.id,
    }), null);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("Next has no OpenPlanter spawn, secret, polling, buffering, or fallback seam", () => {
  const facade = source("src/lib/openplanter/runtime-run-manager.ts");
  const worker = source("src/lib/openplanter/run-manager.ts");
  const runtime = source("src/lib/openplanter/runtime.ts");
  const runner = source("scripts/openplanter-chatmock-runner.py");
  const route = source("src/app/api/openplanter/runs/route.ts");
  const events = source("src/app/api/openplanter/runs/[runId]/events/route.ts");
  const artifact = source("src/app/api/openplanter/runs/[runId]/artifacts/[artifactId]/route.ts");
  const cancel = source("src/lib/conversations/external-agent-cancel.ts");

  assert.doesNotMatch(facade, /node:child_process|\bspawn(?:Sync)?\(/);
  assert.doesNotMatch(facade, /startRuntimeWorkerRun/);
  assert.match(facade, /startOuterAgentRun\(\{/);
  assert.doesNotMatch(route, /chatmockApiKeyValue|apiKey/);
  assert.match(events, /outerAgentEventsResponse/);
  assert.doesNotMatch(events, /setInterval\(/);
  assert.match(artifact, /new Response\(stream/);
  assert.doesNotMatch(artifact, /toString\("utf8"\)/);
  assert.match(cancel, /openplanter\/runtime-run-manager\.ts/);

  assert.match(worker, /spawn\(python, \[runner\]/);
  assert.match(worker, /child\.stdin\?\.end\(invocationBytes\(input\)\)/);
  assert.doesNotMatch(worker, /env:\s*\{\s*\.\.\.process\.env/);
  assert.doesNotMatch(worker, /BREADBOARD_SUPERVISOR_CONTROL_TOKEN/);
  assert.doesNotMatch(worker, /CHATMOCK_API_KEY/);
  assert.doesNotMatch(runtime, /node:child_process|spawnSync/);
  assert.match(runner, /read_invocation\(\)/);
  assert.doesNotMatch(runner, /argparse|--openplanter-root|--api-key/);
  assert.match(runner, /MAX_PUBLIC_ARTIFACTS = 32/);
  assert.match(runner, /MAX_RESULT_SUMMARY_BYTES = 128 \* 1024/);
  assert.match(runner, /candidate\.is_symlink\(\)/);
  assert.match(source("scripts/runtime-v2-openplanter-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("openplanter"\)/);
});
