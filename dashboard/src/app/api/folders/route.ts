import { NextResponse } from 'next/server';
import {
  GardenFilesystemError,
  createGardenFolder,
  deleteGardenFolder,
  moveGardenDocument,
  renameGardenFolder,
} from '@/lib/garden-filesystem';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: object, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: { ...API_HEADERS, ...init?.headers },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: API_HEADERS });
}

async function getContext(clusterSlug: unknown): Promise<
  { error: NextResponse } | { clusterSlug: string; clusterId: number; userId: number }
> {
  if (typeof clusterSlug !== 'string' || !clusterSlug.trim()) {
    return { error: json({ error: 'clusterSlug is required' }, { status: 400 }) };
  }
  try {
    const { cluster, userId } = await requireOwnedClusterFromSlug(clusterSlug);
    return { clusterSlug: cluster.slug, clusterId: cluster.id, userId };
  } catch (error) {
    return { error: routeErrorResponse(error) };
  }
}

/** Structure failures carry the status the caller should see; nothing else leaks. */
function failure(error: unknown): NextResponse {
  if (error instanceof GardenFilesystemError) {
    return json({ error: error.message }, { status: error.status });
  }
  return routeErrorResponse(error);
}

// Create an (empty) folder. A placeholder `_index.md` keeps it visible in Quartz.
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  try {
    const result = await createGardenFolder({
      userId: context.userId,
      clusterSlug: context.clusterSlug,
      folder: body.folder,
    });
    return json({ success: true, ...result });
  } catch (error) {
    return failure(error);
  }
}

// Move a single note (identified by its basename slug) into `toFolder` ("" = root).
export async function PATCH(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  try {
    const result = await moveGardenDocument({
      userId: context.userId,
      clusterSlug: context.clusterSlug,
      slug: body.slug,
      toFolder: body.toFolder,
    });
    return json({ success: true, ...result });
  } catch (error) {
    return failure(error);
  }
}

// Rename a folder (keeping its parent). Notes keep their basename slug, so links
// still resolve; only the folder segment on disk and its `_index.md` title change.
export async function PUT(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  try {
    const result = await renameGardenFolder({
      userId: context.userId,
      clusterSlug: context.clusterSlug,
      folder: body.folder,
      name: body.name,
    });
    return json({ success: true, ...result });
  } catch (error) {
    return failure(error);
  }
}

// Delete a folder and every note inside it (and their generated Quartz output).
export async function DELETE(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  try {
    const result = await deleteGardenFolder({
      userId: context.userId,
      clusterSlug: context.clusterSlug,
      clusterId: context.clusterId,
      folder: body.folder,
    });
    return json({ success: true, ...result });
  } catch (error) {
    return failure(error);
  }
}
