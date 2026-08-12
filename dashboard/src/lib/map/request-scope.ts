// Which geographic context a browser request is acting on.
//
// The map page follows the conversation the assistant is working in, so a route
// Hermes computed appears on screen without the user re-selecting anything. When
// no conversation is named, the page falls back to the one whose geographic
// state this user touched most recently, and finally to the map's own standalone
// state (conversation 0). A named conversation is always verified to belong to
// the requesting user first.

import { getConversationForUser } from "../conversations/store.ts";
import { latestGeographicContextConversationId } from "./store.ts";
import type { GeographicContextKey } from "./store.ts";

export interface ResolvedMapScope extends GeographicContextKey {
  /** The conversation's public id, echoed back so the client can pin to it. */
  conversationPublicId: string | null;
}

export function resolveMapScope(input: {
  userId: number;
  conversationPublicId?: string | null;
  /** Pin to the standalone map state rather than following a conversation. */
  standalone?: boolean;
}): ResolvedMapScope {
  if (input.standalone) {
    return { userId: input.userId, conversationId: null, conversationPublicId: null };
  }
  const requested = input.conversationPublicId?.trim();
  if (requested) {
    // Throws 404 for a conversation that is missing or belongs to someone else,
    // which is the same answer on purpose.
    const conversation = getConversationForUser(requested, input.userId);
    return {
      userId: input.userId,
      conversationId: conversation.id,
      conversationPublicId: conversation.public_id,
    };
  }
  const latest = latestGeographicContextConversationId(input.userId);
  return {
    userId: input.userId,
    conversationId: latest,
    conversationPublicId: null,
  };
}
