// Embedding provider abstraction with dependency injection.
//
// Truthfulness rule: the adapter only reports "hybrid" retrieval when a provider
// can actually produce vectors. Provider "none" (the default) yields no vectors,
// and the store falls back to lexical FTS reported honestly as "lexical_degraded".
//
// The "hash" provider is a deterministic, offline, dependency-free embedder used
// by tests and by air-gapped installs. It produces stable vectors from token
// hashing, so hybrid ranking is exercised end-to-end without any paid API. Real
// paid providers (openai/voyage/…) are added later behind their own keys; when a
// key is missing they degrade to lexical rather than silently claiming hybrid.

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  /** Returns null when the provider cannot embed (missing key, disabled). */
  embed(text: string): Promise<number[] | null>;
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

export function resolveProvider(name: string): EmbeddingProvider {
  switch ((name || "none").toLowerCase()) {
    case "hash":
    case "deterministic":
      return hashProvider();
    case "none":
    case "":
      return NONE;
    default:
      // An unknown/unconfigured real provider degrades to none rather than
      // pretending to embed. The health endpoint reports embeddingsAvailable=false.
      return NONE;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
