import { systemPromptText } from "./system-prompts/service.ts";
import { normalizeAssistantModelId, NO_MODEL_SENTINEL } from './ai-models.ts';
import { localChatmockBaseUrl, normalizeChatmockBaseUrl } from './chatmock-server.ts';
import { normalizePromptSuggestion, promptSuggestionContext, type PromptSuggestionMessage } from './chat-prompt-suggestion.ts';
import { parseRecommendations, scopedRecommendationEvidence, type RecommendationContext, type RecommendationEvidence } from './recommendations/types.ts';

export { PROMPT_SUGGESTION_INSTRUCTION } from "./system-prompts/feature-defaults.ts";

/** A bounded, tool-free completion; failure simply means no suggestion. */
export async function generatePromptSuggestion(input: {
  userId?: number;
  messages: readonly PromptSuggestionMessage[];
  model: unknown;
  baseUrl?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  evidence?: readonly RecommendationEvidence[];
  context?: RecommendationContext;
}): Promise<string | null> {
  const model = normalizeAssistantModelId(input.model);
  const messages = promptSuggestionContext(input.messages);
  if (!model || model === NO_MODEL_SENTINEL || messages.length === 0 || input.signal?.aborted) return null;
  const context = input.context ?? {};
  const evidence = scopedRecommendationEvidence(input.evidence ?? [], context);
  // Without permitted garden evidence there is no grounded garden follow-up.
  if (context.gardenSlug && !evidence.length) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, input.timeoutMs ?? 12_000);
  timer.unref?.();
  try {
    const base = normalizeChatmockBaseUrl(input.baseUrl) ?? localChatmockBaseUrl();
    const response = await (input.fetcher ?? fetch)(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'local'}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPromptText("prompt-suggestions", input.userId) },
          ...(context.gardenSlug ? [{ role: 'system', content: 'This conversation is inside one garden. Suggest only a follow-up that helps understand, study or improve this garden, grounded in its supplied evidence. Ignore unrelated errands, mail, scheduling and other gardens even when the transcript mentions them. Return only JSON {"prompt":"...","sourceIds":["exact garden evidence id"]}, or null if no useful garden follow-up is supported. All cited evidence must belong to the selected garden. This output format overrides the plain-text format.' }] : []),
          { role: 'user', content: `Conversation transcript (JSON):\n${JSON.stringify(messages)}${context.gardenSlug ? `\nSelected garden (JSON):\n${JSON.stringify(context.gardenSlug)}` : ''}${evidence.length ? `\nRelevant background evidence (JSON):\n${JSON.stringify(evidence.slice(0, 20))}` : ''}` },
        ],
        max_completion_tokens: 128,
        reasoning_effort: 'low',
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok || controller.signal.aborted) return null;
    const payload = await response.json();
    if (controller.signal.aborted) return null;
    const raw = payload.choices?.[0]?.message?.content;
    const suggestion = normalizePromptSuggestion(context.gardenSlug
      ? parseRecommendations([JSON.parse(raw)], evidence.slice(0, 20), 1)[0]?.prompt
      : raw);
    return suggestion && !messages.some(message => message.role === 'user' && message.content.toLowerCase() === suggestion.toLowerCase())
      ? suggestion : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}
