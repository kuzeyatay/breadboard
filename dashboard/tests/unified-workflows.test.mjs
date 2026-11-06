import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  RUNTIME_AGENT_PROFILES,
  findCapabilityConflict,
} from "../src/lib/hermes/capability-combinations.ts";
import {
  UNIFIED_WORKFLOWS,
  UNIFIED_AGENT_INPUT_REQUIREMENTS,
  unifiedWorkflowAgents,
  unifiedWorkflowForAgent,
} from "../src/lib/workflows/unified-catalog.ts";
import {
  normalizeUnifiedWorkflowDispatch,
  parseUnifiedWorkflowCommand,
  unifiedWorkflowModeAgent,
  unifiedWorkflowSelectionAllows,
} from "../src/lib/workflows/unified-command.ts";
import { renderUnifiedWorkflowGuidance } from "../src/lib/workflows/unified-guidance.ts";
import { isFormsmithCommand } from "../src/lib/shaper/identity.ts";
import { runtimeAgentBrief } from "../src/lib/hermes/runtime-agent-briefs.ts";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-unified-workflows-"));
process.env.BREADBOARD_DATA_DIR = dataRoot;
const { default: db } = await import("../src/lib/db.ts");
const { resolveCommandMessage, registryItemsForUser, assignCommandTokens } = await import("../src/lib/hermes/commands.ts");
const { createPrompt } = await import("../src/lib/hermes/prompts.ts");
const { resolveUnifiedWorkflowContinuation } = await import("../src/lib/workflows/unified-continuation.ts");
db.prepare("INSERT INTO users(id, username, email, password_hash) VALUES (1, 'workflow', 'workflow@example.test', 'x')").run();
after(() => { db.close(); fs.rmSync(dataRoot, { recursive: true, force: true }); });

test("eight workflows cover every existing specialist once without inventing a runtime", () => {
  assert.deepEqual(UNIFIED_WORKFLOWS.map((item) => item.id), ["code", "research", "browse", "work", "markets", "learn", "create", "design"]);
  const members = UNIFIED_WORKFLOWS.flatMap((item) => item.agentIds);
  assert.equal(members.length, RUNTIME_AGENT_PROFILES.length);
  assert.equal(new Set(members).size, members.length);
  assert.deepEqual([...members].sort(), RUNTIME_AGENT_PROFILES.map((item) => item.id).sort());
  assert.equal(unifiedWorkflowForAgent("gods-eye")?.id, "research");
  assert.equal(unifiedWorkflowForAgent("shorts")?.id, "create");
  assert.equal(unifiedWorkflowForAgent("formsmith")?.id, "design");
});

test("mode membership and current surface filter preserve specialist contracts", () => {
  assert.deepEqual(unifiedWorkflowAgents("research", { modeId: "papers" }).map((x) => x.id), ["get-doc"]);
  assert.deepEqual(unifiedWorkflowAgents("browse", { surface: "garden_chat" }).map((x) => x.id), ["agent-browser"]);
  assert.equal(unifiedWorkflowAgents("create", { modeId: "edit", surface: "garden_chat" }).length, 0);
  assert.equal(unifiedWorkflowAgents("create", { modeId: "highlights", modelLaunchableOnly: true }).length, 0);
  assert.equal(unifiedWorkflowAgents("design", { modeId: "image-to-3d", modelLaunchableOnly: true }).length, 0);
  assert.deepEqual(unifiedWorkflowAgents("design", { modeId: "cad" }).map((x) => ({ id: x.id, approval: x.requiresLaunchApproval })), [{ id: "parametric-cad", approval: false }]);
});

test("workflow parsing retains other selectors and all task content", () => {
  const parsed = parseUnifiedWorkflowCommand(" /reference:abc /workflows:RESEARCH:papers /prompt:source-note Find a paper.\nKeep its figures.");
  assert.equal(parsed.workflowId, "research");
  assert.equal(parsed.modeId, "papers");
  assert.equal(parsed.textWithoutWorkflow, "/reference:abc /prompt:source-note Find a paper.\nKeep its figures.");
  assert.deepEqual(parsed.selection.allowedAgentIds, ["get-doc"]);
  assert.equal(parsed.explicitAgentId, null);
});

