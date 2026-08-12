import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import {
  TRADINGAGENTS_AGENT_ID,
  validateTradingAgentsRequest,
} from "@/lib/tradingagents/identity.ts";
import { startRun } from "@/lib/tradingagents/run-manager.ts";
import {
  DEFAULT_TRADINGAGENTS_SETTINGS,
  tradingAgentsSettingsFrom,
} from "@/lib/tradingagents/settings.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

/**
 * Start one analysis. The body is a request object, never a prompt: this agent
 * has no free-text input anywhere in its graph, so the route validates the same
 * shape the composer's form produces and refuses anything else.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    const validated = validateTradingAgentsRequest(body.request);
    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
    }

    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    const requestedEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.trim().toLowerCase() : "";
    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";

    // Stored defaults fill in everything the form does not ask about (models,
    // vendors, language). The form's own fields always win.
    const settings = findConfigurableAgent(TRADINGAGENTS_AGENT_ID)
      ? tradingAgentsSettingsFrom(agentSettingsFor(userId, TRADINGAGENTS_AGENT_ID))
      : DEFAULT_TRADINGAGENTS_SETTINGS;

    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      request: validated.request,
      settings,
      model,
      reasoningEffort,
      baseUrl: baseURL,
    });
    return NextResponse.json({ ok: true, run, request: validated.request }, { status: 201 });
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
