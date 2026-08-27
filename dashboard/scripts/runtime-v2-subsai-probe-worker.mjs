import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";
import {
  boundedText,
  exactRecord,
  failSubsAiWorker,
  prepareRuntimeV2SubsAiLayout,
  samePath,
} from "./runtime-v2-subsai-worker-layout.mjs";

const ENTRYPOINT = fileURLToPath(import.meta.url);
const MAX_PATH_BYTES = 2_048;
const MAX_REASON_BYTES = 8 * 1_024;

export function validateRuntimeV2SubsAiProbeRequest(value) {
  if (
    !exactRecord(value, ["protocolVersion", "operation"]) ||
    value.protocolVersion !== 1 || value.operation !== "status"
  ) failSubsAiWorker("The canonical subsai health request is invalid.");
  return value;
}

export function validateRuntimeV2SubsAiProbeScope(value) {
  if (
    !exactRecord(value, ["userId", "gardenId", "conversationId"]) ||
    !Number.isSafeInteger(value.userId) || value.userId < 1 ||
    value.gardenId !== null || value.conversationId !== null
  ) failSubsAiWorker("The subsai health probe requires authenticated user-global scope.");
  return value;
}

export function canonicalRuntimeV2SubsAiHealth(value) {
  if (
    !exactRecord(value, [
      "available", "cloned", "root", "python", "uvAvailable", "models", "reason",
    ]) ||
    typeof value.available !== "boolean" || typeof value.cloned !== "boolean" ||
    !(value.root === null || (
      boundedText(value.root, MAX_PATH_BYTES) && path.isAbsolute(value.root)
    )) ||
    !(value.python === null || (
      boundedText(value.python, MAX_PATH_BYTES) && path.isAbsolute(value.python)
    )) ||
    typeof value.uvAvailable !== "boolean" ||
    !Array.isArray(value.models) || value.models.length > 32 ||
    !value.models.every((model) => boundedText(model, 256) && model.length > 0) ||
    new Set(value.models).size !== value.models.length ||
    !(value.reason === null || boundedText(value.reason, MAX_REASON_BYTES)) ||
    value.cloned !== (value.root !== null) ||
    value.available !== (value.root !== null && value.python !== null) ||
    (value.python === null && value.models.length !== 0) ||
    value.available !== (value.reason === null)
  ) failSubsAiWorker("The subsai health probe produced invalid status metadata.");
  return value;
}

export async function executeRuntimeV2SubsAiProbe(
  launch,
  signal,
  progress,
  dependencies = {},
) {
  validateRuntimeV2SubsAiProbeRequest(launch.request);
  validateRuntimeV2SubsAiProbeScope(launch.executionScope);
  progress.checkpoint({ stage: "preparing", percent: 10 });
  const layout = prepareRuntimeV2SubsAiLayout(ENTRYPOINT, launch, {
    requireDashboardRuntime: true,
  });
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const loadHealth = dependencies.loadHealth ?? (async () => {
    const runtime = await import(pathToFileURL(
      path.join(layout.sourceRoot, "lib", "subsai", "runtime.ts"),
    ).href);
    if (typeof runtime.subsAiHealth !== "function") {
      failSubsAiWorker("The staged subsai health entrypoint is unavailable.");
    }
    return runtime.subsAiHealth(process.env);
  });
  progress.checkpoint({ stage: "probing", percent: 35 });
  const health = canonicalRuntimeV2SubsAiHealth(await loadHealth(layout, signal));
  if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  progress.checkpoint({ stage: "complete", percent: 100 });
  return health;
}

if (typeof process.argv[1] === "string" && samePath(process.argv[1], ENTRYPOINT)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-subsai-probe-worker",
    validateRequest: validateRuntimeV2SubsAiProbeRequest,
    validateExecutionScope: validateRuntimeV2SubsAiProbeScope,
    expectedInputCount: () => 0,
    execute: executeRuntimeV2SubsAiProbe,
  });
}
