import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { repositoryRoot } from "../runtime-paths.ts";
import {
  abandonRuntimeJobInput,
  cancelRuntimeJob,
  inspectRuntimeJob,
  readRuntimeJobOutput,
  reserveRuntimeJobInput,
  submitRuntimeJob,
  uploadRuntimeJobInput,
  type RuntimeJobAuthority,
  type RuntimeJobInput,
  type RuntimeJobInputReservation,
  type RuntimeJobOutput,
  type RuntimeJobSnapshot,
  type RuntimeJobSubmission,
} from "../supervisor-control.ts";

const PROTOCOL_VERSION = 1;
const JOB_TYPE = "watermark-operation";
const WORKER_KIND = "watermark-operation-node";
const RESOURCE_CLASS = "document-processing";
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_AUDIT_FILES = 10_000;
const MAX_REPORT_BYTES = 512 * 1024;
const MAX_HEADER_BYTES = 8 * 1024;
const POLL_MS = 100;
const SHA256 = /^[0-9a-f]{64}$/u;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const AUDIT_MAGIC = Buffer.from("BREADBOARD-WATERMARK-AUDIT-V1\n", "utf8");
const AUDIT_SKIP_DIRECTORIES = new Set([
  ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
  ".tox", ".mypy_cache", ".pytest_cache", "dist", "build", ".next", "target",
  ".cache", ".watermarks", ".officecli", ".breadboard",
]);

export interface WatermarkRuntimeScope {
  userId: number;
  gardenId: string | null;
  conversationId: string;
}

