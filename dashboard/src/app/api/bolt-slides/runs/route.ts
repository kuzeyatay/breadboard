import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { agentSettingsFor } from "@/lib/agent-settings/store.ts";
import { boltSlidesDefaults } from "@/lib/agent-settings/defaults.ts";
import {
  conversationContextFromBody,
  contextConversationFromBody,
} from "@/lib/conversations/agent-context.ts";
import { findCapabilityConflict } from "@/lib/hermes/capability-combinations.ts";
import {
  BOLT_SLIDES_AGENT_ID,
  parseBoltSlidesRequest,
} from "@/lib/bolt-slides/identity.ts";
import { startRun } from "@/lib/bolt-slides/runtime-run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EFFORTS = new Set(["none", "low", "medium", "high", "xhigh"]);

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
    if (!brief) return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    if (brief.length > 20_000) {
      return NextResponse.json({ ok: false, error: "brief_too_long" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ ok: false, error: "model_not_configured" }, { status: 400 });
    }

    const conflict = findCapabilityConflict({
      text: brief,
      surface: typeof body.chatSessionId === "number" ? "garden_chat" : "dashboard_terminal",
      activeRuntimeAgentId: BOLT_SLIDES_AGENT_ID,
    });
    if (conflict) {
      return NextResponse.json(
        { ok: false, error: conflict.code, message: conflict.message },
        { status: 400 },
      );
    }

    // Stored preferences fill only what the message left unsaid.
    const parsed = parseBoltSlidesRequest(
      brief,
      boltSlidesDefaults(agentSettingsFor(userId, BOLT_SLIDES_AGENT_ID)),
    );
    if (!parsed.brief) {
      return NextResponse.json({ ok: false, error: "empty_brief" }, { status: 400 });
    }

    const rawEffort =
      typeof body.reasoningEffort === "string" ? body.reasoningEffort.toLowerCase() : "";
    const reasoningEffort =
      rawEffort === "max" ? "xhigh" : EFFORTS.has(rawEffort) ? rawEffort : undefined;
    const { baseURL } = resolveChatmockBaseUrl(request);
    const run = await startRun({
      userId,
      brief,
      request: parsed,
      model,
      reasoningEffort,
      baseUrl: baseURL,
      // Captured at launch: the finished deck is filed as an artifact of the
      // chat that asked for it, and by the time it exists the person may be
      // somewhere else entirely.
      conversationPublicId: contextConversationFromBody(userId, body)?.public_id,
      // The chat this was launched from, so a brief that leans on it — "turn
      // that into a deck" — resolves instead of arriving as a fragment.
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
