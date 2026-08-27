import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  SPEECH_DOWNLOAD_MIME,
  speechAsMp3,
  speechDownloadFilename,
  synthesizeSpeech,
} from "@/lib/speech/synthesis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST: the spoken reading of one response, as a file to keep.
 *
 * The same synthesis the speaker button plays, held whole instead of streamed
 * so ffmpeg can encode it. Buffering is the point rather than an oversight:
 * nothing can be downloaded until the last word has been spoken.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const spoken = await synthesizeSpeech({
      userId,
      text: body?.text,
      signal: request.signal,
    });
    const mp3 = await speechAsMp3(
      { userId, gardenId: null, conversationId: null },
      new Uint8Array(await spoken.arrayBuffer()),
      request.signal,
    );
    // `speechAsMp3` may return a view backed by SharedArrayBuffer. Fetch's
    // BodyInit deliberately accepts only ArrayBuffer-backed views, so copy it
    // into an owned ArrayBuffer before constructing the response.
    const responseBody = new Uint8Array(mp3.byteLength);
    responseBody.set(mp3);

    return new Response(responseBody.buffer, {
      status: 200,
      headers: {
        "Content-Type": SPEECH_DOWNLOAD_MIME,
        "Content-Length": String(mp3.byteLength),
        "Content-Disposition": `attachment; filename="${speechDownloadFilename()}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
