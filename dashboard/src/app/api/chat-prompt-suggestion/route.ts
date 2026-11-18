import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server-auth';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { generatePromptSuggestion } from '@/lib/chat-prompt-suggestion-service';
import { keptPromptSuggestion } from '@/lib/prompt-suggestion-cache.ts';
import { SUGGESTION_MAX_MESSAGES, SUGGESTION_MAX_MESSAGE_CHARS, promptSuggestionSelection, type PromptSuggestionMessage } from '@/lib/chat-prompt-suggestion';
import { ApiError, apiErrorResponse, readJsonBody, requireString } from '@/lib/hermes/route-helpers';

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 64 * 1024);
    const model = requireString(body.model, 'model', 128);
    const selection = promptSuggestionSelection(body.selection);
    if (body.selection !== undefined && !selection) {
      throw new ApiError(400, 'invalid_selection', 'Expected selected text.');
    }
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
      documentConversationId:typeof body.documentConversationId==="string"?body.documentConversationId.slice(0,160):undefined,
      pageTitle: typeof body.pageTitle === "string" ? body.pageTitle.trim().slice(0,180) || undefined : undefined,
      gardenSlug: typeof body.gardenSlug === 'string' ? body.gardenSlug.trim().slice(0, 180) || undefined : undefined,
      localDate: typeof body.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.localDate) ? body.localDate : undefined,
      localTime: typeof body.localTime === 'string' ? body.localTime.slice(0, 5) : undefined,
      timeZone: typeof body.timeZone === 'string' ? body.timeZone.slice(0, 100) : undefined,
    };
    let evidence = !selection && body.personalize === true && body.temporary !== true && body.scope !== 'public'
      ? await (await import('@/lib/recommendations/service')).recommendationEvidence(userId, context).catch(() => []) : [];
    if (selection && typeof body.conversationId === "string" && body.personalize === true && body.temporary !== true && body.scope !== "public") {
      const {getHermesUserSettings}=await import("@/lib/hermes/runtime-store");
      if (getHermesUserSettings(userId).composerSwitches.personalize !== false) {
        const {selectionLessons}=await import("@/lib/personal-context/suggestions");
        evidence=await selectionLessons(userId,body.conversationId,[selection.sourceTitle,selection.quote].filter(Boolean).join(" ")).catch(()=>[]);
      }
    }
    // Cache unchanged transcripts/excerpts; temporary chats never write a
    // suggestion to disk. Shared cached requests may have other open waiters.
    const page = selection ? null : await (await import('@/lib/web-page-context')).requestViewedPage(body);
    const key = createHash('sha256').update(JSON.stringify([userId, model, context,
      body.personalize === true, body.scope, evidence, messages, selection, page])).digest('hex');
    const generate = () => generatePromptSuggestion({ userId, messages, selection, model, baseUrl: baseURL, evidence, context, page,
      signal: body.temporary === true ? request.signal : undefined });
    const suggestion = body.temporary === true ? await generate() : await keptPromptSuggestion(key, generate);
    return NextResponse.json({ suggestion }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
