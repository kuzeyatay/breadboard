import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getWhatsAppStore } from "@/lib/whatsapp/instance.ts";
import { whatsAppStatus } from "@/lib/whatsapp/status.ts";
import type { WhatsAppStatus } from "@/lib/whatsapp/status.ts";
import {
  runtimeGatewayStatus,
  updateRuntimeWhatsAppSettings,
} from "@/lib/runtime-v2/gateway-control.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function currentStatus(userId: number): Promise<WhatsAppStatus> {
  return (await runtimeGatewayStatus<WhatsAppStatus>("whatsapp", userId)) ??
    whatsAppStatus(userId);
}

/** Everything the Terminal's WhatsApp panel renders, in one poll. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ status: await currentStatus(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Mode, allowlist and autostart. A live bridge is restarted onto the new mode. */
export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const store = getWhatsAppStore();
    store.requireOwner(userId);
    const body = await readJsonBody(request);
    store.updateSettings({
      mode: body.mode,
      allowedNumbers: body.allowedNumbers,
      autostart: body.autostart,
    });

    // The bridge reads mode and allowlist at spawn time. If the native-owned
    // gateway is live, its settings endpoint performs the same restart.
    const live = await runtimeGatewayStatus<WhatsAppStatus>("whatsapp", userId);
    if (live?.state === "connected") {
      await updateRuntimeWhatsAppSettings<WhatsAppStatus>(userId, {
        mode: body.mode,
        allowedNumbers: body.allowedNumbers,
        autostart: body.autostart,
      });
    }
    return NextResponse.json({ status: await currentStatus(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
