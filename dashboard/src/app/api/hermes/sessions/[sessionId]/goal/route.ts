// The goal card above the composer reads and drives the conversation's goal
// through this route.
//
// It is addressed by runtime session rather than by conversation because the
// composer already holds a session id and nothing else — the same reason the
// agency-agent route beside it is shaped this way. The conversation is resolved
// server-side from that session, so a browser can never name a goal belonging
// to a conversation it does not own.
//
// Pause, resume, edit, extend and abandon live here and nowhere else. They are the
// person's controls. The model can report completion or a blocker through the
// audited MCP bridge.

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  clearGoalModeState,
  editGoalModeObjective,
  extendGoalModeBudget,
  goalObjectiveUpdatedPrompt,
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
import { latestGoalTurn, scheduleGoalContinuation } from "@/lib/goal-continuation.ts";
import { getActiveRuntimeRun, parseRuntimeRunDispatch } from "@/lib/hermes/run-store.ts";
import { getAgentRuntimeByKind } from "@/lib/agent-runtime/runtime.ts";
import { hermesMessageId } from "@/lib/hermes/message-id.ts";

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

async function steerObjectiveUpdate(
  session: ReturnType<typeof authorizeRuntimeReference>,
  state: NonNullable<ReturnType<typeof readGoalModeState>>,
): Promise<void> {
  const run = getActiveRuntimeRun(session.row.id);
  if (!run) return;
  const dispatch = parseRuntimeRunDispatch(run);
  if (!dispatch.goalMode?.enabled || dispatch.goalMode.readOnly ||
      (dispatch.goalMode.goalId && dispatch.goalMode.goalId !== state.goal_id)) return;
  try {
    await getAgentRuntimeByKind(session.runtimeKind).steerRun({
      externalSessionId: session.externalSessionId,
      liveSessionId: session.liveSessionId,
      workspaceKey: session.workspaceKey,
      directory: session.activeDirectory,
      agentName: session.agentName,
      text: goalObjectiveUpdatedPrompt(state),
      model: dispatch.model,
      variant: dispatch.variant,
      tools: dispatch.tools,
      system: dispatch.system,
      clientRequestId: `goal-objective:${state.goal_id}:${state.updated_at}`,
      messageId: dispatch.clientMessageId ? hermesMessageId(dispatch.clientMessageId) : undefined,
    });
  } catch {
    // The turn may have finished while the edit travelled. The stored
    // objective is already the new one, so the next turn picks it up.
    recordAuditEvent({
      eventType: "goal_mode.objective_steer_failed",
      runtimeSessionId: session.row.id,
      payload: { runId: run.id },
    });
  }
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
    scheduleGoalContinuation(conversation.id);
    const payload = goalPayload(conversation.public_id);
    return NextResponse.json({ ...payload,
      turn: payload.goal ? latestGoalTurn(conversation.id, payload.goal.goalId) : null,
    });
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
      objective?: unknown;
      turnBudget?: unknown;
      tokenBudget?: unknown;
    };
    const status = body.status;
    if (status !== undefined && status !== "active" && status !== "paused") {
      throw new ApiError(
        400,
        "goal_status_invalid",
        "A goal can only be paused or resumed from here.",
      );
    }
    const { turnBudget, tokenBudget } = body;
    for (const [name, budget] of [["turn", turnBudget], ["token", tokenBudget]] as const) {
      if (budget != null && (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget <= 0)) {
        throw new ApiError(400, "goal_budget_invalid", `A ${name} budget must be a positive whole number, or unlimited.`);
      }
    }
    // Validate the whole change before writing the objective, limits or status.
    let objectiveEdit: ReturnType<typeof editGoalModeObjective> = null;
    if (body.objective !== undefined) {
      if (typeof body.objective !== "string" || !body.objective.trim()) {
        throw new ApiError(400, "goal_objective_invalid", "A goal needs an objective.");
      }
      if (body.objective.trim().length > 4_000) {
        throw new ApiError(400, "goal_objective_invalid", "A goal objective must be at most 4000 characters.");
      }
      objectiveEdit = editGoalModeObjective({
        conversationPublicId: conversation.public_id,
        objective: body.objective,
      });
      if (!objectiveEdit) {
        throw new ApiError(404, "goal_not_found", "This conversation has no goal to edit.");
      }
    }
    if (turnBudget !== undefined || tokenBudget !== undefined) {
      extendGoalModeBudget({
        conversationPublicId: conversation.public_id,
        turnBudget: turnBudget as number | null | undefined,
        tokenBudget: tokenBudget as number | null | undefined,
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
        objectiveChanged: objectiveEdit?.objectiveChanged ?? false,
        turnBudgetChanged: body.turnBudget !== undefined,
        tokenBudgetChanged: body.tokenBudget !== undefined,
      },
    });
    const after = readGoalModeState(conversation.public_id);
    if (objectiveEdit?.objectiveChanged && after?.status === "active") {
      // Codex steers the running turn onto the new wording; an idle goal just
      // continues below, and its next turn reads the new objective anyway.
      await steerObjectiveUpdate(session, after);
    }
    if (after?.status === "active" && (status === "active" || objectiveEdit || tokenBudget !== undefined || turnBudget !== undefined)) {
      scheduleGoalContinuation(conversation.id);
    }
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
