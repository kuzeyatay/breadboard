// The loopback client for the Python ColPali service.
//
// Server-only. The base URL and the shared secret live in the Next.js server
// process and never reach a browser: a chat receives page numbers and page
// images, never a service address or a credential.
//
// Every call here answers rather than throws. Retrieval is an *improvement* on
// inlining a whole document, not a replacement for having one — so a service
// that is down, unbuilt, busy or holding a stale index must leave the caller
// with something to fall back to. That is why the return types carry a reason
// instead of the functions raising.

import {
  colpaliBaseUrl,
  colpaliMode,
  colpaliServiceSecret,
  colpaliTopK,
} from "./config.ts";
import {
  SupervisorResourceExhaustedError,
  withServiceLease,
} from "../supervisor-control.ts";

export interface ColpaliHealth {
  status: "ok" | "degraded" | "unreachable";
  serviceVersion: string;
  pythonVersion: string;
  torchVersion: string;
  cudaVersion: string;
  modelId: string;
  device: string;
  dtype: string;
  modelLoaded: boolean;
  indexedDocuments: number;
  detail: string;
}

export interface ColpaliPageImage {
  pageNumber: number;
  /** Base64 PNG or JPEG, with or without a data-URL prefix. */
  imageBase64: string;
}

export interface ColpaliIndexResult {
  ok: boolean;
  pages: number;
  dimensions: number;
  modelId: string;
  truncated: boolean;
  detail: string;
}

export interface ColpaliScoredPage {
  pageNumber: number;
  score: number;
}

export interface ColpaliSearchResult {
  ok: boolean;
  /** Empty whenever `ok` is false — the caller inlines the document instead. */
  pages: ColpaliScoredPage[];
  /** `not_indexed`, `stale_index`, `unreachable`, `disabled`, … */
  reason: string;
}

/** Indexing a long document is minutes of GPU work; a query is milliseconds. */
const INDEX_TIMEOUT_MS = 15 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 30 * 1000;
const HEALTH_TIMEOUT_MS = 5 * 1000;

function unreachable(detail: string): ColpaliHealth {
  return {
    status: "unreachable",
    serviceVersion: "",
    pythonVersion: "",
    torchVersion: "",
    cudaVersion: "",
    modelId: "",
    device: "",
    dtype: "",
    modelLoaded: false,
    indexedDocuments: 0,
    detail,
  };
}

async function call(
  path: string,
  init: { method: string; body?: unknown; timeoutMs: number; signal?: AbortSignal },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const secret = colpaliServiceSecret(env);
  if (!secret) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  const onAbort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) onAbort();
  else init.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const perform = async () => {
      const response = await fetch(`${colpaliBaseUrl(env)}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${secret}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }
      return { status: response.status, body: parsed };
    };
    return path === "/health"
      ? await perform()
      : await withServiceLease("colpali", "visual-document", perform, env);
  } catch (error) {
    if (error instanceof SupervisorResourceExhaustedError) throw error;
    if (init.signal?.aborted) {
      throw init.signal.reason instanceof Error
        ? init.signal.reason
        : new DOMException("The request was aborted.", "AbortError");
    }
    // A service that is not running is the ordinary case on a machine that
    // never ran setup, not an exception worth propagating.
    return null;
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

export async function colpaliHealth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ColpaliHealth> {
  if (colpaliMode(env) === "disabled") return unreachable("ColPali is turned off.");
  const result = await call("/health", { method: "GET", timeoutMs: HEALTH_TIMEOUT_MS }, env);
  if (!result) return unreachable("The ColPali service is not running.");
  if (result.status !== 200) {
    return unreachable(`The ColPali service answered ${result.status}.`);
  }
  const body = result.body;
  return {
    status: body.status === "ok" ? "ok" : "degraded",
    serviceVersion: String(body.serviceVersion ?? ""),
    pythonVersion: String(body.pythonVersion ?? ""),
    torchVersion: String(body.torchVersion ?? ""),
    cudaVersion: String(body.cudaVersion ?? ""),
    modelId: String(body.modelId ?? ""),
    device: String(body.device ?? ""),
    dtype: String(body.dtype ?? ""),
    modelLoaded: body.modelLoaded === true,
    indexedDocuments: Number(body.indexedDocuments ?? 0),
    detail: String(body.detail ?? ""),
  };
}

export async function colpaliIndex(
  documentId: string,
  pages: readonly ColpaliPageImage[],
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<ColpaliIndexResult> {
  const failed = (detail: string): ColpaliIndexResult => ({
    ok: false,
    pages: 0,
    dimensions: 0,
    modelId: "",
    truncated: false,
    detail,
  });
  if (colpaliMode(env) === "disabled") return failed("ColPali is turned off.");
  if (pages.length === 0) return failed("The document produced no page images.");

  const result = await call(
    "/index",
    { method: "POST", body: { documentId, pages }, timeoutMs: INDEX_TIMEOUT_MS, signal },
    env,
  );
  if (!result) return failed("The ColPali service is not running.");
  if (result.status !== 200) {
    return failed(
      String(result.body.detail ?? result.body.error ?? `the service answered ${result.status}`),
    );
  }
  return {
    ok: true,
    pages: Number(result.body.pages ?? 0),
    dimensions: Number(result.body.dimensions ?? 0),
    modelId: String(result.body.modelId ?? ""),
    truncated: result.body.truncated === true,
    detail: "",
  };
}

export async function colpaliSearch(
  documentId: string,
  query: string,
  env: NodeJS.ProcessEnv = process.env,
  topK: number = colpaliTopK(env),
  signal?: AbortSignal,
): Promise<ColpaliSearchResult> {
  if (colpaliMode(env) === "disabled") return { ok: false, pages: [], reason: "disabled" };
  if (!query.trim()) return { ok: false, pages: [], reason: "empty_query" };

  const result = await call(
    "/search",
    { method: "POST", body: { documentId, query, topK }, timeoutMs: SEARCH_TIMEOUT_MS, signal },
    env,
  );
  if (!result) return { ok: false, pages: [], reason: "unreachable" };
  if (result.status !== 200) {
    return { ok: false, pages: [], reason: String(result.body.error ?? `http_${result.status}`) };
  }
  const raw = Array.isArray(result.body.pages) ? result.body.pages : [];
  const pages = raw.flatMap((entry): ColpaliScoredPage[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const pageNumber = Number(record.pageNumber);
    const score = Number(record.score);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isFinite(score)) return [];
    return [{ pageNumber, score }];
  });
  return { ok: pages.length > 0, pages, reason: pages.length > 0 ? "" : "no_pages" };
}

/** Called when a document blob is deleted, so the index does not outlive it. */
export async function colpaliForget(
  documentId: string,
  env: NodeJS.ProcessEnv = process.env,
  signal?: AbortSignal,
): Promise<boolean> {
  const result = await call(
    `/index/${encodeURIComponent(documentId)}`,
    { method: "DELETE", timeoutMs: HEALTH_TIMEOUT_MS, signal },
    env,
  );
  return result?.status === 200 && result.body.deleted === true;
}
