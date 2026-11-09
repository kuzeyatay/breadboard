import db from "../db.ts";
import { swarmToolGuidance } from "../system-prompts/coordination.ts";
import { SwarmStore } from "./store.ts";
import { DEFAULT_SWARM_LIMITS, type ExecutorAdmission } from "./policy.ts";
import { SwarmError, type SwarmAuthority, type SwarmExecutor, type SwarmLimits, type SwarmVerification } from "./types.ts";
import { SWARM_RUNTIME_ROUTES } from "./runtime-routes.ts";
import type { OuterAgentKind } from "../runtime-v2/outer-agent-run-store.ts";
import { modelLaunchableRuntimeAgents } from "../hermes/capability-combinations.ts";
import { unifiedWorkflowSelectionAllows } from "../workflows/unified-command.ts";
import { parseRuntimeRunDispatch, type RuntimeRunRow } from "../hermes/run-store.ts";
import type { RuntimeSessionRow, StoredCapabilityDecision } from "../hermes/runtime-store.ts";
import { getConversationById, getConversationMessageByClientId, presentConversationMessage } from "../conversations/store.ts";
import { normalizeChatMessageAttachments } from "../chat-attachments.ts";
import { readGoalModeState } from "../goal-mode.ts";
import { findAgencyAgent } from "../hermes/agency-agents.ts";
import { getWorkflow } from "../workflows/store.ts";

export const swarmStore = () => new SwarmStore(db);

export function sealSwarmAuthority(session: RuntimeSessionRow, run: RuntimeRunRow, decision: StoredCapabilityDecision): SwarmAuthority {
  const dispatch = parseRuntimeRunDispatch(run);
  const conversation = session.conversation_id ? getConversationById(session.conversation_id) : null;
  if (!conversation || conversation.user_id !== session.user_id || !dispatch.clientMessageId || session.surface === "quartz_ai") throw new SwarmError("swarm_scope", "A team needs an owned private conversation and originating turn.", 403);
  const origin = getConversationMessageByClientId(conversation.id, dispatch.clientMessageId, "user");
  const attachments = normalizeChatMessageAttachments(origin ? presentConversationMessage(origin).metadata.attachments : []);
  const goal = readGoalModeState(conversation.public_id);
  return { userId: conversation.user_id, conversationId: conversation.id, conversationPublicId: conversation.public_id,
    runtimeSessionId: session.id, sourceRunId: run.id, originClientMessageId: dispatch.clientMessageId,
    surface: session.surface, gardenId: session.cluster_id, gardenSlug: session.garden_id,
    model: dispatch.modelIdentity?.modelID ?? dispatch.model?.modelID ?? "", reasoningEffort: dispatch.variant ?? "medium",
    standingApproval: dispatch.teamApproval === true, allowedTools: [...decision.allowedTools], capability: { ...decision },
    allowedAgentIds: modelLaunchableRuntimeAgents(session.surface).filter(agent => unifiedWorkflowSelectionAllows(dispatch.workflowSelection, agent.id)).map(agent => agent.id),
    workflowSelection: dispatch.workflowSelection,
    inputReferences: attachments.map((_, index) => ({ kind: "attachment", id: `attachment:${index}` })),
    ...(goal?.status === "active" ? { goalId: goal.goal_id } : {}),
  };
}

export function swarmAdmission(authority: SwarmAuthority, executor: SwarmExecutor): ExecutorAdmission {
  if (executor.kind === "runtime") return { available: Boolean(SWARM_RUNTIME_ROUTES[executor.id as OuterAgentKind]),
    requiresApproval: false, ...(SWARM_RUNTIME_ROUTES[executor.id as OuterAgentKind] ? {} : { reason: "This specialist retains its interactive launch flow; it has no durable server assignment adapter yet." }) };
  const forbidden = new Set(["agent_launch", "delegate_task", "chat_send", "chat_send_message", "chat_wait", "messaging_send", "save_memory"]);
  const allowed = executor.kind === "persona" ? Boolean(findAgencyAgent(executor.id)) && Boolean(authority.capability)
    : executor.kind === "native" ? authority.allowedTools.includes(executor.id) && !forbidden.has(executor.id)
    : executor.kind === "workflow" ? authority.allowedTools.includes("workflow_run") && Boolean(getWorkflow(authority.userId, executor.id)) : false;
  // A native/persona assignment shares the parent's authorized workspace.
  // Serialize that workspace until an executor supplies an isolated checkout.
  return { available: allowed, requiresApproval: !authority.standingApproval,
    resources: ["interactive-browser", `repository:${authority.gardenSlug ?? "terminal"}`],
    reason: executor.kind === "chat" ? "Use chat_send/chat_wait for saved-chat coordination; it retains the receiving chat's own permissions and delivery contract." : "This role or tool is outside the originating turn's capabilities." };
}