export interface WatermarkRuntimeControl {
  reserve(
    authority: RuntimeJobAuthority,
    request: Parameters<typeof reserveRuntimeJobInput>[1],
  ): Promise<RuntimeJobInputReservation>;
  upload(
    authority: RuntimeJobAuthority,
    reservation: RuntimeJobInputReservation,
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<RuntimeJobInput>;
  abandon(authority: RuntimeJobAuthority, uploadId: string): Promise<void>;
  submit(
    authority: RuntimeJobAuthority,
    submission: RuntimeJobSubmission,
  ): Promise<RuntimeJobSnapshot>;
  inspect(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
  readOutput(
    authority: RuntimeJobAuthority,
    jobId: string,
    kind: RuntimeJobOutput["kind"],
  ): Promise<RuntimeJobOutput>;
  cancel(authority: RuntimeJobAuthority, jobId: string): Promise<RuntimeJobSnapshot>;
}

const DEFAULT_CONTROL: WatermarkRuntimeControl = {
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export type WatermarkRuntimeRequest =
  | {
      protocolVersion: 1;
      operation: "inspect";
      mode: "auto" | "text";
      aggressive: boolean;
    }
  | {
      protocolVersion: 1;
      operation: "clean";
      mode: "auto" | "text";
      nfkc: boolean;
      aggressiveHomoglyphs: boolean;
      keepNonAiMetadata: boolean;
      strictExit: boolean;
    }
  | {
      protocolVersion: 1;
      operation: "audit";
      directory: string;
    };

export type WatermarkRuntimeResult =
  | {
      ok: true;
      operation: "inspect" | "audit";
      report: Record<string, unknown>;
      output: null;
    }
  | {
      ok: true;
      operation: "clean";
      report: Record<string, unknown>;
      output: { relativePath: string; sizeBytes: number; sha256: string };
    }
  | {
      ok: false;
      operation: "clean";
      errorCode: string;
      message: string;
      report: null;
      output: null;
    };

interface AuditFileEntry {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  header: Buffer;
  dev: number;
  ino: number;
  mtimeMs: number;
}

interface AuditSkippedEntry {
  header: Buffer;
}

interface AuditBundle {
  sizeBytes: number;
  entries: Array<AuditFileEntry | AuditSkippedEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function boundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes && !/\p{Cc}/u.test(value);
}

function authority(scope: WatermarkRuntimeScope): RuntimeJobAuthority {
  if (
    !Number.isSafeInteger(scope.userId) || scope.userId < 1 ||
    !(scope.gardenId === null || boundedText(scope.gardenId, 256)) ||
    !boundedText(scope.conversationId, 256)
  ) throw new TypeError("Watermark Runtime scope is invalid.");
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function assertJob(job: RuntimeJobSnapshot, expected: RuntimeJobAuthority): void {
  if (
    job.jobType !== JOB_TYPE || job.workerKind !== WORKER_KIND ||
    job.resourceClass !== RESOURCE_CLASS || job.gardenId !== expected.gardenId ||
    job.conversationId !== expected.conversationId
  ) throw new Error("Runtime returned a job outside the watermark contract.");
}

function directFile(candidate: string): boolean {
  try {
    const metadata = fs.lstatSync(candidate);
    const canonical = fs.realpathSync.native(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() && samePath(canonical, candidate);
  } catch {
    return false;
  }
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function pathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

function runtimeDataRoot(): string {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : repositoryRoot();
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    timer.unref?.();
    const abort = () => done(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    function done(error?: unknown): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function waitForJob(
  control: WatermarkRuntimeControl,
  jobAuthority: RuntimeJobAuthority,
  initial: RuntimeJobSnapshot,
  signal?: AbortSignal,
): Promise<RuntimeJobSnapshot> {
  let job = initial;
  const deadline = Date.now() + 165_000;
  assertJob(job, jobAuthority);
  while (!TERMINAL_STATES.has(job.state)) {
    if (Date.now() >= deadline) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw new Error("Watermark Runtime work timed out.");
    }
    await delay(POLL_MS, signal);
    job = await control.inspect(jobAuthority, job.jobId);
    assertJob(job, jobAuthority);
  }
  return job;
}

function parseResult(job: RuntimeJobSnapshot, content: unknown): WatermarkRuntimeResult {
  if (
    !isRecord(content) || !exactKeys(content, [
      "protocolVersion", "identity", "completionSequence", "result",
    ]) || content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) || !exactKeys(content.identity, [
      "jobId", "attempt", "workerInstanceId",
    ]) || content.identity.jobId !== job.jobId || content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId || !isRecord(content.result)
  ) throw new Error("Runtime returned an unfenced watermark result.");
  const result = content.result;
  if (result.ok === false) {
    if (
      !exactKeys(result, [
        "ok", "operation", "errorCode", "message", "report", "output",
      ]) || result.operation !== "clean" || !boundedText(result.errorCode, 128) ||
      !boundedText(result.message, 4_096) || result.report !== null || result.output !== null
    ) throw new Error("Runtime returned an invalid watermark failure.");
    return result as WatermarkRuntimeResult;
  }
  if (
    result.ok !== true || !exactKeys(result, ["ok", "operation", "report", "output"]) ||
    !["inspect", "clean", "audit"].includes(String(result.operation)) ||
    !isRecord(result.report) ||
    Buffer.byteLength(JSON.stringify(result.report), "utf8") > MAX_REPORT_BYTES
  ) throw new Error("Runtime returned an invalid watermark result.");
  if (result.operation !== "clean") {
    if (result.output !== null) throw new Error("Runtime returned an unexpected watermark output.");
    return result as WatermarkRuntimeResult;
  }
  if (
    !isRecord(result.output) || !exactKeys(result.output, ["relativePath", "sizeBytes", "sha256"]) ||
    !boundedText(result.output.relativePath, 2_048) ||
    !Number.isSafeInteger(result.output.sizeBytes) || Number(result.output.sizeBytes) < 1 ||
    Number(result.output.sizeBytes) > MAX_FILE_BYTES ||
    typeof result.output.sha256 !== "string" || !SHA256.test(result.output.sha256)
  ) throw new Error("Runtime returned an invalid watermark output receipt.");
  return result as WatermarkRuntimeResult;
}

function safeDisplayName(sourcePath: string): string {
  const extension = path.extname(sourcePath).toLowerCase();
  return `watermark-input${/^\.[a-z0-9]{1,12}$/u.test(extension) ? extension : ".bin"}`;
}

function fourByteLength(size: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(size, 0);
  return bytes;
}

function auditHeader(value: Record<string, unknown>): Buffer {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_HEADER_BYTES) {
    throw new Error("A watermark audit path is too long.");
  }
  return Buffer.concat([fourByteLength(bytes.byteLength), bytes]);
}

function safeAuditRelativePath(root: string, file: string): string {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const parts = relative.split("/");
  if (
    !relative || relative.startsWith("../") || path.posix.isAbsolute(relative) ||
    Buffer.byteLength(relative, "utf8") > 1_024 ||
    parts.some((part) => !part || part === "." || part === ".." || /\p{Cc}/u.test(part))
  ) throw new Error("A watermark audit path escaped its workspace.");
  return relative;
}

async function collectAuditBundle(root: string, signal?: AbortSignal): Promise<AuditBundle> {
  const canonicalRoot = await fsp.realpath(path.resolve(root));
  const rootMetadata = await fsp.lstat(canonicalRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || !samePath(canonicalRoot, root)) {
    throw new Error("The watermark audit root must be a direct directory.");
  }
  const entries: Array<AuditFileEntry | AuditSkippedEntry> = [];
  let sizeBytes = AUDIT_MAGIC.byteLength + 4;
  let seen = 0;
  const walk = async (directory: string): Promise<void> => {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const children = await fsp.readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const candidate = path.join(directory, child.name);
      if (child.isDirectory()) {
        if (!child.isSymbolicLink() && !child.name.startsWith(".") &&
            !AUDIT_SKIP_DIRECTORIES.has(child.name)) await walk(candidate);
        continue;
      }
      const relativePath = safeAuditRelativePath(canonicalRoot, candidate);
      if (++seen > MAX_AUDIT_FILES) throw new Error("The watermark audit exceeded its file-count bound.");
      let metadata: fs.Stats;
      try {
        metadata = await fsp.lstat(candidate);
      } catch (error) {
        const header = auditHeader({
          path: relativePath,
          skipReason: error instanceof Error ? error.message.slice(0, 200) : "unreadable",
        });
        entries.push({ header });
        sizeBytes += header.byteLength;
        continue;
      }
      if (!metadata.isFile() || metadata.isSymbolicLink() || !pathWithin(canonicalRoot, candidate)) {
        const header = auditHeader({ path: relativePath, skipReason: "indirect file" });
        entries.push({ header });
        sizeBytes += header.byteLength;
        continue;
      }
      if (metadata.size > MAX_FILE_BYTES) {
        const header = auditHeader({ path: relativePath, skipReason: "too large" });
        entries.push({ header });
        sizeBytes += header.byteLength;
        continue;
      }
      const header = auditHeader({ path: relativePath, sizeBytes: metadata.size });
      entries.push({
        absolutePath: candidate,
        relativePath,
        sizeBytes: metadata.size,
        header,
        dev: metadata.dev,
        ino: metadata.ino,
        mtimeMs: metadata.mtimeMs,
      });
      sizeBytes += header.byteLength + metadata.size;
      if (sizeBytes > MAX_BUNDLE_BYTES) {
        throw new Error("The watermark audit exceeded its streamed-byte bound.");
      }
    }
  };
  await walk(canonicalRoot);
  return { sizeBytes, entries };
}

function isAuditFileEntry(value: AuditFileEntry | AuditSkippedEntry): value is AuditFileEntry {
  return "absolutePath" in value;
}

async function* auditBundleStream(bundle: AuditBundle, signal?: AbortSignal): AsyncGenerator<Buffer> {
  yield AUDIT_MAGIC;
  for (const entry of bundle.entries) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    yield entry.header;
    if (!isAuditFileEntry(entry)) continue;
    let bytesRead = 0;
    const stream = fs.createReadStream(entry.absolutePath, { highWaterMark: 1024 * 1024 });
    const abort = () => stream.destroy(
      signal?.reason ?? new DOMException("Aborted", "AbortError"),
    );
    signal?.addEventListener("abort", abort, { once: true });
    try {
      for await (const chunk of stream) {
        bytesRead += chunk.byteLength;
        if (bytesRead > entry.sizeBytes) throw new Error("A watermark audit file changed while uploaded.");
        yield chunk as Buffer;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
    }
    const after = await fsp.lstat(entry.absolutePath);
    if (
      bytesRead !== entry.sizeBytes || !after.isFile() || after.isSymbolicLink() ||
      after.size !== entry.sizeBytes || after.dev !== entry.dev || after.ino !== entry.ino ||
      after.mtimeMs !== entry.mtimeMs
    ) throw new Error("A watermark audit file changed while uploaded.");
  }
  yield fourByteLength(0);
}

async function hashFile(file: string): Promise<{ sizeBytes: number; sha256: string }> {
  const before = await fsp.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error("Watermark output is indirect.");
  const hash = createHash("sha256");
  let sizeBytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += bytes.byteLength;
      hash.update(bytes);
    });
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  const after = await fsp.lstat(file);
  if (
    sizeBytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
    after.dev !== before.dev || after.ino !== before.ino
  ) throw new Error("Watermark output changed while verified.");
  return { sizeBytes, sha256: hash.digest("hex") };
}

function expectedWorkspace(job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) throw new Error("The watermark worker has no identity fence.");
  return path.resolve(
    runtimeDataRoot(), "runtime", "jobs", job.jobId, "attempts", String(job.attempt),
    job.workerInstanceId, "workspace",
  );
}

async function materializeOutput(
  job: RuntimeJobSnapshot,
  receipt: Extract<WatermarkRuntimeResult, { ok: true; operation: "clean" }>["output"],
  destination: string,
): Promise<void> {
  const source = path.resolve(runtimeDataRoot(), ...receipt.relativePath.split("/"));
  const workspace = expectedWorkspace(job);
  if (
    receipt.relativePath.includes("\\") || !pathWithin(workspace, source) ||
    !/^cleaned\.[a-z0-9]{1,12}$/u.test(path.basename(source)) || !directFile(source)
  ) throw new Error("Runtime returned a watermark output outside its worker fence.");
  const verified = await hashFile(source);
  if (verified.sizeBytes !== receipt.sizeBytes || verified.sha256 !== receipt.sha256) {
    throw new Error("Runtime watermark output does not match its receipt.");
  }
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const pending = `${destination}.runtime-${randomUUID()}.tmp`;
  try {
    await fsp.copyFile(source, pending, fs.constants.COPYFILE_EXCL);
    const copied = await hashFile(pending);
    if (copied.sizeBytes !== receipt.sizeBytes || copied.sha256 !== receipt.sha256) {
      throw new Error("The materialized watermark output changed while copied.");
    }
    await fsp.rm(destination, { force: true });
    await fsp.rename(pending, destination);
  } finally {
    await fsp.rm(pending, { force: true });
  }
}

function cleanWorkerWorkspace(job: RuntimeJobSnapshot): void {
  if (!job.workerInstanceId) return;
  const workspace = expectedWorkspace(job);
  if (!pathWithin(path.join(runtimeDataRoot(), "runtime", "jobs"), workspace)) return;
  fs.rmSync(workspace, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 100,
  });
}

