import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { finishedAutomationTabOwners } from "@/lib/browser/automation-tabs.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read-only lifecycle reconciliation for tabs owned by the native desktop. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const { owners } = await readJsonBody(request, 64 * 1024);
    if (!Array.isArray(owners) || owners.length > 64 || !owners.every(owner => typeof owner === "string" && owner.length <= 1024)) {
      throw new RouteError(400, "Invalid automation tab owners");
    }
    return NextResponse.json({ finishedOwners: await finishedAutomationTabOwners(userId, [...new Set(owners)]) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof RouteError ? error.message : "Automation tab status unavailable" },
      { status: error instanceof RouteError ? error.status : 503 });
  }
}