export async function swarmToolAction(authority: SwarmAuthority, args: Record<string, unknown>) {
  const store = swarmStore();
  const action = args.team_action;
  if (action === "start" || action === "catalog") {
    const origin = getConversationMessageByClientId(authority.conversationId, authority.originClientMessageId, "assistant");
    const metadata = origin ? presentConversationMessage(origin).metadata : {};
    if (metadata.deliveryChannel === "telegram" || metadata.deliveryChannel === "whatsapp") {
      throw new SwarmError("swarm_delivery_unavailable", "Durable teams currently require the Breadboard conversation UI. Continue this request with available tools or a specialist supported by this messaging channel. No team was started.", 409);
    }
  }
  if (action === "catalog") return { ok: true, data: {
    runtimeAgents: modelLaunchableRuntimeAgents(authority.surface).filter(agent => authority.allowedAgentIds.includes(agent.id)).map(agent => ({
      id: agent.id, name: agent.name, inputContract: SWARM_RUNTIME_ROUTES[agent.id as OuterAgentKind]?.inputContract ?? "A complete assignment using the specialist's normal request syntax and required configured inputs.", ...swarmAdmission(authority, { kind: "runtime", id: agent.id }), requiresApproval: agent.requiresLaunchApproval && !authority.standingApproval,
    })), inputReferences: authority.inputReferences, limits: DEFAULT_SWARM_LIMITS,
    nativeTools: authority.allowedTools.filter(id => swarmAdmission(authority, { kind: "native", id }).available),
    guidance: swarmToolGuidance(authority.userId, "catalog"),
  } };
  let runId = typeof args.team_id === "string" ? args.team_id : "";
  if (action === "start") {
    const limits: SwarmLimits = { ...DEFAULT_SWARM_LIMITS };
    if (args.limits && typeof args.limits === "object" && !Array.isArray(args.limits)) {
      for (const [key, value] of Object.entries(args.limits)) {
        if (!(key in limits) || !Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > limits[key as keyof SwarmLimits]) throw new SwarmError("swarm_limits", "The agent may lower the default limits, not raise them.");
        limits[key as keyof SwarmLimits] = Number(value);
      }
    }
    const goal = readGoalModeState(authority.conversationPublicId);
    if (goal?.status === "active" && goal.token_budget !== null) {
      limits.maxTokens = Math.min(limits.maxTokens, Math.max(0, goal.token_budget - goal.tokens_used));
    }
    if (typeof args.request_id !== "string" || !/^[a-zA-Z0-9:_-]{1,100}$/u.test(args.request_id)) throw new SwarmError("swarm_request_id", "Supply a stable request_id for this plan.");
    const created = store.create({ authority, requestId: args.request_id, plan: args.plan, limits,
      admission: executor => swarmAdmission(authority, executor) });
    runId = created.id;
  } else {
    const run = store.get(authority.userId, runId);
    if (run.authority.conversationId !== authority.conversationId) throw new SwarmError("swarm_scope", "This team belongs to another conversation.", 403);
    // A later turn cannot use an older team's broad roster to escape a newly
    // selected Master Agent. Read and Stop remain available for recovery.
    if (!["status", "stop", "pause"].includes(String(action)) && store.snapshot(authority.userId, runId).tasks.some(task =>
      task.executor.kind === "runtime" && !unifiedWorkflowSelectionAllows(authority.workflowSelection, task.executor.id))) throw new SwarmError("swarm_scope", "The current Master Agent cannot advance that team's roster.", 403);
    if (action === "verify") store.verify(authority.userId, runId, String(args.task_key ?? ""), args.checks as SwarmVerification[]);
    else if (action === "retry") store.retry(authority.userId, runId, String(args.task_key ?? ""), String(args.brief ?? ""));
    else if (action === "pause" || action === "resume" || action === "stop") store.control(authority.userId, runId, action === "stop" ? "cancel" : action);
    else if (action !== "status") throw new SwarmError("swarm_action", "Choose start, status, verify, retry, pause, resume or stop.");
  }
  const { wakeSwarm } = await import("./pump.ts");
  wakeSwarm(authority.userId, runId);
  return { ok: true, data: store.snapshot(authority.userId, runId), guidance: swarmToolGuidance(authority.userId, "execution") };
}
