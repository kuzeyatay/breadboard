import { NextResponse } from "next/server";
import { getConversationById } from "@/lib/conversations/store.ts";
import { capabilityForInternalToolRequest } from "@/lib/hermes/tool-service-auth.ts";
import { verifyCapabilityToken } from "@/lib/hermes/capability-token.ts";
import { getRuntimeSessionById, runtimeExternalSessionId } from "@/lib/hermes/runtime-store.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import { findAgencyAgent, renderAgencyAgentPersona } from "@/lib/hermes/agency-agents.ts";
import { botsStore } from "@/lib/bots/server.ts";
import { BOT_PERSONA_PREFIX, botByHandle, botMemorySection } from "@/lib/bots/team.ts";
import { botPersonalityPrompt } from "@/lib/bots/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Internal preference lookup for a delegated worker, scoped to its parent session. */
export async function POST(request: Request) {
  try {
    requireEnabled();
    const verified = verifyCapabilityToken(capabilityForInternalToolRequest(request));
    if (!verified.ok) throw new ApiError(403, "prompt_session_unauthorized", "The agent session is not authorized.");
    const session = getRuntimeSessionById(Number(verified.token.breadboardSessionId));
    if (!session || !session.user_id || !session.conversation_id ||
      session.user_id !== verified.token.userId ||
      session.conversation_id !== verified.token.conversationId ||
      runtimeExternalSessionId(session) !== verified.token.hermesSessionId) {
      throw new ApiError(403, "prompt_session_mismatch", "The agent session scope is invalid.");
    }
    const conversation = getConversationById(session.conversation_id);
    if (!conversation || conversation.user_id !== session.user_id) {
      throw new ApiError(403, "prompt_conversation_mismatch", "The agent conversation is unavailable.");
    }
    const body = await readJsonBody(request, 2048);
    const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as Record<string, unknown> : {};
    if (body.action !== "system_prompt_persona" || typeof args.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(args.slug)) {
      throw new ApiError(400, "invalid_prompt_persona", "Choose a valid specialist persona.");
    }
    // "[persona: bot-sage]" is a teammate bot (lib/bots/team.ts), not a catalog specialist.
    if (args.slug.startsWith(BOT_PERSONA_PREFIX)) {
      const bot = botByHandle(botsStore().list(session.user_id), args.slug.slice(BOT_PERSONA_PREFIX.length));
      return NextResponse.json({ persona: bot ? `${botPersonalityPrompt(bot)}\n\n${botMemorySection(session.user_id, bot, "")}` : null },
        { headers: { "Cache-Control": "no-store" } });
    }
    const agent = findAgencyAgent(args.slug);
    return NextResponse.json({ persona: agent ? renderAgencyAgentPersona(agent, session.user_id) : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
