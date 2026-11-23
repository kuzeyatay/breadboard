import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError } from "@/lib/hermes/route-helpers.ts";
import { ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { storeExport } from "@/lib/timeline-studio/tools.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A video the editor just exported (downloaded), kept so it can join a chat. Raw body, ?filename=. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const filename = new URL(request.url).searchParams.get("filename") ?? "";
    if (!request.body) throw new ApiError(400, "video_studio_export_empty", "The export was empty.");
    const entry = await storeExport(userId, filename, request.body);
    return NextResponse.json({ exportId: entry.id }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not keep the export." }, { status: 500 });
  }
}
