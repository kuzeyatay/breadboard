import { NextResponse } from "next/server";
import { LearnPauseConflictError, pauseLatestLearnJob } from "@/lib/learn";
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

    const body = await request.json().catch(() => ({}));
    const expectedJobId =
      typeof body.expectedJobId === "string" && body.expectedJobId.trim()
        ? body.expectedJobId.trim()
        : undefined;
    const job = pauseLatestLearnJob({
      gardenId: cluster.slug,
      contentPath,
      expectedJobId,
    });
    return NextResponse.json({ success: true, job });
  } catch (error) {
    if (error instanceof LearnPauseConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
