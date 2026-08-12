import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { DEER_FLOW_AGENT_ID } from "@/lib/deer-flow/identity.ts";
import { startRun } from "@/lib/deer-flow/run-manager.ts";
import { DEFAULT_DEER_FLOW_SETTINGS, deerFlowSettingsFrom } from "@/lib/deer-flow/settings.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 256 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const requestedEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim().toLowerCase() : "";

    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. The files a run presents are
    // stored as artifacts of that chat.
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
    // A pasted document, transcript or specification is a normal input here, so
    // the ceiling is well above what a short instruction would need.
    if (task.length > 200_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // The task is forwarded to DeerFlow's own agent verbatim, so a stacked
    // capability token would arrive as prose. Refused rather than swallowed.
    const conflict = findCapabilityConflict({
      text: task,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: DEER_FLOW_AGENT_ID,
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

    // Stored defaults decide everything the message does not: subagents, plan
    // mode, the web tools, memory, and whether the agent may run commands.
    const settings = findConfigurableAgent(DEER_FLOW_AGENT_ID)
      ? deerFlowSettingsFrom(agentSettingsFor(userId, DEER_FLOW_AGENT_ID))
      : DEFAULT_DEER_FLOW_SETTINGS;

    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      task,
      model,
      reasoningEffort,
      baseUrl: baseURL,
      settings,
      conversationPublicId,
    });
    return NextResponse.json({ ok: true, run }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
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
