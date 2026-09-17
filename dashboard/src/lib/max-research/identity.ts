// Max Research's chat identity: the slash command that activates it, and the
// plain-language phrase that does.
//
// Mirrors the other runtime agents so every one is reached the same way. The
// difference is what sits behind it: Max Research is not a research tool, it is
// the five of them run against one question and reconciled into one answer.

import { requestKeywords } from "../hermes/request-language.ts";

export const MAX_RESEARCH_COMMAND = "/agents:max-research";
export const MAX_RESEARCH_AGENT_ID = "max_research";
export const MAX_RESEARCH_AGENT_NAME = "Max Research";

/**
 * The question carried by an `/agents:max-research …` message, or null when the
 * message is not addressed to it. An empty string means the command was typed
 * on its own — the palette inserts the token first and the person is still
 * writing, so the caller waits rather than launching an empty run.
 */
export function taskFromMaxResearchCommand(value: string): string | null {
  const source = value.trimStart();
  const command = source.match(/^\/agents:max-research(?:\s+|$)/i);
  if (!command) return null;
  return source.slice(command[0].length).trim();
}

/**
 * Recognize "max research" as a deliberate instruction without firing on a
 * mention of it.
 *
 * Looser than the Deep Research equivalent on purpose: that one requires an
 * action verb because "deep research" is also an ordinary noun phrase someone
 * might use in conversation, while "max research" is a product name nobody says
 * by accident. What still has to be excluded is talking *about* the feature —
 * "what is max research", "how does max research work" — which is a question
 * for the assistant, not a request to spend an hour of compute.
 */
export function taskFromMaxResearchIntent(value: string): string | null {
  const source = value.trim();
  const requestedText = requestKeywords(source);
  if (!/\bmax(?:-|\s+)research\b/i.test(requestedText)) return null;

  // An explicit instruction wins over question punctuation elsewhere in the
  // request ("do max research ... I can only do two pushups?").
  const prefix = source.match(
    /^(?:please\s+)?(?:(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)|(?:i\s+(?:want|need|would\s+like)\s+you\s+to\s+))?(?:do|perform|conduct|run|use|start|launch)?\s*(?:a\s+)?max(?:-|\s+)research\b(?:\s+(?:on|into|about|for|to)\b)?\s*[:;,—-]?\s*/i,
  );
  if (prefix && prefix[0].trim()) {
    const rest = source.slice(prefix[0].length).trim();
    if (rest.replace(/[.!?]+$/u, "").trim()) return rest;
  }

  // A question ABOUT the feature is still not a launch instruction. In
  // particular, "how do I use max research?" must not spend a research run.
  if (
    /^\s*(?:what|which|who|how|why|when|where|is|are|was|were|did|does|do|can|could|should|would|will|has|have)\b[^,;—?\n]*\bmax(?:-|\s+)research\b[^?]*\??\s*$/i.test(
      source,
    )
  ) {
    return null;
  }
  if (
    /\b(?:do\s+not|don['’]?t|dont|never|avoid|skip|without|no\s+need\s+to)\s+(?:(?:do|perform|conduct|run|use|start|launch)\s+)?(?:a\s+)?max(?:-|\s+)research\s*[.!?]*$/i.test(requestedText) ||
    /^(?:please\s+)?(?:explain|describe|define|tell\s+me\s+about)\s+(?:the\s+)?max(?:-|\s+)research\s*[.!?]*$/i.test(requestedText)
  ) return null;
  const suffix = source.match(
    /(?:\s*[,;:—-]\s*|\s+)(?:please\s+)?(?:(?:do|perform|conduct|run|use|start|launch)\s+)?(?:a\s+)?max(?:-|\s+)research(?:\s+(?:on|into|about|for)\s+this)?\s*[.!?]*$/i,
  );
  if (!suffix) return null;
  const question = source
    .slice(0, suffix.index)
    .replace(/[\s,;:—-]+$/u, "")
    .trim();
  return question || null;
}

export interface MaxResearchInvocation {
  question: string;
  /** Only the canonical slash command selects the persistent composer agent. */
  selectAgent: boolean;
}

/**
 * Whether the user explicitly selected a Max Research run for this turn.
 *
 * A canonical slash command is an explicit user selection and may open the
 * visible run even in Super Agent mode. Natural language is a direct launch
 * only outside Super Agent; inside it, the host sends the turn to Super Agent,
 * which may delegate privately and keep the worker card hidden.
 */
export function maxResearchInvocation(
  value: string,
  superAgent = false,
): MaxResearchInvocation | null {
  const commandTask = taskFromMaxResearchCommand(value);
  if (commandTask !== null) return { question: commandTask, selectAgent: true };
  if (superAgent) return null;
  const intent = taskFromMaxResearchIntent(value);
  return intent === null ? null : { question: intent, selectAgent: false };
}

export function maxResearchUserMessage(question: string): string {
  const trimmed = question.trim();
  return trimmed ? `${MAX_RESEARCH_COMMAND} ${trimmed}` : MAX_RESEARCH_COMMAND;
}
