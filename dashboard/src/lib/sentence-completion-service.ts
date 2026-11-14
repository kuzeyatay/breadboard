import { GLOBAL_MODEL_SENTINEL } from './ai-models.ts';
import { localChatmockBaseUrl, normalizeChatmockBaseUrl } from './chatmock-server.ts';
import type { PromptSuggestionMessage } from './chat-prompt-suggestion.ts';
import { canCompleteSentence, normalizeSentenceCompletion, sentenceCompletionContext } from './sentence-completion.ts';
import { systemPromptText } from './system-prompts/service.ts';

/** Always use Settings' background model, independently of the chat's model. */
export async function generateSentenceCompletion(input: {
  userId: number;
  draft: string;
  messages: readonly PromptSuggestionMessage[];
  baseUrl?: string;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<string | null> {
  if (!canCompleteSentence(input.draft) || input.signal?.aborted) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, input.timeoutMs ?? 8_000);
  timer.unref?.();
  try {
    const base = normalizeChatmockBaseUrl(input.baseUrl) ?? localChatmockBaseUrl();
    const response = await (input.fetcher ?? fetch)(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'local'}` },
      body: JSON.stringify({
        model: GLOBAL_MODEL_SENTINEL,
        messages: [
          { role: 'system', content: systemPromptText('sentence-completion', input.userId) },
          { role: 'user', content: JSON.stringify({
            conversation: sentenceCompletionContext(input.messages),
            draft: input.draft,
          }) },
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
    const result = JSON.parse(payload.choices?.[0]?.message?.content ?? 'null');
    return normalizeSentenceCompletion(result?.completion, input.draft);
  } catch {
    // Optional predictions must never interrupt writing or trigger a fallback model.
    return null;
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', abort);
  }
}
