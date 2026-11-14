import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server-auth';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { generatePdfSuggestions } from '@/lib/chat-prompt-suggestion-service';
import { keptPromptSuggestion } from '@/lib/prompt-suggestion-cache.ts';
import { apiErrorResponse, readJsonBody, requireString } from '@/lib/hermes/route-helpers';

const MAX_PAGE_TEXT = 8_000;

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 64 * 1024);
    const model = requireString(body.model, 'model', 128);
    const title = typeof body.title === 'string' ? body.title.slice(0, 300) : '';
    const pageNumber = Number.isInteger(body.pageNumber) ? Number(body.pageNumber) : 1;
    const pageText = typeof body.pageText === 'string' ? body.pageText.replace(/\s+/gu, ' ').trim().slice(0, MAX_PAGE_TEXT) : '';
    const { baseURL } = resolveChatmockBaseUrl(request);
    // Same page text, same questions: reopening a page does not ask the model again.
    const key = createHash('sha256').update(JSON.stringify(['pdf-v1', userId, model, title, pageText])).digest('hex');
    const kept = await keptPromptSuggestion(key, async () => {
      const questions = await generatePdfSuggestions({ title, pageNumber, pageText, model, baseUrl: baseURL });
      return questions.length ? JSON.stringify(questions) : null;
    });
    const suggestions: string[] = kept ? JSON.parse(kept) : [];
    return NextResponse.json({ suggestions }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
