// Worker-local run manager for the Wardrobe agent.
//
// A run takes the photos attached to one message and walks each of them through
// the clone's own pipeline: detect the garments, cut each one out, file it in the
// library, then generate the modeled editorial photo and attach that too. The
// clone owns every one of those steps; what lives here is the driving — the
// order, the waiting, the decision at each review gate, and turning the whole
// thing into events a card can render and a sentence a person can read a week
// later. This state exists only inside one fresh disposable Runtime V2 worker;
// Rust persists the replayable projection and terminal outcome.
//
// The clone's review gates are the interesting part. Its own UI shows a person
// each cutout and asks approve or reject. Headless, there is nobody to ask, so
// this approves whatever generated successfully and lets a failure end that one
// garment rather than the import — which is the right trade when ten photos are
// in flight and one sleeve came out wrong. The picture is kept as an artifact
// either way, so a bad cutout is visible in the chat rather than only in a
// gallery nobody opened.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { ChatAttachment } from "../chat-attachments.ts";
import {
  closeWardrobeArtifactContext,
  openWardrobeArtifactContext,
  saveGarmentArtifact,
  type WardrobeArtifactContext,
} from "./artifact.ts";
import {
  createJobs,
  decideStage,
  deleteJob,
  fetchAsset,
  library,
  regenerateStage,
  waitForStage,
  type ImportJob,
  type LibraryItem,
} from "./client.ts";
import {
  ensureWardrobeService,
  withWardrobeServiceLease,
} from "./runtime-service.ts";
import type { WardrobeRequest } from "./identity.ts";
import { promptWithContext } from "../conversations/agent-context.ts";

export interface WardrobeEvent {
  sequenceNumber: number;
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

type RunStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export interface ImportedGarment {
  itemId: string;
  name: string;
  part: string;
  color: string;
  /** Whether the modeled editorial photo made it too. */
  modeled: boolean;
  artifactIds: string[];
}

interface RunState {
  runId: string;
  userId: number;
  request: WardrobeRequest;
  status: RunStatus;
  sequence: number;
  events: WardrobeEvent[];
  imported: ImportedGarment[];
  skipped: Array<{ name: string; reason: string }>;
  galleryUrl: string;
  aborted: boolean;
  summary: string;
  createdAt: number;
  controller: AbortController;
}

const globalRuns = globalThis as typeof globalThis & {
  __breadboardWardrobeRuns?: Map<string, RunState>;
};
const runs = globalRuns.__breadboardWardrobeRuns ?? new Map<string, RunState>();
globalRuns.__breadboardWardrobeRuns = runs;

const MAX_EVENTS = 2_000;
// An import is looked at again: the person comes back to see what landed. A
// window that outlasts a lunch break costs nothing and saves a blank card.
const RETENTION_MS = 6 * 60 * 60 * 1000;
const MAX_RUNS = 25;

/** How long one generated image is waited for before that garment is given up. */
const STAGE_TIMEOUT_MS = 6 * 60 * 1000;

// ---- event plumbing ---------------------------------------------------------

function emit(
  run: RunState,
  type: string,
  payload: Record<string, unknown> = {},
): void {
  run.sequence += 1;
  run.events.push({
    sequenceNumber: run.sequence,
    type,
    payload,
    at: new Date().toISOString(),
  });
  if (run.events.length > MAX_EVENTS) {
    run.events.splice(0, run.events.length - MAX_EVENTS);
  }
}

function requireRun(userId: number, runId: string): RunState {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) throw new Error("run_not_found");
  return run;
}

function evict(): void {
  const now = Date.now();
  for (const [runId, run] of runs) {
    if (now - run.createdAt > RETENTION_MS) runs.delete(runId);
  }
  if (runs.size <= MAX_RUNS) return;
  const ordered = [...runs.entries()].sort(
    (left, right) => left[1].createdAt - right[1].createdAt,
  );
  for (const [runId] of ordered.slice(0, runs.size - MAX_RUNS))
    runs.delete(runId);
}

// ---- the written answer -----------------------------------------------------

