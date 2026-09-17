import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { resolveChatmockBaseUrl } from "@/lib/chatmock-server";
import { uploadLimitBytes } from "@/lib/ingest-upload";
import {
  createIngestErrorSseResponse,
  createRuntimeIngestSseResponse,
  runtimeControlErrorEvent,
} from "@/lib/runtime-v2/ingest-compatibility";
import {
  isIngestRecoveryId,
  markIngestRecoveryResumed,
  readIngestRecovery,
} from "@/lib/runtime-v2/ingest-recovery-store";
import { runtimeIngestIdempotencyKey } from "@/lib/runtime-v2/ingest-request";
import { selectedModelForUser } from "@/lib/selected-model";
import {
  requireOwnedClusterFromSlug,
  routeErrorResponse,
  RouteError,
} from "@/lib/server-auth";
import {
  abandonRuntimeJobInput,
  inspectRuntimeJobForStatus,
  reserveRuntimeJobInput,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
} from "@/lib/supervisor-control";

export const dynamic = "force-dynamic";

const REQUEST_ID_HEADER = "x-breadboard-ingest-request-id";
const LIVE_STATES = new Set([
  "queued",
  "admitted",
  "starting",
  "running",
  "checkpointing",
  "cancelling",
]);

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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

async function requestedModel(request: Request): Promise<string | null> {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RouteError(400, "The resume request body is invalid");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new RouteError(400, "The resume request body is invalid");
  }
  const model = (body as { model?: unknown }).model;
  if (model === undefined || model === null) return null;
  if (
    typeof model !== "string" ||
    !model.trim() ||
    new TextEncoder().encode(model).byteLength > 256
  ) {
    throw new RouteError(400, "The resume model is invalid");
  }
  return model.trim();
}

/**
 * Replay a failed upload from its retained copy as a new Runtime ingestion
 * job. The request is the one the failed job ran with, except the model: a
 * quota or credit refusal is usually why it failed, so the resume uses the
 * person's current pick (or an explicit `model` in the body). Same bytes mean
 * the executor restores the VLM and concept checkpoints the failed run wrote.
 * The response is the same SSE stream the upload dialog already consumes, so
 * progress, reattach after reload, and cancellation work unchanged.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ gardenId: string; recoveryId: string }> },
) {
  let model = "";
  try {
    const { gardenId, recoveryId } = await params;
    const { userId, cluster } = await requireOwnedClusterFromSlug(gardenId);
    if (!isIngestRecoveryId(recoveryId)) {
      throw new RouteError(400, "The recovery id is invalid");
    }
    const runtimeIdempotencyKey = idempotencyKey(request);
    const stored = readIngestRecovery({ gardenId: cluster.slug, recoveryId });
    if (!stored || (stored.record.userId !== null && stored.record.userId !== userId)) {
      throw new RouteError(404, "Recovery record not found");
    }
    const { record, sourcePath } = stored;
    const authority: RuntimeJobAuthority = {
      userId,
      gardenId: cluster.slug,
      conversationId: null,
    };
    if (record.resumedJobId) {
      let state: string | null = null;
      try {
        state = (await inspectRuntimeJobForStatus(authority, record.resumedJobId)).state;
      } catch {
        state = null;
      }
      if (state && LIVE_STATES.has(state)) {
        throw new RouteError(409, "This upload is already being resumed");
      }
    }

    model = (await requestedModel(request)) ?? selectedModelForUser(userId);
    const chatmockBaseUrl = record.request.generateMap
      ? resolveChatmockBaseUrl(request).baseURL
      : null;

    const reservation = await reserveRuntimeJobInput(authority, {
      gardenId: authority.gardenId,
      conversationId: authority.conversationId,
      displayName: record.filename,
      mediaType: record.mediaType,
      declaredSizeBytes: record.sizeBytes,
    });
    const abandon = async () => {
      try {
        await abandonRuntimeJobInput(authority, reservation.uploadId);
      } catch (error) {
        console.warn(
          "[ingest-recovery] Runtime input abandonment failed:",
          error instanceof Error ? error.message : "unknown error",
        );
      }
    };
    let input;
    try {
      input = await uploadRuntimeJobInput(
        authority,
        reservation,
        Readable.toWeb(fs.createReadStream(sourcePath)) as ReadableStream<Uint8Array>,
        request.signal,
      );
    } catch (error) {
      await abandon();
      throw error;
    }
    if (input.sha256 !== record.sha256 || input.sizeBytes !== record.sizeBytes) {
      await abandon();
      throw new RouteError(409, "The retained document no longer matches its record");
    }
    if (request.signal.aborted) {
      await abandon();
      throw request.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const startedAt = Date.now();
    let job;
    try {
      job = await submitRuntimeJob(authority, {
        jobType: "document-ingestion",
        idempotencyKey: runtimeIdempotencyKey,
        inputUploads: [{ uploadId: input.uploadId }],
        requestPayload: {
          sourceLabel: record.request.sourceLabel,
          isHandwriting: record.request.isHandwriting,
          parseWithVlm: record.request.parseWithVlm,
          parseWithAnydoc: record.request.parseWithAnydoc,
          vlmTask: record.request.vlmTask,
          generateMap: record.request.generateMap,
          model,
          chatmockBaseUrl,
          maximumUploadBytes: uploadLimitBytes(),
        },
      });
    } catch (error) {
      await abandon();
      return createIngestErrorSseResponse(
        runtimeControlErrorEvent(error, model, Date.now() - startedAt),
      );
    }
    markIngestRecoveryResumed({
      gardenId: cluster.slug,
      recoveryId,
      jobId: job.jobId,
    });
    return createRuntimeIngestSseResponse({
      authority,
      job,
      model,
      startedAt,
      parseWithVlm: record.request.parseWithVlm,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return NextResponse.json({ error: "Resume canceled" }, { status: 499 });
    }
    return routeErrorResponse(error);
  }
}
