if (typeof window !== "undefined") {
  throw new Error("Runtime V2 office control is server-only.");
}

import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import { externalRuntimePath as path } from "../external-runtime-path.ts";
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
import { repositoryRoot } from "../runtime-paths.ts";
import {
  describeOfficeExport,
  OfficeCliError,
  OFFICE_RUN_TIMEOUT_MS,
  containWorkspacePath,
  resolveOfficeCli,
  validateOfficeCommand,
  type OfficeExportStaging,
  type OfficeRunResult,
} from "./contract.ts";

const PROTOCOL_VERSION = 1;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const OFFICE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".pdf": "application/pdf",
};
const MAX_OFFICE_EXPORT_BYTES = 128 * 1024 * 1024;
const MAX_OFFICE_PREVIEW_BYTES = 16 * 1024 * 1024;

export interface RuntimeV2OfficeScope {
  readonly userId: number;
  readonly gardenId: string | null;
  /** Canonical Breadboard conversation public id, or null for user-global uploads. */
  readonly conversationId: string | null;
}

export interface RuntimeV2OfficeCommandScope extends RuntimeV2OfficeScope {
  readonly conversationId: string;
  readonly runtimeSessionId: number;
}

/**
 * Explicit Runtime control seam used by protocol-faithful tests. Product
 * callers omit it and therefore always use the Rust-owned supervisor control
 * plane; this interface is not a local execution fallback.
 */
