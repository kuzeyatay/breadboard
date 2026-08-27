import {
  executeDeepTutorIndex,
  validateDeepTutorIndexExecutionScope,
  validateDeepTutorIndexRequest,
} from "./runtime-v2-deep-tutor-maintenance-executor.mjs";
import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

void runRuntimeV2FiniteMcpWorker({
  name: "runtime-v2-deep-tutor-index-worker",
  validateRequest: validateDeepTutorIndexRequest,
  validateExecutionScope: validateDeepTutorIndexExecutionScope,
  expectedInputCount: () => 0,
  execute: executeDeepTutorIndex,
});
