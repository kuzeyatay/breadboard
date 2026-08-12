import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  MEETING_FILENAME_HEADER,
  MeetingUploadError,
  sweepMeetingUploads,
  writeMeetingUpload,
} from "@/lib/meeting-notes/uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Stage one recording and hand back the id a run will name it by.
 *
 * The body is the raw file rather than a form, and the filename rides in a
 * header, so a two-hour recording streams to disk a buffer at a time instead of
 * being parsed into memory. This is the same shape the dictation upload uses.
 *
 * Both input paths land here: a file the person drops in, and a live capture the
 * browser stops and sends as one blob.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const filename = (request.headers.get(MEETING_FILENAME_HEADER) ?? "recording.webm").slice(0, 260);

    // Recordings are the largest thing Breadboard puts on disk and are worthless
    // once transcribed, so every new one pays for a sweep of the stale ones.
    try {
      sweepMeetingUploads({ userId });
    } catch {
      // A sweep that fails must never stop an upload.
    }

    const stored = await writeMeetingUpload({ userId, body: request.body, filename });
    return NextResponse.json(
      {
        ok: true,
        uploadId: stored.uploadId,
        filename: stored.filename,
        byteSize: stored.byteSize,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof MeetingUploadError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status },
      );
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