export interface RuntimeV2OfficeControl {
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

const DEFAULT_CONTROL: RuntimeV2OfficeControl = {
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

export interface RuntimeV2OfficeExecutionOptions {
  idempotencySeed?: string | null;
  signal?: AbortSignal;
  control?: RuntimeV2OfficeControl;
}

interface RuntimeOfficeEnvelope {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly identity: {
    readonly jobId: string;
    readonly attempt: number;
    readonly workerInstanceId: string;
  };
  readonly completionSequence: number;
  readonly result: Record<string, unknown>;
}

function authority(scope: RuntimeV2OfficeScope): RuntimeJobAuthority {
  if (!Number.isSafeInteger(scope.userId) || scope.userId < 1) {
    throw new TypeError("Office runtime user scope is invalid.");
  }
  if (scope.gardenId !== null && !scope.gardenId.trim()) {
    throw new TypeError("Office runtime Garden scope is invalid.");
  }
  if (scope.conversationId !== null && !scope.conversationId.trim()) {
    throw new TypeError("Office runtime conversation scope is invalid.");
  }
  return {
    userId: scope.userId,
    gardenId: scope.gardenId,
    conversationId: scope.conversationId,
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function runtimeDataRoot(): string {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : repositoryRoot();
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32"
    ? path.toNamespacedPath(a).toLowerCase() === path.toNamespacedPath(b).toLowerCase()
    : a === b;
}

function resolveRuntimeOutputPath(
  job: RuntimeJobSnapshot,
  relativePath: unknown,
  expectedRelativePath: string | null,
): string {
  if (
    typeof relativePath !== "string" ||
    relativePath.includes("\\") ||
    relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Runtime returned an invalid Office staging path.");
  }
  const expectedPrefix = [
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "office-stage",
  ].join("/");
  if (!relativePath.startsWith(`${expectedPrefix}/`)) {
    throw new Error("Runtime returned an Office path outside its fenced attempt.");
  }
  const root = runtimeDataRoot();
  const resolved = path.resolve(root, ...relativePath.split("/"));
  if (expectedRelativePath !== null) {
    if (
      !expectedRelativePath ||
      expectedRelativePath.includes("\\") ||
      expectedRelativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error("Runtime Office staging expectation is invalid.");
    }
    const expected = path.resolve(
      root,
      ...expectedPrefix.split("/"),
      ...expectedRelativePath.split("/"),
    );
    if (!samePath(resolved, expected)) {
      throw new Error("Runtime returned an unexpected Office staging filename.");
    }
  }
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error("Runtime Office staging output is unavailable.");
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    throw new Error("Runtime Office staging output is indirect.");
  }
  return canonical;
}

function validateEnvelope(
  job: RuntimeJobSnapshot,
  content: unknown,
): RuntimeOfficeEnvelope {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Runtime returned an invalid Office result.");
  }
  const envelope = content as Record<string, unknown>;
  const identity = envelope.identity;
  if (
    Object.keys(envelope).sort().join(",") !==
      "completionSequence,identity,protocolVersion,result" ||
    envelope.protocolVersion !== PROTOCOL_VERSION ||
    !Number.isSafeInteger(envelope.completionSequence) ||
    envelope.completionSequence !== job.lastWorkerSequence ||
    !identity ||
    typeof identity !== "object" ||
    Array.isArray(identity) ||
    Object.keys(identity).sort().join(",") !== "attempt,jobId,workerInstanceId" ||
    (identity as Record<string, unknown>).jobId !== job.jobId ||
    (identity as Record<string, unknown>).attempt !== job.attempt ||
    (identity as Record<string, unknown>).workerInstanceId !== job.workerInstanceId ||
    !envelope.result ||
    typeof envelope.result !== "object" ||
    Array.isArray(envelope.result)
  ) {
    throw new Error("Runtime returned an Office result outside its worker fence.");
  }
  return envelope as unknown as RuntimeOfficeEnvelope;
}

function isOfficeJob(job: RuntimeJobSnapshot, jobAuthority: RuntimeJobAuthority): boolean {
  return (
    job.jobType === "office-artifact" &&
    job.workerKind === "office-artifact-node" &&
    job.resourceClass === "document-processing" &&
    job.gardenId === jobAuthority.gardenId &&
    job.conversationId === jobAuthority.conversationId
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForOfficeJob(
  control: RuntimeV2OfficeControl,
  jobAuthority: RuntimeJobAuthority,
  initialJob: RuntimeJobSnapshot,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ job: RuntimeJobSnapshot; envelope: RuntimeOfficeEnvelope }> {
  if (!isOfficeJob(initialJob, jobAuthority)) {
    throw new Error("Runtime returned a job outside the Office worker contract.");
  }
  const deadline = Date.now() + timeoutMs;
  let job = initialJob;
  while (!TERMINAL_STATES.has(job.state)) {
    if (signal?.aborted) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    if (Date.now() >= deadline) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw new OfficeCliError(504, "office_runtime_timeout", "The Office operation timed out and was stopped.");
    }
    await delay(150);
    job = await control.inspect(jobAuthority, job.jobId);
    if (!isOfficeJob(job, jobAuthority)) {
      throw new Error("Runtime returned a job outside the Office worker contract.");
    }
  }
  if (job.state !== "succeeded") {
    const status = job.state === "cancelled" ? 499 : job.state === "resource_exhausted" ? 503 : 500;
    const code = job.state === "cancelled"
      ? "office_runtime_cancelled"
      : job.state === "resource_exhausted"
        ? "office_runtime_resource_exhausted"
        : "office_runtime_failed";
    throw new OfficeCliError(status, code, job.failureMessage ?? `The Office operation ended as ${job.state}.`);
  }
  const output = await control.readOutput(jobAuthority, job.jobId, "result");
  return { job, envelope: validateEnvelope(job, output.content) };
}

function boundedCommand(args: Record<string, unknown>): string {
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (!command) {
    throw new OfficeCliError(
      400,
      "office_command_required",
      "Pass the OfficeCLI command to run, e.g. `create report.docx` or `help docx paragraph`.",
    );
  }
  if (command.length > 20_000) {
    throw new OfficeCliError(400, "office_command_too_long", "The command exceeds 20,000 characters.");
  }
  return command;
}

interface OfficeOperationInput {
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly open: () => ReadableStream<Uint8Array>;
}

interface OfficeOperationCompletion {
  readonly authority: RuntimeJobAuthority;
  readonly job: RuntimeJobSnapshot;
  readonly envelope: RuntimeOfficeEnvelope;
}

function directFileInput(
  filePath: string,
  displayName = path.basename(filePath),
  mediaType = "application/octet-stream",
): OfficeOperationInput {
  const resolved = path.resolve(filePath);
  const metadata = fs.lstatSync(resolved);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_OFFICE_EXPORT_BYTES
  ) {
    throw new OfficeCliError(413, "office_input_invalid", "The Office input is empty or exceeds 128 MiB.");
  }
  const canonical = fs.realpathSync.native(resolved);
  if (!samePath(canonical, resolved)) {
    throw new OfficeCliError(403, "office_input_indirect", "The Office input must be a direct file.");
  }
  return {
    displayName,
    mediaType,
    sizeBytes: metadata.size,
    open: () => Readable.toWeb(fs.createReadStream(canonical)) as ReadableStream<Uint8Array>,
  };
}

function bytesInput(
  bytes: Uint8Array,
  displayName: string,
  mediaType: string,
): OfficeOperationInput {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_OFFICE_EXPORT_BYTES) {
    throw new OfficeCliError(413, "office_input_invalid", "The Office input is empty or exceeds 128 MiB.");
  }
  const sealed = Buffer.from(bytes);
  return {
    displayName,
    mediaType,
    sizeBytes: sealed.byteLength,
    open: () => Readable.toWeb(Readable.from([sealed])) as ReadableStream<Uint8Array>,
  };
}

async function runOfficeInputOperation(
  scope: RuntimeV2OfficeScope,
  inputs: readonly OfficeOperationInput[],
  requestPayload: Record<string, unknown>,
  options: {
    idempotencyNamespace: string;
    idempotencySeed?: string | null;
    timeoutMs: number;
    signal?: AbortSignal;
    control?: RuntimeV2OfficeControl;
  },
): Promise<OfficeOperationCompletion> {
  const jobAuthority = authority(scope);
  const control = options.control ?? DEFAULT_CONTROL;
  const reservations: Array<{
    reservation: RuntimeJobInputReservation;
    input: OfficeOperationInput;
  }> = [];
  let submitted = false;
  try {
    for (const input of inputs) {
      const reservation = await control.reserve(jobAuthority, {
        gardenId: jobAuthority.gardenId,
        conversationId: jobAuthority.conversationId,
        displayName: input.displayName,
        mediaType: input.mediaType,
        declaredSizeBytes: input.sizeBytes,
      });
      reservations.push({ reservation, input });
    }
    const uploaded = [];
    for (const { reservation, input } of reservations) {
      uploaded.push(await control.upload(
        jobAuthority,
        reservation,
        input.open(),
        options.signal,
      ));
    }
    const job = await control.submit(jobAuthority, {
      jobType: "office-artifact",
      idempotencyKey: `${options.idempotencyNamespace}:${digest({
        scope: jobAuthority,
        requestPayload,
        inputs: uploaded.map(({ sha256, sizeBytes, displayName, mediaType }) => ({
          sha256,
          sizeBytes,
          displayName,
          mediaType,
        })),
        seed: options.idempotencySeed?.trim() || null,
      })}`,
      inputUploads: uploaded.map(({ uploadId }) => ({ uploadId })),
      requestPayload,
    });
    submitted = true;
    const completed = await waitForOfficeJob(
      control,
      jobAuthority,
      job,
      options.timeoutMs,
      options.signal,
    );
    return { authority: jobAuthority, ...completed };
  } finally {
    if (!submitted) {
      await Promise.all(reservations.map(({ reservation }) =>
        control.abandon(jobAuthority, reservation.uploadId).catch(() => undefined)));
    }
  }
}

function runtimeStageDirectory(job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) {
    throw new Error("A completed Office job has no worker instance authority.");
  }
  const root = runtimeDataRoot();
  return path.resolve(
    root,
    "runtime",
    "jobs",
    job.jobId,
    "attempts",
    String(job.attempt),
    job.workerInstanceId,
    "workspace",
    "office-stage",
  );
}

