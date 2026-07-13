import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { DEFAULT_MODEL } from '@/lib/ai-models';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { withCouncil } from '@/lib/council';
import { normalizeTopicTags, refreshClusterIndex, resolveClusterNoteFile, scanClusterKnowledge, semanticTagsFromText, slugify } from '@/lib/knowledge';
import { publishQuartzAfterMutation } from '@/lib/quartz-publish';
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

const EXTRACTION_SYSTEM_PROMPT = `You are a textbook page extraction assistant for a Breadboard learning garden.

Analyze the conversation and extract durable knowledge into concise textbook pages. Each page should read like a useful subsection in a learner-facing textbook, not a disconnected generated topic card.

Return ONLY a valid JSON array, with no markdown fences and no extra text. Format:
[
  {
    "title": "Concept Title",
    "slug": "concept-title",
    "tags": ["restoring-force", "angular-frequency", "simple-harmonic-motion"],
    "related": ["Related Concept Title"],
    "content": "## Concept Title\\n\\nMarkdown content here..."
  }
]

Requirements for each page:
- title: Clear, specific noun-phrase (e.g. "Retrieval-Augmented Generation", "Spaced Repetition")
- slug: lowercase, hyphenated, URL-safe version of title
- content: Well-structured markdown starting with ## Title, then:
  * Key definitions, facts, and insights from the conversation
  * **Bold** for important terms
  * Bullet lists for related points
  * [[wikilinks]] to connect related concepts mentioned in this conversation
  * LaTeX for formulas, symbols, or derivations when it improves clarity: inline math with $...$ and display equations with $$...$$
  * 100-300 words
- tags: 2-5 concise concept hints used only to place this internal chat note. They are not public Quartz tags. Return normalized lower-case kebab-case concepts, never claims or planner phrases.
- related: titles of pages/concepts that should be strongly connected to this page
- Never use generic, document-type, or learning tags like knowledge, generated, note, topic, source, document, chat, answer, response, general, misc, important, learning, study, formula, definition, or example, and never reference a page/slide/figure in a tag

Create 2-6 pages based on depth.
Return [] if the conversation has no durable, reusable knowledge.
Do not create pages from greetings, logistics, UI chatter, one-off requests, upload progress, or answers that only say something failed.`;

interface RelatedNote {
  slug: string;
  title: string;
}

interface PlacementCandidate {
  slug: string;
  title: string;
  tags: string[];
  excerpt: string;
  content: string;
  score: number;
}

interface PlacementDecision {
  action: 'create' | 'merge';
  targetSlug?: string;
  reason?: string;
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```(?:json|markdown|md)?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();
}

function stripFrontmatter(value: string): string {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function truncateForPrompt(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength).trimEnd()}\n\n[Truncated]`;
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

function chatPlacementCandidates({
  contentPath,
  clusterSlug,
  title,
  content,
  tags,
}: {
  contentPath: string;
  clusterSlug: string;
  title: string;
  content: string;
  tags: string[];
}): PlacementCandidate[] {
  const queryTokens = tokenSet(`${title}\n${content}\n${tags.join(' ')}`);
  const titleTokens = tokenSet(title);
  const tagSet = new Set(tags);

  return scanClusterKnowledge(contentPath, clusterSlug)
    .nodes
    .filter((node) => node.type !== 'source-document' && node.type !== 'cluster-index')
    .map((node) => {
      const sharedTags = node.tags.filter((tag) => tagSet.has(tag)).length;
      const titleOverlap = overlapScore(titleTokens, tokenSet(node.title));
      const contentOverlap = overlapScore(
        queryTokens,
        tokenSet(`${node.title}\n${node.excerpt}\n${node.tags.join(' ')}`),
      );
      return {
        slug: node.slug,
        title: node.title,
        tags: node.tags,
        excerpt: node.excerpt,
        content: stripFrontmatter(node.content),
        score: sharedTags * 0.35 + titleOverlap * 0.4 + contentOverlap * 0.25,
      };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 10);
}

async function decideChatNotePlacement({
  client,
  model,
  clusterInventory,
  candidates,
  title,
  content,
  tags,
}: {
  client: OpenAI;
  model: string;
  clusterInventory: PlacementCandidate[];
  candidates: PlacementCandidate[];
  title: string;
  content: string;
  tags: string[];
}): Promise<PlacementDecision> {
  if (candidates.length === 0) return { action: 'create', reason: 'No candidate pages exist.' };

  const response = await client.chat.completions.create(withCouncil({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You decide whether a newly saved chat page belongs inside an existing textbook page or should become a new page. Return ONLY JSON. Merge only when the new content is the same concept, a direct expansion of the same page, or substantially duplicate material. Create a new page when it is broader, narrower, adjacent, only related, or would make the target page incoherent.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          newNote: {
            title,
            tags,
            content: truncateForPrompt(content, 6000),
          },
          clusterInventory: clusterInventory.map((note) => ({
            slug: note.slug,
            title: note.title,
            tags: note.tags,
            excerpt: truncateForPrompt(note.excerpt, 450),
          })),
          fullCandidateNotes: candidates.map((note) => ({
            slug: note.slug,
            title: note.title,
            tags: note.tags,
            content: truncateForPrompt(note.content, 2200),
          })),
          responseShape: {
            action: 'create or merge',
            targetSlug: 'required only when action is merge',
            reason: 'short explanation',
          },
        }),
      },
    ],
  }, { taskType: 'classification' }));

  const raw = stripMarkdownFence(response.choices[0]?.message?.content ?? '{}');
  try {
    const parsed = JSON.parse(raw) as PlacementDecision;
    if (parsed.action === 'merge' && candidates.some((note) => note.slug === parsed.targetSlug)) {
      return parsed;
    }
    return { action: 'create', reason: parsed.reason ?? 'No valid merge target selected.' };
  } catch {
    return { action: 'create', reason: 'Placement decision could not be parsed.' };
  }
}

