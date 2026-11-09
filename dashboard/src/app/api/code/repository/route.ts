import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth.ts";
import { resolveConnectedRepository } from "@/lib/opencode/repository.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const gardenSlug = new URL(request.url).searchParams.get("garden");
    if (!gardenSlug?.trim() || gardenSlug.length > 240) {
      return NextResponse.json({ error: "Choose a Garden with a connected repository." }, { status: 400 });
    }
    const repository = resolveConnectedRepository(userId, gardenSlug);
    return NextResponse.json({ repository }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RouteError) return NextResponse.json({ error: error.message }, { status: error.status });
    const code = error instanceof Error ? error.message : "";
    const message = code === "garden_not_found" ? "This Garden could not be found."
      : code === "repository_not_connected" ? "Connect a repository to this Garden, then try again."
      : "The connected repository is unavailable. Reconnect it from the Garden card, then try again.";
    return NextResponse.json({ error: message }, { status: code === "garden_not_found" ? 404 : 409 });
  }
}
