import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type {
  EasyInputMessage,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { buildUrlLinkContext } from '@/lib/url-link-context';
import { scanClusterKnowledge, type KnowledgeNode } from '@/lib/knowledge';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { withCouncil } from '@/lib/council';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
type ChatRequestMessage = { role: 'user' | 'assistant'; content: string };
type SsePayload =
  | { type: 'sources'; sources: string[] }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string };

interface ClusterRow {
  name: string;
  slug: string;
}

// A knowledge node paired with the garden it belongs to, so answers can cite
// which garden a fact came from when chatting across the whole knowledge base.
interface ScopedNode {
  node: KnowledgeNode;
  clusterName: string;
  clusterSlug: string;
}

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

function compactImageDataUrls(value: string): string {
  return value.replace(
    /!\[([^\]]*)\]\(data:image\/[^)]+\)/gi,
    (_match, altText: string) =>
      altText?.trim()
        ? `[Generated image omitted from prompt context: ${altText.trim()}]`
        : '[Generated image omitted from prompt context]',
  );
}

function parseChatMessages(messages: unknown[]): ChatRequestMessage[] {
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') return [];
    const record = message as JsonRecord;
    const role = record.role;
    const content = record.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return [];
    }
    return [{ role, content: compactImageDataUrls(content) }];
  });
}

function buildResponsesInput(messages: ChatRequestMessage[]): EasyInputMessage[] {
  return messages.map((message) =>
    message.role === 'assistant'
      ? {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: message.content,
        }
      : {
          type: 'message',
          role: 'user',
          content: message.content,
        },
  );
}

