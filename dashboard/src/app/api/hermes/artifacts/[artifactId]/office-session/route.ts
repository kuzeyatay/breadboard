import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody, requireEnabled } from "@/lib/hermes/route-helpers.ts";
import {
  artifactDeliveryFile,
  ArtifactStoreError,
  getArtifactForUser,
  presentArtifact,
} from "@/lib/hermes/artifact-store.ts";
import { saveArtifactPresentationBytes } from "@/lib/hermes/artifact-office-save.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { openOfficeSession, type OfficeTarget } from "@/lib/office/editor-sessions.ts";
import type { PresentedArtifact } from "@/lib/hermes/artifact-types";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { selectedModelForUser } from "@/lib/selected-model";

export const dynamic = "force-dynamic";

/**
 * Open a chat's .pptx artifact in GenOffice Slides, the same editor Spaces
 * uses for presentations. Every save the editor makes becomes the artifact's
 * next version; the session is then driven through /api/office/sessions/<id>.
 */
export async function POST(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const { artifactId } = await params;
    const body = await readJsonBody(request, 4096);
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (!conversationId) throw new ApiError(400, "artifact_conversation_required", "conversationId is required.");
    const lookup = () => getArtifactForUser({ artifactId, userId, conversationPublicId: conversationId });
    const opened = lookup();
    if (opened.garden_slug) authorizeGardenAccess(userId, opened.garden_slug);
    if (!opened.filename.toLowerCase().endsWith(".pptx") || opened.status === "archived") {
      throw new ArtifactStoreError(422, "artifact_editor_pptx_unsupported", "This artifact is not an editable PowerPoint presentation.");
    }
    const delivery = artifactDeliveryFile(opened, opened.current_version);
    // The version the editor's copy is based on; a save on top of a newer
    // version (an AI edit meanwhile) is a conflict, not a silent overwrite.
    let baseVersion = opened.current_version;
    let current: PresentedArtifact = presentArtifact(opened);
    const target: OfficeTarget<PresentedArtifact> = {
      name: opened.filename,
      read: () => fs.readFileSync(delivery.absolutePath),
      current: () => current,
      async save(bytes) {
        const saved = await saveArtifactPresentationBytes(lookup(), baseVersion, new Uint8Array(bytes));
        baseVersion = saved.current_version;
        current = presentArtifact(saved);
        return current;
      },
    };
    const theme = body.theme === "dark" ? "dark" : "light";
    const session = await openOfficeSession({
      userId,
      target,
      theme,
      ai: { baseUrl: resolveChatmockBaseUrl(request).baseURL, model: selectedModelForUser(userId) },
    });
    return NextResponse.json({
      session: session.id,
      app: session.app,
      url: `/genoffice/${session.app}/index.html?session=${encodeURIComponent(session.id)}`,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ArtifactStoreError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof Error && /Office editors are not installed|took too long|editor stopped/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    return apiErrorResponse(error);
  }
}
