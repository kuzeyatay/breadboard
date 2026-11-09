import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { listSystemPrompts, updateSystemPrompt } from "@/lib/system-prompts/service";
import { MAX_SYSTEM_PROMPT_LENGTH } from "@/lib/system-prompts/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ prompts: listSystemPrompts(userId) }, { headers });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > MAX_SYSTEM_PROMPT_LENGTH * 6 + 1_024) throw new RouteError(413, "System prompt is too large.");
    let body: Record<string, unknown>;
    try { body = JSON.parse(text); } catch { throw new RouteError(400, "Invalid JSON."); }
    if (!body || Array.isArray(body) || typeof body !== "object" || typeof body.id !== "string"
      || (typeof body.content !== "string" && body.content !== null) || typeof body.revision !== "number") {
      throw new RouteError(400, "Provide a prompt, its content, and its revision.");
    }
    const prompt = updateSystemPrompt(userId, { id: body.id, content: body.content, revision: body.revision });
    return NextResponse.json({ prompt }, { headers });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
