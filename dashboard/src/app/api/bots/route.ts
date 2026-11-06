import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { readJsonBody, apiErrorResponse } from "@/lib/hermes/route-helpers";
import { botsStore } from "@/lib/bots/server";
import { BotStoreError } from "@/lib/bots/store";

export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return error instanceof BotStoreError ? NextResponse.json({ error: error.message }, { status: error.status }) : apiErrorResponse(error);
}
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const conversationId = new URL(request.url).searchParams.get("conversationId");
    if (conversationId) {
      const { getConversationForUser } = await import("@/lib/conversations/store");
      getConversationForUser(conversationId, userId);
      return NextResponse.json({ bot: botsStore().forConversation(userId, conversationId) });
    }
    return NextResponse.json({ bots: botsStore().list(userId) });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 32 * 1024);
    if (body.action === "chat") {
      if (typeof body.id !== "string") throw new BotStoreError(400, "Choose a bot.");
      // The roster and editor do not need the chat store's memory/agent graph.
      const { createConversation } = await import("@/lib/conversations/store");
      const conversationId = botsStore().chat(userId, body.id, (name) => createConversation({ userId, title: name, surface: "dashboard_terminal", originLabel: "Bot" }));
      return NextResponse.json({ conversationId });
    }
    return NextResponse.json({ bot: botsStore().save(userId, body) }, { status: 201 });
  } catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 32 * 1024);
    if (typeof body.id !== "string") throw new BotStoreError(400, "Choose a bot.");
    return NextResponse.json({ bot: botsStore().save(userId, body, body.id) });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 4096);
    if (typeof body.id !== "string") throw new BotStoreError(400, "Choose a bot.");
    botsStore().archive(userId, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
