// Process-free adapter for the HunyuanOCR llama-server.
//
// Runtime V2 owns the local model process and holds its service lease for the
// complete ingestion attempt. This module deliberately does only two things:
// build the trusted launch arguments consumed by the native service profile,
// and probe the already-owned endpoint from the disposable ingestion worker.

import {
  vlmOcrServerHost,
  vlmOcrServerIsLocal,
  vlmOcrServerPort,
  type VlmOcrConfig,
  type VlmOcrEnv,
} from "./config.ts";
import { VlmOcrDisabledError, VlmOcrUnavailableError } from "./errors.ts";

export interface VlmOcrProbe {
  ok: boolean;
  /** Model ids reported by /v1/models, when reachable. */
  models: string[];
  detail?: string;
}

export interface VlmOcrStatus extends VlmOcrProbe {
  enabled: boolean;
  baseUrl: string;
  /** True when the endpoint is owned by the Rust Runtime V2 service registry. */
  managed: boolean;
  /** True when a real operation may cold-start the Runtime-owned service. */
  autoStart: boolean;
  /** Which weights the server is (or would be) started with. */
  source: string;
}

const PROBE_TIMEOUT_MS = 2_500;
const RUNTIME_READY_POLL_MS = 500;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal = init.signal;
  const abortOuter = () => controller.abort();
  signal?.addEventListener("abort", abortOuter, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortOuter);
  }
}

/** Ask /v1/models whether a server is listening. Never throws. */
export async function probeVlmOcrServer(
  config: VlmOcrConfig,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<VlmOcrProbe> {
  try {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/models`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
      timeoutMs,
    );
    if (!response.ok) {
      return { ok: false, models: [], detail: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      data?: Array<{ id?: unknown }>;
    };
    const models = (payload?.data ?? [])
      .map((entry) => (typeof entry?.id === "string" ? entry.id : ""))
      .filter(Boolean);
    return { ok: true, models };
  } catch (error) {
    const detail =
      error instanceof Error && error.name === "AbortError"
        ? "no response"
        : "not reachable";
    return { ok: false, models: [], detail };
  }
}

/** Human-readable description of the weights in play. */
export function vlmOcrWeightsSource(config: VlmOcrConfig): string {
  if (config.modelPath && config.mmprojPath) {
    return `${config.modelPath} + ${config.mmprojPath}`;
  }
  return config.hfRepo;
}

/** Trusted argv used by the native `vlm-ocr` service profile. */
export function buildVlmOcrServerArgs(config: VlmOcrConfig): string[] {
  const args: string[] = [
    "--host",
    vlmOcrServerHost(config),
    "--port",
    String(vlmOcrServerPort(config)),
    "--alias",
    "hunyuan-ocr",
    "--ctx-size",
    String(config.contextSize),
    "--n-predict",
    String(config.maxTokens),
    // Keep llama.cpp's slot allocation aligned with the page runner. Recent
    // builds default to four slots, which multiplies the large vision context
    // cache even when ingestion is intentionally sequential.
    "--parallel",
    String(config.concurrency),
    // Every OCR image is unique, so llama.cpp's default 8 GiB prompt cache has
    // no useful hit rate and can retain vision allocations across PDF pages.
    "--cache-ram",
    "0",
    "--no-cache-prompt",
    // HunyuanOCR ships a chat template in the GGUF; the jinja engine is what
    // applies it (and the image placeholders) faithfully.
    "--jinja",
  ];

  if (config.modelPath && config.mmprojPath) {
    args.push("--model", config.modelPath, "--mmproj", config.mmprojPath);
  } else {
    // `-hf repo:quant` pulls both the model and its matching mmproj.
    args.push("-hf", config.hfRepo);
  }

  if (config.gpuLayers !== null) {
    args.push("--n-gpu-layers", String(config.gpuLayers));
  }

  return args;
}

/**
 * This marker is synthesized by the trusted native environment profile. An
 * API request cannot opt into local process ownership or choose an endpoint.
 */
export function vlmOcrRuntimeManaged(env: VlmOcrEnv = process.env): boolean {
  return env.VLM_OCR_RUNTIME_MANAGED?.trim() === "1";
}

function externalEndpointHint(config: VlmOcrConfig): string {
  if (!vlmOcrServerIsLocal(config)) {
    return "Check the configured external OCR endpoint and credentials, then retry.";
  }
  return (
    `Start one with: ${config.serverBinary} -hf ${config.hfRepo} ` +
    `--port ${vlmOcrServerPort(config)} --jinja`
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Confirm that the endpoint already assigned to this disposable worker is
 * ready. The Rust dispatcher acquires the conditional `vlm-ocr` dependency
 * before launching a managed worker. The same lease also survives a supervised
 * service restart, whose admission and model reload can legitimately take much
 * longer than the initial readiness race. Honor the configured startup timeout
 * for both cases so a recoverable service restart cannot fail the whole ingest.
 * This adapter never starts, kills, or supervises a process itself.
 */
export async function ensureVlmOcrServer(
  config: VlmOcrConfig,
  onProgress?: (step: string) => void,
  env: VlmOcrEnv = process.env,
): Promise<void> {
  if (!config.enabled) throw new VlmOcrDisabledError();

  const first = await probeVlmOcrServer(config);
  if (first.ok) return;

  if (!vlmOcrRuntimeManaged(env)) {
    throw new VlmOcrUnavailableError(
      `No OCR model server is answering at ${config.baseUrl}.`,
      externalEndpointHint(config),
    );
  }

  onProgress?.("Waiting for the local OCR model server…");
  const waitMs = config.startupTimeoutMs;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await delay(Math.min(RUNTIME_READY_POLL_MS, deadline - Date.now()));
    const probe = await probeVlmOcrServer(config);
    if (probe.ok) {
      onProgress?.("Local OCR model server is ready.");
      return;
    }
  }

  throw new VlmOcrUnavailableError(
    `The Runtime-owned OCR model server is not answering at ${config.baseUrl}.`,
    "Breadboard could not keep the OCR model service ready for this ingestion attempt.",
  );
}

/** Status for the upload UI. This is observational and never acquires a lease. */
export async function vlmOcrStatus(
  config: VlmOcrConfig,
  env: VlmOcrEnv = process.env,
): Promise<VlmOcrStatus> {
  const probe = config.enabled
    ? await probeVlmOcrServer(config)
    : { ok: false, models: [], detail: "disabled" };
  const managed = config.enabled && vlmOcrRuntimeManaged(env);

  return {
    ...probe,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    managed,
    autoStart: managed,
    source: vlmOcrWeightsSource(config),
  };
}
