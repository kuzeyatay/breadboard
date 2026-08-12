import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { chatmockApiKeyValue } from "@/lib/agent-browser/provider.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { openworkDefaults } from "@/lib/agent-settings/defaults.ts";
import { startRun } from "@/lib/openwork/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 64 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const requestedEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim().toLowerCase() : "";

    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    if (task.length > 20_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // The task reaches the workspace agent verbatim, so a stacked `/skill`
    // token would arrive as prose in the middle of it. Refuse the combination
    // in the same words every other surface uses.
    const conflict = findCapabilityConflict({
      text: task,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: "openwork",
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    const reasoningEffort = ALLOWED_EFFORTS.has(requestedEffort) ? requestedEffort : "medium";
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      task,
      model,
      reasoningEffort,
      baseUrl: baseURL,
      apiKey: chatmockApiKeyValue(),
      prompt: openworkDefaults(agentSettingsFor(userId, "openwork")),
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
