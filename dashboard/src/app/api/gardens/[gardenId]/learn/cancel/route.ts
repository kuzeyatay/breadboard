import { NextResponse } from "next/server";
import { cancelRuntimeV2LearnOperation } from "@/lib/learn-operation-runtime-v2";
import {
  InvalidLearnRouteBodyError,
  readLearnRouteJsonObject,
} from "@/lib/learn-route-errors";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    const body = await readLearnRouteJsonObject(request);
    const expectedJobId =
      typeof body.expectedJobId === "string" && body.expectedJobId.trim()
        ? body.expectedJobId.trim()
        : undefined;
    const runtimeCancellation = await cancelRuntimeV2LearnOperation({
      userId,
      gardenId: cluster.slug,
      contentPath,
      expectedJobId,
    });
    if (runtimeCancellation.handled) {
      return NextResponse.json({
        success: true,
        job: null,
        runtimeJobId: runtimeCancellation.runtimeJob?.jobId ?? null,
      });
    }
    const { cancelLatestLearnJob } = await import("@/lib/learn");
    const job = await cancelLatestLearnJob({
      gardenId: cluster.slug,
      contentPath,
      expectedJobId,
      userId,
    });
    const ownerCancellation = await cancelRuntimeV2LearnOperation({
      userId,
      gardenId: cluster.slug,
      contentPath,
    });
    return NextResponse.json({
      success: true,
      job,
      ...(ownerCancellation.handled
        ? { runtimeJobId: ownerCancellation.runtimeJob?.jobId ?? null }
        : {}),
    });
  } catch (error) {
    if (error instanceof InvalidLearnRouteBodyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof Error && error.name === "LearnCancelConflictError") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
