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
  validateRuntimeV2MaxResearchRequest,
} from "../scripts/runtime-v2-outer-agent-adapters.mjs";
import { completeText } from "../src/lib/max-research/completion.ts";
import {
  abortRuntimeWorkerRun,
  getEventsSince as getWorkerEvents,
  isRuntimeWorkerTerminal,
  resetMaxResearchRuns,
  startRun as startLocalWorkerRun,
} from "../src/lib/max-research/run-manager.ts";
import { terminalResultFromEvents } from "../src/lib/max-research/runtime-run-manager.ts";

const dashboardRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = (relativePath) =>
  fs.readFileSync(path.join(dashboardRoot, relativePath), "utf8").replace(/\r\n/g, "\n");

function request(overrides = {}) {
  return {
    question: "What evidence explains the observed change?",
    model: "test-model",
    reasoningEffort: "high",
    baseUrl: "http://127.0.0.1:8765/v1",
    conversationContext: "Earlier context that must survive the boundary.",
    openscienceEnabled: false,
    praxistTaskPath: null,
    ...overrides,
  };
}

test("Max Research has one exact sealed zero-blob worker contract", () => {
  const canonical = validateRuntimeV2MaxResearchRequest(request());
  assert.equal(expectedRuntimeV2OuterAgentInputCount("max-research", canonical), 0);
  assert.deepEqual(RUNTIME_V2_OUTER_AGENT_WORKER_ADAPTERS["max-research"], {
    id: "max-research",
    workerKind: "outer-max-research-node",
    jobType: "max-research-run",
    scopePrefix: "oa_max_research_",
    maximumInputs: 0,
  });
  for (const invalid of [
    request({ argv: ["python", "anything.py"] }),
    request({ env: { CHATMOCK_API_KEY: "renderer-secret" } }),
    request({ apiKey: "renderer-secret" }),
    request({ question: "x".repeat(8_001) }),
    request({ baseUrl: "http://user:password@127.0.0.1:8765/v1" }),
  ]) {
    assert.throws(() => validateRuntimeV2MaxResearchRequest(invalid));
  }
});

