import { NextResponse } from "next/server";
import {
  getLearnStatusSnapshot,
  LearnPauseConflictError,
  resumeLatestLearnJob,
} from "@/lib/learn";
import { learnResumeRejection } from "@/lib/learn-auto-resume";
import { runtimeLearnWorkerIsLive } from "@/lib/learn-operation-runtime-v2";
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
    // A row that still claims an active status resumes to itself, so confirm
    // the worker it names is actually alive before reporting success.
    const latestStatus = getLearnStatusSnapshot({
      gardenId: cluster.slug,
      contentPath,
    }).job?.status;
    if (latestStatus) {
      const rejection = learnResumeRejection({
        status: latestStatus,
        workerLive: await runtimeLearnWorkerIsLive(contentPath, cluster.slug),
      });
      if (rejection) return NextResponse.json({ error: rejection }, { status: 409 });
    }

    const job = resumeLatestLearnJob({
      gardenId: cluster.slug,
      contentPath,
      expectedJobId,
    });
    return NextResponse.json({ success: true, job });
  } catch (error) {
    if (error instanceof InvalidLearnRouteBodyError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof LearnPauseConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
