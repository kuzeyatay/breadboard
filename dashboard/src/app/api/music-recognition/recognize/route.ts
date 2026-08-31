import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth.ts";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import { MusicRecognitionError } from "@/lib/music-recognition/errors.ts";
import { persistDirectMusicRecognition } from "@/lib/music-recognition/direct-result.ts";
import { recognizeMusic } from "@/lib/music-recognition/index.ts";
import {
  consumeMusicRecognitionRateLimit,
  musicRecognitionDeviceKey,
} from "@/lib/music-recognition/rate-limit.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalRuntimeSessionId(form: FormData): number | null {
  const raw = form.get("sessionId");
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    throw new ApiError(400, "invalid_music_session", "The conversation id is not valid.");
  }
  const sessionId = Number(raw);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
    throw new ApiError(400, "invalid_music_session", "The conversation id is not valid.");
  }
  return sessionId;
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError(400, "invalid_music_request", "Invalid multipart request.");
    }
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      throw new ApiError(400, "music_sample_required", "An audio file is required.");
    }
    const runtimeSessionId = optionalRuntimeSessionId(form);

    consumeMusicRecognitionRateLimit(`user:${userId}`);
    consumeMusicRecognitionRateLimit(
      `device:${userId}:${musicRecognitionDeviceKey(request)}`,
      { limit: 6 },
    );

    const result = await recognizeMusic({
      audio,
      filename: audio.name || "music-sample.webm",
      signal: request.signal,
    });
    if (runtimeSessionId !== null) {
      persistDirectMusicRecognition({ userId, runtimeSessionId, result });
    }
    return NextResponse.json(
      { ...result, persisted: runtimeSessionId !== null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MusicRecognitionError) {
      const response = apiErrorResponse(
        new ApiError(error.status, error.code, error.message),
      );
      const retryAfter = (error as MusicRecognitionError & { retryAfter?: unknown }).retryAfter;
      if (typeof retryAfter === "number") {
        response.headers.set("Retry-After", String(retryAfter));
      }
      return response;
    }
    return apiErrorResponse(error);
  }
}
