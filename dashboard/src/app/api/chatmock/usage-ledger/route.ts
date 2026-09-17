import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const EMPTY = {
  generatedAt: null,
  since: null,
  rows: [],
  truncated: false,
  summary: { requests: 0, tokens: null, byAccount: [], byOrigin: [], byModel: [] },
  accounts: [],
  unavailable: true,
};

/**
 * ChatMock's usage ledger: one row per finished upstream call, naming the
 * account that paid, the tokens it cost, and what asked for it.
 *
 * `since`, `limit`, `account` and `source` pass straight through. A proxy that
 * is unreachable or too old to know the endpoint answers an empty ledger with
 * `unavailable: true`, so the profile card can say "no ledger" rather than
 * "nothing was spent" — those are very different claims.
 */
export async function GET(request: Request) {
  try {
    await requireUserId();
    const { baseURL } = resolveChatmockBaseUrl(request);
    const incoming = new URL(request.url).searchParams;
    const query = new URLSearchParams();
    for (const key of ["since", "limit", "account", "source"]) {
      const value = incoming.get(key);
      if (value) query.set(key, value);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    const response = await fetch(`${baseURL}/usage/ledger${suffix}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return NextResponse.json(EMPTY);
    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return NextResponse.json(EMPTY);
  }
}
