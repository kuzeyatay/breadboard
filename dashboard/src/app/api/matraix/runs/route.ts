import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { chatmockApiKeyValue } from "@/lib/agent-browser/provider.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { matraixDefaults } from "@/lib/agent-settings/defaults.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { MATRAIX_AGENT_ID, parseMatraixRequest } from "@/lib/matraix/identity.ts";
import { startRun } from "@/lib/matraix/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

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
    if (!brief) return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    if (brief.length > 20_000) {
      return NextResponse.json({ ok: false, error: "brief_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: MATRAIX_AGENT_ID,
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    // Stored preferences fill only what the message left unsaid.
    const parsed = parseMatraixRequest(
      brief,
      matraixDefaults(agentSettingsFor(userId, MATRAIX_AGENT_ID)),
    );
    if (!parsed.brief) {
      return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    }

    const rawEffort = typeof body.reasoningEffort === "string" ? body.reasoningEffort.toLowerCase() : "";
    const reasoningEffort = rawEffort === "max" ? "xhigh" : EFFORTS.has(rawEffort) ? rawEffort : undefined;
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      brief,
      request: parsed,
      model,
      reasoningEffort,
      baseUrl: baseURL,
      apiKey: chatmockApiKeyValue(),
      // The chat this was launched from, so a study that refers back to it —
      // "ask them about the pricing we just worked out" — resolves.
      conversationContext: conversationContextFromBody(userId, body),
    });
    return NextResponse.json({ ok: true, run, request: parsed }, { status: 201 });
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
