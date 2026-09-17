/** Past requests retain their wording and provenance, not ongoing authority. */
export interface HistoricalInstruction {
  content: string;
  sourceMessageId: number | null;
  sourceOrder: number | null;
  truncated: boolean;
}

export const INSTRUCTION_SCOPE_POLICY = [
  "# instruction_scope",
  "Prior requests to write a draft apply only to that draft. A later request to explain its subject is a new task. Do not copy the old draft format into that explanation. In particular, omit (Visual: ...) drafting placeholders unless the latest user request explicitly asks to continue or revise that draft, explicitly requests placeholders, or the user explicitly requested that format for all future answers. The word must in a prior draft request does not establish a future preference.",
  "Keep other task-specific requirements local too. Retain them when the user continues or revises the same deliverable. Apply a preference across tasks only when the user's wording establishes that scope, and respect later corrections. The user does not need to revoke each one-off instruction or reconfirm old formatting.",
  "historicalInstructions, past decisions, and currentGoal in compacted working state describe earlier work, not the active task. Use the current request and recent exchange to determine the current task. Preserve earlier subject matter and reasoning. Use original source wording to resolve scope; truncated or ambiguous records cannot establish ongoing requirements. Apply these rules to restored exact history and all memory sources. System examples and earlier assistant formatting are not user requests.",
].join("\n\n");

/** A request containing 'must' is not evidence that a decision was made. */
export function isRecordedDecision(content: string): boolean {
  return /^(?:(?:i|we)\s+(?:(?:have\s+)?(?:decided|chosen|agreed)\b|will\s+use\b)|(?:my|our|the)\s+decision\s+is\b|decision\s*:)/i.test(content.trim());
}

export function hasInstructionToPreserve(content: string): boolean {
  return /\b(?:decide|decided|must|will use|do not use|prefer|preference|i like|always|never|from now on|for future)\b/i.test(content);
}

export function historicalInstruction(
  content: string,
  source?: { id: number; order_index: number },
): HistoricalInstruction {
  const normalized = content.replace(/\s+/g, " ").trim();
  return {
    content: normalized.slice(0, 1_600),
    sourceMessageId: source?.id ?? null,
    sourceOrder: source?.order_index ?? null,
    // Old records without provenance may already have lost their qualifiers.
    truncated: !source || normalized.length > 1_600,
  };
}

export function appendHistoricalInstruction(
  entries: HistoricalInstruction[],
  entry: HistoricalInstruction,
): void {
  const existing = entries.findIndex((prior) => prior.content === entry.content);
  if (existing >= 0) entries.splice(existing, 1);
  entries.push(entry);
  if (entries.length > 12) entries.splice(0, entries.length - 12);
}
