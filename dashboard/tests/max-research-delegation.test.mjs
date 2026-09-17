import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { agentLaunchContinuationMessage } from "../src/lib/hermes/agent-launch.ts";
import * as combinations from "../src/lib/hermes/capability-combinations.ts";
import { ApiError, describeError, readJsonBody } from "../src/lib/hermes/route-core.ts";

// Run the actual POST handler with storage/auth/worker I/O replaced. The launch
// policy, command parsing, capability conflicts, and response handling are real.
const routePath = new URL("../src/app/api/hermes/tools/agent-launch/route.ts", import.meta.url);
const tree = ts.createSourceFile("route.ts", fs.readFileSync(routePath, "utf8"), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(tree.statements
  .filter((node) => !ts.isImportDeclaration(node))
  .map((node) => node.getText(tree)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

async function launch({ instruction, agentId = "max-research", delegatedAgents = [], queuedAgents = [], surface = "garden_chat" }) {
  const calls = { reserved: 0, started: [], queued: [], persisted: [] };
  const session = { id: 1, user_id: 7, conversation_id: 9, surface };
  const conversation = { id: 9, user_id: 7 };
  const dispatch = { clientMessageId: "original-turn", model: { modelID: "test-model" }, delegatedAgents };
  const scope = {
    ...combinations, ApiError, readJsonBody,
    MAX_PARALLEL_AGENT_LAUNCHES: 4,
    NextResponse: Response,
    requireEnabled: () => {},
    capabilityForInternalToolRequest: () => "test-token",
    verifyCapabilityToken: () => ({ ok: true, token: { breadboardSessionId: "1", hermesSessionId: "session-test", conversationId: 9 } }),
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
    getConversationMessageByClientId: () => null,
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
    body: JSON.stringify({ args: { agent: agentId, brief: "Build a strength program and calorie plan.", reason: "Evidence for the program." } }),
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

test("Max Research hand-backs keep recommendations in the research answer", () => {
  for (const outcome of ["completed", "failed", "cancelled"]) {
    const message = agentLaunchContinuationMessage({ agentName: "Max Research", outcome, content: "Findings about training." });
    assert.match(message, /Max Research owns this request/);
  }
  assert.doesNotMatch(agentLaunchContinuationMessage({ agentName: "Deep Research", outcome: "completed", content: "Findings." }), /Max Research owns this request/);
});