test("quoted or embedded workflow examples do not change routing", () => {
  assert.equal(parseUnifiedWorkflowCommand("Explain /workflows:code and its options."), null);
  assert.equal(parseUnifiedWorkflowCommand('"/workflows:code" is the example.'), null);
  assert.equal(parseUnifiedWorkflowCommand("```\n/workflows:code\n```"), null);
});

test("unknown and conflicting workflow selectors fail visibly", () => {
  for (const [text, code] of [
    ["/workflows:unknown task", "unknown_workflow"],
    ["/workflows:code:missing task", "unknown_workflow_mode"],
    ["/workflows:research /workflows:code task", "conflicting_workflows"],
    ["/workflows:research:web /workflows:research:papers task", "conflicting_workflows"],
  ]) assert.throws(() => parseUnifiedWorkflowCommand(text), (error) => error.code === code);
  assert.equal(parseUnifiedWorkflowCommand("/workflows:code /workflows:code task").workflowId, "code");
});

test("an explicit specialist wins across workflows without consuming other capabilities", () => {
  const text = "/workflows:research /agents:codex /prompt:review Fix the parser";
  assert.equal(normalizeUnifiedWorkflowDispatch(text), "/agents:codex /prompt:review Fix the parser");
  assert.equal(normalizeUnifiedWorkflowDispatch("/workflows:code Build the app"), "/workflows:code Build the app");
  const conflict = findCapabilityConflict({
    text: normalizeUnifiedWorkflowDispatch("/workflows:work /agents:socials-manager /prompt:write Draft a post"),
    surface: "dashboard_terminal",
  });
  assert.equal(conflict.code, "runtime_agent_capability_conflict");
  assert.doesNotMatch(conflict.message, /workflows:/);
});

test("workflow membership cannot be widened by a serialized allowlist", () => {
  const selection = parseUnifiedWorkflowCommand("/workflows:research:papers Find one paper").selection;
  selection.allowedAgentIds.push("socials-manager");
  assert.equal(unifiedWorkflowSelectionAllows(selection, "get-doc"), true);
  assert.equal(unifiedWorkflowSelectionAllows(selection, "socials-manager"), false);
  assert.equal(unifiedWorkflowSelectionAllows({ ...selection, modeId: "made-up" }, "get-doc"), false);
  assert.equal(unifiedWorkflowSelectionAllows({ allowedAgentIds: ["get-doc"] }, "get-doc"), false);
  assert.equal(unifiedWorkflowSelectionAllows({ ...selection, modeId: {} }, "get-doc"), false);
  assert.equal(unifiedWorkflowSelectionAllows(null, "socials-manager"), true);
});

test("single-specialist modes use native dispatch including typed input pickers", () => {
  assert.equal(unifiedWorkflowModeAgent("/workflows:create:highlights Make clips")?.id, "shorts");
  assert.equal(normalizeUnifiedWorkflowDispatch("/workflows:create:highlights Make clips"), "/agents:shorts Make clips");
  assert.equal(isFormsmithCommand(normalizeUnifiedWorkflowDispatch("/workflows:design:image-to-3d")), true);
  assert.throws(() => normalizeUnifiedWorkflowDispatch("/workflows:design:image-to-3d Model this"), (error) => error.code === "workflow_native_input_required");
  assert.equal(normalizeUnifiedWorkflowDispatch("/workflows:research:project C:/research/task"), "/agents:praxist C:/research/task");
  assert.equal(normalizeUnifiedWorkflowDispatch("/workflows:work:legal /prompt:brief Review these documents"), "/agents:legal /prompt:brief Review these documents");
  assert.equal(normalizeUnifiedWorkflowDispatch("/workflows:code:build Fix this"), "/workflows:code:build Fix this");
  assert.equal(normalizeUnifiedWorkflowDispatch("/workflows:design:cad /agents:shorts Make clips"), "/agents:shorts Make clips");
  assert.equal(unifiedWorkflowModeAgent("/workflows:design:cad /agents:codex /agents:opencode Build"), null);
});

