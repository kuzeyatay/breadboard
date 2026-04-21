import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { normalizeTopicTags, refreshClusterIndex, scanClusterKnowledge, semanticTagsFromText, slugify } from '@/lib/knowledge';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

interface GeneratedNote {
  title: string;
  slug: string;
  content: string;
  tags?: string[];
  related?: string[];
}

interface ChatMessage {
  role: string;
  content: string;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction assistant for a digital garden (Zettelkasten-style note-taking system).

Analyze the conversation and extract durable knowledge into atomic notes. Each note covers ONE distinct concept, insight, method, definition, or reusable fact.

Return ONLY a valid JSON array, with no markdown fences and no extra text. Format:
[
  {
    "title": "Concept Title",
    "slug": "concept-title",
    "tags": ["specific-subject-term"],
    "related": ["Related Concept Title"],
    "content": "## Concept Title\\n\\nMarkdown content here..."
  }
]

Requirements for each note:
- title: Clear, specific noun-phrase (e.g. "Retrieval-Augmented Generation", "Spaced Repetition")
- slug: lowercase, hyphenated, URL-safe version of title
- content: Well-structured markdown starting with ## Title, then:
  * Key definitions, facts, and insights from the conversation
  * **Bold** for important terms
  * Bullet lists for related points
  * [[wikilinks]] to connect related concepts mentioned in this conversation
  * LaTeX for formulas, symbols, or derivations when it improves clarity: inline math with $...$ and display equations with $$...$$
  * 100-300 words
- tags: 3-8 specific subject terms, formulas, methods, named concepts, or domain terms
- related: titles of notes/concepts that should be strongly connected to this note
- Never use generic tags like knowledge, generated, note, topic, source, document, chat, answer, response, general, or misc

Create 2-6 notes based on depth.
Return [] if the conversation has no durable, reusable knowledge.
Do not create notes from greetings, logistics, UI chatter, one-off requests, upload progress, or answers that only say something failed.`;

interface RelatedNote {
  slug: string;
  title: string;
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```(?:json|markdown|md)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();
}

