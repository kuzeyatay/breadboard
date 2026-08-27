import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  executeAgentBrowserProfileOperation,
  validateAgentBrowserProfileExecutionScope,
  validateAgentBrowserProfileRequest,
} from "./runtime-v2-agent-browser-profile-executor.mjs";
import { runRuntimeV2FiniteMcpWorker } from "./runtime-v2-finite-mcp-worker-core.mjs";

const entrypoint = fileURLToPath(import.meta.url);
if (typeof process.argv[1] === "string" &&
    path.resolve(process.argv[1]) === path.resolve(entrypoint)) {
  void runRuntimeV2FiniteMcpWorker({
    name: "runtime-v2-agent-browser-profile-worker",
    validateRequest: validateAgentBrowserProfileRequest,
    validateExecutionScope: validateAgentBrowserProfileExecutionScope,
    expectedInputCount: () => 0,
    execute: (launch, signal, protocol) => executeAgentBrowserProfileOperation(
      launch,
      signal,
      { checkpoint: protocol.checkpoint },
    ),
  });
}
