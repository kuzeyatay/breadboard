// The goal card above the composer reads and drives the conversation's goal
// through this route.
//
// It is addressed by runtime session rather than by conversation because the
// composer already holds a session id and nothing else — the same reason the
// agency-agent route beside it is shaped this way. The conversation is resolved
// server-side from that session, so a browser can never name a goal belonging
// to a conversation it does not own.
//
// Pause, resume, extend and abandon live here and nowhere else. They are the
// person's half of the contract: the model may only ever mark a goal complete,
// and only through the audited MCP bridge.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  clearGoalModeState,
  extendGoalModeBudget,
  presentGoalModeState,
  readGoalModeState,
  setGoalModeStatus,
} from "@/lib/goal-mode.ts";
import { getConversationById } from "@/lib/conversations/store.ts";
import { recordAuditEvent } from "@/lib/hermes/runtime-store.ts";
import {
  apiErrorResponse,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import { authorizeRuntimeReference } from "@/lib/hermes/session-service.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

function authorizedSession(userId: number, reference: string) {
  const session = authorizeRuntimeReference(userId, reference);
  if (!session.row.conversation_id) {
    throw new ApiError(404, "conversation_not_found", "Conversation not found.");
  }
  const conversation = getConversationById(session.row.conversation_id);
  if (!conversation || conversation.user_id !== userId) {
    throw new ApiError(404, "conversation_not_found", "Conversation not found.");
  }
  return { session, conversation };
}

function goalPayload(conversationPublicId: string) {
  const state = readGoalModeState(conversationPublicId);
  return { ok: true, goal: state ? presentGoalModeState(state) : null };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await context.params;
    const { conversation } = authorizedSession(userId, sessionId);
    return NextResponse.json(goalPayload(conversation.public_id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await context.params;
    const { session, conversation } = authorizedSession(userId, sessionId);
    const body = (await request.json().catch(() => ({}))) as {
      status?: unknown;
      turnBudget?: unknown;
    };
    const status = body.status;
    if (status !== undefined && status !== "active" && status !== "paused") {
      throw new ApiError(
        400,
        "goal_status_invalid",
        "A goal can only be paused or resumed from here.",
      );
    }
    // Budget and status arrive together when someone lifts a budget-limited
    // goal back into motion, and the budget is applied first so the resume
    // decides against the ceiling that is about to apply rather than the old
    // one.
    if (body.turnBudget !== undefined) {
      const turnBudget = body.turnBudget;
      if (
        turnBudget !== null &&
        (typeof turnBudget !== "number" || !Number.isInteger(turnBudget) || turnBudget <= 0)
      ) {
        throw new ApiError(
          400,
          "goal_budget_invalid",
          "A goal turn budget must be a positive whole number, or unlimited.",
        );
      }
      extendGoalModeBudget({
        conversationPublicId: conversation.public_id,
        turnBudget: turnBudget as number | null,
      });
    }
    if (status !== undefined) {
      setGoalModeStatus({
        conversationPublicId: conversation.public_id,
        status,
      });
    }
    recordAuditEvent({
      eventType: "goal_mode.user_updated",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: {
        conversationPublicId: conversation.public_id,
        status: status ?? null,
        turnBudgetChanged: body.turnBudget !== undefined,
      },
    });
    return NextResponse.json(goalPayload(conversation.public_id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { sessionId } = await context.params;
    const { session, conversation } = authorizedSession(userId, sessionId);
    clearGoalModeState(conversation.public_id);
    recordAuditEvent({
      eventType: "goal_mode.abandoned",
      runtimeSessionId: session.row.id,
      userId,
      gardenId: session.row.garden_id,
      payload: { conversationPublicId: conversation.public_id },
    });
    return NextResponse.json({ ok: true, goal: null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
