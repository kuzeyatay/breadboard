// `bot_memory` — a bot's own memory (orgo-teammates' remember / recall).
//
// Bread keeps using the account's memory. A bot (Sage, Byte, your own) keeps
// what it learns here, against its own id, and sees it again in its persona on
// its next turn (lib/bots/team.ts botMemorySection). Scoped to the session's
// user: a bot is looked up only in that account's roster.

import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { tokenAllows, verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { botsStore } from "@/lib/bots/server.ts";
import { BotStoreError } from "@/lib/bots/store.ts";
import { BREAD_BOT_HANDLE, botByHandle } from "@/lib/bots/mentions.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOOL = "bot_memory";

export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok || !tokenAllows(verified.token, { tool: TOOL })) {
      throw new ApiError(403, "bot_memory_capability_denied", "Bot memory is not authorized for this turn.");
    }
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (!session || !session.user_id || session.conversation_id === null ||
      !["dashboard_terminal", "garden_chat"].includes(session.surface) ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId ||
      verified.token.conversationId !== session.conversation_id) {
      throw new ApiError(403, "bot_memory_session_scope_mismatch", "Bot memory session scope is invalid.");
    }
    const body = await readJsonBody(request, 8 * 1024);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as Record<string, unknown> : {};
    const handle = typeof args.bot === "string" ? args.bot.trim().replace(/^@/, "").toLowerCase() : "";
    if (handle === BREAD_BOT_HANDLE) {
      throw new ApiError(400, "bot_memory_bread", "Bread uses the account's own memory, not bot_memory.");
    }
    const bot = botByHandle(botsStore().list(session.user_id), handle);
    if (!bot) throw new ApiError(404, "bot_memory_unknown_bot", `No bot is mentioned as @${handle || "?"} on this team.`);

    const store = botsStore();
    switch (args.action) {
      case "remember":
        return NextResponse.json({ ok: true, data: { saved: store.remember(session.user_id, bot.id, String(args.text ?? "")) } });
      case "recall":
        return NextResponse.json({ ok: true, data: { memories: store.recall(session.user_id, bot.id, String(args.query ?? "")) } });
      case "forget":
        return NextResponse.json({ ok: true, data: { forgotten: store.forget(session.user_id, bot.id, Number(args.id)) } });
      default:
        throw new ApiError(400, "bot_memory_action", 'action must be "remember", "recall" or "forget".');
    }
  } catch (error) {
    if (error instanceof BotStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
