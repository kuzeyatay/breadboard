import fs from "node:fs";
import path from "node:path";
import type { HermesSurface } from "./config.ts";
import type { CapabilityDecision } from "./capability-policy.ts";
import { directModeSection } from "./direct-mode.ts";
import { loopStateSection } from "../loopx/governance.ts";
import { goalModeSection, type GoalModeState } from "../goal-mode.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { CONVERSATION_REFERENCE_POLICY } from "../conversations/message-context.ts";
import { boundPromptContext, COMPOSED_SYSTEM_PROMPT_LIMIT } from "./prompt-budget.ts";

function readSystemPrompt(name: string): string {
  return fs.readFileSync(path.join(repositoryRoot(), "hermes-config", "system", `${name}.md`), "utf8").trim();
}

export function chatCorePrompt(): string {
  return [readSystemPrompt("chat-core"), CONVERSATION_REFERENCE_POLICY].join("\n\n");
}

/** Shared legacy style for routes outside the normal assistant loop. */
export function responseStylePrompt(): string {
  return [readSystemPrompt("response-style"), CONVERSATION_REFERENCE_POLICY].join("\n\n");
}

export function composeHermesSystemPrompt(input: {
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
  const sections = [chatCorePrompt()];
  if (input.adhdMode) sections.push(directModeSection());
  const voiceSection = input.voice ? [
    '# voice_conversation',
    'The user is speaking with Breadboard. Answer simple questions promptly and keep spoken replies concise and natural.',
    'Talk with the user rather than writing an essay to read aloud. Use everyday language, contractions and connected sentences. For an ordinary question, start with the useful answer in one to three short sentences, then leave room for a follow-up. Give more detail when asked or when needed for accuracy. Avoid headings, bullet lists, canned acknowledgments and repeated offers of more help in conversational replies.',
    'Answer from the conversation or a still-current verified result when that is enough. Greetings, clarifications and simple explanations do not need a tool call. Keep track of the latest correction and respond to it instead of restarting an earlier answer.',
    'Respond to the social or practical intent of what was said. A casual check-in is conversation, not a request for a status report about the app. Screen access and saved context are available to help when relevant; do not volunteer a screen description, unrelated memories, or a list of capabilities. Do not invent personal experiences or feelings to sound human.',
    'When an answer needs facts you do not have, current information, private context, or an action, use the supplied Breadboard tools and available skills before answering. Investigate instead of guessing or saying you cannot help while a relevant tool is available.',
    'Use tool results to finish the request. Give a brief spoken progress update when work takes time, then continue working. An acknowledgment is not completion. Claim an action succeeded only after its result confirms it; if a tool fails, explain the actual failure.',
    'Progress updates should be short, useful descriptions of actual work or new findings, suitable to say aloud. Do not narrate private reasoning, raw tool arguments, logs or every small step. Avoid repeating that you are still working. Put detailed results and artifacts in the chat and speak the useful conclusion first.',
    'Spoken input can contain recognition errors, fragments and corrections. Interpret a correction against the immediately preceding question and keep its intent; do not treat each fragment as a fresh unrelated task. Resolve references from the current conversation first. Read screen context only when the user refers to the view or it is needed for the request. If the meaning is still ambiguous, ask one short clarifying question before searching. Choose tools for the actual question: an unclear name alone is not a request to search past chats. Never invent what the user meant.',
    'Before researching an unclear referent, ask which person, product, project or organization the user means. A broad search is not a substitute for resolving that ambiguity. Once their intent is clear, proceed with the relevant tools without unnecessary questions.',
    'Ask a focused question when required information is missing. Existing permissions and tool boundaries still apply.',
  ].join('\n') : '';
  sections.push(input.surface === "quartz_ai"
    ? "You are answering on a Garden reader surface. Use its current page and highlighted passage as context. Private tools and host commands require explicit server authorization."
    : "You are in the user's signed-in Breadboard chat. Garden readers, source tools and authorized host actions are available through the supplied tools. Use them to finish requested work; let the native tool controls handle permissions.");
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
    ["notifications_read", "notifications"],
    ["breadboard_process_status", "process-status"],
  ];
  for (const [tool, contract] of toolContracts) {
    if (decision.allowedTools.includes(tool)) sections.push(readSystemPrompt(contract));
  }
  if (input.requiresWebEvidence && decision.allowedTools.includes("websearch")) {
    sections.push(readSystemPrompt("web-grounding"));
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
  if (loopState) sections.push(loopState);
  const goal = goalModeSection(input.goalMode ?? null, process.env, { skillSelected: input.goalSkillSelected === true });
  if (goal) sections.push(goal);
  const ending = [boundPromptContext(input.persona?.trim() ?? "", 8_000), readSystemPrompt("artifact-delivery")].filter(Boolean).join("\n\n");
  const policy = sections.filter(Boolean).join("\n\n");
  const voiceAuthority = input.voice ? capabilityContext : '';
  const context = boundPromptContext(input.additional?.trim() ?? "", COMPOSED_SYSTEM_PROMPT_LIMIT - policy.length - ending.length - voiceSection.length - voiceAuthority.length - 8);
  // Keep the spoken-turn contract after the large optional capability catalog.
  // Available tools must not turn a conversation into unsolicited investigation.
  // Changing grant expiry must not invalidate the stable capability catalog on
  // every spoken turn. Authority remains explicit and enforced at tool calls.
  return [policy, context, ending, voiceAuthority, voiceSection].filter(Boolean).join("\n\n");
}
