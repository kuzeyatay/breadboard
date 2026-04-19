import { NextResponse } from 'next/server';
import { recordClusterView } from '@/app/actions/clusters';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ clusterSlug: string }> },
) {
  try {
    const { clusterSlug } = await params;
    const { userId, cluster } = await requireReadableClusterFromSlug(clusterSlug);

    if (cluster.visibility === 'public' && cluster.user_id !== userId) {
      await recordClusterView(userId, clusterSlug);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
