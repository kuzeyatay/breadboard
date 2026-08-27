// The loopback client for the Python humanizer service.
//
// Server-only. The base URL and the shared secret live in the Next.js server
// process and never reach a browser: callers receive two strings and a list of
// warning codes, never a service address, a port, a model cache path or a
// credential.
//
// Every call answers rather than throws, and every failure is one of a closed
// set of reasons. Each caller has a state for them; an unhandled
// exception would collapse them all into "something went wrong", which is the
// one thing a person deciding whether to trust a rewrite cannot act on.
//
// There is no provider fallback anywhere in this file. When the local service
// cannot answer, the answer is that it cannot answer.

import {
  humanizerBaseUrl,
  humanizerDevice,
  humanizerMode,
  humanizerServiceSecret,
  humanizerTimeoutMs,
} from "./config.ts";
import {
  SupervisorResourceExhaustedError,
  withServiceLease,
} from "../supervisor-control.ts";

export type HumanizerModelState = "not_installed" | "installed_not_loaded" | "loaded" | "unknown";

export interface HumanizerHealth {
  status: "ok" | "busy" | "degraded" | "unreachable";
  modelState: HumanizerModelState;
  serviceVersion: string;
  pythonVersion: string;
  torchVersion: string;
  transformersVersion: string;
  cudaVersion: string;
  modelId: string;
  modelRevision: string;
  device: string;
  dtype: string;
  modelLoaded: boolean;
  modelInstalled: boolean;
  busy: boolean;
  detail: string;
}

export interface HumanizerWarning {
  code: string;
  chunkIndex: number;
  kinds: string[];
  count: number;
}

export interface HumanizerRewrite {
  requestId: string;
  status: "complete" | "preservation_failed";
  modelId: string;
  modelRevision: string;
  device: string;
  dtype: string;
  originalText: string;
  rewrittenText: string;
  chunks: { total: number; rewritten: number; reverted: number };
  preservation: { passed: boolean; warnings: HumanizerWarning[] };
  timingMs: { load: number; inference: number; total: number };
}

/** The closed set of ways a rewrite can fail to happen. */
export type HumanizerFailureReason =
  | "disabled"
  | "unavailable"
  | "not_installed"
  | "busy"
  | "cancelled"
  | "timeout"
  | "invalid_input"
  | "preservation_failed"
  | "inference_failed";

export interface HumanizerFailure {
  ok: false;
  reason: HumanizerFailureReason;
  detail: string;
}

export type HumanizerResult = ({ ok: true } & HumanizerRewrite) | HumanizerFailure;

const HEALTH_TIMEOUT_MS = 5_000;

function unreachable(detail: string): HumanizerHealth {
  return {
    status: "unreachable",
    modelState: "unknown",
    serviceVersion: "",
    pythonVersion: "",
    torchVersion: "",
    transformersVersion: "",
    cudaVersion: "",
    modelId: "",
    modelRevision: "",
    device: "",
    dtype: "",
    modelLoaded: false,
    modelInstalled: false,
    busy: false,
    detail,
  };
}

