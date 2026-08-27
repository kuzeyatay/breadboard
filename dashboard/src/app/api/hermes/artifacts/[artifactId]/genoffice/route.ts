import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, requireEnabled, ApiError } from "@/lib/hermes/route-helpers.ts";
import {
  artifactDeliveryFile,
  ArtifactStoreError,
  getArtifactForUser,
  presentArtifact,
} from "@/lib/hermes/artifact-store.ts";
import { saveArtifactOfficeBytes } from "@/lib/hermes/artifact-office-save.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";

export const dynamic = "force-dynamic";

const MAX_DOCX_BYTES = 128 * 1024 * 1024;

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

function artifactError(error: unknown) {
  if (error instanceof ArtifactStoreError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return apiErrorResponse(error);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await params;
    const artifact = await editableArtifact(request, artifactId);
    if (artifact.renderer_id !== "document-file" || !artifact.filename.toLowerCase().endsWith(".docx")) {
      throw new ArtifactStoreError(
        422,
        "artifact_editor_docx_unsupported",
        "This artifact is not an editable Word document.",
      );
    }
    const delivery = artifactDeliveryFile(artifact, artifact.current_version);
    return new NextResponse(fs.readFileSync(delivery.absolutePath), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(delivery.filename)}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "X-Breadboard-Artifact-Filename": encodeURIComponent(delivery.filename),
        "X-Breadboard-Artifact-Version": String(artifact.current_version),
      },
    });
  } catch (error) {
    return artifactError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    const { artifactId } = await params;
    const length = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_DOCX_BYTES) {
      throw new ArtifactStoreError(413, "artifact_editor_docx_size", "The edited Word document is too large.");
    }
    const artifact = await editableArtifact(request, artifactId);
    const expectedVersion = Number(new URL(request.url).searchParams.get("expectedVersion"));
    const bytes = new Uint8Array(await request.arrayBuffer());
    const saved = await saveArtifactOfficeBytes(
      artifact,
      expectedVersion,
      bytes,
      { signal: request.signal },
    );
    return NextResponse.json({ artifact: presentArtifact(saved) });
  } catch (error) {
    return artifactError(error);
  }
}
