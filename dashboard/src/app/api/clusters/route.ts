import { NextResponse } from 'next/server';
import { createCluster, getClusters } from '@/app/actions/clusters';
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: unknown; description?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Garden name is required' }, { status: 400 });
    }
    if (name.length > 120 || description.length > 2000) {
      return NextResponse.json({ error: 'Garden details are too long' }, { status: 400 });
    }
    const slug = await createCluster(name, description);
    return NextResponse.json({ slug }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