interface CallOutcome {
  status: number;
  body: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function call(
  route: string,
  init: { method: string; body?: unknown; timeoutMs: number; signal?: AbortSignal },
  env: NodeJS.ProcessEnv = process.env,
): Promise<CallOutcome | { aborted: boolean } | null> {
  const secret = humanizerServiceSecret(env);
  if (!secret) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), init.timeoutMs);
  // A browser that went away must not leave a beam search running. The caller's
  // signal is forwarded so the fetch is torn down, and `/cancel` below tells the
  // service to stop between chunks rather than finish the job for nobody.
  const forwardAbort = () => controller.abort(new Error("cancelled"));
  if (init.signal?.aborted) forwardAbort();
  else init.signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const perform = async () => {
      const response = await fetch(`${humanizerBaseUrl(env)}${route}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${secret}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }
      return { status: response.status, body: parsed };
    };
    return route === "/health"
      ? await perform()
      : await withServiceLease("humanizer", "rewrite", perform, env);
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) throw error;
    // A service that is not running is the ordinary case on a machine that
    // never ran setup, not an exception worth propagating.
    if (init.signal?.aborted) return { aborted: true };
    if (controller.signal.aborted) return { aborted: false };
    return null;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", forwardAbort);
  }
}

function isOutcome(value: unknown): value is CallOutcome {
  return typeof value === "object" && value !== null && "status" in value;
}

export async function humanizerHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HumanizerHealth> {
  if (humanizerMode(env) === "disabled") {
    return unreachable("The humanizer is turned off.");
  }
  const result = await call("/health", { method: "GET", timeoutMs: HEALTH_TIMEOUT_MS }, env);
  if (!isOutcome(result)) return unreachable("The humanizer service is not running.");
  if (result.status !== 200) {
    return unreachable(`The humanizer service answered ${result.status}.`);
  }
  if (!isRecord(result.body)) {
    return unreachable("The humanizer service returned an invalid health response.");
  }
  const body = result.body;
  const modelState = String(body.modelState ?? "");
  return {
    status:
      body.status === "ok" ? "ok" : body.status === "busy" ? "busy" : "degraded",
    modelState:
      modelState === "not_installed" ||
      modelState === "installed_not_loaded" ||
      modelState === "loaded"
        ? modelState
        : "unknown",
    serviceVersion: String(body.serviceVersion ?? ""),
    pythonVersion: String(body.pythonVersion ?? ""),
    torchVersion: String(body.torchVersion ?? ""),
    transformersVersion: String(body.transformersVersion ?? ""),
    cudaVersion: String(body.cudaVersion ?? ""),
    modelId: String(body.modelId ?? ""),
    modelRevision: String(body.modelRevision ?? ""),
    device: String(body.device ?? ""),
    dtype: String(body.dtype ?? ""),
    modelLoaded: body.modelLoaded === true,
    modelInstalled: body.modelInstalled === true,
    busy: body.busy === true,
    detail: String(body.detail ?? ""),
  };
}

function parseWarnings(value: unknown): HumanizerWarning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): HumanizerWarning[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const code = String(record.code ?? "");
    if (!code) return [];
    return [
      {
        code,
        chunkIndex: Number.isInteger(record.chunkIndex) ? (record.chunkIndex as number) : -1,
        kinds: Array.isArray(record.kinds) ? record.kinds.map((kind) => String(kind)) : [],
        count: Number.isFinite(Number(record.count)) ? Number(record.count) : 0,
      },
    ];
  });
}

function terminalRewrittenText(value: unknown): boolean {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  const fenced = /^```(?:json|markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/i.exec(
    trimmed,
  );
  return (fenced?.[1] ?? trimmed).trim() === "null";
}

function invalidRewriteProtocol(detail: string): HumanizerFailure {
  return {
    ok: false,
    reason: "inference_failed",
    detail,
  };
}

export async function humanizerRewrite(
  input: { requestId: string; text: string; maxChunkTokens?: number; signal?: AbortSignal },
  env: NodeJS.ProcessEnv = process.env,
): Promise<HumanizerResult> {
  if (humanizerMode(env) === "disabled") {
    return { ok: false, reason: "disabled", detail: "The humanizer is turned off." };
  }

  const result = await call(
    "/humanize",
    {
      method: "POST",
      body: {
        requestId: input.requestId,
        text: input.text,
        mode: "natural",
        ...(input.maxChunkTokens ? { maxChunkTokens: input.maxChunkTokens } : {}),
      },
      timeoutMs: humanizerTimeoutMs(env),
      ...(input.signal ? { signal: input.signal } : {}),
    },
    env,
  );

  if (result === null) {
    return {
      ok: false,
      reason: "unavailable",
      detail: "The humanizer service is not running on this machine.",
    };
  }
  if (!isOutcome(result)) {
    return result.aborted
      ? { ok: false, reason: "cancelled", detail: "The rewrite was cancelled." }
      : { ok: false, reason: "timeout", detail: "The rewrite took too long and was stopped." };
  }

  if (result.status === 409) {
    return {
      ok: false,
      reason: "not_installed",
      detail: "The humanizer model has not been downloaded on this machine.",
    };
  }
  const errorBody = isRecord(result.body) ? result.body : {};
  if (result.status === 503) {
    const error = String(errorBody.error ?? "");
    return error === "humanizer_busy"
      ? { ok: false, reason: "busy", detail: "The humanizer is already rewriting something." }
      : {
          ok: false,
          reason: "inference_failed",
          detail: String(errorBody.detail ?? "The model could not be loaded."),
        };
  }
  if (result.status === 499) {
    return { ok: false, reason: "cancelled", detail: "The rewrite was cancelled." };
  }
  if (result.status === 413 || result.status === 422 || result.status === 400) {
    return {
      ok: false,
      reason: "invalid_input",
      detail: String(errorBody.detail ?? errorBody.error ?? "The text could not be rewritten."),
    };
  }
  if (result.status !== 200) {
    return {
      ok: false,
      reason: "inference_failed",
      detail: `The humanizer service answered ${result.status}.`,
    };
  }

  if (!isRecord(result.body)) {
    return invalidRewriteProtocol(
      "The humanizer service returned no structured rewrite candidate.",
    );
  }
  const body = result.body;
  if (body.status !== "complete" && body.status !== "preservation_failed") {
    return invalidRewriteProtocol(
      "The humanizer service returned a rewrite candidate without a valid status.",
    );
  }
  if (terminalRewrittenText(body.rewrittenText)) {
    return invalidRewriteProtocol(
      "The humanizer service returned no substantive rewrite candidate.",
    );
  }
  if (
    !isRecord(body.preservation) ||
    typeof body.preservation.passed !== "boolean"
  ) {
    return invalidRewriteProtocol(
      "The humanizer service returned a rewrite candidate without a preservation verdict.",
    );
  }
  const preservation = body.preservation;
  const chunks = isRecord(body.chunks) ? body.chunks : {};
  const timing = isRecord(body.timingMs) ? body.timingMs : {};
  const rewrite: HumanizerRewrite = {
    requestId: String(body.requestId ?? input.requestId),
    status: body.status,
    modelId: String(body.modelId ?? ""),
    modelRevision: String(body.modelRevision ?? ""),
    device: String(body.device ?? ""),
    dtype: String(body.dtype ?? ""),
    originalText: String(body.originalText ?? input.text),
    rewrittenText: body.rewrittenText as string,
    chunks: {
      total: Number(chunks.total ?? 0),
      rewritten: Number(chunks.rewritten ?? 0),
      reverted: Number(chunks.reverted ?? 0),
    },
    preservation: {
      passed: preservation.passed === true,
      warnings: parseWarnings(preservation.warnings),
    },
    timingMs: {
      load: Number(timing.load ?? 0),
      inference: Number(timing.inference ?? 0),
      total: Number(timing.total ?? 0),
    },
  };

  if (rewrite.status === "preservation_failed" || !rewrite.preservation.passed) {
    return {
      ok: false,
      reason: "preservation_failed",
      detail:
        "The rewrite did not preserve the document's structure or its facts, so it was discarded.",
    };
  }

  return { ok: true, ...rewrite };
}

/**
 * Tell the service to stop between chunks.
 *
 * Best effort by design: the browser has already gone, so there is nobody to
 * report a failed cancellation to. What matters is that a long multi-chunk job
 * does not keep the service busy after the caller stops waiting.
 */
export async function humanizerCancel(
  requestId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (humanizerMode(env) === "disabled") return;
  await call("/cancel", { method: "POST", body: { requestId }, timeoutMs: HEALTH_TIMEOUT_MS }, env);
}

/** What the dashboard expects, for side-by-side comparison with health. */
export function humanizerExpectation(env: NodeJS.ProcessEnv = process.env) {
  return { device: humanizerDevice(env), mode: humanizerMode(env) };
}
