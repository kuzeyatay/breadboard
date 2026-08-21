// Max Research's chat identity: the slash command that activates it, and the
// plain-language phrase that does.
//
// Mirrors the other runtime agents so every one is reached the same way. The
// difference is what sits behind it: Max Research is not a research tool, it is
// the five of them run against one question and reconciled into one answer.

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
  if (!/\bmax(?:-|\s+)research\b/i.test(source)) return null;

  // Asking about the feature is not asking for it. Checked before the
  // directive forms, because "what is max research" also contains the phrase.
  if (
    /^\s*(?:what|which|who|how|why|when|where|is|are|does|do|can|could|should)\b[^?]*\bmax(?:-|\s+)research\b[^?]*\?\s*$/i.test(
      source,
    )
  ) {
    return null;
  }

  const prefix = source.match(
    /^(?:please\s+)?(?:(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)|(?:i\s+(?:want|need|would\s+like)\s+you\s+to\s+))?(?:do|perform|conduct|run|use|start|launch)?\s*(?:a\s+)?max(?:-|\s+)research\b(?:\s+(?:on|into|about|for|to))?\s*[:;,—-]?\s*/i,
  );
  if (prefix && prefix[0].trim()) {
    const rest = source.slice(prefix[0].length).trim();
    if (rest) return rest;
  }

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
 * Whether the chat host should launch a visible Max Research run.
 *
 * The same rule as Deep Research, and for the same reason. Under Super Agent
 * the model owns the turn: it decides what to delegate and it writes the answer,
 * so a surface that launched its own visible run behind that would produce two
 * turns for one request — the model's, and a card it knows nothing about.
 * Returning null here hands plain language back to the model, which reaches the
 * same agent through `agent_launch` and keeps the run inside its own turn.
 *
 * The explicit slash command still launches directly, under Super Agent or not.
 * Someone who typed the command named the agent themselves, and that is not a
 * decision to route around.
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
