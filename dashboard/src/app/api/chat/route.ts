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
import { retrieveGraphRag } from '@/lib/semantic-retrieval';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { withCouncil } from '@/lib/council';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';
import { readHermesConfig } from '@/lib/hermes/config.ts';
import { openGardenAgentChat } from '@/lib/hermes/garden-chat-adapter.ts';
import { apiErrorResponse } from '@/lib/hermes/route-helpers.ts';
import { recordAuditEvent } from '@/lib/hermes/runtime-store.ts';
import { cogniviaSection } from '@/lib/cognivia/index.ts';
import { directModeSection } from '@/lib/hermes/direct-mode.ts';
import {
  readerComprehensionPrompt,
  responseStylePrompt,
} from '@/lib/hermes/system-prompts.ts';
import { createEmDashFilter } from '@/lib/prose-punctuation.ts';
import {
  assistantTextFromOutputItem,
  createResponseTextRecovery,
  reasoningTextFromOutputItem,
} from '@/lib/responses-stream-text.ts';
import { resolveSmallTalkReply, smallTalkEventStream } from '@/lib/chat-small-talk.ts';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
/** One definition of what an attachment is, shared with the composer. */
type Attachment = ChatAttachment;
type ChatRequestMessage = { role: 'user' | 'assistant'; content: string };
type ActiveMarkdownContext = {
  slug: string;
  title?: string;
  content: string;
};
type SsePayload =
  | { type: 'sources'; sources: string[] }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'runtime'; backend: string; fallback: boolean; mode: string }
  | ChatTokenUsageStreamEvent;

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

function normalizePromptText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wantsImageGeneration(text: string, hasImageAttachments: boolean): boolean {
  const normalized = normalizePromptText(text);
  if (!normalized) return false;

  const generationVerb = /\b(generate|create|draw|illustrate|render|make|design|craft|produce)\b/;
  const imageNoun =
    /\b(image|picture|photo|illustration|art|artwork|drawing|logo|icon|poster|banner|thumbnail|wallpaper|background|avatar|sticker|meme|portrait)\b/;
  const editVerb =
    /\b(edit|modify|change|transform|recolor|restyle|remove|add|replace|retouch|crop|expand|extend|inpaint|outpaint|cleanup|clean up)\b/;

  if (hasImageAttachments && editVerb.test(normalized)) return true;
  if (/^(?:draw|illustrate|render)\b/.test(normalized)) return true;
  if (/^(?:logo|poster|banner|thumbnail|wallpaper|avatar|sticker|meme)\b/.test(normalized)) {
    return true;
  }

  return generationVerb.test(normalized) && imageNoun.test(normalized);
}

function imageGenerationAction(
  text: string,
  hasImageAttachments: boolean,
): 'generate' | 'edit' | 'auto' {
  const normalized = normalizePromptText(text);
  if (
    hasImageAttachments &&
    /\b(edit|modify|change|transform|recolor|restyle|remove|add|replace|retouch|crop|expand|extend|inpaint|outpaint)\b/.test(
      normalized,
    )
  ) {
    return 'edit';
  }

  return hasImageAttachments ? 'auto' : 'generate';
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

    return [
      {
        role,
        content: compactImageDataUrls(content),
      },
    ];
  });
}

function buildResponsesInput(
  messages: ChatRequestMessage[],
  attachments: Attachment[],
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
        : {
            type: 'message',
            role: 'user',
            content: message.content,
          };
    }

    // A document's `text` is its structured reading, so it belongs in the
    // same block as a plain text file rather than in one of its own.
    const textAttachments = attachments.filter(
      (attachment): attachment is Extract<Attachment, { type: 'text' | 'document' }> =>
        attachment.type === 'text' || attachment.type === 'document',
    );
    const imageAttachments = attachments.filter(
      (attachment): attachment is Extract<Attachment, { type: 'image' }> =>
        attachment.type === 'image',
    );

    // A mesh has no text of its own, so what was measured from it stands in.
    const modelAttachments = attachments.filter(
      (attachment): attachment is Extract<Attachment, { type: 'model' }> =>
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
        text: attachedText
          ? `${attachedText}\n\n---\n\n${message.content}`
          : message.content,
      },
    ];

    for (const image of imageAttachments) {
      contentParts.push({
        type: 'input_image',
        image_url: image.dataUrl,
        detail: 'auto',
      });
    }

    return {
      type: 'message',
      role: 'user',
      content: contentParts,
    };
  });
}

