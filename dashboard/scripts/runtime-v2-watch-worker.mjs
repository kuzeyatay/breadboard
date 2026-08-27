import {
  canonicalRuntimeInputAsync,
  runRuntimeV2FiniteMcpWorker,
} from "./runtime-v2-finite-mcp-worker-core.mjs";
import {
  executeWatch,
  expectedWatchInputCount,
  validateWatchExecutionScope,
  validateWatchRequest,
  watchExecutionFailure,
} from "./runtime-v2-watch-executor.mjs";

const MAX_LOCAL_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

void runRuntimeV2FiniteMcpWorker({
  name: "runtime-v2-watch-worker",
  validateRequest: validateWatchRequest,
  validateExecutionScope: validateWatchExecutionScope,
  expectedInputCount: expectedWatchInputCount,
  maximumInputBytes: MAX_LOCAL_VIDEO_BYTES,
  execute: async (launch, signal, io) => {
    try {
      const inputPath = launch.request.sourceKind === "local"
        ? await canonicalRuntimeInputAsync(launch, 0, signal)
        : null;
      return await executeWatch(launch, signal, io, inputPath);
    } catch (error) {
      if (signal.aborted) throw error;
      return watchExecutionFailure(error);
    }
  },
});
