import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
  requireString,
} from "@/lib/hermes/route-helpers.ts";
import { HERMES_SURFACES, type HermesSurface } from "@/lib/hermes/config.ts";
import {
  getConversationForUser,
  presentConversationMessage,
} from "@/lib/conversations/store.ts";
import {
  attachExternalAgentRun,
  finishExternalAgentTurn,
  recordExternalAgentTurn,
} from "@/lib/conversations/external-agent-turns.ts";
import {
  delegatedAgentPresentation,
  externalAgentMessageFields,
  parseExternalAgentActivity,
  parseExternalAgentEdits,
  parseExternalAgentState,
  parseExternalAgentOutcome,
  parseExternalAgentRun,
  type ExternalAgentTerminalOutcome,
} from "@/lib/conversations/external-agent-runs.ts";
import { normalizeChatTokenUsage } from "@/lib/chat-token-usage";
import { normalizeChatMessageAttachments } from "@/lib/chat-attachments";
import { generateAndApplyConversationTitle } from "@/lib/conversations/title-service";

export const dynamic = "force-dynamic";

function parseSurface(value: unknown): HermesSurface {
  if (
    typeof value === "string" &&
    (HERMES_SURFACES as readonly string[]).includes(value)
  ) {
    return value as HermesSurface;
  }
  throw new ApiError(400, "invalid_surface", "A valid surface is required.");
}

function optionalContent(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_field", 'Field "assistantContent" must be a string.');
  }
  if (value.length > 100_000) {
    throw new ApiError(400, "invalid_field", 'Field "assistantContent" is too long.');
  }
  return value;
}

function presentExternalMessage(
  row: Parameters<typeof presentConversationMessage>[0],
) {
  const presented = presentConversationMessage(row);
  const externalAgent = externalAgentMessageFields(presented.metadata);
  const metadataDuration = Number(presented.metadata.responseDurationMs);
  return {
    ...presented,
    ...delegatedAgentPresentation(presented.content, externalAgent),
    verification: presented.metadata.verification,
    ...(Number.isFinite(metadataDuration) && metadataDuration >= 0
      ? { responseDurationMs: metadataDuration }
      : {}),
    ...(Array.isArray(presented.metadata.attachmentNames)
      ? { attachmentNames: presented.metadata.attachmentNames }
      : {}),
    ...(Array.isArray(presented.metadata.attachments)
      ? { attachments: presented.metadata.attachments }
      : {}),
    interrupted: presented.status === "aborted",
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const conversation = getConversationForUser(sessionId, userId);
    const body = await readJsonBody(request);
    const surface = parseSurface(body.surface ?? conversation.surface);
    if (surface !== conversation.surface) {
      throw new ApiError(
        409,
        "surface_mismatch",
        "The external agent turn does not belong to this conversation surface.",
      );
    }

    const parsedRun =
      body.run === undefined ? undefined : parseExternalAgentRun(body.run);
    if (body.run !== undefined && !parsedRun) {
      throw new ApiError(400, "invalid_external_agent_run", "The external agent run is invalid.");
    }
    const run = parsedRun ?? undefined;
    const requestedOutcome =
      body.outcome === undefined ? undefined : parseExternalAgentOutcome(body.outcome);
    if (body.outcome !== undefined && !requestedOutcome) {
      throw new ApiError(400, "invalid_external_agent_outcome", "The external agent outcome is invalid.");
    }
    if (body.attachToExistingTurn === true) {
      if (!run && requestedOutcome !== "failed" && requestedOutcome !== "aborted") {
        throw new ApiError(
          400,
          "invalid_external_agent_run",
          "A delegated external agent attachment requires a run descriptor or a terminal start failure.",
        );
      }
      const assistantMessage = attachExternalAgentRun({
        conversation,
        clientMessageId: requireString(body.clientMessageId, "clientMessageId", 128),
        run,
        outcome: requestedOutcome ?? (run ? "running" : "failed"),
        ...(body.assistantContent === undefined
          ? {}
          : { assistantContent: optionalContent(body.assistantContent) }),
      });
      return NextResponse.json({
        messages: [presentExternalMessage(assistantMessage)],
      });
    }
    const attachments = normalizeChatMessageAttachments(body.attachments);
    if (requestedOutcome === "running" && !run) {
      throw new ApiError(
        400,
        "invalid_external_agent_run",
        "A running external agent turn requires a run descriptor.",
      );
    }

    const turn = recordExternalAgentTurn({
      conversation,
      clientMessageId: requireString(body.clientMessageId, "clientMessageId", 128),
      surface,
      userContent: requireString(body.userContent, "userContent"),
      assistantContent: optionalContent(body.assistantContent),
      run,
      outcome: requestedOutcome ?? (run ? "running" : "failed"),
      branchGroupId:
        body.branchGroupId === undefined
          ? undefined
          : requireString(body.branchGroupId, "branchGroupId", 128),
      attachments,
    });
    if (turn.userMessage.order_index === 0) {
      await generateAndApplyConversationTitle({
        conversation,
        firstPrompt: turn.userMessage.content,
        model: body.model,
      });
    }
    return NextResponse.json({
      messages: [
        presentExternalMessage(turn.userMessage),
        presentExternalMessage(turn.assistantMessage),
      ],
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await params;
    const conversation = getConversationForUser(sessionId, userId);
    const body = await readJsonBody(request);
    const outcome = parseExternalAgentOutcome(body.outcome);
    if (!outcome || outcome === "running") {
      throw new ApiError(
        400,
        "invalid_external_agent_outcome",
        "A terminal external agent outcome is required.",
      );
    }
    const content =
      body.content === undefined
        ? ""
        : optionalContent(body.content);
    const normalizedUsage =
      body.usage === undefined ? null : normalizeChatTokenUsage(body.usage);
    if (body.usage !== undefined && !normalizedUsage) {
      throw new ApiError(400, "invalid_token_usage", "Token usage is invalid.");
    }
    const usage = normalizedUsage ?? undefined;
    const activity = parseExternalAgentActivity(body.activity);
    const edits = parseExternalAgentEdits(body.edits);
    const state = parseExternalAgentState(body.state);
    if (body.state !== undefined && !state) {
      throw new ApiError(400, "invalid_external_agent_state", "External agent card state is invalid or too large.");
    }
    const message = finishExternalAgentTurn({
      conversationId: conversation.id,
      clientMessageId: requireString(body.clientMessageId, "clientMessageId", 128),
      outcome: outcome as ExternalAgentTerminalOutcome,
      content,
      usage,
      ...(activity.length ? { activity } : {}),
      ...(edits ? { edits } : {}),
      ...(state ? { state } : {}),
    });
    return NextResponse.json({ message: presentExternalMessage(message) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
