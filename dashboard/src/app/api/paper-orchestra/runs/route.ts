import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { currentSwarmInvocation } from "@/lib/swarm/invocation.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { abortRun, getEventsSince, setRunTerminalHandler, startRun } from "@/lib/paper-orchestra/run-manager.ts";
import { parsePaperOrchestraTask, paperOrchestraUserMessage } from "@/lib/paper-orchestra/identity.ts";
import { externalAgentActivityFromRunEvents } from "@/lib/conversations/external-agent-runs.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";
import { getHermesUserSettings } from "@/lib/hermes/runtime-store.ts";
import { tierAllows } from "@/lib/hermes/autonomy.ts";
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as Record<string, unknown>;
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const chatSessionId = Number(body.chatSessionId);
    const hasChatSessionId = Number.isSafeInteger(chatSessionId) && chatSessionId > 0;
    const clientMessageId = typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
    const attachToExistingTurn = body.attachToExistingTurn === true;
    const delegatedAgentRun = body.delegatedAgentRun === true;
    const delegatedAgentReason = typeof body.delegatedAgentReason === "string"
      ? body.delegatedAgentReason.trim().replace(/\s+/g, " ").slice(0, 240) : undefined;
    if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
      return NextResponse.json({ ok: false, error: "invalid_attachments" }, { status: 400 });
    }
    const attachments = normalizeChatMessageAttachments(body.attachments)
      .filter((attachment) => attachment.type === "image")
      .slice(0, 8);
    const paper = parsePaperOrchestraTask(task);
    if (!paper.brief) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    if (!model) return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    if (!conversationId && !hasChatSessionId) {
      // The paper is filed as an artifact of its chat, so a run needs one.
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(clientMessageId)) {
      return NextResponse.json({ ok: false, error: "invalid_client_message_id" }, { status: 400 });
    }
    const conversation: ConversationRow = conversationId
      ? getConversationForUser(conversationId, userId)
      : ensureConversationForLegacyChatSession(chatSessionId, userId);
    if (conversation.surface === "quartz_ai") {
      throw new ApiError(400, "unsupported_surface", "PaperOrchestra is not available in the published-site assistant.");
    }
    // Plots run model-written matplotlib code on this computer, so they need the
    // same permission Breadboard requires before an agent may run commands.
    const settings = getHermesUserSettings(userId);
    if (paper.plotting && !(settings.composerSwitches.yoloMode === true && tierAllows(settings.autonomyTier, "destructive"))) {
      throw new ApiError(403, "plotting_not_allowed",
        "--plots runs model-written Python to draw figures. Turn on YOLO with full autonomy to allow it, or attach your figures as images instead.");
    }

    const run = startRun({
      userId,
      request: paper,
      prompt: withConversationContext(paper.brief, conversation, { clientMessageId }),
      images: attachments.map((attachment) => attachment.dataUrl),
      model,
      baseUrl: resolveChatmockBaseUrl(request).baseURL,
      conversationPublicId: conversation.public_id,
    });
    const externalRun = { kind: "paper_orchestra" as const, runId: run.runId, task };
    if (!currentSwarmInvocation()) {
      try {
        if (attachToExistingTurn) {
          attachExternalAgentRun({ conversation, clientMessageId, run: externalRun, delegatedAgentReason });
        } else {
          const turn = recordExternalAgentTurn({
            conversation, clientMessageId, surface: conversation.surface,
            userContent: paperOrchestraUserMessage(task), run: externalRun, attachments,
            delegatedAgentRun, delegatedAgentReason, internalAgentContinuation: delegatedAgentRun,
          });
          if (turn.userMessage.order_index === 0) {
            await generateAndApplyConversationTitle({ conversation, firstPrompt: turn.userMessage.content, model });
          }
        }
        setRunTerminalHandler(userId, run.runId, (result) => {
          try {
            finishExternalAgentTurn({
              conversationId: conversation.id, clientMessageId, outcome: result.outcome, content: result.content,
              activity: externalAgentActivityFromRunEvents(getEventsSince(userId, run.runId, 0)),
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
