import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  abortRuntimeWorkerRun,
  getRuntimeWorkerEventsSince,
  isRuntimeWorkerTerminal,
  resetOpenworkRuns,
  startRuntimeWorkerRun,
} from "../src/lib/openwork/run-manager.ts";
import {
  openworkRunProfilePath,
  prepareOpenworkRunProfile,
} from "../src/lib/openwork/runtime-service.ts";
import {
  resolveOpenworkRuntimeArtifact,
  startRun as startDurableRun,
} from "../src/lib/openwork/runtime-run-manager.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8").replace(/\r\n/g, "\n");

function request(overrides = {}) {
  return {
    task: "Draft the quarterly update and save the report.",
    model: "test-model",
    reasoningEffort: "high",
    prompt: { deliverFiles: true, allowCommands: false },
    conversationContext: "User: Use the numbers from the previous message.",
    serviceScopeId: "message_openwork_1",
    ...overrides,
  };
}

test("OpenWork seals one immutable private profile before idempotent submission", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openwork-profile-"));
  const env = { ...process.env, BREADBOARD_DATA_DIR: path.toNamespacedPath(root) };
  delete env.BREADBOARD_AGENT_SERVICE_STATE_ROOT;
  const scope = { userId: 42, runId: "message_openwork_1" };
  const options = {
    baseUrl: "http://127.0.0.1:4010/v1",
    apiKey: "provider-secret",
    model: "test-model",
    prompt: { deliverFiles: true, allowCommands: false },
  };
  try {
    prepareOpenworkRunProfile(scope, options, env);
    const target = openworkRunProfilePath(scope, env);
    const metadata = fs.lstatSync(target);
    assert.equal(metadata.isFile(), true);
    assert.equal(metadata.isSymbolicLink(), false);
    const profile = JSON.parse(fs.readFileSync(target, "utf8"));
    assert.deepEqual(profile, {
      schemaVersion: 1,
      serviceId: "openwork",
      scope,
      options,
    });
    const firstModified = metadata.mtimeMs;
    prepareOpenworkRunProfile(scope, options, env);
    assert.equal(fs.statSync(target).mtimeMs, firstModified, "a retry must not rewrite the profile");
    assert.throws(
      () => prepareOpenworkRunProfile(scope, { ...options, model: "other-model" }, env),
      /different settings/u,
    );
    assert.throws(
      () => openworkRunProfilePath({ userId: 42, runId: "../escape" }, env),
      /scope is invalid/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const order = [];
  let prepared = null;
  let submission = null;
  const result = await startDurableRun(
    {
      userId: 42,
      requestId: "message_openwork_1",
      ...request(),
      baseUrl: "http://127.0.0.1:4010/v1",
      apiKey: "provider-secret",
    },
    {
      prepare: (profileScope, profileOptions) => {
        order.push("profile");
        prepared = { profileScope, profileOptions };
      },
      submit: async (input) => {
        order.push("submission");
        submission = input;
        return { runId: "job_openwork_1", status: "queued" };
      },
    },
  );
  assert.deepEqual(order, ["profile", "submission"]);
  assert.deepEqual(result, { runId: "job_openwork_1", status: "queued" });
  assert.equal(prepared.profileOptions.apiKey, "provider-secret");
  assert.deepEqual(submission.requestPayload, request());
  assert.equal(submission.requestId, "message_openwork_1");
  assert.doesNotMatch(
    JSON.stringify(submission),
    /provider-secret|127\.0\.0\.1:4010|apiKey|baseUrl|token|argv|executable|env/iu,
  );
});

test("the exact sealed zero-input OpenWork adapter preserves Runtime identity", async () => {
  const adapters = await import("../scripts/runtime-v2-outer-agent-adapters.mjs");
  const canonical = adapters.validateRuntimeV2OpenworkRequest(request());
  assert.equal(adapters.expectedRuntimeV2OuterAgentInputCount("openwork", canonical), 0);
  assert.deepEqual(adapters.RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS.openwork, {
    id: "openwork",
    workerKind: "outer-openwork-node",
    jobType: "openwork-run",
    scopePrefix: "oa_openwork_",
    maximumInputs: 0,
    maximumProjectionBytes: 4 * 1024 * 1024,
  });
  for (const invalid of [
    request({ apiKey: "renderer-secret" }),
    request({ env: { CHATMOCK_API_KEY: "renderer-secret" } }),
    request({ argv: ["node", "anything.js"] }),
    request({ prompt: { deliverFiles: true, allowCommands: false, extra: true } }),
    request({ serviceScopeId: "../escape" }),
    request({ conversationContext: "x".repeat(15_001) }),
  ]) {
    assert.throws(() => adapters.validateRuntimeV2OpenworkRequest(invalid));
  }
});

test("extended Windows paths do not allow an indirect OpenWork profile directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openwork-indirect-"));
  try {
    const external = path.join(root, "external");
    const state = path.join(root, "state");
    fs.mkdirSync(external);
    fs.mkdirSync(state);
    fs.symlinkSync(external, path.join(state, "openwork"), process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => prepareOpenworkRunProfile({ userId: 1, runId: "design" }, {
      baseUrl: "http://127.0.0.1:4010/v1", apiKey: "local-test", model: "test-model",
      prompt: { deliverFiles: true, allowCommands: false },
    }, { ...process.env, BREADBOARD_AGENT_SERVICE_STATE_ROOT: path.toNamespacedPath(state) }), /directory is indirect/);
    assert.deepEqual(fs.readdirSync(external), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function runFakeAdapter({ abort = false } = {}) {
  const adapters = await import("../scripts/runtime-v2-outer-agent-adapters.mjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-openwork-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "openwork", "run-manager.ts");
  const workspacePath = path.join(root, "workspace");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const run = { terminal: false, timer: null, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: { ...input },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  run.timer = setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { content: "OpenWork completed." },
      at: new Date().toISOString(),
    });
  }, 30);
  return { runId: input.runtimeJobId, status: "queued" };
}
export function getRuntimeWorkerEventsSince(_userId, runId, since) {
  return runs.get(runId).events.filter((event) => event.sequenceNumber > since);
}
export function isRuntimeWorkerTerminal(_userId, runId) {
  return runs.get(runId).terminal;
}
export async function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  clearTimeout(run.timer);
  await new Promise((resolve) => setTimeout(resolve, 20));
  run.terminal = true;
  run.events.push({
    sequenceNumber: 2,
    type: "run.aborted",
    payload: { content: "The run was stopped." },
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const controller = new AbortController();
  const updates = [];
  try {
    const promise = adapters.executeRuntimeV2OuterAgentAdapter({
      adapterId: "openwork",
      launch: {
        identity: { jobId: "job_openwork_adapter", attempt: 1, workerInstanceId: "worker_1" },
        executionScope: {
          userId: 42,
          gardenId: null,
          conversationId: `oa_openwork_${"a".repeat(32)}`,
        },
        request: request(),
        inputBlobs: [],
        inputPaths: [],
        workspacePath,
      },
      sourceRoot,
      signal: controller.signal,
      update: (events, status) => updates.push({ events, status }),
    });
    if (abort) setTimeout(() => controller.abort(), 10);
    return { outcome: await promise, events: updates.flatMap((entry) => entry.events), workspacePath };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the adapter reaches real completion and awaits manager cancellation", async () => {
  const completed = await runFakeAdapter();
  assert.equal(completed.outcome.status, "completed");
  assert.deepEqual(completed.events[0]?.payload, {
    userId: 42,
    runtimeJobId: "job_openwork_adapter",
    runtimeWorkspacePath: completed.workspacePath,
    serviceScopeId: "message_openwork_1",
    task: request().task,
    model: "test-model",
    reasoningEffort: "high",
    conversationContext: request().conversationContext,
  });
  const cancelled = await runFakeAdapter({ abort: true });
  assert.equal(cancelled.outcome.status, "aborted");
  assert.equal(cancelled.events.findLast((event) => event.type.startsWith("run."))?.type, "run.aborted");
  assert.ok(!cancelled.events.some((event) => event.type === "run.completed"));
});

async function runRealOpenwork(mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `breadboard-openwork-${mode}-`));
  const runtimeWorkspacePath = path.toNamespacedPath(path.join(root, "runtime-workspace"));
  const serviceWorkspacePath = path.join(root, "service-workspace");
  fs.mkdirSync(runtimeWorkspacePath, { recursive: true });
  fs.mkdirSync(serviceWorkspacePath, { recursive: true });
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.BREADBOARD_OPENWORK_SERVICE_URL;
  const previousToken = process.env.BREADBOARD_OPENWORK_SERVICE_TOKEN;
  process.env.BREADBOARD_OPENWORK_SERVICE_URL = "http://127.0.0.1:4100";
  process.env.BREADBOARD_OPENWORK_SERVICE_TOKEN = "g".repeat(48);
  let artifactListings = 0;
  let cancelAcknowledged = false;
  let hangingStream = null;
  const calls = [];
  try {
    globalThis.fetch = async (value, init = {}) => {
      const url = new URL(String(value));
      const method = init.method ?? "GET";
      calls.push({ url, method, body: init.body });
      if (url.port === "4100" && url.pathname === "/v1/ensure") {
        assert.deepEqual(JSON.parse(String(init.body)), {
          scope: { userId: 42, runId: "message_openwork_1" },
        });
        return Response.json({
          ok: true,
          result: {
            engineUrl: "http://127.0.0.1:4101",
            serverUrl: "http://127.0.0.1:4102",
            token: "s".repeat(48),
            workspaceId: "workspace_test",
            workspacePath: serviceWorkspacePath,
            startedAt: Date.now(),
            models: ["test-model"],
          },
        });
      }
      if (url.port === "4102" && url.pathname.endsWith("/artifacts") && method === "GET") {
        artifactListings += 1;
        return Response.json({
          items: artifactListings === 1 || mode === "cancel"
            ? []
            : [{
                id: "artifact_report",
                path: "reports/quarterly-update.md",
                size: 24,
                updatedAt: 1_700_000_000_000,
              }],
        });
      }
      if (url.port === "4102" && url.pathname.endsWith("/sessions") && method === "POST") {
        const body = JSON.parse(String(init.body));
        assert.equal(body.modelId, "test-model");
        assert.equal(body.variant, "high");
        assert.match(body.prompt, /Conversation so far/u);
        assert.match(body.prompt, /Draft the quarterly update/u);
        return Response.json({ item: { id: `session_${mode}`, title: "Draft the quarterly update" }, started: true });
      }
      if (url.port === "4101" && url.pathname === "/event") {
        if (mode === "complete") {
          const frames = [
            { type: "message.updated", properties: { sessionID: "session_complete", info: { id: "assistant_1", role: "assistant" } } },
            { type: "message.part.updated", properties: { sessionID: "session_complete", part: { id: "part_1", messageID: "assistant_1", type: "text", text: "The report is ready." } } },
            { type: "session.idle", properties: { sessionID: "session_complete" } },
          ].map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("");
          return new Response(frames, { headers: { "content-type": "text/event-stream" } });
        }
        return new Response(new ReadableStream({
          start(controller) {
            hangingStream = controller;
            controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
          },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      if (url.port === "4102" && url.pathname.endsWith("/messages") && method === "GET") {
        return Response.json({
          items: [{
            info: {
              id: "assistant_1",
              role: "assistant",
              tokens: { input: 11, output: 7, reasoning: 3 },
            },
            parts: [{ type: "text", text: "The report is ready." }],
          }],
        });
      }
      if (url.port === "4102" && url.pathname.endsWith("/artifacts/artifact_report")) {
        return new Response("# Quarterly update\nDone.\n", {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
            "content-length": "25",
          },
        });
      }
      if (url.port === "4102" && url.pathname.endsWith("/abort") && method === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 25));
        cancelAcknowledged = true;
        hangingStream?.close();
        return Response.json({ ok: true });
      }
      throw new Error(`Unexpected OpenWork request: ${method} ${url}`);
    };

    resetOpenworkRuns();
    const run = startRuntimeWorkerRun({
      userId: 42,
      runtimeJobId: `job_openwork_${mode}`,
      runtimeWorkspacePath,
      ...request(),
    });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (mode === "cancel") {
        if (getRuntimeWorkerEventsSince(42, run.runId, 0).some((event) => event.type === "session.created")) break;
      } else if (isRuntimeWorkerTerminal(42, run.runId)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    if (mode === "cancel") {
      const stopping = abortRuntimeWorkerRun(42, run.runId);
      assert.equal(isRuntimeWorkerTerminal(42, run.runId), false);
      assert.equal(cancelAcknowledged, false);
      assert.equal(await stopping, true);
      assert.equal(cancelAcknowledged, true);
    }
    const events = getRuntimeWorkerEventsSince(42, run.runId, 0);
    return { root, runtimeWorkspacePath, run, events, calls, cancelAcknowledged };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  } finally {
    resetOpenworkRuns();
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.BREADBOARD_OPENWORK_SERVICE_URL;
    else process.env.BREADBOARD_OPENWORK_SERVICE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.BREADBOARD_OPENWORK_SERVICE_TOKEN;
    else process.env.BREADBOARD_OPENWORK_SERVICE_TOKEN = previousToken;
  }
}

test("the real worker completes, streams context, and durably copies bounded artifacts", async () => {
  const result = await runRealOpenwork("complete");
  try {
    assert.equal(result.run.runId, "job_openwork_complete");
    assert.equal(result.events.findLast((event) => event.type.startsWith("run."))?.type, "run.completed");
    assert.equal(result.events.find((event) => event.type === "assistant.delta")?.payload.text, "The report is ready.");
    const artifact = result.events.find((event) => event.type === "artifact.ready")?.payload;
    assert.deepEqual(artifact, {
      id: "artifact_report",
      path: "reports/quarterly-update.md",
      size: 25,
      updatedAt: 1_700_000_000_000,
      contentType: "text/markdown; charset=utf-8",
      relativePath: "openwork-artifacts/artifact-0000.bin",
    });
    const stored = path.join(result.runtimeWorkspacePath, ...artifact.relativePath.split("/"));
    assert.equal(fs.readFileSync(stored, "utf8"), "# Quarterly update\nDone.\n");
    assert.equal(
      resolveOpenworkRuntimeArtifact({ workspaceRoot: result.runtimeWorkspacePath, record: artifact }),
      stored,
    );
    assert.equal(
      resolveOpenworkRuntimeArtifact({
        workspaceRoot: result.runtimeWorkspacePath,
        record: { ...artifact, relativePath: "../outside.bin" },
      }),
      null,
    );
  } finally {
    fs.rmSync(result.root, { recursive: true, force: true });
  }
});

test("the real worker awaits the upstream abort before publishing cancellation", async () => {
  const result = await runRealOpenwork("cancel");
  try {
    assert.equal(result.cancelAcknowledged, true);
    assert.equal(result.events.findLast((event) => event.type.startsWith("run."))?.type, "run.aborted");
    assert.ok(!result.events.some((event) => event.type === "run.completed"));
  } finally {
    fs.rmSync(result.root, { recursive: true, force: true });
  }
});

test("OpenWork routes are durable facades with no live map, lease, spawn, or secret fallback", () => {
  const facade = source("src/lib/openwork/runtime-run-manager.ts");
  const worker = source("src/lib/openwork/run-manager.ts");
  const workerService = source("src/lib/openwork/runtime-worker-service.ts");
  const startRoute = source("src/app/api/openwork/runs/route.ts");
  const eventsRoute = source("src/app/api/openwork/runs/[runId]/events/route.ts");
  const abortRoute = source("src/app/api/openwork/runs/[runId]/abort/route.ts");
  const artifactRoute = source("src/app/api/openwork/runs/[runId]/artifacts/[artifactId]/route.ts");
  const cancel = source("src/lib/conversations/external-agent-cancel.ts");
  const serviceWrapper = source("scripts/runtime-v2-agent-service.mjs");

  assert.match(startRoute, /openwork\/runtime-run-manager\.ts/u);
  assert.doesNotMatch(startRoute, /openwork\/run-manager\.ts/u);
  assert.match(eventsRoute, /outerAgentEventsResponse/u);
  assert.doesNotMatch(eventsRoute, /setInterval\(/u);
  assert.match(abortRoute, /openwork\/runtime-run-manager\.ts/u);
  assert.match(cancel, /openwork\/runtime-run-manager\.ts/u);
  assert.match(artifactRoute, /new Response\(artifact\.stream/u);
  assert.match(artifactRoute, /content-disposition[\s\S]*attachment/u);
  assert.match(facade, /prepare\([\s\S]*submit\(/u);
  assert.match(facade, /fs\.realpathSync\.native/u);
  assert.match(facade, /O_NOFOLLOW/u);
  assert.match(facade, /metadata\.ino !== linkMetadata\.ino/u);
  assert.doesNotMatch(facade, /requestPayload:[\s\S]{0,800}(?:apiKey|baseUrl|token|secret)/u);
  assert.doesNotMatch(worker, /runtime-service|withOpenworkServiceLease|ensureOpenworkService|node:child_process|\bspawn(?:Sync)?\s*\(/u);
  assert.match(workerService, /body: JSON\.stringify\(\{ scope \}\)/u);
  assert.doesNotMatch(workerService, /CHATMOCK|apiKey|options|supervisor-control/u);
  assert.match(serviceWrapper, /function readOpenworkProfile/u);
  assert.match(serviceWrapper, /agent === "openwork"[\s\S]*readOpenworkProfile/u);
  assert.match(source("scripts/runtime-v2-openwork-worker.mjs"), /runRuntimeV2OuterAgentWorker\("openwork"\)/u);
});
