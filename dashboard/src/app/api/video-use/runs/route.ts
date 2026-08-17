import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { selectedModelForUser } from "@/lib/selected-model.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { videoUseDefaults } from "@/lib/agent-settings/defaults.ts";
import {
  parseVideoUseRequestBody,
  VIDEO_USE_AGENT_ID,
} from "@/lib/video-use/identity.ts";
import { startRun } from "@/lib/video-use/run-manager.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start one edit. The body names the video (an artifact already in the archive,
 * or a video staged by the upload route) and says what should change about it.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 32 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    // The chat passes the model it is running on. The studio can be opened from
    // the Artifacts tab, where there is no chat and so no model to pass, so the
    // user's own selection stands in — an edit started there is still theirs.
    const model =
      (typeof body.model === "string" ? body.model.trim() : "") || selectedModelForUser(userId);

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
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }

    // Stored defaults fill in what the message does not say. Anything the
    // message does say wins, which is why `quality` is read from the request
    // first and only falls back here.
    // This agent takes a file, and never as a path: a video attachment arrives
    // as the `blobId` it was stored under, a link as a URL to fetch, an
    // existing video as its artifact id. All three are resolved inside the
    // caller's own scope by the run manager. Which fields carry them lives in
    // `parseVideoUseRequestBody`, so the route cannot fall behind a new one.
    const defaults = videoUseDefaults(agentSettingsFor(userId, VIDEO_USE_AGENT_ID));
    const parsed = parseVideoUseRequestBody(body.request, defaults);

    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = startRun({
      userId,
      conversationPublicId,
      request: parsed,
      model,
      reasoningEffort: defaults.reasoningEffort,
      baseUrl: baseURL,
      // The chat this was launched from, so a request that refers back to
      // it resolves instead of arriving as a bare fragment.
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
