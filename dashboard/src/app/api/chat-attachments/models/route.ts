import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  MAX_MODEL_ATTACHMENT_BYTES,
  MODEL_ATTACHMENT_FORMATS,
  isModelAttachmentFormat,
  modelAttachmentFormat,
  modelExportHint,
  modelPreviewStrategy,
} from "@/lib/model-attachments.ts";
import { buildKernelPreview } from "@/lib/conversations/model-kernel-preview.ts";
import { writeModelBlob } from "@/lib/conversations/model-blob-store.ts";
import { inspectModelUpload } from "@/lib/conversations/model-inspect.ts";
import {
  recordModelBlob,
  sweepUnreferencedModelBlobs,
} from "@/lib/conversations/model-uploads.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST: store an attached 3D file and return the pointer the message carries.
 *
 * Documents go through /api/extract-text, which reads their words and discards
 * the file. A mesh has no words: decoding one as text yields mojibake, and the
 * thing worth keeping is the file itself. So this route keeps the bytes and
 * returns what was read out of their headers, which is all the language model
 * will otherwise know about the attachment.
 *
 * The extension is a claim the browser makes and is never trusted on its own —
 * the bytes are confirmed to be that format before anything is written.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_ATTACHMENT_BYTES * 1.1) {
      throw new ApiError(413, "model_too_large", "That 3D file is too large to attach.");
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) {
      throw new ApiError(400, "model_file_required", "No 3D file was uploaded.");
    }
    if (file.size > MAX_MODEL_ATTACHMENT_BYTES) {
      throw new ApiError(413, "model_too_large", "That 3D file is too large to attach.");
    }

    // The filename decides the format; the posted `format` field may only agree
    // with it, so a mislabelled part cannot pick a different loader.
    const format = modelAttachmentFormat(file.name);
    if (!format) {
      throw new ApiError(400, "unsupported_model_format", "That file is not a supported 3D format.");
    }
    const declaredFormat = form.get("format");
    if (
      typeof declaredFormat === "string" &&
      declaredFormat &&
      (!isModelAttachmentFormat(declaredFormat) || declaredFormat !== format)
    ) {
      throw new ApiError(400, "model_format_mismatch", "That 3D file's format does not match its name.");
    }

    const content = Buffer.from(await file.arrayBuffer());
    const summary = inspectModelUpload(content, format);
    const stored = writeModelBlob({ format, content });
    recordModelBlob({ ...stored, userId, filename: file.name });

    // STEP and its siblings describe surfaces, not triangles. The local CAD
    // kernel turns one into a mesh the browser can draw; the original stays
    // exactly as uploaded and is what a download returns. A conversion that
    // cannot happen costs the preview, never the attachment.
    let preview: { previewBlobId: string; previewFormat: "glb" } | Record<string, never> = {};
    let previewSummary = summary;
    if (modelPreviewStrategy(format) === "kernel") {
      const converted = await buildKernelPreview(content, format);
      if (converted.ok) {
        recordModelBlob({
          ...converted.preview.blob,
          userId,
          filename: `${file.name}.preview.glb`,
        });
        preview = { previewBlobId: converted.preview.blob.blobId, previewFormat: "glb" };
        previewSummary = { ...summary, ...converted.preview.summary };
      } else if (converted.failure.note) {
        previewSummary = {
          ...summary,
          notes: [...(summary.notes ?? []), converted.failure.note],
        };
      }
    } else if (modelPreviewStrategy(format) === "none") {
      previewSummary = {
        ...summary,
        notes: [
          ...(summary.notes ?? []),
          `${MODEL_ATTACHMENT_FORMATS[format].label} is a proprietary format with no open reader, so it cannot be previewed here. ` +
            `It is stored and downloadable. To view or measure it, re-attach it as STEP — ${
              modelExportHint(format) ?? "export it as STEP from the application that made it"
            }.`,
        ],
      };
    }

    try {
      sweepUnreferencedModelBlobs(userId);
    } catch {
      // Housekeeping must never fail an upload the user is waiting on.
    }

    return NextResponse.json({
      blobId: stored.blobId,
      format: stored.format,
      sizeBytes: stored.byteSize,
      sha256: stored.sha256,
      summary: previewSummary,
      ...preview,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
