import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { prepareTurn, mergeSelectedTools } from "../src/lib/hermes/dispatch-core.ts";
import { findCapabilityConflict, modelLaunchableRuntimeAgents, runtimeAgentById } from "../src/lib/hermes/capability-combinations.ts";
import { parseUnifiedWorkflowCommand, unifiedWorkflowSelectionAllows, unifiedWorkflowRepeatsCompletedWork } from "../src/lib/workflows/unified-command.ts";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const ast = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function execute(code, scope, result) {
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("exports", ...Object.keys(scope), `${compiled}\nreturn ${result};`)({}, ...Object.values(scope));
}
function declaration(file, name) {
  const tree = ast(file);
  const node = tree.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `${file} must define ${name}`);
  return node.getText(tree);
}
const parseRuntimeRunDispatch = execute(declaration("lib/hermes/run-store.ts", "parseRuntimeRunDispatch"), {}, "parseRuntimeRunDispatch");

// Execute the actual Terminal grant, tools and durable dispatch expressions.
// The surrounding persistence/transport services are not needed to verify
// this seam, and no worker or external account is started by this test.
function terminalDispatch(workflowSelection, workflowCompletedWork) {
  const tree = ast("lib/conversations/turn-service.ts");
  const body = tree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "startConversationTurn").body;
  const selected = [];
  for (const statement of body.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const item of statement.declarationList.declarations) {
        if (["parametricCadSelected", "tools", "run"].includes(item.name.getText(tree))) selected.push(statement.getText(tree));
      }
    } else if (ts.isIfStatement(statement) && statement.expression.getText(tree).includes("resolved.workflowSelection")) {
      selected.push(statement.getText(tree));
    }
  }
  assert.equal(selected.length, 4, "the live selection, grant, tools and durable dispatch statements must all be exercised");
  const prepared = prepareTurn({ request: "Find evidence", surface: "dashboard_terminal", userId: 7, grants: [], workspaceRoot: "/test/workspace" });
  const decision = prepared.decision;
  const run = execute(selected.join("\n"), {
    prepared, decision, mergeSelectedTools,
    resolved: { userText: "Find evidence", workflowSelection, workflowCompletedWork },
    connectedApps: { tools: {} }, repository: null,
    COMPUTER_USE_SKILL: "computer-use", BREADBOARD_USE_SKILL: "breadboard-use",
    goalMode: false, skillShortlist: [], session: { row: { id: 10 } },
    input: { text: "Find evidence", conversation: { public_id: "conv_workflow" }, clientMessageId: "origin" },
    runtimeText: "Find evidence", documents: { inlineAttachments: [] }, hermesPromptText: (text) => text,
    engine: { model: { providerID: "test", modelID: "test" }, selectedModelID: "test", variant: "high" },
    systemWithProducts: "", productSearch: null, requiredArtifacts: [],
    gardenGrounding: { attempted: false }, geographicGrounding: { required: false }, webGroundingVerdict: { required: false },
    researchPipeline: null, capabilitySelection: {}, carriedDelegations: [],
    beginRuntimeRun: (input) => ({ ...input, dispatch_json: JSON.stringify(input.dispatch) }),
  }, "run");
  return { run, decision };
}

test("Terminal grants workflow delegation and persists exactly its scope for recovery", () => {
  const selection = parseUnifiedWorkflowCommand("/workflows:research Find evidence").selection;
  const selected = terminalDispatch(selection);
  assert.equal(selected.run.dispatch.tools.agent_launch, true);
  assert.ok(selected.decision.allowedTools.includes("agent_launch"));
  assert.deepEqual(parseRuntimeRunDispatch(selected.run).workflowSelection, selection);
  const completedWork = [{ agentId: "get-doc", brief: "Find one paper" }];
  assert.deepEqual(parseRuntimeRunDispatch(terminalDispatch(selection, completedWork).run).workflowCompletedWork, completedWork);
  const plain = terminalDispatch(undefined);
  assert.equal(plain.run.dispatch.tools.agent_launch, false);
  assert.equal(plain.decision.allowedTools.includes("agent_launch"), false);
  assert.equal(Object.hasOwn(parseRuntimeRunDispatch(plain.run), "workflowSelection"), false);
});

class FixtureApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
async function launch({ workflow = "/workflows:research", agent = "get-doc", allowed = true, userId = 7, surface = "dashboard_terminal", forgedIds = [], completedWork = [] } = {}) {
  const selection = workflow ? parseUnifiedWorkflowCommand(workflow).selection : undefined;
  selection?.allowedAgentIds.push(...forgedIds);
  const state = { queued: [], reservations: 0 };
  const run = { id: "run_workflow", dispatch_json: JSON.stringify({ clientMessageId: "origin", workflowCompletedWork: completedWork, ...(selection ? { workflowSelection: selection } : {}) }) };
  const POST = execute(declaration("app/api/hermes/tools/agent-launch/route.ts", "POST"), {
    TOOL: "agent_launch", MAX_BRIEF_LENGTH: 8000, MAX_REASON_LENGTH: 240, MAX_PARALLEL_AGENT_LAUNCHES: 4,
    requireEnabled: () => {}, capabilityForInternalToolRequest: () => "signed-token",
    verifyCapabilityToken: () => ({ ok: true, token: { breadboardSessionId: 10, hermesSessionId: "session", conversationId: 20 } }),
    tokenAllows: () => allowed,
    getRuntimeSessionById: () => ({ id: 10, user_id: userId, conversation_id: 20, surface }),
    runtimeExternalSessionId: () => "session", getActiveRuntimeRun: () => run,
    getActiveCapabilityDecision: () => ({ allowedTools: allowed ? ["agent_launch"] : [] }),
    readJsonBody: async () => ({ args: { agent, brief: "Complete this specific task", reason: "This specialist has the required file and research tools." } }),
    parseRuntimeRunDispatch, unifiedWorkflowSelectionAllows, unifiedWorkflowRepeatsCompletedWork, modelLaunchableRuntimeAgents, runtimeAgentById, findCapabilityConflict,
    ApiError: FixtureApiError,
    apiErrorResponse: (error) => { if (!(error instanceof FixtureApiError)) throw error; return Response.json({ code: error.code }, { status: error.status }); },
    NextResponse: { json: (body) => Response.json(body) },
    listAgentLaunchRequestsAfter: () => [],
    reserveAgentLaunchRequestSlot: () => { state.reservations++; return true; },
    releaseAgentLaunchRequestSlot: () => {}, randomUUID: () => "worker",
    recordAgentLaunchRequest: (request) => { state.queued.push(request); return { requestId: "queued" }; },
    recordAuditEvent: () => {},
  }, "POST");
  const response = await POST(new Request("http://localhost/api/hermes/tools/agent-launch", { method: "POST" }));
  return { ...state, status: response.status, body: await response.json() };
}

test("the real launch endpoint rejects out-of-workflow agents before queueing", async () => {
  const outside = await launch({ agent: "socials-manager", forgedIds: ["socials-manager"] });
  assert.equal(outside.status, 403);
  assert.equal(outside.body.code, "agent_launch_workflow_scope");
  assert.equal(outside.reservations, 0);
  assert.equal(outside.queued.length, 0);
  const differentMode = await launch({ workflow: "/workflows:research:papers", agent: "deep-research" });
  assert.equal(differentMode.body.code, "agent_launch_workflow_scope");
});

test("workflow launch keeps per-agent approval, surface and typed-input gates", async () => {
  const research = await launch();
  assert.equal(research.status, 200);
  assert.equal(research.body.data.confirmationRequired, false);
  assert.equal(research.queued[0].originClientMessageId, "origin");
  const action = await launch({ workflow: "/workflows:work", agent: "career-ops" });
  assert.equal(action.status, 200);
  assert.equal(action.body.data.confirmationRequired, true);
  assert.equal(action.queued[0].requiresApproval, true);
  const picker = await launch({ workflow: "/workflows:create", agent: "shorts" });
  assert.equal(picker.body.code, "agent_launch_not_launchable");
  assert.equal(picker.reservations, 0);
  const wrongSurface = await launch({ workflow: "/workflows:browse", agent: "agent-tars", surface: "garden_chat" });
  assert.equal(wrongSurface.body.code, "agent_launch_surface_unavailable");
});

test("workflow membership never substitutes for capability or user authorization", async () => {
  assert.equal((await launch({ allowed: false })).body.code, "agent_launch_capability_denied");
  assert.equal((await launch({ userId: null })).body.code, "agent_launch_session_scope_mismatch");
  assert.equal((await launch({ surface: "quartz_ai" })).body.code, "agent_launch_session_scope_mismatch");
  const direct = await launch({ workflow: null, agent: "career-ops" });
  assert.equal(direct.status, 200, "existing explicit specialist use has no workflow restriction");
  assert.equal(direct.body.data.confirmationRequired, true);
});

test("a continuation cannot repeat a completed job but can launch a distinct next step", async () => {
  const repeated = await launch({ completedWork: [{ agentId: "get-doc", brief: "/agents:get-doc   Complete this specific task" }] });
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.code, "agent_launch_workflow_job_completed");
  assert.equal(repeated.reservations, 0);
  const nextStep = await launch({ completedWork: [{ agentId: "get-doc", brief: "Find another distinct paper" }] });
  assert.equal(nextStep.status, 200);
});
