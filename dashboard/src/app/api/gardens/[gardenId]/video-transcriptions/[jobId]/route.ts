import { NextResponse } from "next/server";
import { videoTranscriptionRouteDeps } from "@/lib/scriberr/instance";
import { handleGetVideoTranscription } from "@/lib/scriberr/route-core";
import { routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// GET /api/gardens/:gardenId/video-transcriptions/:jobId
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string; jobId: string }> },
) {
  try {
    const { gardenId, jobId } = await params;
    const result = await handleGetVideoTranscription(
      videoTranscriptionRouteDeps(),
      gardenId,
      jobId,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
