import { NextResponse } from "next/server";
import { providerErrorResponseInit } from "@/lib/chatmock-providers";
import { syncSubscriptionCatalog } from "@/lib/cliproxy/catalog-sync";
import {
  CliproxyRequestError,
  CliproxyUnavailableError,
} from "@/lib/cliproxy/management";
import { SupervisorResourceExhaustedError } from "@/lib/supervisor-control";
import { runtimeAuthorityErrorResponse } from "@/lib/runtime-v2/authority-errors.ts";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * Teach ChatMock about the subscription proxy on demand (after a sign-in, or
 * from the Accounts panel). The same sync also runs on its own behind the
 * model picker; see `scheduleSubscriptionCatalogAutoSync`.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const { synced, skipped, state } = await syncSubscriptionCatalog(request, userId);
    return NextResponse.json(
      { synced, skipped, state },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CliproxyUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof CliproxyRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const runtimeResponse = runtimeAuthorityErrorResponse(error);
    if (runtimeResponse) return runtimeResponse;
    if (error instanceof SupervisorResourceExhaustedError) {
      return routeErrorResponse(error);
    }
    if (error instanceof RouteError) return routeErrorResponse(error);
    const { status, message } = providerErrorResponseInit(error);
    return NextResponse.json({ error: message }, { status });
  }
}
