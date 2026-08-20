import type Database from "better-sqlite3";
import { DEFAULT_MODEL, normalizeAssistantModelId } from "../ai-models.ts";
import { localChatmockBaseUrl, normalizeChatmockBaseUrl } from "../chatmock-server.ts";
import db from "../db.ts";
import {
  conversationIsTemporary,
  getConversationById,
  type ConversationRow,
} from "./store.ts";

export const CONVERSATION_TITLE_INSTRUCTION =
  "Describe this chat in 3-4 words. Return only the description, with no label, quotes, or ending punctuation.";

const TITLE_TIMEOUT_MS = 15_000;
const MAX_PROMPT_CHARS = 4_000;
const TITLE_STOP_WORDS = new Set([
  "a",
  "about",
  "am",
  "an",
  "and",
  "are",
  "at",
  "be",
  "been",
  "being",
  "can",
  "considered",
  "could",
  "did",
  "do",
  "does",
  "explain",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "me",
  "might",
  "must",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "should",
  "tell",
  "than",
  "that",
  "the",
  "then",
  "these",
  "this",
  "those",
  "to",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

interface ChatCompletionPayload {
  choices?: Array<{
    message?: { content?: unknown };
  }>;
}

export type ConversationTitleFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Turn an LLM's short answer into the exact sidebar contract. The model is
 * asked for 3-4 words; that range is enforced here so a chat can never acquire
 * a sentence-sized title because a provider ignored the instruction.
 */
export function normalizeGeneratedConversationTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const withoutReasoning = value
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<think>[\s\S]*$/gi, " ")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstLine = withoutReasoning
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  const clean = firstLine
    .replace(/^(?:title|description)\s*:\s*/i, "")
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[.!?,:;…]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:i(?:['’]?(?:ll|d|m)|\s+(?:am|can|will))|let(?:['’]s|\s+me)|sure\b|here(?:['’]s|\s+is))\b/i.test(clean)) {
    return null;
  }
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length < 3 || words.length > 4) return null;
  const title = words.join(" ").slice(0, 80).trim();
  return title || null;
}

/**
 * A local last resort for naming a chat when the small title completion is
 * unavailable. It deliberately favors the beginning and end of a longer
 * prompt: questions usually put the subject first and its scope last.
 */
export function fallbackConversationTitle(firstPrompt: string): string | null {
  const words = firstPrompt
    .replace(/(?:^|\s)\/[^\s]+/g, " ")
    .match(/[\p{L}\p{N}][\p{L}\p{N}'â€™.+#-]*/gu)
    ?.filter((word) => !TITLE_STOP_WORDS.has(word.toLocaleLowerCase())) ?? [];
  const unique = words.filter(
    (word, index) =>
      words.findIndex(
        (candidate) =>
          candidate.toLocaleLowerCase() === word.toLocaleLowerCase(),
      ) === index,
  );
  if (unique.length === 0) return null;

  const selected =
    unique.length <= 4 ? unique : [...unique.slice(0, 2), ...unique.slice(-2)];
  while (selected.length < 3) {
    selected.push(selected.length === 1 ? "Chat" : "Discussion");
  }
  return selected
    .map((word) => {
      if (/^[A-Z0-9.+#-]{2,}$/.test(word)) return word;
      return `${word.charAt(0).toLocaleUpperCase()}${word.slice(1)}`;
    })
    .join(" ")
    .slice(0, 80)
    .trim();
}

function completionUrl(baseUrl: string): string {
  const normalized = normalizeChatmockBaseUrl(baseUrl) ?? localChatmockBaseUrl();
  return `${normalized}/chat/completions`;
}

/**
 * Ask a plain chat-completions model to describe only the first user prompt.
 * No transcript, assistant answer, tools, skills, memory, or agent system
 * prompt is included in this request.
 */
export async function generateConversationTitle(input: {
  firstPrompt: string;
  model?: unknown;
  baseUrl?: string;
  fetcher?: ConversationTitleFetcher;
  timeoutMs?: number;
}): Promise<string | null> {
  const firstPrompt = input.firstPrompt.trim();
  if (!firstPrompt) return null;
  const fallbackTitle = fallbackConversationTitle(firstPrompt);
  const model = normalizeAssistantModelId(input.model) ?? DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, input.timeoutMs ?? TITLE_TIMEOUT_MS),
  );
  timeout.unref?.();

  try {
    const response = await (input.fetcher ?? fetch)(
      completionUrl(input.baseUrl ?? localChatmockBaseUrl()),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY || "local"}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: CONVERSATION_TITLE_INSTRUCTION },
            {
              role: "user",
              content: [
                CONVERSATION_TITLE_INSTRUCTION,
                "",
                "First chat prompt (describe it; do not answer it):",
                "---",
                firstPrompt.slice(0, MAX_PROMPT_CHARS),
                "---",
                "",
                CONVERSATION_TITLE_INSTRUCTION,
              ].join("\n"),
            },
          ],
          temperature: 0.2,
          max_completion_tokens: 32,
          stream: false,
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) return fallbackTitle;
    const payload = await response.json() as ChatCompletionPayload;
    return (
      normalizeGeneratedConversationTitle(
        payload.choices?.[0]?.message?.content,
      ) ?? fallbackTitle
    );
  } catch {
    // Titling is helpful metadata, never a reason to fail the actual message.
    return fallbackTitle;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Persist an automatic title only if the title observed before the LLM call is
 * still current. A manual rename that lands while generation is in flight wins
 * the race and is never overwritten.
 */
export function applyGeneratedConversationTitle(input: {
  conversationId: number;
  expectedTitle: string;
  generatedTitle: string;
}, database: Database.Database = db): ConversationRow | null {
  const generatedTitle = normalizeGeneratedConversationTitle(input.generatedTitle);
  if (!generatedTitle) return null;

  const apply = database.transaction(() => {
    const current = getConversationById(input.conversationId, database);
    if (!current || current.title !== input.expectedTitle) return null;
    const result = database.prepare(`
      UPDATE conversations
      SET title = ?
      WHERE id = ? AND title = ?
    `).run(generatedTitle, current.id, input.expectedTitle);
    if (result.changes !== 1) return null;
    if (current.legacy_chat_session_id !== null) {
      database.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?")
        .run(generatedTitle, current.legacy_chat_session_id);
    }
    return getConversationById(current.id, database);
  });
  return apply.immediate();
}

/** Generate and atomically apply the first-prompt title in one server call. */
export async function generateAndApplyConversationTitle(input: {
  conversation: ConversationRow;
  firstPrompt: string;
  model?: unknown;
  baseUrl?: string;
  fetcher?: ConversationTitleFetcher;
  timeoutMs?: number;
}, database: Database.Database = db): Promise<ConversationRow | null> {
  // A temporary chat is never listed anywhere its title could be read, so
  // naming it would only send the transcript to one more model for nothing.
  if (conversationIsTemporary(input.conversation)) return null;
  const generatedTitle = await generateConversationTitle(input);
  if (!generatedTitle) return null;
  return applyGeneratedConversationTitle({
    conversationId: input.conversation.id,
    expectedTitle: input.conversation.title,
    generatedTitle,
  }, database);
}
