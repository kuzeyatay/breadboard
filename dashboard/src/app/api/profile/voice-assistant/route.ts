import db from '@/lib/db';
import { requireUserId, routeErrorResponse, RouteError } from '@/lib/server-auth';
import { readJsonBody } from '@/lib/hermes/route-core';
import { requireSameOrigin } from '@/lib/request-origin';
import { parseVoiceAssistantPreferences } from '@/lib/speech/assistant-preferences';
import { readVoiceAssistantPreferences, writeVoiceAssistantPreferences } from '@/lib/speech/assistant-store';
import { getHermesUserSettings } from '@/lib/hermes/runtime-store';
import { GLOBAL_MODEL_SENTINEL } from '@/lib/ai-models';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { voiceModelWithQuotaFallback } from '@/lib/speech/voice-quota-fallback';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const preferences = readVoiceAssistantPreferences(db, userId);
    const chosen = preferences.voiceModel === GLOBAL_MODEL_SENTINEL ? getHermesUserSettings(userId).fallbackModel : preferences.voiceModel;
    const effectiveVoiceModel = await voiceModelWithQuotaFallback(chosen, resolveChatmockBaseUrl(request).baseURL);
    return Response.json({ userId: String(userId), preferences, effectiveVoiceModel }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return routeErrorResponse(error); }
}
export async function PUT(request: Request) {
  try {
    const userId = await requireUserId();
    requireSameOrigin(request, 'Use Profile to change voice assistant settings.');
    const preferences = parseVoiceAssistantPreferences(await readJsonBody(request, 2048));
    if (!preferences) throw new RouteError(400, 'Choose valid voice assistant settings.');
    return Response.json({ preferences: writeVoiceAssistantPreferences(db, userId, preferences) });
  } catch (error) { return routeErrorResponse(error); }
}
