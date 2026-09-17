import { NextResponse } from 'next/server';
import {
  GardenFilesystemError,
  createGardenFolder,
  copyGardenFolder,
  listGardenFolders,
  deleteGardenFolder,
  moveGardenDocument,
  renameGardenFolder,
} from '@/lib/garden-filesystem';
import { isGardenMutationBusyError } from '@/lib/garden-mutation-lease';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
  if (isGardenMutationBusyError(error)) {
    return json(
      {
        error: error.message,
        code: error.code,
        retryable: true,
        retryAfterMs: 2_000,
      },
      { status: error.status, headers: { 'Retry-After': '2' } },
    );
  }
  return routeErrorResponse(error);
}

// Empty folders must remain visible even while the static site is rebuilding.
export async function GET(request: Request): Promise<NextResponse> {
  const context = await getContext(new URL(request.url).searchParams.get('clusterSlug'));
  if ('error' in context) return context.error;
  try {
    return json({ folders: listGardenFolders(context.clusterSlug) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}

// Create an empty folder or copy an existing folder to a unique sibling.
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  try {
    if (body.action !== undefined && body.action !== 'copy') {
      throw new GardenFilesystemError('Unknown folder action', 400);
    }
    const result = await (body.action === 'copy' ? copyGardenFolder : createGardenFolder)({
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
