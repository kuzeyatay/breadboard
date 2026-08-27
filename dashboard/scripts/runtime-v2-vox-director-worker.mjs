import path from "node:path";
import { fileURLToPath } from "node:url";

import { runRuntimeV2CinemaAgentWorker } from "./runtime-v2-cinema-agent-worker-core.mjs";

const entrypoint = fileURLToPath(import.meta.url);
if (typeof process.argv[1] === "string" && path.resolve(process.argv[1]) === path.resolve(entrypoint)) {
  void runRuntimeV2CinemaAgentWorker("vox-director").catch((error) => {
    process.exitCode = 1;
    process.stderr.write(`[runtime-v2-vox-director-worker] startup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  });
}
