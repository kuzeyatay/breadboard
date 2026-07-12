import { NextResponse } from 'next/server';
import { DEFAULT_ASSISTANT_MODELS, mergeAssistantModels } from '@/lib/ai-models';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUserId();
    const { baseURL } = resolveChatmockBaseUrl(request);
    const base = baseURL.replace(/\/v1\/?$/, '');
    const res = await fetch(`${base}/v1/models`, { cache: 'no-store' });
    const data = await res.json();
    const models = Array.isArray(data?.data) ? data.data : [];
    return NextResponse.json({
      ...data,
      object: data?.object ?? 'list',
      data: [
        ...DEFAULT_ASSISTANT_MODELS.map((id) => ({
          id,
          object: 'model',
          owned_by: 'chatmock',
        })),
        ...models.filter(
          (item: { id?: unknown }) =>
            typeof item?.id !== 'string' || !DEFAULT_ASSISTANT_MODELS.includes(item.id),
        ),
      ],
    });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);

    return NextResponse.json({
      object: 'list',
      data: mergeAssistantModels([]).map((id) => ({
        id,
        object: 'model',
        owned_by: 'chatmock',
      })),
    });
  }
}
