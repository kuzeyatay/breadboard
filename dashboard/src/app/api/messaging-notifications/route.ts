import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getMessagingNotificationStore } from "@/lib/messaging-notifications/instance.ts";
import { MessagingNotificationError } from "@/lib/messaging-notifications/store.ts";
import { isNotificationChannel } from "@/lib/messaging-notifications/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const channel = new URL(request.url).searchParams.get("channel");
    if (!isNotificationChannel(channel)) return NextResponse.json({ error: "Choose WhatsApp or Telegram." }, { status: 400 });
    return NextResponse.json({ settings: getMessagingNotificationStore().settings(userId, channel) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    if (!isNotificationChannel(body.channel)) return NextResponse.json({ error: "Choose WhatsApp or Telegram." }, { status: 400 });
    return NextResponse.json({ settings: getMessagingNotificationStore().update(userId, body.channel, body) });
  } catch (error) {
    if (error instanceof MessagingNotificationError) return NextResponse.json({ error: error.message }, { status: error.status });
    return apiErrorResponse(error);
  }
}
