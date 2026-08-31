import { NextResponse } from "next/server";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import {
  OPENEXECUTIVE_AGENT_ID,
  parseOpenExecutiveRequest,
} from "@/lib/openexecutive/identity.ts";
import { startRun } from "@/lib/openexecutive/run-manager.ts";
import { openExecutiveSettingsFrom } from "@/lib/openexecutive/settings.ts";
import { requireUserId, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

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
      typeof body.reasoningEffort === "string"
        ? body.reasoningEffort.trim().toLowerCase()
        : "medium";
    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    if (task.length > 100_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    const conflict = findCapabilityConflict({
      text: task,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: OPENEXECUTIVE_AGENT_ID,
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    const settings = openExecutiveSettingsFrom(
      agentSettingsFor(userId, OPENEXECUTIVE_AGENT_ID),
    );
    const parsed = parseOpenExecutiveRequest(task, settings);
    if (!parsed.task) {
      return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    }
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = await startRun({
      userId,
      task: parsed.task,
      model,
      reasoningEffort: EFFORTS.has(requestedEffort) ? requestedEffort : "medium",
      baseUrl: baseURL,
      maxIterations: parsed.maxIterations,
      committeeReview: parsed.committeeReview,
      conversationContext: conversationContextFromBody(userId, body),
    });
    return NextResponse.json({ ok: true, run, task: parsed.task }, { status: 201 });
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
