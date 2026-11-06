import { leadingCapabilityTokens, runtimeAgentById, type RuntimeAgentProfile } from "../hermes/capability-combinations.ts";
import { unifiedWorkflowById, type UnifiedWorkflowId } from "./unified-catalog.ts";

export interface UnifiedWorkflowSelection {
  workflowId: UnifiedWorkflowId;
  modeId: string | null;
  /** Catalog membership, not a grant of launch or tool permissions. */
  allowedAgentIds: string[];
}

export interface UnifiedWorkflowCompletedWork { agentId: string; brief: string }
export interface UnifiedWorkflowContinuation {
  selection: UnifiedWorkflowSelection;
  originClientMessageId: string;
  completedWork: UnifiedWorkflowCompletedWork[];
}

export function unifiedWorkflowBriefKey(agentId: string, brief: string): string {
  const command = runtimeAgentById(agentId)?.command.toLowerCase();
  let value = brief.trim().replace(/\s+/gu, " ").toLowerCase();
  if (command && (value === command || value.startsWith(`${command} `))) value = value.slice(command.length).trim();
  return value;
}

export function unifiedWorkflowRepeatsCompletedWork(
  completedWork: readonly UnifiedWorkflowCompletedWork[] | undefined,
  agentId: string,
  brief: string,
): boolean {
  const key = unifiedWorkflowBriefKey(agentId, brief);
  return Boolean(key) && Array.isArray(completedWork) && completedWork.some((item) =>
    item?.agentId === agentId && typeof item.brief === "string" && unifiedWorkflowBriefKey(agentId, item.brief) === key);
}

export interface ParsedUnifiedWorkflowCommand {
  workflowId: UnifiedWorkflowId;
  modeId: string | null;
  /** Other leading selectors, their order, and the complete task are retained. */
  textWithoutWorkflow: string;
  explicitAgentId: string | null;
  selection: UnifiedWorkflowSelection;
}

export class UnifiedWorkflowCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "UnifiedWorkflowCommandError";
    this.code = code;
  }
}

/** Recognize only leading command tokens. A quoted example or a token in the
 * body of a request is ordinary content and must not switch its workflow. */
export function parseUnifiedWorkflowCommand(text: string): ParsedUnifiedWorkflowCommand | null {
  const { tokens, rest } = leadingCapabilityTokens(text);
  const selectors = tokens.filter((token) => token.token.startsWith("workflows:"));
  if (!selectors.length) return null;
  const distinct = [...new Set(selectors.map((token) => token.token))];
  if (distinct.length > 1) {
    throw new UnifiedWorkflowCommandError("conflicting_workflows", "Choose one workflow and mode for this request.");
  }
  const match = /^workflows:([a-z][a-z0-9-]*)(?::([a-z][a-z0-9-]*))?$/u.exec(distinct[0]);
  const workflow = match ? unifiedWorkflowById(match[1]) : null;
  if (!workflow) {
    throw new UnifiedWorkflowCommandError("unknown_workflow", "That workflow is unavailable. Choose Code, Research, Browse, Work, Markets, Learn, Create or Design.");
  }
  const modeId = match?.[2] ?? null;
  const mode = modeId ? workflow.modes.find((item) => item.id === modeId) : null;
  if (modeId && !mode) {
    throw new UnifiedWorkflowCommandError("unknown_workflow_mode", `That ${workflow.name} mode is unavailable. Choose one of its listed modes.`);
  }
  const remaining = tokens.filter((token) => !token.token.startsWith("workflows:"));
  const agents = [...new Set(remaining.flatMap((token) => token.agent ? [token.agent.id] : []))];
  return {
    workflowId: workflow.id,
    modeId,
    textWithoutWorkflow: [...remaining.map((token) => token.raw), rest].filter(Boolean).join(" "),
    explicitAgentId: agents.length === 1 ? agents[0] : null,
    selection: {
      workflowId: workflow.id,
      modeId,
      allowedAgentIds: [...(mode?.agentIds ?? workflow.agentIds)],
    },
  };
}

/** A mode with exactly one specialist has an existing native dispatch path.
 * Multi-specialist modes keep the planner so it can select the right engine.
 * An explicit specialist is handled separately and always takes precedence. */
export function unifiedWorkflowModeAgent(text: string): RuntimeAgentProfile | null {
  const parsed = parseUnifiedWorkflowCommand(text);
  if (!parsed?.modeId || parsed.explicitAgentId) return null;
  // Do not hide an invalid selection of two specialists behind a mode.
  if (leadingCapabilityTokens(parsed.textWithoutWorkflow).tokens.some((token) => token.agent)) return null;
  const ids = parsed.selection.allowedAgentIds;
  return ids.length === 1 ? runtimeAgentById(ids[0]) : null;
}

/** Run before a chat surface's existing specialist dispatch. Explicit
 * /agents:* selection wins, even across families. A unique specialist mode
 * uses the same native picker/route as direct selection. Automatic and
 * multi-specialist modes keep their selector for authenticated planning.
 * Existing validation still rejects unsupported surfaces or attachments. */
export function normalizeUnifiedWorkflowDispatch(text: string): string {
  const parsed = parseUnifiedWorkflowCommand(text);
  if (!parsed) return text;
  if (parsed.explicitAgentId) return parsed.textWithoutWorkflow;
  const agent = unifiedWorkflowModeAgent(text);
  if (agent?.id === "formsmith" && parsed.textWithoutWorkflow) {
    throw new UnifiedWorkflowCommandError(
      "workflow_native_input_required",
      "Image to 3D uses a picture as its complete input. Send /workflows:design:image-to-3d on its own to open the image picker; keep your written instructions for a different design mode.",
    );
  }
  return agent ? [agent.command, parsed.textWithoutWorkflow].filter(Boolean).join(" ") : text;
}

export function unifiedWorkflowSelectionAllows(
  selection: UnifiedWorkflowSelection | null | undefined,
  agentId: string,
): boolean {
  if (!selection) return true;
  if (typeof selection.workflowId !== "string" ||
      (selection.modeId !== null && typeof selection.modeId !== "string")) return false;
  const workflow = unifiedWorkflowById(selection.workflowId);
  if (!workflow) return false;
  const ids = selection.modeId
    ? workflow.modes.find((mode) => mode.id === selection.modeId)?.agentIds ?? []
    : workflow.agentIds;
  // Recompute membership from the current catalog. A serialized client's
  // allowedAgentIds array is descriptive and cannot grant launch authority.
  return ids.includes(agentId);
}
