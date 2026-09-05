import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isChatNotificationTarget } from "@/lib/chat-notification-inbox";
import { resolveNotificationReply } from "@/lib/chat-notifications/reply";
import { startConversationTurn } from "@/lib/conversations/turn-service";
import { startSessionEventPump } from "@/lib/hermes/event-stream";
import {
  apiErrorResponse,
  ApiError,
  readJsonBody,
  requireString,
} from "@/lib/hermes/route-helpers";
import { getHermesUserSettings } from "@/lib/hermes/runtime-store";
import { resolveConversationRuntime } from "@/lib/hermes/session-service";
import { requireUserId } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    if (!isChatNotificationTarget(body.target)) {
      throw new ApiError(
        400,
        "invalid_notification_target",
        "This chat is no longer available for replies.",
      );
    }
    const message = requireString(body.message, "message", 100_000);
    const { conversation, activeGardenSlug } = resolveNotificationReply(
      body.target,
      userId,
    );
    const settings = getHermesUserSettings(userId);

    // Attach the persistence pump before dispatch. The request may finish and
    // the person may keep browsing elsewhere, but this chat owns the turn now.
    const runtime = await resolveConversationRuntime({
      conversation,
      surface: conversation.surface,
      activeGardenSlug,
      activePageSlug: null,
    });
    startSessionEventPump(runtime);

    const switches = settings.composerSwitches;
    const result = await startConversationTurn({
      conversation,
      clientMessageId: `notification-reply-${crypto.randomUUID()}`,
      text: message,
      surface: conversation.surface,
      surfaceContext: activeGardenSlug ? { activeGardenSlug } : undefined,
      model: settings.defaultModel,
      reasoningEffort: settings.reasoningEffort,
      superAgent: switches.superAgent === true,
      adhdMode: switches.directMode === true,
      personalize: switches.personalize !== false,
      yoloMode: switches.yoloMode === true,
    });

    if (result.accepted) {
      return NextResponse.json(
        { accepted: true, runId: result.run.id },
        { status: 202 },
      );
    }
    if ("blocked" in result) {
      return NextResponse.json(
        {
          accepted: false,
          error: "This reply needs your approval. Open the chat to continue it.",
        },
        { status: 409 },
      );
    }
    if ("clarified" in result) {
      return NextResponse.json({ accepted: true, completed: true });
    }
    return NextResponse.json({
      accepted: result.status === "pending" || result.status === "complete",
      replayed: true,
      status: result.status,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
