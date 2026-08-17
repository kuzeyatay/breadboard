// Typed access to the Wardrobe app's own `/api/import/*` endpoints.
//
// Everything here is the clone's protocol, not Breadboard's — the shapes are
// what `scripts/import-job-api.mjs` returns, and the only job of this module is
// to stop the run manager from spelling any of it out twice. Nothing is
// validated beyond what the caller has to branch on, because the server on the
// other end is the one Breadboard just started.

const REQUEST_TIMEOUT_MS = 20_000;

export type StageName = "crop" | "garment" | "modeled";

export type StageStatus =
  | "pending"
  | "queued"
  | "processing"
  | "review"
  | "approved"
  | "rejected"
  | "failed";

export interface JobStage {
  status: StageStatus;
  decision: "approved" | "rejected" | null;
  attempts: number;
  assetUrl: string | null;
  failedAssetUrl: string | null;
  error: string | null;
  prompt: string | null;
  updatedAt: string | null;
}

export interface JobMetadata {
  name: string;
  part: string;
  color: string;
  secondaryColor: string | null;
  tags: string[];
}

export interface ImportJob {
  id: string;
  status: "active" | "complete";
  metadata: JobMetadata;
  stages: Record<StageName, JobStage>;
  createdAt: string;
  updatedAt: string;
  originalAssetUrl?: string;
}

export interface LibraryItem {
  id: string;
  name: string;
  part: string;
  color: string;
  secondaryColor: string | null;
  tags: string[];
  image: string;
  thumbnail: string;
  modeledImage: string | null;
  importJobId: string;
}

export interface WardrobeConfig {
  ready: boolean;
  hasApiKey: boolean;
  hasModelReference: boolean;
  modelReference: string;
}

export class WardrobeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WardrobeApiError";
    this.status = status;
  }
}

async function call<T>(
  baseUrl: string,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const message =
        parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
          ? ((parsed as { error: string }).error)
          : `Wardrobe request failed (${response.status})`;
      throw new WardrobeApiError(response.status, message);
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

export function config(baseUrl: string): Promise<WardrobeConfig> {
  return call<WardrobeConfig>(baseUrl, "/api/import/config", { timeoutMs: 5_000 });
}

/**
 * Hand one photo to the detector. The response is one job per garment found —
 * zero is a normal answer, not an error, for a photo with no clothes in it.
 *
 * Detection is a vision call, so it is given a much longer window than the
 * bookkeeping endpoints.
 */
export function createJobs(
  baseUrl: string,
  imageDataUrl: string,
): Promise<{ jobs: ImportJob[]; noClothingDetected: boolean }> {
  return call(baseUrl, "/api/import/jobs", {
    method: "POST",
    body: JSON.stringify({ imageDataUrl }),
    timeoutMs: 180_000,
  });
}

export function getJob(baseUrl: string, jobId: string): Promise<ImportJob> {
  return call<ImportJob>(baseUrl, `/api/import/jobs/${jobId}`);
}

export function deleteJob(baseUrl: string, jobId: string): Promise<unknown> {
  return call(baseUrl, `/api/import/jobs/${jobId}`, { method: "DELETE" });
}

/**
 * Approve or reject a stage. Approving `crop` starts the cutout; approving
 * `garment` files the piece in the library and starts the modeled photo;
 * approving `modeled` attaches that photo and closes the job.
 */
export function decideStage(
  baseUrl: string,
  jobId: string,
  stage: StageName,
  decision: "approve" | "reject",
): Promise<ImportJob> {
  return call<ImportJob>(baseUrl, `/api/import/jobs/${jobId}/stages/${stage}/${decision}`, {
    method: "POST",
    timeoutMs: 60_000,
  });
}

/**
 * Queue a fresh attempt at a stage, optionally under extra direction. This is
 * also how direction reaches a *first* attempt: the clone only takes a prompt
 * here, and queueing the cutout this way means the run pays for one generation
 * rather than a default one it would then have to replace.
 */
export function regenerateStage(
  baseUrl: string,
  jobId: string,
  stage: Exclude<StageName, "crop">,
  prompt: string,
): Promise<ImportJob> {
  return call<ImportJob>(baseUrl, `/api/import/jobs/${jobId}/stages/${stage}/regenerate`, {
    method: "POST",
    body: JSON.stringify({ prompt: prompt.slice(0, 1_200) }),
  });
}

export function library(baseUrl: string): Promise<LibraryItem[]> {
  return call<LibraryItem[]>(baseUrl, "/api/import/wardrobe");
}

/** Read one of the clone's own images back, for saving as an artifact. */
export async function fetchAsset(baseUrl: string, assetPath: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}${assetPath}`, { signal: controller.signal });
    if (!response.ok) {
      throw new WardrobeApiError(response.status, `Could not read ${assetPath}.`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

const SETTLED: StageStatus[] = ["review", "approved", "rejected", "failed"];

/**
 * Wait for a stage to stop moving.
 *
 * The clone's generation is fire-and-forget — the POST that starts it returns
 * immediately and the outcome only shows up in the job record — so polling is
 * the protocol rather than a workaround. Returns the job as soon as the stage
 * reaches a state a decision can be made about, and throws on the deadline so a
 * provider that never answers ends the item instead of the run.
 */
export async function waitForStage(input: {
  baseUrl: string;
  jobId: string;
  stage: StageName;
  timeoutMs: number;
  pollMs?: number;
  aborted: () => boolean;
  onProgress?: (job: ImportJob) => void;
}): Promise<ImportJob> {
  const deadline = Date.now() + input.timeoutMs;
  let lastStatus: StageStatus | null = null;
  for (;;) {
    if (input.aborted()) throw new WardrobeApiError(499, "The import was stopped.");
    const job = await getJob(input.baseUrl, input.jobId);
    const status = job.stages[input.stage].status;
    if (status !== lastStatus) {
      lastStatus = status;
      input.onProgress?.(job);
    }
    if (SETTLED.includes(status)) return job;
    if (Date.now() > deadline) {
      throw new WardrobeApiError(
        504,
        `The ${input.stage} stage did not finish in time for “${job.metadata.name}”.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, input.pollMs ?? 1_500));
  }
}
