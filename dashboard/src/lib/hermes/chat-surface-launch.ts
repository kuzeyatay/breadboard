import db from "../db.ts";
import type { ConversationRow } from "../conversations/store.ts";

/**
 * Where a chat lives, so a surface showing it from elsewhere (the Terminal hub,
 * a Garden workspace opening a linked chat) can launch the chat's own surface.
 *
 * - `workspace`: a Garden workspace chat.
 * - `code`: Bread inside the Code tab's VS Code.
 * - `explore`: the Assistant beside a Garden's Quartz reader, on one page.
 * - `pdf`: the PDF Assistant beside one document.
 * - `browser`: the browser drawer on a website. The site is remembered per
 *   device by the drawer, so the client resolves it.
 * - `terminal`: the Terminal itself (voice, side chats, messaging, plain chats).
 */
export type ChatSurfaceKind = "terminal" | "workspace" | "explore" | "pdf" | "browser" | "code";

export interface ChatSurfaceLaunch {
  kind: ChatSurfaceKind;
  /** Same-origin address that opens the surface on this chat; null when none is known. */
  href: string | null;
  gardenSlug?: string | null;
  /** Explore: the reader page (Quartz slug or `file:<id>`). */
  pageKey?: string | null;
  /** Workspace/Explore: the numbered chat that surface selects. */
  legacyChatId?: number | null;
  /** PDF: the document key the assistant groups its chats under. */
  pageSlug?: string | null;
}

/** The assistant query parameter a surface reads to open one chat on arrival. */
export const ASSISTANT_CHAT_PARAM = "assistantChat";

/**
 * Only a path on this origin may be stored: launching it navigates the app, so
 * a scheme or protocol-relative host would send the reader somewhere else.
 */
export function normalizeSurfaceHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (!href.startsWith("/") || href.startsWith("//") || href.length > 2048) return null;
  if (/[\\\p{Cc}]/u.test(href)) return null;
  return href;
}

function withParam(href: string, key: string, value: string): string {
  const url = new URL(href, "http://breadboard.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

interface LegacyChatRow {
  id: number;
  history_surface: string;
  page_key: string | null;
  slug: string | null;
}

export function conversationSurfaceLaunch(
  conversation: ConversationRow,
  input: { pageSlug: string | null; gardenSlug: string | null },
  database = db,
): ChatSurfaceLaunch {
  const label = conversation.origin_label ?? "";
  if (label === "PDF" || label === "PDF Assistant") {
    const stored = normalizeSurfaceHref(conversation.surface_href);
    return {
      kind: "pdf",
      href: stored ? withParam(stored, ASSISTANT_CHAT_PARAM, conversation.public_id) : null,
      pageSlug: input.pageSlug,
      gardenSlug: input.gardenSlug,
    };
  }
  if (label === "Browser") return { kind: "browser", href: null };
  // A Code chat is also a workspace chat of the Garden VS Code had open, but
  // its own surface is Bread: launching it opens the Code tab on the chat.
  if (label === "Code") return { kind: "code", href: "/code", gardenSlug: input.gardenSlug };

  const legacy = database.prepare(
    `SELECT cs.id, cs.history_surface, cs.page_key, c.slug
       FROM chat_sessions cs LEFT JOIN clusters c ON c.id = cs.cluster_id
      WHERE cs.id = ? OR cs.conversation_id = ?
      ORDER BY (cs.id = ?) DESC LIMIT 1`,
  ).get(
    conversation.legacy_chat_session_id ?? -1,
    conversation.id,
    conversation.legacy_chat_session_id ?? -1,
  ) as LegacyChatRow | undefined;
  const slug = legacy?.slug ?? input.gardenSlug;
  if (legacy && slug && legacy.history_surface === "assistant") {
    const pageKey = legacy.page_key ?? "";
    const params = new URLSearchParams();
    if (pageKey.startsWith("file:")) {
      params.set("file", pageKey.slice(5));
      params.set("fileGarden", slug);
    } else if (pageKey) {
      params.set("note", pageKey);
    }
    params.set("chat", "1");
    return {
      kind: "explore",
      href: `/garden/${encodeURIComponent(slug)}?${params}`,
      gardenSlug: slug,
      pageKey,
      legacyChatId: legacy.id,
    };
  }
  if (legacy && slug && conversation.surface === "garden_chat") {
    return {
      kind: "workspace",
      href: `/gardens/${encodeURIComponent(slug)}?chat=${legacy.id}`,
      gardenSlug: slug,
      legacyChatId: legacy.id,
    };
  }
  return { kind: "terminal", href: null };
}

/** Record where a chat's own surface is, once it has been opened there. */
export function setConversationSurfaceHref(
  conversation: ConversationRow,
  href: string | null,
  database = db,
): void {
  database.prepare("UPDATE conversations SET surface_href = ? WHERE id = ?")
    .run(href, conversation.id);
}
