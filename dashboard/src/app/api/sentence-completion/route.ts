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
    let learned: string[] = [];
    const eligible = body.personalize === true && body.temporary !== true && body.scope !== "public" &&
      (await import("@/lib/hermes/runtime-store")).getHermesUserSettings(userId).composerSwitches.personalize !== false;
    if (typeof body.roomId === "string" && eligible) {
      const {roomLessons} = await import("@/lib/personal-context/room");
      const {default:db} = await import("@/lib/db");
      learned = roomLessons(db,userId,body.roomId,Number.isSafeInteger(body.threadId)?Number(body.threadId):null,draft).map(item=>item.title);
    } else if (body.roomId === undefined && eligible) {
        const { learnedEvidence,selectionLessons } = await import("@/lib/personal-context/suggestions");
        const { rankContext,focusEvidence } = await import("@/lib/personal-context/rank");
        const pageTitle=typeof body.pageTitle==="string"?body.pageTitle.trim().slice(0,180):"";
        const evidence = await (typeof body.documentConversationId==="string"?selectionLessons(userId,body.documentConversationId,pageTitle+" "+draft):
          learnedEvidence(userId,typeof body.gardenSlug==="string"?body.gardenSlug:undefined)).catch(()=>[]);
        learned = rankContext(draft+" "+pageTitle,focusEvidence(evidence,pageTitle).map(e=>({source:"pattern",title:e.title,detail:e.summary,ref:e.id,at:0})),Date.now(),3)
          .map(hit=>hit.title+" — "+hit.detail);
    }
    const { requestViewedPage } = await import("@/lib/web-page-context");
    const page = await requestViewedPage(body);
    const completion = await generateSentenceCompletion({ userId, draft, messages, learned, page, baseUrl: baseURL, signal: request.signal });
    const context: string[] = [];
    if (page) context.push(`the open page “${page.title}”`);
    if (messages.length) context.push('recent messages in this chat');
    if (learned.length) context.push(body.roomId ? 'saved context from this room' : 'relevant saved context');
    const reason = context.length
      ? `This continues your draft. Available context included ${new Intl.ListFormat('en').format(context)}.`
      : 'This completes the sentence you started typing.';
    return NextResponse.json({ completion, ...(completion ? { reason } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
