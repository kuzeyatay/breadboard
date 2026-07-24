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

function resolveEmbeddingEnv(env: NodeJS.ProcessEnv, testMode: boolean): EmbeddingEnv {
  const raw = (env.GBRAIN_EMBEDDING_PROVIDER?.trim() || "none").toLowerCase();
  const provider: EmbeddingProviderName =
    raw === "openai-compatible" || raw === "deterministic-test" ? (raw as EmbeddingProviderName) : "none";
  return {
    provider,
    baseUrl: env.GBRAIN_EMBEDDING_BASE_URL?.trim() || undefined,
    apiKey: env.GBRAIN_EMBEDDING_API_KEY?.trim() || undefined,
    model: env.GBRAIN_EMBEDDING_MODEL?.trim() || undefined,
    dimensions: env.GBRAIN_EMBEDDING_DIMENSIONS ? Number(env.GBRAIN_EMBEDDING_DIMENSIONS) : undefined,
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
    return { backend: new GBrainStore({ pgDir, embeddingProvider: fallbackEmbeddingProvider }), requested };
  }

  // Production default: the real vendored GBrain engine.
  return {
    backend: new GBrainEngineBackend({ pgDir, embeddingEnv: resolveEmbeddingEnv(env, testMode) }),
    requested,
  };
}
