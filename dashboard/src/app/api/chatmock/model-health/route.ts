import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const NOTHING_WRONG = { failover: null, accounts: [], cooldowns: [] };

/**
 * Which model is actually serving right now, and why it is not the chosen one.
 *
 * A spent plan window lasts days. Without this the only symptom is an error in
 * whichever subsystem asked first, which reads like a bug rather than "the plan
 * is out" — so the model picker announces it instead.
 *
 * A proxy that is unreachable or too old to answer reports "nothing wrong":
 * this endpoint exists to explain a degraded state, and inventing one from its
 * own failure would be a notice the reader can do nothing about.
 */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const { baseURL } = resolveChatmockBaseUrl(request);

    const response = await fetch(`${baseURL}/settings/model-health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return NextResponse.json(NOTHING_WRONG);

    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return NextResponse.json(NOTHING_WRONG);
  }
}
