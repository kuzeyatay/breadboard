import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
  RouteError,
} from "@/lib/server-auth";
import { createRuntimeIngestSseResponse } from "@/lib/runtime-v2/ingest-compatibility";
import { isRuntimeDocumentIngestionJob } from "@/lib/runtime-v2/ingest-job";
import { inspectRuntimeJob } from "@/lib/supervisor-control";

export const dynamic = "force-dynamic";

function optionalModel(request: Request): string | null {
  const encoded = request.headers.get("x-breadboard-ingest-model");
  if (encoded === null) return null;
  let model: string;
  try {
    model = decodeURIComponent(encoded);
  } catch {
    throw new RouteError(400, "Invalid ingestion recovery metadata");
  }
  if (
    model.length === 0 ||
    new TextEncoder().encode(model).byteLength > 256 ||
    /[\u0000-\u001f\u007f]/u.test(model)
  ) {
    throw new RouteError(400, "Invalid ingestion recovery metadata");
  }
  return model;
}

function recoveryStartedAt(request: Request): number {
  const raw = request.headers.get("x-breadboard-ingest-started-at");
  if (raw === null) return Date.now();
  if (!/^\d+$/u.test(raw)) {
    throw new RouteError(400, "Invalid ingestion recovery metadata");
  }
  const startedAt = Number(raw);
  if (!Number.isSafeInteger(startedAt) || startedAt < 1 || startedAt > Date.now()) {
    throw new RouteError(400, "Invalid ingestion recovery metadata");
  }
  return startedAt;
}

export async function GET(
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
    const job = await inspectRuntimeJob(authority, jobId);
    if (!isRuntimeDocumentIngestionJob(job)) {
      throw new RouteError(404, "Ingestion job not found");
    }
    return createRuntimeIngestSseResponse({
      authority,
      job,
      model: optionalModel(request),
      startedAt: recoveryStartedAt(request),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
