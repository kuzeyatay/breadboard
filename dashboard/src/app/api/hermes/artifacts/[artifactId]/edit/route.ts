import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import {
  ArtifactStoreError,
  getArtifactForUser,
  presentArtifact,
} from "@/lib/hermes/artifact-store.ts";
import {
  loadArtifactEditor,
  saveArtifactEditor,
  type ArtifactEditorPatch,
} from "@/lib/hermes/artifact-document-editor.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";

export const dynamic = "force-dynamic";

function conversationIdFrom(request: Request): string {
  const conversationId = new URL(request.url).searchParams.get("conversationId")?.trim();
  if (!conversationId) {
    throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
  }
  return conversationId;
}

async function editableArtifact(request: Request, artifactId: string) {
  const userId = await requireUserId();
  requireEnabled();
  const artifact = getArtifactForUser({
    artifactId,
    userId,
    conversationPublicId: conversationIdFrom(request),
  });
  if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
  return artifact;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await params;
    return NextResponse.json(await loadArtifactEditor(
      await editableArtifact(request, artifactId),
      { signal: request.signal },
    ));
  } catch (error) {
    if (error instanceof ArtifactStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await params;
    const artifact = await editableArtifact(request, artifactId);
    const body = await readJsonBody(request, 6 * 1024 * 1024);
    const expectedVersion = Number(body.expectedVersion);
    const patches = Array.isArray(body.patches)
      ? body.patches as ArtifactEditorPatch[]
      : undefined;
    const saved = await saveArtifactEditor({
      artifact,
      expectedVersion,
      content: typeof body.content === "string" ? body.content : undefined,
      patches,
    }, { signal: request.signal });
    return NextResponse.json({ artifact: presentArtifact(saved) });
  } catch (error) {
    if (error instanceof ArtifactStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return apiErrorResponse(error);
  }
}