export async function runWatermarkOperationViaRuntime(input: {
  scope: WatermarkRuntimeScope;
  request: WatermarkRuntimeRequest;
  sourcePath?: string;
  auditRoot?: string;
  outputPath?: string;
  signal?: AbortSignal;
  control?: WatermarkRuntimeControl;
}): Promise<WatermarkRuntimeResult> {
  const jobAuthority = authority(input.scope);
  const control = input.control ?? DEFAULT_CONTROL;
  let displayName: string;
  let mediaType: string;
  let declaredSizeBytes: number;
  let body: ReadableStream<Uint8Array>;
  if (input.request.operation === "audit") {
    if (!input.auditRoot || input.sourcePath || input.outputPath) {
      throw new TypeError("A watermark audit requires exactly one directory bundle.");
    }
    const bundle = await collectAuditBundle(input.auditRoot, input.signal);
    displayName = "watermark-audit.bundle";
    mediaType = "application/x-breadboard-watermark-audit-v1";
    declaredSizeBytes = bundle.sizeBytes;
    body = Readable.toWeb(Readable.from(auditBundleStream(bundle, input.signal))) as
      ReadableStream<Uint8Array>;
  } else {
    if (!input.sourcePath || input.auditRoot) {
      throw new TypeError("A watermark file operation requires exactly one source file.");
    }
    const metadata = await fsp.lstat(input.sourcePath);
    if (
      !metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 ||
      metadata.size > MAX_FILE_BYTES || !samePath(await fsp.realpath(input.sourcePath), input.sourcePath)
    ) throw new TypeError("The watermark source is not a bounded direct file.");
    displayName = safeDisplayName(input.sourcePath);
    mediaType = "application/octet-stream";
    declaredSizeBytes = metadata.size;
    body = Readable.toWeb(fs.createReadStream(input.sourcePath, { highWaterMark: 1024 * 1024 })) as
      ReadableStream<Uint8Array>;
  }

  const reservation = await control.reserve(jobAuthority, {
    gardenId: jobAuthority.gardenId,
    conversationId: jobAuthority.conversationId,
    displayName,
    mediaType,
    declaredSizeBytes,
  });
  let submitted = false;
  let job: RuntimeJobSnapshot | null = null;
  try {
    const uploaded = await control.upload(jobAuthority, reservation, body, input.signal);
    const idempotencyKey = `watermark-v2:${createHash("sha256")
      .update(`${input.scope.userId}:${input.scope.conversationId}:${randomUUID()}`, "utf8")
      .digest("hex")}`;
    job = await control.submit(jobAuthority, {
      jobType: JOB_TYPE,
      idempotencyKey,
      inputUploads: [{ uploadId: uploaded.uploadId }],
      requestPayload: input.request,
    });
    submitted = true;
    job = await waitForJob(control, jobAuthority, job, input.signal);
    if (job.state !== "succeeded") {
      throw new Error(job.failureMessage ?? `Watermark Runtime work ended as ${job.state}.`);
    }
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    const result = parseResult(job, output.content);
    if (result.ok && result.operation === "clean") {
      if (!input.outputPath) throw new Error("Watermark cleaning has no materialization target.");
      await materializeOutput(job, result.output, input.outputPath);
    } else if (input.outputPath) {
      throw new Error("Watermark Runtime returned no cleaned output.");
    }
    return result;
  } catch (error) {
    if (job && !TERMINAL_STATES.has(job.state)) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
    }
    throw error;
  } finally {
    if (!submitted) {
      await control.abandon(jobAuthority, reservation.uploadId).catch(() => undefined);
    }
    if (job?.workerInstanceId) cleanWorkerWorkspace(job);
  }
}

