import { NextResponse } from 'next/server';
import { externalRuntimePath as path } from '@/lib/external-runtime-path';
import { GARDEN_SUMMARY_FRESHNESS_MS, scanClusterKnowledgeCooperatively, type KnowledgeNode } from '@/lib/knowledge';
import { INTERNAL_CONCEPT_TYPE, isLegacySubtopicRelPath } from '@/lib/learning-garden';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';
import { gardenContentFingerprintAsync } from '@/lib/thought-topology/fingerprint-async';

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

/** Serialized graph answers by garden, options and content revision. */
const GRAPH_RESPONSE_CACHE_ENTRIES = 6;
const graphResponseCache: Map<string, string> =
  ((globalThis as { __breadboardKnowledgeGraphResponses?: Map<string, string> }).__breadboardKnowledgeGraphResponses ??= new Map());

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clusterSlug = searchParams.get('clusterSlug');
    const includeInternalConcepts =
      searchParams.get('includeInternalConcepts') === 'true' ||
      searchParams.get('includeInternalConcepts') === '1';
    const revisionOnly = searchParams.get('revisionOnly') === '1';
    const statsOnly = searchParams.get('statsOnly') === '1';

    if (!clusterSlug) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }

    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    // The Garden assistant shows only the counts; the whole graph was 14 MB
    // for a large garden. Counts may lag the disk by a few seconds.
    if (statsOnly) {
      const { stats } = await scanClusterKnowledgeCooperatively(contentPath, cluster.slug, {
        maxStaleMs: GARDEN_SUMMARY_FRESHNESS_MS,
      });
      return NextResponse.json(
        { stats },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    // The Learning Map polls this cheap filesystem identity while it is
    // mounted. Paths, sizes and mtimes are enough to notice a changed Garden;
    // avoid reparsing hundreds of Markdown files just to learn that nothing
    // moved. A changed identity triggers one full graph refresh in the client.
    const revision = await gardenContentFingerprintAsync(path.join(contentPath, cluster.slug));
    if (revisionOnly) {
      return NextResponse.json(
        { revision },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    // The Learning Map panel draws through the Quartz preview and shows only
    // counts; the full graph below was 14 MB for a large garden.
    if (searchParams.get('summary') === '1') {
      const knowledge = await scanClusterKnowledgeCooperatively(contentPath, cluster.slug);
      const nodeCount = knowledge.nodes.filter(
        (node) =>
          includeInternalConcepts ||
          (node.type !== INTERNAL_CONCEPT_TYPE &&
            !isLegacySubtopicRelPath(node.relPath, node.type)),
      ).length;
      return NextResponse.json(
        { revision, nodeCount, stats: knowledge.stats },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    // Each Garden open asked for the whole graph again: a full parse plus a
    // 3.2 MB JSON (0.74 s on the server's only thread for electromagnetism-1).
    // The revision above changes with any file, so its answer can be reused.
    const cacheKey = `${cluster.slug}|${includeInternalConcepts ? 1 : 0}|${revision}`;
    const cachedBody = graphResponseCache.get(cacheKey);
    if (cachedBody !== undefined) {
      graphResponseCache.delete(cacheKey);
      graphResponseCache.set(cacheKey, cachedBody);
      return new NextResponse(cachedBody, {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
      });
    }

    const knowledge = await scanClusterKnowledgeCooperatively(contentPath, cluster.slug);
    const visibleNodes = knowledge.nodes.filter(
      (node) =>
        includeInternalConcepts ||
        (node.type !== INTERNAL_CONCEPT_TYPE &&
          !isLegacySubtopicRelPath(node.relPath, node.type)),
    );
    const visibleSlugs = new Set(visibleNodes.map((node) => node.slug));
    const nodes = visibleNodes.map(publicNode);

    const body = JSON.stringify({
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
    });
    graphResponseCache.set(cacheKey, body);
    while (graphResponseCache.size > GRAPH_RESPONSE_CACHE_ENTRIES) {
      graphResponseCache.delete(graphResponseCache.keys().next().value!);
    }
    return new NextResponse(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
