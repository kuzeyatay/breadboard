import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { startRun } from "@/lib/socials-manager/runtime-run-manager.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. Either way the run ends up
    // with the conversation its artifacts belong to.
    let conversationPublicId =
      typeof body.conversationPublicId === "string" && body.conversationPublicId.trim()
        ? body.conversationPublicId.trim()
        : null;
    if (!conversationPublicId && typeof body.chatSessionId === "number") {
      try {
        conversationPublicId = ensureConversationForLegacyChatSession(
          body.chatSessionId,
          userId,
        ).public_id;
      } catch {
        // No conversation means no artifacts; the posts still get written.
      }
    }

    if (!brief) return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    if (brief.length > 100_000) {
      return NextResponse.json({ ok: false, error: "brief_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }
    // `taskFromSocialsManagerCommand` keeps any capability tokens the user stacked in
    // front of the command, but this run never resolves them — they would be
    // drafted into the posts as literal text. Refuse rather than mangle.
    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: "socials-manager",
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    const { baseURL } = resolveChatmockBaseUrl(request);
    const clientMessageId = typeof body.clientMessageId === "string"
      ? body.clientMessageId.trim()
      : "";
    const run = await startRun({
      userId,
      ...(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(clientMessageId)
        ? { requestId: clientMessageId }
        : {}),
      brief,
      model,
      baseUrl: baseURL,
      conversationPublicId,
      // The chat this was launched from, so a request that refers back to
      // it resolves instead of arriving as a bare fragment.
      conversationContext: conversationContextFromBody(userId, body),
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