function titleFromMarkdown(content: string): string {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/[*_`]/g, '').slice(0, 120);

  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('```'));

  return (firstLine || 'Chat note').replace(/[*_`#]/g, '').slice(0, 120);
}

function contentWithHeading(title: string, content: string): string {
  const trimmed = content.trim();
  if (/^#{1,3}\s+.+$/m.test(trimmed)) return trimmed;
  return `## ${title}\n\n${trimmed}`;
}

function latestAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'assistant' && message.content.trim());
}

function yamlQuote(value: string): string {
  return JSON.stringify(value.replace(/\r/g, ''));
}

function yamlArray(values: string[]): string {
  return `[${values.map((value) => yamlQuote(value)).join(', ')}]`;
}

function frontmatter(values: Record<string, string | string[]>): string {
  const lines = Object.entries(values).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: ${yamlArray(value)}`;
    return `${key}: ${yamlQuote(value)}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n`;
}

function wikilink(slug: string, label: string): string {
  return `[[${slug}|${label}]]`;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((word) => word.trim())
      .filter((word) => word.length > 2),
  );
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) {
    if (right.has(item)) intersection += 1;
  }
  return intersection / Math.max(left.size, right.size);
}

function findRelatedNotes({
  contentPath,
  clusterSlug,
  title,
  content,
  tags,
  relatedTitles = [],
  excludeSlugs = [],
}: {
  contentPath: string;
  clusterSlug: string;
  title: string;
  content: string;
  tags: string[];
  relatedTitles?: string[];
  excludeSlugs?: string[];
}): RelatedNote[] {
  const exclude = new Set(excludeSlugs);
  const queryTokens = tokenSet(`${title}\n${content}\n${tags.join(' ')}`);
  const tagSet = new Set(tags);
  const requested = new Set(relatedTitles.map(slugify));

  return scanClusterKnowledge(contentPath, clusterSlug)
    .nodes
    .filter((node) => !exclude.has(node.slug) && node.type !== 'source-document' && node.type !== 'cluster-index')
    .map((node) => {
      const nodeTags = new Set(node.tags);
      const sharedTags = [...tagSet].filter((tag) => nodeTags.has(tag)).length;
      const requestedMatch = requested.has(slugify(node.title)) || requested.has(node.slug) ? 0.5 : 0;
      const titleOverlap = overlapScore(tokenSet(title), tokenSet(node.title));
      const contentOverlap = overlapScore(queryTokens, tokenSet(`${node.title}\n${node.excerpt}\n${node.tags.join(' ')}`));
      return {
        node,
        score: requestedMatch + sharedTags * 0.32 + titleOverlap * 0.35 + contentOverlap * 0.3,
      };
    })
    .filter(({ score }) => score >= 0.18)
    .sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title))
    .slice(0, 6)
    .map(({ node }) => ({ slug: node.slug, title: node.title }));
}

function buildNoteBody(title: string, content: string, related: RelatedNote[]): string {
  const relatedSection = related.length > 0
    ? `\n\n## Related notes\n\n${related.map((note) => `- ${wikilink(note.slug, note.title)}`).join('\n')}\n`
    : '';
  return `${contentWithHeading(title, content).trim()}${relatedSection}`;
}

export async function POST(request: Request) {
  try {
    const { baseURL } = resolveChatmockBaseUrl(request);
    const { clusterSlug, messages, model, mode } = await request.json();

    if (typeof clusterSlug !== 'string' || !clusterSlug.trim()) {
      return NextResponse.json({ error: 'clusterSlug is required' }, { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages are required' }, { status: 400 });
    }

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);
    const normalizedClusterSlug = cluster.slug;

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const clusterDir = path.join(contentPath, normalizedClusterSlug);
    fs.mkdirSync(clusterDir, { recursive: true });
    const timestamp = Date.now();
    const date = new Date().toISOString();

    if (mode === 'chat-note') {
      const sourceMessage = latestAssistantMessage(messages as ChatMessage[]);
      const sourceContent = sourceMessage?.content.trim() ?? '';
      if (!sourceContent) {
        return NextResponse.json({ success: true, notes: [] });
      }

      const title = titleFromMarkdown(sourceContent);
      const finalSlug = `${slugify(title)}-${timestamp}`;
      const tags = normalizeTopicTags(
        semanticTagsFromText(`${title}\n${sourceContent}`, 8),
        sourceContent,
        8,
      );
      const related = findRelatedNotes({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        title,
        content: sourceContent,
        tags,
        excludeSlugs: [finalSlug],
      });

      fs.writeFileSync(
        path.join(clusterDir, `${finalSlug}.md`),
        frontmatter({
          title,
          date,
          source: 'generated-chat',
          knowledge_type: 'generated-note',
          generated_by: 'chatmock',
          related: related.map((note) => note.slug),
          tags,
        }) + buildNoteBody(title, sourceContent, related),
        'utf-8',
      );
      refreshClusterIndex(contentPath, normalizedClusterSlug);

      return NextResponse.json({ success: true, notes: [{ slug: finalSlug, title }] });
    }

    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const conversationText = messages
      .map((message: { role: string; content: string }) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : 'gpt-5.4';

    const response = await client.chat.completions.create({
      model: selectedModel,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Extract knowledge notes from this conversation:\n\n${conversationText}`,
        },
      ],
    });

    const rawContent = response.choices[0]?.message?.content ?? '[]';
    const jsonStr = stripMarkdownFence(rawContent);

    let notes: GeneratedNote[] = [];
    try {
      const parsed = JSON.parse(jsonStr);
      notes = Array.isArray(parsed) ? parsed : [];
    } catch {
      return NextResponse.json({ error: 'Could not parse notes from model response' }, { status: 500 });
    }

    const savedNotes: { slug: string; title: string }[] = [];

    for (const note of notes) {
      if (!note.title || !note.content) continue;

      const baseSlug = note.slug ? slugify(note.slug) : slugify(note.title);
      const finalSlug = `${baseSlug}-${timestamp}`;
      const tags = normalizeTopicTags(
        [...(note.tags ?? []), ...semanticTagsFromText(`${note.title}\n${note.content}`, 8)],
        note.content,
        8,
      );
      const related = findRelatedNotes({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        title: note.title,
        content: note.content,
        tags,
        relatedTitles: note.related ?? [],
        excludeSlugs: [finalSlug],
      });
      const fileContent =
        frontmatter({
          title: note.title,
          date,
          source: 'generated-chat',
          knowledge_type: 'generated-note',
          generated_by: 'chatmock',
          related: related.map((relatedNote) => relatedNote.slug),
          tags,
        }) +
        buildNoteBody(note.title, note.content, related);

      fs.writeFileSync(path.join(clusterDir, `${finalSlug}.md`), fileContent, 'utf-8');
      savedNotes.push({ slug: finalSlug, title: note.title });
    }

    refreshClusterIndex(contentPath, normalizedClusterSlug);

    return NextResponse.json({ success: true, notes: savedNotes });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
