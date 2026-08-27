import "server-only";

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  runGeneratedVisualBrowserTests,
  type GeneratedVisualBrowserCleanupMethod,
  type GeneratedVisualBrowserCompletion,
  type GeneratedVisualBrowserInvocation,
  type GeneratedVisualBrowserRunResult,
} from "../generated-visuals.ts";
import type { GeneratedVisualizationDefinition } from "../visual-sdk.ts";
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
const JOB_TYPE = "generated-visual-browser";
const WORKER_KIND = "generated-visual-browser-node";
const RUNTIME_BROWSER_SENTINEL = "runtime-v2-owned-browser";
const SOURCE_DISPLAY_NAME = "generated-visual-browser.html";
const SOURCE_MEDIA_TYPE = "text/html; charset=utf-8";
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;
const MAX_RESULT_TEXT_BYTES = 192 * 1024;
const POLL_MS = 100;
const TERMINAL_STATES = new Set<RuntimeJobSnapshot["state"]>([
  "cancelled",
  "succeeded",
  "failed",
  "resource_exhausted",
  "interrupted",
  "uncertain",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const BROWSER_COMPLETIONS = new Set<GeneratedVisualBrowserCompletion>([
  "process_exit",
  "observed_dom",
  "observed_capture",
  "spawn_error",
  "deadline",
  "cancelled",
  "output_overflow",
]);
const BROWSER_CLEANUP_METHODS = new Set<GeneratedVisualBrowserCleanupMethod>([
  "none",
  "natural-exit",
  "natural-exit-lineage",
  "natural-exit-unconfirmed",
  "taskkill-tree",
  "lineage-quiescence",
  "natural-exit-race",
  "process-group",
  "process-group-sigkill",
  "process-kill",
]);
const CONFIRMED_BROWSER_CLEANUP_METHODS = new Set<
  GeneratedVisualBrowserCleanupMethod
>([
  "natural-exit",
  "natural-exit-lineage",
  "taskkill-tree",
  "lineage-quiescence",
  "process-group",
  "process-group-sigkill",
]);
const PROACTIVE_BROWSER_SUCCESS_CLEANUP_METHODS = new Set<
  GeneratedVisualBrowserCleanupMethod
>([
  "taskkill-tree",
  "lineage-quiescence",
  "process-group",
  "process-group-sigkill",
]);
const NATURAL_BROWSER_PROCESS_EXIT_CLEANUP_METHODS = new Set<
  GeneratedVisualBrowserCleanupMethod
>([
  "natural-exit",
  "natural-exit-lineage",
  "natural-exit-unconfirmed",
  "process-group",
]);
const PROACTIVE_BROWSER_FAILURE_CLEANUP_METHODS = new Set<
  GeneratedVisualBrowserCleanupMethod
>([
  ...PROACTIVE_BROWSER_SUCCESS_CLEANUP_METHODS,
  "natural-exit-race",
  "process-kill",
]);

interface ParsedInvocation {
  htmlPath: string;
  screenshotPath: string | null;
  request: {
    protocolVersion: 1;
    operation: "render-generated-visual";
    slug: string;
    width: number;
    height: number;
    reducedMotion: boolean;
    screenshot: boolean;
    timeoutMs: number;
  };
}

interface BrowserResultEnvelope {
  result: GeneratedVisualBrowserRunResult;
  screenshot: null | { relativePath: string; sizeBytes: number; sha256: string };
}

export interface GeneratedVisualBrowserRuntimeControl {
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

const DEFAULT_CONTROL: GeneratedVisualBrowserRuntimeControl = {
  reserve: reserveRuntimeJobInput,
  upload: uploadRuntimeJobInput,
  abandon: abandonRuntimeJobInput,
  submit: submitRuntimeJob,
  inspect: inspectRuntimeJob,
  readOutput: readRuntimeJobOutput,
  cancel: cancelRuntimeJob,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function directFile(candidate: string): boolean {
  try {
    const metadata = fs.lstatSync(candidate);
    return metadata.isFile() && !metadata.isSymbolicLink() &&
      samePath(fs.realpathSync.native(candidate), candidate);
  } catch {
    return false;
  }
}

function boundedText(value: unknown, maximumBytes = MAX_RESULT_TEXT_BYTES): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= maximumBytes &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function oneArgument(args: readonly string[], prefix: string): string | null {
  const matches = args.filter((arg) => arg.startsWith(prefix));
  return matches.length === 1 ? matches[0].slice(prefix.length) : null;
}

export function parseGeneratedVisualBrowserInvocation(
  invocation: GeneratedVisualBrowserInvocation,
): ParsedInvocation {
  if (
    invocation.executable !== RUNTIME_BROWSER_SENTINEL ||
    !SLUG.test(invocation.slug) ||
    !path.isAbsolute(invocation.profilePath) ||
    !Number.isSafeInteger(invocation.timeoutMs) ||
    invocation.timeoutMs < 5_000 || invocation.timeoutMs > 90_000 ||
    !Array.isArray(invocation.args) || invocation.args.length < 8 || invocation.args.length > 24 ||
    invocation.args.some((arg) => typeof arg !== "string" || Buffer.byteLength(arg, "utf8") > 8_192)
  ) throw new TypeError("The generated visual Runtime browser invocation is invalid.");
  const allowedFixed = new Set([
    "--headless=new",
    "--disable-gpu",
    "--disable-gpu-shader-disk-cache",
    "--disable-skia-graphite",
    "--disable-features=SkiaGraphiteUsePersistentCache",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--force-prefers-reduced-motion",
    "--dump-dom",
  ]);
  const url = invocation.args.at(-1);
  if (!url?.startsWith("file:")) {
    throw new TypeError("The generated visual browser source URL is invalid.");
  }
  let htmlPath: string;
  try {
    htmlPath = path.resolve(fileURLToPath(url));
  } catch {
    throw new TypeError("The generated visual browser source URL is invalid.");
  }
  const profile = oneArgument(invocation.args, "--user-data-dir=");
  const windowSize = oneArgument(invocation.args, "--window-size=");
  const virtualBudget = oneArgument(invocation.args, "--virtual-time-budget=");
  const screenshotValue = oneArgument(invocation.args, "--screenshot=");
  const dynamic = invocation.args.filter((arg) =>
    arg.startsWith("--user-data-dir=") || arg.startsWith("--window-size=") ||
    arg.startsWith("--virtual-time-budget=") || arg.startsWith("--screenshot=") ||
    arg === url);
  const fixed = invocation.args.filter((arg) => !dynamic.includes(arg));
  if (
    !profile || !samePath(profile, invocation.profilePath) ||
    !windowSize || virtualBudget !== "2500" ||
    !fixed.includes("--headless=new") || !fixed.includes("--dump-dom") ||
    fixed.some((arg) => !allowedFixed.has(arg)) ||
    new Set(fixed).size !== fixed.length ||
    dynamic.length !== 4 + (screenshotValue === null ? 0 : 1) ||
    !directFile(htmlPath) || path.extname(htmlPath).toLowerCase() !== ".html"
  ) throw new TypeError("The generated visual browser arguments are outside the fixed contract.");
  const dimensions = /^(\d{3,4}),(\d{3,4})$/u.exec(windowSize);
  const width = Number(dimensions?.[1]);
  const height = Number(dimensions?.[2]);
  if (
    !dimensions || !Number.isSafeInteger(width) || width < 240 || width > 4_096 ||
    !Number.isSafeInteger(height) || height < 240 || height > 4_096
  ) throw new TypeError("The generated visual browser viewport is invalid.");
  const metadata = fs.lstatSync(htmlPath);
  if (metadata.size < 1 || metadata.size > MAX_HTML_BYTES) {
    throw new TypeError("The generated visual browser HTML is outside its bound.");
  }
  const screenshotPath = screenshotValue === null ? null : path.resolve(screenshotValue);
  if (
    screenshotPath &&
    (!samePath(path.dirname(screenshotPath), path.dirname(htmlPath)) ||
      !/^preview(?:-[a-z0-9-]+)?\.png$/u.test(path.basename(screenshotPath)))
  ) throw new TypeError("The generated visual browser screenshot target is invalid.");
  return {
    htmlPath,
    screenshotPath,
    request: {
      protocolVersion: PROTOCOL_VERSION,
      operation: "render-generated-visual",
      slug: invocation.slug,
      width,
      height,
      reducedMotion: fixed.includes("--force-prefers-reduced-motion"),
      screenshot: screenshotPath !== null,
      timeoutMs: invocation.timeoutMs,
    },
  };
}

function authority(userId: number, gardenId: string): RuntimeJobAuthority {
  if (!Number.isSafeInteger(userId) || userId < 1 ||
      !boundedText(gardenId, 256) || !gardenId.trim()) {
    throw new TypeError("Generated visual browser Runtime scope is invalid.");
  }
  return { userId, gardenId, conversationId: null };
}

function assertJob(job: RuntimeJobSnapshot, expected: RuntimeJobAuthority): void {
  if (
    job.jobType !== JOB_TYPE || job.workerKind !== WORKER_KIND ||
    job.resourceClass !== "browser-automation" ||
    job.gardenId !== expected.gardenId || job.conversationId !== null
  ) throw new Error("Runtime returned a job outside the generated visual browser contract.");
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
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
  control: GeneratedVisualBrowserRuntimeControl,
  jobAuthority: RuntimeJobAuthority,
  initial: RuntimeJobSnapshot,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<RuntimeJobSnapshot> {
  let job = initial;
  assertJob(job, jobAuthority);
  const deadline = Date.now() + timeoutMs + 45_000;
  while (!TERMINAL_STATES.has(job.state)) {
    if (Date.now() >= deadline) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
      throw new Error("Generated visual browser Runtime work timed out.");
    }
    await delay(POLL_MS, signal);
    job = await control.inspect(jobAuthority, job.jobId);
    assertJob(job, jobAuthority);
  }
  return job;
}

export function parseGeneratedVisualBrowserRuntimeResult(
  job: RuntimeJobSnapshot,
  content: unknown,
): BrowserResultEnvelope {
  if (
    !isRecord(content) || !exactKeys(content, [
      "protocolVersion", "identity", "completionSequence", "result",
    ]) || content.protocolVersion !== PROTOCOL_VERSION ||
    content.completionSequence !== job.lastWorkerSequence ||
    !isRecord(content.identity) || !exactKeys(content.identity, ["jobId", "attempt", "workerInstanceId"]) ||
    content.identity.jobId !== job.jobId || content.identity.attempt !== job.attempt ||
    content.identity.workerInstanceId !== job.workerInstanceId ||
    !isRecord(content.result) || !exactKeys(content.result, [
      "status", "signal", "stdout", "stderr", "error", "durationMs", "timedOut",
      "completion", "browserExitedNaturally", "cleanupMethod", "cleanupConfirmed", "screenshot",
    ])
  ) throw new Error("Runtime returned an unfenced generated visual browser result.");
  const result = content.result;
  const validError = result.error === null || (
    isRecord(result.error) && exactKeys(result.error, ["code", "message"]) &&
    boundedText(result.error.code, 128) && boundedText(result.error.message, 4_096)
  );
  const validScreenshot = result.screenshot === null || (
    isRecord(result.screenshot) && exactKeys(result.screenshot, ["relativePath", "sizeBytes", "sha256"]) &&
    boundedText(result.screenshot.relativePath, 2_048) &&
    Number.isSafeInteger(result.screenshot.sizeBytes) && Number(result.screenshot.sizeBytes) > 0 &&
    Number(result.screenshot.sizeBytes) <= MAX_SCREENSHOT_BYTES &&
    typeof result.screenshot.sha256 === "string" && SHA256.test(result.screenshot.sha256)
  );
  const completion = result.completion as GeneratedVisualBrowserCompletion;
  const cleanupMethod = result.cleanupMethod as GeneratedVisualBrowserCleanupMethod;
  const errorCode = isRecord(result.error) ? String(result.error.code) : null;
  const successMethodCoherent = completion === "process_exit"
    ? ["natural-exit", "natural-exit-lineage", "process-group"].includes(cleanupMethod)
    : ["observed_dom", "observed_capture"].includes(completion) &&
      PROACTIVE_BROWSER_SUCCESS_CLEANUP_METHODS.has(cleanupMethod);
  const processSuccess = result.status === 0 && result.signal === null &&
    result.error === null && result.timedOut === false &&
    result.cleanupConfirmed === true &&
    CONFIRMED_BROWSER_CLEANUP_METHODS.has(cleanupMethod) &&
    successMethodCoherent &&
    (
      (completion === "process_exit" && result.browserExitedNaturally === true) ||
      (["observed_dom", "observed_capture"].includes(completion) &&
        result.browserExitedNaturally === false)
    );
  const cleanupMethodCoherent =
    (cleanupMethod === "none"
      ? result.cleanupConfirmed === true && result.status === null &&
        result.error !== null && ["spawn_error", "cancelled"].includes(completion)
      : ["natural-exit", "natural-exit-lineage", "taskkill-tree", "lineage-quiescence"]
          .includes(cleanupMethod)
        ? result.cleanupConfirmed === true
        : ["natural-exit-unconfirmed", "natural-exit-race", "process-kill"]
            .includes(cleanupMethod)
          ? result.cleanupConfirmed === false
          : ["process-group", "process-group-sigkill"].includes(cleanupMethod));
  const completionMethodCoherent = completion === "process_exit"
    ? NATURAL_BROWSER_PROCESS_EXIT_CLEANUP_METHODS.has(cleanupMethod)
    : ["observed_dom", "observed_capture"].includes(completion)
      ? PROACTIVE_BROWSER_FAILURE_CLEANUP_METHODS.has(cleanupMethod)
      : result.browserExitedNaturally === false &&
        !["natural-exit", "natural-exit-lineage", "natural-exit-unconfirmed"]
          .includes(cleanupMethod);
  const completionCoherent =
    (completion === "deadline"
      ? result.status === null && result.timedOut === true &&
        result.browserExitedNaturally === false && errorCode === "ETIMEDOUT"
      : completion === "cancelled"
        ? result.status === null && result.timedOut === false &&
          result.browserExitedNaturally === false && errorCode === "ECANCELLED"
        : completion === "output_overflow"
          ? result.status === null && result.timedOut === false &&
            result.browserExitedNaturally === false && errorCode === "ENOBUFS"
          : completion === "spawn_error"
            ? result.status === null && result.timedOut === false &&
              result.browserExitedNaturally === false && result.error !== null
            : completion === "process_exit"
              ? result.browserExitedNaturally === true && result.timedOut === false
              : ["observed_dom", "observed_capture"].includes(completion) &&
                result.browserExitedNaturally === false && result.timedOut === false);
  const screenshotCoherent = result.screenshot === null
    ? completion !== "observed_capture" || !processSuccess
    : processSuccess &&
      (completion === "observed_capture" || completion === "process_exit");
  const processExitTerminalShape =
    typeof result.status === "number" && result.signal === null ||
    result.status === null && result.signal !== null;
  const failedCleanupCoherent = result.cleanupConfirmed !== false || (
    result.error !== null && result.screenshot === null &&
    (completion === "process_exit" ? processExitTerminalShape : result.status === null)
  );
  const processExitFailureCoherent = completion !== "process_exit" ||
    processSuccess ||
    (processExitTerminalShape && result.screenshot === null && (
      result.cleanupConfirmed === false && result.error !== null ||
      result.cleanupConfirmed === true && result.error === null && (
        typeof result.status === "number" && result.status !== 0 ||
        result.status === null && result.signal !== null
      )
    ));
  const observedFailureCoherent =
    !["observed_dom", "observed_capture"].includes(completion) ||
    processSuccess ||
    (result.cleanupConfirmed === false && result.status === null &&
      result.error !== null && result.screenshot === null);
  if (
    !(result.status === null || Number.isSafeInteger(result.status)) ||
    !(result.signal === null || boundedText(result.signal, 128)) ||
    !boundedText(result.stdout) || !boundedText(result.stderr) || !validError ||
    !Number.isSafeInteger(result.durationMs) || Number(result.durationMs) < 0 ||
    typeof result.timedOut !== "boolean" ||
    !BROWSER_COMPLETIONS.has(completion) ||
    typeof result.browserExitedNaturally !== "boolean" ||
    !BROWSER_CLEANUP_METHODS.has(
      cleanupMethod,
    ) ||
    typeof result.cleanupConfirmed !== "boolean" || !validScreenshot ||
    !cleanupMethodCoherent || !completionMethodCoherent ||
    !completionCoherent || !screenshotCoherent ||
    !failedCleanupCoherent || !processExitFailureCoherent ||
    !observedFailureCoherent ||
    (result.status === 0 && !processSuccess && !(
      completion === "process_exit" && result.cleanupConfirmed === false
    ))
  ) throw new Error("Runtime returned an invalid generated visual browser result.");
  return {
    result: {
      status: result.status as number | null,
      signal: result.signal as string | null,
      stdout: result.stdout,
      stderr: result.stderr,
      ...(result.error === null ? {} : { error: result.error as { code: string; message: string } }),
      durationMs: result.durationMs as number,
      timedOut: result.timedOut,
      completion,
      browserExitedNaturally: result.browserExitedNaturally,
      cleanupMethod,
      cleanupConfirmed: result.cleanupConfirmed,
    },
    screenshot: result.screenshot as BrowserResultEnvelope["screenshot"],
  };
}

function runtimeDataRoot(): string {
  const configured = process.env.BREADBOARD_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : repositoryRoot();
}

function expectedScreenshotPath(job: RuntimeJobSnapshot): string {
  if (!job.workerInstanceId) throw new Error("The generated visual browser worker has no fence.");
  return path.resolve(
    runtimeDataRoot(), "runtime", "jobs", job.jobId, "attempts", String(job.attempt),
    job.workerInstanceId, "workspace", "generated-visual-browser-output", "screenshot.png",
  );
}

function materializeScreenshot(
  job: RuntimeJobSnapshot,
  receipt: BrowserResultEnvelope["screenshot"],
  destination: string,
): void {
  if (!receipt) return;
  const expected = expectedScreenshotPath(job);
  const expectedRelative = path.relative(runtimeDataRoot(), expected).split(path.sep).join("/");
  if (receipt.relativePath !== expectedRelative || !directFile(expected)) {
    throw new Error("Runtime returned a generated visual screenshot outside its worker fence.");
  }
  const metadata = fs.lstatSync(expected);
  const bytes = fs.readFileSync(expected);
  if (
    metadata.size !== receipt.sizeBytes || bytes.byteLength !== receipt.sizeBytes ||
    createHash("sha256").update(bytes).digest("hex") !== receipt.sha256
  ) throw new Error("The generated visual screenshot receipt does not match its artifact.");
  fs.writeFileSync(destination, bytes);
}

function removeExistingScreenshot(target: string | null): void {
  if (!target) return;
  try {
    const metadata = fs.lstatSync(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("The generated visual screenshot target is indirect.");
    }
    fs.rmSync(target, { force: true });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error &&
      (error as { code?: unknown }).code === "ENOENT")) throw error;
  }
}

export async function runGeneratedVisualBrowserInvocationViaRuntime(input: {
  userId: number;
  gardenId: string;
  invocation: GeneratedVisualBrowserInvocation;
  signal?: AbortSignal;
  control?: GeneratedVisualBrowserRuntimeControl;
}): Promise<GeneratedVisualBrowserRunResult> {
  const parsed = parseGeneratedVisualBrowserInvocation(input.invocation);
  removeExistingScreenshot(parsed.screenshotPath);
  const html = fs.readFileSync(parsed.htmlPath);
  const jobAuthority = authority(input.userId, input.gardenId);
  const control = input.control ?? DEFAULT_CONTROL;
  const reservation = await control.reserve(jobAuthority, {
    gardenId: jobAuthority.gardenId,
    conversationId: null,
    displayName: SOURCE_DISPLAY_NAME,
    mediaType: SOURCE_MEDIA_TYPE,
    declaredSizeBytes: html.byteLength,
  });
  let submitted = false;
  let job: RuntimeJobSnapshot | null = null;
  try {
    const uploaded = await control.upload(
      jobAuthority,
      reservation,
      Readable.toWeb(Readable.from([html])) as ReadableStream<Uint8Array>,
      input.signal,
    );
    const idempotencyKey = `generated-visual-browser-v2:${createHash("sha256")
      .update(`${input.userId}:${input.gardenId}:${input.invocation.slug}:${randomUUID()}`, "utf8")
      .digest("hex")}`;
    job = await control.submit(jobAuthority, {
      jobType: JOB_TYPE,
      idempotencyKey,
      inputUploads: [{ uploadId: uploaded.uploadId }],
      requestPayload: parsed.request,
    });
    submitted = true;
    job = await waitForJob(control, jobAuthority, job, parsed.request.timeoutMs, input.signal);
    if (job.state !== "succeeded") {
      return {
        status: null,
        signal: job.state === "cancelled" ? "SIGTERM" : null,
        stdout: "",
        stderr: "",
        error: {
          code: job.state === "cancelled"
            ? "ECANCELLED"
            : job.state === "resource_exhausted"
              ? "BREADBOARD_RESOURCE_EXHAUSTED"
              : "ERUNTIME",
          message: job.failureMessage ?? `Generated visual browser work ended as ${job.state}.`,
        },
        durationMs: 0,
        timedOut: false,
        ...(job.state === "cancelled" ? { completion: "cancelled" as const } : {}),
        browserExitedNaturally: false,
        cleanupMethod: "process-kill",
        // A terminal Runtime snapshot proves job state, not descendant
        // quiescence. Only a fenced worker result may confirm browser cleanup.
        cleanupConfirmed: false,
      };
    }
    const output = await control.readOutput(jobAuthority, job.jobId, "result");
    const envelope = parseGeneratedVisualBrowserRuntimeResult(job, output.content);
    if (parsed.screenshotPath === null && envelope.screenshot !== null) {
      throw new Error("Runtime returned an inconsistent generated visual screenshot receipt.");
    }
    if (parsed.screenshotPath && envelope.screenshot) {
      materializeScreenshot(job, envelope.screenshot, parsed.screenshotPath);
    }
    return envelope.result;
  } catch (error) {
    if (job && !TERMINAL_STATES.has(job.state)) {
      await control.cancel(jobAuthority, job.jobId).catch(() => undefined);
    }
    throw error;
  } finally {
    if (!submitted) {
      await control.abandon(jobAuthority, reservation.uploadId).catch(() => undefined);
    }
    if (job?.workerInstanceId) {
      fs.rmSync(path.dirname(expectedScreenshotPath(job)), {
        recursive: true,
        force: true,
        maxRetries: process.platform === "win32" ? 10 : 0,
        retryDelay: 100,
      });
    }
  }
}

export async function runGeneratedVisualBrowserTestsViaRuntime(input: {
  userId: number;
  gardenId: string;
  definition: GeneratedVisualizationDefinition;
  outputDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  control?: GeneratedVisualBrowserRuntimeControl;
}): ReturnType<typeof runGeneratedVisualBrowserTests> {
  return await runGeneratedVisualBrowserTests({
    definition: input.definition,
    outputDir: input.outputDir,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    browserExecutable: RUNTIME_BROWSER_SENTINEL,
    browserRunner: (invocation) => runGeneratedVisualBrowserInvocationViaRuntime({
      userId: input.userId,
      gardenId: input.gardenId,
      invocation,
      signal: input.signal,
      control: input.control,
    }),
  });
}