test("guidance keeps manual media, document and task-project requirements", () => {
  for (const agent of ["shorts", "formsmith", "legal", "wardrobe", "video-use", "praxist"]) {
    assert.ok(UNIFIED_AGENT_INPUT_REQUIREMENTS[agent]);
  }
  const media = renderUnifiedWorkflowGuidance(parseUnifiedWorkflowCommand("/workflows:create:highlights Make shorts").selection, "dashboard_terminal");
  assert.match(media, /Manual specialist selection is required/);
  assert.ok(media.includes(UNIFIED_AGENT_INPUT_REQUIREMENTS.shorts));
  assert.match(media, /never forward only the prose and discard the files/);
  const project = renderUnifiedWorkflowGuidance(parseUnifiedWorkflowCommand("/workflows:research:project Run it").selection, "dashboard_terminal");
  assert.match(project, /existing configured task-project directory/);
  assert.match(project, /normal launch approval/);
  const production = renderUnifiedWorkflowGuidance(parseUnifiedWorkflowCommand("/workflows:create").selection, "dashboard_terminal");
  for (const id of ["openmontage", "vimax", "money-printer", "hyperframes"]) {
    assert.ok(production.includes(runtimeAgentBrief(id).does));
    assert.ok(production.includes(runtimeAgentBrief(id).choose));
  }
  assert.doesNotMatch(media, /undefined/);
});

test("server registry exposes workflow selectors separately from individual agents", () => {
  const registry = registryItemsForUser(null, { mode: "knowledge", surface: "dashboard_terminal" });
  const workflows = registry.filter((item) => item.source === "Unified workflows");
  assert.equal(workflows.length, 8);
  assert.deepEqual(workflows.map((item) => item.token), UNIFIED_WORKFLOWS.map((item) => item.command.slice(1)));
  assert.ok(workflows.every((item) => item.kind === "agent" && item.id.startsWith("unified-workflow:")));
  assert.equal(registryItemsForUser(null, { mode: "knowledge", surface: "quartz_ai" }).some((item) => item.source === "Unified workflows"), false);
  assert.equal(assignCommandTokens([{ kind: "agent", slug: "code", source: "Unified workflows" }])[0].token, "workflows:code");
});

test("server resolves a workflow into scoped guidance and leaves user text intact", async () => {
  const result = await resolveCommandMessage(1, "/workflows:research:papers Find one paper on transformers");
  assert.equal(result.userText, "Find one paper on transformers");
  assert.match(result.text, /Breadboard workflow: Research \/ Find papers/);
  assert.match(result.text, /Get Doc \(\/agents:get-doc\)/);
  assert.doesNotMatch(result.text, /Stock Analyst|\/agents:socials-manager/);
  assert.deepEqual(result.workflowSelection, { workflowId: "research", modeId: "papers", allowedAgentIds: ["get-doc"] });
  assert.equal(result.agencyAgentSelection, undefined);
  assert.equal(result.tools, undefined);
});

test("a workflow composes with an ordinary selected prompt", async () => {
  const prompt = createPrompt(1, { title: "Workflow writing style", content: "Use concise sentences and state your sources." });
  const result = await resolveCommandMessage(1, `/workflows:research /prompt:${prompt.slug} Explain the evidence`);
  assert.match(result.text, /Breadboard workflow: Research/);
  assert.match(result.text, /Use concise sentences and state your sources/);
  assert.equal(result.userText, "Explain the evidence");
  assert.equal(result.invocations.filter((x) => x.kind === "prompt").length, 1);
});

test("the workflow does not override an explicitly selected execution target", async () => {
  const result = await resolveCommandMessage(1, "/workflows:research Reply with the check result", undefined, {
    mode: "scoped_implementation", surface: "dashboard_terminal", executionTarget: "codex",
  });
  assert.equal(result.workflowSelection, undefined);
  assert.equal(result.text, "Reply with the check result");
  assert.equal(result.userText, "Reply with the check result");
});

