import fs from "node:fs";
import path from "node:path";
import type { HermesSurface } from "./config.ts";
import type { CapabilityDecision } from "./capability-policy.ts";
import { directModeSection } from "./direct-mode.ts";
import { evidenceCalibrationSection } from "./evidence-calibration.ts";
import { metaPromptSection, metaPromptingEnabled } from "./meta-prompting.ts";
import { cogniviaSection } from "../cognivia/index.ts";
import { loopStateSection } from "../loopx/governance.ts";
import { goalModeSection, type GoalModeState } from "../goal-mode.ts";
import { answerDepthSection } from "./answer-depth.ts";
import { classifyResearch } from "../research/classify.ts";
import { researchAnswerContract } from "../research/directive.ts";
import { repositoryRoot } from "../runtime-paths.ts";
import { unlazySystemSection } from "./unlazy.ts";
import { CONVERSATION_REFERENCE_POLICY } from "../conversations/message-context.ts";
import { boundPromptContext, COMPOSED_SYSTEM_PROMPT_LIMIT } from "./prompt-budget.ts";

function readSystemPrompt(name: string): string {
  const file = path.join(
    repositoryRoot(),
    "hermes-config",
    "system",
    `${name}.md`,
  );
  return fs.readFileSync(file, "utf8").trim();
}

/**
 * Prose-first formatting and the minimal-background rule. Kept in its own file
 * because the non-Hermes chat routes (`/api/chat`, `/api/knowledge-chat`) build
 * their own system prompts and must answer in the same voice.
 */
export function responseStylePrompt(): string {
  return [readSystemPrompt("response-style"), CONVERSATION_REFERENCE_POLICY].join("\n\n");
}

/**
 * Last-mile comprehension gate for human-facing answers. Unlike the baseline
 * style, this is deliberately appended after task context and personas so a
 * jargon-heavy source or specialist role cannot raise the knowledge level.
 */
export function readerComprehensionPrompt(): string {
  return readSystemPrompt("reader-comprehension");
}

function surfacePrompt(surface: HermesSurface): string {
  if (surface === "garden_chat") return readSystemPrompt("garden-assistant");
  if (surface === "quartz_ai") return readSystemPrompt("quartz-assistant");
  return readSystemPrompt("main-assistant");
}

/**
 * Whether the material on this turn arrived already cited.
 *
 * A delegated research run hands its report back with `[S1]`-style markers and
 * a source registry. That turn calls no web tool, so nothing about its
 * capabilities says it is answering from sources — the citations in front of it
 * are the only signal, and they are a sufficient one.
 */
function carriesCitations(text: string): boolean {
  return /\[S\d+\]/.test(text);
}

