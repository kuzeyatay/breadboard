import { NextResponse } from "next/server";

import db from "@/lib/db.ts";
import {
  boundedConversationReferenceMessages,
  searchConversations,
  type ConversationSearchCandidate,
  type ConversationSearchMessage,
  type ConversationReferenceMessage,
} from "@/lib/conversations/search.ts";
import { isSensitiveMemoryText } from "@/lib/conversations/memory.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { chatSearchResourceFromHits } from "@/lib/generative-ui/contracts.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { CHAT_SEARCH_TOOLS } from "@/lib/hermes/tool-scopes.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES_PER_CONVERSATION = 60;
const DEFAULT_RESULTS = 5;
const MAX_RESULTS = 8;
const MAX_REFERENCES = 3;

interface ConversationRow {
  id: number;
  public_id: string;
  title: string;
  updated_at: string;
  pinned_at: string | null;
  legacy_chat_session_id: number | null;
}

interface ReferenceMessageRow {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

function integerResultCount(value: unknown): number {
  if (value === undefined) return DEFAULT_RESULTS;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_RESULTS) {
    throw new ApiError(
      400,
      "chat_search_invalid_count",
      `Chat search count must be an integer from 1 to ${MAX_RESULTS}.`,
    );
  }
  return Number(value);
}

function referenceIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_REFERENCES ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        !/^conv_[A-Za-z0-9_-]{1,80}$/.test(entry),
    )
  ) {
    throw new ApiError(
      400,
      "chat_search_invalid_reference_ids",
      `Chat references must contain 1 to ${MAX_REFERENCES} result IDs from chat_search.`,
    );
  }
  return [...new Set(value)];
}

