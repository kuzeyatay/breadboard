// Server-only configuration for the "Parse using VLM" ingestion option.
//
// The VLM is HunyuanOCR-1.5 running locally as a GGUF through llama.cpp's
// `llama-server`, which exposes an OpenAI-compatible API. Everything is parsed
// and validated once here; the server supervisor, the OCR client and the route
// handlers consume the typed config instead of reading process.env directly.

export interface VlmOcrConfig {
  enabled: boolean;

  /** OpenAI-compatible root of the llama-server, including the `/v1` suffix. */
  baseUrl: string;
  /** llama-server ignores the key, but the OpenAI wire format wants one. */
  apiKey: string;
  /** Empty means "use whatever /v1/models reports first". */
  model: string;

  /** Start llama-server ourselves when nothing is listening on `baseUrl`. */
  autoStart: boolean;
  /** `llama-server` executable (on PATH or an absolute path). */
  serverBinary: string;
  /** Hugging Face repo:quant passed to `llama-server -hf`. Model + mmproj. */
  hfRepo: string;
  /** Explicit local GGUF paths; when both are set they win over `hfRepo`. */
  modelPath: string | null;
  mmprojPath: string | null;
  /** Passed through to `--n-gpu-layers` when set. */
  gpuLayers: number | null;
  contextSize: number;
  /** How long to wait for a spawned server to answer (first run downloads). */
  startupTimeoutMs: number;

  /** Per-page request budget. */
  requestTimeoutMs: number;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;

  /** Width the PDF pages are rasterized to before OCR. */
  pageImageWidth: number;
  /** 0 disables the cap. */
  maxPages: number;
  /** llama-server serves one slot by default, so keep this at 1 unless tuned. */
  concurrency: number;
}

export type VlmOcrEnv = Record<string, string | undefined>;

function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function intFromEnv(
  value: string | undefined,
  fallback: number,
  { min, max }: { min?: number; max?: number } = {},
): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  let result = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== undefined && result < min) result = fallback;
  if (max !== undefined && result > max) result = fallback;
  return result;
}

function floatFromEnv(
  value: string | undefined,
  fallback: number,
  { min, max }: { min?: number; max?: number } = {},
): number {
  const parsed = Number.parseFloat((value ?? "").trim());
  let result = Number.isFinite(parsed) ? parsed : fallback;
  if (min !== undefined && result < min) result = fallback;
  if (max !== undefined && result > max) result = fallback;
  return result;
}

function stringFromEnv(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/**
 * Normalize to an OpenAI-compatible root ending in `/v1`. Accepts a bare
 * `host:port` as well as a full URL with or without the suffix.
 */
export function normalizeVlmBaseUrl(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return fallback;
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/v\d+$/.test(pathname) ? pathname : `${pathname}/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** The port llama-server should bind when we spawn it ourselves. */
export function vlmOcrServerPort(config: VlmOcrConfig): number {
  try {
    const url = new URL(config.baseUrl);
    if (url.port) return Number.parseInt(url.port, 10);
    return url.protocol === "https:" ? 443 : 80;
  } catch {
    return DEFAULT_VLM_OCR_PORT;
  }
}

/** The host llama-server should bind when we spawn it ourselves. */
export function vlmOcrServerHost(config: VlmOcrConfig): string {
  try {
    return new URL(config.baseUrl).hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

/** True when the base URL points at this machine, so spawning makes sense. */
export function vlmOcrServerIsLocal(config: VlmOcrConfig): boolean {
  const host = vlmOcrServerHost(config);
  return /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[::1\]|::1)$/i.test(host);
}

// 8080 is llama.cpp's own default but collides with Scriberr's, and 8081 is
// Quartz, so the OCR server gets its own port out of the way of both.
export const DEFAULT_VLM_OCR_PORT = 8077;
export const DEFAULT_VLM_OCR_BASE_URL = `http://127.0.0.1:${DEFAULT_VLM_OCR_PORT}/v1`;
export const DEFAULT_VLM_OCR_HF_REPO = "ggml-org/HunyuanOCR-GGUF:Q8_0";

export function loadVlmOcrConfig(env: VlmOcrEnv = process.env): VlmOcrConfig {
  const modelPath = stringFromEnv(env.VLM_OCR_MODEL_PATH);
  const mmprojPath = stringFromEnv(env.VLM_OCR_MMPROJ_PATH);

  return {
    enabled: boolFromEnv(env.VLM_OCR_ENABLED, true),

    baseUrl: normalizeVlmBaseUrl(env.VLM_OCR_BASE_URL, DEFAULT_VLM_OCR_BASE_URL),
    apiKey: stringFromEnv(env.VLM_OCR_API_KEY) ?? "empty",
    model: stringFromEnv(env.VLM_OCR_MODEL) ?? "",

    autoStart: boolFromEnv(env.VLM_OCR_AUTO_START, true),
    serverBinary: stringFromEnv(env.VLM_OCR_SERVER_BINARY) ?? "llama-server",
    hfRepo: stringFromEnv(env.VLM_OCR_HF_REPO) ?? DEFAULT_VLM_OCR_HF_REPO,
    modelPath,
    mmprojPath,
    gpuLayers:
      stringFromEnv(env.VLM_OCR_GPU_LAYERS) === null
        ? null
        : intFromEnv(env.VLM_OCR_GPU_LAYERS, 0, { min: 0, max: 999 }),
    // The official llama.cpp recipe for HunyuanOCR uses --ctx-size 10240.
    contextSize: intFromEnv(env.VLM_OCR_CONTEXT_SIZE, 10_240, { min: 2_048 }),
    startupTimeoutMs: intFromEnv(env.VLM_OCR_STARTUP_TIMEOUT_MS, 600_000, {
      min: 5_000,
    }),

    requestTimeoutMs: intFromEnv(env.VLM_OCR_REQUEST_TIMEOUT_MS, 300_000, {
      min: 5_000,
    }),
    // Matches llama_cpp/chat.py in the HunyuanOCR repo: greedy decoding, no
    // repetition penalty, 4096 new tokens per page.
    maxTokens: intFromEnv(env.VLM_OCR_MAX_TOKENS, 4_096, { min: 256 }),
    temperature: floatFromEnv(env.VLM_OCR_TEMPERATURE, 0, { min: 0, max: 2 }),
    topP: floatFromEnv(env.VLM_OCR_TOP_P, 1, { min: 0, max: 1 }),
    topK: intFromEnv(env.VLM_OCR_TOP_K, 1, { min: 1 }),
    repeatPenalty: floatFromEnv(env.VLM_OCR_REPEAT_PENALTY, 1, {
      min: 1,
      max: 2,
    }),

    pageImageWidth: intFromEnv(env.VLM_OCR_PAGE_IMAGE_WIDTH, 1_400, {
      min: 480,
      max: 4_096,
    }),
    maxPages: intFromEnv(env.VLM_OCR_MAX_PAGES, 0, { min: 0 }),
    concurrency: intFromEnv(env.VLM_OCR_CONCURRENCY, 1, { min: 1, max: 8 }),
  };
}

let cachedConfig: VlmOcrConfig | null = null;

export function getVlmOcrConfig(): VlmOcrConfig {
  if (!cachedConfig) cachedConfig = loadVlmOcrConfig();
  return cachedConfig;
}

/** Test hook: drop the cached config so env changes are picked up. */
export function resetVlmOcrConfigCache(): void {
  cachedConfig = null;
}
