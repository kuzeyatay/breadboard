import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { chatmockApiKeyValue } from "@/lib/agent-browser/provider.ts";
import { resolveConnectedRepository } from "@/lib/opencode/repository.ts";
import {
  abortRun,
  getEventsSince,
  setRunTerminalHandler,
  startRun,
} from "@/lib/codex/run-manager.ts";
import { externalAgentActivityFromRunEvents } from "@/lib/conversations/external-agent-runs.ts";
import {
  captureSnapshot,
  finalizeRunSnapshot,
  rememberRunSnapshot,
} from "@/lib/agent-edits/snapshot.ts";
import { codexUserMessage } from "@/lib/codex/identity.ts";
import { resolveCommandMessage } from "@/lib/hermes/commands.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";
import { normalizeChatMessageAttachments } from "@/lib/chat-attachments.ts";
import db from "@/lib/db.ts";
import {
  ConversationStoreError,
  ensureConversationForLegacyChatSession,
  getConversationForUser,
  type ConversationRow,
} from "@/lib/conversations/store.ts";
import {
  attachExternalAgentRun,
  finishExternalAgentTurn,
  recordExternalAgentTurn,
} from "@/lib/conversations/external-agent-turns.ts";
import { generateAndApplyConversationTitle } from "@/lib/conversations/title-service.ts";
import { withConversationContext } from "@/lib/conversations/agent-context.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const raw = await request.text();
    if (raw.length > 64 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const gardenSlug = typeof body.gardenSlug === "string" ? body.gardenSlug.trim() : null;
    const conversationId =
      typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const chatSessionId = Number(body.chatSessionId);
    const hasChatSessionId = Number.isSafeInteger(chatSessionId) && chatSessionId > 0;
    const clientMessageId =
      typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
    const attachToExistingTurn = body.attachToExistingTurn === true;
    const requestedEffort =
      typeof body.reasoningEffort === "string"
        ? body.reasoningEffort.trim().toLowerCase()
        : "";
    if (body.attachments !== undefined && !Array.isArray(body.attachments)) {
      return NextResponse.json({ ok: false, error: "invalid_attachments" }, { status: 400 });
    }
    const attachments = normalizeChatMessageAttachments(body.attachments)
      .filter((attachment) => attachment.type === "image")
      .slice(0, 4);
    if (!task) {
      return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    if (conversationId && hasChatSessionId) {
      return NextResponse.json({ ok: false, error: "ambiguous_conversation" }, { status: 400 });
    }
    if (
      (conversationId || hasChatSessionId) &&
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(clientMessageId)
    ) {
      return NextResponse.json({ ok: false, error: "invalid_client_message_id" }, { status: 400 });
    }

    const repository = resolveConnectedRepository(userId, gardenSlug);
    let conversation: ConversationRow | null = null;
    if (conversationId) {
      conversation = getConversationForUser(conversationId, userId);
    } else if (hasChatSessionId) {
      conversation = ensureConversationForLegacyChatSession(chatSessionId, userId);
    }
    if (conversation?.surface === "quartz_ai") {
      throw new ApiError(
        400,
        "unsupported_surface",
        "Codex cannot edit a repository from the published-site assistant.",
      );
    }
    if (conversation?.surface === "garden_chat") {
      const scopedGarden = conversation.default_garden_id === null
        ? null
        : db.prepare("SELECT slug FROM clusters WHERE id = ? AND user_id = ?")
            .get(conversation.default_garden_id, userId) as { slug: string } | undefined;
      if (!scopedGarden || scopedGarden.slug !== repository.gardenSlug) {
        throw new ApiError(
          409,
          "conversation_scope_mismatch",
          "This Codex run belongs to a different Garden conversation.",
        );
      }
    }
    const resolved = await resolveCommandMessage(userId, task, repository.path, {
      mode: "scoped_implementation",
      surface: gardenSlug ? "garden_chat" : "dashboard_terminal",
      requestedOutcome: task,
      executionTarget: "codex",
    });
    const selectedSkill = resolved.invocations.find((invocation) => invocation.kind === "skill");
    const { baseURL } = resolveChatmockBaseUrl(request);
    // Snapshot before the agent can write anything, so the run stays undoable.
    const snapshotBefore = captureSnapshot(repository.path);
    const run = startRun({
      userId,
      task,
      // The chat this was typed into, so a task that refers back to it ("yes",
      // "the second one") resolves instead of reaching Codex as a bare word.
      instruction: withConversationContext(resolved.text, conversation, { clientMessageId }),
      skill: selectedSkill
        ? {
            id: selectedSkill.id,
            slug: selectedSkill.slug,
            contentHash: selectedSkill.contentHash,
          }
        : undefined,
      model,
      reasoningEffort: ALLOWED_EFFORTS.has(requestedEffort) ? requestedEffort : "high",
      baseUrl: baseURL,
      apiKey: chatmockApiKeyValue(),
      repositoryPath: repository.path,
      repositoryName: repository.name,
      gardenSlug: repository.gardenSlug,
      attachments,
    });
    rememberRunSnapshot(run.runId, repository.path, snapshotBefore);
    const externalRun = {
      kind: "codex" as const,
      runId: run.runId,
      task,
      gardenSlug: repository.gardenSlug,
      repository: repository.name,
    };
    if (conversation) {
      const durableConversation = conversation;
      try {
        if (attachToExistingTurn) {
          attachExternalAgentRun({
            conversation: durableConversation,
            clientMessageId,
            run: externalRun,
          });
        } else {
          const turn = recordExternalAgentTurn({
            conversation: durableConversation,
            clientMessageId,
            surface: durableConversation.surface,
            userContent: codexUserMessage(task),
            run: externalRun,
            attachments,
          });
          // Same first-prompt naming the Terminal gets from the external-turns
          // route: a Garden launch reaches this route instead, and without this
          // the chat it started stays "New chat" forever.
          if (turn.userMessage.order_index === 0) {
            await generateAndApplyConversationTitle({
              conversation: durableConversation,
              firstPrompt: turn.userMessage.content,
              model,
            });
          }
        }
        setRunTerminalHandler(userId, run.runId, (result) => {
          try {
            finishExternalAgentTurn({
              conversationId: durableConversation.id,
              clientMessageId,
              outcome: result.outcome,
              content: result.content,
              usage: result.usage,
              // The run manager holds events in memory only — store the
              // timeline now so history keeps it after the process restarts.
              activity: externalAgentActivityFromRunEvents(
                getEventsSince(userId, run.runId, 0),
              ),
              // Close the undo bracket here too: a task finished with no tab
              // open still has to be revertable later.
              edits: finalizeRunSnapshot(run.runId, repository.path) ?? undefined,
            });
          } catch {
            // The event stream can replay the terminal frame and retry safely.
          }
        });
      } catch (persistenceError) {
        abortRun(userId, run.runId);
        throw persistenceError;
      }
    }
    return NextResponse.json(
      {
        ok: true,
        turnPersisted: Boolean(conversation),
        run: {
          ...run,
          gardenSlug: repository.gardenSlug,
          repository: repository.name,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof ApiError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof ConversationStoreError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    const code = error instanceof Error ? error.message : "runtime_error";
    const status = [
      "garden_not_found",
      "repository_not_connected",
      "repository_unavailable",
      "garden_required",
    ].includes(code)
      ? 400
      : 502;
    return NextResponse.json({ ok: false, error: code }, { status });
  }
}
