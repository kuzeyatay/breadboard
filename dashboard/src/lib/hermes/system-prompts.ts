import fs from "node:fs";
import path from "node:path";
import type { HermesSurface } from "./config.ts";
import type { CapabilityDecision } from "./capability-policy.ts";
import { directModeSection } from "./direct-mode.ts";
import { metaPromptSection, metaPromptingEnabled } from "./meta-prompting.ts";
import { cogniviaSection } from "../cognivia/index.ts";
import { loopStateSection } from "../loopx/governance.ts";
import { goalModeSection, type GoalModeState } from "../goal-mode.ts";
import { repositoryRoot } from "../runtime-paths.ts";

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
  return readSystemPrompt("response-style");
}

function surfacePrompt(surface: HermesSurface): string {
  if (surface === "garden_chat") return readSystemPrompt("garden-assistant");
  if (surface === "quartz_ai") return readSystemPrompt("quartz-assistant");
  return readSystemPrompt("main-assistant");
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
   * Direct mode when the message was sent. `adhdMode` remains the transport
   * key for compatibility with clients that were already open during rename.
   */
  adhdMode?: boolean;
  /** Goal-compatible state selected for this one conversation turn. */
  goalMode?: GoalModeState | null;
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
  // The image-results display contract ships whenever image_search is on the
  // turn: the fenced-block shape is Breadboard's own convention, so without
  // this section the model has only the tool description to learn it from.
  if (decision.allowedTools.includes("image_search")) {
    sections.push(readSystemPrompt("image-results"));
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
  const goalMode = goalModeSection(input.goalMode ?? null);
  if (goalMode) sections.push(goalMode);
  if (input.additional?.trim()) sections.push(input.additional.trim());
  // Persona overlays are deliberately last and explicitly subordinate. They
  // can shape voice and approach, but never the server-authored sections above.
  if (input.persona?.trim()) sections.push(input.persona.trim());
  return sections.join("\n\n");
}
