import { runtimeAgentById } from "../hermes/capability-combinations.ts";
import { unifiedWorkflowSelectionAllows } from "../workflows/unified-command.ts";
import { SwarmError, type PreparedSwarmTask, type SwarmAuthority, type SwarmExecutor, type SwarmLimits, type SwarmPlan, type SwarmTaskSpec } from "./types.ts";

export const DEFAULT_SWARM_LIMITS: Readonly<SwarmLimits> = Object.freeze({
  maxTasks: 24, maxParallel: 4, maxWorkerSlots: 12, maxAttemptsPerTask: 2,
  maxTokens: 200_000, maxDurationMs: 60 * 60_000,
});

// Composite engines occupy the scheduler's entire foreground wave unless an
// adapter provides a measured, bounded internal worker count. Their internal
// usage is included in the same attempt receipt, not counted as a cheap call.
export const COMPOSITE_AGENTS = new Set(["ruflo", "max-research", "trading-agent", "openexecutive", "deer-flow", "openscience", "praxist", "openmontage", "vimax"]);
const REPOSITORY_WRITERS = new Set(["codex", "opencode", "ruflo"]);
const BROWSER_WRITERS = new Set(["agent-browser", "agent-tars"]);
const KEYS = /^[a-z][a-z0-9_-]{0,63}$/u;

export interface ExecutorAdmission {
  available: boolean;
  reason?: string;
  requiresApproval: boolean;
  workerSlots?: number;
  resources?: string[];
}

export function swarmText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new SwarmError("swarm_invalid_plan", `${field} must contain 1–${maximum} characters.`);
  }
  return value.trim();
}

export function validateSwarmLimits(value: SwarmLimits): SwarmLimits {
  const ceilings: SwarmLimits = { maxTasks: 100, maxParallel: 8, maxWorkerSlots: 32, maxAttemptsPerTask: 4, maxTokens: 10_000_000, maxDurationMs: 24 * 60 * 60_000 };
  for (const key of Object.keys(ceilings) as Array<keyof SwarmLimits>) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > ceilings[key]) {
      throw new SwarmError("swarm_invalid_limits", `Invalid ${key}.`);
    }
  }
  return { ...value };
}

export function taskFingerprint(task: Pick<SwarmTaskSpec, "brief" | "inputs" | "verifies">): string {
  return JSON.stringify([task.brief.trim().replace(/\s+/gu, " ").toLowerCase(),
    task.inputs.map(ref => `${ref.kind}:${ref.id}:${ref.revision ?? ""}`).sort(), task.verifies ?? ""]);
}

function validInput(ref: SwarmTaskSpec["inputs"][number], authority: SwarmAuthority): boolean {
  return authority.inputReferences.some(allowed => allowed.kind === ref.kind && allowed.id === ref.id && allowed.revision === ref.revision);
}

