import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server-auth';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { generatePromptSuggestion } from '@/lib/chat-prompt-suggestion-service';
import { SUGGESTION_MAX_MESSAGES, SUGGESTION_MAX_MESSAGE_CHARS, type PromptSuggestionMessage } from '@/lib/chat-prompt-suggestion';
import { ApiError, apiErrorResponse, readJsonBody, requireString } from '@/lib/hermes/route-helpers';

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
    const evidence = body.personalize === true && body.temporary !== true && body.scope !== 'public'
      ? await (await import('@/lib/recommendations/service')).recommendationEvidence(userId, {
          gardenSlug: typeof body.gardenSlug === 'string' ? body.gardenSlug.slice(0, 180) : undefined,
          localDate: typeof body.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.localDate) ? body.localDate : undefined,
        }).catch(() => []) : [];
    const suggestion = await generatePromptSuggestion({ messages, model, baseUrl: baseURL, signal: request.signal, evidence });
    return NextResponse.json({ suggestion }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
