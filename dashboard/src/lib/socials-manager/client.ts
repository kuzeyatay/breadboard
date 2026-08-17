// Drafting through ChatMock.
//
// Postiz's own AI features run inside its NestJS app against its Prisma models;
// Breadboard already has a model gateway, so the drafting step is a single
// structured ChatMock call instead. Structured output is taken in tool mode
// rather than as free text — the same approach Deep Research uses — because a
// forced tool call is the only shape ChatMock reliably returns as strict JSON.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { breadSystemPrompt } from "../assistant-identity.ts";
import { nowStamp, parseStamp } from "../calendar/wallclock.ts";
import { findSocialsManagerProvider, type SocialsManagerProvider } from "./providers.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface DraftedPost {
  providerId: string;
  content: string;
  /** Wall-clock stamp the model proposed, when it proposed one. */
  scheduledAt: string | null;
}

export interface DraftRequest {
  baseUrl: string;
  model: string;
  brief: string;
  providers: readonly SocialsManagerProvider[];
  /** When the user pinned a time, the model is told to use exactly this. */
  scheduleAt: string | null;
  /** The chat this was launched from, so a request can refer back to it. */
  conversationContext?: string;
  signal?: AbortSignal;
  /** Raw `usage` from the drafting completion, so the run can count tokens. */
  onUsage?: (usage: unknown) => void;
}

const DRAFT_TIMEOUT_MS = 180_000;

function toolDefinition(providers: readonly SocialsManagerProvider[]) {
  return {
    type: "function" as const,
    function: {
      name: "publish_drafts",
      description:
        "Return one finished post per requested network. Never return more than one post for the same network.",
      parameters: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            description: "One entry per requested network, in the order given.",
            items: {
              type: "object",
              properties: {
                network: {
                  type: "string",
                  enum: providers.map((provider) => provider.id),
                  description: "The network identifier this copy is written for.",
                },
                content: {
                  type: "string",
                  description:
                    "The post exactly as it should be published. No surrounding quotes, no commentary.",
                },
                scheduledAt: {
                  type: "string",
                  description:
                    'Proposed publish time as "YYYY-MM-DDTHH:MM" local wall-clock. Omit if no time was requested.',
                },
              },
              required: ["network", "content"],
              additionalProperties: false,
            },
          },
        },
        required: ["posts"],
        additionalProperties: false,
      },
    },
  };
}

function systemPrompt(
  providers: readonly SocialsManagerProvider[],
  scheduleAt: string | null,
  now: string,
): string {
  const lines = providers.map((provider) => {
    const editor =
      provider.editor === "markdown"
        ? "markdown is supported"
        : provider.editor === "html"
          ? "basic HTML is supported"
          : "plain text only, no markdown syntax";
    const note = provider.note ? ` (${provider.note})` : "";
    return `- ${provider.name} (${provider.id}): at most ${provider.maxCharacters} characters${note}; ${editor}.`;
  });

  return breadSystemPrompt([
    "You are a social media copywriter. Write finished posts, not drafts to be edited and not descriptions of posts.",
    "",
    "Write for these networks:",
    ...lines,
    "",
    "Rules:",
    "- Write each network's post natively. Do not paste the same text into every network; match each one's length, tone and conventions.",
    "- Stay strictly inside each character limit. A post that exceeds its limit is unusable.",
    "- Use hashtags only where the network's culture expects them, and sparingly.",
    "- Never invent statistics, quotes, prices, dates or links. If the brief does not supply a fact, write around it.",
    "- No emoji unless the brief asks for them.",
    "- Return the post text only — no headings, labels, surrounding quotes or explanations.",
    "",
    `The current local time is ${now}.`,
    scheduleAt
      ? `The user pinned the publish time: set scheduledAt to exactly "${scheduleAt}" on every post.`
      : "If the brief implies a publish time, set scheduledAt for each post; otherwise omit it.",
  ].join("\n"));
}

function parseDrafts(
  raw: unknown,
  providers: readonly SocialsManagerProvider[],
  fallbackSchedule: string | null,
): DraftedPost[] {
  if (!raw || typeof raw !== "object") return [];
  const posts = (raw as { posts?: unknown }).posts;
  if (!Array.isArray(posts)) return [];

  const allowed = new Set(providers.map((provider) => provider.id));
  const seen = new Set<string>();
  const drafts: DraftedPost[] = [];

  for (const entry of posts) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const network =
      typeof candidate.network === "string" ? candidate.network.trim().toLowerCase() : "";
    const provider = findSocialsManagerProvider(network);
    if (!provider || !allowed.has(provider.id) || seen.has(provider.id)) continue;

    const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
    if (!content) continue;

    const proposed =
      typeof candidate.scheduledAt === "string" && parseStamp(candidate.scheduledAt)
        ? candidate.scheduledAt.trim()
        : null;

    seen.add(provider.id);
    drafts.push({
      providerId: provider.id,
      // The limit is enforced again in the store; truncating here keeps a
      // slightly-over draft usable instead of rejecting the whole run.
      content: content.slice(0, provider.maxCharacters),
      scheduledAt: fallbackSchedule ?? proposed,
    });
  }

  return drafts;
}

/** Ask the model for one finished post per requested network. */
export async function draftPosts(request: DraftRequest): Promise<DraftedPost[]> {
  if (!request.providers.length) return [];

  const base = request.baseUrl.replace(/\/$/, "");
  const url = base.endsWith("/v1")
    ? `${base}/chat/completions`
    : `${base}/v1/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRAFT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onAbort);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          {
            role: "system",
            content: systemPrompt(request.providers, request.scheduleAt, nowStamp()),
          },
          {
            role: "user",
            content: promptWithContext(request.brief, request.conversationContext),
          },
        ],
        tools: [toolDefinition(request.providers)],
        tool_choice: {
          type: "function",
          function: { name: "publish_drafts" },
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ChatMock returned ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{ function?: { arguments?: string } }>;
          content?: string;
        };
      }>;
      usage?: unknown;
    };

    // Report before parsing: the tokens were spent even when the drafts that
    // came back are unusable, and the card should say so.
    if (data.usage) request.onUsage?.(data.usage);

    const call = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!call) throw new Error("ChatMock returned no drafts");

    let parsed: unknown;
    try {
      parsed = JSON.parse(call);
    } catch {
      throw new Error("ChatMock returned malformed drafts");
    }

    const drafts = parseDrafts(parsed, request.providers, request.scheduleAt);
    if (!drafts.length) throw new Error("ChatMock returned no usable drafts");
    return drafts;
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
}