function cleanupRuntimeStage(job: RuntimeJobSnapshot): void {
  fs.rmSync(runtimeStageDirectory(job), {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 10 : 0,
    retryDelay: 100,
  });
}

function readRuntimeStageJson<T>(
  completed: OfficeOperationCompletion,
  relativePath: unknown,
  maximumBytes = 128 * 1024 * 1024,
): T {
  const filePath = resolveRuntimeOutputPath(completed.job, relativePath, "operation.json");
  const metadata = fs.statSync(filePath);
  if (metadata.size < 1 || metadata.size > maximumBytes) {
    throw new Error("Runtime Office operation data exceeds its bound.");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function requiredConversationScope(scope: RuntimeV2OfficeScope): asserts scope is RuntimeV2OfficeScope & {
  conversationId: string;
} {
  if (scope.conversationId === null || !scope.conversationId.trim()) {
    throw new TypeError("Office artifact operations require exact conversation scope.");
  }
}

export async function runOfficeCommandViaRuntime(
  scope: RuntimeV2OfficeCommandScope,
  workspace: string,
  args: Record<string, unknown>,
  options: {
    idempotencySeed?: string | null;
    signal?: AbortSignal;
    control?: RuntimeV2OfficeControl;
  } = {},
): Promise<OfficeRunResult> {
  const command = boundedCommand(args);
  if (!resolveOfficeCli()) {
    throw new OfficeCliError(
      503,
      "officecli_unavailable",
      "OfficeCLI 1.0.143 is not installed. Run `npm run setup:officecli` from the repository root.",
    );
  }
  // Preserve the established synchronous validation errors at the route
  // boundary; the independently launched worker repeats the same validation.
  validateOfficeCommand(command, workspace);
  if (!Number.isSafeInteger(scope.runtimeSessionId) || scope.runtimeSessionId < 1) {
    throw new TypeError("Office runtime session scope is invalid.");
  }
  const jobAuthority = authority(scope);
  const control = options.control ?? DEFAULT_CONTROL;
  const idempotencySeed = options.idempotencySeed?.trim() || randomUUID();
  const job = await control.submit(jobAuthority, {
    jobType: "office-artifact",
    idempotencyKey: `office-command-v2:${digest({
      scope: jobAuthority,
      runtimeSessionId: scope.runtimeSessionId,
      command,
      idempotencySeed,
    })}`,
    requestPayload: {
      operation: "command",
      runtimeSessionId: scope.runtimeSessionId,
      command,
    },
  });
  const completed = await waitForOfficeJob(
    control,
    jobAuthority,
    job,
    OFFICE_RUN_TIMEOUT_MS + 2 * 60_000,
    options.signal,
  );
  const result = completed.envelope.result;
  if (
    Object.keys(result).sort().join(",") !==
      "command,exitCode,file,operation,output,timedOut,truncated" ||
    result.operation !== "command" ||
    result.command !== command ||
    !Number.isSafeInteger(result.exitCode) ||
    typeof result.output !== "string" ||
    typeof result.truncated !== "boolean" ||
    typeof result.timedOut !== "boolean" ||
    (result.file !== null && typeof result.file !== "string")
  ) {
    throw new Error("Runtime returned an invalid Office command result.");
  }
  return {
    command,
    exitCode: result.exitCode as number,
    output: result.output,
    truncated: result.truncated,
    timedOut: result.timedOut,
    file: result.file as string | null,
  };
}

export async function prepareOfficeExportViaRuntime(
  scope: RuntimeV2OfficeScope,
  workspace: string,
  args: Record<string, unknown>,
  options: {
    idempotencySeed?: string | null;
    signal?: AbortSignal;
    control?: RuntimeV2OfficeControl;
  } = {},
): Promise<OfficeExportStaging> {
  requiredConversationScope(scope);
  const described = describeOfficeExport(workspace, args);
  const metadata = fs.lstatSync(described.filePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > MAX_OFFICE_EXPORT_BYTES
  ) {
    throw new OfficeCliError(
      413,
      "office_export_too_large",
      "The Office export is empty or exceeds 128 MiB.",
    );
  }
  const jobAuthority = authority(scope);
  const control = options.control ?? DEFAULT_CONTROL;
  const extension = path.extname(described.filename).toLowerCase();
  const reservation = await control.reserve(jobAuthority, {
    gardenId: jobAuthority.gardenId,
    conversationId: jobAuthority.conversationId,
    displayName: described.filename,
    mediaType: OFFICE_MIME_TYPES[extension] ?? "application/octet-stream",
    declaredSizeBytes: metadata.size,
  });
  let submitted = false;
  try {
    const stream = fs.createReadStream(described.filePath);
    const input = await control.upload(
      jobAuthority,
      reservation,
      Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      options.signal,
    );
    const job = await control.submit(jobAuthority, {
      jobType: "office-artifact",
      idempotencyKey: `office-export-v2:${digest({
        scope: jobAuthority,
        relativeFile: described.relativeFile,
        title: described.title,
        filename: described.filename,
        sha256: input.sha256,
        idempotencySeed: options.idempotencySeed?.trim() || null,
      })}`,
      inputUploads: [{ uploadId: input.uploadId }],
      requestPayload: {
        operation: "export",
        relativeFile: described.relativeFile,
        title: described.title,
      },
    });
    submitted = true;
    const completed = await waitForOfficeJob(
      control,
      jobAuthority,
      job,
      4 * 60_000,
      options.signal,
    );
    const result = completed.envelope.result;
    if (
      Object.keys(result).sort().join(",") !==
        "filename,kind,operation,outputRelativePath,previewRelativePath,relativeFile,title" ||
      result.operation !== "export" ||
      result.relativeFile !== described.relativeFile ||
      result.kind !== described.kind ||
      result.title !== described.title ||
      result.filename !== described.filename ||
      typeof result.outputRelativePath !== "string" ||
      (result.previewRelativePath !== null && typeof result.previewRelativePath !== "string")
    ) {
      throw new Error("Runtime returned an invalid Office export result.");
    }
    const filePath = resolveRuntimeOutputPath(
      completed.job,
      result.outputRelativePath,
      described.filename,
    );
    const previewFilePath = result.previewRelativePath === null
      ? null
      : resolveRuntimeOutputPath(completed.job, result.previewRelativePath, "preview.html");
    if (
      fs.statSync(filePath).size > MAX_OFFICE_EXPORT_BYTES ||
      (previewFilePath && fs.statSync(previewFilePath).size > MAX_OFFICE_PREVIEW_BYTES)
    ) {
      throw new Error("Runtime Office staging output exceeds its bound.");
    }
    const stageDirectory = path.dirname(filePath);
    let cleaned = false;
    return {
      ...described,
      filePath,
      previewFilePath,
      cleanup: () => {
        if (cleaned) return;
        cleaned = true;
        fs.rmSync(stageDirectory, {
          recursive: true,
          force: true,
          maxRetries: process.platform === "win32" ? 10 : 0,
          retryDelay: 100,
        });
      },
    };
  } finally {
    if (!submitted) {
      await control.abandon(jobAuthority, reservation.uploadId).catch(() => undefined);
    }
  }
}

function workspaceInput(
  workspace: string,
  rawFile: unknown,
  extensions: readonly string[],
): { filePath: string; relativeFile: string; extension: string } {
  const file = typeof rawFile === "string" ? rawFile.trim() : "";
  const filePath = containWorkspacePath(workspace, file, "The document path");
  const extension = path.extname(filePath).toLowerCase();
  if (!extensions.includes(extension)) {
    throw new OfficeCliError(
      400,
      "document_format_unsupported",
      `This operation accepts ${extensions.join(" or ")} files.`,
    );
  }
  return {
    filePath,
    relativeFile: path.relative(workspace, filePath).split(path.sep).join("/"),
    extension,
  };
}

function boundedNullableText(value: unknown, maximumCharacters: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (normalized.length > maximumCharacters || normalized.includes("\0")) {
    throw new OfficeCliError(400, "office_text_too_long", `The Office value exceeds ${maximumCharacters} characters.`);
  }
  return normalized;
}

function sealedPatches(value: unknown, maximumPatches: number): Uint8Array {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumPatches) {
    throw new OfficeCliError(400, "document_patches_invalid", `Patches must contain 1 to ${maximumPatches} edits.`);
  }
  const patches = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new OfficeCliError(400, "document_patch_invalid", `Patch ${index + 1} is invalid.`);
    }
    const patch = entry as Record<string, unknown>;
    if (
      typeof patch.anchor !== "string" ||
      !patch.anchor.trim() ||
      typeof patch.text !== "string" ||
      patch.text.length > 100_000 ||
      patch.text.includes("\0")
    ) {
      throw new OfficeCliError(400, "document_patch_invalid", `Patch ${index + 1} is invalid.`);
    }
    return { anchor: patch.anchor, text: patch.text };
  });
  return Buffer.from(`${JSON.stringify(patches)}\n`, "utf8");
}

