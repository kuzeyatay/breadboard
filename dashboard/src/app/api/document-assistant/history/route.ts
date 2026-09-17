import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ArtifactStoreError } from "@/lib/hermes/artifact-store.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { ApiError, apiErrorResponse, readJsonBody, requireString } from "@/lib/hermes/route-helpers.ts";
import { documentAssistantArtifact, syncDocumentAssistantHistory } from "@/lib/document-assistant-history.ts";

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request, 4 * 1024 * 1024);
    const artifactId = requireString(body.artifactId, "artifactId", 160);
    if (body.kind !== "word" && body.kind !== "markdown") throw new ApiError(400, "invalid_assistant_kind", "A document assistant is required.");
    if (!Array.isArray(body.entries)) throw new ApiError(400, "invalid_assistant_history", "A chat transcript is required.");
    const artifact = documentAssistantArtifact(userId, artifactId);
    if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
    return NextResponse.json(syncDocumentAssistantHistory({ userId, artifactId, kind: body.kind, entries: body.entries }));
  } catch (error) {
    if (error instanceof ArtifactStoreError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return apiErrorResponse(error);
  }
}
