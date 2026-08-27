import { randomUUID } from "node:crypto";

import {
  RuntimeJobControlError,
  cancelRuntimeJob,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  submitRuntimeJob,
  type RuntimeJobAuthority,
  type RuntimeJobSnapshot,
} from "../supervisor-control.ts";
import {
  type CanonicalImageSearchRequest,
  type ImageSearchDisplayItem,
  type ImageSearchResult,
  type ImageSearchRuntimeScope,
} from "./image-search-service.ts";
import { ImageSearchServiceError } from "./image-search-errors.ts";

const GOOGLE_JOB_TIMEOUT_MS = 120_000;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);

function runtimeAuthority(scope: ImageSearchRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) ||
    scope.userId < 1 ||
    !scope.conversationId.trim() ||
    (scope.gardenId !== null && !scope.gardenId.trim())
  ) throw new TypeError("Image-search Runtime scope is invalid.");
  return scope;
}

function isGoogleImageJob(job: RuntimeJobSnapshot, authority: RuntimeJobAuthority): boolean {
  return (
    job.jobType === "image-search-google" &&
    job.workerKind === "image-search-node" &&
    job.resourceClass === "browser-automation" &&
    job.gardenId === authority.gardenId &&
    job.conversationId === authority.conversationId
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function completedGoogleImageJob(
  authority: RuntimeJobAuthority,
  initial: RuntimeJobSnapshot,
  signal?: AbortSignal,
): Promise<RuntimeJobSnapshot> {
  if (!isGoogleImageJob(initial, authority)) {
    throw new Error("Runtime returned an invalid image-search job.");
  }
  const deadline = Date.now() + GOOGLE_JOB_TIMEOUT_MS;
  let job = initial;
  while (!TERMINAL_STATES.has(job.state)) {
    if (signal?.aborted || Date.now() >= deadline) {
      await cancelRuntimeJob(authority, job.jobId).catch(() => undefined);
      throw new ImageSearchServiceError(
        signal?.aborted ? "image_search_aborted" : "image_search_failed",
        signal?.aborted
          ? "The image search was cancelled."
          : "The image search did not answer. Try again once.",
      );
    }
    await wait(150);
    job = await inspectRuntimeJob(authority, job.jobId);
    if (!isGoogleImageJob(job, authority)) {
      throw new Error("Runtime returned an invalid image-search job.");
    }
  }
  if (job.state === "resource_exhausted") {
    throw new ImageSearchServiceError(
      "BREADBOARD_RESOURCE_EXHAUSTED",
      "Windows memory pressure is too high to start Google image search right now.",
    );
  }
  if (job.state === "cancelled") {
    throw new ImageSearchServiceError("image_search_aborted", "The image search was cancelled.");
  }
  if (job.state !== "succeeded") {
    throw new ImageSearchServiceError(
      "image_search_failed",
      "The image search did not answer. Try again once.",
    );
  }
  return job;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function workerResult(job: RuntimeJobSnapshot, content: unknown): Record<string, unknown> {
  if (!isRecord(content)) throw new Error("Runtime returned an invalid image-search result.");
  const identity = content.identity;
  if (
    Object.keys(content).sort().join(",") !==
      "completionSequence,identity,protocolVersion,result" ||
    content.protocolVersion !== 1 ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(identity) ||
    identity.jobId !== job.jobId ||
    identity.attempt !== job.attempt ||
    identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result)
  ) throw new Error("Runtime returned an unfenced image-search result.");
  return content.result;
}

function imageResult(value: unknown): ImageSearchResult {
  if (!isRecord(value) || !isRecord(value.display) || !Array.isArray(value.display.items)) {
    throw new Error("Runtime returned an invalid image-search display payload.");
  }
  const query = typeof value.query === "string" ? value.query : "";
  if (
    !query ||
    value.display.query !== query ||
    value.itemsReturned !== value.display.items.length ||
    !Number.isSafeInteger(value.itemsReturned) ||
    (value.itemsReturned as number) < 0 ||
    (value.itemsReturned as number) > 10 ||
    (value.nextPageStartIndex !== undefined &&
      (!Number.isSafeInteger(value.nextPageStartIndex) ||
        (value.nextPageStartIndex as number) < 1 ||
        (value.nextPageStartIndex as number) > 101))
  ) throw new Error("Runtime returned an invalid image-search display payload.");
  const items = value.display.items.map((item): ImageSearchDisplayItem => {
    if (
      !isRecord(item) ||
      typeof item.title !== "string" ||
      typeof item.image !== "string" ||
      !/^https?:\/\//iu.test(item.image) ||
      typeof item.thumb !== "string" ||
      typeof item.page !== "string" ||
      typeof item.site !== "string" ||
      (item.w !== undefined && (!Number.isSafeInteger(item.w) || (item.w as number) < 0)) ||
      (item.h !== undefined && (!Number.isSafeInteger(item.h) || (item.h as number) < 0))
    ) throw new Error("Runtime returned an invalid image-search item.");
    return {
      title: item.title,
      image: item.image,
      thumb: item.thumb,
      page: item.page,
      site: item.site,
      ...(typeof item.w === "number" ? { w: item.w } : {}),
      ...(typeof item.h === "number" ? { h: item.h } : {}),
    };
  });
  return {
    query,
    itemsReturned: items.length,
    ...(typeof value.nextPageStartIndex === "number"
      ? { nextPageStartIndex: value.nextPageStartIndex }
      : {}),
    display: { query, items },
  };
}

export async function runGoogleImageSearch(
  args: CanonicalImageSearchRequest,
  scope: ImageSearchRuntimeScope | undefined,
  signal?: AbortSignal,
): Promise<ImageSearchResult> {
  if (!scope) {
    throw new ImageSearchServiceError(
      "image_search_runtime_unavailable",
      "Google image search requires an authenticated Runtime conversation.",
    );
  }
  const authority = runtimeAuthority(scope);
  let submittedJobId: string | null = null;
  let terminal = false;
  try {
    const initial = await submitRuntimeJob(authority, {
      jobType: "image-search-google",
      idempotencyKey: `image-search-google:${randomUUID()}`,
      requestPayload: args,
    });
    submittedJobId = initial.jobId;
    const job = await completedGoogleImageJob(authority, initial, signal);
    terminal = true;
    const output = await readRuntimeJobOutput(authority, job.jobId, "result");
    const result = workerResult(job, output.content);
    if (result.ok !== true) {
      throw new ImageSearchServiceError(
        typeof result.code === "string" ? result.code : "image_search_failed",
        typeof result.message === "string"
          ? result.message.slice(0, 400)
          : "The image search did not answer. Try again once.",
      );
    }
    return imageResult(result.data);
  } catch (error) {
    if (error instanceof ImageSearchServiceError) throw error;
    if (error instanceof RuntimeJobControlError) {
      if (error.code === "BREADBOARD_RESOURCE_EXHAUSTED") {
        throw new ImageSearchServiceError(
          "BREADBOARD_RESOURCE_EXHAUSTED",
          "Windows memory pressure is too high to start Google image search right now.",
        );
      }
      if (error.code === "RUNTIME_UNAVAILABLE") {
        throw new ImageSearchServiceError(
          "image_search_runtime_unavailable",
          "The local Runtime is unavailable for Google image search.",
        );
      }
    }
    throw new ImageSearchServiceError(
      "image_search_failed",
      "The image search did not answer. Try again once.",
    );
  } finally {
    if (submittedJobId !== null && !terminal) {
      await cancelRuntimeJob(authority, submittedJobId).catch(() => undefined);
    }
  }
}
