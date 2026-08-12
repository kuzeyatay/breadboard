// ChatMock is the world monitor's only AI layer.
//
// Upstream worldmonitor runs a provider chain (Ollama → OpenRouter → Groq) with
// per-provider entitlement gates, circuit breakers and Redis caching. None of
// that travels: Breadboard already has one place where "which model answers"
// is decided — the Intelligence picker, resolved by `selectedModelForUser` —
// and ChatMock already fans out to whichever provider that names. So the three
// AI operations here are plain chat completions against the user's ChatMock.

import OpenAI from "openai";

import { DEFAULT_MODEL, normalizeAssistantModelId } from "@/lib/ai-models";
import {
  normalizeAssistantReasoningEffort,
  toOpenAiReasoningEffort,
  type AssistantReasoningEffort,
} from "@/lib/assistant-reasoning";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { selectedModelForUser } from "@/lib/selected-model";

import {
  buildAnalystSystemPrompt,
  buildBriefPrompts,
  CLASSIFY_SYSTEM_PROMPT,
  sanitizeForPrompt,
} from "./prompts.ts";
import type {
  EventCategory,
  NewsItem,
  ThreatClassification,
  ThreatLevel,
} from "./types.ts";

export interface ChatMockContext {
  client: OpenAI;
  model: string;
  reasoningEffort: AssistantReasoningEffort;
}

/**
 * The model is whatever the reader has selected in a chat composer, sent with
 * the request and validated here; the stored Intelligence preference is the
 * fallback for a caller that sends nothing. Picking a model in chat therefore
 * changes who writes the brief, with no separate setting for this page.
 */
export function chatmockFor(
  request: Request,
  userId: number | null,
  preference: { model?: unknown; reasoningEffort?: unknown } = {},
): ChatMockContext {
  const { baseURL } = resolveChatmockBaseUrl(request);
  const requested = normalizeAssistantModelId(preference.model);

  return {
    client: new OpenAI({ baseURL, apiKey: process.env.OPENAI_API_KEY || "local" }),
    model: requested ?? selectedModelForUser(userId) ?? DEFAULT_MODEL,
    reasoningEffort: normalizeAssistantReasoningEffort(preference.reasoningEffort, true),
  };
}

/**
 * ChatMock rejects a reasoning effort on models that have no reasoning notion,
 * so the parameter only rides along when one was actually chosen.
 */
function reasoning(ctx: ChatMockContext): { reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" } {
  if (ctx.reasoningEffort === "none") return {};
  return { reasoning_effort: toOpenAiReasoningEffort(ctx.reasoningEffort) };
}

// ── Brief ───────────────────────────────────────────────────────────────────

/** Headlines the brief is grounded in — the ranked top of the window. */
const BRIEF_HEADLINES = 24;

export async function generateBrief(
  ctx: ChatMockContext,
  items: NewsItem[],
  scopeLabel: string,
  /** Climate readings and hazard alerts, when the archives answered. */
  measured = "",
): Promise<{ text: string; model: string }> {
  const { system, user } = buildBriefPrompts(
    items.slice(0, BRIEF_HEADLINES),
    scopeLabel,
    measured,
  );

  const response = await ctx.client.chat.completions.create({
    model: ctx.model,
    ...reasoning(ctx),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return {
    text: (response.choices[0]?.message?.content ?? "").trim(),
    model: response.model || ctx.model,
  };
}

// ── Analyst ─────────────────────────────────────────────────────────────────

export interface AnalystTurn {
  role: "user" | "assistant";
  content: string;
}

const ANALYST_HEADLINES = 60;

/** Streams the analyst's answer as plain text chunks. */
export async function streamAnalystAnswer(
  ctx: ChatMockContext,
  params: {
    question: string;
    history: AnalystTurn[];
    items: NewsItem[];
    escalation: number;
    scopeLabel: string;
    measured?: string;
  },
): Promise<ReadableStream<Uint8Array>> {
  const system = buildAnalystSystemPrompt(params.items.slice(0, ANALYST_HEADLINES), {
    escalation: params.escalation,
    scopeLabel: params.scopeLabel,
    measured: params.measured,
  });

  const stream = await ctx.client.chat.completions.create({
    model: ctx.model,
    stream: true,
    ...reasoning(ctx),
    messages: [
      { role: "system", content: system },
      ...params.history.slice(-6).map((turn) => ({
        role: turn.role,
        content: turn.content.slice(0, 4000),
      })),
      { role: "user", content: params.question.slice(0, 2000) },
    ],
  });

  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "stream failed";
        controller.enqueue(encoder.encode(`\n\n_Interrupted: ${message}_`));
      } finally {
        controller.close();
      }
    },
  });
}

// ── Classification refinement ───────────────────────────────────────────────

const VALID_LEVELS = new Set<ThreatLevel>(["critical", "high", "medium", "low", "info"]);
const VALID_CATEGORIES = new Set<EventCategory>([
  "conflict", "protest", "disaster", "diplomatic", "economic", "terrorism",
  "cyber", "health", "environmental", "military", "crime", "infrastructure",
  "tech", "general",
]);

function parseClassifications(content: string): Map<number, ThreatClassification> {
  const out = new Map<number, ThreatClassification>();
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return out;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const n = typeof record.n === "number" ? record.n : Number(record.n);
    const level = String(record.level ?? "") as ThreatLevel;
    const category = String(record.category ?? "") as EventCategory;
    if (!Number.isInteger(n) || !VALID_LEVELS.has(level) || !VALID_CATEGORIES.has(category)) {
      continue;
    }
    out.set(n, { level, category, confidence: 0.9, source: "llm" });
  }
  return out;
}

/**
 * Second read on the headlines the keyword cascade is least sure about.
 *
 * The cascade is fast and free but literal: anything whose wording it does not
 * recognise falls to `info/general`, which is where a genuinely serious story
 * in unusual words ends up. This sends that ambiguous set — one batched call,
 * not one per headline — to ChatMock with upstream's classifier prompt, and
 * returns a map of id → refined classification. A malformed or failed response
 * changes nothing; the keyword verdict stands.
 */
export async function refineClassifications(
  ctx: ChatMockContext,
  items: NewsItem[],
  budget = 20,
): Promise<Map<string, ThreatClassification>> {
  const ambiguous = items
    .filter((item) => item.threat.source === "keyword" && item.threat.confidence <= 0.6)
    .slice(0, budget);
  if (ambiguous.length === 0) return new Map();

  const numbered = ambiguous
    .map((item, index) => `${index + 1}. ${sanitizeForPrompt(item.title)}`)
    .join("\n");

  try {
    const response = await ctx.client.chat.completions.create({
      model: ctx.model,
      temperature: 0,
      // Labelling headlines against a fixed rubric is not a thinking task, and
      // the reader picked their effort for answers, not for bookkeeping.
      reasoning_effort: "low",
      messages: [
        { role: "system", content: CLASSIFY_SYSTEM_PROMPT },
        { role: "user", content: numbered },
      ],
    });

    const byIndex = parseClassifications(response.choices[0]?.message?.content ?? "");
    const byId = new Map<string, ThreatClassification>();
    for (const [n, classification] of byIndex) {
      const item = ambiguous[n - 1];
      if (item) byId.set(item.id, classification);
    }
    return byId;
  } catch {
    return new Map();
  }
}
