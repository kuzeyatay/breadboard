import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
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

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    let files: string[] = [];
    if (slug) {
      const resolved = resolveClusterNoteFile(contentPath, cluster.slug, slug);
      if (!resolved || !fs.existsSync(resolved.filePath)) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      files = [resolved.filePath];
    } else {
      files = listGardenMarkdownFiles(contentPath, cluster.slug).filter((filePath) => {
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
    const clusterDir = path.join(contentPath, cluster.slug);
    const pages: Array<{ slug: string; converted: number; failed: number }> = [];
    let totalConverted = 0;

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

      const result = await migrateVisualPlaceholders(client, model, markdown, {
        gardenId: cluster.slug,
        pageId: pageSlug,
      });

      if (result.generatedVisualSpecs.length > 0) {
        fs.writeFileSync(filePath, result.markdownWithVisualBlocks, 'utf-8');
        for (const spec of result.generatedVisualSpecs) {
          saveVisualSpec(contentPath, cluster.slug, spec, pageSlug);
          recordVisualCreated(contentPath, cluster.slug, spec, pageSlug);
        }
        totalConverted += result.generatedVisualSpecs.length;
      }
      for (const failure of result.failures) {
        appendGardenEvent(contentPath, cluster.slug, 'visualization_failed', {
          pageId: pageSlug,
          placeholderText: failure.placeholder,
          error: failure.errors.join('; ') || 'generation failed',
        });
      }
      pages.push({
        slug: pageSlug,
        converted: result.generatedVisualSpecs.length,
        failed: result.failures.length,
      });
    }

    if (totalConverted > 0) {
      await publishQuartzAfterMutation(`migrate visual placeholders in ${cluster.slug}`);
    }

    return NextResponse.json({
      success: true,
      converted: totalConverted,
      pages,
      ...(skipped > 0 ? { skippedPages: skipped, note: 'Run again to migrate remaining pages.' } : {}),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
