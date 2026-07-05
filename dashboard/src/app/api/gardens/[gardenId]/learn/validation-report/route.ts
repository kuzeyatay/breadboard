import { NextResponse } from "next/server";
import { getLearnValidationReport } from "@/lib/learn";
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

    const report = getLearnValidationReport({
      gardenId: cluster.slug,
      contentPath,
      maxChars: Number.MAX_SAFE_INTEGER,
    });
    if (!report) {
      return NextResponse.json(
        { error: "Validation report not found" },
        { status: 404 },
      );
    }

    return new NextResponse(report.markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
