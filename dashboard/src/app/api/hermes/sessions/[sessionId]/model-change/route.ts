import { NextResponse } from "next/server";
import { normalizeAssistantModelId, formatAssistantModelChangeName } from "@/lib/ai-models";
import {
  ConversationStoreError,
  getConversationForUser,
  setConversationModelChange,
} from "@/lib/conversations/store.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import {
  apiErrorResponse,
  ApiError,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

function requestedSurface(value: unknown): HermesSurface {
  if (
    typeof value === "string" &&
    (HERMES_SURFACES as readonly string[]).includes(value)
  ) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

/** Persist a model boundary after the latest answer in this chat. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const body = await readJsonBody(request);
    const surface = requestedSurface(body.surface);
    const model = normalizeAssistantModelId(body.model);
    if (!model) {
      throw new ApiError(400, "invalid_model", "A valid model is required.");
    }
    if (typeof body.afterClientMessageId !== "string") {
      throw new ApiError(
        400,
        "invalid_client_message_id",
        "An answer identifier is required.",
      );
    }

    const conversation = getConversationForUser(sessionId, userId);
    if (conversation.surface !== surface) {
      throw new ApiError(404, "session_not_found", "This chat is no longer available.");
    }
    const modelChange = formatAssistantModelChangeName(model);
    setConversationModelChange({
      conversationId: conversation.id,
      afterClientMessageId: body.afterClientMessageId,
      modelId: model,
      modelLabel: modelChange,
    });
    return NextResponse.json({
      afterClientMessageId: body.afterClientMessageId,
      modelChange,
    });
  } catch (error) {
    if (error instanceof ConversationStoreError) {
      return apiErrorResponse(new ApiError(error.status, error.code, error.message));
    }
    return apiErrorResponse(error);
  }
}
