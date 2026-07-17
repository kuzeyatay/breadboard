import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { listClusterFolders, normalizeTopicTags, refreshClusterIndex, scanClusterKnowledge, slugify } from '@/lib/knowledge';
import { INTERNAL_CONCEPT_TYPE, isLegacySubtopicRelPath, readingOrderRank } from '@/lib/learning-garden';
import { publishQuartzAfterMutation } from '@/lib/quartz-publish';
import { requireOwnedClusterFromSlug, requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clusterSlug = searchParams.get('clusterSlug');
    const includeInternalConcepts =
      searchParams.get('includeInternalConcepts') === 'true' ||
      searchParams.get('includeInternalConcepts') === '1';

    if (!clusterSlug) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }

    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
    const linkCountBySlug = new Map<string, number>();
    for (const edge of knowledge.edges) {
      linkCountBySlug.set(
        edge.source,
        (linkCountBySlug.get(edge.source) ?? 0) + 1,
      );
      linkCountBySlug.set(
        edge.target,
        (linkCountBySlug.get(edge.target) ?? 0) + 1,
      );
    }

    const documents = knowledge.nodes
      .filter(
        (node) =>
          includeInternalConcepts ||
          (node.type !== INTERNAL_CONCEPT_TYPE && !isLegacySubtopicRelPath(node.relPath)),
      )
      .map((node) => ({
        id: node.id,
        slug: node.slug,
        fileName: node.fileName,
        folder: node.folder,
        relPath: node.relPath,
        title: node.title,
        description: node.description,
        type: node.type,
        sourceType: node.sourceType,
        sourceFile: node.sourceFile,
        sourcePdf: node.sourcePdf,
        sourceDocument: node.sourceDocument,
        flagColor: node.flagColor,
        locations: node.locations,
        tags: node.tags,
        date: node.date,
        wordCount: node.wordCount,
        excerpt: node.excerpt,
        name: node.title,
        linkCount: linkCountBySlug.get(node.slug) ?? 0,
      }))
      .sort((a, b) => {
        const typeRank = (type: string) =>
          type === 'source-document' ? 0 : type === 'topic-overview' || type === 'learning-map' || type === 'source-map' || type === 'scope-contract' ? 1 : type === 'textbook-page' ? 2 : type === INTERNAL_CONCEPT_TYPE ? 9 : 5;
        const typeDiff = typeRank(a.type) - typeRank(b.type);
        if (typeDiff !== 0) return typeDiff;
        const readingDiff = readingOrderRank(a.relPath, a.type) - readingOrderRank(b.relPath, b.type);
        if (readingDiff !== 0) return readingDiff;
        const dateDiff = Date.parse(b.date) - Date.parse(a.date);
        return dateDiff || a.title.localeCompare(b.title);
      });

    const folders = listClusterFolders(path.join(contentPath, cluster.slug)).filter(
      (folder) =>
        includeInternalConcepts ||
        (!folder.toLowerCase().startsWith('internal/') &&
          !isLegacySubtopicRelPath(`${folder}/placeholder.md`)),
    );

    // Derived live from the filesystem — must never be cached, or added/removed
    // folders and pages appear stale in the client until a hard refresh.
    return NextResponse.json(
      { documents, folders, stats: knowledge.stats },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { clusterSlug, title, content, folder, tags } = body;

    if (typeof clusterSlug !== 'string' || !clusterSlug.trim()) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }
    if (typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    if (
      tags !== undefined &&
      (!Array.isArray(tags) || tags.some((tag: unknown) => typeof tag !== 'string'))
    ) {
      return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 });
    }

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const clusterDir = path.resolve(contentPath, cluster.slug);

    // Optional target sub-folder (slugified, kept inside the cluster directory).
    const relFolder =
      typeof folder === 'string'
        ? folder
            .replace(/\\/g, '/')
            .split('/')
            .map((segment) => segment.trim())
            .filter((segment) => segment && segment !== '.' && segment !== '..')
            .map((segment) => slugify(segment))
            .filter(Boolean)
            .join('/')
        : '';
    const targetDir = path.resolve(clusterDir, relFolder);
    if (targetDir !== clusterDir && !targetDir.startsWith(clusterDir + path.sep)) {
      return NextResponse.json({ error: 'Invalid folder path' }, { status: 400 });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    const baseSlug = slugify(title.trim());
    const timestamp = Date.now();
    const slug = `${baseSlug}-${timestamp}`;
    const date = new Date().toISOString();

    const body_ = content.trim() ? content : `## ${title.trim()}\n\n`;
    const normalizedTags = Array.isArray(tags)
      ? normalizeTopicTags(
          tags.map((tag: string) => tag.trim()).filter(Boolean),
          body_,
          5,
          `${title.trim()}\n${body_}`,
        )
      : [];
    const semanticHintsLine =
      normalizedTags.length > 0
        ? `semanticHints: [${normalizedTags.map((tag) => JSON.stringify(tag)).join(', ')}]\n`
        : '';
    const frontmatter = `---\ntitle: ${JSON.stringify(title.trim())}\ndate: ${JSON.stringify(date)}\nsource: "user-note"\nknowledge_type: "user-note"\n${semanticHintsLine}---\n\n`;
    fs.writeFileSync(path.join(targetDir, `${slug}.md`), frontmatter + body_, 'utf-8');

    refreshClusterIndex(contentPath, cluster.slug);
    await publishQuartzAfterMutation(`create document ${cluster.slug}/${slug}`);

    return NextResponse.json({ success: true, slug, tags: normalizedTags });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
