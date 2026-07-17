import { NextResponse } from "next/server";
import {
  clearAllLearnData,
  LearnClearConflictError,
} from "@/lib/learn";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
} from "@/lib/server-auth";

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

    const body = await request.json().catch(() => ({})) as unknown;
    if (
      !body ||
      typeof body !== "object" ||
      !("confirmClearLearnData" in body) ||
      body.confirmClearLearnData !== true
    ) {
      return NextResponse.json(
        { error: "Clearing Learn data requires explicit confirmation." },
        { status: 400 },
      );
    }

    const result = await clearAllLearnData({
      gardenId: cluster.slug,
      contentPath,
      confirmClearLearnData: true,
    });
    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof LearnClearConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return routeErrorResponse(error);
  }
}
