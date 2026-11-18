import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { currentSwarmInvocation } from "@/lib/swarm/invocation.ts";
import { abortRun, getEventsSince, setRunTerminalHandler, startRun } from "@/lib/claude-code-agent/run-manager.ts";
import { claudeCodeUserMessage } from "@/lib/claude-code-agent/identity.ts";
import { isClaudeCodeModel } from "@/lib/claude-code.ts";
import { externalAgentActivityFromRunEvents } from "@/lib/conversations/external-agent-runs.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";
import { getHermesUserSettings } from "@/lib/hermes/runtime-store.ts";
import { resolveConversationRuntime } from "@/lib/hermes/session-service.ts";
import db from "@/lib/db.ts";
import {
  ConversationStoreError,
  ensureConversationForLegacyChatSession,
  getConversationForUser,
  type ConversationRow,
} from "@/lib/conversations/store.ts";
import { attachExternalAgentRun, finishExternalAgentTurn, recordExternalAgentTurn } from "@/lib/conversations/external-agent-turns.ts";
import { generateAndApplyConversationTitle } from "@/lib/conversations/title-service.ts";
import { withConversationContext } from "@/lib/conversations/agent-context.ts";
import { normalizeChatMessageAttachments } from "@/lib/chat-attachments.ts";
import { accountGoalModeTurn, activateGoalMode, callGoalModeTool, readGoalModeState } from "@/lib/goal-mode.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as Record<string, unknown>;
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const requestedModel = typeof body.model === "string" ? body.model.trim() : "";
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const chatSessionId = Number(body.chatSessionId);
    const hasChatSessionId = Number.isSafeInteger(chatSessionId) && chatSessionId > 0;
    const clientMessageId = typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
    const gardenSlug = typeof body.gardenSlug === "string" && body.gardenSlug.trim() ? body.gardenSlug.trim() : null;
    const attachToExistingTurn = body.attachToExistingTurn === true;
    const delegatedAgentRun = body.delegatedAgentRun === true;
    const delegatedAgentReason = typeof body.delegatedAgentReason === "string"
      ? body.delegatedAgentReason.trim().replace(/\s+/g, " ").slice(0, 240) : undefined;
    if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
      return NextResponse.json({ ok: false, error: "invalid_attachments" }, { status: 400 });
    }
    const attachments = normalizeChatMessageAttachments(body.attachments)
      .filter((attachment) => attachment.type === "image")
      .slice(0, 4);
    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    if (!conversationId && !hasChatSessionId) {
      // Breadboard tools run under the chat's own session, so a run needs its chat.
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(clientMessageId)) {
      return NextResponse.json({ ok: false, error: "invalid_client_message_id" }, { status: 400 });
    }

    const conversation: ConversationRow = conversationId
      ? getConversationForUser(conversationId, userId)
      : ensureConversationForLegacyChatSession(chatSessionId, userId);
    if (conversation.surface === "quartz_ai") {
      throw new ApiError(400, "unsupported_surface", "Claude Code is not available in the published-site assistant.");
    }
    const activeGarden = conversation.surface === "garden_chat" && conversation.default_garden_id !== null
      ? (db.prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?").get(conversation.default_garden_id, userId) as { slug: string } | undefined)?.slug ?? gardenSlug
      : gardenSlug;
    const session = await resolveConversationRuntime({ conversation, surface: conversation.surface, activeGardenSlug: activeGarden });
    const settings = getHermesUserSettings(userId);
    // A Claude model chosen in Breadboard carries over; anything else uses Claude Code's default.
    const model = isClaudeCodeModel(requestedModel) ? requestedModel.replace(/-efficient$/, "") : null;

    // Breadboard's goal becomes Claude Code's own /goal: either the message asks
    // for one, or this chat already has a goal in progress.
    const requestedGoal = /^\/goal(?:\s+|$)/i.test(task) ? task.replace(/^\/goal\s*/i, "").trim() : "";
    const currentGoal = readGoalModeState(conversation.public_id);
    const goal = requestedGoal
      ? activateGoalMode({ conversationPublicId: conversation.public_id, objective: requestedGoal })
      : currentGoal?.status === "active" ? currentGoal : null;
    const goalStartedAt = new Date().toISOString();

    const run = startRun({
      userId,
      task,
      prompt: withConversationContext(task, conversation, { clientMessageId }),
      images: attachments.map((attachment) => attachment.dataUrl),
      goal: goal?.objective ?? null,
      model,
      workingDirectory: session.activeDirectory,
      runtimeSessionId: session.externalSessionId,
      yoloMode: settings.composerSwitches.yoloMode === true,
      autonomyTier: settings.autonomyTier,
    });
    const externalRun = { kind: "claude_code" as const, runId: run.runId, task };
    if (!currentSwarmInvocation()) {
      try {
        if (attachToExistingTurn) {
          attachExternalAgentRun({ conversation, clientMessageId, run: externalRun, delegatedAgentReason });
        } else {
          const turn = recordExternalAgentTurn({
            conversation, clientMessageId, surface: conversation.surface,
            userContent: claudeCodeUserMessage(task), run: externalRun, attachments,
            delegatedAgentRun, delegatedAgentReason, internalAgentContinuation: delegatedAgentRun,
          });
          if (turn.userMessage.order_index === 0) {
            await generateAndApplyConversationTitle({ conversation, firstPrompt: turn.userMessage.content, model: requestedModel });
          }
        }
        setRunTerminalHandler(userId, run.runId, (result) => {
          if (goal) {
            try {
              accountGoalModeTurn({
                conversationPublicId: conversation.public_id, goalId: goal.goal_id, startedAt: goalStartedAt, runId: run.runId,
                tokensUsed: result.usage ? result.usage.inputTokens - result.usage.cachedInputTokens + result.usage.outputTokens : undefined,
                outcome: result.outcome === "completed" ? "completed" : result.outcome === "aborted" ? "cancelled" : "error",
                failureMessage: result.outcome === "failed" ? result.content : undefined,
              });
              // Claude Code only ends a /goal run once its own check says the goal is met.
              if (result.outcome === "completed") {
                callGoalModeTool({ conversationPublicId: conversation.public_id, tool: "update_goal", args: { status: "complete" } });
              }
            } catch { /* the goal card keeps its last state */ }
          }
          try {
            finishExternalAgentTurn({
              conversationId: conversation.id, clientMessageId, outcome: result.outcome, content: result.content,
              usage: result.usage, activity: externalAgentActivityFromRunEvents(getEventsSince(userId, run.runId, 0)),
            });
          } catch { /* the event stream can replay the terminal frame */ }
        });
      } catch (persistenceError) {
        await abortRun(userId, run.runId);
        throw persistenceError;
      }
    }
    return NextResponse.json({ ok: true, turnPersisted: true, run }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    if (error instanceof RouteError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    if (error instanceof ApiError || error instanceof ConversationStoreError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "runtime_error" }, { status: 502 });
  }
}
