import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { scanClusterKnowledge, type KnowledgeNode } from '@/lib/knowledge';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

type ChatmockReasoningOverride = {
  reasoning?: {
    effort: 'high';
    summary: 'auto';
  };
};

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((word) => word.trim())
      .filter((word) => word.length > 2),
  );
}

function scoreNode(node: KnowledgeNode, queryWords: Set<string>): number {
  if (queryWords.size === 0) return 0;
  const titleWords = tokenize(node.title);
  const metadataWords = tokenize([...node.tags, ...node.locations, node.sourceFile].join(' '));
  const contentWords = node.content.toLowerCase().split(/[^a-z0-9]+/g);

  let score = 0;
  for (const word of queryWords) {
    if (titleWords.has(word)) score += 8;
    if (metadataWords.has(word)) score += 4;
  }
  score += contentWords.filter((word) => queryWords.has(word)).length;
  return score;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}\n\n[Context truncated]`;
}

function describeInventoryNode(node: KnowledgeNode): string {
  const details = [
    `type: ${node.type}`,
    `source: ${node.sourceFile || node.sourceDocument || node.fileName}`,
  ];

  if (node.locations.length > 0) details.push(`locations: ${node.locations.join(', ')}`);
  if (node.tags.length > 0) details.push(`tags: ${node.tags.join(', ')}`);

  return `- ${node.title} | ${details.join(' | ')}`;
}

export async function POST(request: Request) {
  try {
    const { messages, clusterSlug, model, thinking, attachments } = await request.json();

    if (!Array.isArray(messages) || typeof clusterSlug !== 'string' || !clusterSlug.trim()) {
      return NextResponse.json({ error: 'messages and clusterSlug are required' }, { status: 400 });
    }

    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);

    // attachments: Array<{ type: 'text'; text: string; name: string } | { type: 'image'; dataUrl: string; name: string }>
    type Attachment = { type: 'text'; text: string; name: string } | { type: 'image'; dataUrl: string; name: string };
    const chatAttachments: Attachment[] = Array.isArray(attachments) ? attachments : [];

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
    const lastUserMessage = [...messages].reverse().find(
      (message: { role: string }) => message.role === 'user',
    );
    const queryWords = tokenize(
      typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : '',
    );

    const scored = knowledge.nodes
      .map((node) => ({ node, score: scoreNode(node, queryWords) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const selectedSlugs = new Set(scored.map(({ node }) => node.slug));
    for (const { node } of scored.slice(0, 3)) {
      for (const edge of knowledge.edges) {
        if (edge.source === node.slug) selectedSlugs.add(edge.target);
        if (edge.target === node.slug) selectedSlugs.add(edge.source);
      }
    }

    const selectedNodes = knowledge.nodes
      .filter((node) => selectedSlugs.has(node.slug))
      .slice(0, 8);

    const graphContext = [
      `Cluster graph summary: ${knowledge.stats.documents} source documents, ${knowledge.stats.topics} extracted topics, ${knowledge.stats.links} links.`,
      ...knowledge.tree.map(
        ({ source, topics }) =>
          `Source "${source.title}" connects to: ${topics.map((topic) => topic.title).join(', ') || 'no extracted topics yet'}.`,
      ),
    ].join('\n');

    const clusterInventory = truncate(
      knowledge.nodes
        .filter((node) => node.type !== 'cluster-index')
        .map(describeInventoryNode)
        .join('\n'),
      12000,
    );

    const notesContext = selectedNodes
      .map((node) => {
        const locations = node.locations.length > 0 ? node.locations.join(', ') : 'not specified';
        return [
          `# ${node.title}`,
          `Type: ${node.type}`,
          `Source file: ${node.sourceFile || node.fileName}`,
          `Locations: ${locations}`,
          truncate(node.content, 7000),
        ].join('\n');
      })
      .join('\n\n---\n\n');

    let systemPrompt =
      `You are a helpful assistant for the user's second brain cluster '${cluster.name}'. ` +
      'Use the graph relationships and markdown notes as grounded context. ' +
      'You can answer questions about the knowledge map itself, including source documents, extracted topics, locations, page references, tags, and relationships. ' +
      'When the user asks where something appears, cite the note title and the Locations value from the context. ' +
      'When a question depends on uploaded material, mention the relevant source or topic names naturally. ' +
      'Always format mathematical expressions using LaTeX delimiters: ' +
      'use $...$ for inline math (e.g. $|\\Psi|^2$, $e^{i(kx-\\omega t)}$, $E = mc^2$) ' +
      'and $$...$$ on its own line for display/block equations. ' +
      'Never write math in plain text with ^ or bracket notation — always use proper LaTeX.\n\n' +
      `${graphContext}\n\nCluster inventory:\n\n${clusterInventory}\n\nRelevant markdown notes:\n\n${notesContext}`;

    // Thinking mode: request deeper reasoning from the backend.
    if (thinking) {
      systemPrompt +=
        '\n\nWhen the question is complex or analytical, think carefully before giving your final answer. ' +
        'Use the relevant notes and relationships to check your answer before responding.';
    }

    const baseURL = process.env.OPENAI_BASE_URL;
    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY,
    });

    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : 'gpt-5.4';

    // Build final messages list, injecting attachments into the last user message
    const oaiMessages: ChatCompletionMessageParam[] = messages.map((m: { role: string; content: string }, idx: number) => {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const isLastUser = m.role === 'user' && idx === messages.length - 1;
      if (!isLastUser || chatAttachments.length === 0) return { role, content: m.content };

      // Build multi-part content for the last user message
      const textAttachments = chatAttachments.filter((a): a is { type: 'text'; text: string; name: string } => a.type === 'text');
      const imageAttachments = chatAttachments.filter((a): a is { type: 'image'; dataUrl: string; name: string } => a.type === 'image');

      const parts: ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[] = [];

      if (textAttachments.length > 0) {
        const attachedText = textAttachments
          .map((a) => `--- Attached file: ${a.name} ---\n${a.text}`)
          .join('\n\n');
        parts.push({ type: 'text', text: `${attachedText}\n\n---\n\n${m.content}` });
      } else {
        parts.push({ type: 'text', text: m.content });
      }

      for (const img of imageAttachments) {
        parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
      }

      return { role: 'user', content: parts };
    });

    const shouldSendChatmockReasoning =
      Boolean(thinking) && Boolean(baseURL && !/api\.openai\.com/i.test(baseURL));

    const chatRequest = {
      model: selectedModel,
      messages: [{ role: 'system', content: systemPrompt }, ...oaiMessages],
      stream: true,
      ...(thinking ? { reasoning_effort: 'high' as const } : {}),
      ...(shouldSendChatmockReasoning
        ? { reasoning: { effort: 'high' as const, summary: 'auto' as const } }
        : {}),
    } satisfies ChatCompletionCreateParamsStreaming & ChatmockReasoningOverride;

    const stream = await client.chat.completions.create(chatRequest);

    const sourceNames = selectedNodes.map((node) => node.fileName);

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Emit sources first
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'sources', sources: sourceNames })}\n\n`,
          ),
        );

        // Stream parser — splits <think>…</think> from regular content
        let rawBuffer = '';
        let inThink = false;

        function emit(type: 'delta' | 'thinking', text: string) {
          if (!text) return;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type, text })}\n\n`),
          );
        }

        function drainBuffer(flush = false) {
          while (rawBuffer.length > 0) {
            if (inThink) {
              const closeIdx = rawBuffer.indexOf('</think>');
              if (closeIdx >= 0) {
                emit('thinking', rawBuffer.slice(0, closeIdx));
                inThink = false;
                rawBuffer = rawBuffer.slice(closeIdx + '</think>'.length);
              } else {
                // Keep last 8 chars in buffer (length of '</think>' - 1) to detect split tags
                const safe = flush ? rawBuffer.length : Math.max(0, rawBuffer.length - 8);
                emit('thinking', rawBuffer.slice(0, safe));
                rawBuffer = rawBuffer.slice(safe);
                break;
              }
            } else {
              const openIdx = rawBuffer.indexOf('<think>');
              if (openIdx >= 0) {
                emit('delta', rawBuffer.slice(0, openIdx));
                inThink = true;
                rawBuffer = rawBuffer.slice(openIdx + '<think>'.length);
              } else {
                // Keep last 6 chars to detect a split '<think>' opener
                const safe = flush ? rawBuffer.length : Math.max(0, rawBuffer.length - 6);
                emit('delta', rawBuffer.slice(0, safe));
                rawBuffer = rawBuffer.slice(safe);
                break;
              }
            }
          }
        }

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content ?? '';
          if (text) {
            rawBuffer += text;
            drainBuffer();
          }
        }

        // Flush remaining
        drainBuffer(true);

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
