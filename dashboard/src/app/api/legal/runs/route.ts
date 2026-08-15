import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { parseChatAttachments } from "@/lib/chat-attachments-request.ts";
import { composeAgentMemoryContext } from "@/lib/conversations/agent-memory-context.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";
import { LEGAL_AGENT_ID, parseLegalRequest } from "@/lib/legal/identity.ts";
import { startRun } from "@/lib/legal/run-manager.ts";
import {
  DEFAULT_LEGAL_SETTINGS,
  legalSettingsFrom,
  requestDefaultsFrom,
} from "@/lib/legal/settings.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    // A run's inputs are documents, and a data room's worth of extracted text
    // arrives in this body.
    if (text.length > 24 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const requestedEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim().toLowerCase() : "";
    const attachments = parseChatAttachments(body.attachments);

    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. The deliverables a run
    // produces are stored as artifacts of that chat.
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

    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    if (task.length > 200_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // The assignment reaches the harness verbatim, so a stacked capability
    // token would arrive as prose. Refused rather than swallowed.
    const conflict = findCapabilityConflict({
      text: task,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: LEGAL_AGENT_ID,
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";

    // Stored defaults decide everything the message does not: turn budget,
    // which document skills load, reasoning effort, and whether the agent may
    // run commands. A flag typed in the message still wins.
    const settings = findConfigurableAgent(LEGAL_AGENT_ID)
      ? legalSettingsFrom(agentSettingsFor(userId, LEGAL_AGENT_ID))
      : DEFAULT_LEGAL_SETTINGS;
    const legalRequest = parseLegalRequest(task, requestDefaultsFrom(settings));
    if (!legalRequest.task) {
      return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    }

    // Durable memory about the user, selected against this assignment. Never
    // blocks the run: an unavailable memory layer resolves to no context.
    const memory = await composeAgentMemoryContext({
      userId,
      agentId: "legal_agent",
      query: legalRequest.task,
      conversationPublicId,
    });

    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      request: legalRequest,
      settings,
      attachments,
      model,
      reasoningEffort,
      baseUrl: baseURL,
      conversationPublicId,
      memoryContext: memory?.text ?? "",
    });
    return NextResponse.json({ ok: true, run }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    // A rejected attachment is the user's problem to fix, so it keeps its own
    // message instead of arriving as a generic 502.
    if (error instanceof ApiError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime_error" },
      { status: 502 },
    );
  }
}
