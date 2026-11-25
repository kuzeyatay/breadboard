import { requireUserId, routeErrorResponse, RouteError } from "@/lib/server-auth";
import { requireVoiceOrigin } from "@/lib/speech/subscription-server";
import {
  claimNarrationJob,
  completeNarrationJob,
  NARRATION_RELAY_MAX_AUDIO_BYTES,
} from "@/lib/speech/narration-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };
const JOB_ID = /^[0-9a-f-]{36}$/;

/**
 * The voice window's side of agent narration in the ChatGPT voice.
 *
 * `GET ?wait=25` long-polls for the next script (`{ job: { id, text } | null }`).
 * `POST ?id=<job>` answers it: an `audio/wav` body, or JSON `{ error }`.
 * See `lib/speech/narration-relay.ts`.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const wait = Number(new URL(request.url).searchParams.get("wait") ?? "0");
    const job = await claimNarrationJob(userId, Number.isFinite(wait) ? wait : 0, request.signal);
    return Response.json({ job }, { headers: NO_STORE });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireVoiceOrigin(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!JOB_ID.test(id)) throw new RouteError(400, "A narration job id is required.");
    let result: { audio: Uint8Array } | { error: string };
    if (request.headers.get("content-type")?.split(";")[0] === "audio/wav") {
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > NARRATION_RELAY_MAX_AUDIO_BYTES) throw new RouteError(413, "The narration audio is too large.");
      const audio = new Uint8Array(await request.arrayBuffer());
      if (audio.byteLength > NARRATION_RELAY_MAX_AUDIO_BYTES) throw new RouteError(413, "The narration audio is too large.");
      if (!audio.byteLength) throw new RouteError(400, "No audio was supplied.");
      result = { audio };
    } else {
      const body = (await request.json().catch(() => null)) as { error?: unknown } | null;
      const message = typeof body?.error === "string" ? body.error.trim().slice(0, 500) : "";
      result = { error: message || "The ChatGPT voice could not read the narration." };
    }
    return Response.json({ accepted: completeNarrationJob(userId, id, result) }, { headers: NO_STORE });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
