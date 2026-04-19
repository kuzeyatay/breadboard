import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { refreshClusterIndex, scanClusterKnowledge, slugify } from '@/lib/knowledge';
import { requireOwnedClusterFromSlug, requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

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
    const documents = knowledge.nodes
      .map((node) => ({
        id: node.id,
        slug: node.slug,
        fileName: node.fileName,
        title: node.title,
        type: node.type,
        sourceType: node.sourceType,
        sourceFile: node.sourceFile,
        sourceDocument: node.sourceDocument,
        flagColor: node.flagColor,
        locations: node.locations,
        tags: node.tags,
        date: node.date,
        wordCount: node.wordCount,
        excerpt: node.excerpt,
        name: node.title,
        linkCount: knowledge.edges.filter((edge) => edge.source === node.slug || edge.target === node.slug).length,
      }))
      .sort((a, b) => {
        const typeRank = (type: string) => (type === 'source-document' ? 0 : type === 'knowledge-topic' ? 1 : 2);
        const typeDiff = typeRank(a.type) - typeRank(b.type);
        if (typeDiff !== 0) return typeDiff;
        const dateDiff = Date.parse(b.date) - Date.parse(a.date);
        return dateDiff || a.title.localeCompare(b.title);
      });

    return NextResponse.json({ documents, stats: knowledge.stats });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { clusterSlug, title, content } = body;

    if (typeof clusterSlug !== 'string' || !clusterSlug.trim()) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }
    if (typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const clusterDir = path.join(contentPath, cluster.slug);
    fs.mkdirSync(clusterDir, { recursive: true });

    const baseSlug = slugify(title.trim());
    const timestamp = Date.now();
    const slug = `${baseSlug}-${timestamp}`;
    const date = new Date().toISOString();

    const frontmatter = `---\ntitle: ${JSON.stringify(title.trim())}\ndate: ${JSON.stringify(date)}\nsource: "user-note"\nknowledge_type: "user-note"\n---\n\n`;
    const body_ = content.trim() ? content : `## ${title.trim()}\n\n`;
    fs.writeFileSync(path.join(clusterDir, `${slug}.md`), frontmatter + body_, 'utf-8');

    refreshClusterIndex(contentPath, cluster.slug);

    return NextResponse.json({ success: true, slug });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
