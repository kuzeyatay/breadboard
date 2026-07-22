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
  authorizeRuntimeSession,
  markStatus,
} from "@/lib/openharness/session-service.ts";
import { getOpenHarnessGateway } from "@/lib/openharness/gateway.ts";
import { resolveOpenHarnessEngine } from "@/lib/openharness/model-selection.ts";
import {
  appendRuntimeMessage,
  appendChatMessage,
  recordAuditEvent,
} from "@/lib/openharness/runtime-store.ts";
import { resolveCommandMessage } from "@/lib/openharness/commands.ts";
import { prepareTurn, mergeSelectedTools } from "@/lib/openharness/dispatch-core.ts";
import { listFilesystemGrants } from "@/lib/openharness/filesystem-grant-store.ts";
import { composeOpenHarnessSystemPrompt } from "@/lib/openharness/system-prompts.ts";
import { persistCapabilityDecision } from "@/lib/openharness/runtime-store.ts";
import { scheduleCapabilityExpiry } from "@/lib/openharness/capability-lifecycle.ts";
import type { ChatAttachment } from "@/lib/chat-attachments";
import {
  beginRuntimeRun,
  finishRuntimeRun,
  getActiveRuntimeRun,
} from "@/lib/openharness/run-store.ts";

export const dynamic = "force-dynamic";

const MAX_MESSAGE_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_TEXT_LENGTH = 2 * 1024 * 1024;
const MAX_ATTACHMENT_DATA_URL_LENGTH = 12 * 1024 * 1024;

function parseAttachments(value: unknown): ChatAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) {
    throw new ApiError(
      400,
      "invalid_attachments",
      `Attachments must be an array containing at most ${MAX_ATTACHMENTS} items.`,
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ApiError(400, "invalid_attachments", `Attachment ${index + 1} is invalid.`);
    }
    const attachment = item as Record<string, unknown>;
    const name = requireString(attachment.name, `attachments[${index}].name`, 500);
    if (/[\\/\0]/.test(name)) {
      throw new ApiError(400, "invalid_attachments", `Attachment ${index + 1} has an invalid name.`);
    }

    if (attachment.type === "text") {
      const text = requireString(
        attachment.text,
        `attachments[${index}].text`,
        MAX_ATTACHMENT_TEXT_LENGTH,
      );
      return { type: "text", name, text };
    }
    if (attachment.type === "image") {
      const dataUrl = requireString(
        attachment.dataUrl,
        `attachments[${index}].dataUrl`,
        MAX_ATTACHMENT_DATA_URL_LENGTH,
      );
      if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
        throw new ApiError(
          400,
          "invalid_attachments",
          `Attachment ${index + 1} must be a base64 image data URL.`,
        );
      }
      return { type: "image", name, dataUrl };
    }
    throw new ApiError(
      400,
      "invalid_attachments",
      `Attachment ${index + 1} has an unsupported type.`,
    );
  });
}

function parseSessionId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiError(400, "invalid_session_id", "Invalid session id.");
  }
  return id;
}

