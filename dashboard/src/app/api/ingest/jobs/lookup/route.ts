import { NextResponse } from "next/server";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
  RouteError,
} from "@/lib/server-auth";
import { isRuntimeDocumentIngestionJob } from "@/lib/runtime-v2/ingest-job";
import { runtimeIngestIdempotencyKey } from "@/lib/runtime-v2/ingest-request";
import { lookupRuntimeJobByIdempotencyKey } from "@/lib/supervisor-control";

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
    const job = await lookupRuntimeJobByIdempotencyKey(
      authority,
      requestId(request),
    );
    if (!isRuntimeDocumentIngestionJob(job)) {
      throw new RouteError(404, "Ingestion job not found");
    }
    return NextResponse.json({ jobId: job.jobId, state: job.state });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
