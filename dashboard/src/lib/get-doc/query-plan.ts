// Where the model is allowed to help, and where it is not.
//
// Get Doc follows the same split as the hardware agent: the model reads intent,
// deterministic code owns the facts. So it does exactly two things here — turn a
// description of a paper into the search strings a catalog understands, and say
// in one sentence what each result is. It never invents a title, an author, a
// year or a link: those come from the catalogs and are passed through untouched.
//
// Both steps are best-effort. If ChatMock is down or answers with something
// unparseable, the search still runs on the user's own words and the list is
// still described from the published abstracts — a slower, blunter version of
// the same answer instead of no answer.

import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import type { DocumentHit } from "./types.ts";
import { summarizeAbstract } from "./search.ts";

const MODEL_TIMEOUT_MS = 90_000;

export interface SearchPlan {
  /** Search strings to send to the catalogs, best first. */
  queries: string[];
  yearFrom: number | null;
  yearTo: number | null;
  /** What the user is actually after, restated for the describing step. */
  intent: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export const NO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0 };

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function complete(input: {
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  messages: ChatMessage[];
}): Promise<{ content: string; usage: ModelUsage }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${chatmockApiKeyValue()}`,
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        reasoning_effort: input.reasoningEffort,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`ChatMock returned ${response.status}`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the JSON out of a reply. ChatMock inlines its reasoning summary as a
 * `<think>` block and models like to wrap JSON in a fence, so neither is
 * treated as a failure.
 */
export function extractJson(content: string): unknown {
  const withoutThinking = content
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/i, " ");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(withoutThinking);
  const candidates = [fenced?.[1], withoutThinking].filter(
    (value): value is string => typeof value === "string",
  );
  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  return null;
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((entry) => entry.slice(0, maxLength))
    .slice(0, maxItems);
}

function boundedYear(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 1500 && parsed < 2200 ? parsed : null;
}

const PLAN_SYSTEM = `You turn a request for academic literature into catalog search strings.

The request may name one specific paper ("the original ResNet paper", a title, a DOI) or describe a body of work ("papers on transformer efficiency in low-resource languages since 2020").

Answer with JSON only, in this shape:
{"queries": ["...", "..."], "yearFrom": null, "yearTo": null, "intent": "one sentence on what the user is looking for"}

Rules:
- 1 to 3 queries. The first must be the best single query.
- Queries are keyword strings for a scholarly search engine (OpenAlex, arXiv, Europe PMC). No boolean operators, no field prefixes, no quotes around the whole string.
- When a specific paper is named, the first query is its exact title, or the closest phrasing you are confident about. Never invent a title you are unsure of — use the user's own words instead.
- Set yearFrom/yearTo only when the request states or clearly implies a period. Otherwise null.
- Do not answer the research question. Do not list papers. Only produce the search.`;

/** Read the request the way a librarian would, and hand back the searches. */
export async function planSearch(input: {
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  task: string;
}): Promise<{ plan: SearchPlan; usage: ModelUsage; modelUsed: boolean }> {
  const fallback: SearchPlan = {
    queries: [input.task],
    yearFrom: null,
    yearTo: null,
    intent: input.task,
  };
  try {
    const { content, usage } = await complete({
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      messages: [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: input.task },
      ],
    });
    const parsed = extractJson(content);
    if (!parsed || typeof parsed !== "object") {
      return { plan: fallback, usage, modelUsed: false };
    }
    const plan = parsed as Record<string, unknown>;
    const queries = stringList(plan.queries, 3, 400);
    return {
      plan: {
        queries: queries.length ? queries : fallback.queries,
        yearFrom: boundedYear(plan.yearFrom),
        yearTo: boundedYear(plan.yearTo),
        intent:
          typeof plan.intent === "string" && plan.intent.trim()
            ? plan.intent.trim().slice(0, 600)
            : fallback.intent,
      },
      usage,
      modelUsed: queries.length > 0,
    };
  } catch {
    return { plan: fallback, usage: NO_USAGE, modelUsed: false };
  }
}

const DESCRIBE_SYSTEM = `You write one-sentence descriptions of academic papers for someone deciding which to download.

You are given what the person is looking for, and a numbered list of papers with their real metadata and abstracts.

Answer with JSON only:
{"documents": [{"id": "doc_1", "description": "..."}]}

Rules:
- One sentence per paper, at most 30 words: what the paper does, and how it relates to what was asked for.
- Ground every word in the metadata and abstract you were given. If a paper has no abstract, describe it from its title and venue and say no abstract was published.
- Never state a finding, a number, or a claim that is not in the text you were given.
- Keep the ids exactly as given, and include every paper.`;

/**
 * Replace the abstract-derived descriptions with ones written against what the
 * user asked for. Anything the model omits, mangles or invents an id for keeps
 * the deterministic description it already had.
 */
export async function describeDocuments(input: {
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  intent: string;
  documents: DocumentHit[];
}): Promise<{ documents: DocumentHit[]; usage: ModelUsage }> {
  if (!input.documents.length) return { documents: input.documents, usage: NO_USAGE };
  const catalog = input.documents
    .map((document) =>
      [
        `${document.id}:`,
        `  title: ${document.title}`,
        `  authors: ${document.authors.slice(0, 6).join(", ") || "unknown"}`,
        `  year: ${document.year ?? "unknown"}`,
        `  venue: ${document.venue ?? "unknown"}`,
        `  abstract: ${summarizeAbstract(document.abstract, 900) || "(none published)"}`,
      ].join("\n"),
    )
    .join("\n\n");

  try {
    const { content, usage } = await complete({
      baseUrl: input.baseUrl,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      messages: [
        { role: "system", content: DESCRIBE_SYSTEM },
        {
          role: "user",
          content: `Looking for: ${input.intent}\n\nPapers:\n\n${catalog}`,
        },
      ],
    });
    const parsed = extractJson(content);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown> | null)?.documents)
        ? ((parsed as Record<string, unknown>).documents as unknown[])
        : [];
    const written = new Map<string, string>();
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const description = typeof row.description === "string" ? row.description.trim() : "";
      if (id && description) written.set(id, description.replace(/\s+/g, " ").slice(0, 400));
    }
    return {
      documents: input.documents.map((document) => ({
        ...document,
        description: written.get(document.id) ?? document.description,
      })),
      usage,
    };
  } catch {
    return { documents: input.documents, usage: NO_USAGE };
  }
}