function emittedImageMarkdown(result: string): string {
  const trimmed = result.trim();
  const dataUrl = /^data:image\//i.test(trimmed)
    ? trimmed
    : `data:image/png;base64,${trimmed}`;
  return `\n\n![Generated image](${dataUrl})\n`;
}

function imageGenerationItemsFromUnknown(value: unknown): Array<{ id: string; result: string }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as JsonRecord;
    if (record.type !== 'image_generation_call' || typeof record.result !== 'string') {
      return [];
    }

    const id = typeof record.id === 'string' ? record.id : record.result.slice(0, 32);
    return [{ id, result: record.result }];
  });
}

function parseSelectedDocumentSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function parseActiveMarkdownContext(value: unknown): ActiveMarkdownContext | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as JsonRecord;
  const slug = typeof record.slug === 'string' ? record.slug.trim() : '';
  const content = typeof record.content === 'string' ? record.content.trim() : '';
  const title = typeof record.title === 'string' ? record.title.trim() : '';
  if (!slug || !content) return null;
  return { slug, title, content };
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as JsonRecord;
    const runtime = readHermesConfig();
    let legacyFallback = false;
    if (runtime.mode !== 'legacy') {
      try {
        return await openGardenAgentChat(payload, request.signal);
      } catch (error) {
        if (runtime.mode === 'required') return apiErrorResponse(error);
        legacyFallback = true;
        recordAuditEvent({
          eventType: 'fallback.used',
          payload: { surface: 'garden_chat', mode: runtime.mode, reason: 'hermes_runtime_failure' },
        });
      }
    }
    if (runtime.mode === 'legacy') {
      recordAuditEvent({ eventType: 'legacy.requested', payload: { surface: 'garden_chat' } });
    }
    const { baseURL } = resolveChatmockBaseUrl(request);
    const {
      messages,
      clusterSlug,
      model,
      thinking,
      reasoningEffort,
      attachments,
      selectedDocumentSlugs,
      activeMarkdown,
    } = payload;

    if (!Array.isArray(messages) || typeof clusterSlug !== 'string' || !clusterSlug.trim()) {
      return NextResponse.json({ error: 'messages and clusterSlug are required' }, { status: 400 });
    }

    const chatMessages = parseChatMessages(messages);
    if (chatMessages.length === 0) {
      return NextResponse.json({ error: 'At least one valid chat message is required' }, { status: 400 });
    }

    const { cluster } = await requireReadableClusterFromSlug(clusterSlug);
    const chatAttachments: Attachment[] = Array.isArray(attachments) ? attachments : [];
    const selectedSourceSlugs = parseSelectedDocumentSlugs(selectedDocumentSlugs);
    const activeMarkdownContext = parseActiveMarkdownContext(activeMarkdown);
    const selectedReasoningEffort = normalizeAssistantReasoningEffort(reasoningEffort, thinking);
    const thinkingEnabled = selectedReasoningEffort !== 'none';

    // Legacy mode gets the same retrieval gate as Hermes. Exact small-talk
    // turns need neither a full garden scan nor GraphRAG context; attachments
    // always keep the request on the normal multimodal/document path.
    const lastUserMessage = [...chatMessages].reverse().find((message) => message.role === 'user');
    const smallTalkReply =
      chatAttachments.length === 0
        ? resolveSmallTalkReply(lastUserMessage?.content ?? '')
        : null;
    if (smallTalkReply) {
      recordAuditEvent({
        eventType: 'small_talk.fast_path',
        gardenId: cluster.slug,
        payload: { intent: smallTalkReply.intent, backend: 'legacy' },
      });
      return smallTalkEventStream(smallTalkReply);
    }

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const knowledge = scanClusterKnowledge(contentPath, cluster.slug);

    const selectedFocusSlugs = new Set<string>();
    for (const slug of selectedSourceSlugs) {
      selectedFocusSlugs.add(slug);
      for (const edge of knowledge.edges) {
        if (edge.source === slug) {
          selectedFocusSlugs.add(edge.target);
        }
        if (edge.target === slug) {
          selectedFocusSlugs.add(edge.source);
        }
      }
      for (const node of knowledge.nodes) {
        if (node.sourceDocument === slug) {
          selectedFocusSlugs.add(node.slug);
        }
      }
    }

    const selectedSourceNodes = knowledge.nodes.filter((node) =>
      selectedSourceSlugs.includes(node.slug),
    );
    const selectedDocumentNodes = knowledge.nodes.filter((node) =>
      selectedFocusSlugs.has(node.slug),
    );
    const retrieval = await retrieveGraphRag({
      query: [
        lastUserMessage?.content ?? '',
        selectedSourceNodes.length > 0
          ? `Selected documents: ${selectedSourceNodes.map((node) => node.title).join(', ')}`
          : '',
      ].filter(Boolean).join('\n'),
      gardens: [{
        slug: cluster.slug,
        name: cluster.name,
        rootPath: path.join(contentPath, cluster.slug),
        knowledge,
      }],
      maxChunks: selectedSourceSlugs.length > 0 ? 12 : 8,
    });
    const retrievedNodes = retrieval.chunks
      .map((chunk) => knowledge.nodes.find((node) => node.relPath === chunk.pageRelPath))
      .filter((node): node is KnowledgeNode => Boolean(node));
    const selectedNodes = [...new Map(
      [...selectedDocumentNodes, ...retrievedNodes].map((node) => [node.slug, node]),
    ).values()];

    const graphContext = [
      `Cluster graph summary: ${knowledge.stats.documents} source documents, ${knowledge.stats.topics} extracted topics, ${knowledge.stats.links} links.`,
    ].join('\n');
    const notesContext = retrieval.context || 'No grounded chunk matched this query.';

    const selectedDocumentContext =
      selectedSourceNodes.length > 0
        ? `\n\nUser-selected uploaded documents already provided for this request:\n${selectedSourceNodes
            .map((node) => `- ${node.title} (${node.slug})`)
            .join('\n')}\nThe user selected these documents in the UI, so treat them as the material they have provided. Do not ask the user to send or upload material when selected documents are present. If the user asks you to transform, explain, reconstruct, summarize, study, or write from "the material", "the PDFs", "the selected documents", or similar wording, do the task immediately using these selected documents and their connected topic notes as the primary context unless the user explicitly asks to broaden the scope.`
        : '';

    const activeMarkdownPromptContext = activeMarkdownContext
      ? `\n\nThe user currently has this specific page open in Quartz. When the user says "this page", "this markdown", "the current file", "what I have open", or asks anything that could refer to the visible page, treat this as the primary context before broader garden context. Do not ask the user to paste the page when this context is present. The surrounding application can edit the open markdown file; do not claim you lack filesystem or Quartz vault write access. If an edit request reaches you as normal chat, provide the intended edit or explain what you would change rather than saying it is impossible.\n\n# ${activeMarkdownContext.title || activeMarkdownContext.slug}\nSlug: ${activeMarkdownContext.slug}\n\n${truncate(activeMarkdownContext.content, 16000)}`
      : '';

    let systemPrompt =
      // Same prose-first voice and minimal-background rule the Hermes surfaces
      // get, so an answer does not change shape with the runtime behind it.
      `${responseStylePrompt()}\n\n` +
      // Direct mode shapes an answer wherever it is answered, so the
      // legacy fallback carries it too rather than silently reverting the voice.
      (payload.adhdMode === true ? `${directModeSection()}\n\n` : '') +
      `You are a helpful assistant for the user's second brain garden '${cluster.name}'. ` +
      'Use the learning relationships and markdown pages as grounded context. ' +
      'You can answer questions about the Learning Map itself, including source documents, textbook pages, locations, page references, tags, and relationships. ' +
      'When the user asks where something appears, cite the note title and the Locations value from the context. ' +
      'When a question depends on uploaded material, mention the relevant source or textbook page names naturally. ' +
      'Always format mathematical expressions using LaTeX delimiters: ' +
      'use $...$ for inline math (e.g. $|\\Psi|^2$, $e^{i(kx-\\omega t)}$, $E = mc^2$) ' +
      'and $$...$$ on its own line for display/block equations. ' +
      'Never write math in plain text with ^ or bracket notation - always use proper LaTeX.\n\n' +
      `${graphContext}${selectedDocumentContext}${activeMarkdownPromptContext}\n\nGraphRAG-lite retrieved evidence (BM25, aliases, optional embeddings, and bounded one-hop relationships):\n\n${notesContext}`;

    // A mental-health turn is answered as a CBT copilot on every surface, and
    // this legacy garden route is one of them.
    const cognivia = cogniviaSection({ userText: lastUserMessage?.content ?? '' });
    if (cognivia) systemPrompt += `\n\n${cognivia}`;

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
        'Use the relevant notes and relationships to check your answer before responding.';
    }

    // Retrieved notes and Direct mode can shape content and layout, but the
    // last instruction still has to make the result usable to a new reader.
    systemPrompt += `\n\n${readerComprehensionPrompt()}`;

    const client = new OpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || 'local',
    });

    const selectedModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL;
    const hasImageAttachments = chatAttachments.some((attachment) => attachment.type === 'image');
    const shouldEnableImageGeneration = wantsImageGeneration(
      lastUserMessage?.content ?? '',
      hasImageAttachments,
    );

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
      ...(shouldEnableImageGeneration
        ? {
            tools: [
              {
                type: 'image_generation' as const,
                action: imageGenerationAction(lastUserMessage?.content ?? '', hasImageAttachments),
                background: 'auto' as const,
                output_format: 'png' as const,
                quality: 'auto' as const,
                size: 'auto' as const,
              },
            ],
            tool_choice: { type: 'image_generation' as const },
          }
        : {}),
    } satisfies ResponseCreateParamsStreaming;

    // Council routing: ChatMock reads and strips these fields. Requests that
    // carry tools (image generation) or image attachments bypass the council
    // inside ChatMock automatically.
    const councilSourceContext =
      selectedNodes.length > 0 || activeMarkdownContext
        ? {
            sourceTitles: selectedNodes
              .map((node) => node.fileName)
              .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
              .slice(0, 20),
            ...(activeMarkdownContext?.slug ? { activeMarkdownSlug: activeMarkdownContext.slug } : {}),
          }
        : undefined;

    const stream = await client.responses.create(
      withCouncil(responsesRequest, {
        taskType: 'page_assistant_answer',
        gardenId: clusterSlug,
        ...(activeMarkdownContext?.slug ? { pageId: activeMarkdownContext.slug } : {}),
        sourceContext: councilSourceContext,
      }),
    );

    const sourceNames = Array.from(
      new Set(
        [...selectedNodes.map((node) => node.fileName), ...urlLinkContext.sources].filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        ),
      ),
    );
    if (activeMarkdownContext?.title || activeMarkdownContext?.slug) {
      sourceNames.unshift(activeMarkdownContext.title || activeMarkdownContext.slug);
    }

    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const emittedImageIds = new Set<string>();
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

        function emitImagesFromUnknown(value: unknown) {
          for (const image of imageGenerationItemsFromUnknown(value)) {
            if (emittedImageIds.has(image.id)) continue;
            emittedImageIds.add(image.id);
            emitText('delta', emittedImageMarkdown(image.result));
          }
        }

        function emitUsageFromResponse(value: unknown) {
          if (usageEmitted) return;
          const payload = chatTokenUsageEventFromResponse(value);
          if (!payload) return;
          usageEmitted = true;
          emit(payload);
        }

        emit({ type: 'runtime', backend: 'legacy-chatmock', fallback: legacyFallback, mode: runtime.mode });
        emit({ type: 'sources', sources: sourceNames });

        // Images were already recovered from the finished item; the answer text
        // beside them was not. See lib/responses-stream-text.ts.
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
              emitImagesFromUnknown([event.item]);
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
              emitImagesFromUnknown(event.response.output);
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
        'X-Breadboard-AI-Backend': 'legacy-chatmock',
        'X-Breadboard-AI-Fallback': legacyFallback ? '1' : '0',
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
