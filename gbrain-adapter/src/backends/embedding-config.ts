// Embedding provider configuration for the production GBrain backend.
//
// Configures the VENDORED GBrain AI gateway so its ingestion + vector search use
// the right embedding source. Three modes:
//   * none              -> gateway not configured; honest lexical_degraded.
//   * openai-compatible -> route GBrain's native `openai:` provider at any
//                          OpenAI-compatible endpoint via OPENAI_BASE_URL. Missing
//                          credentials => available:false (truthful lexical), never
//                          a fake "hybrid".
//   * deterministic-test-> inject a deterministic embedder through GBrain's
//                          SUPPORTED test seam (__setEmbedTransportForTests). Real
//                          GBrain vector search, no network. REJECTED outside test
//                          mode.
//
// configureGateway() MUST run BEFORE engine.initSchema() so the embedding column
// is created at the configured dimension.

import { configureGateway, __setEmbedTransportForTests, isAvailable } from "../../../gbrain/src/core/ai/gateway.ts";

export type EmbeddingProviderName = "none" | "openai-compatible" | "deterministic-test";

export interface EmbeddingSetup {
  available: boolean;
  provider: EmbeddingProviderName;
  model: string | null;
  dimensions: number | null;
  reason?: string;
}

export interface EmbeddingEnv {
  provider: EmbeddingProviderName;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
  testMode: boolean;
}

const DETERMINISTIC_DIMS = 64;

function deterministicVector(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const tok of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** Configure the gateway. Call before initSchema(). Returns the truthful setup. */
export function configureEmbedding(env: EmbeddingEnv): EmbeddingSetup {
  if (env.provider === "deterministic-test") {
    if (!env.testMode) {
      throw new Error(
        "GBRAIN_EMBEDDING_PROVIDER=deterministic-test is only allowed in test mode (GBRAIN_TEST_MODE=1).",
      );
    }
    // A fake OpenAI key satisfies isAvailable; the transport override means no
    // network call is ever made.
    configureGateway({
      embedding_model: "openai:text-embedding-3-small",
      embedding_dimensions: DETERMINISTIC_DIMS,
      env: { OPENAI_API_KEY: "deterministic-test-key" },
    } as never);
    __setEmbedTransportForTests(async ({ values }: { values: string[] }) => ({
      embeddings: values.map((t) => deterministicVector(t, DETERMINISTIC_DIMS)),
      usage: { tokens: 0 },
    }) as never);
    return { available: true, provider: env.provider, model: "deterministic-test", dimensions: DETERMINISTIC_DIMS };
  }

  if (env.provider === "openai-compatible") {
    const model = env.model?.trim();
    const apiKey = env.apiKey?.trim();
    const dims = env.dimensions;
    if (!model || !apiKey || !dims) {
      // Truthful degrade: never claim hybrid without a working provider.
      return {
        available: false,
        provider: env.provider,
        model: model ?? null,
        dimensions: dims ?? null,
        reason: "openai-compatible embedding requires GBRAIN_EMBEDDING_API_KEY, MODEL, and DIMENSIONS.",
      };
    }
    const gatewayEnv: Record<string, string> = { OPENAI_API_KEY: apiKey };
    if (env.baseUrl?.trim()) gatewayEnv.OPENAI_BASE_URL = env.baseUrl.trim();
    configureGateway({
      embedding_model: `openai:${model}`,
      embedding_dimensions: dims,
      env: gatewayEnv,
    } as never);
    const available = isAvailable("embedding" as never);
    return {
      available,
      provider: env.provider,
      model,
      dimensions: dims,
      ...(available ? {} : { reason: "Embedding provider is configured but reported unavailable." }),
    };
  }

  // provider === "none"
  return { available: false, provider: "none", model: null, dimensions: null };
}
