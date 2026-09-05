import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { getSpeechSettings } from "@/lib/speech/settings";
import { requireVoiceOrigin } from "@/lib/speech/subscription-server";
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
    requireVoiceOrigin(request);
    const subscriptionAudio = request.headers.get("content-type") === "audio/wav";
    if (subscriptionAudio && (getSpeechSettings(userId).speechProvider !== "chatgpt" || !getSpeechSettings(userId).enabled)) throw new RouteError(409, "Enable subscription speech first.");
    let supplied: ArrayBuffer | undefined;
    if (subscriptionAudio) {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let length = 0;
      const reader = request.body?.getReader();
      if (!reader) throw new RouteError(400, "No audio was supplied.");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 25 * 1024 * 1024) { await reader.cancel(); throw new RouteError(413, "Audio download exceeds 25 MB."); }
        chunks.push(new Uint8Array(value));
      }
      supplied = await new Blob(chunks).arrayBuffer();
    }
    const body = subscriptionAudio ? null : (await request.json().catch(() => null)) as { text?: unknown } | null;
    const spoken = supplied ? new Response(supplied, { headers: { "Content-Type": "audio/wav" } }) : await synthesizeSpeech({
      userId,
      text: body?.text,
      signal: request.signal,
    });
    const audio = new Uint8Array(await spoken.arrayBuffer());
    if (!audio.byteLength) throw new RouteError(502, "The speech provider returned no audio to save.");
    const mp3 = spoken.headers.get("Content-Type")?.split(";")[0] === SPEECH_DOWNLOAD_MIME ? audio : await speechAsMp3(
      { userId, gardenId: null, conversationId: null },
      audio,
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
