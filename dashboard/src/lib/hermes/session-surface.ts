import db from "../db.ts";
import type { ConversationRow } from "../conversations/store.ts";
import { conversationOriginLabel } from "../conversations/origin-label.ts";
import type { HermesSurface } from "./config.ts";
import { getRuntimeSessionByConversation } from "./runtime-store.ts";

/** Call only after getConversationForUser has established ownership. */
export function conversationRequestSurface(
  conversation: Pick<ConversationRow, "surface">,
  requestedSurface: HermesSurface,
): HermesSurface {
  return requestedSurface === "dashboard_terminal"
    ? conversation.surface
    : requestedSurface;
}

export function conversationOrigin(conversation: ConversationRow) {
  const garden = conversation.default_garden_id === null ? null : db.prepare(
    "SELECT name, slug FROM clusters WHERE id = ?",
  ).get(conversation.default_garden_id) as { name: string; slug: string } | undefined;
  const legacy = conversation.legacy_chat_session_id === null ? null : db.prepare(
    "SELECT history_surface FROM chat_sessions WHERE id = ?",
  ).get(conversation.legacy_chat_session_id) as { history_surface: string } | undefined;
  return {
    gardenSlug: garden?.slug ?? null,
    originLabel: conversation.origin_label || conversationOriginLabel({
      surface: conversation.surface,
      gardenName: garden?.name,
      historySurface: legacy?.history_surface,
    }),
  };
}

/** The hub continues the source chat without clearing its garden/page context. */
export function conversationRequestContext<T extends {
  activeGardenSlug?: string | null;
  activePageSlug?: string | null;
}>(conversation: ConversationRow, requestedSurface: HermesSurface, context: T): T {
  if (requestedSurface !== "dashboard_terminal" || conversation.surface === "dashboard_terminal") {
    return context;
  }
  const runtime = getRuntimeSessionByConversation(conversation.id);
  return {
    ...context,
    activeGardenSlug: runtime?.garden_id ?? conversationOrigin(conversation).gardenSlug,
    activePageSlug: runtime?.page_slug ?? null,
  };
}