async function generateChatNoteTags(
  client: OpenAI,
  model: string,
  title: string,
  content: string,
): Promise<string[]> {
  try {
    const response = await client.chat.completions.create(withCouncil({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Return a JSON array of 2-5 reusable concept hints for the given content. ' +
            'Generate tags as reusable conceptual retrieval handles, not SEO keywords, folder names, title summaries, or broad topic labels. ' +
            'Return only normalized lower-case kebab-case tags, e.g. "restoring-force", "angular-frequency", "simple-harmonic-motion". ' +
            'Never use broad categories, document types, generic learning words, title slugs, source filenames, or page/slide/figure references.',
        },
        {
          role: 'user',
          content: `Title: ${title}\n\n${content.slice(0, 4000)}`,
        },
      ],
    }, { taskType: 'tagging' }));
    const raw = stripMarkdownFence(response.choices[0]?.message?.content ?? '[]');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

function wordOverlap(a: string, b: string): number {
  const words = (text: string) =>
    new Set(text.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wb) if (wa.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

async function harmonizeChatNote({
  client,
  model,
  existingFileContent,
  newTitle,
  newContent,
  newTags,
}: {
  client: OpenAI;
  model: string;
  existingFileContent: string;
  newTitle: string;
  newContent: string;
  newTags: string[];
}): Promise<string> {
  const existingBody = stripFrontmatter(existingFileContent);

  // Skip harmonization when the new content is near-identical to what's already saved
  // (e.g. saving the same chat twice with no new messages)
  if (wordOverlap(existingBody, newContent) > 0.7) {
    return existingFileContent;
  }

  let mergedBody = '';

  try {
    const response = await client.chat.completions.create(withCouncil({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Merge two textbook pages on the same concept into one coherent page. ' +
            'Integrate the new content naturally into the existing structure, expanding or refining sections with new details. ' +
            'Eliminate redundancy while preserving unique facts from both. ' +
            'Keep a clean heading hierarchy with no duplicate headings. ' +
            'Return ONLY the merged markdown body - no frontmatter, no code fences.',
        },
        {
          role: 'user',
          content: `### Existing page\n\n${existingBody}\n\n### New content to integrate\n\n${newContent}`,
        },
      ],
    }, { taskType: 'small_revision' }));
    mergedBody = response.choices[0]?.message?.content?.trim() ?? '';
  } catch {
    mergedBody = '';
  }

  if (!mergedBody) {
    return `${existingFileContent.trimEnd()}\n\n---\n\n${contentWithHeading(newTitle, newContent).trim()}\n`;
  }

  const fmMatch = existingFileContent.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)/);
  if (!fmMatch) return `${mergedBody}\n`;

  let fm = fmMatch[1];
  fm = fm.replace(/^date:.*$/m, `date: ${yamlQuote(new Date().toISOString())}`);

  // Public concept assignments on existing learner pages are contract-owned.
  // Chat-note harmonization may update prose, but never retags the target.
  void newTags;

  return `${fm}${mergedBody}\n`;
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
    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL;

    if (mode === 'chat-note') {
      const sourceMessage = latestAssistantMessage(messages as ChatMessage[]);
      const sourceContent = sourceMessage?.content.trim() ?? '';
      if (!sourceContent) {
        return NextResponse.json({ success: true, notes: [] });
      }

      const title = titleFromMarkdown(sourceContent);
      const finalSlug = `${slugify(title)}-${timestamp}`;
      const chatClient = new OpenAI({ baseURL, apiKey: process.env.OPENAI_API_KEY });
      const preliminaryTags = semanticTagsFromText(`${title}\n${sourceContent}`, 8);
      const placementCandidates = chatPlacementCandidates({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        title,
        content: sourceContent,
        tags: preliminaryTags,
      });
      const [llmTags, placementDecision] = await Promise.all([
        generateChatNoteTags(chatClient, selectedModel, title, sourceContent),
        decideChatNotePlacement({
          client: chatClient,
          model: selectedModel,
          clusterInventory: placementCandidates,
          candidates: placementCandidates.slice(0, 5),
          title,
          content: sourceContent,
          tags: preliminaryTags,
        }),
      ]);
      const tags = normalizeTopicTags(
        llmTags.length >= 3 ? llmTags : preliminaryTags,
        sourceContent,
        8,
      );

      if (placementDecision.action === 'merge' && placementDecision.targetSlug) {
        const targetPath =
          resolveClusterNoteFile(contentPath, normalizedClusterSlug, placementDecision.targetSlug)?.filePath ??
          path.join(clusterDir, `${placementDecision.targetSlug}.md`);
        if (fs.existsSync(targetPath)) {
          const target = placementCandidates.find((note) => note.slug === placementDecision.targetSlug);
          const harmonized = await harmonizeChatNote({
            client: chatClient,
            model: selectedModel,
            existingFileContent: fs.readFileSync(targetPath, 'utf-8'),
            newTitle: title,
            newContent: sourceContent,
            newTags: tags,
          });
          fs.writeFileSync(targetPath, harmonized, 'utf-8');
          refreshClusterIndex(contentPath, normalizedClusterSlug);
          await publishQuartzAfterMutation(`harmonize chat page into ${placementDecision.targetSlug}`);

          return NextResponse.json({
            success: true,
            notes: [
              {
                slug: placementDecision.targetSlug,
                title: target?.title ?? title,
                action: 'merged',
                reason: placementDecision.reason ?? '',
              },
            ],
          });
        }
      }

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
          source: 'chat',
          knowledge_type: 'textbook-page',
          breadboardType: 'textbook_page',
          saved_from: 'chat',
          generated_by: 'chatmock',
          related: related.map((note) => note.slug),
          semanticHints: tags,
        }) + buildNoteBody(title, sourceContent, related),
        'utf-8',
      );
      refreshClusterIndex(contentPath, normalizedClusterSlug);
      await publishQuartzAfterMutation(`save chat page in ${normalizedClusterSlug}`);

      return NextResponse.json({ success: true, notes: [{ slug: finalSlug, title, action: 'created' }] });
    }

    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const conversationText = messages
      .map((message: { role: string; content: string }) => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n\n');

    const response = await client.chat.completions.create(withCouncil({
      model: selectedModel,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Extract textbook pages from this conversation:\n\n${conversationText}`,
        },
      ],
    }, { taskType: 'subsection_generation', gardenId: normalizedClusterSlug }));

    const rawContent = response.choices[0]?.message?.content ?? '[]';
    const jsonStr = stripMarkdownFence(rawContent);

    let notes: GeneratedNote[] = [];
    try {
      const parsed = JSON.parse(jsonStr);
      notes = Array.isArray(parsed) ? parsed : [];
    } catch {
      return NextResponse.json({ error: 'Could not parse textbook pages from model response' }, { status: 500 });
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

      const noteCandidates = chatPlacementCandidates({
        contentPath,
        clusterSlug: normalizedClusterSlug,
        title: note.title,
        content: note.content,
        tags,
      });
      const notePlacement = await decideChatNotePlacement({
        client,
        model: selectedModel,
        clusterInventory: noteCandidates,
        candidates: noteCandidates.slice(0, 5),
        title: note.title,
        content: note.content,
        tags,
      });

      if (notePlacement.action === 'merge' && notePlacement.targetSlug) {
        const targetPath =
          resolveClusterNoteFile(contentPath, normalizedClusterSlug, notePlacement.targetSlug)?.filePath ??
          path.join(clusterDir, `${notePlacement.targetSlug}.md`);
        if (fs.existsSync(targetPath)) {
          const harmonized = await harmonizeChatNote({
            client,
            model: selectedModel,
            existingFileContent: fs.readFileSync(targetPath, 'utf-8'),
            newTitle: note.title,
            newContent: note.content,
            newTags: tags,
          });
          fs.writeFileSync(targetPath, harmonized, 'utf-8');
          savedNotes.push({ slug: notePlacement.targetSlug, title: note.title });
          continue;
        }
      }

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
          source: 'chat',
          knowledge_type: 'textbook-page',
          breadboardType: 'textbook_page',
          saved_from: 'chat',
          generated_by: 'chatmock',
          related: related.map((relatedNote) => relatedNote.slug),
          semanticHints: tags,
        }) +
        buildNoteBody(note.title, note.content, related);

      fs.writeFileSync(path.join(clusterDir, `${finalSlug}.md`), fileContent, 'utf-8');
      savedNotes.push({ slug: finalSlug, title: note.title });
    }

    refreshClusterIndex(contentPath, normalizedClusterSlug);
    await publishQuartzAfterMutation(`save textbook pages in ${normalizedClusterSlug}`);

    return NextResponse.json({ success: true, notes: savedNotes });
  } catch (err) {
    return routeErrorResponse(err);
  }
}
