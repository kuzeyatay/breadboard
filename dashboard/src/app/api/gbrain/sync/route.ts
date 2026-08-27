import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody, ApiError } from "@/lib/hermes/route-helpers.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { syncGarden, drainSyncJobs } from "@/lib/gbrain/sync.ts";
import { loadClusterBySlug } from "@/lib/gbrain/mapping.ts";
import { ensureSyncWorkerStarted } from "@/lib/gbrain/sync-worker.ts";

export const dynamic = "force-dynamic";

// Authenticated, owner-only GBrain synchronization trigger. This registers/indexes
// a garden's canonical markdown into the derived GBrain store. It NEVER rewrites
// canonical markdown. Initial and incremental sync both flow through here (or the
// job queue drained here).
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    // One bounded Runtime submission kick replaces the legacy in-process timer.
    ensureSyncWorkerStarted();
    const body = await readJsonBody(request);

    if (body.action === "drain") {
      const results = await drainSyncJobs(Number(body.max) || 10, request.signal);
      return NextResponse.json({ ok: true, drained: results.length, results });
    }

    const gardenSlug = typeof body.gardenId === "string" ? body.gardenId : "";
    if (!gardenSlug) throw new ApiError(400, "missing_garden", "A gardenId (slug) is required.");
    const access = authorizeGardenAccess(userId, gardenSlug);
    if (!access.isOwner) {
      throw new ApiError(403, "not_owner", "Only the garden owner can trigger GBrain synchronization.");
    }
    const cluster = loadClusterBySlug(gardenSlug);
    if (!cluster) throw new ApiError(404, "garden_not_found", "Garden not found.");

    const result = await syncGarden(cluster.id, request.signal);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
