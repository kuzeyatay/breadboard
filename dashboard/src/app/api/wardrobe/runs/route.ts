import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { parseChatAttachments } from "@/lib/chat-attachments-request.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { findConfigurableAgent } from "@/lib/agent-settings/catalog.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import { ApiError } from "@/lib/hermes/route-core.ts";
import {
  parseWardrobeRequest,
  WARDROBE_AGENT_ID,
} from "@/lib/wardrobe/identity.ts";
import { readWardrobeRuntimeStatus } from "@/lib/wardrobe/runtime-service.ts";
import { startRun } from "@/lib/wardrobe/runtime-run-manager.ts";
import {
  DEFAULT_WARDROBE_SETTINGS,
  requestDefaultsFrom,
  wardrobeSettingsFrom,
} from "@/lib/wardrobe/settings.ts";
import { conversationContextFromBody } from "@/lib/conversations/agent-context.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    // Ten full-resolution photographs arrive in this body as data URLs.
    if (text.length > 40 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "payload_too_large" },
        { status: 413 },
      );
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const task = typeof body.task === "string" ? body.task.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const attachments = parseChatAttachments(body.attachments);

    // The terminal knows its conversation by public id; garden chat still runs
    // on legacy numeric chat sessions, so it sends that instead and the
    // conversation is resolved (or created) here. The pictures a run produces
    // are stored as artifacts of that chat.
    let conversationPublicId =
      typeof body.conversationPublicId === "string"
        ? body.conversationPublicId.trim()
        : "";
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

    if (!model) {
      return NextResponse.json(
        { ok: false, error: "model_not_configured" },
        { status: 400 },
      );
    }
    if (task.length > 4_000) {
      return NextResponse.json(
        { ok: false, error: "task_too_long" },
        { status: 400 },
      );
    }
    // The photos are the request, so a message with none of them would start a
    // run that could only fail. Refused here, where it can still be explained.
    if (!attachments.some((attachment) => attachment.type === "image")) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_photos",
          message: "Attach photos of the clothes you want imported.",
        },
        { status: 400 },
      );
    }

    // The clone will not accept a photo until an identity reference exists, so a
    // missing one is refused with the sentence that says how to fix it rather
    // than surfacing as a 503 from a server the person never sees.
    const { availability } = await readWardrobeRuntimeStatus({ userId });
    if (!availability.available) {
      return NextResponse.json(
        {
          ok: false,
          error: "wardrobe_unavailable",
          message: availability.reason,
        },
        { status: 503 },
      );
    }

    // The direction is passed to the image generator verbatim, so a stacked
    // capability token would arrive as prose. Refused rather than swallowed.
    const conflict = findCapabilityConflict({
      text: task,
      surface:
        typeof body.chatSessionId === "number"
          ? "garden_chat"
          : "dashboard_terminal",
      activeRuntimeAgentId: WARDROBE_AGENT_ID,
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    // Stored defaults decide what the message does not: how many pieces one
    // photo may contribute, and how hard the provider works on each image. A
    // flag typed in the message still wins.
    const settings = findConfigurableAgent(WARDROBE_AGENT_ID)
      ? wardrobeSettingsFrom(agentSettingsFor(userId, WARDROBE_AGENT_ID))
      : DEFAULT_WARDROBE_SETTINGS;
    const wardrobeRequest = parseWardrobeRequest(
      task,
      requestDefaultsFrom(settings),
    );

    const { baseURL } = resolveChatmockBaseUrl(request);
    const clientMessageId =
      typeof body.clientMessageId === "string"
        ? body.clientMessageId.trim()
        : "";
    const run = await startRun({
      userId,
      ...(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(clientMessageId)
        ? { requestId: clientMessageId }
        : {}),
      request: wardrobeRequest,
      attachments,
      model,
      baseUrl: baseURL,
      conversationPublicId,
      // The chat this was launched from, so direction that refers back to it
      // resolves instead of arriving as a bare fragment.
      conversationContext: conversationContextFromBody(userId, body),
    });
    return NextResponse.json({ ok: true, run }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { ok: false, error: "invalid_json" },
        { status: 400 },
      );
    }
    // A rejected attachment is the user's problem to fix, so it keeps its own
    // message instead of arriving as a generic 502.
    if (error instanceof ApiError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof RouteError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "runtime_error",
      },
      { status: 502 },
    );
  }
}
