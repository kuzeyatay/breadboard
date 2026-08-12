// Embedding provider abstraction with dependency injection.
//
// Truthfulness rule: the adapter only reports "hybrid" retrieval when a provider
// can actually produce vectors. Provider "none" yields no vectors, and the store
// falls back to lexical FTS reported honestly as "lexical_degraded".
//
// The "chatmock" provider is the real one, and the default: Breadboard's local
// gateway serves `/v1/embeddings` from an ONNX model on the CPU, so genuine
// vectors need no key and no paid API. It is probed before it claims to be
// available — a configured endpoint that cannot be reached must degrade to
// lexical rather than assert hybrid and then return nothing.
//
// The "hash" provider remains for tests and air-gapped installs: stable vectors
// from token hashing, enough to exercise hybrid ranking end to end, and not a
// substitute for a real embedder.

export interface EmbeddingProvider {
  readonly name: string;
  /** Zero when this provider cannot produce vectors; drives `mode`. */
  readonly dimension: number;
  /** Returns null when the provider cannot embed (missing key, disabled). */
  embed(text: string): Promise<number[] | null>;
  /**
   * Optional liveness check, awaited once during store init. A provider that
   * fails it must report `dimension === 0` afterwards, so the store's honest
   * "hybrid vs lexical_degraded" answer stays honest for a remote endpoint
   * whose reachability cannot be known from configuration alone.
   */
  probe?(): Promise<boolean>;
}

const NONE: EmbeddingProvider = {
  name: "none",
  dimension: 0,
  async embed() {
    return null;
  },
};

/** Deterministic, offline hashed-bag-of-tokens embedder. Not for production RAG
 *  quality, but a real, reproducible vector source that legitimately enables the
 *  hybrid code path in tests and offline installs. */
function hashProvider(dimension = 64): EmbeddingProvider {
  return {
    name: "hash",
    dimension,
    async embed(text: string) {
      const vec = new Array<number>(dimension).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      for (const tok of tokens) {
        let h = 2166136261;
        for (let i = 0; i < tok.length; i++) {
          h ^= tok.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        const idx = Math.abs(h) % dimension;
        vec[idx] += 1;
      }
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    },
  };
}

/** Breadboard's local gateway, and the model it serves without a key. */
const CHATMOCK_DEFAULT_BASE_URL = "http://127.0.0.1:8765/v1";
const CHATMOCK_DEFAULT_MODEL = "local/bge-small-en-v1.5";
const CHATMOCK_DEFAULT_DIMENSION = 384;
const CHATMOCK_TIMEOUT_MS = 30_000;

export interface ChatmockProviderOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  dimension?: number;
}

/**
 * Vectors from an OpenAI-compatible endpoint — by default the ChatMock the rest
 * of Breadboard already talks to.
 *
 * Starts unavailable and turns itself on only once `probe` has seen a real
 * vector come back, because "the URL is configured" and "the service is up" are
 * different claims and only the second one justifies reporting hybrid.
 */
export function chatmockProvider(options: ChatmockProviderOptions = {}): EmbeddingProvider {
  const baseUrl = (options.baseUrl || CHATMOCK_DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = options.model || CHATMOCK_DEFAULT_MODEL;
  const apiKey = options.apiKey || "local";
  const declared = options.dimension || CHATMOCK_DEFAULT_DIMENSION;
  let dimension = 0;

  async function request(text: string): Promise<number[] | null> {
    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: text }),
        signal: AbortSignal.timeout(CHATMOCK_TIMEOUT_MS),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
      const vector = payload.data?.[0]?.embedding;
      return Array.isArray(vector) && vector.length > 0 ? vector : null;
    } catch {
      // Unreachable, slow, or malformed: all the same answer to the caller.
      return null;
    }
  }

  return {
    name: `chatmock:${model}`,
    get dimension() {
      return dimension;
    },
    async probe() {
      const vector = await request("breadboard embedding probe");
      dimension = vector ? vector.length : 0;
      return dimension > 0;
    },
    embed(text: string) {
      return request(text);
    },
  };
}

export function resolveProvider(name: string, options: ChatmockProviderOptions = {}): EmbeddingProvider {
  switch ((name || "chatmock").toLowerCase()) {
    case "hash":
    case "deterministic":
      return hashProvider();
    case "chatmock":
    case "openai-compatible":
    case "":
      return chatmockProvider(options);
    case "none":
      return NONE;
    default:
      // An unknown provider degrades to none rather than pretending to embed.
      // The health endpoint reports embeddingsAvailable=false.
      return NONE;
  }
}

/**
 * Cosine similarity, or 0 for vectors that are not comparable.
 *
 * Length equality is a correctness check, not a guard against crashes: vectors
 * of different widths come from different models, and a similarity computed
 * across the overlap of two unrelated spaces is a confident-looking number that
 * means nothing. This used to truncate to the shorter of the two, which made a
 * change of embedding model silently corrupt ranking instead of disabling it.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
