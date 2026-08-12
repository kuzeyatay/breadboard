import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

async function chatmock(request: Request, path: string, init?: RequestInit) {
  const { baseURL } = resolveChatmockBaseUrl(request);
  return fetch(`${baseURL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

export async function GET(request: Request) {
  try {
    await requireUserId();
    const response = await chatmock(request, "/accounts");
    if (!response.ok) return NextResponse.json({ accounts: [] });
    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RouteError) return routeErrorResponse(error);
    return NextResponse.json({ accounts: [] });
  }
}

/**
 * Keep the signed-in account before another sign-in replaces it — the step that
 * turns ChatMock's "switch account" flow into "add account".
 */
export async function POST(request: Request) {
  try {
    await requireUserId();
    const response = await chatmock(request, "/accounts/preserve", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new RouteError(response.status, "The current account could not be kept.");
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireUserId();
    const key = new URL(request.url).searchParams.get("key");
    if (!key?.trim()) throw new RouteError(400, "An account key is required.");

    const response = await chatmock(request, `/accounts/${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new RouteError(response.status, "That account could not be removed.");
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
