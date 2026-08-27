import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { VIBE_TRADING_AGENT_ID } from "@/lib/vibe-trading/identity.ts";
import { startRun } from "@/lib/vibe-trading/runtime-run-manager.ts";
import {
  DEFAULT_VIBE_TRADING_SETTINGS,
  vibeTradingSettingsFrom,
} from "@/lib/vibe-trading/settings.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

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
    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    // A pasted filing, transcript or strategy note is a normal input here, so the
    // ceiling is well above what a short prompt would need.
    if (task.length > 200_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";

    // Stored defaults decide everything the prompt does not: the pinned model,
    // temperature, memory, cache and crypto exchange the service boots with.
    const settings = findConfigurableAgent(VIBE_TRADING_AGENT_ID)
      ? vibeTradingSettingsFrom(agentSettingsFor(userId, VIBE_TRADING_AGENT_ID))
      : DEFAULT_VIBE_TRADING_SETTINGS;

    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = await startRun({
      userId,
      task,
      model,
      reasoningEffort,
      baseUrl: baseURL,
      settings,
      // The chat this was launched from, so a request that refers back to
      // it resolves instead of arriving as a bare fragment.
      conversationContext: conversationContextFromBody(userId, body),
    });
    return NextResponse.json({ ok: true, run }, { status: 201 });
  } catch (error) {
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    // Filesystem/upstream errors may contain private paths or response detail.
    return NextResponse.json({ ok: false, error: "runtime_error" }, { status: 502 });
  }
}
