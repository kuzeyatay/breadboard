import { NextResponse } from "next/server";

import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
  RouteError,
} from "@/lib/server-auth";
import { isRuntimeDocumentIngestionJob } from "@/lib/runtime-v2/ingest-job";
import { runtimeIngestIdempotencyKey } from "@/lib/runtime-v2/ingest-request";
import {
  cancelRuntimeJobByIdempotencyKey,
  lookupRuntimeJobByIdempotencyKey,
  RuntimeJobControlError,
} from "@/lib/supervisor-control";

export const dynamic = "force-dynamic";

function requestId(request: Request): string {
  const value = request.headers.get("x-breadboard-ingest-request-id");
  if (value === null) throw new RouteError(400, "requestId is required");
  try {
    return runtimeIngestIdempotencyKey(value);
  } catch {
    throw new RouteError(400, "The ingestion request identity is invalid");
  }
}

export async function POST(request: Request) {
  try {
    const clusterSlug = request.headers.get("x-breadboard-ingest-cluster-slug");
    if (!clusterSlug?.trim()) {
      throw new RouteError(400, "clusterSlug is required");
    }
    const { userId, cluster } = await requireOwnedClusterFromSlug(clusterSlug);
    const authority = { userId, gardenId: cluster.slug, conversationId: null };
    const idempotencyKey = requestId(request);

    // Existing jobs still pass the same capability fence as cancellation by
    // job ID. When no job exists yet, the ingestion-only key namespace lets
    // Rust durably record the exact owner/scope/key tombstone before upload
    // submission can win the race.
    try {
      const existing = await lookupRuntimeJobByIdempotencyKey(
        authority,
        idempotencyKey,
      );
      if (!isRuntimeDocumentIngestionJob(existing)) {
        throw new RouteError(404, "Ingestion job not found");
      }
    } catch (error) {
      if (
        !(error instanceof RuntimeJobControlError) ||
        error.code !== "JOB_NOT_FOUND"
      ) {
        throw error;
      }
    }

    const disposition = await cancelRuntimeJobByIdempotencyKey(
      authority,
      idempotencyKey,
    );
    return NextResponse.json(disposition);
  } catch (error) {
    return routeErrorResponse(error);
  }
}