/** Internal, capability-scoped endpoint for Hermes's direct chat-history search. */
export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: "chat_search" })) {
      throw new ApiError(
        403,
        "chat_search_capability_denied",
        "Chat search is not authorized.",
      );
    }
    runtimeSessionId = Number(verified.token.breadboardSessionId);
    const session = getRuntimeSessionById(runtimeSessionId);
    if (
      !session ||
      session.user_id === null ||
      session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id
    ) {
      throw new ApiError(
        403,
        "chat_search_session_scope_mismatch",
        "Chat search session scope is invalid.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (decision && !decision.allowedTools.includes("chat_search")) {
      throw new ApiError(
        403,
        "chat_search_tool_not_granted",
        "Chat search is not available on this turn.",
      );
    }
    const conversation = getConversationById(session.conversation_id);
    if (!conversation || conversation.user_id !== session.user_id) {
      throw new ApiError(
        403,
        "chat_search_conversation_missing",
        "The chat-search conversation is unavailable.",
      );
    }

    const body = await readJsonBody(request, 16 * 1024);
    const toolName = typeof body.tool === "string" ? body.tool : "";
    if (!CHAT_SEARCH_TOOLS.includes(toolName as "chat_search")) {
      throw new ApiError(400, "chat_search_unknown_tool", "Unknown chat-search tool.");
    }
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {};
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
    if (!query) {
      throw new ApiError(400, "chat_search_query_required", "A chat search query is required.");
    }
    const count = integerResultCount(args.count);
    const requestedReferenceIds = referenceIds(args.reference_ids);

    let gardenSlug: string | undefined;
    if (session.surface === "garden_chat") {
      if (session.garden_id === null) {
        throw new ApiError(
          403,
          "chat_search_garden_scope_missing",
          "This Garden chat has no searchable Garden scope.",
        );
      }
      const garden = db.prepare("SELECT slug FROM clusters WHERE id = ?").get(
        session.garden_id,
      ) as { slug: string } | undefined;
      if (!garden?.slug) {
        throw new ApiError(
          403,
          "chat_search_garden_missing",
          "The Garden for this chat is unavailable.",
        );
      }
      gardenSlug = garden.slug;
    }

    // The current user request is already durable by the time Hermes calls a
    // tool. Excluding that conversation prevents "find the chat about X" from
    // matching itself merely because the new prompt contains X.
    const conversations = db.prepare(
      `SELECT id, public_id, title, updated_at, pinned_at, legacy_chat_session_id
       FROM conversations
       WHERE user_id = ? AND temporary = 0 AND surface = ? AND id <> ?${
         session.surface === "garden_chat"
           ? " AND default_garden_id = ? AND legacy_chat_session_id IS NOT NULL"
           : ""
       }
       ORDER BY updated_at DESC, id DESC
       LIMIT ${MAX_CONVERSATIONS}`,
    ).all(
      session.user_id,
      session.surface,
      session.conversation_id,
      ...(session.surface === "garden_chat" ? [session.garden_id] : []),
    ) as ConversationRow[];

    const readMessages = db.prepare(
      `SELECT role, substr(content, 1, 2000) AS content
       FROM conversation_messages
       WHERE conversation_id = ? AND status <> 'pending' AND content <> ''
       ORDER BY order_index DESC
       LIMIT ?`,
    );
    const candidates: ConversationSearchCandidate[] = conversations.map((row) => ({
      id: session.surface === "garden_chat"
        ? String(row.legacy_chat_session_id)
        : row.public_id,
      title: row.title,
      updatedAt: row.updated_at,
      pinned: row.pinned_at !== null,
      messages: (
        readMessages.all(row.id, MAX_MESSAGES_PER_CONVERSATION) as ConversationSearchMessage[]
      ).reverse(),
    }));
    // A follow-up may select any id from the widest first-page search even if
    // the model omits `count` on the second call. Re-run the same ranking at the
    // route's hard maximum so a valid selected result cannot fall off at five.
    const results = searchConversations(candidates, query, {
      limit: requestedReferenceIds.length > 0 ? MAX_RESULTS : count,
    });
    const rowsByNavigationId = new Map(
      conversations.map((row) => [
        session.surface === "garden_chat"
          ? String(row.legacy_chat_session_id)
          : row.public_id,
        row,
      ]),
    );
    const searchResults = results.map((result) => ({
      ...result,
      // Navigation ids differ by surface. This stable id is the only value the
      // model may pass back when the user asked it to use a result as context.
      referenceId: rowsByNavigationId.get(result.id)!.public_id,
    }));

    let references: Array<{
      referenceId: string;
      title: string;
      updatedAt: string;
      sourceLabel: string;
      transcriptScope: "latest_messages";
      transcriptTruncated: boolean;
      messages: ReturnType<typeof boundedConversationReferenceMessages>;
    }> = [];
    if (requestedReferenceIds.length > 0) {
      const resultByReferenceId = new Map(
        searchResults.map((result) => [result.referenceId, result]),
      );
      const missing = requestedReferenceIds.filter(
        (referenceId) => !resultByReferenceId.has(referenceId),
      );
      if (missing.length > 0) {
        throw new ApiError(
          404,
          "chat_search_reference_not_found",
          "A referenced chat is not among this query's authorized search results.",
        );
      }
      const readReferenceMessages = db.prepare(`
        SELECT role, content, created_at AS createdAt
        FROM conversation_messages
        WHERE conversation_id = ? AND status <> 'pending' AND trim(content) <> ''
        ORDER BY order_index DESC
        LIMIT 30
      `);
      const rowsByPublicId = new Map(
        conversations.map((row) => [row.public_id, row]),
      );
      references = requestedReferenceIds.map((referenceId) => {
        const row = rowsByPublicId.get(referenceId)!;
        const referenceMessages = (
          readReferenceMessages.all(row.id) as ReferenceMessageRow[]
        ).reverse().map((message): ConversationReferenceMessage => ({
          ...message,
          // Match the existing /reference path: a message containing likely
          // credentials is withheld as a whole rather than partially leaked.
          content: isSensitiveMemoryText(message.content)
            ? "[sensitive content omitted]"
            : message.content,
        }));
        const messages = boundedConversationReferenceMessages(referenceMessages);
        return {
          referenceId,
          title: row.title,
          updatedAt: row.updated_at,
          sourceLabel: `Chat: ${row.title}`,
          transcriptScope: "latest_messages",
          transcriptTruncated:
            referenceMessages.length === 30 ||
            messages.length < referenceMessages.length ||
            messages.some((message) => message.truncated),
          messages,
        };
      });
    }
    // The first call already produced the navigation card. Repeating it on the
    // transcript-read call would render the same result list twice in one turn.
    const uiResource = requestedReferenceIds.length === 0 && results.length > 0
      ? chatSearchResourceFromHits({
          id: `chat-search:${session.id}:${Date.now()}`,
          query,
          createdAt: new Date().toISOString(),
          surface: session.surface === "garden_chat" ? "garden_chat" : "dashboard_terminal",
          ...(gardenSlug ? { gardenSlug } : {}),
          hits: results,
        })
      : null;

    recordAuditEvent({
      eventType: "chatSearch.tool_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        query,
        resultsReturned: results.length,
        referencesReturned: references.length,
        surface: session.surface,
      },
    });
    return NextResponse.json({
      ok: true,
      data: {
        query,
        resultsReturned: results.length,
        results: searchResults,
        referencesReturned: references.length,
        references,
        uiResources: uiResource ? [uiResource] : [],
      },
    });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "chatSearch.tool_failed",
        runtimeSessionId,
        payload: {
          reason: error instanceof ApiError ? error.code : "chat_search_failed",
        },
      });
    }
    return apiErrorResponse(error);
  }
}
