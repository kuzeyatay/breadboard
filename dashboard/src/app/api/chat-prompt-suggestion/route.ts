import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server-auth';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { generatePromptSuggestion } from '@/lib/chat-prompt-suggestion-service';
import { SUGGESTION_MAX_MESSAGES, SUGGESTION_MAX_MESSAGE_CHARS, type PromptSuggestionMessage } from '@/lib/chat-prompt-suggestion';
import { ApiError, apiErrorResponse, readJsonBody, requireString } from '@/lib/hermes/route-helpers';

const suggestions = new Map<string, { expires: number; value: ReturnType<typeof generatePromptSuggestion> }>();

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 64 * 1024);
    const model = requireString(body.model, 'model', 128);
    if (!Array.isArray(body.messages) || body.messages.length > SUGGESTION_MAX_MESSAGES) {
      throw new ApiError(400, 'invalid_messages', 'Expected a short conversation transcript.');
    }
    const messages = body.messages.map((message: unknown): PromptSuggestionMessage => {
      if (!message || typeof message !== 'object' || !('role' in message) ||
          (message.role !== 'user' && message.role !== 'assistant') || !('content' in message)) {
        throw new ApiError(400, 'invalid_messages', 'Expected user and assistant messages.');
      }
      return { role: message.role, content: requireString(message.content, 'content', SUGGESTION_MAX_MESSAGE_CHARS) };
    });
    const { baseURL } = resolveChatmockBaseUrl(request);
    const context = {
      gardenSlug: typeof body.gardenSlug === 'string' ? body.gardenSlug.trim().slice(0, 180) || undefined : undefined,
      localDate: typeof body.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.localDate) ? body.localDate : undefined,
      localTime: typeof body.localTime === 'string' ? body.localTime.slice(0, 5) : undefined,
      timeZone: typeof body.timeZone === 'string' ? body.timeZone.slice(0, 100) : undefined,
    };
    const evidence = body.personalize === true && body.temporary !== true && body.scope !== 'public'
      ? await (await import('@/lib/recommendations/service')).recommendationEvidence(userId, context).catch(() => []) : [];
    // Reopening a chat nobody has added to asked the model for the same
    // suggestion again (about 5 s and a model call per open). One answer per
    // unchanged transcript is kept for half an hour.
    const key = createHash('sha256').update(JSON.stringify([userId, model, context.gardenSlug, context.localDate,
      body.personalize === true, messages])).digest('hex');
    const kept = suggestions.get(key);
    let pending = kept && kept.expires > Date.now() ? kept.value : undefined;
    if (!pending) {
      // Not tied to this request's abort signal: another open may be waiting on it.
      pending = generatePromptSuggestion({ userId, messages, model, baseUrl: baseURL, evidence, context });
      const entry = { expires: Date.now() + 30 * 60_000, value: pending };
      suggestions.set(key, entry);
      if (suggestions.size > 200) suggestions.delete(suggestions.keys().next().value!);
      // A failed or empty answer is not worth keeping: the next open asks again.
      const drop = () => { if (suggestions.get(key) === entry) suggestions.delete(key); };
      pending.then(value => { if (!value) drop(); }, drop);
    }
    const suggestion = await pending;
    return NextResponse.json({ suggestion }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
