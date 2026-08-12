import { NextResponse } from "next/server";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  ArtifactStoreError,
  activateArtifactVersion,
  presentArtifact,
} from "@/lib/hermes/artifact-store.ts";
import { requireVideoArtifact } from "@/lib/video-use/artifact.ts";
import { studioStateFor } from "@/lib/video-use/studio.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Go back to an earlier version of this video.
 *
 * Nothing is deleted: the version being left is still there, and its own row is
 * still the newest, so a revert is reversible by reverting again. Restoring a
 * version restores its stored edit program with it, which is what makes the
 * next prompt continue from that state rather than from the abandoned one.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { artifactId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const conversationPublicId =
      typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationPublicId) {
      return NextResponse.json({ ok: false, error: "conversation_required" }, { status: 400 });
    }
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json({ ok: false, error: "invalid_version" }, { status: 400 });
    }

    const artifact = requireVideoArtifact({ userId, conversationPublicId, artifactId });
    if (version === artifact.current_version) {
      return NextResponse.json({
        ok: true,
        artifact: presentArtifact(artifact),
        state: await studioStateFor({ userId, artifact }),
      });
    }

    const restored = activateArtifactVersion({
      artifact,
      version,
      runId: artifact.originating_run_id,
      assistantMessageId: artifact.originating_message_id,
    });
    return NextResponse.json({
      ok: true,
      artifact: presentArtifact(restored),
      state: await studioStateFor({ userId, artifact: restored }),
    });
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
