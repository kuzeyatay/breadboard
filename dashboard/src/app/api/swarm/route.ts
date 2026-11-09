import { NextResponse } from "next/server";
import db from "@/lib/db.ts";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth.ts";
import { getConversationForUser, getConversationForLegacyChatSession } from "@/lib/conversations/store.ts";
import { swarmStore } from "@/lib/swarm/service.ts";
import { wakeSwarm } from "@/lib/swarm/pump.ts";
import { requireSameOrigin } from "@/lib/request-origin.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const id = new URL(request.url).searchParams.get("conversationId") ?? "";
    const conversation = id.startsWith("conv_") ? getConversationForUser(id, userId) :
      /^\d+$/u.test(id) ? getConversationForLegacyChatSession(Number(id), userId) : null;
    if (!conversation) throw new RouteError(404, "Conversation not found.");
    const store = swarmStore();
    const latest = db.prepare("SELECT id FROM swarm_runs WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 1")
      .get(userId, conversation.id) as { id: string } | undefined;
    if (!latest) return NextResponse.json({ ok: true, team: null });
    wakeSwarm(userId, latest.id);
    return NextResponse.json({ ok: true, team: store.snapshot(userId, latest.id) });
  } catch (error) { return routeErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request, "Team controls must originate in Breadboard.");
    const userId = await requireUserId();
    const text = await request.text();
    if (text.length > 16_384) throw new RouteError(413, "Request too large.");
    let body: { runId?: string; action?: string; taskKey?: string; brief?: string };
    try { body = JSON.parse(text); } catch { throw new RouteError(400, "Invalid JSON."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RouteError(400, "An action object is required.");
    const store = swarmStore();
    const runId = String(body.runId ?? "");
    store.get(userId, runId);
    if (body.action === "approve") store.approve(userId, runId, String(body.taskKey ?? ""));
    else if (body.action === "retry") store.retry(userId, runId, String(body.taskKey ?? ""), String(body.brief ?? ""));
    else if (body.action === "pause" || body.action === "resume" || body.action === "stop") store.control(userId, runId, body.action === "stop" ? "cancel" : body.action);
    else throw new RouteError(400, "Choose approve, retry, pause, resume or stop.");
    wakeSwarm(userId, runId);
    return NextResponse.json({ ok: true, team: store.snapshot(userId, runId) });
  } catch (error) { return routeErrorResponse(error); }
}
