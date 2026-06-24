import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { normalizeTopicTags, refreshClusterIndex } from '@/lib/knowledge';
import { publishQuartzAfterMutation } from '@/lib/quartz-publish';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { requireOwnedClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
type ChatMessage = { role: 'user' | 'assistant'; content: string };

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function normalizeDocumentSlug(clusterSlug: string, slug: string): string | null {
  const cleaned = slug
    .replace(/\\/g, '/')
    .replace(/[?#].*$/, '')
    .replace(/\.md$/i, '')
    .trim();
  let segments = cleaned.split('/').map((segment) => segment.trim()).filter(Boolean);
  const clusterIndex = segments.findIndex((segment) => segment === clusterSlug);
  if (clusterIndex >= 0) segments = segments.slice(clusterIndex + 1);
  if (segments[0] === 'garden' && segments[1] === clusterSlug) segments = segments.slice(2);
  if (segments.length === 0) return null;
  const noteSlug = segments.join('/');
  if (/^(?:index|_index)$/i.test(noteSlug) || noteSlug.includes('..')) return null;
  return noteSlug;
}

function documentPath(contentPath: string, clusterSlug: string, slug: string): string | null {
  const clusterDir = path.resolve(contentPath, clusterSlug);
  const filePath = path.resolve(clusterDir, `${slug}.md`);
  if (filePath !== clusterDir && filePath.startsWith(`${clusterDir}${path.sep}`)) return filePath;
  return null;
}

function frontmatterTitle(content: string, fallback: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const titleLine = match?.[1]
    ?.split(/\r?\n/)
    .find((line) => line.trimStart().startsWith('title:'));
  if (!titleLine) return fallback;
  return titleLine
    .slice(titleLine.indexOf(':') + 1)
    .trim()
    .replace(/^["']|["']$/g, '') || fallback;
}

function parseYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function yamlListItemValue(line: string): string | null {
  const match = line.match(/^\s*-\s*(.+?)\s*$/);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function parseFrontmatterTags(content: string): string[] {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const lines = match[1].split(/\r?\n/);
  const tagIndex = lines.findIndex((line) => line.trimStart().startsWith('tags:'));
  if (tagIndex < 0) return [];
  const tagsLine = lines[tagIndex];
  const value = tagsLine.slice(tagsLine.indexOf(':') + 1).trim();
  const blockTags: string[] = [];
  for (const line of lines.slice(tagIndex + 1)) {
    const tag = yamlListItemValue(line);
    if (!tag) break;
    blockTags.push(tag);
  }
  if (value.startsWith('[')) return [...parseYamlArray(value), ...blockTags];
  return value
    ? value.split(/\s+/).map((tag) => tag.trim().replace(/^-/, '')).filter(Boolean)
    : blockTags;
}

function hasFrontmatterTags(content: string): boolean {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(match?.[1]?.split(/\r?\n/).some((line) => line.trimStart().startsWith('tags:')));
}

function wantsTagEdit(instruction: string): boolean {
  return /\b(tags?|tagging|frontmatter|yaml|metadata)\b/i.test(instruction);
}

function yamlArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`;
}

function updateFrontmatterTags(content: string, tags: string[]): string {
  const field = `tags: ${yamlArray(tags)}`;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return tags.length > 0 ? `---\n${field}\n---\n\n${content}` : content;
  const frontmatter = match[1];
  const body = content.slice(match[0].length).replace(/^\r?\n/, '');
  const lines = frontmatter.split(/\r?\n/);
  const nextLines: string[] = [];
  let found = false;
  let skippingTagList = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('tags:')) {
      found = true;
      skippingTagList = true;
      if (tags.length > 0) nextLines.push(field);
      continue;
    }

    if (skippingTagList) {
      if (yamlListItemValue(line) !== null) continue;
      skippingTagList = false;
    }

    nextLines.push(line);
  }

  if (!found && tags.length > 0) nextLines.push(field);
  return `---\n${nextLines.join('\n').trim()}\n---\n\n${body}`;
}

function parseEditResponse(rawContent: string): { content: string; summary: string } | null {
  const stripped = stripMarkdownFence(rawContent);
  try {
    const parsed = JSON.parse(stripped) as JsonRecord;
    const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (content) return { content, summary };
  } catch {
    // Fall through and accept raw markdown only when it looks like a complete note.
  }
  return stripped ? { content: stripped, summary: 'Updated the open markdown note.' } : null;
}

function parseChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as JsonRecord;
      const role = record.role;
      const content = record.content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
      return { role, content: content.trim() };
    })
    .filter((message): message is ChatMessage => Boolean(message?.content))
    .slice(-8);
}

export async function POST(request: Request) {
  try {
    const { baseURL } = resolveChatmockBaseUrl(request);
    const body = await request.json().catch(() => ({}));
    const clusterSlug = typeof body.clusterSlug === 'string' ? body.clusterSlug.trim() : '';
    const slugInput = typeof body.slug === 'string' ? body.slug.trim() : '';
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    const chatMessages = parseChatMessages(body.messages);
    const selectedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gpt-5.5';

    if (!clusterSlug || !slugInput || !instruction) {
      return NextResponse.json({ error: 'clusterSlug, slug, and instruction are required' }, { status: 400 });
    }

    const { cluster } = await requireOwnedClusterFromSlug(clusterSlug);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const slug = normalizeDocumentSlug(cluster.slug, slugInput);
    if (!slug) {
      return NextResponse.json({ error: 'Document path is not editable' }, { status: 400 });
    }

    const filePath = documentPath(contentPath, cluster.slug, slug);
    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const currentContent = fs.readFileSync(filePath, 'utf-8');
    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || 'local',
    });

    const response = await client.chat.completions.create({
      model: selectedModel,
      messages: [
        {
          role: 'system',
          content:
            'You rewrite an existing Markdown note exactly as requested. Return only JSON with keys "summary" and "content". ' +
            'The "content" value must be the complete updated Markdown file, including YAML frontmatter if present. ' +
            'Preserve all useful existing content unless the user explicitly asks to remove or rewrite it. ' +
            'If the user asks to use "this version", "the version above", "your previous version", or similar, use the recent chat context as the replacement source. ' +
            'When adding tags, update the YAML frontmatter tags field. ' +
            'When fixing math or LaTeX, use $...$ for inline math and $$...$$ for display math, and avoid corrupting prose.',
        },
        {
          role: 'user',
          content: [
            `Instruction: ${instruction}`,
            `Cluster: ${cluster.name}`,
            `Slug: ${slug}`,
            chatMessages.length > 0
              ? `Recent chat context:\n${chatMessages
                  .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
                  .join('\n\n---\n\n')}`
              : '',
            'Current Markdown:',
            '```markdown',
            currentContent,
            '```',
          ].filter(Boolean).join('\n\n'),
        },
      ],
    });

    const parsed = parseEditResponse(response.choices[0]?.message?.content ?? '');
    if (!parsed) {
      return NextResponse.json({ error: 'Could not parse the rewritten markdown.' }, { status: 500 });
    }

    const shouldUpdateTags = wantsTagEdit(instruction) || hasFrontmatterTags(parsed.content);
    const normalizedTags = shouldUpdateTags
      ? normalizeTopicTags(parseFrontmatterTags(parsed.content), parsed.content, 12, parsed.content)
      : [];
    const nextContent = shouldUpdateTags
      ? updateFrontmatterTags(parsed.content, normalizedTags)
      : parsed.content;
    fs.writeFileSync(filePath, nextContent.endsWith('\n') ? nextContent : `${nextContent}\n`, 'utf-8');
    refreshClusterIndex(contentPath, cluster.slug);
    await publishQuartzAfterMutation(`AI edit markdown ${cluster.slug}/${slug}`);

    return NextResponse.json({
      success: true,
      slug,
      title: frontmatterTitle(nextContent, slug),
      summary: parsed.summary || 'Updated the open markdown note.',
      content: nextContent,
      tags: normalizedTags,
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
