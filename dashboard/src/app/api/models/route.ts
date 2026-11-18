import { NextResponse } from 'next/server';
import { mergeAssistantModels } from '@/lib/ai-models';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { scheduleSubscriptionCatalogAutoSync } from '@/lib/cliproxy/catalog-sync';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';
import { loadChatmockModelCatalog } from '@/lib/chatmock-model-catalog';

export const dynamic = 'force-dynamic';

/**
 * Models the Intelligence menu offers, each with the reasoning ("intelligence
 * mode") levels it actually honours.
 *
 * ChatMock is the authority for both discovered ChatGPT models and configured
 * providers. The runtime validates new native ids against that same catalog;
 * a fixed runtime allowlist must not hide newly available models.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();

    // Subscriptions gain models between sign-ins. Refresh their catalog in
    // the background at most every few minutes; this read is not delayed and
    // the next one shows whatever the sync found.
    scheduleSubscriptionCatalogAutoSync(request, userId);

    const { baseURL } = resolveChatmockBaseUrl(request);
    const models = await loadChatmockModelCatalog(baseURL);
    return NextResponse.json({ object: 'list', data: models });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);

    // ChatMock unreachable: fall back to the built-in ids with no advertised
    // modes, so the picker still works and the mode list simply stays empty
    // rather than offering levels nothing can honour.
    return NextResponse.json({
      object: 'list',
      data: mergeAssistantModels([]).map((id) => ({
        id,
        object: 'model',
        owned_by: 'chatmock',
        reasoning_efforts: [],
      })),
    });
  }
}
