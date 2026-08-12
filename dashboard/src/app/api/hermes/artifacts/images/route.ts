import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import {
  ApiError,
  apiErrorResponse,
  readJsonBody,
  requireEnabled,
} from "@/lib/hermes/route-helpers.ts";
import {
  ArtifactStoreError,
  artifactFile,
  getArtifactForUser,
  presentArtifact,
  type ArtifactRow,
} from "@/lib/hermes/artifact-store.ts";
import {
  ArtifactImageServiceError,
  generateArtifactImage,
  importArtifactImage,
} from "@/lib/hermes/artifact-image-service.ts";
import { authorizeGardenAccess } from "@/lib/hermes/session-service.ts";
import {
  closeArtifactContext,
  openArtifactContext,
  type ArtifactContext,
} from "@/lib/socials-manager/artifacts.ts";
import { ComfyUiError } from "@/lib/comfyui/client.ts";
import { renderComfyUiImage } from "@/lib/comfyui/service.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 4_000;

type UploadFile = {
  name: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `image_${field}_required`, `${field} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new ApiError(400, `image_${field}_too_long`, `${field} is too long.`);
  }
  return normalized;
}

function optionalString(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().slice(0, max);
}

function defaultTitle(prompt: string, prefix: string): string {
  const summary = prompt.replace(/\s+/g, " ").trim().slice(0, 72);
  return summary ? `${prefix} — ${summary}` : prefix;
}

function requireArtifactSource(input: {
  userId: number;
  conversationPublicId: string;
  artifactId: string;
}): ArtifactRow {
  const artifact = getArtifactForUser({
    artifactId: input.artifactId,
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
  });
  if (artifact.garden_slug) authorizeGardenAccess(input.userId, artifact.garden_slug);
  return artifact;
}

function requireImageSource(input: {
  userId: number;
  conversationPublicId: string;
  artifactId: string;
}): ArtifactRow {
  const artifact = requireArtifactSource(input);
  if (artifact.kind !== "image" && artifact.kind !== "diagram") {
    throw new ApiError(400, "artifact_image_source_required", "Select an image artifact to edit.");
  }
  return artifact;
}

function openContextOrThrow(input: {
  userId: number;
  conversationPublicId: string;
  brief: string;
}): ArtifactContext {
  const context = openArtifactContext(input);
  if (!context) {
    throw new ApiError(
      409,
      "artifact_image_session_unavailable",
      "The artifact workspace is not ready. Reopen the chat and try again.",
    );
  }
  return context;
}

function uploadFile(value: FormDataEntryValue | null): UploadFile {
  if (
    !value ||
    typeof value === "string" ||
    typeof value.name !== "string" ||
    typeof value.size !== "number" ||
    typeof value.arrayBuffer !== "function"
  ) {
    throw new ApiError(400, "artifact_image_file_required", "Choose an image to upload.");
  }
  if (value.size <= 0 || value.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, "artifact_image_file_too_large", "Images must be 25 MiB or smaller.");
  }
  return value;
}

function parsedAdjustments(value: FormDataEntryValue | null): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function handleUpload(request: Request, userId: number): Promise<NextResponse> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 256 * 1024) {
    throw new ApiError(413, "artifact_image_file_too_large", "Images must be 25 MiB or smaller.");
  }
  const form = await request.formData();
  const conversationPublicId = requiredString(form.get("conversationId"), "conversationId", 200);
  const file = uploadFile(form.get("file"));
  const sourceArtifactId = optionalString(form.get("sourceArtifactId"), 200);
  const parentArtifactId = optionalString(form.get("parentArtifactId"), 200);
  const source = sourceArtifactId
    ? requireImageSource({ userId, conversationPublicId, artifactId: sourceArtifactId })
    : null;
  const parent = parentArtifactId
    ? requireArtifactSource({ userId, conversationPublicId, artifactId: parentArtifactId })
    : null;
  const title = optionalString(form.get("title"), 240) ??
    (source ? `Edited — ${source.title}` : file.name.replace(/\.[^.]+$/, "").slice(0, 240) || "Uploaded image");
  const adjustments = parsedAdjustments(form.get("adjustments"));
  let context: ArtifactContext | null = null;
  try {
    context = openContextOrThrow({
      userId,
      conversationPublicId,
      brief: source
        ? `Edit image artifact ${source.id}`
        : parent
          ? `Add image to artifact ${parent.id}`
          : `Upload image ${file.name}`,
    });
    const artifact = importArtifactImage({
      context,
      buffer: Buffer.from(await file.arrayBuffer()),
      title,
      filename: file.name,
      parentArtifactId: source?.id ?? parent?.id ?? null,
      sourceTool: source ? "artifact_image_edit" : "artifact_image_upload",
      metadata: {
        imageStudio: true,
        imageOperation: source ? "adjust" : "upload",
        ...(source ? { sourceArtifactId: source.id } : {}),
        ...(parent ? { sourceArtifactId: parent.id } : {}),
        ...(adjustments ? { adjustments } : {}),
      },
    });
    closeArtifactContext(context, "completed");
    return NextResponse.json({ artifact: presentArtifact(artifact) }, { status: 201 });
  } catch (error) {
    closeArtifactContext(context, "failed");
    throw error;
  }
}

/**
 * Render on the local ComfyUI and file the result as an ordinary image
 * artifact.
 *
 * It shares this route rather than owning one because what makes an image an
 * artifact — the run context, the verified import, the parent link — is the
 * same whoever drew it, and having two places that create image artifacts is
 * how one of them ends up subtly different.
 *
 * The whole render is recorded in the metadata: a picture made from a seed, a
 * checkpoint and 25 steps is reproducible, and it is only reproducible if the
 * numbers survive alongside it.
 */
async function handleComfyUiGeneration(
  body: Record<string, unknown>,
  userId: number,
): Promise<NextResponse> {
  const conversationPublicId = requiredString(body.conversationId, "conversationId", 200);
  const settings = (
    body.comfyui && typeof body.comfyui === "object" && !Array.isArray(body.comfyui)
      ? body.comfyui
      : {}
  ) as Record<string, unknown>;
  const prompt = requiredString(settings.prompt, "prompt", MAX_PROMPT_LENGTH);
  const parentArtifactId = optionalString(body.parentArtifactId, 200);
  const parent = parentArtifactId
    ? requireArtifactSource({ userId, conversationPublicId, artifactId: parentArtifactId })
    : null;
  const title = optionalString(body.title, 240) ?? defaultTitle(prompt, "Rendered image");

  let context: ArtifactContext | null = null;
  try {
    context = openContextOrThrow({ userId, conversationPublicId, brief: prompt });
    const rendered = await renderComfyUiImage({ ...settings, prompt });
    const artifact = importArtifactImage({
      context,
      buffer: rendered.buffer,
      title,
      filename: "comfyui-image.png",
      parentArtifactId: parent?.id ?? null,
      sourceTool: "artifact_image_generate",
      metadata: {
        imageStudio: true,
        imageOperation: "comfyui",
        imagePrompt: prompt,
        imageGenerator: "comfyui",
        comfyui: rendered.options,
        ...(parent ? { sourceArtifactId: parent.id } : {}),
      },
    });
    closeArtifactContext(context, "completed");
    return NextResponse.json({ artifact: presentArtifact(artifact) }, { status: 201 });
  } catch (error) {
    closeArtifactContext(context, "failed");
    throw error;
  }
}

async function handleGeneration(request: Request, userId: number): Promise<NextResponse> {
  const body = await readJsonBody(request);
  if (body.operation === "comfyui") return handleComfyUiGeneration(body, userId);
  const operation = body.operation === "edit" ? "edit" : "generate";
  const conversationPublicId = requiredString(body.conversationId, "conversationId", 200);
  const prompt = requiredString(body.prompt, "prompt", MAX_PROMPT_LENGTH);
  const sourceArtifactId = operation === "edit"
    ? requiredString(body.sourceArtifactId, "sourceArtifactId", 200)
    : null;
  const parentArtifactId = operation === "generate"
    ? optionalString(body.parentArtifactId, 200)
    : null;
  const source = sourceArtifactId
    ? requireImageSource({ userId, conversationPublicId, artifactId: sourceArtifactId })
    : null;
  const parent = parentArtifactId
    ? requireArtifactSource({ userId, conversationPublicId, artifactId: parentArtifactId })
    : null;
  const title = optionalString(body.title, 240) ??
    defaultTitle(prompt, source ? "Edited image" : "Generated image");
  let context: ArtifactContext | null = null;
  try {
    context = openContextOrThrow({ userId, conversationPublicId, brief: prompt });
    let sourceImage: { dataUrl: string } | null = null;
    if (source) {
      const file = artifactFile({ artifact: source, version: source.current_version, purpose: "preview" });
      const size = fs.statSync(file.path).size;
      if (size > MAX_UPLOAD_BYTES || !/^image\/(?:png|jpeg|webp)$/i.test(file.mimeType)) {
        throw new ApiError(
          422,
          "artifact_image_edit_format",
          "AI editing supports PNG, JPEG, and WebP images up to 25 MiB.",
        );
      }
      sourceImage = {
        dataUrl: `data:${file.mimeType};base64,${fs.readFileSync(file.path).toString("base64")}`,
      };
    }
    const generated = await generateArtifactImage({
      baseURL: resolveChatmockBaseUrl(request).baseURL,
      prompt,
      sourceImage,
    });
    const artifact = importArtifactImage({
      context,
      buffer: generated.buffer,
      title,
      filename: source ? "edited-image.png" : "generated-image.png",
      parentArtifactId: source?.id ?? parent?.id ?? null,
      sourceTool: source ? "artifact_image_edit" : "artifact_image_generate",
      metadata: {
        imageStudio: true,
        imageOperation: operation,
        imagePrompt: prompt,
        ...(generated.providerItemId ? { providerItemId: generated.providerItemId } : {}),
        ...(source ? { sourceArtifactId: source.id } : {}),
        ...(parent ? { sourceArtifactId: parent.id } : {}),
      },
    });
    closeArtifactContext(context, "completed");
    return NextResponse.json({ artifact: presentArtifact(artifact) }, { status: 201 });
  } catch (error) {
    closeArtifactContext(context, "failed");
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    requireEnabled();
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    return contentType.startsWith("multipart/form-data")
      ? await handleUpload(request, userId)
      : await handleGeneration(request, userId);
  } catch (error) {
    if (
      error instanceof ArtifactStoreError ||
      error instanceof ArtifactImageServiceError ||
      error instanceof ComfyUiError
    ) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return apiErrorResponse(error);
  }
}
