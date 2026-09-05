import { NextResponse } from 'next/server';
import { externalRuntimePath as path } from '@/lib/external-runtime-path';
import { scanClusterKnowledge, type KnowledgeNode } from '@/lib/knowledge';
import { INTERNAL_CONCEPT_TYPE, isLegacySubtopicRelPath } from '@/lib/learning-garden';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';
import { gardenContentFingerprint } from '@/lib/thought-topology/projection';

export const dynamic = 'force-dynamic';

function publicNode(node: KnowledgeNode) {
  return {
    id: node.id,
    slug: node.slug,
    fileName: node.fileName,
    title: node.title,
    type: node.type,
    sourceType: node.sourceType,
    sourceFile: node.sourceFile,
    sourceDocument: node.sourceDocument,
    locations: node.locations,
    sourceAnchors: node.sourceAnchors,
    tags: node.tags,
    primaryConcepts: node.primaryConcepts,
    supportingConcepts: node.supportingConcepts,
    claimIds: node.claimIds,
    date: node.date,
    wordCount: node.wordCount,
    excerpt: node.excerpt,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clusterSlug = searchParams.get('clusterSlug');
    const includeInternalConcepts =
      searchParams.get('includeInternalConcepts') === 'true' ||
      searchParams.get('includeInternalConcepts') === '1';
    const revisionOnly = searchParams.get('revisionOnly') === '1';

    if (!clusterSlug) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }

    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    // The Learning Map polls this cheap filesystem identity while it is
    // mounted. Paths, sizes and mtimes are enough to notice a changed Garden;
    // avoid reparsing hundreds of Markdown files just to learn that nothing
    // moved. A changed identity triggers one full graph refresh in the client.
    const revision = gardenContentFingerprint(path.join(contentPath, cluster.slug));
    if (revisionOnly) {
      return NextResponse.json(
        { revision },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
    const visibleNodes = knowledge.nodes.filter(
      (node) =>
        includeInternalConcepts ||
        (node.type !== INTERNAL_CONCEPT_TYPE && !isLegacySubtopicRelPath(node.relPath)),
    );
    const visibleSlugs = new Set(visibleNodes.map((node) => node.slug));
    const nodes = visibleNodes.map(publicNode);

    return NextResponse.json({
      revision,
      nodes,
      edges: knowledge.edges.filter(
        (edge) => visibleSlugs.has(edge.source) && visibleSlugs.has(edge.target),
      ),
      tree: knowledge.tree.map(({ source, topics }) => ({
        source: publicNode(source),
        topics: topics
          .filter((topic) => visibleSlugs.has(topic.slug))
          .map(publicNode),
      })),
      orphanTopics: knowledge.orphanTopics
        .filter((topic) => visibleSlugs.has(topic.slug))
        .map(publicNode),
      stats: knowledge.stats,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
