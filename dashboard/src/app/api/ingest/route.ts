import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { parseIngestUpload, uploadLimitBytes } from "@/lib/ingest-upload";
import {
  createIngestErrorSseResponse,
  createRuntimeIngestSseResponse,
  runtimeControlErrorEvent,
} from "@/lib/runtime-v2/ingest-compatibility";
import {
  requireOwnedCluster,
  requireUserId,
  routeErrorResponse,
  RouteError,
} from "@/lib/server-auth";
import { runtimeIngestIdempotencyKey } from "@/lib/runtime-v2/ingest-request";
import { selectedModelForUser } from "@/lib/selected-model";
import { submitRuntimeJob, type RuntimeJobAuthority } from "@/lib/supervisor-control";
import { DEFAULT_VLM_OCR_TASK, isVlmOcrTask } from "@/lib/vlm-ocr/prompts";

export const dynamic = "force-dynamic";

const CLUSTER_HEADER = "x-breadboard-ingest-cluster-slug";
const FILE_SIZE_HEADER = "x-breadboard-ingest-file-size";
const REQUEST_ID_HEADER = "x-breadboard-ingest-request-id";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function compatibilityUploadHeaders(request: Request): {
  clusterSlug: string;
  fileSize: number;
} | null {
  const clusterSlug = request.headers.get(CLUSTER_HEADER);
  const rawSize = request.headers.get(FILE_SIZE_HEADER);
  if (clusterSlug === null && rawSize === null) return null;
  if (clusterSlug === null || rawSize === null) {
    throw new RouteError(400, "Ingestion upload metadata is incomplete");
  }
  if (!/^\d+$/u.test(rawSize)) {
    throw new RouteError(400, "The ingestion file size is invalid");
  }
  const fileSize = Number(rawSize);
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize < 1 ||
    fileSize > uploadLimitBytes()
  ) {
    throw new RouteError(400, "The ingestion file size is invalid");
  }
  if (!clusterSlug.trim() || new TextEncoder().encode(clusterSlug).byteLength > 256) {
    throw new RouteError(400, "clusterSlug is required");
  }
  return { clusterSlug, fileSize };
}

function idempotencyKey(request: Request): string {
  const supplied = request.headers.get(REQUEST_ID_HEADER);
  if (supplied === null) return `ingest-${randomUUID()}`;
  try {
    return runtimeIngestIdempotencyKey(supplied);
  } catch {
    throw new RouteError(400, "The ingestion request identity is invalid");
  }
}

export async function POST(request: Request) {
  let upload: Awaited<ReturnType<typeof parseIngestUpload>> | null = null;
  let model = "";
  try {
    // Authentication happens before the request body is consumed. Internal UI
    // callers also send the garden and exact File.size as compatibility
    // headers, allowing Rust to own the raw byte stream immediately. Older
    // headerless multipart clients keep their existing contract through one
    // bounded private spool, then stream that file into the same Rust ticket.
    const userId = await requireUserId();
    const compatibility = compatibilityUploadHeaders(request);
    const runtimeIdempotencyKey = idempotencyKey(request);
    let cluster = compatibility
      ? requireOwnedCluster(userId, compatibility.clusterSlug)
      : null;
    let authority: RuntimeJobAuthority | null = cluster
      ? { userId, gardenId: cluster.slug, conversationId: null }
      : null;

    upload = await parseIngestUpload(
      request,
      compatibility && authority
        ? { authority, declaredSizeBytes: compatibility.fileSize }
        : undefined,
    );

    const file = upload.file;
    const clusterSlug = upload.fields.get("clusterSlug");
    if (!file) throw new RouteError(400, "file is required");
    if (typeof clusterSlug !== "string" || !clusterSlug.trim()) {
      throw new RouteError(400, "clusterSlug is required");
    }
    if (compatibility && clusterSlug.trim() !== cluster!.slug) {
      throw new RouteError(400, "The ingestion garden metadata does not match");
    }
    if (compatibility && file.size !== compatibility.fileSize) {
      throw new RouteError(400, "The ingestion file size does not match");
    }
    if (!cluster) cluster = requireOwnedCluster(userId, clusterSlug);
    authority ??= { userId, gardenId: cluster.slug, conversationId: null };

    const sourceLabelValue = upload.fields.get("sourceLabel");
    const sourceLabel = sourceLabelValue?.trim() || null;
    if (sourceLabel && new TextEncoder().encode(sourceLabel).byteLength > 256) {
      throw new RouteError(400, "sourceLabel is too long");
    }
    const isHandwriting = upload.fields.get("isHandwriting") === "true";
    const generateMap = upload.fields.get("generateMap") !== "false";
    const parseWithVlm =
      upload.fields.get("parseWithVlm") === "true" ||
      upload.fields.get("parseMode") === "vlm";
    const parseWithAnydoc =
      upload.fields.get("parseWithAnydoc") === "true" ||
      upload.fields.get("parseMode") === "anydoc";
    const rawVlmTask = upload.fields.get("vlmTask");
    const vlmTask = isVlmOcrTask(rawVlmTask)
      ? rawVlmTask
      : DEFAULT_VLM_OCR_TASK;
    model = selectedModelForUser(userId);
    const chatmockBaseUrl = generateMap
      ? resolveChatmockBaseUrl(request).baseURL
      : null;

    const input = await upload.stageRuntimeInput(authority, request.signal);
    if (request.signal.aborted) {
      throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    // Match the legacy SSE duration: multipart transfer/staging is complete
    // before the timed document-processing operation begins.
    const startedAt = Date.now();
    let job;
    try {
      job = await submitRuntimeJob(authority, {
        jobType: "document-ingestion",
        idempotencyKey: runtimeIdempotencyKey,
        inputUploads: [{ uploadId: input.uploadId }],
        requestPayload: {
          sourceLabel,
          isHandwriting,
          parseWithVlm,
          parseWithAnydoc,
          vlmTask,
          generateMap,
          model,
          chatmockBaseUrl,
          maximumUploadBytes: uploadLimitBytes(),
        },
      });
    } catch (error) {
      await upload.cleanup();
      upload = null;
      return createIngestErrorSseResponse(
        runtimeControlErrorEvent(error, model, Date.now() - startedAt),
      );
    }
    upload.markRuntimeInputSubmitted();
    await upload.cleanup();
    upload = null;
    return createRuntimeIngestSseResponse({
      authority,
      job,
      model,
      startedAt,
      parseWithVlm,
    });
  } catch (error) {
    await upload?.cleanup();
    if (isAbortError(error)) {
      return NextResponse.json({ error: "Upload canceled" }, { status: 499 });
    }
    return routeErrorResponse(error);
  }
}
