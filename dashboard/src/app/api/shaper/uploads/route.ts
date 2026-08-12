import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { MAX_FORMSMITH_IMAGE_BYTES } from "@/lib/shaper/identity.ts";
import {
  FormsmithUploadError,
  isSupportedImageName,
  storeFormsmithUpload,
} from "@/lib/shaper/uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type UploadFile = {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const form = await request.formData();
    const file = form.get("file") as UploadFile | null;
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ ok: false, error: "Choose a picture first." }, { status: 400 });
    }
    if (!isSupportedImageName(file.name)) {
      return NextResponse.json(
        { ok: false, error: "Formsmith accepts only JPEG, PNG, or WebP pictures." },
        { status: 415 },
      );
    }
    if (file.size > MAX_FORMSMITH_IMAGE_BYTES) {
      return NextResponse.json({ ok: false, error: "Pictures must be 20 MB or smaller." }, { status: 413 });
    }
    const upload = storeFormsmithUpload({
      userId,
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ ok: true, upload }, { status: 201 });
  } catch (error) {
    if (error instanceof FormsmithUploadError || error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "The picture could not be uploaded." }, { status: 500 });
  }
}
