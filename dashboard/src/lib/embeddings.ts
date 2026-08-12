// How Breadboard turns text into vectors, in one place.
//
// Three subsystems want embeddings — Deep Tutor's knowledge bases, the Garden
// semantic retriever, and the GBrain sidecar — and until ChatMock grew
// `/v1/embeddings` each of them answered "which model, from where, with what
// key" differently. Two of the three answered "none", so hybrid retrieval was
// off by default across the product.
//
// The default is now ChatMock's local model: ONNX on the CPU, no key, no quota,
// and no network once the weights are cached. An explicitly configured provider
// still wins — this is a floor, not a ceiling.
//
// Vectors from two models are not comparable, so anything that stores them must
// store `EMBEDDING_MODEL` alongside and treat a change as invalidation. That is
// what `embeddingFingerprint` is for.

import { chatmockApiKeyValue } from "./agent-browser/provider.ts";
import { localChatmockBaseUrl } from "./chatmock-server.ts";

/**
 * The model Breadboard embeds with by default, and its width.
 *
 * `local/…` is served inside ChatMock rather than by a provider, which is the
 * whole reason retrieval works on a machine with no API key configured.
 */
export const EMBEDDING_MODEL = "local/bge-small-en-v1.5";
export const EMBEDDING_DIMENSION = 384;

/** Identifies the vector space a stored index was built in. */
export function embeddingFingerprint(model = EMBEDDING_MODEL, dimension = EMBEDDING_DIMENSION): string {
  return `${model}@${dimension}`;
}

export interface EmbeddingSettings {
  /** Empty when embeddings are switched off outright. */
  model: string;
  /** OpenAI-compatible base, without the `/embeddings` suffix. */
  baseUrl: string;
  apiKey: string;
  dimension: number;
  /** True when the settings came from the environment rather than the default. */
  configured: boolean;
}

/**
 * What to embed with, from the environment.
 *
 * `BREADBOARD_EMBEDDINGS=off` disables embeddings everywhere — the honest way
 * to turn hybrid retrieval back off, since every consumer degrades to lexical
 * rather than failing. Setting `BREADBOARD_EMBEDDING_MODEL` (with a key and
 * base URL for a paid provider) points them all somewhere else instead.
 */
export function embeddingSettings(env: NodeJS.ProcessEnv = process.env): EmbeddingSettings {
  const disabled = (env.BREADBOARD_EMBEDDINGS ?? "").trim().toLowerCase();
  if (disabled === "off" || disabled === "0" || disabled === "false") {
    return { model: "", baseUrl: "", apiKey: "", dimension: 0, configured: true };
  }

  const model = env.BREADBOARD_EMBEDDING_MODEL?.trim();
  if (model) {
    const baseUrl =
      env.BREADBOARD_EMBEDDING_BASE_URL?.trim() ||
      env.OPENAI_BASE_URL?.trim() ||
      localChatmockBaseUrl();
    const apiKey =
      env.BREADBOARD_EMBEDDING_API_KEY?.trim() ||
      env.OPENAI_API_KEY?.trim() ||
      chatmockApiKeyValue(env);
    const dimension = Number(env.BREADBOARD_EMBEDDING_DIMENSIONS) || 0;
    return { model, baseUrl: baseUrl.replace(/\/$/, ""), apiKey, dimension, configured: true };
  }

  return {
    model: EMBEDDING_MODEL,
    baseUrl: localChatmockBaseUrl().replace(/\/$/, ""),
    // ChatMock ignores the value, but an OpenAI-shaped client refuses to send
    // a request without one.
    apiKey: chatmockApiKeyValue(env),
    dimension: EMBEDDING_DIMENSION,
    configured: false,
  };
}

export interface EmbeddingBatchResult {
  vectors: number[][];
  model: string;
}

/**
 * Embed a batch through an OpenAI-compatible endpoint.
 *
 * Deliberately a bare fetch rather than the OpenAI SDK: the SDK retries and
 * back-offs on its own schedule, and a caller that has bounded how long it may
 * spend embedding needs its timeout to be the one that wins.
 */
export async function embedTexts(
  texts: string[],
  settings: EmbeddingSettings,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<EmbeddingBatchResult> {
  if (!settings.model) throw new Error("Embeddings are switched off.");
  if (!texts.length) return { vectors: [], model: settings.model };

  const response = await fetch(`${settings.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({ model: settings.model, input: texts }),
    signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  if (!response.ok) {
    const excerpt = (await response.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
    throw new Error(`The embedding endpoint answered ${response.status}. ${excerpt}`.trim());
  }

  const payload = (await response.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
    model?: string;
  };
  const rows = payload.data ?? [];
  const vectors = rows
    .slice()
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((row) => (Array.isArray(row.embedding) ? row.embedding : []));
  if (vectors.length !== texts.length) {
    throw new Error("The embedding endpoint returned the wrong number of vectors.");
  }
  return { vectors, model: payload.model || settings.model };
}
