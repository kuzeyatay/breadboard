import { NextRequest, NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  ensureN8nSession,
  forwardN8nCookie,
  n8nJson,
} from "@/lib/workflows/n8n";
import { summarizeLocalWorkflow } from "@/lib/workflows/execution";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireUserId();
    const session = await ensureN8nSession(request.cookies.get("n8n-auth")?.value);
    const query = new URLSearchParams({
      skip: "0",
      take: "100",
      sortBy: "updatedAt:desc",
      includeScopes: "true",
    });
    const payload = await n8nJson(`/rest/workflows?${query}`, {
      method: "GET",
      session,
    });
    const source = Array.isArray(payload) ? payload : [];
    const workflows = source
      .filter((item) => !(typeof item === "object" && item !== null && "isArchived" in item && item.isArchived === true))
      .map(summarizeLocalWorkflow)
      .filter((item) => item !== null);
    const response = NextResponse.json(
      { workflows },
      { headers: { "Cache-Control": "no-store" } },
    );
    forwardN8nCookie(response, session);
    return response;
  } catch (error) {
    return routeErrorResponse(error);
  }
}
