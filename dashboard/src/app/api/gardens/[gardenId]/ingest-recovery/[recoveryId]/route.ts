import { NextResponse } from "next/server";
import {
  discardIngestRecovery,
  isIngestRecoveryId,
  readIngestRecovery,
} from "@/lib/runtime-v2/ingest-recovery-store";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
  RouteError,
} from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string; recoveryId: string }> },
) {
  try {
    const { gardenId, recoveryId } = await params;
    const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
    if (!isIngestRecoveryId(recoveryId)) {
      throw new RouteError(400, "The recovery id is invalid");
    }
    const stored = readIngestRecovery({ gardenId: cluster.slug, recoveryId });
    if (stored && stored.record.userId !== null && stored.record.userId !== userId) {
      throw new RouteError(404, "Recovery record not found");
    }
    // A record that no longer validates is removed too: discarding is the one
    // action that should always leave nothing behind.
    discardIngestRecovery({ gardenId: cluster.slug, recoveryId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
