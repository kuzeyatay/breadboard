import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { organizationClusterClause } from '@/lib/organizations/store';
import { SupervisorResourceExhaustedError } from '@/lib/supervisor-control';

export class RouteError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OwnedCluster {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  visibility: 'private' | 'organization' | 'public';
  border_color: string;
  created_at: string;
  thought_topology_enabled: number;
  thought_topology_revision: number;
}

export async function requireUserId(): Promise<number> {
  const { authOptions } = await import('@/lib/auth-options');
  const session = await getServerSession(authOptions);
  const userId = Number((session?.user as { id?: string } | undefined)?.id);

  if (!Number.isFinite(userId) || userId <= 0) {
    throw new RouteError(401, 'Unauthorized');
  }

  return userId;
}

export function requireOwnedCluster(userId: number, clusterSlug: string): OwnedCluster {
  const slug = clusterSlug.trim();
  if (!slug) throw new RouteError(400, 'clusterSlug is required');

  const cluster = db
    .prepare('SELECT * FROM clusters WHERE user_id = ? AND slug = ?')
    .get(userId, slug) as OwnedCluster | undefined;

  if (!cluster) throw new RouteError(404, 'Cluster not found');
  return cluster;
}

export async function requireOwnedClusterFromSlug(clusterSlug: string): Promise<{
  userId: number;
  cluster: OwnedCluster;
}> {
  const userId = await requireUserId();
  return { userId, cluster: requireOwnedCluster(userId, clusterSlug) };
}

export function requireReadableCluster(userId: number, clusterSlug: string): OwnedCluster {
  const slug = clusterSlug.trim();
  if (!slug) throw new RouteError(400, 'clusterSlug is required');

  const cluster = db
    .prepare(
      `SELECT *
       FROM clusters c
       WHERE c.slug = ?
         AND (c.user_id = ? OR c.visibility = 'public'
              OR ${organizationClusterClause(userId, 'c')})`,
    )
    .get(slug, userId) as OwnedCluster | undefined;

  if (!cluster) throw new RouteError(404, 'Cluster not found');
  return cluster;
}

export async function requireReadableClusterFromSlug(clusterSlug: string): Promise<{
  userId: number;
  cluster: OwnedCluster;
}> {
  const userId = await requireUserId();
  return { userId, cluster: requireReadableCluster(userId, clusterSlug) };
}

/** Public Gardens remain readable without manufacturing an authenticated id. */
export async function requireReadableClusterFromSlugOrPublic(clusterSlug: string): Promise<{
  userId: number | null;
  cluster: OwnedCluster;
}> {
  const slug = clusterSlug.trim();
  if (!slug) throw new RouteError(400, 'clusterSlug is required');
  const publicCluster = db.prepare(
    "SELECT * FROM clusters WHERE slug = ? AND visibility = 'public'",
  ).get(slug) as OwnedCluster | undefined;
  if (publicCluster) return { userId: null, cluster: publicCluster };
  return requireReadableClusterFromSlug(slug);
}

export function routeErrorResponse(error: unknown): NextResponse {
  if (error instanceof SupervisorResourceExhaustedError) {
    return NextResponse.json(
      { error: error.message, ...error.result },
      { status: 503 },
    );
  }
  if (error instanceof RouteError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : 'Internal server error';

  // Errors raised deeper in the stack can still name their own status, so a
  // refused action answers with its real reason instead of a blanket 500.
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ error: message }, { status: 500 });
}
