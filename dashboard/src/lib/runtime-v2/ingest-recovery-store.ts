/**
 * Failed-upload recovery records.
 *
 * When a document ingestion job fails after its bytes were staged, the worker
 * keeps a copy of the document and the exact request under
 * `<data>/runtime/ingest-recovery/<gardenId>/<recoveryId>/` (see
 * `retainIngestRecovery` in `scripts/runtime-v2-document-ingestion-worker.mjs`).
 * Runtime deletes its own staged blob the moment the job is terminal, and the
 * VLM and concept checkpoints the executor wrote are keyed by those exact
 * bytes, so this copy is what lets a resumed upload restore an hour of OCR
 * instead of starting over — the same idea as Learn keeping a failed job's
 * row and caches around for a retry.
 *
 * This module is the dashboard's read side: it validates the worker's
 * manifest strictly, lists a garden's records (pruning expired or broken
 * ones), and discards or marks them. The resume route streams the retained
 * bytes back into a fresh Runtime job.
 */

import fs from "node:fs";
import path from "node:path";

import { dashboardDataDir } from "@/lib/runtime-paths";
import { isVlmOcrTask, type VlmOcrTask } from "@/lib/vlm-ocr/prompts";

export const INGEST_RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECOVERY_ID = /^rec_[0-9a-f]{32}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MANIFEST_FILE = "recovery.json";
const SOURCE_FILE = "source";
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_TEXT_BYTES = 4 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const FAILURE_KINDS = new Set(["provider-quota", "runtime"]);

export interface IngestRecoveryRequest {
  readonly sourceLabel: string | null;
  readonly isHandwriting: boolean;
  readonly parseWithVlm: boolean;
  readonly parseWithAnydoc: boolean;
  readonly vlmTask: VlmOcrTask;
  readonly generateMap: boolean;
  readonly model: string | null;
}

export interface IngestRecoveryRecord {
  readonly protocolVersion: 1;
  readonly recoveryId: string;
  readonly gardenId: string;
  readonly userId: number | null;
  readonly filename: string;
  readonly mediaType: string | null;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly request: IngestRecoveryRequest;
  readonly failedJobId: string;
  readonly failedAt: number;
  readonly failure: {
    readonly message: string;
    readonly kind: "provider-quota" | "runtime";
  };
  readonly lastStep: string;
  readonly resumedJobId: string | null;
  readonly resumedAt: number | null;
}

/** The shape the garden UI receives: no user id, no digest, no job internals. */
export interface PublicIngestRecovery {
  readonly recoveryId: string;
  readonly filename: string;
  readonly sizeBytes: number;
  readonly failedAt: number;
  readonly failure: IngestRecoveryRecord["failure"];
  readonly lastStep: string;
  readonly request: Pick<
    IngestRecoveryRequest,
    "parseWithVlm" | "parseWithAnydoc" | "isHandwriting" | "generateMap" | "model"
  >;
  readonly resumedJobId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    Buffer.byteLength(value, "utf8") <= maximumBytes
  );
}

function optionalText(value: unknown, maximumBytes: number): value is string | null {
  return value === null || (boundedText(value, maximumBytes) && value.length > 0);
}

function safeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isIngestRecoveryId(value: unknown): value is string {
  return typeof value === "string" && RECOVERY_ID.test(value);
}

export function ingestRecoveryRoot(
  gardenId: string,
  dataRoot: string = dashboardDataDir(),
): string {
  if (!gardenId || gardenId.includes("\0") || gardenId !== path.basename(gardenId)) {
    throw new TypeError("The ingestion recovery garden is invalid.");
  }
  return path.join(dataRoot, "runtime", "ingest-recovery", gardenId);
}

/** Strict read of the worker's manifest. Anything else is a broken record. */
export function parseIngestRecoveryManifest(value: unknown): IngestRecoveryRecord {
  if (
    !isRecord(value) ||
    value.protocolVersion !== 1 ||
    !isIngestRecoveryId(value.recoveryId) ||
    !boundedText(value.gardenId, 256) ||
    value.gardenId.length === 0 ||
    !(value.userId === null || (Number.isSafeInteger(value.userId) && (value.userId as number) > 0)) ||
    !boundedText(value.filename, 512) ||
    value.filename.length === 0 ||
    !optionalText(value.mediaType, 256) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 1 ||
    (value.sizeBytes as number) > MAX_SOURCE_BYTES ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    !isRecord(value.request) ||
    !boundedText(value.failedJobId, 256) ||
    value.failedJobId.length === 0 ||
    !safeTimestamp(value.failedAt) ||
    !isRecord(value.failure) ||
    !boundedText(value.failure.message, MAX_TEXT_BYTES) ||
    value.failure.message.length === 0 ||
    typeof value.failure.kind !== "string" ||
    !FAILURE_KINDS.has(value.failure.kind) ||
    !boundedText(value.lastStep, MAX_TEXT_BYTES) ||
    !optionalText(value.resumedJobId, 256) ||
    !(value.resumedAt === null || safeTimestamp(value.resumedAt))
  ) {
    throw new Error("The ingestion recovery manifest is invalid.");
  }
  const request = value.request;
  if (
    !optionalText(request.sourceLabel, 256) ||
    typeof request.isHandwriting !== "boolean" ||
    typeof request.parseWithVlm !== "boolean" ||
    typeof request.parseWithAnydoc !== "boolean" ||
    !isVlmOcrTask(request.vlmTask) ||
    typeof request.generateMap !== "boolean" ||
    !optionalText(request.model, 256)
  ) {
    throw new Error("The ingestion recovery request is invalid.");
  }
  return {
    protocolVersion: 1,
    recoveryId: value.recoveryId,
    gardenId: value.gardenId,
    userId: value.userId as number | null,
    filename: value.filename,
    mediaType: value.mediaType,
    sizeBytes: value.sizeBytes as number,
    sha256: value.sha256,
    request: {
      sourceLabel: request.sourceLabel,
      isHandwriting: request.isHandwriting,
      parseWithVlm: request.parseWithVlm,
      parseWithAnydoc: request.parseWithAnydoc,
      vlmTask: request.vlmTask,
      generateMap: request.generateMap,
      model: request.model,
    },
    failedJobId: value.failedJobId,
    failedAt: value.failedAt as number,
    failure: {
      message: value.failure.message,
      kind: value.failure.kind as "provider-quota" | "runtime",
    },
    lastStep: value.lastStep,
    resumedJobId: value.resumedJobId,
    resumedAt: value.resumedAt as number | null,
  };
}