// POST: submit a user message. The message is persisted in Breadboard, then
// handed to OpenHarness via prompt_async. The assistant's answer streams back
// over the /events SSE channel (not this response). The OpenHarness session id
// is derived server-side from the authorized runtime-session record; the client
// never supplies it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const runtimeSessionId = parseSessionId(sessionId);
    const session = authorizeRuntimeSession(userId, runtimeSessionId);

    const body = await readJsonBody(request, MAX_MESSAGE_REQUEST_BYTES);
    const text = requireString(body.text, "text", 200_000);
    const attachments = parseAttachments(body.attachments);
    if (getActiveRuntimeRun(session.row.id)) {
      throw new ApiError(
        409,
        "run_already_active",
        "This session already has an active run. Steer or stop it first.",
      );
    }
    // Capability comes from the requested outcome plus the user's real
    // filesystem grants — the same call Garden Chat makes, so the same task
    // with the same grants yields the same capabilities on either surface.
    const prepared = prepareTurn({
      request: text,
      surface: session.row.surface,
      userId,
      grants: listFilesystemGrants(userId),
      workspaceRoot: session.activeDirectory,
      confirmedPermissionIds: Array.isArray(body.confirmedPermissionIds)
        ? body.confirmedPermissionIds.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0 && value.length <= 500,
          )
        : undefined,
    });
    const decision = prepared.decision;
    const resolved = await resolveCommandMessage(
      userId,
      text,
      session.activeDirectory,
      { mode: decision.mode, surface: session.row.surface },
    );
    decision.selectedConditionalSkills = resolved.invocations
      .filter((item) => item.kind === "skill" && decision.mode === "scoped_implementation")
      .map((item) => item.slug);
    decision.selectedConnections = resolved.invocations
      .filter((item) => item.kind === "mcp")
      .map((item) => item.slug);
    const engine = resolveOpenHarnessEngine(body.model, body.reasoningEffort);
    const continuation =
      body.continuation && typeof body.continuation === "object"
        ? (body.continuation as Record<string, unknown>)
        : null;
    if (continuation) {
      if (session.row.surface !== "dashboard_terminal") {
        throw new ApiError(
          403,
          "invalid_continuation",
          "Only authenticated Assistant implementation tasks can be resumed.",
        );
      }
      const parentTaskId = requireString(
        continuation.parentTaskId,
        "continuation.parentTaskId",
        500,
      );
      const skillId = requireString(
        continuation.skillId,
        "continuation.skillId",
        500,
      );
      recordAuditEvent({
        eventType: "task.resumed",
        runtimeSessionId: session.row.id,
        userId,
        payload: { parentTaskId, skillId },
      });
    }

    await getOpenHarnessGateway().applyCapabilityDecision({
      openHarnessSessionId: session.openHarnessSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      decision,
    });
    const storedDecision = persistCapabilityDecision(session.row.id, decision);
    scheduleCapabilityExpiry(session, decision, storedDecision.id);
    recordAuditEvent({
      eventType: "capability.decision",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: {
        decisionId: storedDecision.id,
        mode: decision.mode,
        requestedOutcome: decision.requestedOutcome,
        implementationRequired: decision.implementationRequired,
        decisionReason: decision.decisionReason,
        decisionSource: decision.decisionSource,
        authorizedRoots: decision.authorizedRoots,
        authorizedPathPatterns: decision.authorizedPathPatterns,
        allowedTools: decision.allowedTools,
        allowedOperations: decision.allowedOperations,
        allowedCommandPatterns: decision.allowedCommandPatterns,
        selectedConditionalSkills: decision.selectedConditionalSkills,
        selectedConnections: decision.selectedConnections,
        expiresAt: decision.expiresAt,
      },
    });
    // A turn whose first step is unauthorized must not reach the model: it
    // would produce prose that sounds like it acted. Return the pending
    // requests so the client can render an approval prompt and resume the same
    // task, exactly as Garden Chat does.
    if (prepared.blocked) {
      markStatus(session, "idle");
      for (const pending of prepared.pendingPermissions) {
        recordAuditEvent({
          eventType: "permission.requested",
          runtimeSessionId: session.row.id,
          userId,
          gardenId: session.row.garden_id,
          payload: { permission: pending.capability, requestId: pending.id },
        });
      }
      return NextResponse.json({
        accepted: false,
        blocked: true,
        reason: "awaiting_permission",
        plan: {
          intendedOutcome: prepared.plan.intendedOutcome,
          steps: prepared.plan.steps.map((step) => step.description),
          riskLevel: prepared.plan.riskLevel,
        },
        pendingPermissions: prepared.pendingPermissions,
        // Retained so approval can resume without the user restating the task.
        request: text,
      });
    }

    // The request becomes part of the durable transcript only once it can
    // actually run. A blocked preflight is retained by the client and retried
    // after approval; persisting it here would duplicate the user message when
    // that retry is accepted.
    if (session.row.chat_session_id) {
      appendChatMessage({
        chatSessionId: session.row.chat_session_id,
        role: "user",
        content: text,
      });
    } else {
      appendRuntimeMessage({
        runtimeSessionId: session.row.id,
        role: "user",
        content: text,
      });
    }

    const tools = mergeSelectedTools(prepared.grant.allowedTools, resolved.tools);
    const system = composeOpenHarnessSystemPrompt({
      surface: session.row.surface,
      decision,
    });
    const run = beginRuntimeRun({
      runtimeSessionId: session.row.id,
      instruction: text,
      dispatch: {
        model: engine.model,
        variant: engine.variant,
        tools,
        system,
      },
    });
    markStatus(session, "busy");
    recordAuditEvent({
      eventType: "message.submitted",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: {
        characterCount: text.length,
        attachmentCount: attachments.length,
        modelId: engine.model.modelID,
        reasoningEffort: engine.variant,
        reasoningEffortAdjusted: engine.adjusted,
        commands: resolved.invocations,
        capabilityDecisionId: storedDecision.id,
        capabilityMode: decision.mode,
      },
    });
    try {
      await getOpenHarnessGateway().sendMessage({
        openHarnessSessionId: session.openHarnessSessionId,
        workspaceKey: session.workspaceKey,
        directory: session.activeDirectory,
        agentName: session.agentName,
        text: resolved.text,
        attachments,
        // The brokered map is authoritative; a selected skill/MCP tool may only
        // narrow it, never widen it.
        tools,
        model: engine.model,
        variant: engine.variant,
        system,
      });
    } catch (error) {
      finishRuntimeRun(run.id, "error");
      throw error;
    }

    return NextResponse.json({
      accepted: true,
      runId: run.id,
      capability: {
        mode: decision.mode,
        expiresAt: decision.expiresAt,
        decisionId: storedDecision.id,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
