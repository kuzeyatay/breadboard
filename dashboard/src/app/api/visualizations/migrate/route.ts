import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { externalRuntimeFilesystem as fs } from '@/lib/external-runtime-filesystem';
import { DEFAULT_MODEL, createChatmockClient, resolveClusterNoteFile } from '@/lib/knowledge';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { publishQuartzAfterMutation } from '@/lib/quartz-publish';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';
import { findVisualPlaceholders } from '@/lib/visual-spec';
import {
  appendGardenEvent,
  listGardenMarkdownFiles,
  migrateVisualPlaceholders,
  recordVisualCreated,
  saveVisualSpec,
} from '@/lib/visuals';
import { acquireGardenLearnLease } from '@/lib/learn-atomic-promotion';
import {
  createDetachedGardenMutation,
  disposeDetachedGardenMutation,
  promoteDetachedGardenMutation,
  type DetachedGardenMutation,
} from '@/lib/garden-mutation-transaction';

export const dynamic = 'force-dynamic';

const MAX_PAGES_PER_RUN = 12;

/**
 * POST /api/visualizations/migrate
 * Body: { clusterSlug: string, slug?: string, model?: string }
 *
 * Converts legacy "[Interactive visual: ...]" bracket placeholders into real
 * breadboard-visual blocks (one garden page, or every page that still has
 * placeholders when slug is omitted, capped per run).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const clusterSlug = typeof body.clusterSlug === 'string' ? body.clusterSlug.trim() : '';
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const model =
      typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
    if (!clusterSlug) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }

    const { cluster, userId } = await requireOwnedClusterFromSlug(clusterSlug);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const gardenDir = path.join(contentPath, cluster.slug);
    const operationId = `visual-migration-${randomUUID()}`;
    const leaseResult = acquireGardenLearnLease(gardenDir, {
      gardenSlug: cluster.slug,
      jobId: operationId,
      buildId: operationId,
    });
    if (!leaseResult.acquired) {
      return NextResponse.json(
        { error: 'This garden has another active Learn or visualization operation. Try again after it finishes.' },
        { status: 409 },
      );
    }
    const lease = leaseResult.lease;
    let mutation: DetachedGardenMutation | undefined;
    try {
      mutation = createDetachedGardenMutation(gardenDir, 'visual-migration');
      const stagedContentPath = mutation.temporaryRoot;
      const clusterDir = mutation.stagingGardenDir;
      let files: string[] = [];
      if (slug) {
        const resolved = resolveClusterNoteFile(stagedContentPath, cluster.slug, slug);
        if (!resolved || !fs.existsSync(resolved.filePath)) {
          return NextResponse.json({ error: 'Document not found' }, { status: 404 });
        }
        files = [resolved.filePath];
      } else {
        files = listGardenMarkdownFiles(stagedContentPath, cluster.slug).filter((filePath) => {
          try {
            return findVisualPlaceholders(fs.readFileSync(filePath, 'utf-8')).length > 0;
          } catch {
            return false;
          }
        });
      }

      const skipped = Math.max(0, files.length - MAX_PAGES_PER_RUN);
      files = files.slice(0, MAX_PAGES_PER_RUN);

      const { baseURL } = resolveChatmockBaseUrl(request);
      const client = createChatmockClient(baseURL);
      const pages: Array<{ slug: string; converted: number; failed: number }> = [];
      let totalConverted = 0;
      let totalFailed = 0;

      for (const filePath of files) {
        const pageSlug = path
          .relative(clusterDir, filePath)
          .replace(/\\/g, '/')
          .replace(/\.md$/i, '');
        const markdown = fs.readFileSync(filePath, 'utf-8');
        if (findVisualPlaceholders(markdown).length === 0) {
          pages.push({ slug: pageSlug, converted: 0, failed: 0 });
          continue;
        }
        if (!lease.heartbeat()) {
          return NextResponse.json(
            { error: 'Visual migration lost its fenced garden lease before generation; no candidate was published.' },
            { status: 409 },
          );
        }

        const result = await migrateVisualPlaceholders(client, model, markdown, {
          gardenId: cluster.slug,
          pageId: pageSlug,
        });

        if (result.generatedVisualSpecs.length > 0) {
          fs.writeFileSync(filePath, result.markdownWithVisualBlocks, 'utf-8');
          for (const spec of result.generatedVisualSpecs) {
            saveVisualSpec(stagedContentPath, cluster.slug, spec, pageSlug);
            recordVisualCreated(stagedContentPath, cluster.slug, spec, pageSlug);
          }
          totalConverted += result.generatedVisualSpecs.length;
        }
        for (const failure of result.failures) {
          appendGardenEvent(stagedContentPath, cluster.slug, 'visualization_failed', {
            pageId: pageSlug,
            placeholderText: failure.placeholder,
            error: failure.errors.join('; ') || 'generation failed',
          });
        }
        totalFailed += result.failures.length;
        pages.push({
          slug: pageSlug,
          converted: result.generatedVisualSpecs.length,
          failed: result.failures.length,
        });
      }

      if (totalConverted > 0 || totalFailed > 0) {
        const promotion = await promoteDetachedGardenMutation({
          mutation,
          destinationGardenDir: gardenDir,
          lease,
          recoveryOwnerId: operationId,
        });
        if (!promotion.promoted) {
          return NextResponse.json(
            {
              error: 'Visual migration lost its fenced garden lease or the garden changed before commit; no candidate was published.',
              details: [promotion.reason],
            },
            { status: 409 },
          );
        }
      }

      if (totalConverted > 0) {
        await publishQuartzAfterMutation(
          `migrate visual placeholders in ${cluster.slug}`,
          { userId, gardenSlug: cluster.slug },
        );
      }

      return NextResponse.json({
        success: true,
        converted: totalConverted,
        pages,
        ...(skipped > 0 ? { skippedPages: skipped, note: 'Run again to migrate remaining pages.' } : {}),
      });
    } finally {
      disposeDetachedGardenMutation(mutation);
      lease.release();
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