/** Shape and dependency validation is independent of the model and executors. */
export function validateSwarmPlan(raw: unknown, limits: SwarmLimits): SwarmPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SwarmError("swarm_invalid_plan", "Provide a structured task plan.");
  const plan = raw as SwarmPlan;
  const objective = swarmText(plan.objective, "Objective", 8_000);
  const reason = swarmText(plan.reason, "Team benefit", 1_000);
  if (!["coverage", "independent_verification", "parallel_deliverables"].includes(plan.benefit)) throw new SwarmError("swarm_invalid_plan", "Name the concrete benefit of using a team.");
  if (!["parallel", "durable"].includes(plan.mode)) throw new SwarmError("swarm_invalid_plan", "Choose parallel or durable execution.");
  if (!Array.isArray(plan.tasks) || plan.tasks.length < 2 || plan.tasks.length > limits.maxTasks) throw new SwarmError("swarm_task_count", `A team needs 2–${limits.maxTasks} distinct assignments. Use an ordinary tool or one specialist for a single assignment.`);
  const keys = new Set<string>();
  const fingerprints = new Set<string>();
  const tasks = plan.tasks.map((rawTask): SwarmTaskSpec => {
    if (!rawTask || typeof rawTask !== "object") throw new SwarmError("swarm_invalid_plan", "Invalid assignment.");
    const key = swarmText(rawTask.key, "Task key", 64);
    if (!KEYS.test(key) || keys.has(key)) throw new SwarmError("swarm_task_key", "Task keys must be unique lowercase identifiers.");
    keys.add(key);
    const executor = rawTask.executor;
    if (!executor || !["runtime", "persona", "native", "workflow", "chat"].includes(executor.kind)) throw new SwarmError("swarm_executor", "Choose a registered executor.");
    const id = swarmText(executor.id, "Executor", 180);
    if (!Array.isArray(rawTask.dependsOn) || rawTask.dependsOn.length > limits.maxTasks || rawTask.dependsOn.some(dep => typeof dep !== "string")) throw new SwarmError("swarm_dependencies", "Dependencies must name task keys.");
    if (!Array.isArray(rawTask.acceptance) || !rawTask.acceptance.length || rawTask.acceptance.length > 12) throw new SwarmError("swarm_acceptance", "Each assignment needs 1–12 completion criteria.");
    const acceptance = rawTask.acceptance.map(item => swarmText(item, "Completion criterion", 1_000));
    if (new Set(acceptance).size !== acceptance.length) throw new SwarmError("swarm_acceptance", "Completion criteria must be distinct.");
    if (!Array.isArray(rawTask.inputs) || rawTask.inputs.length > 32 || rawTask.inputs.some(ref => !ref || !["attachment", "artifact", "garden_source", "repository"].includes(ref.kind) || typeof ref.id !== "string" || !ref.id || ref.id.length > 256 || (ref.revision !== undefined && (typeof ref.revision !== "string" || ref.revision.length > 256)))) throw new SwarmError("swarm_inputs", "Use typed input references from this conversation.");
    if (!Number.isSafeInteger(rawTask.tokenBudget) || rawTask.tokenBudget < 1 || rawTask.tokenBudget > limits.maxTokens) throw new SwarmError("swarm_task_budget", "Each assignment needs a token reservation within the team budget.");
    const task: SwarmTaskSpec = { key, title: swarmText(rawTask.title, "Task title", 180), brief: swarmText(rawTask.brief, "Task brief", 8_000),
      executor: { kind: executor.kind, id } as SwarmExecutor, dependsOn: [...new Set(rawTask.dependsOn)], acceptance, inputs: rawTask.inputs.map(ref => ({ ...ref })),
      tokenBudget: rawTask.tokenBudget, ...(rawTask.verifies ? { verifies: swarmText(rawTask.verifies, "Reviewed task", 64) } : {}) };
    if (task.brief.startsWith("/")) throw new SwarmError("swarm_brief", "Assignments take a complete brief, not a slash command.");
    const fingerprint = taskFingerprint(task);
    if (fingerprints.has(fingerprint)) throw new SwarmError("swarm_duplicate_work", "Two assignments describe the same work. Give each worker a distinct deliverable.");
    fingerprints.add(fingerprint);
    return task;
  });
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new SwarmError("swarm_dependency_cycle", "The task plan contains a dependency cycle.");
    if (visited.has(key)) return;
    const task = tasks.find(item => item.key === key);
    if (!task) throw new SwarmError("swarm_dependencies", `Unknown dependency: ${key}.`);
    visiting.add(key);
    if (task.verifies && !task.dependsOn.includes(task.verifies)) throw new SwarmError("swarm_review_order", "A review must depend on the work it verifies.");
    task.dependsOn.forEach(visit);
    visiting.delete(key); visited.add(key);
  };
  tasks.forEach(task => visit(task.key));
  if (tasks.reduce((total, task) => total + task.tokenBudget, 0) > limits.maxTokens) throw new SwarmError("swarm_budget", "The assignments exceed the available team token budget.");
  if (plan.mode === "parallel" && tasks.some(task => task.dependsOn.length)) throw new SwarmError("swarm_mode", "Use durable execution for work with dependencies.");
  return { objective, reason, benefit: plan.benefit, mode: plan.mode, tasks };
}

/** Shared policy; concrete adapter readiness runs after this and before launch. */
export function prepareSwarmTasks(plan: SwarmPlan, authority: SwarmAuthority, limits: SwarmLimits,
  admission: (executor: SwarmExecutor) => ExecutorAdmission): PreparedSwarmTask[] {
  if (authority.surface === "quartz_ai" || !authority.allowedTools.includes("agent_launch")) throw new SwarmError("swarm_scope", "Team execution is unavailable for this turn.", 403);
  return plan.tasks.map(task => {
    if (task.inputs.some(ref => !validInput(ref, authority))) throw new SwarmError("swarm_input_scope", "An assignment references an input outside the authorized conversation.", 403);
    const contract = admission(task.executor);
    if (!contract.available) throw new SwarmError("swarm_executor_unavailable", contract.reason || "This executor is unavailable on this surface.", 409);
    const resources = [...(contract.resources ?? [])];
    let requiresApproval = contract.requiresApproval;
    if (task.executor.kind === "runtime") {
      const agent = runtimeAgentById(task.executor.id);
      if (!agent || !agent.surfaces.includes(authority.surface) || !authority.allowedAgentIds.includes(agent.id) || !unifiedWorkflowSelectionAllows(authority.workflowSelection, agent.id)) throw new SwarmError("swarm_agent_scope", "This specialist is outside the selected workflow or turn scope.", 403);
      if (!agent.launchableByModel) throw new SwarmError("swarm_native_input_required", `${agent.name} requires its existing file selection flow.`, 409);
      requiresApproval ||= agent.requiresLaunchApproval;
      if (task.inputs.some(ref => ref.kind === "attachment") && !agent.acceptsAttachments) throw new SwarmError("swarm_attachment_unsupported", `${agent.name} cannot receive attachments through its current run contract.`, 409);
      if (REPOSITORY_WRITERS.has(agent.id)) resources.push(`repository:${authority.gardenSlug ?? "terminal"}`);
      if (BROWSER_WRITERS.has(agent.id)) resources.push("interactive-browser");
      if (agent.id === "inbox-zero") resources.push("mailbox");
      if (agent.id === "socials-manager") resources.push("social-publishing");
    }
    const workerSlots = contract.workerSlots ?? (task.executor.kind === "runtime" && COMPOSITE_AGENTS.has(task.executor.id) ? limits.maxWorkerSlots : 1);
    if (!Number.isSafeInteger(workerSlots) || workerSlots < 1 || workerSlots > limits.maxWorkerSlots) throw new SwarmError("swarm_worker_budget", "The executor does not fit the team's worker limit.");
    return { ...task, requiresApproval: requiresApproval && !authority.standingApproval, workerSlots,
      resources: [...new Set(resources.map(resource => `user:${authority.userId}:${resource}`))].sort() };
  });
}
