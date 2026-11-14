import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server-auth';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { generateSentenceCompletion } from '@/lib/sentence-completion-service';
import { COMPLETION_MAX_DRAFT_CHARS, COMPLETION_MAX_MESSAGES, COMPLETION_MAX_MESSAGE_CHARS } from '@/lib/sentence-completion';
import type { PromptSuggestionMessage } from '@/lib/chat-prompt-suggestion';
import { ApiError, apiErrorResponse, readJsonBody, requireString } from '@/lib/hermes/route-helpers';

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 64 * 1024);
    const draft = requireString(body.draft, 'draft', COMPLETION_MAX_DRAFT_CHARS);
    const transcript = body.messages ?? [];
    if (!Array.isArray(transcript) || transcript.length > COMPLETION_MAX_MESSAGES) {
      throw new ApiError(400, 'invalid_messages', 'Expected a short conversation transcript.');
    }
    const messages = transcript.map((message: unknown): PromptSuggestionMessage => {
      if (!message || typeof message !== 'object' || !('role' in message) ||
          (message.role !== 'user' && message.role !== 'assistant') || !('content' in message)) {
        throw new ApiError(400, 'invalid_messages', 'Expected user and assistant messages.');
      }
      return { role: message.role, content: requireString(message.content, 'content', COMPLETION_MAX_MESSAGE_CHARS) };
    });
    const { baseURL } = resolveChatmockBaseUrl(request);
    const completion = await generateSentenceCompletion({ userId, draft, messages, baseUrl: baseURL, signal: request.signal });
    return NextResponse.json({ completion }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
