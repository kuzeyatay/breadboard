import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRuntimeV2OuterAgentWorker } from "./runtime-v2-outer-agent-worker-core.mjs";

const entrypoint = fileURLToPath(import.meta.url);
if (
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === path.resolve(entrypoint)
) {
  void runRuntimeV2OuterAgentWorker("opencode").catch((error) => {
    process.exitCode = 1;
    process.stderr.write(
      `[runtime-v2-opencode-worker] startup failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });
}
