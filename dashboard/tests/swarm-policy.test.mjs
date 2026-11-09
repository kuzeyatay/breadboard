import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SWARM_LIMITS, prepareSwarmTasks, validateSwarmPlan } from "../src/lib/swarm/policy.ts";
import { RUNTIME_AGENT_PROFILES } from "../src/lib/hermes/capability-combinations.ts";
import { UNIFIED_WORKFLOWS } from "../src/lib/workflows/unified-catalog.ts";

const limits = { ...DEFAULT_SWARM_LIMITS };
const authority = () => ({ userId: 1, conversationId: 1, conversationPublicId: "conv_one", runtimeSessionId: 1,
  sourceRunId: "source-one", originClientMessageId: "message-one", surface: "dashboard_terminal", gardenId: null,
  gardenSlug: null, model: "test-model", reasoningEffort: "high", standingApproval: false,
  allowedTools: ["agent_launch"], allowedAgentIds: RUNTIME_AGENT_PROFILES.map(agent => agent.id), inputReferences: [] });
const task = (key, agent = "deep-research", overrides = {}) => ({ key, title: key, brief: `Investigate ${key} and report the evidence.`,
  executor: { kind: "runtime", id: agent }, dependsOn: [], acceptance: ["The requested evidence is returned with its sources."], inputs: [], tokenBudget: 1000, ...overrides });
const plan = (tasks = [task("sources"), task("papers", "get-doc")], overrides = {}) => ({ objective: "Produce a sourced comparison.",
  reason: "The web sources and literature can be investigated independently.", benefit: "coverage", mode: "parallel", tasks, ...overrides });
const admission = () => ({ available: true, requiresApproval: false });

test("one assignment stays with a tool or specialist; duplicate work is not a team", () => {
  assert.throws(() => validateSwarmPlan(plan([task("one")]), limits), { code: "swarm_task_count" });
  assert.throws(() => validateSwarmPlan(plan([task("one"), task("two", "get-doc", { brief: task("one").brief })]), limits), { code: "swarm_duplicate_work" });
  assert.equal(validateSwarmPlan(plan(), limits).tasks.length, 2);
});

test("dependent deliverables and independent review require an acyclic durable plan", () => {
  const tasks = [task("sources"), task("report", "bolt-slides", { dependsOn: ["sources"] })];
  assert.throws(() => validateSwarmPlan(plan(tasks), limits), { code: "swarm_mode" });
  assert.equal(validateSwarmPlan(plan(tasks, { mode: "durable" }), limits).tasks[1].dependsOn[0], "sources");
  tasks[0].dependsOn = ["report"];
  assert.throws(() => validateSwarmPlan(plan(tasks, { mode: "durable" }), limits), { code: "swarm_dependency_cycle" });
  assert.throws(() => validateSwarmPlan(plan([task("one"), task("review", "get-doc", { verifies: "one" })], { mode: "durable" }), limits), { code: "swarm_review_order" });
});

test("all Master Agent rosters are enforced using the current catalog rather than supplied membership", () => {
  for (const workflow of UNIFIED_WORKFLOWS) {
    const member = RUNTIME_AGENT_PROFILES.find(agent => workflow.agentIds.includes(agent.id) && agent.launchableByModel && agent.surfaces.includes("dashboard_terminal"));
    const outsider = RUNTIME_AGENT_PROFILES.find(agent => !workflow.agentIds.includes(agent.id) && agent.launchableByModel && agent.surfaces.includes("dashboard_terminal"));
    assert.ok(member && outsider, workflow.id);
    const scoped = { ...authority(), workflowSelection: { workflowId: workflow.id, modeId: null, allowedAgentIds: [outsider.id] } };
    assert.throws(() => prepareSwarmTasks(plan([task("one", member.id), task("two", outsider.id)]), scoped, limits, admission), { code: "swarm_agent_scope" });
    assert.equal(prepareSwarmTasks(plan([task("one", member.id), task("two", member.id)]), scoped, limits, admission).length, 2);
  }
});

test("surface restrictions, turn grants, and file picker contracts survive team selection", () => {
  for (const scoped of [{ ...authority(), surface: "quartz_ai" }, { ...authority(), allowedTools: [] }]) {
    assert.throws(() => prepareSwarmTasks(plan(), scoped, limits, admission), { code: "swarm_scope" });
  }
  for (const agent of RUNTIME_AGENT_PROFILES.filter(agent => !agent.launchableByModel && agent.surfaces.includes("dashboard_terminal"))) {
    assert.throws(() => prepareSwarmTasks(plan([task("one", agent.id), task("two")]), authority(), limits, admission), { code: "swarm_native_input_required" }, agent.id);
  }
  const ref = { kind: "attachment", id: "attached-one", revision: "v1" };
  const withInput = plan([task("one", "codex", { inputs: [ref] }), task("two")]);
  assert.throws(() => prepareSwarmTasks(withInput, authority(), limits, admission), { code: "swarm_input_scope" });
  assert.equal(prepareSwarmTasks(withInput, { ...authority(), inputReferences: [ref] }, limits, admission)[0].inputs[0].id, ref.id);
  assert.throws(() => prepareSwarmTasks(plan([task("one", "get-doc", { inputs: [ref] }), task("two")]), { ...authority(), inputReferences: [ref] }, limits, admission), { code: "swarm_attachment_unsupported" });
});

test("known teams reserve a full wave and shared writers acquire server-derived resources", () => {
  const prepared = prepareSwarmTasks(plan([task("code", "ruflo"), task("browser", "agent-browser")]), authority(), limits, admission);
  assert.equal(prepared[0].workerSlots, limits.maxWorkerSlots);
  assert.deepEqual(prepared[0].resources, ["user:1:repository:terminal"]);
  assert.deepEqual(prepared[1].resources, ["user:1:interactive-browser"]);
  assert.throws(() => prepareSwarmTasks(plan(), authority(), limits, () => ({ available: false, reason: "Missing local service", requiresApproval: false })), /Missing local service/);
});

test("budget and completion criteria are mandatory and approval is inherited only from sealed authority", () => {
  assert.throws(() => validateSwarmPlan(plan([task("one", "get-doc", { acceptance: [] }), task("two")]), limits), { code: "swarm_acceptance" });
  assert.throws(() => validateSwarmPlan(plan(), { ...limits, maxTokens: 1500 }), { code: "swarm_budget" });
  const gated = () => ({ available: true, requiresApproval: true });
  assert.ok(prepareSwarmTasks(plan(), authority(), limits, gated).every(task => task.requiresApproval));
  assert.ok(prepareSwarmTasks(plan(), { ...authority(), standingApproval: true }, limits, gated).every(task => !task.requiresApproval));
});
