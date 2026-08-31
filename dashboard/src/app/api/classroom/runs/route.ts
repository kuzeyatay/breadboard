import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { parseChatAttachments } from "@/lib/chat-attachments-request.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { classroomDefaults } from "@/lib/agent-settings/defaults.ts";
import {
  conversationContextFromBody,
  contextConversationFromBody,
} from "@/lib/conversations/agent-context.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";
import { CLASSROOM_AGENT_ID, parseClassroomRequest } from "@/lib/classroom/identity.ts";
import { classroomAvailability } from "@/lib/classroom/runtime.ts";
import { startRun } from "@/lib/classroom/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    // Documents arrive with their extracted text and page images inline.
    if (text.length > 40 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const brief = typeof body.brief === "string" ? body.brief.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const attachments = parseChatAttachments(body.attachments);
    if (!brief) return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    if (brief.length > 20_000) {
      return NextResponse.json({ ok: false, error: "brief_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    // Refused here, with the sentence that says how to fix it, rather than as
    // a failed run card from a server the person never sees.
    const availability = classroomAvailability();
    if (!availability.available) {
      return NextResponse.json(
        { ok: false, error: "classroom_unavailable", message: availability.reason },
        { status: 503 },
      );
    }

    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: CLASSROOM_AGENT_ID,
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    // Stored preferences fill only what the message left unsaid.
    const parsed = parseClassroomRequest(
      brief,
      classroomDefaults(agentSettingsFor(userId, CLASSROOM_AGENT_ID)),
    );
    if (!parsed.brief) {
      return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    }

    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. The classroom is filed as an
    // artifact of that chat.
    let conversationPublicId = contextConversationFromBody(userId, body)?.public_id ?? "";
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

    const { baseURL } = resolveChatmockBaseUrl(request);
    const clientMessageId =
      typeof body.clientMessageId === "string" ? body.clientMessageId.trim() : "";
    const run = await startRun({
      userId,
      ...(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(clientMessageId)
        ? { requestId: clientMessageId }
        : {}),
      request: parsed,
      attachments,
      model,
      baseUrl: baseURL,
      conversationPublicId: conversationPublicId || undefined,
      // The chat this was launched from, so a brief that leans on it — "turn
      // that into a lesson" — resolves instead of arriving as a fragment.
      conversationContext: conversationContextFromBody(userId, body),
    });
    return NextResponse.json({ ok: true, run, request: parsed }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }
    if (error instanceof ApiError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
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
