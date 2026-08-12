import { NextResponse } from "next/server";
import {
  isValidProviderId,
  providerErrorResponseInit,
  verifyProvider,
} from "@/lib/chatmock-providers";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/** Ask ChatMock to exercise a provider's stored credentials. */
export async function POST(request: Request) {
  try {
    await requireUserId();

    const body = (await request.json().catch(() => ({}))) as { providerId?: unknown };
    if (!isValidProviderId(body.providerId)) {
      throw new RouteError(400, "A provider id is required.");
    }

    const result = await verifyProvider(request, body.providerId);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    const { status, message } = providerErrorResponseInit(error);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
