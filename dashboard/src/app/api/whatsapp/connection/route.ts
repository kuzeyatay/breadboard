import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
} from "@/lib/hermes/route-helpers.ts";
import { getWhatsAppStore } from "@/lib/whatsapp/instance.ts";
import {
  cancelWhatsAppPairing,
  startWhatsAppGateway,
  startWhatsAppPairing,
  stopWhatsAppGateway,
  unlinkWhatsApp,
} from "@/lib/whatsapp/service.ts";
import { whatsAppStatus } from "@/lib/whatsapp/status.ts";
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
        await startWhatsAppPairing(userId);
        break;
      case "cancel-pair":
        await cancelWhatsAppPairing();
        break;
      case "connect":
        store.claimOwner(userId);
        await startWhatsAppGateway();
        break;
      case "disconnect":
        await stopWhatsAppGateway();
        break;
      case "unlink":
        await unlinkWhatsApp();
        break;
    }

    return NextResponse.json({ status: await whatsAppStatus(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