export async function inspectWatermarkViaRuntime(input: {
  scope: WatermarkRuntimeScope;
  sourcePath: string;
  mode: "auto" | "text";
  aggressive: boolean;
  signal?: AbortSignal;
  control?: WatermarkRuntimeControl;
}): Promise<Record<string, unknown>> {
  const result = await runWatermarkOperationViaRuntime({
    ...input,
    request: {
      protocolVersion: PROTOCOL_VERSION,
      operation: "inspect",
      mode: input.mode,
      aggressive: input.aggressive,
    },
  });
  if (!result.ok || result.operation !== "inspect") throw new Error("Watermark inspection failed.");
  return result.report;
}

export async function cleanWatermarkViaRuntime(input: {
  scope: WatermarkRuntimeScope;
  sourcePath: string;
  outputPath: string;
  mode: "auto" | "text";
  nfkc?: boolean;
  aggressiveHomoglyphs?: boolean;
  keepNonAiMetadata?: boolean;
  strictExit?: boolean;
  signal?: AbortSignal;
  control?: WatermarkRuntimeControl;
}): Promise<WatermarkRuntimeResult> {
  return await runWatermarkOperationViaRuntime({
    ...input,
    request: {
      protocolVersion: PROTOCOL_VERSION,
      operation: "clean",
      mode: input.mode,
      nfkc: input.nfkc === true,
      aggressiveHomoglyphs: input.aggressiveHomoglyphs === true,
      keepNonAiMetadata: input.keepNonAiMetadata === true,
      strictExit: input.strictExit === true,
    },
  });
}

export async function auditWatermarksViaRuntime(input: {
  scope: WatermarkRuntimeScope;
  auditRoot: string;
  directory: string;
  signal?: AbortSignal;
  control?: WatermarkRuntimeControl;
}): Promise<Record<string, unknown>> {
  const result = await runWatermarkOperationViaRuntime({
    ...input,
    request: {
      protocolVersion: PROTOCOL_VERSION,
      operation: "audit",
      directory: input.directory,
    },
  });
  if (!result.ok || result.operation !== "audit") throw new Error("Watermark audit failed.");
  return result.report;
}