export interface StoredIngestRecovery {
  readonly record: IngestRecoveryRecord;
  readonly directory: string;
  readonly sourcePath: string;
}

function readStored(
  gardenId: string,
  recoveryId: string,
  dataRoot: string,
): StoredIngestRecovery | null {
  if (!isIngestRecoveryId(recoveryId)) return null;
  const directory = path.join(ingestRecoveryRoot(gardenId, dataRoot), recoveryId);
  const manifestPath = path.join(directory, MANIFEST_FILE);
  const sourcePath = path.join(directory, SOURCE_FILE);
  let record: IngestRecoveryRecord;
  try {
    const manifestStat = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
    if (
      !manifestStat?.isFile() ||
      manifestStat.isSymbolicLink() ||
      manifestStat.size <= 0 ||
      manifestStat.size > MAX_MANIFEST_BYTES
    ) {
      return null;
    }
    record = parseIngestRecoveryManifest(
      JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    );
  } catch {
    return null;
  }
  if (record.recoveryId !== recoveryId || record.gardenId !== gardenId) return null;
  const sourceStat = fs.lstatSync(sourcePath, { throwIfNoEntry: false });
  if (
    !sourceStat?.isFile() ||
    sourceStat.isSymbolicLink() ||
    sourceStat.size !== record.sizeBytes
  ) {
    return null;
  }
  return { record, directory, sourcePath };
}

export function readIngestRecovery({
  gardenId,
  recoveryId,
  dataRoot = dashboardDataDir(),
}: {
  gardenId: string;
  recoveryId: string;
  dataRoot?: string;
}): StoredIngestRecovery | null {
  return readStored(gardenId, recoveryId, dataRoot);
}

/**
 * Every usable record for a garden, newest failure first. A record whose
 * manifest or retained bytes no longer validate, or that is older than the
 * retention window, is removed here rather than shown as something a person
 * could resume.
 */
export function listIngestRecoveries({
  gardenId,
  dataRoot = dashboardDataDir(),
  nowMs = Date.now(),
}: {
  gardenId: string;
  dataRoot?: string;
  nowMs?: number;
}): IngestRecoveryRecord[] {
  const root = ingestRecoveryRoot(gardenId, dataRoot);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const records: IngestRecoveryRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isIngestRecoveryId(entry.name)) continue;
    const stored = readStored(gardenId, entry.name, dataRoot);
    if (!stored || nowMs - stored.record.failedAt > INGEST_RECOVERY_RETENTION_MS) {
      // A record the worker is still writing has no manifest yet and is
      // younger than a minute; leave it alone.
      let directoryStat: fs.Stats | undefined;
      try {
        directoryStat = fs.statSync(path.join(root, entry.name));
      } catch {
        continue;
      }
      if (!stored && nowMs - directoryStat.mtimeMs < 60_000) continue;
      fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
      continue;
    }
    records.push(stored.record);
  }
  return records.sort((left, right) => right.failedAt - left.failedAt);
}

export function discardIngestRecovery({
  gardenId,
  recoveryId,
  dataRoot = dashboardDataDir(),
}: {
  gardenId: string;
  recoveryId: string;
  dataRoot?: string;
}): boolean {
  if (!isIngestRecoveryId(recoveryId)) return false;
  const directory = path.join(ingestRecoveryRoot(gardenId, dataRoot), recoveryId);
  if (!fs.existsSync(directory)) return false;
  fs.rmSync(directory, { recursive: true, force: true });
  return true;
}

/** Record which Runtime job is replaying this upload (or clear it). */
export function markIngestRecoveryResumed({
  gardenId,
  recoveryId,
  jobId,
  nowMs = Date.now(),
  dataRoot = dashboardDataDir(),
}: {
  gardenId: string;
  recoveryId: string;
  jobId: string | null;
  nowMs?: number;
  dataRoot?: string;
}): IngestRecoveryRecord | null {
  const stored = readStored(gardenId, recoveryId, dataRoot);
  if (!stored) return null;
  const next: IngestRecoveryRecord = {
    ...stored.record,
    resumedJobId: jobId,
    resumedAt: jobId ? nowMs : null,
  };
  const manifestPath = path.join(stored.directory, MANIFEST_FILE);
  const pending = `${manifestPath}.pending.${process.pid}`;
  fs.writeFileSync(pending, `${JSON.stringify(next)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(pending, manifestPath);
  return next;
}

export function publicIngestRecovery(record: IngestRecoveryRecord): PublicIngestRecovery {
  return {
    recoveryId: record.recoveryId,
    filename: record.filename,
    sizeBytes: record.sizeBytes,
    failedAt: record.failedAt,
    failure: record.failure,
    lastStep: record.lastStep,
    request: {
      parseWithVlm: record.request.parseWithVlm,
      parseWithAnydoc: record.request.parseWithAnydoc,
      isHandwriting: record.request.isHandwriting,
      generateMap: record.request.generateMap,
      model: record.request.model,
    },
    resumedJobId: record.resumedJobId,
  };
}
