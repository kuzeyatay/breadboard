import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import {
  ConversationStoreError,
  ensureConversationForLegacyChatSession,
  getConversationForUser,
} from "@/lib/conversations/store.ts";
import {
  parametricCadUserMessage,
  parseParametricCadRequest,
} from "@/lib/cad/identity.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { parametricCadDefaults } from "@/lib/agent-settings/defaults.ts";
import {
  abortRun,
  getEventsSince,
  setRunTerminalHandler,
  startRun,
} from "@/lib/cad/runtime-run-manager.ts";
import {
  attachExternalAgentRun,
  finishExternalAgentTurn,
  recordExternalAgentTurn,
} from "@/lib/conversations/external-agent-turns.ts";
import { externalAgentActivityFromRunEvents } from "@/lib/conversations/external-agent-runs.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const clientMessageId =
      typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
    const branchGroupId =
      typeof body.branchGroupId === "string" ? body.branchGroupId.trim() : "";
    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. The design artifact has to
    // belong to a conversation either way.
    let conversationPublicId =
      typeof body.conversationPublicId === "string" ? body.conversationPublicId.trim() : "";
    if (!conversationPublicId && typeof body.chatSessionId === "number") {
      try {
        conversationPublicId = ensureConversationForLegacyChatSession(
          body.chatSessionId,
          userId,
        ).public_id;
      } catch {
        conversationPublicId = "";
      }
    }
    const requestedEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim().toLowerCase() : "";

    if (!brief) return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    if (brief.length > 20_000) {
      return NextResponse.json({ ok: false, error: "brief_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    if (clientMessageId.length > 128) {
      return NextResponse.json({ ok: false, error: "invalid_client_message_id" }, { status: 400 });
    }
    if (branchGroupId.length > 128) {
      return NextResponse.json({ ok: false, error: "invalid_branch_group_id" }, { status: 400 });
    }
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }

    // `taskFromParametricCadCommand` keeps any capability tokens the user
    // stacked in front of the command, but this run never resolves them — they
    // would land in the design brief as prose and corrupt the dimensions the
    // agent reads out of it. Refuse the combination rather than silently mangle
    // it.
    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: "parametric-cad",
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    // The user's saved process, units and printer volume are where the request
    // starts; a flag in the brief still overrides each of them.
    const parsed = parseParametricCadRequest(
      brief,
      parametricCadDefaults(agentSettingsFor(userId, "parametric-cad")),
    );
    if (!parsed.brief) {
      return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    }
    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";
    // Authorize and capture the owner before any background design work starts.
    // A missing or foreign conversation must not leave an ownerless CAD run
    // capable of publishing an artifact later.
    const conversation = getConversationForUser(conversationPublicId, userId);
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = await startRun({
      userId,
      conversationPublicId,
      ...(clientMessageId ? { clientMessageId } : {}),
      brief,
      parsed,
      model,
      reasoningEffort,
      baseUrl: baseURL,
    });
    // Dashboard launches become durable before this response leaves the
    // server. The browser repeats the same idempotent write after receiving the
    // descriptor; Garden Chat continues to use its legacy session writer.
    const attachToExistingTurn = body.attachToExistingTurn === true;
    let turnPersisted = false;
    if (clientMessageId && conversation.surface === "dashboard_terminal") {
      const externalRun = {
        kind: "parametric_cad" as const,
        runId: run.runId,
        // Keep the exact normalized command payload. `parsed.brief` omits the
        // process, bed, unit, and fresh flags and would conflict with the client.
        brief,
      };
      try {
        if (attachToExistingTurn) {
          attachExternalAgentRun({
            conversation,
            clientMessageId,
            run: externalRun,
          });
        } else {
          recordExternalAgentTurn({
            conversation,
            clientMessageId,
            surface: conversation.surface,
            userContent: parametricCadUserMessage(brief),
            run: externalRun,
            ...(branchGroupId ? { branchGroupId } : {}),
          });
        }
        setRunTerminalHandler(userId, run.runId, async (result) => {
          try {
            const runEvents = await getEventsSince(userId, run.runId, 0);
            finishExternalAgentTurn({
              conversationId: conversation.id,
              clientMessageId,
              outcome: result.outcome,
              content: result.content,
              usage: result.usage,
              state: result.state,
              activity: externalAgentActivityFromRunEvents(
                runEvents,
              ),
            });
          } catch {
            // The event-stream card can safely replay this idempotent write.
          }
        });
        turnPersisted = true;
      } catch (persistenceError) {
        await abortRun(userId, run.runId);
        throw persistenceError;
      }
    }
    return NextResponse.json({ ok: true, turnPersisted, run }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof ConversationStoreError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof Error && error.message === "client_message_id_conflict") {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime_error" },
      { status: 502 },
    );
  }
}
