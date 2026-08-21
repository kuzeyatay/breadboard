import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  ConversationStoreError,
  getConversationForUser,
  getConversationMessageByClientId,
  getConversationMessageById,
} from "@/lib/conversations/store.ts";
import {
  addAssistantContentVersion,
  presentMessageVersions,
  readMessageVersions,
  selectAssistantContentVersion,
} from "@/lib/conversations/message-versions.ts";
import {
  applyRewriteSchema,
  isStoredMessageId,
  messageRowId,
  parseRequest,
  selectVersionSchema,
} from "@/lib/humanizer/schemas.ts";
import {
  scoreReview,
  summarizeReviewScores,
} from "@/lib/humanizer/review.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Where a rewrite becomes part of a conversation.
 *
 * Separate from `/rewrite` on purpose: producing a rewrite and adopting one are
 * different operations, and only the second touches the database. Standing
 * rewrites use this route automatically, while the original stays in the row;
 * see `lib/conversations/message-versions`.
 *
 * The client never writes to the database. It sends a conversation id, a
 * message id, the content it believes that message holds, and the replacement.
 * Ownership, existence and staleness are all decided here.
 */

const MAX_BODY_BYTES = 1024 * 1024;

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: Request): Promise<unknown | { __invalid: true }> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { __invalid: true };
  try {
    return await request.json();
  } catch {
    return { __invalid: true };
  }
}

function storeFailure(error: unknown): NextResponse | null {
  if (error instanceof ConversationStoreError) {
    return noStore({ error: error.code, detail: error.message }, error.status);
  }
  if (error instanceof RouteError) {
    return noStore({ error: error.message }, error.status);
  }
  return null;
}

/**
 * Live messages keep their client id until the next transcript restore. Resolve
 * it inside the owned conversation so automatic rewriting can apply before a
 * reload without broadening what the browser is allowed to address.
 */
function assistantMessageRowId(
  conversationId: number,
  messageReference: string,
): number {
  if (isStoredMessageId(messageReference)) return messageRowId(messageReference);
  const row = getConversationMessageByClientId(
    conversationId,
    messageReference,
    "assistant",
  );
  if (!row) {
    throw new ConversationStoreError(
      404,
      "message_not_found",
      "That message no longer exists.",
    );
  }
  return row.id;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = await readBody(request);
    if (payload && typeof payload === "object" && "__invalid" in payload) {
      return noStore({ error: "invalid_json" }, 400);
    }
    const parsed = parseRequest(applyRewriteSchema, payload);
    if (!parsed.ok) return noStore(parsed.failure, 422);

    // Ownership first: an id that names somebody else's conversation must be
    // indistinguishable from one that names nothing.
    const conversation = getConversationForUser(parsed.value.conversationId, userId);
    const state = addAssistantContentVersion({
      conversationId: conversation.id,
      messageId: assistantMessageRowId(
        conversation.id,
        parsed.value.messageId,
      ),
      expectedContent: parsed.value.expectedContent,
      content: parsed.value.rewrittenText,
      origin: "humanizer",
      review: summarizeReviewScores(
        scoreReview(parsed.value.expectedContent, parsed.value.rewrittenText),
      ),
    });

    return noStore({
      messageId: parsed.value.messageId,
      content: state.versions[state.activeIndex].content,
      versions: presentMessageVersions(state),
    });
  } catch (error) {
    const failure = storeFailure(error);
    if (failure) return failure;
    throw error;
  }
}

/** Switch which stored version of a response is on screen. */
export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const payload = await readBody(request);
    if (payload && typeof payload === "object" && "__invalid" in payload) {
      return noStore({ error: "invalid_json" }, 400);
    }
    const parsed = parseRequest(selectVersionSchema, payload);
    if (!parsed.ok) return noStore(parsed.failure, 422);

    const conversation = getConversationForUser(parsed.value.conversationId, userId);
    const state = selectAssistantContentVersion({
      conversationId: conversation.id,
      messageId: assistantMessageRowId(
        conversation.id,
        parsed.value.messageId,
      ),
      index: parsed.value.index,
    });

    return noStore({
      messageId: parsed.value.messageId,
      content: state.versions[state.activeIndex].content,
      versions: presentMessageVersions(state),
    });
  } catch (error) {
    const failure = storeFailure(error);
    if (failure) return failure;
    throw error;
  }
}

/** What versions a response has, without changing anything. */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const parsed = parseRequest(selectVersionSchema.omit({ index: true }), {
      conversationId: url.searchParams.get("conversationId") ?? "",
      messageId: url.searchParams.get("messageId") ?? "",
    });
    if (!parsed.ok) return noStore(parsed.failure, 422);

    const conversation = getConversationForUser(parsed.value.conversationId, userId);
    const row = getConversationMessageById(
      assistantMessageRowId(conversation.id, parsed.value.messageId),
    );
    if (!row || row.conversation_id !== conversation.id) {
      return noStore({ error: "message_not_found" }, 404);
    }
    return noStore({
      messageId: parsed.value.messageId,
      versions: presentMessageVersions(readMessageVersions(row)),
    });
  } catch (error) {
    const failure = storeFailure(error);
    if (failure) return failure;
    throw error;
  }
}
