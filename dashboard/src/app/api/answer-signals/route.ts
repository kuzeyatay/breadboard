// Where a judgement about an answer becomes a record.
//
// The browser may say *which* answer, inside a conversation it owns, and *what
// happened to it*. It may not say what the conditions were: those are read here
// off the stored row, because a client that could describe the turn could also
// describe a turn that never happened, and every later analysis would inherit
// it.
//
// Recording a signal is not allowed to fail the thing that produced it. The
// client fires these without awaiting them, and a failure here means one signal
// is missing from an aggregate — never a copy that did not happen or a
// regenerate that did not run.

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import {
  ConversationStoreError,
  getConversationForUser,
  getConversationMessageByClientId,
  getConversationMessageById,
  getPrecedingUserMessage,
} from "@/lib/conversations/store.ts";
import { isStoredMessageId, messageRowId, parseRequest } from "@/lib/humanizer/schemas.ts";
import { captureAnswerConditions } from "@/lib/hermes/answer-conditions.ts";
import {
  SIGNAL_KINDS,
  SIGNAL_REASONS,
  clearAnswerRating,
  getAnswerRating,
  listAnswerSignals,
  listConversationRatings,
  recordAnswerSignal,
} from "@/lib/hermes/answer-signals.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MESSAGE_REFERENCE = z.string().regex(
  /^(?:msg_\d+|[A-Za-z0-9][A-Za-z0-9._:-]{7,127})$/,
  "messageId must be a stored message id or client message id",
);

const recordSignalSchema = z.object({
  conversationId: z.string().min(1).max(128),
  messageId: MESSAGE_REFERENCE,
  kind: z.enum(SIGNAL_KINDS),
  reason: z.enum(SIGNAL_REASONS).nullish(),
});

function noStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
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
 * Resolve an answer the browser named, inside a conversation already proven to
 * belong to the caller. A live message still carries the client id that
 * reserved its turn; a restored one carries `msg_<id>`. Both have to work,
 * because a rating given before the first reload is the common case.
 */
function assistantRow(conversationId: number, reference: string) {
  const row = isStoredMessageId(reference)
    ? getConversationMessageById(messageRowId(reference))
    : getConversationMessageByClientId(conversationId, reference, "assistant");
  // An id belonging to another conversation must read exactly like one that
  // names nothing, or this route becomes a way to probe for messages.
  if (!row || row.conversation_id !== conversationId || row.role !== "assistant") {
    throw new ConversationStoreError(404, "message_not_found", "That message no longer exists.");
  }
  return row;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const parsed = parseRequest(recordSignalSchema, await request.json().catch(() => null));
    if (!parsed.ok) return noStore(parsed.failure, 422);

    const conversation = getConversationForUser(parsed.value.conversationId, userId);
    const assistant = assistantRow(conversation.id, parsed.value.messageId);
    const prompt = getPrecedingUserMessage(conversation.id, assistant.order_index);

    const signal = recordAnswerSignal({
      userId,
      conversationId: conversation.id,
      messageId: assistant.id,
      kind: parsed.value.kind,
      reason: parsed.value.reason ?? null,
      conditions: captureAnswerConditions({ assistant, prompt }),
    });

    return noStore({
      ok: Boolean(signal),
      rating: getAnswerRating(userId, assistant.id),
    });
  } catch (error) {
    const failure = storeFailure(error);
    if (failure) return failure;
    return routeErrorResponse(error);
  }
}

/**
 * Read back what is recorded. With a message, the rating standing against it;
 * with only a conversation, every rating in it, so a restored transcript can
 * hydrate in one request instead of one per answer.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const conversationId = params.get("conversationId");
    const messageId = params.get("messageId");

    if (!conversationId) {
      return noStore({ signals: listAnswerSignals(userId, { limit: 500 }) });
    }
    const conversation = getConversationForUser(conversationId, userId);
    if (!messageId) {
      return noStore({ ratings: listConversationRatings(userId, conversation.id) });
    }
    const assistant = assistantRow(conversation.id, messageId);
    return noStore({ rating: getAnswerRating(userId, assistant.id) });
  } catch (error) {
    const failure = storeFailure(error);
    if (failure) return failure;
    return routeErrorResponse(error);
  }
}

/** Take a rating back off an answer. A misclick must not be permanent evidence. */
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const params = new URL(request.url).searchParams;
    const conversationId = params.get("conversationId");
    const messageId = params.get("messageId");
    if (!conversationId || !messageId) {
      return noStore({ error: "conversationId and messageId are required." }, 400);
    }
    const conversation = getConversationForUser(conversationId, userId);
    const assistant = assistantRow(conversation.id, messageId);
    return noStore({ cleared: clearAnswerRating(userId, assistant.id), rating: null });
  } catch (error) {
    const failure = storeFailure(error);
    if (failure) return failure;
    return routeErrorResponse(error);
  }
}
