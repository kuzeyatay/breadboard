import { NextResponse } from "next/server";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import {
  tokenAllows,
  verifyCapabilityToken,
} from "@/lib/hermes/capability-token.ts";
import {
  getActiveCapabilityDecision,
  getRuntimeSessionById,
  recordAuditEvent,
  runtimeExternalSessionId,
} from "@/lib/hermes/runtime-store.ts";
import { getActiveRuntimeRun } from "@/lib/hermes/run-store.ts";
import {
  MessagingServiceError,
  normalizeChannel,
  sendOwnerMessage,
  statusForMessagingError,
} from "@/lib/hermes/messaging-service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let runtimeSessionId: number | null = null;
  try {
    requireEnabled();
    const rawToken = capabilityForInternalToolRequest(request);
    const verified = verifyCapabilityToken(rawToken);
    if (!verified.ok || !tokenAllows(verified.token, { tool: "messaging_send" })) {
      throw new ApiError(
        403,
        "messaging_capability_denied",
        "Sending messages is not authorized.",
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
        "messaging_session_scope_mismatch",
        "Messaging session scope is invalid.",
      );
    }
    const run = getActiveRuntimeRun(session.id);
    if (!run) {
      throw new ApiError(
        409,
        "messaging_run_required",
        "Sending a message requires a current chat run.",
      );
    }
    const decision = getActiveCapabilityDecision(session.id);
    if (
      !decision ||
      !decision.allowedTools.includes("messaging_send") ||
      !decision.selectedConditionalSkills.includes("send-to-my-phone")
    ) {
      throw new ApiError(
        403,
        "messaging_skill_not_selected",
        "Select the first-party Send to my phone skill for this turn.",
      );
    }

    const body = await readJsonBody(request, 64 * 1024);
    const args =
      body.args && typeof body.args === "object" && !Array.isArray(body.args)
        ? (body.args as Record<string, unknown>)
        : {};
    // Normalized up front so the audit trail records the channel even when the
    // send itself is refused further down.
    const channel = normalizeChannel(args.channel);

    recordAuditEvent({
      eventType: "messaging.send_started",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        channel,
        hasAttachment: Boolean(args.artifactId),
      },
    });

    const result = await sendOwnerMessage({
      channel,
      text: typeof args.text === "string" ? args.text : "",
      artifactId: typeof args.artifactId === "string" ? args.artifactId : null,
      userId: session.user_id,
      conversationId: session.conversation_id,
    });

    recordAuditEvent({
      eventType: "messaging.send_completed",
      runtimeSessionId: session.id,
      userId: session.user_id,
      gardenId: session.garden_id,
      payload: {
        runId: run.id,
        channel: result.channel,
        characters: result.characters,
        attachment: result.attachment?.filename ?? null,
      },
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    if (runtimeSessionId !== null) {
      recordAuditEvent({
        eventType: "messaging.send_failed",
        runtimeSessionId,
        payload: {
          reason:
            error instanceof MessagingServiceError
              ? error.code
              : error instanceof ApiError
                ? error.code
                : "messaging_send_failed",
        },
      });
    }
    if (error instanceof MessagingServiceError) {
      return apiErrorResponse(
        new ApiError(statusForMessagingError(error.code), error.code, error.message),
      );
    }
    return apiErrorResponse(error);
  }
}
