import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { synthesizeSpeech } from "@/lib/speech/synthesis";

/**
 * POST: read a response aloud, streaming the audio as Voicebox produces it.
 *
 * The body is handed straight back so playback can start on the first chunk;
 * the download route next door asks for the same audio and waits for all of it.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as { text?: unknown };
    const response = await synthesizeSpeech({
      userId,
      text: body.text,
      signal: request.signal,
    });
    return new Response(response.body, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
