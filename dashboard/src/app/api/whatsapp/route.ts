import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getWhatsAppBridge } from "@/lib/whatsapp/bridge.ts";
import { getWhatsAppStore } from "@/lib/whatsapp/instance.ts";
import { whatsAppStatus } from "@/lib/whatsapp/status.ts";
import { startWhatsAppGateway } from "@/lib/whatsapp/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Everything the Terminal's WhatsApp panel renders, in one poll. */
export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ status: await whatsAppStatus(userId) });
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

    // The bridge reads mode and allowlist from its environment at spawn time, so
    // a change only takes effect on a restart.
    if (getWhatsAppBridge().currentState() === "connected") {
      await startWhatsAppGateway().catch(() => undefined);
    }
    return NextResponse.json({ status: await whatsAppStatus(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
