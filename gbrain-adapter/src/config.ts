// Adapter configuration resolved from the environment.
//
// Every mutable path is deterministic and configurable; nothing is written into
// the installation directory. The secret is required — an adapter with no secret
// refuses to start (a loopback service with no auth is still a local privilege
// escalation surface for any process that can reach the port).

import os from "node:os";
import path from "node:path";

export interface AdapterConfig {
  host: string;
  port: number;
  secret: string;
  dataDir: string;
  /** Persistent PGLite directory, or ":memory:" for ephemeral test runs. */
  pgDir: string;
  embeddingProvider: string;
  embeddingModel: string;
  queryTimeoutMs: number;
  version: string;
}

function defaultDataDir(): string {
  // Mutable data lives OUTSIDE the installation dir. Desktop overrides this to
  // the Electron userData path via GBRAIN_DATA_DIR.
  const base =
    process.env.GBRAIN_DATA_DIR?.trim() ||
    path.join(os.homedir(), ".breadboard", "gbrain");
  return path.resolve(base);
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig {
  const dataDir = defaultDataDir();
  const secret = env.GBRAIN_ADAPTER_SECRET?.trim() || "";
  const provider = (env.GBRAIN_EMBEDDING_PROVIDER?.trim() || "none").toLowerCase();
  return {
    host: env.GBRAIN_ADAPTER_HOST?.trim() || "127.0.0.1",
    port: Number(env.GBRAIN_ADAPTER_PORT) || 7717,
    secret,
    dataDir,
    pgDir:
      env.GBRAIN_PG_DIR?.trim() ||
      (env.GBRAIN_ADAPTER_MEMORY === "1"
        ? ":memory:"
        : path.join(dataDir, "pglite")),
    embeddingProvider: provider,
    embeddingModel: env.GBRAIN_EMBEDDING_MODEL?.trim() || "",
    queryTimeoutMs: Number(env.GBRAIN_QUERY_TIMEOUT_MS) || 15000,
    version: "0.1.0",
  };
}

export function assertSecret(config: AdapterConfig): void {
  if (!config.secret || config.secret.length < 8) {
    throw new Error(
      "GBRAIN_ADAPTER_SECRET is required (>= 8 chars). The adapter refuses to bind without a per-launch secret.",
    );
  }
}
