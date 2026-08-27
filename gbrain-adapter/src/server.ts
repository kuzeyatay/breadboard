// Breadboard GBrain adapter HTTP server (Bun).
//
// Binds ONLY to loopback, authenticates every request with a per-launch secret,
// and exposes only the narrow operations Breadboard needs. There is no admin
// surface, no MCP endpoint, no unrestricted file read. Errors returned to callers
// are sanitized — never a raw stack, path, or the secret.

import {
  resolveConfig,
  assertLoopbackHost,
  assertSecret,
  type AdapterConfig,
} from "./config.ts";
import { selectBackend } from "./backends/select.ts";
import type { RetrievalBackend } from "./backends/types.ts";
import { createAdapterRequestHandler } from "./request-handler.ts";

export interface AdapterServer {
  stop(): Promise<void>;
  port: number;
  store: RetrievalBackend;
}

export async function startAdapter(
  overrides: Partial<AdapterConfig> = {},
): Promise<AdapterServer> {
  const config: AdapterConfig = { ...resolveConfig(), ...overrides };
  assertSecret(config);
  assertLoopbackHost(config);

  // Select the production (vendored GBrain) or the test-only fake backend.
  const { backend: store } = selectBackend(process.env, config.pgDir, config.embeddingProvider);
  await store.init();

  const handleRequest = createAdapterRequestHandler(store, config);

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: handleRequest,
  });

  return {
    port: server.port,
    store,
    async stop() {
      handleRequest.stopAccepting();
      await server.stop(true);
      await handleRequest.waitForIdle();
      await store.close();
    },
  };
}

// Direct execution entrypoint.
if (import.meta.main) {
  startAdapter()
    .then((s) => {
      console.log(`[gbrain-adapter] listening on 127.0.0.1:${s.port}`);
      const shutdown = () => {
        s.stop().finally(() => process.exit(0));
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    })
    .catch((err) => {
      // Only the stable message, never a stack with paths/secrets.
      console.error(`[gbrain-adapter] failed to start: ${err instanceof Error ? err.message : "unknown"}`);
      process.exit(1);
    });
}
