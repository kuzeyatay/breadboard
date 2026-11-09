import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { agentLaunchContinuationMessage } from "../src/lib/hermes/agent-launch.ts";
import * as combinations from "../src/lib/hermes/capability-combinations.ts";
import { ApiError, describeError, readJsonBody } from "../src/lib/hermes/route-core.ts";
import { SwarmError } from "../src/lib/swarm/types.ts";
import { unifiedWorkflowSelectionAllows, unifiedWorkflowRepeatsCompletedWork } from "../src/lib/workflows/unified-command.ts";

// Run the actual POST handler with storage/auth/worker I/O replaced. The launch
// policy, command parsing, capability conflicts, and response handling are real.
const routePath = new URL("../src/app/api/hermes/tools/agent-launch/route.ts", import.meta.url);
const tree = ts.createSourceFile("route.ts", fs.readFileSync(routePath, "utf8"), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(tree.statements
  .filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getText(tree)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function launch({ instruction, agentId = "max-research", delegatedAgents = [], queuedAgents = [], surface = "garden_chat", deliveryChannel, extraArgs = {}, brief = "Build a strength program and calorie plan." }) {
  const calls = { reserved: 0, started: [], queued: [], persisted: [] };
  const session = { id: 1, user_id: 7, conversation_id: 9, surface };
  const conversation = { id: 9, user_id: 7 };
  const dispatch = { clientMessageId: "original-turn", model: { modelID: "test-model" }, delegatedAgents };
  const scope = {
    ...combinations, ApiError, SwarmError, readJsonBody, unifiedWorkflowSelectionAllows, unifiedWorkflowRepeatsCompletedWork,
    MAX_PARALLEL_AGENT_LAUNCHES: 4,
    NextResponse: Response,
    requireEnabled: () => {},
    capabilityForInternalToolRequest: () => "test-token",
    verifyCapabilityToken: () => ({ ok: true, token: { breadboardSessionId: "1", hermesSessionId: "session-test", conversationId: 9, userId: 7, surface } }),
    tokenAllows: () => true,
    getRuntimeSessionById: () => session,
    runtimeExternalSessionId: () => "session-test",
    getActiveRuntimeRun: () => ({ id: "parent-run", instruction, dispatch_json: JSON.stringify(dispatch) }),
    getActiveCapabilityDecision: () => ({ allowedTools: ["agent_launch"] }),
    parseRuntimeRunDispatch: (run) => JSON.parse(run.dispatch_json),
    listAgentLaunchRequestsAfter: () => queuedAgents,
    reserveAgentLaunchRequestSlot: () => { calls.reserved++; return true; },
    releaseAgentLaunchRequestSlot: () => {},
    randomUUID: () => "worker-id",
    getConversationById: () => conversation,
    getConversationMessageByClientId: () => ({ metadata: { deliveryChannel } }),
    presentConversationMessage: (message) => message,
    resolveChatmockBaseUrl: () => ({ baseURL: "http://test.invalid" }),
    startMaxResearchRun: async (input) => { calls.started.push(input); return { runId: "max-run" }; },
    recordExternalAgentTurn: (input) => calls.persisted.push(input),
    observeMaxResearchConversationTurn: () => {},
    abortMaxResearchRun: async () => {},
    recordAgentLaunchRequest: (input) => { calls.queued.push(input); return { requestId: "launch-id" }; },
    recordAuditEvent: () => {},
    apiErrorResponse: (error) => {
      if (!(error instanceof ApiError)) throw error;
      const { status, body } = describeError(error);
      return Response.json(body, { status });
    },
  };
  const handler = new Function("exports", ...Object.keys(scope), `${code}\nreturn exports.POST;`)({}, ...Object.values(scope));
  // The brief deliberately omits the request's Max Research wording.
  const response = await handler(new Request("http://localhost/api/hermes/tools/agent-launch", {
    method: "POST",
    body: JSON.stringify({ args: { agent: agentId, brief, reason: "Evidence for the program.", ...extraArgs } }),
    headers: { "content-type": "application/json" },
  }));
  return { status: response.status, body: await response.json(), calls };
}

test("both chat surfaces launch explicit Max Research for the complete fitness request", async () => {
  for (const surface of ["garden_chat", "dashboard_terminal"]) {
    for (const instruction of [
      "do max research on muscle hypertrophy, then give me a gym program and a diet. I can only do two pushups?",
      "could you run max-research on strength training and show me how to squat?",
      "build a strength program from the evidence, do max research",
      "/agents:max-research build a strength program from the evidence",
    ]) {
      const result = await launch({ instruction, surface });
      assert.equal(result.status, 200, instruction);
      assert.equal(result.body.data.agentId, "max-research");
      assert.equal(result.calls.started.length, 1);
    }
  }
});

test("Max Research still starts and attaches durably for the fitness request", async () => {
  const result = await launch({ instruction: "do max research on hypertrophy and a workout program", agentId: "max-research" });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.agentId, "max-research");
  assert.equal(result.calls.started.length, 1);
  assert.equal(result.calls.persisted[0].run.kind, "max_research");
  assert.equal(result.calls.queued[0].startedRun.runId, "max-run");
});

test("Telegram cannot queue the Eindhoven lookup to a desktop-only globe worker", async () => {
  const result = await launch({
    instruction: "flight coming to eindhoven", surface: "dashboard_terminal",
    agentId: "gods-eye", deliveryChannel: "telegram",
    brief: "Show live aircraft activity over Eindhoven and report arriving flights.",
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "agent_launch_delivery_unavailable");
  assert.match(result.body.error, /continue.*available tools/i);
  assert.equal(result.calls.reserved, 0);
  assert.deepEqual(result.calls.queued, []);
  assert.deepEqual(result.calls.started, []);
});

test("messaging rejects other surface-owned launches using persisted channel provenance", async () => {
  for (const deliveryChannel of ["telegram", "whatsapp"]) {
    for (const agentId of ["deep-research", "inbox-zero", "codex"]) {
      const result = await launch({
        instruction: "Help with this task", surface: "dashboard_terminal", agentId, deliveryChannel,
        extraArgs: { deliveryChannel: "", surfaceContext: { deliveryChannel: "" } },
      });
      assert.equal(result.status, 409, `${deliveryChannel}: ${agentId}`);
      assert.equal(result.body.code, "agent_launch_delivery_unavailable");
      assert.deepEqual(result.calls.queued, []);
    }
  }
});

test("server-owned research still starts with Telegram provenance for its follow-up", async () => {
  const result = await launch({ instruction: "Research this", deliveryChannel: "telegram" });
  assert.equal(result.status, 200);
  assert.equal(result.calls.started.length, 1);
  assert.equal(result.calls.persisted[0].deliveryChannel, "telegram");
  assert.equal(result.calls.persisted[0].delegatedAgentRun, true);
});

test("desktop chats can still queue their globe worker", async () => {
  const result = await launch({ instruction: "Show Eindhoven", agentId: "gods-eye", surface: "dashboard_terminal" });
  assert.equal(result.status, 200);
  assert.equal(result.calls.queued[0].agentId, "gods-eye");
});

test("completed Max Research hand-backs preserve recommendations without claiming failed work was reviewed", () => {
  const completed = agentLaunchContinuationMessage({ agentName: "Max Research", outcome: "completed", content: "Findings about training [S1]." });
  assert.match(completed, /Max Research owns this request/);
  assert.match(completed, /Deliver the supplied findings, recommendations, citations, and evidence gaps now/);
  assert.match(completed, /Do not start another research or citation-audit pass/);
  for (const outcome of ["failed", "cancelled"]) {
    const message = agentLaunchContinuationMessage({ agentName: "Max Research", outcome, content: "Findings about training." });
    assert.doesNotMatch(message, /completed report has already been synthesized and reviewed/);
    assert.match(message, /Do not invent findings or silently substitute a new research run/);
    assert.match(message, /Do not relaunch it without being asked/);
  }
  const retained = agentLaunchContinuationMessage({ agentName: "Max Research", outcome: "failed", content: '[MAX_RESEARCH_RETAINED_FINDINGS_V1]\n<retained-finding>Training evidence [S1].</retained-finding>' });
  assert.match(retained, /Synthesize the retained findings/);
  assert.match(retained, /Preserve every citation and direct URL attached to a claim/);
  assert.match(retained, /Do not restart research or relaunch the worker during this hand-back/);
  assert.doesNotMatch(agentLaunchContinuationMessage({ agentName: "Deep Research", outcome: "completed", content: "Findings." }), /Max Research owns this request/);
});