test("invalid commands, Quartz launches and conflicting specialists retain clear errors", async () => {
  await assert.rejects(resolveCommandMessage(1, "/workflows:missing Do a task"), (e) => e.code === "unknown_workflow");
  await assert.rejects(resolveCommandMessage(1, "/workflows:code Build", undefined, { mode: "knowledge", surface: "quartz_ai" }), (e) => e.code === "workflow_surface_unavailable");
  await assert.rejects(resolveCommandMessage(1, "/workflows:code /agents:codex /agents:opencode Build"), (e) => e.code === "conflicting_runtime_agents");
});

let continuationSequence = 0;
function continuationFixture() {
  const id = ++continuationSequence;
  const conversationId = Number(db.prepare("INSERT INTO conversations(public_id,user_id,title,surface) VALUES (?,1,'Workflow','dashboard_terminal')").run(`workflow-${id}`).lastInsertRowid);
  const runtimeId = Number(db.prepare("INSERT INTO hermes_runtime_sessions(surface,user_id,conversation_id,agent_name,workspace_key) VALUES ('dashboard_terminal',1,?,'Hermes',?)").run(conversationId, `workspace-${id}`).lastInsertRowid);
  let order = 0;
  const put = (clientId, role, content, metadata = {}, status = "complete") => db.prepare("INSERT INTO conversation_messages(conversation_id,client_message_id,role,surface,content,status,order_index,metadata) VALUES (?,?,?,'dashboard_terminal',?,?,?,?)")
    .run(conversationId, clientId, role, content, status, order++, JSON.stringify(metadata));
  put("origin", "user", "/workflows:research Find papers and summarize the evidence");
  const selection = parseUnifiedWorkflowCommand("/workflows:research").selection;
  db.prepare("INSERT INTO hermes_runs(id,runtime_session_id,instruction,status,dispatch_json,started_at) VALUES (?,?,'Find evidence','completed',?,datetime('now'))")
    .run(`run-workflow-${id}`, runtimeId, JSON.stringify({ clientMessageId: "origin", workflowSelection: selection }));
  const receipt = { externalAgent: true, delegatedAgentRun: true, internalAgentContinuation: true,
    externalAgentRun: { kind: "get_doc", runId: `doc-${id}`, query: "Find one paper" }, externalAgentOutcome: "completed" };
  put("worker", "user", "/agents:get-doc Find one paper", receipt);
  put("worker", "assistant", "Paper [S1]", receipt);
  put("continuation", "user", "<!-- agent-launch-result:worker --> Paper [S1]", { internalAgentContinuation: true });
  const input = { userId: 1, conversationId, clientMessageId: "continuation", continuationText: "<!-- agent-launch-result:worker --> Paper [S1]", internalAgentContinuation: true };
  return { input, put, receipt, runtimeId, selection };
}

test("durable workflow receipts restore scoped continuation guidance across runtime replacement", async () => {
  const { input, selection } = continuationFixture();
  const inherited = resolveUnifiedWorkflowContinuation(input);
  assert.deepEqual(inherited.selection, selection);
  assert.equal(inherited.originClientMessageId, "origin");
  assert.deepEqual(inherited.completedWork, [{ agentId: "get-doc", brief: "/agents:get-doc Find one paper" }]);
  const restored = await import("../src/lib/workflows/unified-continuation.ts?runtime=replaced");
  assert.deepEqual(restored.resolveUnifiedWorkflowContinuation(input), inherited);
  const resolved = await resolveCommandMessage(1, input.continuationText, undefined, {
    mode: "knowledge", surface: "dashboard_terminal", workflowContinuation: inherited,
  });
  assert.deepEqual(resolved.workflowSelection, selection);
  assert.deepEqual(resolved.workflowCompletedWork, inherited.completedWork);
  assert.match(resolved.text, /continue only distinct unfinished steps/);
  assert.match(resolved.text, /Do not repeat a completed specialist job/);
  assert.equal(resolved.userText, input.continuationText);
  const newChoice = await resolveCommandMessage(1, "/workflows:design Make a part", undefined, {
    mode: "knowledge", surface: "dashboard_terminal", workflowContinuation: inherited,
  });
  assert.equal(newChoice.workflowSelection.workflowId, "design");
  assert.equal(newChoice.workflowCompletedWork, undefined);
});

