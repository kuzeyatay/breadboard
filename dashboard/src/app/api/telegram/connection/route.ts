import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { telegramFeatureEnabled } from "@/lib/telegram/config.ts";
import { getTelegramGateway } from "@/lib/telegram/gateway.ts";
import { getTelegramStore } from "@/lib/telegram/instance.ts";
import {
  linkTelegramBot,
  startTelegramGateway,
  stopTelegramGateway,
  unlinkTelegramBot,
} from "@/lib/telegram/service.ts";
import { telegramStatus } from "@/lib/telegram/status.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = ["link", "connect", "disconnect", "unlink", "allow"] as const;
type Action = (typeof ACTIONS)[number];

function parseAction(value: unknown): Action {
  if (typeof value === "string" && (ACTIONS as readonly string[]).includes(value)) {
    return value as Action;
  }
  throw new ApiError(400, "invalid_action", "Unknown Telegram action.");
}

/**
 * The lifecycle of the bot link. `link` validates a BotFather token and stores it
 * on disk out of the browser's reach; `connect`/`disconnect` own the long poll;
 * `unlink` forgets the token entirely; `allow` admits a sender the allowlist
 * turned away.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    if (!telegramFeatureEnabled()) {
      throw new ApiError(
        503,
        "telegram_disabled",
        "Telegram is switched off for this installation.",
      );
    }
    const store = getTelegramStore();
    store.requireOwner(userId);
    const body = await readJsonBody(request);
    const action = parseAction(body.action);

    switch (action) {
      case "link":
        // The token is read straight out of the body and handed to the service;
        // it is never echoed back, logged, or written to the database.
        await linkTelegramBot(userId, typeof body.token === "string" ? body.token : "");
        break;
      case "connect":
        store.claimOwner(userId);
        await startTelegramGateway();
        break;
      case "disconnect":
        await stopTelegramGateway();
        break;
      case "unlink":
        await unlinkTelegramBot();
        break;
      case "allow": {
        const senderId = typeof body.senderId === "string" ? body.senderId : "";
        store.claimOwner(userId);
        store.allowSender(senderId);
        getTelegramGateway().clearBlockedSender(senderId);
        break;
      }
    }

    return NextResponse.json({ status: telegramStatus(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
