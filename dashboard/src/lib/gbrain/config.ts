// Dashboard-side GBrain configuration.
//
// GBrain is a DERIVED retrieval layer. Breadboard remains authoritative for all
// canonical content, conversations, permissions, and proposals. This module only
// resolves how (and whether) the dashboard talks to the loopback adapter.

export type GBrainMode = "disabled" | "preferred" | "required";

export interface GBrainConfig {
  mode: GBrainMode;
  adapterUrl: string;
  secret: string;
  queryTimeoutMs: number;
  embeddingProvider: string;
  embeddingModel: string;
}

export function resolveGBrainConfig(env: NodeJS.ProcessEnv = process.env): GBrainConfig {
  const rawMode = (env.GBRAIN_MODE?.trim() || "disabled").toLowerCase();
  const mode: GBrainMode =
    rawMode === "preferred" || rawMode === "required" ? (rawMode as GBrainMode) : "disabled";
  return {
    mode,
    adapterUrl: env.GBRAIN_ADAPTER_URL?.trim() || "http://127.0.0.1:7717",
    secret: env.GBRAIN_ADAPTER_SECRET?.trim() || "",
    queryTimeoutMs: Number(env.GBRAIN_QUERY_TIMEOUT_MS) || 15000,
    embeddingProvider: (env.GBRAIN_EMBEDDING_PROVIDER?.trim() || "none").toLowerCase(),
    embeddingModel: env.GBRAIN_EMBEDDING_MODEL?.trim() || "",
  };
}

export function isGBrainEnabled(config = resolveGBrainConfig()): boolean {
  return config.mode !== "disabled";
}
