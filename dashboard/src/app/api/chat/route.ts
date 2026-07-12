import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type {
  EasyInputMessage,
  ResponseCreateParamsStreaming,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses';
import { DEFAULT_MODEL } from '@/lib/ai-models';
import { buildUrlLinkContext } from '@/lib/url-link-context';
import { scanClusterKnowledge, type KnowledgeNode } from '@/lib/knowledge';
import { resolveChatmockBaseUrl } from '@/lib/chatmock-server';
import { withCouncil } from '@/lib/council';
import { requireReadableClusterFromSlug, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;
type Attachment =
  | { type: 'text'; text: string; name: string }
  | { type: 'image'; dataUrl: string; name: string };
type ChatRequestMessage = { role: 'user' | 'assistant'; content: string };
type ActiveMarkdownContext = {
  slug: string;
  title?: string;
  content: string;
};
type SsePayload =
  | { type: 'sources'; sources: string[] }
  | { type: 'delta'; text: string }
  | { type: 'thinking'; text: string };

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

    const textAttachments = attachments.filter(
      (attachment): attachment is Extract<Attachment, { type: 'text' }> =>
        attachment.type === 'text',
    );
    const imageAttachments = attachments.filter(
      (attachment): attachment is Extract<Attachment, { type: 'image' }> =>
        attachment.type === 'image',
    );

    const attachedText =
      textAttachments.length > 0
        ? textAttachments
            .map((attachment) => `--- Attached file: ${attachment.name} ---\n${attachment.text}`)
            .join('\n\n')
        : '';

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
    const { baseURL } = resolveChatmockBaseUrl(request);
    const {
      messages,
      clusterSlug,
      model,
      thinking,
      attachments,
      selectedDocumentSlugs,
      activeMarkdown,
    } = await request.json();

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
    const thinkingEnabled = Boolean(thinking);

    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json({ error: 'QUARTZ_CONTENT_PATH not configured' }, { status: 500 });
    }

    const knowledge = scanClusterKnowledge(contentPath, cluster.slug);
    const lastUserMessage = [...chatMessages].reverse().find((message) => message.role === 'user');
    const queryWords = tokenize(lastUserMessage?.content ?? '');

    const selectedSlugs = new Set<string>();
    const selectedFocusSlugs = new Set<string>();
    for (const slug of selectedSourceSlugs) {
      selectedSlugs.add(slug);
      selectedFocusSlugs.add(slug);
      for (const edge of knowledge.edges) {
        if (edge.source === slug) {
          selectedSlugs.add(edge.target);
          selectedFocusSlugs.add(edge.target);
        }
        if (edge.target === slug) {
          selectedSlugs.add(edge.source);
          selectedFocusSlugs.add(edge.source);
        }
      }
      for (const node of knowledge.nodes) {
        if (node.sourceDocument === slug) {
          selectedSlugs.add(node.slug);
          selectedFocusSlugs.add(node.slug);
        }
      }
    }

    const scored = knowledge.nodes
      .map((node) => ({ node, score: scoreNode(node, queryWords) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    for (const { node } of scored) selectedSlugs.add(node.slug);
    for (const { node } of scored.slice(0, 3)) {
      for (const edge of knowledge.edges) {
        if (edge.source === node.slug) selectedSlugs.add(edge.target);
        if (edge.target === node.slug) selectedSlugs.add(edge.source);
      }
    }

    const selectedSourceNodes = knowledge.nodes.filter((node) =>
      selectedSourceSlugs.includes(node.slug),
    );
    const selectedDocumentNodes = knowledge.nodes.filter((node) =>
      selectedFocusSlugs.has(node.slug),
    );
    const scoredNodes = knowledge.nodes.filter(
      (node) =>
        selectedSlugs.has(node.slug) &&
        !selectedDocumentNodes.some((selected) => selected.slug === node.slug),
    );
    const selectedNodes = [
      ...selectedDocumentNodes,
      ...scoredNodes,
    ].slice(0, selectedSourceSlugs.length > 0 ? 18 : 8);

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
      `You are a helpful assistant for the user's second brain garden '${cluster.name}'. ` +
      'Use the learning relationships and markdown pages as grounded context. ' +
      'You can answer questions about the Learning Map itself, including source documents, textbook pages, locations, page references, tags, and relationships. ' +
      'When the user asks where something appears, cite the note title and the Locations value from the context. ' +
      'When a question depends on uploaded material, mention the relevant source or textbook page names naturally. ' +
      'Always format mathematical expressions using LaTeX delimiters: ' +
      'use $...$ for inline math (e.g. $|\\Psi|^2$, $e^{i(kx-\\omega t)}$, $E = mc^2$) ' +
      'and $$...$$ on its own line for display/block equations. ' +
      'Never write math in plain text with ^ or bracket notation - always use proper LaTeX.\n\n' +
      `${graphContext}${selectedDocumentContext}${activeMarkdownPromptContext}\n\nCluster inventory:\n\n${clusterInventory}\n\nRelevant textbook pages:\n\n${notesContext}`;

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
              effort: 'high' as const,
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

        function emitImagesFromUnknown(value: unknown) {
          for (const image of imageGenerationItemsFromUnknown(value)) {
            if (emittedImageIds.has(image.id)) continue;
            emittedImageIds.add(image.id);
            emitText('delta', emittedImageMarkdown(image.result));
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
            } else if (event.type === 'response.output_item.done') {
              emitImagesFromUnknown([event.item]);
            } else if (event.type === 'response.completed') {
              emitImagesFromUnknown(event.response.output);
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
