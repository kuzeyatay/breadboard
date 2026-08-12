import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { parseVimaxRequest } from "@/lib/vimax/identity.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { vimaxDefaults } from "@/lib/agent-settings/defaults.ts";
import { startRun } from "@/lib/vimax/run-manager.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 128 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. The film has to belong to a
    // conversation either way.
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
    // A screenplay pasted in with --script is legitimately long, so the ceiling
    // is the model's problem rather than this route's.
    if (brief.length > 60_000) {
      return NextResponse.json({ ok: false, error: "brief_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }

    // Stacked capability tokens are refused rather than silently folded into
    // the brief, where they would be read as story material.
    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: "vimax",
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    // The user's house style, frame and scene budget are where the production
    // starts; a flag in the brief still overrides each of them.
    const parsed = parseVimaxRequest(brief, vimaxDefaults(agentSettingsFor(userId, "vimax")));
    if (!parsed.brief) {
      return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    }
    const reasoningEffort =
      requestedEffort === "max"
        ? "xhigh"
        : ALLOWED_EFFORTS.has(requestedEffort)
          ? requestedEffort
          : "medium";
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      conversationPublicId,
      brief,
      parsed,
      model,
      reasoningEffort,
      baseUrl: baseURL,
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