const PART_LABELS: Record<string, string> = {
  upperbody: "top",
  wholebody_up: "outer layer",
  lowerbody: "bottom",
  accessories_up: "accessory",
  shoes: "shoes",
};

function partLabel(part: string): string {
  return PART_LABELS[part] ?? part;
}

/**
 * The list as prose, kept with the finished turn. The card renders live rows and
 * the pictures arrive as artifacts; this is what still reads correctly once the
 * run itself is gone, so it names every piece and where the wardrobe is.
 */
export function summarizeImport(input: {
  imported: ImportedGarment[];
  skipped: Array<{ name: string; reason: string }>;
  galleryUrl: string;
  artifactsAvailable: boolean;
}): string {
  const lines: string[] = [];
  if (!input.imported.length) {
    lines.push(
      input.skipped.length
        ? "Nothing was added to the wardrobe."
        : "No clothing was found in those photos.",
    );
  } else {
    const modeled = input.imported.filter((item) => item.modeled).length;
    lines.push(
      `${input.imported.length} piece${input.imported.length === 1 ? "" : "s"} added to your wardrobe` +
        (modeled ? `, ${modeled} with a modeled photo.` : "."),
      "",
      ...input.imported.map(
        (item) =>
          `- **${item.name}** — ${partLabel(item.part)}, ${item.color}` +
          (item.modeled ? "" : " (cutout only)"),
      ),
    );
  }
  if (input.skipped.length) {
    lines.push(
      "",
      `Left out: ${input.skipped.map((entry) => `${entry.name} (${entry.reason})`).join(", ")}.`,
    );
  }
  if (input.imported.length) {
    lines.push("", `Browse the wardrobe at ${input.galleryUrl}.`);
    if (!input.artifactsAvailable) {
      lines.push(
        "The pictures could not be saved to this chat's artifacts — they are in the gallery only.",
      );
    }
  }
  return lines.join("\n");
}

// ---- lifecycle --------------------------------------------------------------

export interface StartRunInput {
  userId: number;
  /** Runtime identity. Present only inside the disposable worker. */
  runtimeJobId?: string;
  request: WardrobeRequest;
  attachments: ChatAttachment[];
  /** Canonical sealed photo paths supplied only by the Runtime worker. */
  runtimePhotos?: ReadonlyArray<{
    name: string;
    inputPath: string;
    mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    sizeBytes: number;
  }>;
  model: string;
  /** ChatMock's OpenAI-compatible base URL. */
  baseUrl: string;
  conversationPublicId: string;
  /** The chat this was launched from, so direction can refer back to it. */
  conversationContext?: string;
}

export function startRun(input: StartRunInput): {
  runId: string;
  status: RunStatus;
} {
  evict();
  const runId =
    input.runtimeJobId ?? `wdrun_${randomUUID().replaceAll("-", "")}`;
  const run: RunState = {
    runId,
    userId: input.userId,
    request: input.request,
    status: "queued",
    sequence: 0,
    events: [],
    imported: [],
    skipped: [],
    galleryUrl: "",
    aborted: false,
    summary: "",
    createdAt: Date.now(),
    controller: new AbortController(),
  };
  runs.set(runId, run);
  void drive(run, input).catch((error: unknown) => {
    if (run.aborted) return;
    run.status = "failed";
    run.summary =
      error instanceof Error ? error.message : "The wardrobe import failed.";
    emit(run, "run.failed", { error: run.summary, summary: run.summary });
  });
  return { runId, status: "queued" };
}

/** The photographs a run works on — every image the message carried. */
interface WardrobePhoto {
  name: string;
  dataUrl: () => Promise<string>;
}

