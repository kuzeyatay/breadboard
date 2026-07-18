import { NextResponse } from "next/server";
import { videoTranscriptionRouteDeps } from "@/lib/scriberr/instance";
import { handleVideoTranscriptionHealth } from "@/lib/scriberr/route-core";
import { routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// GET /api/gardens/:gardenId/video-transcriptions/health
// Reports which transcription dependencies are available (Scriberr, yt-dlp,
// FFmpeg, ffprobe, writable directories) so the UI can show specific errors.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const result = await handleVideoTranscriptionHealth(
      videoTranscriptionRouteDeps(),
      gardenId,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
