import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import {
  MONEY_PRINTER_AGENT_ID,
  parseMoneyPrinterRequest,
} from "@/lib/money-printer/identity.ts";
import { moneyPrinterSettingsFrom } from "@/lib/money-printer/settings.ts";
import { startRun } from "@/lib/money-printer/runtime-run-manager.ts";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    // conversation is resolved (or created) here. The video has to belong to a
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

    if (!brief) return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    // A narration pasted in with --script is legitimately long; anything past
    // this is not a script the clone would read to the end anyway.
    if (brief.length > 40_000) {
      return NextResponse.json({ ok: false, error: "brief_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }

    // Stacked capability tokens are refused rather than silently folded into the
    // brief, where they would be read as the subject of the video.
    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: MONEY_PRINTER_AGENT_ID,
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    // The user's frame, narrator, footage library and clip length are where the
    // video starts; a flag in the message still overrides each of them.
    const parsed = parseMoneyPrinterRequest(
      brief,
      moneyPrinterSettingsFrom(agentSettingsFor(userId, MONEY_PRINTER_AGENT_ID)),
    );
    if (!parsed.subject.trim()) {
      return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    }

    const { baseURL } = resolveChatmockBaseUrl(request);
    const clientMessageId =
      typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
    const run = await startRun({
      userId,
      ...(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(clientMessageId)
        ? { requestId: clientMessageId }
        : {}),
      conversationPublicId,
      request: parsed,
      model,
      baseUrl: baseURL,
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
    return NextResponse.json({ ok: false, error: "runtime_error" }, { status: 502 });
  }
}
