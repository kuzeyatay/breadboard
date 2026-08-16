// Per-user spaced-repetition delivery settings — the profile page's half of the
// feature. Which channel questions arrive on, how many per day, and from what
// hour. Per-garden participation is a different resource: ../gardens/[slug].

import { NextResponse } from "next/server";

import { getReviewStore } from "@/lib/review/instance.ts";
import { isReviewChannel } from "@/lib/review/types.ts";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Whether each channel is actually linked, so the UI can explain an inert choice. */
async function channelAvailability(userId: number): Promise<{
  whatsapp: boolean;
  telegram: boolean;
}> {
  const [whatsapp, telegram] = await Promise.all([
    (async () => {
      try {
        const { getWhatsAppStore } = await import("@/lib/whatsapp/instance.ts");
        return getWhatsAppStore().listChats(userId, 25).some((row) => row.is_group === 0);
      } catch {
        return false;
      }
    })(),
    (async () => {
      try {
        const [{ getTelegramStore }, { hasBotToken }] = await Promise.all([
          import("@/lib/telegram/instance.ts"),
          import("@/lib/telegram/credentials.ts"),
        ]);
        return (
          hasBotToken() &&
          getTelegramStore().listChats(userId, 25).some((row) => row.is_group === 0)
        );
      } catch {
        return false;
      }
    })(),
  ]);
  return { whatsapp, telegram };
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const store = getReviewStore();
    return NextResponse.json({
      settings: store.userSettings(userId),
      stats: store.stats(userId),
      available: await channelAvailability(userId),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.channel !== undefined && !isReviewChannel(body.channel)) {
      return NextResponse.json(
        { error: "invalid_channel", message: "Choose WhatsApp, Telegram, or off." },
        { status: 400 },
      );
    }

    const store = getReviewStore();
    // Every numeric field is clamped inside the store rather than validated
    // here, so the API and the panel cannot disagree about the bounds.
    const settings = store.setUserSettings(userId, {
      ...(body.channel !== undefined ? { channel: body.channel } : {}),
      ...(body.dailyLimit !== undefined ? { dailyLimit: Number(body.dailyLimit) } : {}),
      ...(body.sendHour !== undefined ? { sendHour: Number(body.sendHour) } : {}),
      ...(body.desiredRetention !== undefined
        ? { desiredRetention: Number(body.desiredRetention) }
        : {}),
    });

    return NextResponse.json({
      settings,
      stats: store.stats(userId),
      available: await channelAvailability(userId),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
