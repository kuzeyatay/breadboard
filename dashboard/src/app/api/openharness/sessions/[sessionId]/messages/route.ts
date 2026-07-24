import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
  ApiError,
} from "@/lib/openharness/route-helpers.ts";
import {
  getConversationForUser,
  failAssistantMessage,
  type ConversationRow,
} from "@/lib/conversations/store.ts";
import { startConversationTurn } from "@/lib/conversations/turn-service.ts";
import { OPENHARNESS_SURFACES, type OpenHarnessSurface } from "@/lib/openharness/config.ts";
import type { ChatAttachment } from "@/lib/chat-attachments";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_TEXT_LENGTH = 2 * 1024 * 1024;
const MAX_ATTACHMENT_DATA_URL_LENGTH = 12 * 1024 * 1024;

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
    const result = await startConversationTurn({
      conversation,
      clientMessageId,
      text,
      surface,
      surfaceContext: parseSurfaceContext(body.surfaceContext, body),
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      attachments: parseAttachments(body.attachments),
      confirmedPermissionIds: Array.isArray(body.confirmedPermissionIds)
        ? body.confirmedPermissionIds.filter((value): value is string =>
            typeof value === "string" && value.length > 0 && value.length <= 500)
        : undefined,
      retry: body.retry === true,
      branchGroupId: stringValue(body.branchGroupId)?.slice(0, 128),
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
          status: request.signal.aborted ? "aborted" : "failed",
          error: error instanceof Error ? error.message : "turn_failed",
        });
      } catch {
        // The reservation may not have happened; preserve the original error.
      }
    }
    return apiErrorResponse(error);
  }
}

function parseSurface(value: unknown): OpenHarnessSurface {
  if (typeof value === "string" && (OPENHARNESS_SURFACES as readonly string[]).includes(value)) {
    return value as OpenHarnessSurface;
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

function parseAttachments(value: unknown): ChatAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new ApiError(400, "invalid_attachments", `Attachments must contain at most ${MAX_ATTACHMENTS} items.`);
  }
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(400, "invalid_attachments", `Attachment ${index + 1} is invalid.`);
    }
    const attachment = item as Record<string, unknown>;
    const name = requireString(attachment.name, `attachments[${index}].name`, 500);
    if (/[\\/\0]/.test(name)) throw new ApiError(400, "invalid_attachments", "Attachment name is invalid.");
    if (attachment.type === "text") {
      return {
        type: "text",
        name,
        text: requireString(attachment.text, `attachments[${index}].text`, MAX_ATTACHMENT_TEXT_LENGTH),
      };
    }
    if (attachment.type === "image") {
      const dataUrl = requireString(
        attachment.dataUrl,
        `attachments[${index}].dataUrl`,
        MAX_ATTACHMENT_DATA_URL_LENGTH,
      );
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
        throw new ApiError(400, "invalid_attachments", "Image attachment must be a base64 data URL.");
      }
      return { type: "image", name, dataUrl };
    }
    throw new ApiError(400, "invalid_attachments", `Attachment ${index + 1} has an unsupported type.`);
  });
}
