import { NextResponse } from "next/server";
import {
  discardIngestRecovery,
  listIngestRecoveries,
  markIngestRecoveryResumed,
  publicIngestRecovery,
  type IngestRecoveryRecord,
} from "@/lib/runtime-v2/ingest-recovery-store";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";
import {
  inspectRuntimeJobForStatus,
  type RuntimeJobAuthority,
} from "@/lib/supervisor-control";

export const dynamic = "force-dynamic";

const RESUMED_TERMINAL_STATES = new Set([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

/**
 * A record that was resumed is settled by the job it named: success means the
 * document is in the garden and the copy is no longer needed; any other
 * terminal state hands the record back so Resume is offered again. (A fresh
 * failure normally replaces the record outright, since the worker keys
 * retention by document digest; this covers the case where retention itself
 * could not run.) A job Runtime no longer knows counts as settled-failed.
 */
async function reconcileResumed(
  authority: RuntimeJobAuthority,
  record: IngestRecoveryRecord,
): Promise<IngestRecoveryRecord | null> {
  if (!record.resumedJobId) return record;
  let state: string;
  try {
    state = (await inspectRuntimeJobForStatus(authority, record.resumedJobId)).state;
  } catch (error) {
    const status = (error as { status?: unknown }).status;
    if (status !== 404) return record;
    state = "failed";
  }
  if (state === "succeeded") {
    discardIngestRecovery({ gardenId: record.gardenId, recoveryId: record.recoveryId });
    return null;
  }
  if (RESUMED_TERMINAL_STATES.has(state)) {
    return markIngestRecoveryResumed({
      gardenId: record.gardenId,
      recoveryId: record.recoveryId,
      jobId: null,
    });
  }
  return record;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
    const authority: RuntimeJobAuthority = {
      userId,
      gardenId: cluster.slug,
      conversationId: null,
    };
    const recoveries: ReturnType<typeof publicIngestRecovery>[] = [];
    for (const record of listIngestRecoveries({ gardenId: cluster.slug })) {
      if (record.userId !== null && record.userId !== userId) continue;
      const reconciled = await reconcileResumed(authority, record);
      if (reconciled) recoveries.push(publicIngestRecovery(reconciled));
    }
    return NextResponse.json({ recoveries });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
