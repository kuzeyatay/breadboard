import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server-auth';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { generatePdfSuggestions } from '@/lib/chat-prompt-suggestion-service';
import { keptPromptSuggestion } from '@/lib/prompt-suggestion-cache.ts';
import { apiErrorResponse, readJsonBody, requireString } from '@/lib/hermes/route-helpers';
import { requestViewedPage } from '@/lib/web-page-context';

const MAX_PAGE_TEXT = 8_000;

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 64 * 1024);
    const model = requireString(body.model, 'model', 128);
    // A web or garden page (body.browserAccess / body.page) instead of a PDF page.
    const viewed = body.browserAccess || body.page ? await requestViewedPage(body) : null;
    if ((body.browserAccess || body.page) && !viewed) return NextResponse.json({ suggestions: [] }, { headers: { 'Cache-Control': 'no-store' } });
    const kind = viewed ? 'web' as const : 'pdf' as const;
    const title = viewed?.title ?? (typeof body.title === 'string' ? body.title.slice(0, 300) : '');
    const pageNumber = Number.isInteger(body.pageNumber) ? Number(body.pageNumber) : 1;
    const pageText = viewed?.text ?? (typeof body.pageText === 'string' ? body.pageText.replace(/\s+/gu, ' ').trim().slice(0, MAX_PAGE_TEXT) : '');
    const { baseURL } = resolveChatmockBaseUrl(request);
    let learned:string[] = [];
    if (body.personalize === true && body.temporary !== true) {
      const {getHermesUserSettings}=await import("@/lib/hermes/runtime-store");
      if (getHermesUserSettings(userId).composerSwitches.personalize !== false) {
        const {learnedEvidence}=await import("@/lib/personal-context/suggestions");
        const {focusEvidence}=await import("@/lib/personal-context/rank");
        const facts=await learnedEvidence(userId,typeof body.gardenSlug==="string"?body.gardenSlug:undefined).catch(()=>[]);
        learned=focusEvidence(facts,title+" "+pageText.slice(0,350)).slice(0,2).map(item=>item.title+" — "+item.summary);
      }
    }
    // Same page text, same questions: reopening a page does not ask the model again.
    const key = createHash('sha256').update(JSON.stringify(['pdf-v2', kind, userId, model, title, pageNumber, pageText, learned])).digest('hex');
    const generate = async () => {
      const questions = await generatePdfSuggestions({ kind, title, pageNumber, pageText, model, learned, baseUrl: baseURL });
      return questions.length ? JSON.stringify(questions) : null;
    };
    const kept = body.temporary === true ? await generate() : await keptPromptSuggestion(key, generate);
    const suggestions: string[] = kept ? JSON.parse(kept) : [];
    return NextResponse.json({ suggestions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
