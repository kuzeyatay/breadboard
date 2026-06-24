import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import db from '@/lib/db';
import { refreshClusterIndex, slugify, walkClusterMarkdown } from '@/lib/knowledge';
import { publishQuartzAfterMutation } from '@/lib/quartz-publish';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, PATCH, DELETE, OPTIONS',
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

function safeClusterDir(contentPath: string, clusterSlug: string): string | null {
  const root = path.resolve(contentPath);
  const clusterDir = path.resolve(root, clusterSlug.trim());
  if (clusterDir !== root && !clusterDir.startsWith(root + path.sep)) return null;
  return clusterDir;
}

/** Slugify each path segment and strip empty/`.`/`..` so the result stays inside the cluster. */
function sanitizeFolder(folder: unknown): string {
  return String(folder ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .map((segment) => slugify(segment))
    .filter(Boolean)
    .join('/');
}

function resolveFolderDir(clusterDir: string, folder: string): string | null {
  const target = path.resolve(clusterDir, folder);
  if (target !== clusterDir && !target.startsWith(clusterDir + path.sep)) return null;
  return target;
}

function folderTitle(folder: string): string {
  const last = folder.split('/').pop() ?? folder;
  return last
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Remove stale generated Quartz output for a relative path (note or folder). */
function removePublicArtifacts(contentPath: string, clusterSlug: string, relPath: string): void {
  const publicRoot = path.resolve(contentPath, '..', 'public');
  const clusterPublicDir = path.resolve(publicRoot, clusterSlug.trim());
  if (!clusterPublicDir.startsWith(publicRoot + path.sep)) return;

  for (const target of [
    path.join(clusterPublicDir, `${relPath}.html`),
    path.join(clusterPublicDir, `${relPath}-og-image.webp`),
    path.join(clusterPublicDir, relPath),
  ]) {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(clusterPublicDir + path.sep)) continue;
    if (fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
  }
}

async function getContext(clusterSlug: unknown): Promise<
  | { error: NextResponse }
  | { clusterSlug: string; clusterId: number; clusterDir: string; contentPath: string }
> {
  if (typeof clusterSlug !== 'string' || !clusterSlug.trim()) {
    return { error: json({ error: 'clusterSlug is required' }, { status: 400 }) };
  }

  let ownedSlug: string;
  let clusterId: number;
  try {
    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);
    ownedSlug = cluster.slug;
    clusterId = cluster.id;
  } catch (error) {
    return { error: routeErrorResponse(error) };
  }

  const contentPath = process.env.QUARTZ_CONTENT_PATH;
  if (!contentPath) {
    return { error: json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 }) };
  }

  const clusterDir = safeClusterDir(contentPath, ownedSlug);
  if (!clusterDir) {
    return { error: json({ error: 'Invalid garden path' }, { status: 400 }) };
  }

  return { clusterSlug: ownedSlug, clusterId, clusterDir, contentPath };
}

// Create an (empty) folder. A placeholder `_index.md` keeps it visible in Quartz.
export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  const folder = sanitizeFolder(body.folder);
  if (!folder) return json({ error: 'folder is required' }, { status: 400 });

  const dir = resolveFolderDir(context.clusterDir, folder);
  if (!dir) return json({ error: 'Invalid folder path' }, { status: 400 });

  fs.mkdirSync(dir, { recursive: true });
  const indexPath = path.join(dir, '_index.md');
  if (!fs.existsSync(indexPath)) {
    fs.writeFileSync(
      indexPath,
      `---\ntitle: ${JSON.stringify(folderTitle(folder))}\n---\n\n`,
      'utf-8',
    );
  }

  refreshClusterIndex(context.contentPath, context.clusterSlug);
  await publishQuartzAfterMutation(`create folder ${context.clusterSlug}/${folder}`);
  return json({ success: true, folder });
}

// Move a single note (identified by its basename slug) into `toFolder` ("" = root).
export async function PATCH(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  if (typeof body.slug !== 'string' || !body.slug.trim()) {
    return json({ error: 'slug is required' }, { status: 400 });
  }

  const folder = sanitizeFolder(body.toFolder);
  const targetDir = resolveFolderDir(context.clusterDir, folder);
  if (!targetDir) return json({ error: 'Invalid folder path' }, { status: 400 });

  const wantSlug = body.slug
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.md$/i, '')
    .trim();

  const found = walkClusterMarkdown(context.clusterDir).find(
    (item) => item.entry.replace(/\.md$/i, '') === wantSlug,
  );
  if (!found) return json({ error: 'Document not found' }, { status: 404 });

  const destPath = path.join(targetDir, found.entry);
  if (path.resolve(destPath) === path.resolve(found.filePath)) {
    return json({ success: true, slug: wantSlug, folder });
  }
  if (fs.existsSync(destPath)) {
    return json(
      { error: 'A note with that name already exists in the target folder' },
      { status: 409 },
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.renameSync(found.filePath, destPath);
  removePublicArtifacts(context.contentPath, context.clusterSlug, found.relPath.replace(/\.md$/i, ''));

  const relPath = path.relative(context.clusterDir, destPath).replace(/\\/g, '/');
  refreshClusterIndex(context.contentPath, context.clusterSlug);
  await publishQuartzAfterMutation(
    `move document ${context.clusterSlug}/${wantSlug} -> ${folder || 'root'}`,
  );
  return json({ success: true, slug: wantSlug, folder, relPath });
}

// Delete a folder and every note inside it (and their generated Quartz output).
export async function DELETE(request: Request): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const context = await getContext(body.clusterSlug);
  if ('error' in context) return context.error;

  const folder = sanitizeFolder(body.folder);
  if (!folder) return json({ error: 'folder is required' }, { status: 400 });

  const dir = resolveFolderDir(context.clusterDir, folder);
  if (!dir || dir === context.clusterDir) {
    return json({ error: 'Invalid folder path' }, { status: 400 });
  }
  if (!fs.existsSync(dir)) return json({ success: true, folder, deletedSlugs: [] });

  const deletedSlugs = walkClusterMarkdown(dir).map((item) =>
    item.entry.replace(/\.md$/i, ''),
  );

  fs.rmSync(dir, { recursive: true, force: true });
  removePublicArtifacts(context.contentPath, context.clusterSlug, folder);

  if (deletedSlugs.length > 0) {
    const deleteSavedPdf = db.prepare(
      'DELETE FROM pdf_document_edits WHERE cluster_id = ? AND document_slug = ?',
    );
    for (const slug of deletedSlugs) deleteSavedPdf.run(context.clusterId, slug);
  }

  refreshClusterIndex(context.contentPath, context.clusterSlug);
  await publishQuartzAfterMutation(`delete folder ${context.clusterSlug}/${folder}`);
  return json({ success: true, folder, deletedSlugs });
}
