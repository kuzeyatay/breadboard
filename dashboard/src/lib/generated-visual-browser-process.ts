import { spawn, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import type { Readable } from "node:stream";

import {
  confirmNaturalBrowserClose,
  ownedBrowserWrapperInvocation,
  PROCESS_SNAPSHOT_TIMEOUT_MS,
  terminateOwnedBrowserTree,
  TREE_CLOSE_TIMEOUT_MS,
  TREE_KILLER_TIMEOUT_MS,
  TREE_QUIESCENCE_TIMEOUT_MS,
  trustedWindowsPowerShell,
  trustedWindowsTreeKiller,
  windowsProcessSnapshot,
} from "../../scripts/runtime-v2-interactive-visualizer-executor.mjs";

type BrowserChild = ChildProcessByStdio<null, Readable, Readable>;

const GENERATED_VISUAL_BROWSER_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const GENERATED_VISUAL_BROWSER_MARKER_OVERLAP_CHARS = 16;
const GENERATED_VISUAL_BROWSER_SCHEDULER_ALLOWANCE_MS = 1_000;

/** Maximum wall time for one attempt: the longer of the operation deadline or
 * its in-flight initial ownership snapshot, then one final snapshot, bounded
 * tree termination, two-scan lineage quiescence, root-close proof, and a small
 * scheduler allowance. */
export function generatedVisualBrowserAttemptDurationBoundMs(
  operationTimeoutMs: number,
): number {
  const boundedOperationTimeout = Number.isFinite(operationTimeoutMs)
    ? Math.max(0, Math.ceil(operationTimeoutMs))
    : 0;
  return Math.max(boundedOperationTimeout, PROCESS_SNAPSHOT_TIMEOUT_MS) +
    PROCESS_SNAPSHOT_TIMEOUT_MS +
    TREE_KILLER_TIMEOUT_MS +
    TREE_QUIESCENCE_TIMEOUT_MS +
    TREE_CLOSE_TIMEOUT_MS +
    GENERATED_VISUAL_BROWSER_SCHEDULER_ALLOWANCE_MS;
}

export type GeneratedVisualBrowserCompletion =
  | "process_exit"
  | "observed_dom"
  | "observed_capture"
  | "spawn_error"
  | "deadline"
  | "cancelled"
  | "output_overflow";

export type GeneratedVisualBrowserCleanupMethod =
  | "none"
  | "natural-exit"
  | "natural-exit-lineage"
  | "natural-exit-unconfirmed"
  | "taskkill-tree"
  | "lineage-quiescence"
  | "natural-exit-race"
  | "process-group"
  | "process-group-sigkill"
  | "process-kill";

const GENERATED_VISUAL_BROWSER_CLEANUP_METHODS = new Set<
  GeneratedVisualBrowserCleanupMethod
>([
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

export interface GeneratedVisualObservedBrowserResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: { message?: string; code?: string | number };
  durationMs: number;
  timedOut: boolean;
  completion?: GeneratedVisualBrowserCompletion;
  browserExitedNaturally: boolean;
  cleanupMethod: GeneratedVisualBrowserCleanupMethod;
  cleanupConfirmed: boolean;
}

export interface GeneratedVisualObservedBrowserInput {
  executable: string;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** Test-only observer for deterministic terminal-race assertions. */
  onTerminalLatched?: (completion: GeneratedVisualBrowserCompletion) => void;
  /** Test-only natural-close proof seam for parser/cleanup integration. */
  naturalCloseProof?: typeof confirmNaturalBrowserClose;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}

function errorCode(error: unknown, fallback: string): string | number {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") return code;
  }
  return fallback;
}

function exactCleanupMethod(
  method: unknown,
): GeneratedVisualBrowserCleanupMethod | null {
  return typeof method === "string" &&
      GENERATED_VISUAL_BROWSER_CLEANUP_METHODS.has(
        method as GeneratedVisualBrowserCleanupMethod,
      )
    ? method as GeneratedVisualBrowserCleanupMethod
    : null;
}

function screenshotReceipt(args: readonly string[], stderr: string): boolean | undefined {
  const screenshotArg = args.find((arg) => arg.startsWith("--screenshot="));
  if (!screenshotArg) return undefined;
  const screenshotPath = screenshotArg.slice("--screenshot=".length);
  const receipts = Array.from(stderr.matchAll(/(\d+)\s+bytes written to file\b/giu));
  const receipt = receipts.at(-1);
  if (!receipt) return false;
  const expectedBytes = Number(receipt[1]);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) return false;
  try {
    const stats = fs.statSync(screenshotPath);
    return stats.isFile() && stats.size === expectedBytes;
  } catch {
    return false;
  }
}

/**
 * Run one isolated browser command and resolve when either the process exits or
 * its observable DOM/screenshot receipts are complete. The implementation is
 * asynchronous so a Runtime worker can keep servicing its graceful-stop pipe;
 * Rust remains the final owner of the worker and every browser descendant.
 */
