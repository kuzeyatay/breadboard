import { NextResponse } from 'next/server';
import path from 'path';
import { listClusterFolders, scanClusterKnowledge } from '@/lib/knowledge';
import { INTERNAL_CONCEPT_TYPE, isLegacySubtopicRelPath, readingOrderRank } from '@/lib/learning-garden';
import { createGardenDocument } from '@/lib/garden-documents.ts';
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

    const { cluster, userId } = await requireOwnedClusterFromSlug(clusterSlug);

    const created = await createGardenDocument({
      userId,
      clusterSlug: cluster.slug,
      title,
      content,
      folder,
      tags: Array.isArray(tags) ? tags : [],
    });

    return NextResponse.json({ success: true, ...created });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
