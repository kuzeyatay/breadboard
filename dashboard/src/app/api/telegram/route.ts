import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getTelegramStore } from "@/lib/telegram/instance.ts";
import { telegramStatus } from "@/lib/telegram/status.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Everything the Settings panel renders for Telegram, in one poll. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ status: telegramStatus(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * Allowlist and autostart. Both take effect on the next inbound message — the
 * gate is re-read per message, so nothing has to be reconnected.
 */
export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const store = getTelegramStore();
    store.requireOwner(userId);
    const body = await readJsonBody(request);
    store.updateSettings({
      allowedUsers: body.allowedUsers,
      autostart: body.autostart,
    });
    return NextResponse.json({ status: telegramStatus(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
