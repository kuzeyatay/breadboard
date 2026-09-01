// A chat reference is a context selector, not a capability grant. It uses the
// same leading-token grammar as skills and agents so it can be stacked with
// them, while remaining safe to type and paste as one whitespace-free token.

export const CHAT_REFERENCE_PREFIX = "reference:";

const LEADING_TOKEN = /^\/([a-z0-9][a-z0-9_.:-]*)(?:\s+|$)/i;

export interface ParsedChatReferenceCommand {
  /** Reference keys in the order they appeared. More than one is invalid. */
  keys: string[];
  /** The request with only /reference:* selectors removed. */
  userText: string;
}

/** A readable, slash-token-safe version of a chat title. */
export function chatReferenceTitleSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "chat";
}

/**
 * Stable key inserted by the Reference tab. The readable title is followed by
 * the conversation's opaque public id so duplicate or later-renamed chats can
 * never make a previously inserted selector point somewhere else.
 */
export function chatReferenceKey(input: {
  title: string;
  publicId: string;
}): string {
  return `${chatReferenceTitleSlug(input.title)}.${input.publicId.toLowerCase()}`;
}

/** Recover the stable id suffix even if the chat was renamed after insertion. */
export function chatReferencePublicId(key: string): string | null {
  const marker = key.toLowerCase().lastIndexOf(".conv_");
  if (marker < 0) return null;
  const publicId = key.slice(marker + 1);
  return /^conv_[a-z0-9_-]+$/i.test(publicId) ? publicId.toLowerCase() : null;
}

export function isChatReferenceToken(token: string): boolean {
  return token.toLowerCase().startsWith(CHAT_REFERENCE_PREFIX);
}

/**
 * Parse references only from the leading slash-selector run. A mention in
 * prose or code is ordinary text, matching the rest of the capability parser.
 */
export function parseChatReferenceCommand(
  value: string,
): ParsedChatReferenceCommand {
  let remaining = value.trimStart();
  const kept: string[] = [];
  const keys: string[] = [];

  while (remaining.startsWith("/")) {
    const match = LEADING_TOKEN.exec(remaining);
    if (!match) break;
    const raw = match[1];
    const normalized = raw.toLowerCase();
    if (isChatReferenceToken(normalized)) {
      const key = normalized.slice(CHAT_REFERENCE_PREFIX.length);
      if (key) keys.push(key);
    } else {
      kept.push(`/${raw}`);
    }
    remaining = remaining.slice(match[0].length).trimStart();
  }

  return {
    keys,
    userText: [...kept, remaining].filter(Boolean).join(" ").trim(),
  };
}
