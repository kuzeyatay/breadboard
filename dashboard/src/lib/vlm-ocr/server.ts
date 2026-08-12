// Lifecycle for the local HunyuanOCR llama-server.
//
// llama.cpp's `llama-server` speaks the OpenAI wire format, so once it is up
// the OCR client is just an HTTP call. The only interesting part is getting it
// up: we probe first, and only spawn when nothing is already listening — that
// way a server the user started by hand (or the desktop supervisor) is reused
// instead of being duplicated.
//
// The first spawn downloads ~1.3 GB of GGUF weights through llama.cpp's own
// Hugging Face fetcher, which is why the startup budget is minutes, not
// seconds, and why progress is reported while waiting.

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";

import {
  vlmOcrServerHost,
  vlmOcrServerIsLocal,
  vlmOcrServerPort,
  type VlmOcrConfig,
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
  /** True when this process spawned the server and it is still alive. */
  managed: boolean;
  autoStart: boolean;
  /** Which weights the server is (or would be) started with. */
  source: string;
}

const PROBE_TIMEOUT_MS = 2_500;

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

interface ManagedServer {
  child: ChildProcess;
  startedAt: number;
  /** Tail of stderr, kept so a crash can be explained. */
  log: string[];
}

let managed: ManagedServer | null = null;
let starting: Promise<void> | null = null;
let exitHookInstalled = false;

function recordLog(server: ManagedServer, chunk: Buffer): void {
  const text = chunk.toString("utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    server.log.push(trimmed);
    if (server.log.length > 40) server.log.shift();
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const stop = () => stopVlmOcrServer();
  process.once("exit", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

/** Kill a server this process started. No-op for an externally run one. */
export function stopVlmOcrServer(): void {
  if (!managed) return;
  try {
    managed.child.kill();
  } catch {
    // Already gone.
  }
  managed = null;
}

export function isVlmOcrServerManaged(): boolean {
  return Boolean(managed && managed.child.exitCode === null);
}

function missingBinaryHint(config: VlmOcrConfig): string {
  return (
    `Install llama.cpp so that \`${config.serverBinary}\` is on PATH ` +
    "(or point VLM_OCR_SERVER_BINARY at it), then retry. " +
    `You can also start it yourself with: ${config.serverBinary} -hf ${config.hfRepo} ` +
    `--port ${vlmOcrServerPort(config)} --jinja`
  );
}

function spawnServer(config: VlmOcrConfig): ManagedServer {
  const child = spawn(config.serverBinary, buildVlmOcrServerArgs(config), {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const server: ManagedServer = { child, startedAt: Date.now(), log: [] };
  child.stdout?.on("data", (chunk: Buffer) => recordLog(server, chunk));
  child.stderr?.on("data", (chunk: Buffer) => recordLog(server, chunk));
  child.on("exit", () => {
    if (managed === server) managed = null;
  });
  return server;
}

/**
 * Make sure an OCR server is answering, spawning one if needed and allowed.
 * Concurrent callers share a single start attempt.
 */
export async function ensureVlmOcrServer(
  config: VlmOcrConfig,
  onProgress?: (step: string) => void,
): Promise<void> {
  if (!config.enabled) throw new VlmOcrDisabledError();

  const first = await probeVlmOcrServer(config);
  if (first.ok) return;

  if (starting) {
    await starting;
    const afterShared = await probeVlmOcrServer(config);
    if (afterShared.ok) return;
  }

  if (!config.autoStart) {
    throw new VlmOcrUnavailableError(
      `No OCR model server is answering at ${config.baseUrl}.`,
      `Start one with: ${config.serverBinary} -hf ${config.hfRepo} --port ${vlmOcrServerPort(config)} --jinja`,
    );
  }

  if (!vlmOcrServerIsLocal(config)) {
    throw new VlmOcrUnavailableError(
      `No OCR model server is answering at ${config.baseUrl}.`,
      "That address is not on this machine, so it cannot be started from here.",
    );
  }

  if (config.modelPath && !fs.existsSync(config.modelPath)) {
    throw new VlmOcrUnavailableError(
      `The GGUF at ${config.modelPath} does not exist.`,
      "Fix VLM_OCR_MODEL_PATH, or clear it to download the weights from Hugging Face instead.",
    );
  }
  if (config.mmprojPath && !fs.existsSync(config.mmprojPath)) {
    throw new VlmOcrUnavailableError(
      `The vision projector at ${config.mmprojPath} does not exist.`,
      "Fix VLM_OCR_MMPROJ_PATH, or clear it to download the weights from Hugging Face instead.",
    );
  }

  starting = (async () => {
    onProgress?.("Starting the local OCR model server…");
    let server: ManagedServer;
    try {
      server = spawnServer(config);
    } catch {
      throw new VlmOcrUnavailableError(
        `Could not run \`${config.serverBinary}\`.`,
        missingBinaryHint(config),
      );
    }
    managed = server;
    installExitHook();

    const spawnFailure = await new Promise<Error | null>((resolve) => {
      const onError = (error: NodeJS.ErrnoException) => resolve(error);
      server.child.once("error", onError);
      setTimeout(() => {
        server.child.off("error", onError);
        resolve(null);
      }, 250).unref();
    });
    if (spawnFailure) {
      managed = null;
      const notFound =
        (spawnFailure as NodeJS.ErrnoException).code === "ENOENT";
      throw new VlmOcrUnavailableError(
        notFound
          ? `\`${config.serverBinary}\` was not found.`
          : `Could not run \`${config.serverBinary}\`: ${spawnFailure.message}`,
        missingBinaryHint(config),
      );
    }

    const deadline = Date.now() + config.startupTimeoutMs;
    let announcedDownload = false;
    while (Date.now() < deadline) {
      if (server.child.exitCode !== null) {
        const tail = server.log.slice(-6).join(" | ") || "no output";
        managed = null;
        throw new VlmOcrUnavailableError(
          `The OCR model server exited during startup (code ${server.child.exitCode}).`,
          `Last output: ${tail}`,
        );
      }

      const probe = await probeVlmOcrServer(config);
      if (probe.ok) {
        onProgress?.("Local OCR model server is ready.");
        return;
      }

      if (!announcedDownload && Date.now() - server.startedAt > 8_000) {
        announcedDownload = true;
        onProgress?.(
          `Loading ${vlmOcrWeightsSource(config)} (first run downloads the weights)…`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const tail = server.log.slice(-6).join(" | ") || "no output";
    stopVlmOcrServer();
    throw new VlmOcrUnavailableError(
      `The OCR model server did not become ready within ${Math.round(config.startupTimeoutMs / 1000)}s.`,
      `Last output: ${tail}`,
    );
  })();

  try {
    await starting;
  } finally {
    starting = null;
  }
}

/** Status for the upload UI: can this option be offered right now? */
export async function vlmOcrStatus(config: VlmOcrConfig): Promise<VlmOcrStatus> {
  const probe = config.enabled
    ? await probeVlmOcrServer(config)
    : { ok: false, models: [], detail: "disabled" };

  return {
    ...probe,
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    managed: isVlmOcrServerManaged(),
    autoStart: config.autoStart,
    source: vlmOcrWeightsSource(config),
  };
}

/** Test hook: forget any server this module thinks it owns. */
export function resetVlmOcrServerState(): void {
  managed = null;
  starting = null;
}
