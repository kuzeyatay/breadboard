import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import { ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { requireVideoArtifact } from "@/lib/video-use/artifact.ts";
import { studioStateFor } from "@/lib/video-use/studio.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Everything the studio shows about one video: its versions, the edit program
 * behind the current one, and whether a further edit could run right now.
 *
 * Scoped by conversation like every other artifact read, so an id on its own
 * never opens someone else's video.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { artifactId } = await params;
    const conversationPublicId =
      new URL(request.url).searchParams.get("conversationId")?.trim() ?? "";
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }

    const artifact = requireVideoArtifact({ userId, conversationPublicId, artifactId });
    return NextResponse.json({ ok: true, state: await studioStateFor({ userId, artifact }) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) {
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
