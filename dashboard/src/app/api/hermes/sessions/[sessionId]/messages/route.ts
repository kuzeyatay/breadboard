import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/hermes/route-helpers.ts";
import {
  getConversationForUser,
  failAssistantMessage,
  type ConversationRow,
} from "@/lib/conversations/store.ts";
import { startConversationTurn } from "@/lib/conversations/turn-service.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import { parseChatAttachments } from "@/lib/chat-attachments-request.ts";
import { resolveDocumentAttachments } from "@/lib/document-attachments-server.ts";
import { retrieveDocumentAttachments } from "@/lib/colpali/retrieval.ts";
import {
  parseConversationBranchHistory,
  resolveConversationBranchHistory,
} from "@/lib/conversations/branch-history.ts";
import { normalizeChatTextSelectionReference } from "@/lib/chat-text-selection.ts";
import { parseCurrentLocationPayload } from "@/lib/hermes/current-location-context.ts";
import { SupervisorResourceExhaustedError } from "@/lib/supervisor-control.ts";
import { startSessionEventPump } from "@/lib/hermes/event-stream.ts";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_REQUEST_BYTES = 16 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  let conversation: ConversationRow | null = null;
  let clientMessageId: string | null = null;
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    conversation = getConversationForUser(sessionId, userId);
    const body = await readJsonBody(request, MAX_MESSAGE_REQUEST_BYTES);
    const text = requireString(body.text, "text", 100_000);
    clientMessageId = requireString(body.clientMessageId, "clientMessageId", 128);
    const surface = parseSurface(body.surface ?? "dashboard_terminal");
    const branchHistoryReferences = parseConversationBranchHistory(
      body.branchHistory,
    );
    const branchHistory = branchHistoryReferences
      ? resolveConversationBranchHistory(
          conversation.id,
          branchHistoryReferences,
        )
      : undefined;
    const textSelection = normalizeChatTextSelectionReference(body.textSelection);
    if (body.textSelection !== undefined && !textSelection) {
      throw new ApiError(
        400,
        "invalid_text_selection",
        "The selected-text reference is invalid.",
      );
    }
    const surfaceContext = parseSurfaceContext(body.surfaceContext, body);
    if (textSelection) surfaceContext.selectedText = textSelection.quote;
    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text,
      surface,
      surfaceContext,
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
        text,
        process.env,
      ),
      // Super agent is a per-message flag, never a stored session property: the
      // switch the user had on when they pressed send governs that turn only.
      superAgent: body.superAgent === true,
      // Concise travels the same way and for the same reason: it is a switch
      // the user can flip between two sends, not a property of the session.
      adhdMode: body.adhdMode === true,
      // Personalize travels the same way, and defaults to on when the field is
      // absent so a client compiled before the switch existed keeps behaving
      // as it did.
      personalize: body.personalize !== false,
      // Hermes keeps YOLO on the live session, but the browser setting remains
      // authoritative. Every message therefore reasserts the current value.
      yoloMode: body.yoloMode === true,
      currentLocation:
        parseCurrentLocationPayload(body.currentLocation) ?? undefined,
      confirmedPermissionIds: Array.isArray(body.confirmedPermissionIds)
        ? body.confirmedPermissionIds.filter((value): value is string =>
            typeof value === "string" && value.length > 0 && value.length <= 500)
        : undefined,
      retry: body.retry === true,
      branchGroupId: stringValue(body.branchGroupId)?.slice(0, 128),
      textSelection: textSelection ?? undefined,
      branchHistory,
      branchContextId: stringValue(body.branchContextId)?.slice(0, 128),
      internalAgentContinuation: body.internalAgentContinuation === true,
      responseStartedAt:
        typeof body.responseStartedAt === "string" &&
        Number.isFinite(Date.parse(body.responseStartedAt))
          ? body.responseStartedAt
          : undefined,
    });

    if (!result.accepted) {
      if ("blocked" in result) return NextResponse.json(result);
      if ("clarified" in result) {
        return NextResponse.json({
          accepted: false,
          clarified: true,
          message: result.message,
        });
      }
      if (result.status === "pending" && result.run) {
        // A retry may have landed after the process that created the run lost
        // its pump. Re-acquire the durable consumer before telling the browser
        // to attach, so replay is recovery rather than another stranded turn.
        startSessionEventPump(result.session);
      }
      return NextResponse.json({
        accepted: result.status === "pending",
        replayed: true,
        status: result.status,
        runId: result.run?.id ?? null,
      });
    }
    return NextResponse.json({
      accepted: true,
      runId: result.run.id,
      replayed: result.replayed,
      conversationId: conversation.public_id,
      capability: result.capability,
    });
  } catch (error) {
    if (conversation && clientMessageId) {
      try {
        failAssistantMessage({
          conversationId: conversation.id,
          clientMessageId,
          // Losing the browser request means its viewer went away; it is not a
          // Stop action. Only the explicit abort route is allowed to persist an
          // interrupted answer. Retrieval and dispatch deliberately outlive
          // this request's signal so navigation cannot manufacture one here.
          status: "failed",
          error: error instanceof Error ? error.message : "turn_failed",
        });
      } catch {
        // The reservation may not have happened; preserve the original error.
      }
    }
    if (error instanceof SupervisorResourceExhaustedError) {
      return NextResponse.json(
        { error: error.message, ...error.result },
        { status: 503 },
      );
    }
    return apiErrorResponse(error);
  }
}

function parseSurface(value: unknown): HermesSurface {
  if (typeof value === "string" && (HERMES_SURFACES as readonly string[]).includes(value)) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

function parseSurfaceContext(value: unknown, body: Record<string, unknown>) {
  const context = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    activeGardenSlug: stringValue(context.activeGardenSlug ?? body.gardenSlug),
    activePageSlug: stringValue(context.activePageSlug ?? body.pageSlug),
    pageTitle: stringValue(context.pageTitle),
    selectedText: stringValue(context.selectedText),
    selectedDocumentIds: Array.isArray(context.selectedDocumentIds)
      ? context.selectedDocumentIds.filter((value): value is string => typeof value === "string")
      : undefined,
    graphContext: context.graphContext,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
