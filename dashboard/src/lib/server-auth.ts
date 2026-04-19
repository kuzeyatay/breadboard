import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth-options';
import db from '@/lib/db';

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
  visibility: 'private' | 'public';
  border_color: string;
  created_at: string;
}

export async function requireUserId(): Promise<number> {
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
       FROM clusters
       WHERE slug = ? AND (user_id = ? OR visibility = 'public')`,
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

export function routeErrorResponse(error: unknown): NextResponse {
  if (error instanceof RouteError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
