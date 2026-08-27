import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeAgentEditsOperation,
  validateAgentEditsRequest,
} from "./runtime-v2-agent-edits-executor.mjs";
import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const entrypoint = fileURLToPath(import.meta.url);
if (
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === path.resolve(entrypoint)
) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-agent-edits-worker",
    validateRequest: validateAgentEditsRequest,
    expectedInputCount: () => 0,
    execute: executeAgentEditsOperation,
  });
}
