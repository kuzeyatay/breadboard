// Backend selector.
//
//   GBRAIN_BACKEND=gbrain  (default) -> production, vendored GBrain engine.
//   GBRAIN_BACKEND=fake              -> deterministic test store. REJECTED in
//                                       packaged production unless GBRAIN_TEST_MODE=1.
//
// The distinction is load-bearing: the fake backend must never masquerade as the
// real integration. Status/health reports backend.backendName truthfully.

import { GBrainEngineBackend } from "./gbrain-backend.ts";
import { GBrainStore } from "../store.ts";
import type { RetrievalBackend } from "./types.ts";
import type { EmbeddingEnv, EmbeddingProviderName } from "./embedding-config.ts";

export interface BackendSelection {
  backend: RetrievalBackend;
  requested: "gbrain" | "fake";
}

// Breadboard's local gateway serves `/v1/embeddings` from an ONNX model on the
// CPU, so the production backend gets real vectors with no key and no quota.
// This is why the default is no longer "none": that default meant every install
// ran lexical-only retrieval and reported `lexical_degraded` forever, which was
// honest but needlessly poor.
const CHATMOCK_BASE_URL = "http://127.0.0.1:8765/v1";
const CHATMOCK_MODEL = "local/bge-small-en-v1.5";
const CHATMOCK_DIMENSIONS = 384;

/** Exported so the defaults are testable without booting the engine. */
export function resolveEmbeddingEnv(env: NodeJS.ProcessEnv, testMode: boolean): EmbeddingEnv {
  const raw = (env.GBRAIN_EMBEDDING_PROVIDER?.trim() || "openai-compatible").toLowerCase();
  const provider: EmbeddingProviderName =
    raw === "openai-compatible" || raw === "deterministic-test" ? (raw as EmbeddingProviderName) : "none";
  return {
    provider,
    // Every field falls back to the local gateway, so an install that
    // configures nothing still embeds. Naming a paid provider still overrides
    // all four, and GBRAIN_EMBEDDING_PROVIDER=none turns embeddings off.
    baseUrl: env.GBRAIN_EMBEDDING_BASE_URL?.trim() || CHATMOCK_BASE_URL,
    // ChatMock ignores the value; the gateway refuses to configure without one.
    apiKey: env.GBRAIN_EMBEDDING_API_KEY?.trim() || "local",
    model: env.GBRAIN_EMBEDDING_MODEL?.trim() || CHATMOCK_MODEL,
    dimensions: env.GBRAIN_EMBEDDING_DIMENSIONS
      ? Number(env.GBRAIN_EMBEDDING_DIMENSIONS)
      : CHATMOCK_DIMENSIONS,
    testMode,
  };
}

export function selectBackend(
  env: NodeJS.ProcessEnv,
  pgDir: string,
  fallbackEmbeddingProvider: string,
): BackendSelection {
  const requested = (env.GBRAIN_BACKEND?.trim().toLowerCase() || "gbrain") as "gbrain" | "fake";
  const testMode = env.GBRAIN_TEST_MODE === "1" || env.NODE_ENV === "test";
  const packagedProduction = env.GBRAIN_PACKAGED === "1" || env.NODE_ENV === "production";

  if (requested === "fake") {
    if (packagedProduction && !testMode) {
      throw new Error(
        "GBRAIN_BACKEND=fake is refused in packaged production. The fake backend is test-only; set GBRAIN_BACKEND=gbrain.",
      );
    }
    const embedding = resolveEmbeddingEnv(env, testMode);
    return {
      backend: new GBrainStore({
        pgDir,
        embeddingProvider: fallbackEmbeddingProvider,
        embeddingBaseUrl: embedding.baseUrl,
        embeddingModel: embedding.model,
        embeddingApiKey: embedding.apiKey,
      }),
      requested,
    };
  }

  // Production default: the real vendored GBrain engine.
  return {
    backend: new GBrainEngineBackend({ pgDir, embeddingEnv: resolveEmbeddingEnv(env, testMode) }),
    requested,
  };
}
