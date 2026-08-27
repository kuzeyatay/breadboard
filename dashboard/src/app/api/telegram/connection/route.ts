import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { telegramFeatureEnabled } from "@/lib/telegram/config.ts";
import { getTelegramStore } from "@/lib/telegram/instance.ts";
import {
  reconcileRuntimeGateway,
  runtimeGatewayAction,
  runtimeGatewayStatus,
} from "@/lib/runtime-v2/gateway-control.ts";
import { telegramStatus } from "@/lib/telegram/status.ts";
import type { TelegramStatus } from "@/lib/telegram/status.ts";

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
        await reconcileRuntimeGateway("telegram", "running", userId);
        await runtimeGatewayAction<TelegramStatus>("telegram", {
          userId,
          action: "link",
          value: typeof body.token === "string" ? body.token : "",
        });
        break;
      case "connect":
        store.claimOwner(userId);
        await reconcileRuntimeGateway("telegram", "running", userId);
        await runtimeGatewayAction<TelegramStatus>("telegram", {
          userId,
          action: "connect",
          value: null,
        });
        break;
      case "disconnect":
        await reconcileRuntimeGateway("telegram", "running", userId);
        try {
          await runtimeGatewayAction<TelegramStatus>("telegram", {
            userId,
            action: "disconnect",
            value: null,
          });
        } finally {
          await reconcileRuntimeGateway("telegram", "stopped", userId);
        }
        break;
      case "unlink":
        await reconcileRuntimeGateway("telegram", "running", userId);
        try {
          await runtimeGatewayAction<TelegramStatus>("telegram", {
            userId,
            action: "unlink",
            value: null,
          });
        } finally {
          await reconcileRuntimeGateway("telegram", "stopped", userId);
        }
        break;
      case "allow": {
        const senderId = typeof body.senderId === "string" ? body.senderId : "";
        store.claimOwner(userId);
        store.allowSender(senderId);
        if (await runtimeGatewayStatus<TelegramStatus>("telegram", userId)) {
          await runtimeGatewayAction<TelegramStatus>("telegram", {
            userId,
            action: "allow",
            value: senderId,
          });
        }
        break;
      }
    }

    const status = (await runtimeGatewayStatus<TelegramStatus>("telegram", userId)) ??
      telegramStatus(userId);
    return NextResponse.json({ status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
