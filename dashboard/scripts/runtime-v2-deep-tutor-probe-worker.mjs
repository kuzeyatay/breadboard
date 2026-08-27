import {
  executeDeepTutorProbe,
  validateDeepTutorProbeExecutionScope,
  validateDeepTutorProbeRequest,
} from "./runtime-v2-deep-tutor-maintenance-executor.mjs";
import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

void runRuntimeV2FiniteMcpWorker({
  name: "runtime-v2-deep-tutor-probe-worker",
  validateRequest: validateDeepTutorProbeRequest,
  validateExecutionScope: validateDeepTutorProbeExecutionScope,
  expectedInputCount: () => 0,
  execute: executeDeepTutorProbe,
});