export interface RuntimeDocumentInspectResult {
  operation: "inspect";
  format: "docx" | "pptx";
  file: string;
  blocks: Array<{
    anchor: string;
    kind: string;
    text: string;
    editable: boolean;
    [key: string]: unknown;
  }>;
  truncated: boolean;
}

export interface RuntimeDocumentPatchResult {
  operation: "patch";
  format: "docx" | "pptx";
  file: string;
  outputPath: string;
  title: string;
  filename: string;
  kind: "document" | "presentation";
  patched: string[];
}

export interface RuntimePdfConversionResult {
  file: string;
  outputPath: string;
  title: string;
  filename: string;
  kind: "document";
  pages: number;
  warnings: string[];
  scannedDocument: boolean;
  pageResults: Array<{
    page: number;
    status: "ok" | "degraded" | "scanned";
    reason?: string;
    confidence?: number;
  }>;
}

export interface RuntimeOfficeWriteStaging<T> {
  result: T;
  filePath: string;
  previewFilePath: string | null;
  outputWorkspaceRelativePath: string;
  cleanup: () => void;
}

function writeStaging<T>(
  completed: OfficeOperationCompletion,
  result: Record<string, unknown>,
  exposedResult: T,
): RuntimeOfficeWriteStaging<T> {
  const outputWorkspaceRelativePath = result.outputWorkspaceRelativePath;
  if (typeof outputWorkspaceRelativePath !== "string") {
    throw new Error("Runtime returned an invalid Office workspace output path.");
  }
  const filePath = resolveRuntimeOutputPath(
    completed.job,
    result.outputRelativePath,
    outputWorkspaceRelativePath,
  );
  const previewFilePath = result.previewRelativePath === null
    ? null
    : resolveRuntimeOutputPath(completed.job, result.previewRelativePath, "preview.html");
  let cleaned = false;
  return {
    result: exposedResult,
    filePath,
    previewFilePath,
    outputWorkspaceRelativePath,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      cleanupRuntimeStage(completed.job);
    },
  };
}

