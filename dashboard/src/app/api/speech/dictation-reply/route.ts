import OpenAI from 'openai';
import db from '@/lib/db';
import { requireUserId, routeErrorResponse, RouteError } from '@/lib/server-auth';
import { requireSameOrigin } from '@/lib/request-origin';
import { readJsonBody } from '@/lib/hermes/route-core';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { GLOBAL_MODEL_SENTINEL, normalizeAssistantModelId } from '@/lib/ai-models';
import { getHermesUserSettings } from '@/lib/hermes/runtime-store';
import { readVoiceAssistantPreferences } from '@/lib/speech/assistant-store';
import { DICTATION_REPLY_INSTRUCTIONS, parseDictationReply } from '@/lib/speech/dictation-reply';
import { dictationReplyStream } from '@/lib/speech/dictation-reply-stream';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const controller = new AbortController();
  try {
    const userId = await requireUserId();
    requireSameOrigin(request, 'Screen-aware dictation must come from Breadboard.');
    const body = await readJsonBody(request, 4_100_000);
    let input: ReturnType<typeof parseDictationReply>;
    try { input = parseDictationReply(body); }
    catch (error) { throw new RouteError(400, (error as Error).message); }
    // Resolve exactly the preference used by voiceRequestOptions, server-side.
    const preferences = readVoiceAssistantPreferences(db, userId);
    const model = normalizeAssistantModelId(preferences.voiceModel === GLOBAL_MODEL_SENTINEL
      ? getHermesUserSettings(userId).fallbackModel : preferences.voiceModel);
    if (!model || model === 'none' || model === 'chat') throw new RouteError(400, 'Choose a default voice model in Settings.');
    const client = new OpenAI({ baseURL: resolveChatmockBaseUrl(request).baseURL,
      apiKey: process.env.OPENAI_API_KEY || 'local', timeout: 90_000, maxRetries: 0 });
    const { text, screen } = input;
    const events = await client.responses.create({
      model, reasoning: { effort: 'low' }, stream: true, store: false, max_output_tokens: 2400,
      instructions: DICTATION_REPLY_INSTRUCTIONS,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: `Spoken request:\n${text}\n\nDestination caret: (${screen.caret.x}, ${screen.caret.y}) on a 0–1000 coordinate scale. Snapshot: ${screen.width} × ${screen.height}.` },
        { type: 'input_image', image_url: screen.dataUrl, detail: 'auto' },
      ] }],
    }, { signal: AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(90_000)]) });
    return new Response(dictationReplyStream(events, () => controller.abort()), {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) { controller.abort(); return routeErrorResponse(error); }
}
