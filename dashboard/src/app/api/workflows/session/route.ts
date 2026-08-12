import { NextRequest, NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { ensureN8nSession, forwardN8nCookie, n8nBaseUrl } from "@/lib/workflows/n8n";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    await requireUserId();
    const session = await ensureN8nSession(request.cookies.get("n8n-auth")?.value);
    const response = NextResponse.json(
      { ready: true, baseUrl: n8nBaseUrl() },
      { headers: { "Cache-Control": "no-store" } },
    );
    forwardN8nCookie(response, session);
    return response;
  } catch (error) {
    return routeErrorResponse(error);
  }
}
