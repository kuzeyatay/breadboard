import { NextResponse } from 'next/server';
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
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);

    return NextResponse.json({
      object: 'list',
      data: [{ id: 'gpt-5.4', object: 'model', owned_by: 'owner' }],
    });
  }
}
