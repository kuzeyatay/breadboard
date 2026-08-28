// The send endpoint for a conversation whose Agent mode is off.
//
// `messages/route.ts` is the agent endpoint: it accepts a message, dispatches it
// to the runtime, and the answer arrives on the session's own event stream. This
// endpoint answers on the response itself, because there is no runtime run to
// stream from — the provider is called directly and its text is relayed as SSE.
//
// The conversation, its ownership, and its surface are still Breadboard's, so
// they are checked here exactly as they are for an agent turn.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireString,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import { getConversationForUser } from "@/lib/conversations/store.ts";
import { startDirectProviderTurn } from "@/lib/conversations/direct-turn-service.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import { parseChatAttachments } from "@/lib/chat-attachments-request.ts";
import { resolveDocumentAttachments } from "@/lib/document-attachments-server.ts";
import { retrieveDocumentAttachments } from "@/lib/colpali/retrieval.ts";
import { parseCurrentLocationPayload } from "@/lib/hermes/current-location-context.ts";
import { SupervisorResourceExhaustedError } from "@/lib/supervisor-control.ts";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

function parseSurface(value: unknown): HermesSurface {
  if (
    typeof value === "string" &&
    (HERMES_SURFACES as readonly string[]).includes(value)
  ) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    // Deliberately no `requireEnabled()`. This is the path for a user who turned
    // the agent runtime off, so it must still answer in an existing chat on a
    // server where Hermes is not configured or has gone away.
    const userId = await requireUserId();
    const { sessionId } = await params;
    const conversation = getConversationForUser(sessionId, userId);
    const body = await readJsonBody(request, MAX_REQUEST_BYTES);
    return await startDirectProviderTurn({
      request,
      conversation,
      clientMessageId: requireString(body.clientMessageId, "clientMessageId", 128),
      text: requireString(body.text, "text", 100_000),
      surface: parseSurface(body.surface ?? "dashboard_terminal"),
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      // A regenerated turn sends a document's pointer without its words,
      // because the transcript never held them; this reads them back. Then
      // ColPali narrows a long document to the pages this question is about —
      // and hands back the attachment untouched when it cannot, so a document
      // that was never indexed still arrives whole.
      attachments: await retrieveDocumentAttachments(
        userId,
        resolveDocumentAttachments(userId, parseChatAttachments(body.attachments)),
        requireString(body.text, "text", 100_000),
        process.env,
      ),
      retry: body.retry === true,
      adhdMode: body.adhdMode === true,
      currentLocation:
        parseCurrentLocationPayload(body.currentLocation) ?? undefined,
      internalAgentContinuation: body.internalAgentContinuation === true,
      responseStartedAt:
        typeof body.responseStartedAt === "string" &&
        Number.isFinite(Date.parse(body.responseStartedAt))
          ? body.responseStartedAt
          : undefined,
      ...(typeof body.branchGroupId === "string"
        ? { branchGroupId: body.branchGroupId.slice(0, 128) }
        : {}),
    });
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) {
      return NextResponse.json(
        { error: error.message, ...error.result },
        { status: 503 },
      );
    }
    return apiErrorResponse(error);
  }
}
