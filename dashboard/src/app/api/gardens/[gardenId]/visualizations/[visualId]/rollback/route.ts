import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { externalRuntimeFilesystem as fs } from '@/lib/external-runtime-filesystem';
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
import { acquireGardenLearnLease } from '@/lib/learn-atomic-promotion';
import { generatedVisualPublicationPointersMatch } from '@/lib/generated-visual-publication-coherence';
import {
  createDetachedGardenMutation,
  disposeDetachedGardenMutation,
  promoteDetachedGardenMutation,
  type DetachedGardenMutation,
} from '@/lib/garden-mutation-transaction';

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
    const { cluster, userId } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500, headers });
    }
    const body = await request.json().catch(() => ({}));
    const pageSlug = typeof body.pageSlug === 'string' ? body.pageSlug.trim() : '';
    const gardenDir = path.join(contentPath, cluster.slug);
    const operationId = `visual-rollback-${randomUUID()}`;
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: cluster.slug,
      jobId: operationId,
      buildId: operationId,
    });
    if (!leaseResult.acquired) {
      return NextResponse.json(
        { error: 'This garden has another active Learn or visualization operation. Try again after it finishes.' },
        { status: 409, headers },
      );
    }
    const lease = leaseResult.lease;
    let mutation: DetachedGardenMutation | undefined;
    try {
      mutation = createDetachedGardenMutation(gardenDir, 'visual-rollback');
      const stagedContentPath = mutation.temporaryRoot;
      const stagedGardenDir = mutation.stagingGardenDir;

      let filePath: string | null = null;
      let content = '';
      let block: ReturnType<typeof findGeneratedVisualBlockById> = null;
      if (pageSlug) {
        const resolved = resolveClusterNoteFile(stagedContentPath, cluster.slug, pageSlug);
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
        for (const candidatePath of listGardenMarkdownFiles(stagedContentPath, cluster.slug)) {
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
      const currentManifest = loadGeneratedVisualManifest(stagedGardenDir, visualId, block.version);
      const targetVersion = Number(body.version ?? currentManifest?.previousVersion ?? 0);
      if (!Number.isInteger(targetVersion) || targetVersion < 1 || targetVersion === block.version) {
        return NextResponse.json({ error: 'No valid previous visualization version was selected.' }, { status: 400, headers });
      }

      const restored = rollbackGeneratedVisualization({
        gardenDir: stagedGardenDir,
        id: visualId,
        version: targetVersion,
      });
      const nextContent = replaceGeneratedVisualBlock(content, block, visualId, targetVersion);
      const temporaryPath = `${filePath}.visual-${process.pid}-${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, nextContent, 'utf-8');
      fs.renameSync(temporaryPath, filePath);
      const relativePage = path
        .relative(stagedGardenDir, filePath)
        .replace(/\\/g, '/')
        .replace(/\.md$/i, '');
      appendGardenEvent(stagedContentPath, cluster.slug, 'visualization_rolled_back', {
        visualId,
        pageId: relativePage,
        oldVersion: block.version,
        restoredVersion: restored.version,
        sourceAnchors: restored.sourceAnchorIds,
      });

      const relativeMarkdownPath = path.relative(stagedGardenDir, filePath);
      const promotion = await promoteDetachedGardenMutation({
        mutation,
        destinationGardenDir: gardenDir,
        lease,
        recoveryOwnerId: operationId,
        verifyCandidate: (candidateGardenDir) => {
          try {
            const candidateBlock = findGeneratedVisualBlockById(
              fs.readFileSync(path.join(candidateGardenDir, relativeMarkdownPath), 'utf-8'),
              visualId,
            );
            return (
              candidateBlock?.version === targetVersion &&
              generatedVisualPublicationPointersMatch({
                gardenDir: candidateGardenDir,
                id: visualId,
                version: targetVersion,
                sourceHash: restored.sourceHash,
                compiledHash: restored.compiledHash,
              })
            );
          } catch {
            return false;
          }
        },
      });
      if (!promotion.promoted) {
        return NextResponse.json(
          {
            error: 'Visualization rollback lost its fenced garden lease or the garden changed before commit. The active version was not replaced.',
            details: [promotion.reason],
          },
          { status: 409, headers },
        );
      }
      await publishQuartzAfterMutation(
        `rollback generated visual ${visualId} in ${cluster.slug}`,
        { userId },
      );
      return NextResponse.json({ success: true, visual: restored }, { headers });
    } finally {
      disposeDetachedGardenMutation(mutation);
      lease.release();
    }
  } catch (error) {
    const response = routeErrorResponse(error);
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  }
}
