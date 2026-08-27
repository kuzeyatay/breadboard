import { NextResponse } from "next/server";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
  RouteError,
} from "@/lib/server-auth";
import { runtimeIngestCancellationDisposition } from "@/lib/runtime-v2/ingest-cancellation";
import { isRuntimeDocumentIngestionJob } from "@/lib/runtime-v2/ingest-job";
import { cancelRuntimeJob, inspectRuntimeJob } from "@/lib/supervisor-control";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const clusterSlug = request.headers.get("x-breadboard-ingest-cluster-slug");
    if (!clusterSlug?.trim()) {
      throw new RouteError(400, "clusterSlug is required");
    }
    const [{ jobId }, { userId, cluster }] = await Promise.all([
      params,
      requireOwnedClusterFromSlug(clusterSlug),
    ]);
    const authority = { userId, gardenId: cluster.slug, conversationId: null };
    const inspected = await inspectRuntimeJob(authority, jobId);
    if (!isRuntimeDocumentIngestionJob(inspected)) {
      throw new RouteError(404, "Ingestion job not found");
    }
    const job = await cancelRuntimeJob(authority, jobId);
    return NextResponse.json(runtimeIngestCancellationDisposition(job));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