export async function runObservedGeneratedVisualBrowserProcess(
  input: GeneratedVisualObservedBrowserInput,
): Promise<GeneratedVisualObservedBrowserResult> {
  const startedAt = Date.now();
  if (input.signal?.aborted) {
    return {
      status: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      error: { code: "ECANCELLED", message: "Browser invocation was cancelled." },
      durationMs: 0,
      timedOut: false,
      completion: "cancelled",
      browserExitedNaturally: false,
      cleanupMethod: "none",
      cleanupConfirmed: true,
    };
  }

  const platform = process.platform;
  const accountingEnv = process.env;
  const taskkill = platform === "win32"
    ? trustedWindowsTreeKiller(accountingEnv)
    : null;
  const powershell = platform === "win32"
    ? trustedWindowsPowerShell(accountingEnv)
    : null;
  if (platform === "win32" && (!taskkill || !powershell)) {
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error: {
        code: "EPROCESSAUTH",
        message: "Trusted Windows browser process-tree accounting is unavailable.",
      },
      durationMs: Math.max(0, Date.now() - startedAt),
      timedOut: false,
      completion: "spawn_error",
      browserExitedNaturally: false,
      cleanupMethod: "none",
      cleanupConfirmed: true,
    };
  }

  return await new Promise((resolve) => {
    let child: BrowserChild;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let childClosed = false;
    let exitStatus: number | null = null;
    let exitSignal: string | null = null;
    let completion: GeneratedVisualBrowserCompletion | undefined;
    let timedOut = false;
    let failure: GeneratedVisualObservedBrowserResult["error"];
    let cleanupStarted = false;
    let cleanupConfirmed = false;
    let cleanupMethod: GeneratedVisualObservedBrowserResult["cleanupMethod"] =
      "process-kill";
    let browserExitedNaturally = false;
    let terminalLatched = false;
    let settled = false;
    const timers: { operation?: NodeJS.Timeout } = {};
    let bodyObserved = false;
    let htmlCloseObserved = false;
    let stdoutMarkerTail = "";
    let initialRowsPromise: Promise<unknown[] | null> = Promise.resolve(null);
    let resolveChildClose: (() => void) | undefined;
    const childClosePromise = new Promise<void>((closed) => {
      resolveChildClose = closed;
    });

    const clearTimers = () => {
      if (timers.operation) clearTimeout(timers.operation);
    };
    const latchTerminal = (next: GeneratedVisualBrowserCompletion): boolean => {
      if (terminalLatched || settled) return false;
      terminalLatched = true;
      completion = next;
      clearTimers();
      try {
        input.onTerminalLatched?.(next);
      } catch {
        // A diagnostic observer cannot alter terminal ownership.
      }
      return true;
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      input.signal?.removeEventListener("abort", onAbort);
      const observed = completion === "observed_dom" ||
        completion === "observed_capture";
      const cleanupFailure = !cleanupConfirmed;
      const error = failure ?? (cleanupFailure
        ? { code: "ECLEANUP", message: "Browser process tree did not confirm cleanup." }
        : undefined);
      const terminalFailure = Boolean(error) || timedOut || cleanupFailure;
      const successfulObservedCompletion = observed && !terminalFailure;
      const naturalProcessExit = completion === "process_exit";
      resolve({
        status: successfulObservedCompletion
          ? 0
          : (naturalProcessExit ? exitStatus : (terminalFailure ? null : exitStatus)),
        signal: successfulObservedCompletion
          ? null
          : (naturalProcessExit
              ? exitSignal
              : (timedOut ? (exitSignal || "SIGTERM") : exitSignal)),
        stdout,
        stderr,
        ...(error ? { error } : {}),
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut,
        ...(completion ? { completion } : {}),
        browserExitedNaturally,
        cleanupMethod,
        cleanupConfirmed,
      });
    };
    const waitForChildClose = async (): Promise<boolean> => {
      if (childClosed) return true;
      let closeTimer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          childClosePromise.then(() => true),
          new Promise<false>((closed) => {
            closeTimer = setTimeout(
              () => closed(false),
              TREE_CLOSE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (closeTimer) clearTimeout(closeTimer);
      }
    };
    const beginCleanup = () => {
      if (cleanupStarted || settled) return;
      cleanupStarted = true;
      void (async () => {
        const initialRows = await initialRowsPromise;
        const termination = await terminateOwnedBrowserTree(
          child,
          platform,
          accountingEnv,
          taskkill,
          { powershell, initialRows },
        );
        const exactMethod = exactCleanupMethod(termination.method);
        if (exactMethod === null) {
          failure ??= {
            code: "ECLEANUP",
            message: "Browser process-tree cleanup returned an unknown method.",
          };
        } else {
          cleanupMethod = exactMethod;
        }
        const closed = await waitForChildClose();
        cleanupConfirmed = exactMethod !== null &&
          termination.confirmed === true && closed;
        finish();
      })().catch((error) => {
        failure ??= {
          code: errorCode(error, "ECLEANUP"),
          message: errorText(error),
        };
        finish();
      });
    };
    const observeCompletion = () => {
      if (cleanupStarted || settled || !bodyObserved || !htmlCloseObserved) return;
      const screenshotComplete = screenshotReceipt(input.args, stderr);
      let observedCompletion: GeneratedVisualBrowserCompletion;
      if (screenshotComplete === undefined) observedCompletion = "observed_dom";
      else if (screenshotComplete) observedCompletion = "observed_capture";
      else return;
      if (!latchTerminal(observedCompletion)) return;
      beginCleanup();
    };
    const appendOutput = (channel: "stdout" | "stderr", chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      const bytes = Buffer.byteLength(text, "utf8");
      if (channel === "stdout") {
        stdoutBytes += bytes;
        const markerWindow = `${stdoutMarkerTail}${text}`.toLowerCase();
        bodyObserved ||= markerWindow.includes("<body");
        htmlCloseObserved ||= markerWindow.includes("</html>");
        stdoutMarkerTail = markerWindow.slice(
          -GENERATED_VISUAL_BROWSER_MARKER_OVERLAP_CHARS,
        );
        if (stdoutBytes <= GENERATED_VISUAL_BROWSER_MAX_OUTPUT_BYTES) {
          stdout += text;
        }
      } else {
        stderrBytes += bytes;
        if (stderrBytes <= GENERATED_VISUAL_BROWSER_MAX_OUTPUT_BYTES) stderr += text;
      }
      if (
        stdoutBytes > GENERATED_VISUAL_BROWSER_MAX_OUTPUT_BYTES ||
        stderrBytes > GENERATED_VISUAL_BROWSER_MAX_OUTPUT_BYTES
      ) {
        if (!latchTerminal("output_overflow")) return;
        failure = {
          code: "ENOBUFS",
          message: "Browser output exceeded the bounded diagnostic buffer.",
        };
        beginCleanup();
        return;
      }
      observeCompletion();
    };
    const onAbort = () => {
      if (!latchTerminal("cancelled")) return;
      failure = { code: "ECANCELLED", message: "Browser invocation was cancelled." };
      if (!cleanupStarted) beginCleanup();
    };

    try {
      const wrapper = ownedBrowserWrapperInvocation(input.executable, input.args);
      if (!wrapper) {
        resolve({
          status: null,
          signal: null,
          stdout,
          stderr,
          error: {
            code: "EWRAPPER",
            message: "Browser invocation did not resolve to a direct, owned executable.",
          },
          durationMs: Math.max(0, Date.now() - startedAt),
          timedOut: false,
          completion: "spawn_error",
          browserExitedNaturally: false,
          cleanupMethod: "none",
          cleanupConfirmed: true,
        });
        return;
      }
      child = spawn(wrapper.executable, wrapper.args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        detached: platform !== "win32",
        ...(input.env ? { env: input.env } : {}),
      });
    } catch (error) {
      resolve({
        status: null,
        signal: null,
        stdout,
        stderr,
        error: { code: errorCode(error, "ESPAWN"), message: errorText(error) },
        durationMs: Math.max(0, Date.now() - startedAt),
        timedOut: false,
        completion: "spawn_error",
        browserExitedNaturally: false,
        cleanupMethod: "none",
        cleanupConfirmed: true,
      });
      return;
    }
    initialRowsPromise = platform === "win32"
      ? windowsProcessSnapshot(accountingEnv, powershell)
      : Promise.resolve(null);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));
    child.once("error", (error) => {
      if (!latchTerminal("spawn_error")) return;
      failure = { code: errorCode(error, "ESPAWN"), message: errorText(error) };
      if (Number.isSafeInteger(child.pid) && Number(child.pid) > 0) {
        beginCleanup();
      } else {
        cleanupMethod = "none";
        cleanupConfirmed = true;
        finish();
      }
    });
    child.once("close", (status, signal) => {
      childClosed = true;
      resolveChildClose?.();
      exitStatus = status;
      exitSignal = signal;
      if (cleanupStarted || !latchTerminal("process_exit")) return;
      cleanupStarted = true;
      browserExitedNaturally = true;
      void (async () => {
        const initialRows = await initialRowsPromise;
        const cleanup = await (input.naturalCloseProof ?? confirmNaturalBrowserClose)(
          child,
          platform,
          accountingEnv,
          taskkill,
          { powershell, initialRows },
        );
        const exactMethod = exactCleanupMethod(cleanup.method);
        if (exactMethod === null) {
          failure ??= {
            code: "ECLEANUP",
            message: "Natural browser cleanup returned an unknown method.",
          };
        } else {
          cleanupMethod = exactMethod;
        }
        cleanupConfirmed = exactMethod !== null && cleanup.confirmed === true;
        finish();
      })().catch((error) => {
        failure ??= {
          code: errorCode(error, "ECLEANUP"),
          message: errorText(error),
        };
        finish();
      });
    });
    timers.operation = setTimeout(() => {
      if (!latchTerminal("deadline")) return;
      timedOut = true;
      failure = {
        code: "ETIMEDOUT",
        message: "Browser did not produce complete observable output before its deadline.",
      };
      beginCleanup();
    }, input.timeoutMs);
    timers.operation.unref?.();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
  });
}
