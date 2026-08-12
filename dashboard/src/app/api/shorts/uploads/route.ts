import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  isSupportedVideoName,
  MAX_UPLOAD_BYTES,
  storeUpload,
  UploadError,
} from "@/lib/shorts/uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UploadFile = {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

/**
 * Take one video chosen in the composer and return the id a run addresses it
 * by. The browser never learns where the file went: the run resolves the id
 * inside the uploading user's own store, so a path can never come from a page.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const form = await request.formData();
    const file = form.get("file") as UploadFile | null;
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
    }
    if (!isSupportedVideoName(file.name)) {
      return NextResponse.json(
        { ok: false, error: "That is not a video format this agent can read." },
        { status: 415 },
      );
    }
    // Checked before the bytes are read so an oversized upload is refused
    // without buffering gigabytes of it first.
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ ok: false, error: "That video is larger than 2 GB." }, { status: 413 });
    }
    const stored = storeUpload({
      userId,
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ ok: true, upload: stored }, { status: 201 });
  } catch (error) {
    if (error instanceof UploadError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "internal_error" },
      { status: 500 },
    );
  }
}