export function composeHermesSystemPrompt(input: {
  surface: HermesSurface;
  decision: CapabilityDecision;
  additional?: string;
  persona?: string;
  /**
   * The user's newest message, used only to pick this turn's meta prompt. Every
   * Hermes surface passes it; omitting it degrades to the permanent
   * `meta_prompting` discipline with no per-turn scaffold.
   */
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
  /** The goal governing this conversation, when it already holds one. */
  goalMode?: GoalModeState | null;
  /**
   * The Goal skill was selected for this turn. With no state alongside it, this
   * is the turn that starts a goal and the section tells the model to create
   * one; with state, the goal already exists and the flag changes nothing.
   */
  goalSkillSelected?: boolean;
  /**
   * Material supplied with this turn rather than written by the user: extracted
   * attachment text, a selected source document. It is scanned for values that
   * arrive with the bound they are read against, so the calibration section can
   * do that comparison in arithmetic instead of leaving it to the model.
   */
  suppliedEvidence?: string;
}): string {
  const decision = input.decision;
  const sections = [
    readSystemPrompt("assistant"),
    responseStylePrompt(),
  ];
  // Placed directly after the default style it amends, so the model reads the
  // exception while the rule it overrides is still in front of it.
  if (input.adhdMode) {
    const direct = directModeSection();
    if (direct) sections.push(direct);
  }
  sections.push(surfacePrompt(input.surface));
  if (decision.allowedTools.includes("garden_discover_sources")) {
    sections.push(readSystemPrompt("garden-sources"));
  }
  // Completion discipline is innate to Hermes rather than a slash-selected
  // capability. The skill itself keeps trivial turns lightweight, while every
  // substantial turn gets the same acceptance and verification contract on
  // Terminal, Garden Chat and Quartz.
  sections.push(unlazySystemSection());
  // Meta prompting is innate rather than opt-in: the discipline ships on every
  // surface and every capability mode. See lib/hermes/meta-prompting.ts.
  if (metaPromptingEnabled()) {
    sections.push(readSystemPrompt("meta-prompting"));
  }
  if (decision.mode === "scoped_implementation") {
    sections.push(readSystemPrompt("scoped-implementation"));
  }
  // Geographic grounding ships whenever the map tools are actually on the turn.
  // Naming tools the model cannot call is how it ends up promising a route it
  // has no way to compute, and stating the rules without the tools present
  // would be the same mistake in reverse. This is defense in depth: the
  // enforcement that does not depend on the model reading it lives in
  // lib/map/grounding.ts and in the map tools' own argument shapes.
  if (decision.allowedTools.includes("map_search")) {
    sections.push(readSystemPrompt("geographic-grounding"));
  }
  if (decision.allowedTools.includes("websearch")) {
    sections.push(readSystemPrompt("web-grounding"));
  }
  // Web grounding governs whether the turn may claim something at all. This
  // governs how a claim it is entitled to make has to be written down.
  //
  // Deliberately not gated on the web tools. A turn reporting a delegated
  // research run holds a cited report and no search tool at all, and gating on
  // `websearch` withheld the standard from the one kind of answer built
  // entirely out of sources — which is how a fully cited report came back to
  // the reader as confident, unattributed prose. Owing the standard is a
  // property of the material on the turn, not of how it was obtained.
  // Cheap: a pure function over the request text. See lib/research/.
  //
  // No request text means nothing to classify, and classifying "" would land on
  // the generic research intent, shipping the contract on a turn that is not
  // answering a question at all.
  const question = input.userText?.trim() ?? "";
  if (
    question &&
    (decision.allowedTools.includes("websearch") || carriesCitations(question))
  ) {
    const researchPlan = classifyResearch({ question });
    if (researchPlan.intent !== "simple_lookup") {
      sections.push(researchAnswerContract(researchPlan));
    }
  }
  // How deep a general question gets answered. A scoped question chose its own
  // resolution and a task request owes nobody a survey, so this ships only
  // when the newest message names a subject without scoping it, the one shape
  // where selecting the important details is the server's job rather than the
  // asker's. Cheap: a pure function over the request text.
  // See lib/hermes/answer-depth.ts.
  const answerDepth = answerDepthSection({ userText: input.userText });
  if (answerDepth) sections.push(answerDepth);
  // The image-results display contract ships whenever image_search is on the
  // turn: the fenced-block shape is Breadboard's own convention, so without
  // this section the model has only the tool description to learn it from.
  if (decision.allowedTools.includes("image_search")) {
    sections.push(readSystemPrompt("image-results"));
  }
  // Weather is a compact native resource too. The tool returns measured/model
  // data and the prompt teaches the assistant to preserve that object exactly
  // so one requested day always maps to one card.
  if (decision.allowedTools.includes("weather_forecast")) {
    sections.push(readSystemPrompt("weather-results"));
  }
  // Product results are a native resource, not prose with shopping links. The
  // tool description is intentionally self-contained, but large Hermes turns
  // can expose dozens of tools and a generic web search otherwise competes for
  // the same intent. Ship the decision boundary in the turn prompt whenever
  // the product tool is actually available. Hermes still makes the normal tool
  // choice; this section tells it which of the overlapping search tools owns a
  // shopping/recommendation request and which requests should remain ordinary
  // conversation or web research.
  if (decision.allowedTools.includes("product_search")) {
    sections.push(readSystemPrompt("product-search"));
  }
  // Past-chat lookup has its own private index and native navigation result.
  // Make the intent boundary explicit so requests such as "where was the chat
  // about Kirchhoff?" do not get answered from memory or generic search.
  if (decision.allowedTools.includes("chat_search")) {
    sections.push(readSystemPrompt("chat-search"));
  }
  // "How is the upload going?" must be answered from the job tables, not from
  // whatever the model remembers of the conversation. Ship the boundary with
  // the tool so the model reads it alongside the tool description.
  if (decision.allowedTools.includes("breadboard_process_status")) {
    sections.push(readSystemPrompt("process-status"));
  }
  sections.push(
    [
      "# server_capability_decision",
      `Mode: ${decision.mode}`,
      `Implementation required: ${decision.implementationRequired ? "yes" : "no"}`,
      `Authorized roots: ${decision.authorizedRoots.join(", ") || "none"}`,
      `Authorized path patterns: ${decision.authorizedPathPatterns.join(", ") || "none"}`,
      `Exact delete targets: ${decision.authorizedDeleteTargets?.join(", ") || "none"}`,
      `Allowed operations: ${decision.allowedOperations.join(", ") || "knowledge_work"}`,
      `Allowed command patterns: ${decision.allowedCommandPatterns.join(", ") || "none"}`,
      `Expires at: ${decision.expiresAt ?? "end of knowledge turn"}`,
      "This record is descriptive, not an invitation to request or widen authority.",
    ].join("\n"),
  );
  // The turn's structure sits after the policy record and before the evidence,
  // so the model reads context already holding the frame it will fill.
  const metaPrompt = metaPromptSection({
    userText: input.userText,
    surface: input.surface,
    decision,
  });
  if (metaPrompt) sections.push(metaPrompt);
  // How strongly the turn is allowed to state what it concludes. It ships only
  // when there is evidence to interpret or a consequential judgement to make,
  // and it carries this turn's measured values already checked against the
  // bounds their own source printed. See lib/hermes/evidence-calibration.ts.
  const calibration = evidenceCalibrationSection({
    userText: input.userText,
    suppliedEvidence: input.suppliedEvidence,
    decision,
  });
  if (calibration) sections.push(calibration);
  // A turn about the user's mental health is answered as a CBT copilot rather
  // than as a general assistant, on every surface. It sits after the turn's
  // structure because it governs the answer more tightly than the structure
  // does, and it ships only when the turn is actually about that.
  // See lib/cognivia/index.ts.
  const cognivia = cogniviaSection({ userText: input.userText });
  if (cognivia) sections.push(cognivia);
  // A governed conversation carries its loop state next: the objective and the
  // open gate frame everything in the evidence that follows. Reading it is a
  // local file read, never a call into the control plane.
  const loopState = loopStateSection(input.conversationPublicId, input.surface);
  if (loopState) sections.push(loopState);
  const goalMode = goalModeSection(input.goalMode ?? null, process.env, {
    skillSelected: input.goalSkillSelected === true,
  });
  if (goalMode) sections.push(goalMode);
  // Persona overlays are deliberately last and explicitly subordinate. They
  // can shape voice and approach, but never the server-authored sections above.
  const suffix = [boundPromptContext(input.persona?.trim() ?? "", 8_000)];
  // Final on purpose: this governs how already-decided content is explained.
  // Concise, retrieved evidence and a specialist persona may shape the
  // answer, but none may turn it back into unexplained analyst shorthand.
  suffix.push(readerComprehensionPrompt());
  const policy = sections.join("\n\n");
  const ending = suffix.filter(Boolean).join("\n\n");
  // Budget evidence after assembling policy, so a long report cannot evict
  // capability boundaries or the final response contract.
  const context = boundPromptContext(input.additional?.trim() ?? "",
    COMPOSED_SYSTEM_PROMPT_LIMIT - policy.length - ending.length - 4);
  return [policy, context, ending].filter(Boolean).join("\n\n");
}
