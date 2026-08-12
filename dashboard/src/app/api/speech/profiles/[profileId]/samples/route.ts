import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import { RouteError } from "@/lib/server-auth";
import { voiceboxFetch, voiceboxResponseError } from "@/lib/speech/voicebox-client";

const MAX_SAMPLE_BYTES = 50 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ profileId: string }> },
) {
  try {
    await requireUserId();
    const { profileId } = await params;
    const incoming = await request.formData();
    const file = incoming.get("file");
    const referenceText = String(incoming.get("reference_text") || "").trim();
    if (!(file instanceof File) || file.size === 0) throw new RouteError(400, "Choose an audio sample.");
    if (file.size > MAX_SAMPLE_BYTES) throw new RouteError(413, "Voice samples may be at most 50 MB.");
    if (!referenceText || referenceText.length > 1000) {
      throw new RouteError(400, "Enter the exact sample transcript (up to 1,000 characters).");
    }
    const outgoing = new FormData();
    outgoing.set("file", file, file.name || "voice-sample.webm");
    outgoing.set("reference_text", referenceText);
    const response = await voiceboxFetch(
      `/profiles/${encodeURIComponent(profileId)}/samples`,
      { method: "POST", body: outgoing },
      120_000,
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const message = voiceboxResponseError(body, "Voicebox could not add that sample.");
      throw new RouteError(
        response.status,
        /Error validating audio:\s*$/i.test(message)
          ? "Voicebox could not decode that recording. Record it again, or upload a WAV, MP3, M4A, OGG, or FLAC file."
          : message,
      );
    }
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
