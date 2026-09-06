import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { conversationContextFromBody, contextConversationFromBody } from "@/lib/conversations/agent-context.ts";
import { MUSIC_PRODUCER_AGENT_ID } from "@/lib/music-producer/identity.ts";
import { musicDefaults, type MusicRequest } from "@/lib/music-producer/request.ts";
import { startRun } from "@/lib/music-producer/run-manager.ts";
import { resolveMusicSource } from "@/lib/music-producer/sources.ts";
import { musicRouteError } from "@/lib/music-producer/route-error.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 64 * 1024);
    const conversation = contextConversationFromBody(userId, body);
    if (!conversation)
      return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!task || task.length > 24000 || !model || model.length > 256 || typeof body.clientMessageId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.clientMessageId))
      return NextResponse.json({ error: "invalid_music_launch" }, { status: 400 });
    const explicit = (body.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options : {}) as Partial<MusicRequest>;
    if (Object.keys(explicit).some(key => !["operation", "brief", "lyrics", "lyricsAction", "vocalMode", "language", "duration", "bpm", "key", "timeSignature", "seed", "source", "interval", "preserveOutsideInterval", "outputFormat", "inferenceSteps", "guidanceScale"].includes(key)))
      return NextResponse.json({ error: "unknown_music_option" }, { status: 400 });
    if (explicit.source)
      resolveMusicSource(userId, conversation.public_id, explicit.source);
    // Attachments are selected from the existing authenticated conversation, never arbitrary paths.
    const { baseURL } = resolveChatmockBaseUrl(request);
    const effort = typeof body.reasoningEffort === "string" && ["none", "low", "medium", "high", "xhigh"].includes(body.reasoningEffort) ? body.reasoningEffort : "medium";
    const run = await startRun({
      userId, task, model, reasoningEffort: effort, baseUrl: baseURL,
      clientMessageId: body.clientMessageId, conversationPublicId: conversation.public_id,
      conversationContext: conversationContextFromBody(userId, body), defaults: musicDefaults(agentSettingsFor(userId, MUSIC_PRODUCER_AGENT_ID)), explicit,
      delegatedAgentRun: body.delegatedAgentRun === true, internalAgentContinuation: body.internalAgentContinuation === true, attachToExistingTurn: body.attachToExistingTurn === true
    });
    return NextResponse.json({ ok: true, run }, { status: 201 });
  }
  catch (error) {
    return musicRouteError(error);
  }
}
