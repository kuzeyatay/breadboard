import { NextResponse } from "next/server";
import { cancelLatestLearnJob } from "@/lib/learn";
import { requireOwnedClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
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

    const job = await cancelLatestLearnJob({ gardenId: cluster.slug, contentPath });
    return NextResponse.json({ success: true, job });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
