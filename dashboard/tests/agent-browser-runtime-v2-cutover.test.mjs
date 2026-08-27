import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateKey = "__breadboardAgentBrowserRuntimeV2CutoverState";
const agentId = `abr_${"b".repeat(32)}`;
const otherAgentId = `abr_${"c".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";

function snapshot(jobId, state = "queued", scopedAgentId = agentId) {
  return {
    jobId,
    jobType: "agent-browser-run",
    workerKind: "agent-browser-node",
    resourceClass: "browser-automation",
    state,
    stage: state === "queued" ? null : "working",
    attempt: state === "queued" ? 0 : 1,
    workerInstanceId: state === "queued" ? null : "worker_browser_test",
    gardenId: null,
    conversationId: scopedAgentId,
    createdAt: 1_000,
    startedAt: state === "queued" ? null : 1_100,
    updatedAt: 1_200,
    finishedAt: ["cancelled", "succeeded", "failed"].includes(state) ? 1_200 : null,
    lastHeartbeatAt: state === "queued" ? null : 1_150,
    lastWorkerSequence: 2,
    progressCurrent: 0,
    progressTotal: 0,
    failureCode: state === "failed" ? "WORKER_FAILED" : null,
    failureMessage: state === "failed" ? "Runtime job execution failed." : null,
    resourceExhaustion: null,
    cancellationRequested: state === "cancelled",
  };
}

async function loadCutoverModule() {
  const result = await esbuild.build({
    entryPoints: [path.join(dashboardRoot, "src", "lib", "agent-browser", "run-manager.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    write: false,
    plugins: [{
      name: "agent-browser-runtime-v2-stubs",
      setup(build) {
        const stub = (name) => ({ path: name, namespace: "agent-browser-runtime-v2-stub" });
        build.onResolve({ filter: /runtime-paths\.ts$/ }, () => stub("runtime-paths"));
        build.onResolve({ filter: /ui-tars\/model-provider\.ts$/ }, () => stub("model-provider"));
        build.onResolve({ filter: /supervisor-control\.ts$/ }, () => stub("supervisor-control"));
        build.onResolve({ filter: /config\.ts$/ }, () => stub("config"));
        build.onResolve({ filter: /browser-profile\.ts$/ }, () => stub("browser-profile"));
        build.onResolve({ filter: /store\.ts$/ }, () => stub("store"));
        build.onLoad({ filter: /.*/, namespace: "agent-browser-runtime-v2-stub" }, (args) => {
          const head = `const state = () => globalThis[${JSON.stringify(stateKey)}];`;
          if (args.path === "runtime-paths") {
            return { loader: "js", contents: `${head} export const dashboardDataDir = () => state().dataRoot;` };
          }
          if (args.path === "model-provider") {
            return { loader: "js", contents: "export const isChatmockProvider = () => true;" };
          }
          if (args.path === "config") {
            return { loader: "js", contents: "export const chatmockGatewayBase = () => 'http://127.0.0.1:43120';" };
          }
          if (args.path === "browser-profile") {
            return {
              loader: "js",
              contents: `${head}
                export const activeProfileDir = () => state().profile;
                export const resolveBrowserExecutable = () => state().browser;
              `,
            };
          }
          if (args.path === "store") {
            return {
              loader: "js",
              contents: `${head}
                export function recordRuntimeRun(input) {
                  const row = {
                    job_id: input.jobId,
                    owner_user_id: input.ownerUserId,
                    agent_id: input.agentId,
                    request_id: input.requestId,
                    idempotency_key: input.idempotencyKey,
                    created_at: input.createdAt,
                    terminal_at: null,
                  };
                  state().mappings.set(input.jobId, row);
                  return row;
                }
                export function getRuntimeRun(userId, agentId, jobId) {
                  const row = state().mappings.get(jobId);
                  return row?.owner_user_id === userId && row?.agent_id === agentId ? row : null;
                }
                export function getRuntimeRunByRequest(userId, agentId, requestId) {
                  return [...state().mappings.values()].find((row) =>
                    row.owner_user_id === userId &&
                    row.agent_id === agentId &&
                    row.request_id === requestId
                  ) ?? null;
                }
                export function getRuntimeRunByOwner(userId, jobId) {
                  const row = state().mappings.get(jobId);
                  return row?.owner_user_id === userId ? row : null;
                }
                export function firstPotentiallyActiveRuntimeRun() {
                  return [...state().mappings.values()].find((row) => row.terminal_at === null) ?? null;
                }
                export function markRuntimeRunTerminal(jobId, terminalAt = new Date().toISOString()) {
                  const row = state().mappings.get(jobId);
                  if (row && row.terminal_at === null) row.terminal_at = terminalAt;
                }
              `,
            };
          }
          return {
            loader: "js",
            contents: `${head}
              export class RuntimeJobControlError extends Error {
                constructor(code) { super(code); this.code = code; }
              }
              export async function submitRuntimeJob(authority, submission) {
                state().submissions.push({
                  authority: structuredClone(authority),
                  submission: structuredClone(submission),
                });
                let jobId = state().idempotency.get(submission.idempotencyKey);
                if (!jobId) {
                  jobId = "job_" + String(state().idempotency.size + 1).padStart(64, "0");
                  state().idempotency.set(submission.idempotencyKey, jobId);
                  state().jobs.set(jobId, (${snapshot.toString()})(jobId, "queued", ${JSON.stringify(agentId)}));
                }
                return structuredClone(state().jobs.get(jobId));
              }
              export async function inspectRuntimeJob(authority, jobId) {
                state().inspections.push({ authority: structuredClone(authority), jobId });
                const job = state().jobs.get(jobId);
                if (!job) throw new RuntimeJobControlError("JOB_NOT_FOUND");
                return structuredClone(job);
              }
              export const inspectRuntimeJobForStatus = inspectRuntimeJob;
              export async function readRuntimeJobOutput() {
                throw new RuntimeJobControlError("JOB_OUTPUT_NOT_READY");
              }
              export async function cancelRuntimeJob(authority, jobId) {
                state().cancellations.push({ authority: structuredClone(authority), jobId });
                const job = state().jobs.get(jobId);
                if (!job) throw new RuntimeJobControlError("JOB_NOT_FOUND");
                const cancelled = { ...job, state: "cancelled", cancellationRequested: true, finishedAt: 1300 };
                state().jobs.set(jobId, cancelled);
                return structuredClone(cancelled);
              }
            `,
          };
        });
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#agent-browser-v2`);
}

