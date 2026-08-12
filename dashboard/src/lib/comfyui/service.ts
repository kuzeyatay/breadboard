// What the Advanced tab asks the server, in two questions.
//
//   `comfyUiStatus()`   — can I render right now, and if not, what is missing?
//   `renderComfyUiImage()` — render this, and give me the bytes.
//
// The status is deliberately a single `state` rather than a bag of booleans the
// UI has to reason about, because every one of these situations needs a
// different sentence and a different button, and deciding which is the server's
// job (it is the only side that can see the clone, the environment and the
// model directory).

import {
  ComfyUiError,
  awaitComfyUiImages,
  comfyUiCapabilities,
  comfyUiReachable,
  queueComfyUiPrompt,
  readComfyUiImage,
  type ComfyUiCapabilities,
} from "./client.ts";
import { resolveComfyUiConfig, type ComfyUiConfig } from "./config.ts";
import type { ComfyUiState, ComfyUiStatus } from "./status.ts";
import {
  cloneInstalled,
  ensureComfyUiRunning,
  environmentReady,
  readSetupStatus,
} from "./server.ts";
import {
  buildTextToImageWorkflow,
  normalizeRenderOptions,
  resolveSeed,
  type ComfyUiRenderOptions,
} from "./workflow.ts";

export type { ComfyUiState, ComfyUiStatus } from "./status.ts";

const ACTIVE_SETUP_PHASES = new Set([
  "preparing",
  "waiting",
  "environment",
  "tooling",
  "acceleration",
  "dependencies",
]);

function describe(state: ComfyUiState, config: ComfyUiConfig): string {
  switch (state) {
    case "disabled":
      return "ComfyUI is switched off for this Breadboard.";
    case "ready":
      return "ComfyUI is ready.";
    case "no_models":
      return "ComfyUI is running but has no checkpoints. Put a model file in comfyui/models/checkpoints and refresh.";
    case "stopped":
      return "ComfyUI is installed but not running.";
    case "installing":
      return "ComfyUI is being installed.";
    case "not_installed":
      return "ComfyUI has not been set up on this machine yet.";
    default:
      return `Nothing is answering at ${config.baseUrl}, and there is no ComfyUI here to start.`;
  }
}

/**
 * Where ComfyUI stands, without changing anything.
 *
 * Never starts the server: this runs whenever the Image tab is opened, and a
 * tab that boots a multi-gigabyte process just by being looked at would be a
 * trap. Starting is what the button is for.
 */
export async function comfyUiStatus(
  config: ComfyUiConfig = resolveComfyUiConfig(),
): Promise<ComfyUiStatus> {
  const setupRecord = readSetupStatus(config);
  const setup = setupRecord
    ? {
        phase: setupRecord.phase,
        message: setupRecord.message,
        step: setupRecord.step,
        totalSteps: setupRecord.totalSteps,
        detail: setupRecord.detail,
        progress: setupRecord.progress,
        stalled: setupRecord.stalled,
      }
    : null;

  const answer = (state: ComfyUiState, capabilities: ComfyUiCapabilities | null = null) => ({
    state,
    message:
      state === "installing" && setup?.message ? setup.message : describe(state, config),
    baseUrl: config.baseUrl,
    managed: config.managed,
    capabilities,
    setup,
  });

  if (!config.enabled) return answer("disabled");

  if (await comfyUiReachable(config.baseUrl)) {
    try {
      const capabilities = await comfyUiCapabilities(config.baseUrl);
      return answer(capabilities.checkpoints.length ? "ready" : "no_models", capabilities);
    } catch {
      // Answering but not describing itself is a ComfyUI still booting; that is
      // "not ready yet", not "broken".
      return answer("stopped");
    }
  }

  if (config.managed && cloneInstalled(config)) {
    if (environmentReady(config)) return answer("stopped");
    if (setup && ACTIVE_SETUP_PHASES.has(setup.phase) && !setup.stalled) {
      return answer("installing");
    }
    return answer("not_installed");
  }

  return answer("unavailable");
}

export interface ComfyUiRenderResult {
  buffer: Buffer;
  /** Exactly what produced this picture, so the artifact can record it. */
  options: ComfyUiRenderOptions & { seed: number };
}

/**
 * Render one image, starting the server first if that is allowed.
 *
 * The checkpoint is validated against the live list rather than trusted from
 * the browser: a model the user deleted since the tab was opened would
 * otherwise fail deep inside ComfyUI's own validator with a message about
 * node 1.
 */
export async function renderComfyUiImage(
  raw: Partial<Record<keyof ComfyUiRenderOptions, unknown>>,
  options: { config?: ComfyUiConfig; signal?: AbortSignal } = {},
): Promise<ComfyUiRenderResult> {
  const config = options.config ?? resolveComfyUiConfig();
  if (!config.enabled) {
    throw new ComfyUiError(409, "comfyui_disabled", "ComfyUI is switched off for this Breadboard.");
  }

  const running = await ensureComfyUiRunning(config);
  if (!running) {
    const status = await comfyUiStatus(config);
    throw new ComfyUiError(
      status.state === "installing" ? 409 : 503,
      `comfyui_${status.state}`,
      status.message,
    );
  }

  const capabilities = await comfyUiCapabilities(config.baseUrl);
  if (!capabilities.checkpoints.length) {
    throw new ComfyUiError(409, "comfyui_no_models", describe("no_models", config));
  }

  const normalized = normalizeRenderOptions(raw, {
    checkpoint: capabilities.checkpoints[0],
    samplerName: capabilities.samplers[0] ?? "euler",
    scheduler: capabilities.schedulers[0] ?? "normal",
  });
  if (!normalized.prompt) {
    throw new ComfyUiError(400, "comfyui_prompt_required", "Describe the image you want.");
  }
  if (!capabilities.checkpoints.includes(normalized.checkpoint)) {
    throw new ComfyUiError(
      422,
      "comfyui_checkpoint_missing",
      `ComfyUI no longer has the model "${normalized.checkpoint}".`,
    );
  }
  if (capabilities.samplers.length && !capabilities.samplers.includes(normalized.samplerName)) {
    normalized.samplerName = capabilities.samplers[0];
  }
  if (capabilities.schedulers.length && !capabilities.schedulers.includes(normalized.scheduler)) {
    normalized.scheduler = capabilities.schedulers[0];
  }

  const resolved = { ...normalized, seed: resolveSeed(normalized.seed) };
  const clientId = `breadboard-${Date.now().toString(36)}`;
  const promptId = await queueComfyUiPrompt(
    config.baseUrl,
    buildTextToImageWorkflow(resolved),
    clientId,
  );
  const images = await awaitComfyUiImages(config.baseUrl, promptId, {
    timeoutMs: config.generateTimeoutMs,
    signal: options.signal,
  });
  const buffer = await readComfyUiImage(config.baseUrl, images[0]);
  return { buffer, options: resolved };
}
