import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { executeApiAnything } from "@/lib/api-anything/service.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const query = new URL(request.url).searchParams.get("query");
    const data = await executeApiAnything({ userId, tool: query === null ? "status" : "find_sites",
      args: query === null ? {} : { query, limit: 30 }, signal: request.signal });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof RouteError ? error.message : "Website APIs are unavailable." },
      { status: error instanceof RouteError ? error.status : 503 });
  }
}
