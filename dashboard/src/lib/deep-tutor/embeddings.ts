// Whether ChatMock can produce vectors right now.
//
// This is the one dependency a knowledge base has that a tutoring turn does
// not, and it fails in its own way: the embeddings extra is optional in
// ChatMock (`pip install -e '.[embeddings]'`), so an otherwise healthy gateway
// can answer every question and still be unable to index a single note. Health
// reports it separately for exactly that reason.

import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from "../embeddings.ts";

export interface EmbeddingsHealth {
  /** ChatMock answered and can serve the model an index would be built with. */
  available: boolean;
  /** The model Breadboard indexes with, whether or not it is available. */
  model: string;
  dimension: number;
  /** Only set when unavailable, and written for a person to act on. */
  reason: string | null;
}

const PROBE_TIMEOUT_MS = 8_000;
const CACHE_MS = 30_000;

const globalCache = globalThis as typeof globalThis & {
  __breadboardDeepTutorEmbeddingsHealth?: { at: number; health: EmbeddingsHealth };
};

export async function embeddingsHealth(
  baseUrl: string,
  options: { force?: boolean } = {},
): Promise<EmbeddingsHealth> {
  const cached = globalCache.__breadboardDeepTutorEmbeddingsHealth;
  if (!options.force && cached && Date.now() - cached.at < CACHE_MS) return cached.health;

  const health = await probe(baseUrl);
  globalCache.__breadboardDeepTutorEmbeddingsHealth = { at: Date.now(), health };
  return health;
}

async function probe(baseUrl: string): Promise<EmbeddingsHealth> {
  const base = { model: EMBEDDING_MODEL, dimension: EMBEDDING_DIMENSION };
  const endpoint = `${baseUrl.replace(/\/$/, "")}/embeddings/models`;
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        ...base,
        available: false,
        reason:
          response.status === 404
            ? "This ChatMock has no /v1/embeddings yet. Update the chatmock checkout."
            : `ChatMock answered ${response.status} when asked for its embedding models.`,
      };
    }
    const payload = (await response.json()) as {
      localAvailable?: boolean;
      data?: Array<{ id?: string }>;
    };
    const offered = (payload.data ?? []).some((entry) => entry.id === EMBEDDING_MODEL);
    if (!payload.localAvailable) {
      return {
        ...base,
        available: false,
        reason:
          "ChatMock cannot embed locally yet. Install its embeddings extra (uv pip install fastembed in the chatmock checkout), then try again.",
      };
    }
    if (!offered) {
      return {
        ...base,
        available: false,
        reason: `ChatMock does not offer ${EMBEDDING_MODEL}.`,
      };
    }
    return { ...base, available: true, reason: null };
  } catch (error) {
    return {
      ...base,
      available: false,
      reason:
        error instanceof Error && error.name === "TimeoutError"
          ? "ChatMock did not answer in time."
          : "ChatMock could not be reached.",
    };
  }
}

export function invalidateEmbeddingsHealth(): void {
  globalCache.__breadboardDeepTutorEmbeddingsHealth = undefined;
}
