import { NextResponse } from "next/server";
import { videoTranscriptionRouteDeps } from "@/lib/scriberr/instance";
import { handleRetryVideoTranscription } from "@/lib/scriberr/route-core";
import { routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// POST /api/gardens/:gardenId/video-transcriptions/:jobId/retry
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string; jobId: string }> },
) {
  try {
    const { gardenId, jobId } = await params;
    const result = await handleRetryVideoTranscription(
      videoTranscriptionRouteDeps(),
      gardenId,
      jobId,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
