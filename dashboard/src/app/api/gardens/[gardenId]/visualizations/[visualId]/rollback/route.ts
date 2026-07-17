import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { resolveClusterNoteFile } from '@/lib/knowledge';
import { publishQuartzAfterMutation } from '@/lib/quartz-publish';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';
import {
  findGeneratedVisualBlockById,
  loadGeneratedVisualManifest,
  replaceGeneratedVisualBlock,
  rollbackGeneratedVisualization,
} from '@/lib/generated-visuals';
import { appendGardenEvent, listGardenMarkdownFiles } from '@/lib/visuals';

export const dynamic = 'force-dynamic';

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const url = new URL(origin);
    const allowed =
      /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0)$/i.test(url.hostname) || /^garden\./i.test(url.hostname);
    if (allowed) {
      return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      };
    }
  } catch {
    // Unknown origins receive no CORS permission.
  }
  return {};
}

export async function OPTIONS(request: Request): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string; visualId: string }> },
) {
  const headers = corsHeaders(request);
  try {
    const { gardenId, visualId } = await params;
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500, headers });
    }
    const body = await request.json().catch(() => ({}));
    const pageSlug = typeof body.pageSlug === 'string' ? body.pageSlug.trim() : '';
    const gardenDir = path.join(contentPath, cluster.slug);

    let filePath: string | null = null;
    let content = '';
    let block: ReturnType<typeof findGeneratedVisualBlockById> = null;
    if (pageSlug) {
      const resolved = resolveClusterNoteFile(contentPath, cluster.slug, pageSlug);
      if (resolved && fs.existsSync(resolved.filePath)) {
        const candidate = fs.readFileSync(resolved.filePath, 'utf-8');
        const found = findGeneratedVisualBlockById(candidate, visualId);
        if (found) {
          filePath = resolved.filePath;
          content = candidate;
          block = found;
        }
      }
    }
    if (!filePath) {
      for (const candidatePath of listGardenMarkdownFiles(contentPath, cluster.slug)) {
        const candidate = fs.readFileSync(candidatePath, 'utf-8');
        if (!candidate.includes(visualId)) continue;
        const found = findGeneratedVisualBlockById(candidate, visualId);
        if (found) {
          filePath = candidatePath;
          content = candidate;
          block = found;
          break;
        }
      }
    }
    if (!filePath || !block) {
      return NextResponse.json({ error: `Generated visual ${visualId} was not found` }, { status: 404, headers });
    }
    const requestedCurrentVersion = Number(body.currentVersion ?? block.version);
    if (requestedCurrentVersion !== block.version) {
      return NextResponse.json(
        { error: `Visualization changed from v${requestedCurrentVersion} to v${block.version}; reload before restoring.` },
        { status: 409, headers },
      );
    }
    const currentManifest = loadGeneratedVisualManifest(gardenDir, visualId, block.version);
    const targetVersion = Number(body.version ?? currentManifest?.previousVersion ?? 0);
    if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion === block.version) {
      return NextResponse.json({ error: 'No valid previous visualization version was selected.' }, { status: 400, headers });
    }

    const restored = rollbackGeneratedVisualization({ gardenDir, id: visualId, version: targetVersion });
    const nextContent = replaceGeneratedVisualBlock(content, block, visualId, targetVersion);
    const temporaryPath = `${filePath}.visual-${process.pid}-${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, nextContent, 'utf-8');
      fs.renameSync(temporaryPath, filePath);
      await publishQuartzAfterMutation(`rollback generated visual ${visualId} in ${cluster.slug}`);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      rollbackGeneratedVisualization({ gardenDir, id: visualId, version: block.version });
      throw error;
    }
    appendGardenEvent(contentPath, cluster.slug, 'visualization_rolled_back', {
      visualId,
      pageId: path.relative(gardenDir, filePath).replace(/\\/g, '/').replace(/\.md$/i, ''),
      oldVersion: block.version,
      restoredVersion: restored.version,
      sourceAnchors: restored.sourceAnchorIds,
    });
    return NextResponse.json({ success: true, visual: restored }, { headers });
  } catch (error) {
    const response = routeErrorResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
