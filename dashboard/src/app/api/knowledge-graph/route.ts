import { NextResponse } from 'next/server';
import { scanClusterKnowledge, type KnowledgeNode } from '@/lib/knowledge';
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
    tags: node.tags,
    date: node.date,
    wordCount: node.wordCount,
    excerpt: node.excerpt,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clusterSlug = searchParams.get('clusterSlug');

    if (!clusterSlug) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }

    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
    const nodes = knowledge.nodes.map(publicNode);

    return NextResponse.json({
      nodes,
      edges: knowledge.edges,
      tree: knowledge.tree.map(({ source, topics }) => ({
        source: publicNode(source),
        topics: topics.map(publicNode),
      })),
      orphanTopics: knowledge.orphanTopics.map(publicNode),
      stats: knowledge.stats,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
