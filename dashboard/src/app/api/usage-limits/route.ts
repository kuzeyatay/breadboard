import { NextResponse } from 'next/server';
import { requireUserId, RouteError, routeErrorResponse } from '@/lib/server-auth';
import { readUsageLimits } from '@/lib/usage-limits';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

export async function GET() {
  try {
    await requireUserId();
    return NextResponse.json(readUsageLimits(), { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return NextResponse.json({ available: false }, { headers: NO_STORE_HEADERS });
  }
}
