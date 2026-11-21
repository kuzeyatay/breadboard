import { NextResponse } from "next/server";
import { externalRuntimeFilesystem as fs } from "@/lib/external-runtime-filesystem";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, ApiError, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { artifactFile, getArtifactForUser, presentArtifact } from "@/lib/hermes/artifact-store.ts";
import { importArtifactImage } from "@/lib/hermes/artifact-image-service.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import { closeArtifactContext, openArtifactContext, type ArtifactContext } from "@/lib/socials-manager/artifacts.ts";
import { ensureDoory, exportDesignPng, focusDesign, importIntoDoory } from "@/lib/doory/server.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DESIGN_ID = /^[0-9a-f-]{36}$/i;

function imageArtifact(userId: number, body: Record<string, unknown>) {
  const artifactId = String(body.artifactId ?? ""), conversationPublicId = String(body.conversationId ?? "");
  if (!artifactId || !conversationPublicId) throw new ApiError(400, "doory_artifact_required", "Open an image artifact from a chat.");
  const artifact = getArtifactForUser({ artifactId, userId, conversationPublicId });
  if (artifact.garden_slug) authorizeGardenAccess(userId, artifact.garden_slug);
  if (artifact.kind !== "image" && artifact.kind !== "diagram") throw new ApiError(400, "doory_image_required", "Only images open in Design.");
  return { artifact, conversationPublicId };
}

function designId(value: unknown): string {
  const id = String(value ?? "");
  if (!DESIGN_ID.test(id)) throw new ApiError(400, "doory_design_required", "Open a design first.");
  return id;
}

/** Starts Doory if needed; the page frames it with this launch's sign-in ticket. */
export async function GET() {
  try {
    await requireUserId();
    const { port, ticket } = await ensureDoory();
    return NextResponse.json({ port, ticket });
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Design could not start." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);
    if (body.action === "focus") {
      focusDesign(userId, body.designId ? designId(body.designId) : null);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "import") {
      const { artifact } = imageArtifact(userId, body);
      const file = artifactFile({ artifact, version: artifact.current_version, purpose: "preview" });
      return NextResponse.json(await importIntoDoory(fs.readFileSync(file.path), artifact.title));
    }
    if (body.action === "save") {
      const id = designId(body.designId);
      const { artifact, conversationPublicId } = imageArtifact(userId, body);
      let context: ArtifactContext | null = null;
      try {
        context = openArtifactContext({ userId, conversationPublicId, brief: `Edited in Design: ${artifact.title}` });
        if (!context) throw new ApiError(409, "doory_chat_unavailable", "The chat this image came from is not ready. Reopen it and try again.");
        const saved = await importArtifactImage({
          context, buffer: await exportDesignPng(id), title: `Edited — ${artifact.title}`.slice(0, 240),
          filename: "design.png", parentArtifactId: artifact.id, sourceTool: "artifact_image_edit",
          metadata: { imageStudio: true, imageOperation: "design", sourceArtifactId: artifact.id, dooryDesignId: id },
        });
        closeArtifactContext(context, "completed");
        return NextResponse.json({ artifact: presentArtifact(saved) }, { status: 201 });
      } catch (error) {
        closeArtifactContext(context, "failed");
        throw error;
      }
    }
    throw new ApiError(400, "doory_action", "Unknown action.");
  } catch (error) {
    if (error instanceof ApiError) return apiErrorResponse(error);
    const status = (error as { status?: number }).status;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Design failed." }, { status: typeof status === "number" ? status : 502 });
  }
}
