import { renderSystemPrompt } from "../system-prompts/service.ts";
import { normalizeAssistantModelId, NO_MODEL_SENTINEL } from '../ai-models.ts';
import { normalizeChatmockBaseUrl, localChatmockBaseUrl } from '../chatmock-server.ts';
import { completeRecommendations, evidenceRecommendations, parseRecommendations, scopedRecommendationEvidence, selectRecommendations, type RecommendationContext, type RecommendationEvidence } from './types.ts';

export async function generateRecommendations(input: {
  userId?: number | null;
  evidence: readonly RecommendationEvidence[]; context: RecommendationContext;
  model: string; baseUrl?: string; signal?: AbortSignal; fetcher?: typeof fetch;
  previousPrompts?: readonly string[];
}) {
  const focused = scopedRecommendationEvidence(input.evidence, input.context);
  const groundedFallback = evidenceRecommendations(focused, input.previousPrompts, input.context);
  const fallback = completeRecommendations(groundedFallback, input.context);
  const model = normalizeAssistantModelId(input.model);
  if (!model || model === NO_MODEL_SENTINEL || !focused.length) return fallback;
  try {
    const response = await (input.fetcher ?? fetch)(`${normalizeChatmockBaseUrl(input.baseUrl) ?? localChatmockBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'local'}` },
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(input.signal ? [input.signal] : [])]),
      body: JSON.stringify({ model, stream: false, max_completion_tokens: 2200, reasoning_effort: 'low', messages: [
        { role: 'system', content: renderSystemPrompt("personal-recommendations", input.userId, {  }) },
        ...(input.context.gardenSlug ? [{ role: 'system', content: 'This is a garden chat. Every suggestion must help understand, study, improve or continue work in the selected garden, using only its supplied evidence. Garden scope is mandatory, not a preference. Do not suggest unrelated personal errands, mail, scheduling, or work in other gardens, even if mentioned in a garden chat excerpt. Return [] if no useful garden action is supported.' }] : []),
        { role: 'user', content: JSON.stringify({ context: input.context, evidence: focused, recentlyShown:input.previousPrompts?.slice(-8) ?? [] }) },
      ] }),
    });
    if (!response.ok) return fallback;
    const payload = await response.json();
    const raw = payload.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return fallback;
    const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    const suggestions = parseRecommendations(parsed, focused, 8);
    return completeRecommendations(selectRecommendations([...suggestions,...groundedFallback],focused,input.previousPrompts,input.context), input.context);
  } catch { return fallback; }
}
