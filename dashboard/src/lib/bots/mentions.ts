// @mentions for bots — how a message names a teammate, shared by the composer
// picker (client) and the turn services (server). Kept import-free.
//
// The grammar follows rakazo's group mentions (packages/core/src/composer/
// group-mentions.ts) and orgo-teammates' rooms: `@handle` that stands apart
// from the text around it, never inside code or a link, so "a@sage.com",
// "x.com/@sage" and `@sage` in backticks name nobody.

import type { BotDefinition } from "./types.ts";

/** Bread, the primary bot: Breadboard's own runtime (Hermes) with no persona. */
export const BREAD_BOT_HANDLE = "bread";

/** Bread in the roster and picker. It keeps its own picture (public/avatars/bread.svg), not a bot avatar. */
export const BREAD_BOT = {
  id: BREAD_BOT_HANDLE,
  handle: BREAD_BOT_HANDLE,
  name: "Bread",
  description: "Your primary bot: Breadboard's own assistant, with every tool, memory and skill. It answers when nobody is named and can hand work to the others.",
} as const;

/** The handle a bot is mentioned by: its name, lowercased, words joined by "-". */
export function botHandle(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Fenced code, inline code, and links (with or without a scheme).
const QUOTED = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/gi;
// "@" not glued to a word, address, or path before it.
const MENTION = /(?<![\p{L}\p{N}_.@/\\+-])@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/giu;

/** Handles from `known` that `text` @mentions, in order of first mention, each once. */
export function mentionedHandles(text: string, known: Iterable<string>): string[] {
  const handles = new Set(known);
  const prose = text.replace(QUOTED, (match) => " ".repeat(match.length));
  const found: string[] = [];
  for (const match of prose.matchAll(MENTION)) {
    const handle = match[1]!.toLowerCase();
    if (handles.has(handle) && !found.includes(handle)) found.push(handle);
  }
  return found;
}

/** The `@handle` token the caret is in, for the composer picker; null when none. */
export function mentionQueryAt(
  value: string,
  caret: number | null | undefined,
): { query: string; start: number; end: number } | null {
  const position = Math.max(0, Math.min(typeof caret === "number" ? caret : value.length, value.length));
  let start = position;
  while (start > 0 && !/\s/.test(value[start - 1]!)) start -= 1;
  let end = position;
  while (end < value.length && !/\s/.test(value[end]!)) end += 1;
  const token = value.slice(start, end);
  if (!/^@[a-z0-9-]*$/i.test(token)) return null;
  return { query: token.slice(1).toLowerCase(), start, end };
}

/** A bot the user owns, by the handle it is mentioned with (first name wins a tie). */
export function botByHandle(bots: readonly BotDefinition[], handle: string): BotDefinition | null {
  return bots.find((bot) => botHandle(bot.name) === handle) ?? null;
}

export interface TurnBot {
  /** The bot answering this message; null is Bread. */
  respondent: BotDefinition | null;
  /** Bots named in the message, besides the respondent, that Bread should brief. */
  coordinate: BotDefinition[];
}

/** Pure routing, kept apart from the store so it can be checked alone. */
export function routeTurn(
  text: string,
  bots: readonly BotDefinition[],
  conversationBot: BotDefinition | null,
): TurnBot {
  const handles = mentionedHandles(text, [BREAD_BOT_HANDLE, ...bots.map((bot) => botHandle(bot.name))]);
  const named = handles
    .map((handle) => botByHandle(bots, handle))
    .filter((bot): bot is BotDefinition => bot !== null);
  if (handles.includes(BREAD_BOT_HANDLE)) return { respondent: null, coordinate: named };
  if (named.length === 1) return { respondent: named[0]!, coordinate: [] };
  if (named.length > 1) return { respondent: null, coordinate: named };
  return { respondent: conversationBot, coordinate: [] };
}