const cutover = await loadCutoverModule();

function freshState() {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-browser-cutover-"));
  const entry = path.join(dataRoot, "agent-browser.js");
  const browser = path.join(dataRoot, "chrome.exe");
  fs.writeFileSync(entry, "entry", "utf8");
  fs.writeFileSync(browser, "browser", "utf8");
  const state = {
    dataRoot,
    entry,
    browser,
    profile: null,
    submissions: [],
    inspections: [],
    cancellations: [],
    idempotency: new Map(),
    jobs: new Map(),
    mappings: new Map(),
  };
  globalThis[stateKey] = state;
  return state;
}

function config() {
  return {
    provider: "chatmock",
    model: "test-model",
    maxSteps: 25,
    timeoutMs: 300_000,
    approvalMode: "sensitive_actions",
    allowedDomains: [],
    engine: "chrome",
  };
}

function projection(job, status, events, pendingApproval = null) {
  return {
    protocolVersion: 1,
    identity: {
      jobId: job.jobId,
      attempt: job.attempt,
      workerInstanceId: job.workerInstanceId,
    },
    scope: { userId: 7, agentId },
    status,
    pendingApproval,
    events,
  };
}

function writeArtifact(state, jobId, value) {
  const root = path.join(state.dataRoot, "agent-browser-artifacts", jobId);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "run.json"), `${JSON.stringify(value)}\n`, "utf8");
  return root;
}

