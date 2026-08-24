import { NextResponse } from "next/server";
import { LearnCancelConflictError, cancelLatestLearnJob } from "@/lib/learn";
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
    const { cluster } = await requireOwnedClusterFromSlug(gardenId);
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
    const job = await cancelLatestLearnJob({
      gardenId: cluster.slug,
      contentPath,
      expectedJobId,
    });
    return NextResponse.json({ success: true, job });
  } catch (error) {
    if (error instanceof InvalidLearnRouteBodyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof LearnCancelConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
