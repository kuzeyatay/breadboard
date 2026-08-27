import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeGeneratedVisualBrowserOperation,
  validateGeneratedVisualBrowserExecutionScope,
  validateGeneratedVisualBrowserRequest,
} from "./runtime-v2-generated-visual-browser-executor.mjs";
import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const entrypoint = fileURLToPath(import.meta.url);
if (
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === path.resolve(entrypoint)
) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-generated-visual-browser-worker",
    validateRequest: validateGeneratedVisualBrowserRequest,
    validateExecutionScope: validateGeneratedVisualBrowserExecutionScope,
    expectedInputCount: () => 1,
    maximumInputBytes: 12 * 1024 * 1024,
    execute: executeGeneratedVisualBrowserOperation,
  });
}