function describeInventoryNode(scoped: ScopedNode): string {
  const { node } = scoped;
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
    const { baseURL } = resolveChatmockBaseUrl(request);
    const userId = await requireUserId();
    const { messages, model, thinking, scope } = await request.json();

    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages are required' }, { status: 400 });
    }

    // "public" turns the terminal into a hub across every chat-accessible public
    // garden (plus the user's own public gardens); "mine" stays scoped to the
    // user's gardens.
    const publicScope = scope === 'public';

    const chatMessages = parseChatMessages(messages);
    if (chatMessages.length === 0) {
      return NextResponse.json({ error: 'At least one valid chat message is required' }, { status: 400 });
    }

    const thinkingEnabled = Boolean(thinking);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const clusterRows = (
      publicScope
        ? db
            .prepare(
              `SELECT name, slug
               FROM clusters
               WHERE visibility = 'public' AND (chat_accessible = 1 OR user_id = ?)
               ORDER BY created_at DESC`,
            )
            .all(userId)
        : db
            .prepare('SELECT name, slug FROM clusters WHERE user_id = ? ORDER BY created_at DESC')
            .all(userId)
    ) as ClusterRow[];

    // Aggregate every garden's knowledge into one pool, tagging each node with
    // its garden so the model can attribute and cross-link across gardens.
    const allNodes: ScopedNode[] = [];
    const gardenSummaries: string[] = [];
    let totalDocuments = 0;
    let totalTopics = 0;
    let totalLinks = 0;

    for (const cluster of clusterRows) {
      const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
      if (knowledge.nodes.length === 0) continue;

      totalDocuments += knowledge.stats.documents;
      totalTopics += knowledge.stats.topics;
      totalLinks += knowledge.stats.links;

      for (const node of knowledge.nodes) {
        if (node.type === 'cluster-index') continue;
        allNodes.push({ node, clusterName: cluster.name, clusterSlug: cluster.slug });
      }

      const topicTitles = knowledge.tree
        .flatMap(({ topics }) => topics.map((topic) => topic.title))
        .slice(0, 12);
      gardenSummaries.push(
        `Garden "${cluster.name}": ${knowledge.stats.documents} sources, ${knowledge.stats.topics} topics${
          topicTitles.length > 0 ? `. Key topics: ${topicTitles.join(', ')}` : ''
        }.`,
      );
    }

    const lastUserMessage = [...chatMessages].reverse().find((message) => message.role === 'user');
    const queryWords = tokenize(lastUserMessage?.content ?? '');

    const scored = allNodes
      .map((scoped) => ({ scoped, score: scoreNode(scoped.node, queryWords) }))
      .sort((a, b) => b.score - a.score);

    // Pick the most relevant notes across every garden as grounded context.
    const selectedNodes = scored
      .filter((item, index) => item.score > 0 || index < 4)
      .slice(0, 12)
      .map((item) => item.scoped);

    const gardenContext =
      gardenSummaries.length > 0
        ? `Knowledge base overview (${clusterRows.length} ${
            publicScope ? 'public gardens' : 'gardens'
          }, ${totalDocuments} source documents, ${totalTopics} topics, ${totalLinks} links):\n${gardenSummaries.join('\n')}`
        : publicScope
          ? 'There are no public gardens with indexed knowledge available yet.'
          : 'The user does not have any gardens with indexed knowledge yet.';

    const inventory = truncate(
      allNodes
        .map((scoped) => `[${scoped.clusterName}] ${describeInventoryNode(scoped)}`)
        .join('\n'),
      14000,
    );

    const notesContext = selectedNodes
      .map((scoped) => {
        const { node, clusterName } = scoped;
        const locations = node.locations.length > 0 ? node.locations.join(', ') : 'not specified';
        return [
          `# ${node.title}`,
          `Garden: ${clusterName}`,
          `Type: ${node.type}`,
          `Source file: ${node.sourceFile || node.fileName}`,
          `Locations: ${locations}`,
          truncate(node.content, 6000),
        ].join('\n');
      })
      .join('\n\n---\n\n');

    let systemPrompt =
      (publicScope
        ? 'You are the assistant for the Breadboard public knowledge hub, which spans every public garden shared on the platform. ' +
          'Answer using the aggregated graph relationships and textbook pages from across all public gardens as grounded context. ' +
          'You can answer questions about any public garden, compare and connect ideas across them, and point to where knowledge lives. ' +
          'When you use a note, mention which public garden it comes from naturally (e.g. "in the Physics for EE garden"). '
        : "You are the assistant for the user's entire second-brain knowledge base, which spans every garden they own. " +
          'Answer using the aggregated graph relationships and textbook pages from across all their gardens as grounded context. ' +
          'You can answer questions about any garden, compare and connect ideas across gardens, and point to where knowledge lives. ' +
          'When you use a note, mention which garden it comes from naturally (e.g. "in your Physics for EE garden"). ') +
      'When the user asks where something appears, cite the page title, garden, and the Locations value from the context. ' +
      'Always format mathematical expressions using LaTeX delimiters: ' +
      'use $...$ for inline math (e.g. $|\\Psi|^2$, $e^{i(kx-\\omega t)}$, $E = mc^2$) ' +
      'and $$...$$ on its own line for display/block equations. ' +
      'Never write math in plain text with ^ or bracket notation - always use proper LaTeX.\n\n' +
      `${gardenContext}\n\nKnowledge base inventory (every note, grouped by [garden]):\n\n${inventory}\n\nMost relevant notes for this question:\n\n${notesContext}`;

    const urlLinkContext = await buildUrlLinkContext(chatMessages);
    if (urlLinkContext.context) {
      systemPrompt +=
        '\n\nWeb link context fetched by the Breadboard server. ' +
        'Use this context when the user asks about linked web content. ' +
        'If a requested link could not be fetched, say that it may be private, unavailable, unsupported, or too large rather than claiming you cannot access links at all.\n\n' +
        urlLinkContext.context;
    }

    if (thinkingEnabled) {
      systemPrompt +=
        '\n\nWhen the question is complex or analytical, think carefully before giving your final answer. ' +
        'Use the relevant notes and relationships across gardens to check your answer before responding.';
    }

    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || 'local',
    });

    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : 'gpt-5.5';

    const responsesRequest = {
      model: selectedModel,
      instructions: systemPrompt,
      input: buildResponsesInput(chatMessages),
      stream: true,
      store: false,
      ...(thinkingEnabled
        ? {
            reasoning: {
              effort: 'high' as const,
              summary: 'auto' as const,
            },
          }
        : {}),
    } satisfies ResponseCreateParamsStreaming;

    // Council routing: ChatMock reads and strips these fields.
    const stream = await client.responses.create(
      withCouncil(responsesRequest, {
        taskType: 'page_assistant_answer',
        sourceContext:
          selectedNodes.length > 0
            ? {
                sourceTitles: selectedNodes
                  .map((scoped) => `${scoped.node.fileName} (${scoped.clusterName})`)
                  .slice(0, 20),
              }
            : undefined,
      }),
    );

    const sourceNames = Array.from(
      new Set(
        [
          ...selectedNodes.map((scoped) => `${scoped.node.fileName} (${scoped.clusterName})`),
          ...urlLinkContext.sources,
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      ),
    );

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        function emit(payload: SsePayload) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }

        function emitText(type: 'delta' | 'thinking', text: string) {
          if (!text) return;
          const chunkSize = 24000;
          for (let index = 0; index < text.length; index += chunkSize) {
            emit({ type, text: text.slice(index, index + chunkSize) });
          }
        }

        emit({ type: 'sources', sources: sourceNames });

        try {
          for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
            if (event.type === 'response.output_text.delta') {
              emitText('delta', event.delta);
            } else if (
              event.type === 'response.reasoning_summary_text.delta' ||
              event.type === 'response.reasoning_text.delta'
            ) {
              emitText('thinking', event.delta);
            } else if (event.type === 'response.failed') {
              const response = event.response as unknown as JsonRecord | undefined;
              const error = response?.error as JsonRecord | undefined;
              if (typeof error?.message === 'string' && error.message.trim()) {
                emitText('delta', `\n\n${error.message.trim()}`);
              }
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Something went wrong while streaming the response.';
          emitText('delta', `\n\n${message}`);
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
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
