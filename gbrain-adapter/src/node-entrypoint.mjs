// Loader bootstrap for the Node 24 GBrain adapter.
//
// Registering from a checked-in entrypoint avoids passing an absolute Windows
// path to `--experimental-loader` (which Node interprets as a `c:` URL). Runtime
// manifests can therefore pass this file as one ordinary app-path argument.

import { register } from "node:module";

register("./node-loader.mjs", import.meta.url);

const { startNodeAdapter } = await import("./node-server.ts");

if (import.meta.main) {
  startNodeAdapter()
    .then((server) => {
      console.log(`[gbrain-adapter] listening on 127.0.0.1:${server.port}`);
      let stopping = false;
      const shutdown = () => {
        if (stopping) return;
        stopping = true;
        server.stop().finally(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((error) => {
      console.error(
        `[gbrain-adapter] failed to start: ${error instanceof Error ? error.message : "unknown"}`,
      );
      process.exit(1);
    });
}