test("Next submits exact scope-free Runtime authority with stable client idempotency", async () => {
  const state = freshState();
  const previousEntry = process.env.AGENT_BROWSER_JS;
  process.env.AGENT_BROWSER_JS = state.entry;
  try {
    const first = await cutover.startRun({
      userId: 7,
      agentId,
      task: "Open example.com",
      requestId,
      config: config(),
    });
    const retry = await cutover.startRun({
      userId: 7,
      agentId,
      task: "Open example.com",
      requestId,
      config: config(),
    });
    assert.equal(retry.runId, first.runId);
    assert.equal(state.submissions.length, 1);
    assert.deepEqual(state.submissions[0].authority, {
      userId: 7,
      gardenId: null,
      conversationId: agentId,
    });
    assert.equal(state.submissions[0].submission.jobType, "agent-browser-run");
    assert.equal(
      state.mappings.get(first.runId).idempotency_key,
      state.submissions[0].submission.idempotencyKey,
    );
    assert.equal(state.submissions[0].submission.requestPayload.task, "Open example.com");
    assert.equal(state.submissions[0].submission.requestPayload.modelBaseUrl, "http://127.0.0.1:43120");
    for (const field of ["userId", "gardenId", "conversationId", "jobId", "requestId"]) {
      assert.equal(Object.hasOwn(state.submissions[0].submission.requestPayload, field), false);
    }
  } finally {
    if (previousEntry === undefined) delete process.env.AGENT_BROWSER_JS;
    else process.env.AGENT_BROWSER_JS = previousEntry;
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("durable replay and screenshots survive native terminal-record compaction", async () => {
  const state = freshState();
  const previousEntry = process.env.AGENT_BROWSER_JS;
  process.env.AGENT_BROWSER_JS = state.entry;
  try {
    const started = await cutover.startRun({
      userId: 7,
      agentId,
      task: "Open example.com",
      requestId,
      config: config(),
    });
    const active = { ...state.jobs.get(started.runId), ...snapshot(started.runId, "succeeded") };
    state.jobs.set(started.runId, active);
    const event = {
      sequenceNumber: 1,
      type: "run.completed",
      payload: { summary: "Example opened." },
      at: new Date(1_200).toISOString(),
    };
    const root = writeArtifact(state, started.runId, projection(active, "completed", [event]));
    fs.mkdirSync(path.join(root, "screenshots"));
    fs.writeFileSync(path.join(root, "screenshots", "s1.png"), Buffer.from([137, 80, 78, 71]));
    state.jobs.delete(started.runId);

    const view = await cutover.readRunView(7, agentId, started.runId, 0);
    assert.equal(view.terminal, true);
    assert.deepEqual(view.events, [event]);
    assert.equal(await cutover.getScreenshot(7, agentId, started.runId, "1").then((bytes) => bytes?.length), 4);
    assert.deepEqual(await cutover.readRunView(7, otherAgentId, started.runId, 0), {
      events: [],
      terminal: true,
      status: null,
    });
    assert.equal(await cutover.getScreenshot(7, otherAgentId, started.runId, "1"), null);

    const compactedRetry = await cutover.startRun({
      userId: 7,
      agentId,
      task: "Open example.com",
      requestId,
      config: config(),
    });
    assert.deepEqual(compactedRetry, { runId: started.runId, status: "completed" });
    assert.equal(state.submissions.length, 1);

    const interruptedEvent = {
      sequenceNumber: 1,
      type: "run.started",
      payload: { task: "Open example.com", operator: "browser" },
      at: new Date(1_100).toISOString(),
    };
    writeArtifact(
      state,
      started.runId,
      projection(active, "running", [interruptedEvent]),
    );
    const interrupted = await cutover.readRunView(7, agentId, started.runId, 0);
    assert.equal(interrupted.terminal, true);
    assert.equal(interrupted.status, "failed");
    assert.equal(interrupted.events.at(-1).type, "run.failed");
    const replayedInterruption = await cutover.readRunView(7, agentId, started.runId, 1);
    assert.equal(replayedInterruption.events[0].at, interrupted.events.at(-1).at);
  } finally {
    if (previousEntry === undefined) delete process.env.AGENT_BROWSER_JS;
    else process.env.AGENT_BROWSER_JS = previousEntry;
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});

test("approval and cancellation require exact user, agent, job, attempt, and action fences", async () => {
  const state = freshState();
  const previousEntry = process.env.AGENT_BROWSER_JS;
  process.env.AGENT_BROWSER_JS = state.entry;
  try {
    const started = await cutover.startRun({
      userId: 7,
      agentId,
      task: "Click the button",
      requestId,
      config: config(),
    });
    const active = snapshot(started.runId, "running");
    state.jobs.set(started.runId, active);
    const actionId = `act_${"d".repeat(32)}`;
    const pending = {
      actionId,
      action: "click",
      target: "@e1",
      explanation: "agent-browser wants to run: agent-browser click @e1",
      risk: "medium",
      requestedAt: new Date(1_150).toISOString(),
    };
    const root = writeArtifact(state, started.runId, projection(active, "awaiting_approval", [{
      sequenceNumber: 1,
      type: "approval.requested",
      payload: pending,
      at: pending.requestedAt,
    }], pending));
    fs.mkdirSync(path.join(root, "approvals"));

    assert.equal(await cutover.decideApproval(7, otherAgentId, started.runId, actionId, "approve"), false);
    assert.equal(await cutover.decideApproval(8, agentId, started.runId, actionId, "approve"), false);
    assert.equal(await cutover.decideApproval(7, agentId, started.runId, `act_${"e".repeat(32)}`, "approve"), false);
    assert.equal(await cutover.decideApproval(7, agentId, started.runId, actionId, "approve"), true);
    const decision = JSON.parse(fs.readFileSync(path.join(root, "approvals", `${actionId}.json`), "utf8"));
    assert.deepEqual({
      jobId: decision.jobId,
      attempt: decision.attempt,
      workerInstanceId: decision.workerInstanceId,
      actionId: decision.actionId,
      decision: decision.decision,
    }, {
      jobId: started.runId,
      attempt: 1,
      workerInstanceId: "worker_browser_test",
      actionId,
      decision: "approve",
    });
    assert.equal(await cutover.decideApproval(7, agentId, started.runId, actionId, "approve"), false);
    assert.equal(await cutover.abortRun(7, otherAgentId, started.runId), false);
    assert.equal(await cutover.abortRun(7, agentId, started.runId), true);
    assert.equal(state.cancellations.length, 1);
    assert.deepEqual(state.cancellations[0].authority, {
      userId: 7,
      gardenId: null,
      conversationId: agentId,
    });
  } finally {
    if (previousEntry === undefined) delete process.env.AGENT_BROWSER_JS;
    else process.env.AGENT_BROWSER_JS = previousEntry;
    fs.rmSync(state.dataRoot, { recursive: true, force: true });
  }
});
