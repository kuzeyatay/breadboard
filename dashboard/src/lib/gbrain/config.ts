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

/**
 * The mode an unset `GBRAIN_MODE` resolves to. `preferred` is the default: the
 * knowledge tools are offered, and an unreachable adapter degrades visibly
 * instead of failing a turn. `disabled` must be asked for explicitly.
 */
export const DEFAULT_GBRAIN_MODE: GBrainMode = "preferred";

export function resolveGBrainConfig(env: NodeJS.ProcessEnv = process.env): GBrainConfig {
  const rawMode = (env.GBRAIN_MODE?.trim() || DEFAULT_GBRAIN_MODE).toLowerCase();
  const mode: GBrainMode =
    rawMode === "preferred" || rawMode === "required" || rawMode === "disabled"
      ? (rawMode as GBrainMode)
      : DEFAULT_GBRAIN_MODE;
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
