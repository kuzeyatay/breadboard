import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server.ts";
import { startRun } from "@/lib/max-research/run-manager.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json(
        { ok: false, error: "question_required" },
        { status: 400 },
      );
    }
    const run = startRun({
      userId,
      question: question.slice(0, 4_000),
      model: typeof body.model === "string" ? body.model : "",
      reasoningEffort:
        typeof body.reasoningEffort === "string" ? body.reasoningEffort : "medium",
      baseUrl: resolveChatmockBaseUrl(request).baseURL,
      ...(typeof body.conversationContext === "string"
        ? { conversationContext: body.conversationContext.slice(0, 20_000) }
        : {}),
    });
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "max_research_failed",
      },
      { status: 500 },
    );
  }
}
