import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import {
  ConversationStoreError,
  ensureConversationForLegacyChatSession,
  getConversationForUser,
} from "@/lib/conversations/store.ts";
import {
  hardwareBlueprintUserMessage,
  parseHardwareBlueprintRequest,
} from "@/lib/hardware/identity.ts";
import {
  abortRun,
  getEventsSince,
  setRunTerminalHandler,
  startRun,
} from "@/lib/hardware/runtime-run-manager.ts";
import {
  attachExternalAgentRun,
  finishExternalAgentTurn,
  recordExternalAgentTurn,
} from "@/lib/conversations/external-agent-turns.ts";
import { externalAgentActivityFromRunEvents } from "@/lib/conversations/external-agent-runs.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { hardwarePreferences } from "@/lib/agent-settings/defaults.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";

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
    // conversation is resolved (or created) here. The blueprint artifact has to
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

    // `taskFromHardwareBlueprintCommand` keeps any capability tokens the user
    // stacked in front of the command, but this run never resolves them — they
    // would land in the compiler's brief as prose and corrupt the board, flag,
    // and BOM parsing. Refuse the combination rather than silently mangle it.
    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: "hardware-blueprint",
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    const parsed = parseHardwareBlueprintRequest(brief);
    if (!parsed.brief) {
      return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    }
    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";
    // Validate and capture the owner before starting background work. If the
    // conversation disappeared (or never belonged to this user), no run should
    // be left executing without a transcript it can publish into.
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
      preferences: hardwarePreferences(agentSettingsFor(userId, "hardware-blueprint")),
      // The chat this was launched from, so a brief that refers back to it
      // resolves instead of arriving as a bare fragment.
      conversationContext: conversationContextFromBody(userId, body),
    });
    // Terminal launches are made durable on the server before this response is
    // returned. That closes both races: switching chats cannot move the turn,
    // and an unusually fast Blueprint cannot publish an ownerless artifact.
    // Garden Chat still uses its legacy session writer below the client layer.
    const attachToExistingTurn = body.attachToExistingTurn === true;
    let turnPersisted = false;
    if (clientMessageId && conversation.surface === "dashboard_terminal") {
      const externalRun = {
        kind: "hardware_blueprint" as const,
        runId: run.runId,
        // Keep the exact normalized request used by the client descriptor.
        // Parsed briefs omit inline build flags, which made the idempotent
        // client replay conflict with the server-first durable turn.
        brief,
      };
      try {
        if (attachToExistingTurn) {
          attachExternalAgentRun({
            conversation,
            clientMessageId,
            run: externalRun,
            delegatedAgentReason: typeof body.delegatedAgentReason === "string"
              ? body.delegatedAgentReason : undefined,
          });
        } else {
          recordExternalAgentTurn({
            conversation,
            clientMessageId,
            surface: conversation.surface,
            userContent: hardwareBlueprintUserMessage(brief),
            run: externalRun,
            ...(branchGroupId ? { branchGroupId } : {}),
            delegatedAgentRun: body.delegatedAgentRun === true,
            delegatedAgentReason: typeof body.delegatedAgentReason === "string"
              ? body.delegatedAgentReason : undefined,
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
            // The event-stream card can safely replay the terminal write.
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