function photosFrom(input: StartRunInput): WardrobePhoto[] {
  if (input.runtimePhotos?.length) {
    return input.runtimePhotos.map((photo) => ({
      name: photo.name,
      async dataUrl() {
        const metadata = fs.lstatSync(photo.inputPath);
        if (
          !metadata.isFile() ||
          metadata.isSymbolicLink() ||
          metadata.size !== photo.sizeBytes ||
          metadata.size < 1 ||
          metadata.size > 10 * 1024 * 1024
        ) {
          throw new Error("The sealed Wardrobe photo is unavailable.");
        }
        const bytes = await fs.promises.readFile(photo.inputPath);
        if (bytes.byteLength !== photo.sizeBytes) {
          throw new Error(
            "The sealed Wardrobe photo changed while it was read.",
          );
        }
        return `data:${photo.mediaType};base64,${bytes.toString("base64")}`;
      },
    }));
  }
  return input.attachments
    .filter(
      (attachment): attachment is Extract<ChatAttachment, { type: "image" }> =>
        attachment.type === "image",
    )
    .map((attachment) => ({
      name: attachment.name,
      dataUrl: () => Promise.resolve(attachment.dataUrl),
    }));
}

/**
 * Save a garment's pictures into the chat. Best-effort: an artifact store that
 * refuses one image must not cost the import, so the failure is recorded on the
 * run and reported once, in the summary.
 */
function saveArtifacts(input: {
  context: WardrobeArtifactContext | null;
  item: LibraryItem;
  baseUrl: string;
  signal: AbortSignal;
}): Promise<string[]> {
  if (!input.context) return Promise.resolve([]);
  const wanted: Array<{ path: string; kind: "cutout" | "modeled" }> = [
    { path: input.item.image, kind: "cutout" },
    ...(input.item.modeledImage
      ? [{ path: input.item.modeledImage, kind: "modeled" as const }]
      : []),
  ];
  return Promise.all(
    wanted.map(async (entry) => {
      try {
        const buffer = await fetchAsset(
          input.baseUrl,
          entry.path,
          input.signal,
        );
        const artifact = await saveGarmentArtifact({
          context: input.context as WardrobeArtifactContext,
          item: input.item,
          buffer,
          kind: entry.kind,
        });
        return artifact.id;
      } catch {
        return "";
      }
    }),
  ).then((ids) => ids.filter(Boolean));
}

/** The library record the clone wrote for a finished job. */
async function importedRecord(
  baseUrl: string,
  jobId: string,
  signal: AbortSignal,
): Promise<LibraryItem | null> {
  const items = await library(baseUrl, signal);
  return items.find((item) => item.importJobId === jobId) ?? null;
}

async function drive(run: RunState, input: StartRunInput): Promise<void> {
  await withWardrobeServiceLease(
    {
      userId: run.userId,
      runId: run.runId,
      conversationPublicId: input.conversationPublicId,
    },
    () => driveLeased(run, input),
  );
}

