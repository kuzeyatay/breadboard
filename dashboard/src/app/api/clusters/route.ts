import { NextResponse } from 'next/server';
import { getClusters } from '@/app/actions/clusters';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const userId = await requireUserId();
    const clusters = await getClusters(userId);
    return NextResponse.json({ clusters });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
