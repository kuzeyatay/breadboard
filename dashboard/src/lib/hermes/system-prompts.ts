import { voiceToolContract } from '../speech/voice-prompt.ts';
import { systemPromptText } from "../system-prompts/service.ts";
import type { HermesSurface } from "./config.ts";
import type { CapabilityDecision } from "./capability-policy.ts";
import { loopStateSection } from "../loopx/governance.ts";
import { goalModeSection, type GoalModeState } from "../goal-mode.ts";
import { boundPromptContext, COMPOSED_SYSTEM_PROMPT_LIMIT, HERMES_SYSTEM_PROMPT_LIMIT } from "./prompt-budget.ts";

export function chatCorePrompt(userId?: number | null): string {
  return [systemPromptText("chat-core", userId), systemPromptText("conversation-references", userId)].filter(Boolean).join("\n\n");
}

/** Shared legacy style for routes outside the normal assistant loop. */
export function responseStylePrompt(userId?: number | null): string {
  return [systemPromptText("response-style", userId), systemPromptText("conversation-references", userId)].filter(Boolean).join("\n\n");
}

export function composeHermesSystemPrompt(input: {
  userId?: number | null;
  surface: HermesSurface;
  decision: CapabilityDecision;
  additional?: string;
  persona?: string;
  /** Compatibility input; the shared chat contract does not classify requests. */
  userText?: string;
  /**
   * The conversation whose LoopX goal governs this turn. Passed by the surfaces
   * that can hold a long-running objective; omitting it composes without a
   * `loop_state` section, which is also what an ungoverned conversation gets.
   */
  conversationPublicId?: string | null;
  /**
   * Concise when the message was sent. `adhdMode` remains the transport
   * key for compatibility with clients that were already open during rename.
   */
  adhdMode?: boolean;
  /** Spoken replies keep the full agent loop, with a concise conversational style. */
  voice?: boolean;
  /** The goal governing this conversation, when it already holds one. */
  goalMode?: GoalModeState | null;
  /**
   * The Goal skill was selected for this turn. With no state alongside it, this
   * is the turn that starts a goal and the section tells the model to create
   * one; with state, the goal already exists and the flag changes nothing.
   */
  goalSkillSelected?: boolean;
  /** Compatibility input; supplied evidence belongs in the turn context. */
  suppliedEvidence?: string;
  /** Compatibility input; explanations use the shared chat instructions. */
  explanationFocus?: boolean;
  /** The existing grounding decision, not mere availability of web tools. */
  requiresWebEvidence?: boolean;
}): string {
  const decision = input.decision;
  const readSystemPrompt = (id: string) => systemPromptText(id, input.userId);
  const sections = [chatCorePrompt(input.userId)];
  const turnPolicies: string[] = [];
  // Voice keeps the unchanged capability catalog ahead of policies that vary
  // each turn. All policies still accompany every applicable submission.
  const appendTurnPolicy = (policy: string) => (input.voice ? turnPolicies : sections).push(policy);
  if (input.adhdMode) sections.push(readSystemPrompt("concise-mode"));
  const voiceSection = input.voice ? readSystemPrompt("voice-conversation") : '';
  sections.push(readSystemPrompt(input.surface === "quartz_ai" ? "quartz-surface" : "chat-surface"));
  if (decision.mode === "scoped_implementation") sections.push(readSystemPrompt("scoped-implementation"));

  // These sections describe native output formats and tool protocols. They do
  // not plan, grade or rewrite the answer. Reasoning belongs to the main turn.
  const toolContracts: Array<[string, string]> = [
    ["garden_get_page_context", "garden-page-history"],
    ["garden_discover_sources", "garden-sources"],
    ["map_search", "geographic-grounding"],
    ["image_search", "image-results"],
    ["garden_get_source_figure", "garden-image-replies"],
    ["weather_forecast", "weather-results"],
    ["product_search", "product-search"],
    ["chat_search", "chat-search"],
    ["chat_send_message", "chat-coordination"],
    ["notifications_read", "notifications"],
    ["breadboard_process_status", "process-status"],
    ["breadboard_usage", "usage-status"],
  ];
  for (const [tool, contract] of toolContracts) {
    if (decision.allowedTools.includes(tool)) sections.push(readSystemPrompt(input.voice && voiceToolContract(contract) !== undefined ? `voice-${contract}` : contract));
  }
  if (input.requiresWebEvidence && decision.allowedTools.includes("websearch")) {
    appendTurnPolicy(readSystemPrompt("web-grounding"));
  }
  const capabilityContext = [
    "# server_capability_decision",
    `Mode: ${decision.mode}`,
    `Implementation required: ${decision.implementationRequired ? "yes" : "no"}`,
    `Authorized roots: ${decision.authorizedRoots.join(", ") || "none"}`,
    `Authorized path patterns: ${decision.authorizedPathPatterns.join(", ") || "none"}`,
    `Exact delete targets: ${decision.authorizedDeleteTargets?.join(", ") || "none"}`,
    `Allowed operations: ${decision.allowedOperations.join(", ") || "knowledge_work"}`,
    `Allowed command patterns: ${decision.allowedCommandPatterns.join(", ") || "none"}`,
    `Expires at: ${decision.expiresAt ?? "end of knowledge turn"}`,
    "This record describes authority; it does not grant anything beyond the tool controls.",
  ].join("\n");
  if (!input.voice) sections.push(capabilityContext);
  const loopState = loopStateSection(input.conversationPublicId, input.surface);
  if (loopState) appendTurnPolicy(loopState);
  const goal = goalModeSection(input.goalMode ?? null, process.env, {
    skillSelected: input.goalSkillSelected === true,
    continuationPrompt: readSystemPrompt("goal-continuation"),
    budgetPrompt: readSystemPrompt("goal-budget"),
  });
  if (goal) appendTurnPolicy(goal);
  const ending = [input.persona?.trim() ?? "", readSystemPrompt(input.voice ? "voice-artifacts" : "artifact-delivery")].filter(Boolean).join("\n\n");
  const policy = sections.filter(Boolean).join("\n\n");
  const voiceAuthority = input.voice ? capabilityContext : '';
  const turnPolicy = turnPolicies.filter(Boolean).join("\n\n");
  const composedLimit = Math.min(COMPOSED_SYSTEM_PROMPT_LIMIT,
    HERMES_SYSTEM_PROMPT_LIMIT - readSystemPrompt("runtime-base").length - 8_000);
  const context = boundPromptContext(input.additional?.trim() ?? "", composedLimit - policy.length - ending.length - voiceSection.length - voiceAuthority.length - turnPolicy.length - (turnPolicy ? 10 : 8));
  // Keep the spoken-turn contract after the large optional capability catalog.
  // Available tools must not turn a conversation into unsolicited investigation.
  // Changing grant expiry must not invalidate the stable capability catalog on
  // every spoken turn. Authority remains explicit and enforced at tool calls.
  return [policy, context, turnPolicy, ending, voiceAuthority, voiceSection].filter(Boolean).join("\n\n");
}