async function driveLeased(run: RunState, input: StartRunInput): Promise<void> {
  const photos = photosFrom(input);
  if (!photos.length) {
    throw new Error(
      "Attach the photos of the clothes you want imported — Wardrobe reads the pictures, not the message.",
    );
  }

  run.status = "running";
  emit(run, "run.started", {
    photos: photos.length,
    direction: run.request.direction,
  });

  emit(run, "service.starting", {});
  const service = await ensureWardrobeService(
    {
      userId: run.userId,
      runId: run.runId,
      conversationPublicId: input.conversationPublicId,
    },
    {
      upstreamUrl: input.baseUrl,
      model: input.model,
      quality: run.request.quality,
    },
    run.controller.signal,
  );
  if (run.aborted) return;
  run.galleryUrl = "/api/wardrobe/gallery";
  emit(run, "service.ready", { galleryUrl: run.galleryUrl });

  const context = openWardrobeArtifactContext({
    userId: input.userId,
    conversationPublicId: input.conversationPublicId,
    label: `Wardrobe import (${photos.length} photo${photos.length === 1 ? "" : "s"})`,
    agentRunId: run.runId,
  });
  let artifactsFailed = !context;

  try {
    for (const [index, photo] of photos.entries()) {
      if (run.aborted) return;
      emit(run, "photo.started", {
        name: photo.name,
        index: index + 1,
        total: photos.length,
      });

      let detected: { jobs: ImportJob[]; noClothingDetected: boolean };
      try {
        // Load only the photo being detected. Runtime inputs stay path-backed;
        // ten base64 images are never retained together in the worker heap.
        detected = await createJobs(
          service.baseUrl,
          await photo.dataUrl(),
          run.controller.signal,
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "detection failed";
        run.skipped.push({ name: photo.name, reason });
        emit(run, "photo.failed", { name: photo.name, error: reason });
        continue;
      }
      if (run.aborted) return;

      const jobs = detected.jobs.slice(0, run.request.maxItemsPerPhoto);
      const dropped = detected.jobs.length - jobs.length;
      emit(run, "photo.detected", {
        name: photo.name,
        found: detected.jobs.length,
        taking: jobs.length,
        items: jobs.map((job) => job.metadata.name),
      });
      // A cap that silently swallowed garments would read as "that photo only
      // had four things in it", so the ones left behind are named.
      for (const job of detected.jobs.slice(jobs.length)) {
        run.skipped.push({
          name: job.metadata.name,
          reason: "over the per-photo limit",
        });
      }
      if (dropped) emit(run, "photo.capped", { name: photo.name, dropped });

      for (const job of jobs) {
        if (run.aborted) return;
        const saved = await importGarment({
          run,
          service: service.baseUrl,
          job,
          context,
          input,
        });
        if (saved === "artifacts_failed") artifactsFailed = true;
      }
    }

    if (run.aborted) return;
    run.summary = summarizeImport({
      imported: run.imported,
      skipped: run.skipped,
      galleryUrl: run.galleryUrl,
      artifactsAvailable: !artifactsFailed,
    });
    run.status = "completed";
    emit(run, "run.completed", {
      summary: run.summary,
      imported: run.imported.length,
      skipped: run.skipped.length,
      galleryUrl: run.galleryUrl,
      elapsedSec: (Date.now() - run.createdAt) / 1_000,
    });
  } finally {
    closeWardrobeArtifactContext(
      context,
      run.status === "completed" ? "completed" : "failed",
    );
  }
}

/**
 * One garment, from crop to filed piece.
 *
 * Every exit that is not an import records why, because "six photos, four
 * pieces" is only useful next to what happened to the other two.
 */
async function importGarment(args: {
  run: RunState;
  service: string;
  job: ImportJob;
  context: WardrobeArtifactContext | null;
  input: StartRunInput;
}): Promise<"imported" | "skipped" | "artifacts_failed"> {
  const { run, service, job } = args;
  const name = job.metadata.name;
  const aborted = () => run.aborted;
  emit(run, "item.started", { jobId: job.id, name, part: job.metadata.part });

  const fail = async (reason: string) => {
    run.skipped.push({ name, reason });
    emit(run, "item.failed", { jobId: job.id, name, error: reason });
    await deleteJob(service, job.id, run.controller.signal).catch(
      () => undefined,
    );
  };

  try {
    // Direction reaches the *first* attempt through `regenerate`, which is the
    // only endpoint that takes a prompt. Without it, approving the crop is what
    // starts the cutout.
    if (run.request.direction) {
      await regenerateStage(
        service,
        job.id,
        "garment",
        // Only a run that was actually given direction gets the chat with it:
        // with no direction there is nothing for an earlier message to qualify,
        // and this endpoint is the clone's only prompt.
        promptWithContext(
          run.request.direction,
          args.input.conversationContext,
        ),
        run.controller.signal,
      );
    }
    await decideStage(
      service,
      job.id,
      "crop",
      "approve",
      run.controller.signal,
    );

    emit(run, "item.stage", {
      jobId: job.id,
      name,
      stage: "garment",
      status: "generating",
    });
    const cut = await waitForStage({
      baseUrl: service,
      jobId: job.id,
      stage: "garment",
      timeoutMs: STAGE_TIMEOUT_MS,
      aborted,
      signal: run.controller.signal,
    });
    if (run.aborted) return "skipped";
    if (cut.stages.garment.status !== "review") {
      await fail(
        cut.stages.garment.error ?? "the cutout could not be generated",
      );
      return "skipped";
    }

    // Approving the cutout is what writes the piece into `data/library.json`,
    // and it is also what starts the modeled photo. From here the garment is in
    // the wardrobe whatever happens next.
    await decideStage(
      service,
      job.id,
      "garment",
      "approve",
      run.controller.signal,
    );
    emit(run, "item.stage", {
      jobId: job.id,
      name,
      stage: "modeled",
      status: "generating",
    });

    let modeled = false;
    try {
      const shot = await waitForStage({
        baseUrl: service,
        jobId: job.id,
        stage: "modeled",
        timeoutMs: STAGE_TIMEOUT_MS,
        aborted,
        signal: run.controller.signal,
      });
      if (shot.stages.modeled.status === "review") {
        await decideStage(
          service,
          job.id,
          "modeled",
          "approve",
          run.controller.signal,
        );
        modeled = true;
      } else {
        emit(run, "item.partial", {
          jobId: job.id,
          name,
          error:
            shot.stages.modeled.error ??
            "the modeled photo could not be generated",
        });
      }
    } catch (error) {
      if (run.aborted) return "skipped";
      emit(run, "item.partial", {
        jobId: job.id,
        name,
        error:
          error instanceof Error
            ? error.message
            : "the modeled photo could not be generated",
      });
    }

    const record = await importedRecord(service, job.id, run.controller.signal);
    if (!record) {
      await fail("the piece was generated but not written to the wardrobe");
      return "skipped";
    }

    const artifactIds = await saveArtifacts({
      context: args.context,
      item: record,
      baseUrl: service,
      signal: run.controller.signal,
    });
    const expected = record.modeledImage ? 2 : 1;
    run.imported.push({
      itemId: record.id,
      name: record.name,
      part: record.part,
      color: record.color,
      modeled,
      artifactIds,
    });
    emit(run, "item.imported", {
      jobId: job.id,
      itemId: record.id,
      name: record.name,
      part: record.part,
      color: record.color,
      modeled,
      artifactIds,
    });
    return args.context && artifactIds.length < expected
      ? "artifacts_failed"
      : "imported";
  } catch (error) {
    if (run.aborted) return "skipped";
    await fail(error instanceof Error ? error.message : "the import failed");
    return "skipped";
  }
}

// ---- read/control API -------------------------------------------------------

export function getEventsSince(
  userId: number,
  runId: string,
  since = 0,
): WardrobeEvent[] {
  return requireRun(userId, runId).events.filter(
    (event) => event.sequenceNumber > since,
  );
}

export function isTerminal(userId: number, runId: string): boolean {
  return ["completed", "failed", "aborted"].includes(
    requireRun(userId, runId).status,
  );
}

export function abortRun(userId: number, runId: string): boolean {
  const run = requireRun(userId, runId);
  if (["completed", "failed", "aborted"].includes(run.status)) return false;
  run.aborted = true;
  run.status = "aborted";
  run.controller.abort(
    new DOMException("Wardrobe import stopped", "AbortError"),
  );
  // Whatever was already filed stays filed — the wardrobe is on disk, not in
  // this run — so the stopped summary reports it rather than implying a rollback.
  run.summary = run.imported.length
    ? `Import stopped. ${run.imported.length} piece${run.imported.length === 1 ? "" : "s"} had already been added.`
    : "The wardrobe import was stopped.";
  emit(run, "run.aborted", { summary: run.summary });
  return true;
}

export function runSummary(userId: number, runId: string): string {
  return requireRun(userId, runId).summary;
}

/** Worker-only entrypoint selected by the fixed Runtime adapter. */
export function startRuntimeWorkerRun(
  input: StartRunInput & { runtimeJobId: string },
): { runId: string; status: RunStatus } {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(input.runtimeJobId)) {
    throw new Error("Wardrobe Runtime identity is invalid.");
  }
  return startRun(input);
}

export const getRuntimeWorkerEventsSince = getEventsSince;
export const isRuntimeWorkerTerminal = isTerminal;
export const abortRuntimeWorkerRun = abortRun;
