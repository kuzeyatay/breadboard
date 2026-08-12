import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { validateFormsmithRequest } from "@/lib/shaper/identity.ts";
import { shapeRHealth } from "@/lib/shaper/runtime.ts";
import { startFormsmithRun } from "@/lib/shaper/run-manager.ts";
import { ensureConversationForLegacyChatSession } from "@/lib/conversations/store.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 16 * 1024) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    const validated = validateFormsmithRequest(body.request);
    if (!validated.ok) {
      return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
    }
    let conversationPublicId =
      typeof body.conversationPublicId === "string" ? body.conversationPublicId.trim() : "";
    if (!conversationPublicId && typeof body.chatSessionId === "number") {
      try {
        conversationPublicId = ensureConversationForLegacyChatSession(body.chatSessionId, userId).public_id;
      } catch {
        conversationPublicId = "";
      }
    }
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }
    const health = await shapeRHealth();
    if (!health.available) {
      return NextResponse.json(
        { ok: false, error: health.reason ?? "ShapeR is not ready." },
        { status: 503 },
      );
    }
    const run = startFormsmithRun({
      userId,
      conversationPublicId,
      request: validated.request,
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
