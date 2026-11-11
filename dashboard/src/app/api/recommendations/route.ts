import { requireUserId } from '@/lib/server-auth';
import { apiErrorResponse, readJsonBody } from '@/lib/hermes/route-helpers';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { recommendationsForUser, preparedVoiceOpenersForUser } from '@/lib/recommendations/service';
import { cleanRecommendationText } from '@/lib/recommendations/types';

/** A prepared invitation is optional; voice never waits for card generation. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return Response.json({ accountId: String(userId), openers: preparedVoiceOpenersForUser(userId) },
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 8_192);
    if (body.temporary === true || body.scope === 'public' || body.personalize === false) {
      return Response.json({ recommendations: [] }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const date = cleanRecommendationText(body.localDate, 10);
    const recommendations = await recommendationsForUser(userId, {
      gardenSlug: cleanRecommendationText(body.gardenSlug, 180) || undefined,
      pageTitle: cleanRecommendationText(body.pageTitle, 180) || undefined,
      localDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      localTime: cleanRecommendationText(body.localTime, 5) || undefined,
      timeZone: cleanRecommendationText(body.timeZone, 100) || undefined,
    }, { baseUrl: resolveChatmockBaseUrl(request).baseURL, refresh: body.refresh === true });
    // The basis fingerprint is server bookkeeping and quotes the evidence.
    return Response.json({ recommendations: recommendations.map(({ basis: _basis, ...card }) => card) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiErrorResponse(error); }
}
