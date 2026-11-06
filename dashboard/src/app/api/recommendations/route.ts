import { requireUserId } from '@/lib/server-auth';
import { apiErrorResponse, readJsonBody } from '@/lib/hermes/route-helpers';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { recommendationsForUser } from '@/lib/recommendations/service';
import { cleanRecommendationText } from '@/lib/recommendations/types';

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
    }, { baseUrl: resolveChatmockBaseUrl(request).baseURL, refresh: body.refresh === true });
    return Response.json({ recommendations }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiErrorResponse(error); }
}
