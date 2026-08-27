import {
  canonicalRuntimeInputAsync,
  runRuntimeV2FiniteMcpWorker,
} from "./runtime-v2-finite-mcp-worker-core.mjs";
import {
  executeScriberrGardenJob,
  expectedScriberrGardenInputCount,
  validateScriberrGardenExecutionScope,
  validateScriberrGardenRequest,
} from "./runtime-v2-scriberr-executor.mjs";

const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

void runRuntimeV2FiniteMcpWorker({
  name: "runtime-v2-scriberr-worker",
  validateRequest: validateScriberrGardenRequest,
  validateExecutionScope: validateScriberrGardenExecutionScope,
  expectedInputCount: expectedScriberrGardenInputCount,
  maximumInputBytes: MAX_VIDEO_BYTES,
  execute: async (launch, signal, io) => {
    const inputPath = launch.request.operation === "transcribe" &&
      launch.request.inputKind === "upload"
      ? await canonicalRuntimeInputAsync(launch, 0, signal)
      : null;
    return executeScriberrGardenJob(launch, signal, io, inputPath);
  },
});