async function runFakeAdapter({ abort = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-max-research-adapter-"));
  const sourceRoot = path.join(root, "src");
  const managerPath = path.join(sourceRoot, "lib", "max-research", "run-manager.ts");
  fs.mkdirSync(path.dirname(managerPath), { recursive: true });
  fs.writeFileSync(managerPath, `
const runs = new Map();
export function startRuntimeWorkerRun(input) {
  const run = { terminal: false, timer: null, events: [{
    sequenceNumber: 1,
    type: "run.started",
    payload: {
      question: input.question,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      baseUrl: input.baseUrl,
      conversationContext: input.conversationContext,
      openscienceEnabled: input.openscienceEnabled,
      praxistTaskPath: input.praxistTaskPath,
      runId: input.runtimeJobId,
      userId: input.userId,
    },
    at: new Date().toISOString(),
  }] };
  runs.set(input.runtimeJobId, run);
  run.timer = setTimeout(() => {
    if (run.terminal) return;
    run.terminal = true;
    run.events.push({
      sequenceNumber: 2,
      type: "run.completed",
      payload: { result: "A reconciled answer." },
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
export function abortRuntimeWorkerRun(_userId, runId) {
  const run = runs.get(runId);
  if (run.terminal) return false;
  clearTimeout(run.timer);
  run.terminal = true;
  run.events.push({
    sequenceNumber: 2,
    type: "run.aborted",
    payload: {},
    at: new Date().toISOString(),
  });
  return true;
}
`);
  const controller = new AbortController();
  const updates = [];
  try {
    const promise = executeRuntimeV2OuterAgentAdapter({
      adapterId: "max-research",
      launch: {
        identity: {
          jobId: "job_max_research_1",
          attempt: 1,
          workerInstanceId: "worker_max_research_1",
        },
        executionScope: {
          userId: 7,
          gardenId: null,
          conversationId: `oa_max_research_${"a".repeat(32)}`,
        },
        request: request(),
        inputBlobs: [],
        inputPaths: [],
        workspacePath: path.join(root, "workspace"),
      },
      sourceRoot,
      signal: controller.signal,
      update: (events, status) => updates.push({ events, status }),
    });
    if (abort) setTimeout(() => controller.abort(), 10);
    return { outcome: await promise, events: updates.flatMap((update) => update.events) };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("the adapter preserves request context through real completion and cancellation", async () => {
  const completed = await runFakeAdapter();
  assert.equal(completed.outcome.status, "completed");
  const started = completed.events.find((event) => event.type === "run.started");
  assert.deepEqual(started?.payload, {
    ...request(),
    runId: "job_max_research_1",
    userId: 7,
  });
  assert.equal(
    completed.events.find((event) => event.type === "run.completed")?.payload.result,
    "A reconciled answer.",
  );

  const aborted = await runFakeAdapter({ abort: true });
  assert.equal(aborted.outcome.status, "aborted");
  assert.ok(aborted.events.some((event) => event.type === "run.aborted"));
  assert.ok(!aborted.events.some((event) => event.type === "run.completed"));
});

test("terminal projection preserves the runtime clock and every terminal outcome", () => {
  const completedAt = "2026-08-30T08:14:00.173Z";
  assert.deepEqual(
    terminalResultFromEvents([
      {
        sequenceNumber: 1,
        type: "run.completed",
        payload: { result: "The evidence-backed report." },
        at: completedAt,
      },
    ]),
    {
      outcome: "completed",
      content: "The evidence-backed report.",
      terminalAtMs: Date.parse(completedAt),
    },
  );
  assert.deepEqual(
    terminalResultFromEvents([
      {
        sequenceNumber: 1,
        type: "run.failed",
        payload: { error: "Sources could not be fetched." },
        at: completedAt,
      },
    ]),
    {
      outcome: "failed",
      content: "Sources could not be fetched.",
      terminalAtMs: Date.parse(completedAt),
    },
  );
  assert.equal(
    terminalResultFromEvents([
      {
        sequenceNumber: 1,
        type: "run.aborted",
        payload: {},
        at: completedAt,
      },
    ]).outcome,
    "aborted",
  );
});

test("worker cancellation waits until active nested participants acknowledge stop", async () => {
  resetMaxResearchRuns();
  let nestedStops = 0;
  const { runId } = startLocalWorkerRun({
    userId: 9,
    question: "Cancel this coordinated run",
    model: "test-model",
    reasoningEffort: "medium",
    baseUrl: "http://127.0.0.1:8765/v1",
    runtimeFor: (participant) => ({
      available: async () => ({ available: true }),
      run: async (_brief, context) =>
        new Promise((resolve) => {
          context.signal?.addEventListener(
            "abort",
            () => {
              nestedStops += 1;
              setTimeout(
                () => resolve({ participant, status: "aborted", output: "" }),
                20,
              );
            },
            { once: true },
          );
        }),
    }),
    synthesize: async () => "must not run",
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (getWorkerEvents(9, runId, 0).some((event) => event.type === "participant.started")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(abortRuntimeWorkerRun(9, runId), true);
  assert.equal(
    isRuntimeWorkerTerminal(9, runId),
    false,
    "the coordinator must stay alive while nested cancellation is in flight",
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (isRuntimeWorkerTerminal(9, runId)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(nestedStops > 0);
  assert.equal(isRuntimeWorkerTerminal(9, runId), true);
  assert.equal(
    getWorkerEvents(9, runId, 0).findLast((event) =>
      ["run.completed", "run.failed", "run.aborted"].includes(event.type))?.type,
    "run.aborted",
  );
});

test("model reconciliation cancellation is immediate and oversized JSON is fenced", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      const signal = init?.signal;
      return new Promise((_resolve, reject) => {
        const fail = () => reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal?.aborted) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      });
    };
    const controller = new AbortController();
    const pending = completeText({
      ...request(),
      prompt: "reconcile",
      signal: controller.signal,
      fetchImpl: globalThis.fetch,
    });
    controller.abort(new DOMException("stopped", "AbortError"));
    await assert.rejects(pending, /stopped|abort/iu);
    assert.equal(calls, 1, "an aborted synthesis must not retry");

    calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response("{}", {
        status: 200,
        headers: { "content-length": String(1024 * 1024 + 1) },
      });
    };
    await assert.rejects(
      completeText({
        ...request(),
        prompt: "reconcile",
        fetchImpl: globalThis.fetch,
      }),
      /exceeded its bound/,
    );
    assert.equal(calls, 1, "a protocol-size violation must not be retried");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Next routes are durable facades with no local execution fallback", () => {
  const facade = source("src/lib/max-research/runtime-run-manager.ts");
  const worker = source("src/lib/max-research/run-manager.ts");
  const startRoute = source("src/app/api/max-research/runs/route.ts");
  const eventsRoute = source("src/app/api/max-research/runs/[runId]/events/route.ts");
  const abortRoute = source("src/app/api/max-research/runs/[runId]/abort/route.ts");
  const cancellation = source("src/lib/conversations/external-agent-cancel.ts");
  const persistence = source("src/lib/max-research/conversation-persistence.ts");
  const sessionRoute = source("src/app/api/hermes/sessions/[sessionId]/route.ts");
  const runtimePanel = source("src/app/components/hermes/agent-runtime-panel.tsx");

  assert.match(facade, /startOuterAgentRun\(/);
  assert.match(facade, /kind: "max-research"/);
  assert.doesNotMatch(facade, /node:child_process|\bspawn(?:Sync)?\s*\(|execFile/);
  assert.match(worker, /startRuntimeWorkerRun/);
  assert.match(worker, /getRuntimeWorkerEventsSince/);
  assert.match(startRoute, /runtime-run-manager\.ts/);
  assert.match(startRoute, /await startRun\(/);
  assert.match(startRoute, /observeMaxResearchConversationTurn\(/);
  assert.doesNotMatch(startRoute, /max-research\/run-manager\.ts/);
  assert.match(eventsRoute, /outerAgentEventsResponse/);
  assert.doesNotMatch(eventsRoute, /setInterval\(/);
  assert.match(abortRoute, /await abortRun\(/);
  assert.match(abortRoute, /reconcileMaxResearchRun\(/);
  assert.match(persistence, /setRunTerminalHandler\(/);
  assert.match(persistence, /terminalAtMs: result\.terminalAtMs/);
  assert.match(sessionRoute, /await reconcileMaxResearchConversation\(/);
  assert.match(runtimePanel, /const direct = \(payload as \{/);
  assert.match(runtimePanel, /externalAgentAbortTerminalResult\(payload\)/);
  assert.doesNotMatch(
    runtimePanel,
    /url\.startsWith\("\/api\/deep-research\/"\) && clientMessageId/,
  );
  assert.match(cancellation, /max-research\/runtime-run-manager\.ts/);
  assert.match(
    source("scripts/runtime-v2-max-research-worker.mjs"),
    /runRuntimeV2OuterAgentWorker\("max-research"\)/,
  );
});
