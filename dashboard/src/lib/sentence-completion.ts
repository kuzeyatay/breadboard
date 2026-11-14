import type { PromptSuggestionMessage } from './chat-prompt-suggestion.ts';

export const COMPLETION_MAX_DRAFT_CHARS = 4_000;
export const COMPLETION_MAX_CHARS = 240;
export const COMPLETION_MAX_MESSAGES = 4;
export const COMPLETION_MAX_MESSAGE_CHARS = 1_000;

export function canCompleteSentence(draft: string): boolean {
  return draft.trim().length >= 4 && draft.length <= COMPLETION_MAX_DRAFT_CHARS &&
    /\p{L}/u.test(draft) && !/^\s*[/@]\S*$/u.test(draft);
}

/** Only the current chat's visible text; no tools, attachments or private reasoning. */
export function sentenceCompletionContext(messages: readonly PromptSuggestionMessage[]) {
  return messages.filter(message =>
    !message.modelChange && !message.internalAgentContinuation && !message.pending &&
    !message.failed && !message.interrupted && message.content.trim(),
  ).slice(-COMPLETION_MAX_MESSAGES).map(({ role, content }) => ({
    role, content: content.trim().slice(-COMPLETION_MAX_MESSAGE_CHARS),
  }));
}

/** A suffix is inserted verbatim, including a space or a partial-word ending. */
export function normalizeSentenceCompletion(value: unknown, draft: string): string | null {
  if (typeof value !== 'string') return null;
  let text = value.trimEnd();
  // Tolerate a model echoing the prefix, but never insert it twice.
  if (draft && text.startsWith(draft)) text = text.slice(draft.length);
  if (/\s$/u.test(draft)) text = text.trimStart();
  if (!text.trim() || text.length > COMPLETION_MAX_CHARS || /^(?:none|null|n\/a)$/iu.test(text.trim())) return null;
  if (/[\u0000-\u001f\u007f<>]|```/u.test(text) || /^\s*(?:[-*#]|\d+[.)]\s|(?:assistant|suggestion|completion|user):)/iu.test(text)) return null;
  return text;
}