export async function runDocumentEditViaRuntime(
  scope: RuntimeV2OfficeScope,
  workspace: string,
  args: Record<string, unknown>,
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeDocumentInspectResult | RuntimeOfficeWriteStaging<RuntimeDocumentPatchResult>> {
  requiredConversationScope(scope);
  const source = workspaceInput(workspace, args.file, [".docx", ".pptx"]);
  const patches = Array.isArray(args.patches) ? args.patches : [];
  const action = patches.length > 0 ? "patch" : "inspect";
  const requestPayload = {
    operation: "document-edit",
    action,
    sourceRelativeFile: source.relativeFile,
    output: action === "patch" ? boundedNullableText(args.output, 4_096) : null,
    title: action === "patch" ? boundedNullableText(args.title, 240) : null,
  };
  const inputs: OfficeOperationInput[] = [directFileInput(
    source.filePath,
    path.basename(source.filePath),
    OFFICE_MIME_TYPES[source.extension] ?? "application/octet-stream",
  )];
  if (action === "patch") {
    inputs.push(bytesInput(sealedPatches(patches, 200), "patches.json", "application/json"));
  }
  const completed = await runOfficeInputOperation(scope, inputs, requestPayload, {
    idempotencyNamespace: "office-document-edit-v2",
    idempotencySeed: options.idempotencySeed,
    timeoutMs: 12 * 60_000,
    signal: options.signal,
    control: options.control,
  });
  const result = completed.envelope.result;
  if (action === "inspect") {
    if (
      result.operation !== "document-edit" ||
      result.action !== "inspect" ||
      typeof result.dataRelativePath !== "string"
    ) throw new Error("Runtime returned an invalid document inspection result.");
    const inspected = readRuntimeStageJson<RuntimeDocumentInspectResult>(completed, result.dataRelativePath, 16 * 1024 * 1024);
    if (
      inspected.operation !== "inspect" ||
      !["docx", "pptx"].includes(inspected.format) ||
      inspected.file !== source.relativeFile ||
      !Array.isArray(inspected.blocks) ||
      inspected.blocks.length > 5_000 ||
      inspected.blocks.some((block) =>
        !block ||
        typeof block !== "object" ||
        typeof block.anchor !== "string" ||
        !block.anchor ||
        block.anchor.length > 4_096 ||
        typeof block.kind !== "string" ||
        block.kind.length > 128 ||
        typeof block.text !== "string" ||
        block.text.length > 100_000 ||
        typeof block.editable !== "boolean") ||
      typeof inspected.truncated !== "boolean"
    ) throw new Error("Runtime returned invalid document blocks.");
    return inspected;
  }
  if (
    result.operation !== "document-edit" ||
    result.action !== "patch" ||
    result.file !== source.relativeFile ||
    !["document", "presentation"].includes(String(result.kind)) ||
    typeof result.title !== "string" ||
    typeof result.filename !== "string" ||
    !Array.isArray(result.patched) ||
    result.patched.length > 200 ||
    result.patched.some((item) => typeof item !== "string" || !item || item.length > 4_096)
  ) throw new Error("Runtime returned an invalid document edit result.");
  const outputWorkspaceRelativePath = String(result.outputWorkspaceRelativePath);
  const outputPath = containWorkspacePath(workspace, outputWorkspaceRelativePath, "The document output path");
  const exposed: RuntimeDocumentPatchResult = {
    operation: "patch",
    format: source.extension === ".docx" ? "docx" : "pptx",
    file: source.relativeFile,
    outputPath,
    title: result.title,
    filename: result.filename,
    kind: result.kind as RuntimeDocumentPatchResult["kind"],
    patched: result.patched.filter((item): item is string => typeof item === "string"),
  };
  return writeStaging(completed, result, exposed);
}

export async function runPdfToDocxViaRuntime(
  scope: RuntimeV2OfficeScope,
  workspace: string,
  args: Record<string, unknown>,
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeOfficeWriteStaging<RuntimePdfConversionResult>> {
  requiredConversationScope(scope);
  const source = workspaceInput(workspace, args.file, [".pdf"]);
  const requestPayload = {
    operation: "pdf-to-docx",
    sourceRelativeFile: source.relativeFile,
    output: boundedNullableText(args.output, 4_096),
    title: boundedNullableText(args.title, 240),
    password: boundedNullableText(args.password, 4_096),
  };
  const completed = await runOfficeInputOperation(
    scope,
    [directFileInput(source.filePath, path.basename(source.filePath), OFFICE_MIME_TYPES[".pdf"])],
    requestPayload,
    {
      idempotencyNamespace: "office-pdf-to-docx-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 15 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const result = completed.envelope.result;
  if (
    result.operation !== "pdf-to-docx" ||
    result.file !== source.relativeFile ||
    result.kind !== "document" ||
    typeof result.title !== "string" ||
    typeof result.filename !== "string" ||
    !Number.isSafeInteger(result.pages) ||
    (result.pages as number) < 0 ||
    !Array.isArray(result.warnings) ||
    result.warnings.some((item) => typeof item !== "string" || item.length > 4_096) ||
    typeof result.scannedDocument !== "boolean" ||
    !Array.isArray(result.pageResults) ||
    result.pageResults.length > 10_000 ||
    result.pageResults.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return true;
      const page = item as Record<string, unknown>;
      return !Number.isSafeInteger(page.page) ||
        (page.page as number) < 1 ||
        !["ok", "degraded", "scanned"].includes(String(page.status)) ||
        (page.reason !== undefined && (typeof page.reason !== "string" || page.reason.length > 4_096)) ||
        (page.confidence !== undefined && !Number.isFinite(page.confidence));
    })
  ) throw new Error("Runtime returned an invalid PDF conversion result.");
  const outputWorkspaceRelativePath = String(result.outputWorkspaceRelativePath);
  const outputPath = containWorkspacePath(workspace, outputWorkspaceRelativePath, "The document output path");
  const exposed: RuntimePdfConversionResult = {
    file: source.relativeFile,
    outputPath,
    title: result.title,
    filename: result.filename,
    kind: "document",
    pages: result.pages as number,
    warnings: result.warnings.filter((item): item is string => typeof item === "string"),
    scannedDocument: result.scannedDocument,
    pageResults: result.pageResults as RuntimePdfConversionResult["pageResults"],
  };
  return writeStaging(completed, result, exposed);
}

export function promoteRuntimeOfficeOutput(
  workspace: string,
  staging: RuntimeOfficeWriteStaging<unknown>,
): string {
  const target = containWorkspacePath(
    workspace,
    staging.outputWorkspaceRelativePath,
    "The document output path",
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.copyFileSync(staging.filePath, temporary, fs.constants.COPYFILE_EXCL);
    const descriptor = fs.openSync(temporary, "r+");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
    return target;
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export interface RuntimeSpreadsheetInspectResult {
  blocks: Array<{
    anchor: string;
    kind: "cell";
    text: string;
    editable: true;
    sheet: string;
    cell: string;
  }>;
  truncated: boolean;
}

export async function inspectSpreadsheetViaRuntime(
  scope: RuntimeV2OfficeScope,
  filePath: string,
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeSpreadsheetInspectResult> {
  requiredConversationScope(scope);
  const completed = await runOfficeInputOperation(
    scope,
    [directFileInput(filePath, path.basename(filePath), OFFICE_MIME_TYPES[".xlsx"])],
    { operation: "spreadsheet", action: "inspect", title: null },
    {
      idempotencyNamespace: "office-spreadsheet-inspect-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 3 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const result = completed.envelope.result;
  if (
    result.operation !== "spreadsheet" ||
    result.action !== "inspect" ||
    typeof result.dataRelativePath !== "string"
  ) throw new Error("Runtime returned an invalid spreadsheet inspection result.");
  const inspected = readRuntimeStageJson<RuntimeSpreadsheetInspectResult>(completed, result.dataRelativePath, 16 * 1024 * 1024);
  if (
    !Array.isArray(inspected.blocks) ||
    inspected.blocks.length > 5_000 ||
    inspected.blocks.some((block) =>
      !block ||
      typeof block !== "object" ||
      typeof block.anchor !== "string" ||
      !block.anchor ||
      block.anchor.length > 4_096 ||
      block.kind !== "cell" ||
      typeof block.text !== "string" ||
      block.text.length > 100_000 ||
      block.editable !== true ||
      typeof block.sheet !== "string" ||
      typeof block.cell !== "string") ||
    typeof inspected.truncated !== "boolean"
  ) {
    throw new Error("Runtime returned invalid spreadsheet cells.");
  }
  return inspected;
}

export async function editSpreadsheetViaRuntime(
  scope: RuntimeV2OfficeScope,
  filePath: string,
  patches: unknown,
  options: RuntimeV2OfficeExecutionOptions & { title?: string | null } = {},
): Promise<RuntimeOfficeWriteStaging<{ patched: string[] }>> {
  requiredConversationScope(scope);
  const patchBytes = sealedPatches(patches, 2_000);
  const completed = await runOfficeInputOperation(
    scope,
    [
      directFileInput(filePath, path.basename(filePath), OFFICE_MIME_TYPES[".xlsx"]),
      bytesInput(patchBytes, "patches.json", "application/json"),
    ],
    {
      operation: "spreadsheet",
      action: "patch",
      title: boundedNullableText(options.title, 240),
    },
    {
      idempotencyNamespace: "office-spreadsheet-edit-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 4 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const result = completed.envelope.result;
  if (
    result.operation !== "spreadsheet" ||
    result.action !== "patch" ||
    (result.previewRelativePath !== null && typeof result.previewRelativePath !== "string") ||
    typeof result.outputWorkspaceRelativePath !== "string"
  ) throw new Error("Runtime returned an invalid spreadsheet edit result.");
  const patchList = JSON.parse(Buffer.from(patchBytes).toString("utf8")) as Array<{ anchor: string }>;
  return writeStaging(completed, result, { patched: patchList.map(({ anchor }) => anchor) });
}

export interface RuntimeArtifactRenderStaging {
  outputPath: string;
  previewPath: string;
  mimeType: string;
  cleanup: () => void;
}

export async function renderMarkdownArtifactViaRuntime(
  scope: RuntimeV2OfficeScope,
  input: {
    rendererId: "docx" | "pdf";
    content: string;
    filename: string;
    title: string;
    metadata: Record<string, unknown>;
  },
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeArtifactRenderStaging> {
  requiredConversationScope(scope);
  const content = Buffer.from(input.content, "utf8");
  const completed = await runOfficeInputOperation(
    scope,
    [bytesInput(content, "source.md", "text/markdown")],
    {
      operation: "artifact-render",
      rendererId: input.rendererId,
      title: input.title,
      filename: path.basename(input.filename),
      metadata: input.metadata,
    },
    {
      idempotencyNamespace: "office-artifact-render-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 6 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const result = completed.envelope.result;
  const expectedMime = input.rendererId === "docx"
    ? OFFICE_MIME_TYPES[".docx"]
    : OFFICE_MIME_TYPES[".pdf"];
  if (
    result.operation !== "artifact-render" ||
    result.rendererId !== input.rendererId ||
    result.mimeType !== expectedMime ||
    typeof result.outputRelativePath !== "string" ||
    typeof result.previewRelativePath !== "string"
  ) throw new Error("Runtime returned an invalid artifact render result.");
  const outputPath = resolveRuntimeOutputPath(completed.job, result.outputRelativePath, path.basename(input.filename));
  const previewPath = resolveRuntimeOutputPath(
    completed.job,
    result.previewRelativePath,
    input.rendererId === "docx" ? "preview.html" : path.basename(input.filename),
  );
  let cleaned = false;
  return {
    outputPath,
    previewPath,
    mimeType: expectedMime,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      cleanupRuntimeStage(completed.job);
    },
  };
}

export interface RuntimeMarkdownPdfStaging {
  filePath: string;
  mimeType: "application/pdf";
  cleanup: () => void;
}

/**
 * Renders the standalone/folder Markdown PDF download in the disposable Office
 * worker. The potentially large document bundle is a sealed input blob; only
 * its count and the output filename cross the bounded request protocol.
 */
export async function renderMarkdownPdfDownloadViaRuntime(
  scope: RuntimeV2OfficeScope,
  input: {
    documents: Array<{ content: string; title: string }>;
    title: string;
    filename: string;
  },
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeMarkdownPdfStaging> {
  if (
    !Array.isArray(input.documents) ||
    input.documents.length < 1 ||
    input.documents.length > 500 ||
    typeof input.title !== "string" ||
    !input.title.trim() ||
    input.documents.some((document) =>
      !document ||
      typeof document.content !== "string" ||
      typeof document.title !== "string" ||
      !document.title.trim()) ||
    input.documents.reduce((total, document) => total + document.content.length, 0) > 10_000_000
  ) {
    throw new OfficeCliError(400, "markdown_pdf_invalid", "The Markdown PDF document bundle is invalid.");
  }
  const filename = path.basename(input.filename);
  if (!filename || !filename.toLowerCase().endsWith(".pdf")) {
    throw new OfficeCliError(400, "markdown_pdf_filename_invalid", "The Markdown PDF filename is invalid.");
  }
  const bundle = Buffer.from(`${JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    title: input.title,
    documents: input.documents,
  })}\n`, "utf8");
  const completed = await runOfficeInputOperation(
    scope,
    [bytesInput(bundle, "documents.json", "application/vnd.breadboard.markdown-pdf+json")],
    {
      operation: "markdown-pdf",
      filename,
      documentCount: input.documents.length,
    },
    {
      idempotencyNamespace: "office-markdown-pdf-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 12 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const result = completed.envelope.result;
  if (
    Object.keys(result).sort().join(",") !== "mimeType,operation,outputRelativePath" ||
    result.operation !== "markdown-pdf" ||
    result.mimeType !== OFFICE_MIME_TYPES[".pdf"] ||
    typeof result.outputRelativePath !== "string"
  ) throw new Error("Runtime returned an invalid Markdown PDF result.");
  const filePath = resolveRuntimeOutputPath(completed.job, result.outputRelativePath, filename);
  if (fs.statSync(filePath).size > MAX_OFFICE_EXPORT_BYTES) {
    throw new Error("Runtime Markdown PDF output exceeds its bound.");
  }
  let cleaned = false;
  return {
    filePath,
    mimeType: "application/pdf",
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      cleanupRuntimeStage(completed.job);
    },
  };
}

export interface RuntimeOfficePageOutcome {
  pages: Array<{ pageNumber: number; filePath: string }>;
  unsupported: string;
  cleanup: () => void;
}

export async function renderOfficePagesViaRuntime(
  scope: RuntimeV2OfficeScope,
  filePath: string,
  format: "docx" | "xlsx" | "pptx",
  options: {
    maximumPages: number;
    width: number;
    idempotencySeed?: string | null;
    signal?: AbortSignal;
    control?: RuntimeV2OfficeControl;
  },
): Promise<RuntimeOfficePageOutcome> {
  if (
    !Number.isSafeInteger(options.maximumPages) ||
    options.maximumPages < 1 ||
    options.maximumPages > 300 ||
    !Number.isSafeInteger(options.width) ||
    options.width < 320 ||
    options.width > 4_096
  ) throw new TypeError("Office page rendering bounds are invalid.");
  const completed = await runOfficeInputOperation(
    scope,
    [directFileInput(filePath, path.basename(filePath), OFFICE_MIME_TYPES[`.${format}`])],
    {
      operation: "page-images",
      format,
      maximumPages: options.maximumPages,
      width: options.width,
    },
    {
      idempotencyNamespace: "office-page-images-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 12 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const result = completed.envelope.result;
  if (
    result.operation !== "page-images" ||
    !Array.isArray(result.pages) ||
    result.pages.length > options.maximumPages ||
    typeof result.unsupported !== "string"
  ) throw new Error("Runtime returned an invalid Office page-image result.");
  const pageNumbers = new Set<number>();
  const pages = result.pages.map((page) => {
    if (
      !page ||
      typeof page !== "object" ||
      Array.isArray(page) ||
      !Number.isSafeInteger((page as Record<string, unknown>).pageNumber) ||
      ((page as Record<string, unknown>).pageNumber as number) < 1 ||
      ((page as Record<string, unknown>).pageNumber as number) > options.maximumPages ||
      pageNumbers.has((page as Record<string, unknown>).pageNumber as number) ||
      typeof (page as Record<string, unknown>).relativePath !== "string"
    ) throw new Error("Runtime returned an invalid Office page reference.");
    pageNumbers.add((page as Record<string, unknown>).pageNumber as number);
    const resolved = resolveRuntimeOutputPath(
      completed.job,
      (page as Record<string, unknown>).relativePath,
      null,
    );
    if (!/\.(?:png|jpe?g)$/iu.test(resolved)) {
      throw new Error("Runtime returned a non-image Office page.");
    }
    return {
      pageNumber: (page as Record<string, unknown>).pageNumber as number,
      filePath: resolved,
    };
  });
  let cleaned = false;
  return {
    pages,
    unsupported: result.unsupported,
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      cleanupRuntimeStage(completed.job);
    },
  };
}

export interface RuntimeDocumentChapter {
  number: number;
  title: string;
  start: number;
  end: number;
  kind: "numbered" | "structural" | "front-matter" | "window";
}

export interface RuntimeDocumentStructure {
  chapters: RuntimeDocumentChapter[];
  chaptersDetected: number;
  hasToc: boolean;
  headingSample: string[];
  estimatedTokens: number;
  fromClone: boolean;
}

export interface RuntimeCloneExtraction {
  text: string;
  metadata: Record<string, unknown>;
}

export interface RuntimeSkillValidation {
  ran: boolean;
  ok: boolean;
  warnings: string[];
}

function skillOperationValue<T>(completed: OfficeOperationCompletion): T {
  const result = completed.envelope.result;
  if (
    !["skill-segment", "skill-extract", "skill-validate"].includes(String(result.operation)) ||
    typeof result.dataRelativePath !== "string"
  ) throw new Error("Runtime returned an invalid document-skill result.");
  const container = readRuntimeStageJson<{ value: T }>(completed, result.dataRelativePath);
  if (!container || typeof container !== "object" || !("value" in container)) {
    throw new Error("Runtime returned invalid document-skill data.");
  }
  return container.value;
}

export async function segmentDocumentSkillViaRuntime(
  scope: RuntimeV2OfficeScope,
  text: string,
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeDocumentStructure> {
  const completed = await runOfficeInputOperation(
    scope,
    [bytesInput(Buffer.from(text, "utf8"), "document.txt", "text/plain")],
    { operation: "skill-segment" },
    {
      idempotencyNamespace: "document-skill-segment-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 4 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const value = skillOperationValue<RuntimeDocumentStructure>(completed);
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.chapters) ||
    value.chapters.length < 1 ||
    value.chapters.length > 200 ||
    !Number.isSafeInteger(value.chaptersDetected) ||
    value.chaptersDetected < 0 ||
    typeof value.hasToc !== "boolean" ||
    !Array.isArray(value.headingSample) ||
    value.headingSample.length > 100 ||
    value.headingSample.some((heading) => typeof heading !== "string" || heading.length > 4_096) ||
    !Number.isSafeInteger(value.estimatedTokens) ||
    value.estimatedTokens < 0 ||
    typeof value.fromClone !== "boolean" ||
    value.chapters.some((chapter) =>
      !chapter ||
      !Number.isFinite(chapter.number) ||
      typeof chapter.title !== "string" ||
      !chapter.title ||
      chapter.title.length > 4_096 ||
      !Number.isFinite(chapter.start) ||
      !Number.isFinite(chapter.end) ||
      chapter.end <= chapter.start ||
      !["numbered", "structural", "front-matter", "window"].includes(chapter.kind))
  ) throw new Error("Runtime returned an invalid document structure.");
  return value;
}

export async function extractDocumentSkillViaRuntime(
  scope: RuntimeV2OfficeScope,
  filePath: string,
  extractionMode: "text" | "technical" = "text",
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeCloneExtraction | null> {
  const completed = await runOfficeInputOperation(
    scope,
    [directFileInput(filePath)],
    { operation: "skill-extract", extractionMode },
    {
      idempotencyNamespace: "document-skill-extract-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 12 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const value = skillOperationValue<RuntimeCloneExtraction | null>(completed);
  if (value === null) return null;
  if (
    typeof value !== "object" ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    !value.metadata ||
    typeof value.metadata !== "object" ||
    Array.isArray(value.metadata)
  ) throw new Error("Runtime returned invalid document extraction data.");
  return value;
}

export async function validateDocumentSkillViaRuntime(
  scope: RuntimeV2OfficeScope,
  skillFile: string,
  options: RuntimeV2OfficeExecutionOptions = {},
): Promise<RuntimeSkillValidation> {
  const completed = await runOfficeInputOperation(
    scope,
    [directFileInput(skillFile, "SKILL.md", "text/markdown")],
    { operation: "skill-validate" },
    {
      idempotencyNamespace: "document-skill-validate-v2",
      idempotencySeed: options.idempotencySeed,
      timeoutMs: 2 * 60_000,
      signal: options.signal,
      control: options.control,
    },
  );
  const value = skillOperationValue<RuntimeSkillValidation>(completed);
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.ran !== "boolean" ||
    typeof value.ok !== "boolean" ||
    !Array.isArray(value.warnings) ||
    value.warnings.some((warning) => typeof warning !== "string")
  ) throw new Error("Runtime returned invalid document-skill validation data.");
  return value;
}

export async function cancelOfficeRuntimeJob(
  scope: RuntimeV2OfficeScope,
  jobId: string,
): Promise<RuntimeJobSnapshot> {
  return cancelRuntimeJob(authority(scope), jobId);
}
