/** The visible transcript only: attachments, tools and private reasoning stay out. */
export interface PromptSuggestionMessage {
  role: 'user' | 'assistant';
  content: string;
  clientMessageId?: string;
  pending?: boolean;
  failed?: boolean;
  interrupted?: boolean;
  modelChange?: string;
  internalAgentContinuation?: boolean;
}

export const SUGGESTION_MAX_MESSAGES = 6;
export const SUGGESTION_MAX_MESSAGE_CHARS = 2_000;
export const SUGGESTION_MAX_CHARS = 240;

export function promptSuggestionContext(messages: readonly PromptSuggestionMessage[]) {
  const visible = messages.filter(message => !message.modelChange && !message.internalAgentContinuation);
  const last = visible.at(-1);
  if (!last || last.role !== 'assistant' || !last.content.trim() || last.pending || last.failed || last.interrupted) return [];
  const context = visible.filter(message => message.content.trim()).slice(-SUGGESTION_MAX_MESSAGES).map(({ role, content }) => ({
    role,
    content: content.trim().slice(-SUGGESTION_MAX_MESSAGE_CHARS),
  }));
  return context.some(message => message.role === 'user' && message.content) ? context : [];
}

export function normalizePromptSuggestion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^["“](.*)["”]$/u, '$1').trim();
  if (!text || /^(?:none|null|n\/a)$/i.test(text) || text.length > SUGGESTION_MAX_CHARS) return null;
  // Refuse lists, explanations and accidental model scaffolding instead of
  // inserting a truncated or hidden-reasoning response into someone's draft.
  if (/[\r\n<>]|```/.test(text) || /^(?:[-*#]|\d+[.)]\s|(?:assistant|suggestion|user):)/i.test(text)) return null;
  return text;
}
