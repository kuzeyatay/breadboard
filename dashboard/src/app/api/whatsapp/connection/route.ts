import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
} from "@/lib/hermes/route-helpers.ts";
import { getWhatsAppStore } from "@/lib/whatsapp/instance.ts";
import {
  reconcileRuntimeGateway,
  runtimeGatewayAction,
  runtimeGatewayStatus,
} from "@/lib/runtime-v2/gateway-control.ts";
import { whatsAppStatus } from "@/lib/whatsapp/status.ts";
import type { WhatsAppStatus } from "@/lib/whatsapp/status.ts";
import { whatsAppFeatureEnabled } from "@/lib/whatsapp/config.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = ["pair", "cancel-pair", "connect", "disconnect", "unlink"] as const;
type Action = (typeof ACTIONS)[number];

function parseAction(value: unknown): Action {
  if (typeof value === "string" && (ACTIONS as readonly string[]).includes(value)) {
    return value as Action;
  }
  throw new ApiError(400, "invalid_action", "Unknown WhatsApp action.");
}

/**
 * The lifecycle of the linked device. Pairing spawns the bridge in QR mode,
 * connect brings up the message gateway, unlink removes the credentials so the
 * device disappears from WhatsApp's Linked Devices list on next contact.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    if (!whatsAppFeatureEnabled()) {
      throw new ApiError(
        503,
        "whatsapp_disabled",
        "WhatsApp is switched off for this installation.",
      );
    }
    const store = getWhatsAppStore();
    store.requireOwner(userId);
    const action = parseAction((await readJsonBody(request)).action);

    switch (action) {
      case "pair":
        await reconcileRuntimeGateway("whatsapp", "running", userId);
        await runtimeGatewayAction<WhatsAppStatus>("whatsapp", { userId, action: "pair" });
        break;
      case "cancel-pair": {
        const status = await runtimeGatewayAction<WhatsAppStatus>("whatsapp", {
          userId,
          action: "cancel-pair",
        });
        if (status.state !== "connected") {
          await reconcileRuntimeGateway("whatsapp", "stopped", userId);
        }
        break;
      }
      case "connect":
        store.claimOwner(userId);
        await reconcileRuntimeGateway("whatsapp", "running", userId);
        await runtimeGatewayAction<WhatsAppStatus>("whatsapp", { userId, action: "connect" });
        break;
      case "disconnect":
        await reconcileRuntimeGateway("whatsapp", "running", userId);
        try {
          await runtimeGatewayAction<WhatsAppStatus>("whatsapp", { userId, action: "disconnect" });
        } finally {
          await reconcileRuntimeGateway("whatsapp", "stopped", userId);
        }
        break;
      case "unlink":
        await reconcileRuntimeGateway("whatsapp", "running", userId);
        try {
          await runtimeGatewayAction<WhatsAppStatus>("whatsapp", { userId, action: "unlink" });
        } finally {
          await reconcileRuntimeGateway("whatsapp", "stopped", userId);
        }
        break;
    }

    const status = (await runtimeGatewayStatus<WhatsAppStatus>("whatsapp", userId)) ??
      await whatsAppStatus(userId);
    return NextResponse.json({ status });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
