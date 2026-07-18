import { NextResponse } from "next/server";
import { videoTranscriptionRouteDeps } from "@/lib/scriberr/instance";
import { handleInspectYouTube } from "@/lib/scriberr/route-core";
import { routeErrorResponse } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

// POST /api/gardens/:gardenId/video-transcriptions/inspect-youtube
// Validates a YouTube URL server-side and returns preview metadata (title,
// channel, thumbnail, duration) when yt-dlp is available.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string }> },
) {
  try {
    const { gardenId } = await params;
    const result = await handleInspectYouTube(
      videoTranscriptionRouteDeps(),
      gardenId,
      request,
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
