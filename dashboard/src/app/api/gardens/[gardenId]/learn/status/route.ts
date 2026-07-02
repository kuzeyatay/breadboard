import { NextResponse } from "next/server";
import { getLearnStatusSnapshot } from "@/lib/learn";
import { requireReadableClusterFromSlug, routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const { cluster } = await requireReadableClusterFromSlug(gardenId);
    const contentPath = process.env.QUARTZ_CONTENT_PATH;
    if (!contentPath) {
      return NextResponse.json(
        { error: "QUARTZ_CONTENT_PATH not configured" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      ...getLearnStatusSnapshot({ gardenId: cluster.slug, contentPath }),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