test("continuation inheritance requires the same owner, conversation, current user origin and terminal worker", () => {
  const { input } = continuationFixture();
  assert.equal(resolveUnifiedWorkflowContinuation({ ...input, internalAgentContinuation: false }), null);
  assert.equal(resolveUnifiedWorkflowContinuation({ ...input, userId: 2 }), null);
  assert.equal(resolveUnifiedWorkflowContinuation({ ...input, conversationId: 999999 }), null);
  assert.equal(resolveUnifiedWorkflowContinuation({ ...input, continuationText: "<!-- agent-launch-result:unknown -->" }), null);
  assert.equal(resolveUnifiedWorkflowContinuation({ ...input, continuationText: "A report without a receipt" }), null);
  const foreign = continuationFixture();
  db.prepare("UPDATE conversation_messages SET client_message_id='foreign-worker' WHERE conversation_id=? AND client_message_id='worker'").run(foreign.input.conversationId);
  assert.equal(resolveUnifiedWorkflowContinuation({ ...input, continuationText: "<!-- agent-launch-result:foreign-worker -->" }), null);
  db.prepare("UPDATE conversation_messages SET status='pending' WHERE conversation_id=? AND client_message_id='worker' AND role='assistant'").run(input.conversationId);
  assert.equal(resolveUnifiedWorkflowContinuation(input), null);
  db.prepare("UPDATE conversation_messages SET status='complete',metadata='{}' WHERE conversation_id=? AND client_message_id='worker' AND role='assistant'").run(input.conversationId);
  assert.equal(resolveUnifiedWorkflowContinuation(input), null);
});

test("a second workflow stage inherits the original scope but a new human turn ends it", () => {
  const { input, put, receipt, selection } = continuationFixture();
  put("worker-two", "user", "/agents:get-doc Find a different paper", receipt);
  put("worker-two", "assistant", "Other paper", receipt);
  put("continuation-two", "user", "<!-- agent-launch-result:worker-two -->", { internalAgentContinuation: true });
  const second = { ...input, clientMessageId: "continuation-two", continuationText: "<!-- agent-launch-result:worker-two -->" };
  assert.deepEqual(resolveUnifiedWorkflowContinuation(second).selection, selection);
  assert.equal(resolveUnifiedWorkflowContinuation(second).completedWork.length, 2);
  put("new-human", "user", "Now help me draft an email");
  assert.equal(resolveUnifiedWorkflowContinuation(second), null, "replaying an earlier hand-back after new user input cannot restore old scope");
  put("late-worker-result", "user", input.continuationText, { internalAgentContinuation: true });
  assert.equal(resolveUnifiedWorkflowContinuation({ ...input, clientMessageId: "late-worker-result" }), null);
});

test("continuation scope is rebuilt from the original choice instead of a serialized allowlist", () => {
  const { input, runtimeId, selection } = continuationFixture();
  db.prepare("UPDATE hermes_runs SET dispatch_json=? WHERE runtime_session_id=?").run(JSON.stringify({ clientMessageId: "origin", workflowSelection: { ...selection, allowedAgentIds: ["socials-manager"] } }), runtimeId);
  assert.deepEqual(resolveUnifiedWorkflowContinuation(input).selection, selection);
  db.prepare("UPDATE hermes_runs SET status='cancelled' WHERE runtime_session_id=?").run(runtimeId);
  assert.equal(resolveUnifiedWorkflowContinuation(input), null, "a cancelled workflow must not resume from a late worker receipt");
  db.prepare("UPDATE hermes_runs SET status='completed' WHERE runtime_session_id=?").run(runtimeId);
  db.prepare("UPDATE conversation_messages SET content='/workflows:research /agents:codex Fix it' WHERE conversation_id=? AND client_message_id='origin'").run(input.conversationId);
  assert.equal(resolveUnifiedWorkflowContinuation(input), null);
});
