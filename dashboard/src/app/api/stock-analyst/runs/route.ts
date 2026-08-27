import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import { composeAgentMemoryContext } from "@/lib/conversations/agent-memory-context.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { STOCK_ANALYST_AGENT_ID } from "@/lib/stock-analyst/identity.ts";
import { startRun } from "@/lib/stock-analyst/runtime-run-manager.ts";
import {
  DEFAULT_STOCK_ANALYST_SETTINGS,
  stockAnalystSettingsFrom,
} from "@/lib/stock-analyst/settings.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    if (!task) return NextResponse.json({ ok: false, error: "empty_task" }, { status: 400 });
    // A pasted filing, earnings call transcript or holdings list is a normal
    // input here, so the ceiling is well above what a short question needs.
    if (task.length > 200_000) {
      return NextResponse.json({ ok: false, error: "task_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // Stored defaults decide everything the question does not: the pinned model,
    // the depth, the report language, the watchlist and the strategy set the
    // backend boots with.
    const settings = findConfigurableAgent(STOCK_ANALYST_AGENT_ID)
      ? stockAnalystSettingsFrom(agentSettingsFor(userId, STOCK_ANALYST_AGENT_ID))
      : DEFAULT_STOCK_ANALYST_SETTINGS;

    // Durable memory about the user, selected against this question. Never
    // blocks the run: an unavailable memory layer resolves to no context.
    const memory = await composeAgentMemoryContext({
      userId,
      agentId: "stock_analyst",
      query: task,
      conversationPublicId:
        typeof body.conversationPublicId === "string" ? body.conversationPublicId : null,
    });

    const { baseURL } = resolveChatmockBaseUrl(request);
    const clientMessageId =
      typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
    const run = await startRun({
      userId,
      ...(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(clientMessageId)
        ? { requestId: clientMessageId }
        : {}),
      task,
      model,
      baseUrl: baseURL,
      settings,
      memoryContext: memory?.text ?? "",
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
