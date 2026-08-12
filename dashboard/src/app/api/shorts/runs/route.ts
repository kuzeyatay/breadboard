import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { shortsDefaults } from "@/lib/agent-settings/defaults.ts";
import { SHORTS_AGENT_ID, validateShortsRequest } from "@/lib/shorts/identity.ts";
import { startRun } from "@/lib/shorts/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start one run. The body is a request object, never a prompt: this agent takes
 * a video and nothing else, so the route validates the same shape the composer's
 * form produces and refuses anything else.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    const validated = validateShortsRequest(body.request);
    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
    }

    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. The clips have to belong to a
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
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }

    // Stored defaults fill in what the form does not ask about — which Whisper
    // size transcribes the audio. Every field the form does ask about wins.
    const defaults = shortsDefaults(agentSettingsFor(userId, SHORTS_AGENT_ID));

    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      conversationPublicId,
      request: validated.request,
      model,
      whisperModel: defaults.whisperModel,
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
