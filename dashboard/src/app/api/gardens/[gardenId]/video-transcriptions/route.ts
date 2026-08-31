import { NextResponse } from "next/server";
import { videoTranscriptionRouteDeps } from "@/lib/scriberr/instance";
import {
  handleCreateVideoTranscription,
  handleListVideoTranscriptions,
} from "@/lib/scriberr/route-core";
import { routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// POST /api/gardens/:gardenId/video-transcriptions
// Accepts either multipart/form-data with a `media` file (or legacy `video`)
// or JSON with a
// `youtubeUrl`. Returns 202 with the queued job; the transcription itself runs
// asynchronously in the background job runner.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const result = await handleCreateVideoTranscription(
      videoTranscriptionRouteDeps(),
      gardenId,
      request,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

// GET /api/gardens/:gardenId/video-transcriptions[?active=1]
export async function GET(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const activeOnly = new URL(request.url).searchParams.get("active") === "1";
    const result = await handleListVideoTranscriptions(
      videoTranscriptionRouteDeps(),
      gardenId,
      { activeOnly },
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
