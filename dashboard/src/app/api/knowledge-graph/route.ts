import { NextResponse } from 'next/server';
import { scanClusterKnowledge, type KnowledgeNode } from '@/lib/knowledge';
import { INTERNAL_CONCEPT_TYPE, isLegacySubtopicRelPath } from '@/lib/learning-garden';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

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

    if (!clusterSlug) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }

    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
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
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
