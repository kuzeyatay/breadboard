import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import path from 'node:path';
import type {
  EasyInputMessage,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { DEFAULT_MODEL } from '@/lib/ai-models';
import {
  normalizeAssistantReasoningEffort,
  toOpenAiReasoningEffort,
} from '@/lib/assistant-reasoning';
import {
  chatTokenUsageEventFromResponse,
  type ChatTokenUsageStreamEvent,
} from '@/lib/chat-token-usage';
import type { ChatAttachment } from '@/lib/chat-attachments';
import { modelAttachmentPromptText } from '@/lib/model-attachments';
import { buildUrlLinkContext } from '@/lib/url-link-context';
import { scanClusterKnowledge, type KnowledgeNode } from '@/lib/knowledge';
import { retrieveGraphRag, type RetrievalGarden } from '@/lib/semantic-retrieval';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { withCouncil } from '@/lib/council';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';
import { directModeSection } from '@/lib/hermes/direct-mode.ts';
import { responseStylePrompt } from '@/lib/hermes/system-prompts.ts';
import { createEmDashFilter } from '@/lib/prose-punctuation.ts';
import {
  assistantTextFromOutputItem,
  createResponseTextRecovery,
  reasoningTextFromOutputItem,
} from '@/lib/responses-stream-text.ts';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
type ChatRequestMessage = { role: 'user' | 'assistant'; content: string };
type SsePayload =
  | { type: 'sources'; sources: string[] }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | ChatTokenUsageStreamEvent;

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

function buildResponsesInput(
  messages: ChatRequestMessage[],
  attachments: ChatAttachment[],
): EasyInputMessage[] {
  const lastUserIndex = messages.length - 1;
  return messages.map((message, index) => {
    const isLastUser = message.role === 'user' && index === lastUserIndex;
    if (!isLastUser || attachments.length === 0) {
      return message.role === 'assistant'
        ? {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: message.content,
          }
        : { type: 'message', role: 'user', content: message.content };
    }

    // A document's `text` is its structured reading, so it belongs in the
    // same block as a plain text file rather than in one of its own.
    const textAttachments = attachments.filter(
      (attachment): attachment is Extract<ChatAttachment, { type: 'text' | 'document' }> =>
        attachment.type === 'text' || attachment.type === 'document',
    );
    const imageAttachments = attachments.filter(
      (attachment): attachment is Extract<ChatAttachment, { type: 'image' }> =>
        attachment.type === 'image',
    );
    // A mesh has no text of its own, so what was measured from it stands in.
    const modelAttachments = attachments.filter(
      (attachment): attachment is Extract<ChatAttachment, { type: 'model' }> =>
        attachment.type === 'model',
    );
    const attachedText = [
      ...textAttachments.map(
        (attachment) => `--- Attached file: ${attachment.name} ---\n${attachment.text}`,
      ),
      ...modelAttachments.map(
        (attachment) =>
          `--- Attached file: ${attachment.name} ---\n${modelAttachmentPromptText(attachment)}`,
      ),
    ].join('\n\n');
    const contentParts: Array<
      { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail: 'auto' }
    > = [
      {
        type: 'input_text',
        text: attachedText ? `${attachedText}\n\n---\n\n${message.content}` : message.content,
      },
    ];
    for (const image of imageAttachments) {
      contentParts.push({
        type: 'input_image',
        image_url: image.dataUrl,
        detail: 'auto',
      });
    }
    return { type: 'message', role: 'user', content: contentParts };
  });
}

export async function POST(request: Request) {
  try {
    const { baseURL } = resolveChatmockBaseUrl(request);
    const userId = await requireUserId();
    const { messages, model, thinking, reasoningEffort, attachments, scope, adhdMode } =
      await request.json();

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

    const selectedReasoningEffort = normalizeAssistantReasoningEffort(reasoningEffort, thinking);
    const thinkingEnabled = selectedReasoningEffort !== 'none';
    const chatAttachments: ChatAttachment[] = Array.isArray(attachments) ? attachments : [];

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
    const retrievalGardens: RetrievalGarden[] = [];
    const gardenSummaries: string[] = [];
    let totalDocuments = 0;
    let totalTopics = 0;
    let totalLinks = 0;

    for (const cluster of clusterRows) {
      const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
      if (knowledge.nodes.length === 0) continue;
      retrievalGardens.push({
        slug: cluster.slug,
        name: cluster.name,
        rootPath: path.join(contentPath, cluster.slug),
        knowledge,
      });

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
    const retrieval = await retrieveGraphRag({
      query: lastUserMessage?.content ?? '',
      gardens: retrievalGardens,
      maxChunks: 10,
    });
    const scopedByPage = new Map(
      allNodes.map((scoped) => [`${scoped.clusterSlug}:${scoped.node.relPath}`, scoped]),
    );
    const selectedNodes = retrieval.chunks
      .map((chunk) => scopedByPage.get(`${chunk.gardenSlug}:${chunk.pageRelPath}`))
      .filter((scoped): scoped is ScopedNode => Boolean(scoped));

    const gardenContext =
      gardenSummaries.length > 0
        ? `Knowledge base overview (${clusterRows.length} ${
            publicScope ? 'public gardens' : 'gardens'
          }, ${totalDocuments} source documents, ${totalTopics} topics, ${totalLinks} links):\n${gardenSummaries.join('\n')}`
        : publicScope
          ? 'There are no public gardens with indexed knowledge available yet.'
          : 'The user does not have any gardens with indexed knowledge yet.';

    const notesContext = retrieval.context || 'No grounded chunk matched this query.';

    let systemPrompt =
      // Same prose-first voice and minimal-background rule the Hermes surfaces
      // get, so an answer does not change shape with the runtime behind it.
      `${responseStylePrompt()}\n\n` +
      // The switch shapes an answer wherever it is answered, including here.
      (adhdMode === true ? `${directModeSection()}\n\n` : '') +
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
      `${gardenContext}\n\nGraphRAG-lite retrieved evidence (BM25, aliases, optional embeddings, and bounded one-hop relationships):\n\n${notesContext}`;

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

    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL;

    const responsesRequest = {
      model: selectedModel,
      instructions: systemPrompt,
      input: buildResponsesInput(chatMessages, chatAttachments),
      stream: true,
      store: false,
      ...(thinkingEnabled
        ? {
            reasoning: {
              effort: toOpenAiReasoningEffort(selectedReasoningEffort),
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
          ...retrieval.sources,
          ...urlLinkContext.sources,
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
      ),
    );

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let usageEmitted = false;

        function emit(payload: SsePayload) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }

        // Assistant prose carries no em dashes; the reasoning stream is left as
        // the model wrote it.
        const emDash = createEmDashFilter();

        function emitText(type: 'delta' | 'thinking', text: string) {
          const filtered = type === 'delta' ? emDash.push(text) : text;
          if (!filtered) return;
          const chunkSize = 24000;
          for (let index = 0; index < filtered.length; index += chunkSize) {
            emit({ type, text: filtered.slice(index, index + chunkSize) });
          }
        }

        function emitUsageFromResponse(value: unknown) {
          if (usageEmitted) return;
          const payload = chatTokenUsageEventFromResponse(value);
          if (!payload) return;
          usageEmitted = true;
          emit(payload);
        }

        emit({ type: 'sources', sources: sourceNames });

        // Providers that deliver the message as a finished item rather than as
        // deltas would otherwise answer with silence. See responses-stream-text.
        const answerRecovery = createResponseTextRecovery();
        const thinkingRecovery = createResponseTextRecovery();

        try {
          for await (const event of stream as AsyncIterable<ResponseStreamEvent>) {
            if (event.type === 'response.output_text.delta') {
              answerRecovery.recordStreamed(event.output_index, event.delta);
              emitText('delta', event.delta);
            } else if (
              event.type === 'response.reasoning_summary_text.delta' ||
              event.type === 'response.reasoning_text.delta'
            ) {
              thinkingRecovery.recordStreamed(event.output_index, event.delta);
              emitText('thinking', event.delta);
            } else if (event.type === 'response.output_item.done') {
              const missingThinking = thinkingRecovery.missingFrom(
                event.output_index,
                reasoningTextFromOutputItem(event.item),
              );
              if (missingThinking) emitText('thinking', missingThinking);
              const missingAnswer = answerRecovery.missingFrom(
                event.output_index,
                assistantTextFromOutputItem(event.item),
              );
              if (missingAnswer) emitText('delta', missingAnswer);
            } else if (event.type === 'response.completed') {
              emitUsageFromResponse(event.response);
            } else if (event.type === 'response.incomplete') {
              emitUsageFromResponse(event.response);
            } else if (event.type === 'response.failed') {
              const response = event.response as unknown as JsonRecord | undefined;
              const error = response?.error as JsonRecord | undefined;
              if (typeof error?.message === 'string' && error.message.trim()) {
                emitText('delta', `\n\n${error.message.trim()}`);
              }
              emitUsageFromResponse(event.response);
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Something went wrong while streaming the response.';
          emitText('delta', `\n\n${message}`);
        } finally {
          const held = emDash.flush();
          if (held) emit({ type: 'delta', text: held });
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
