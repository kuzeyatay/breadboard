// The bridge to the vendored mem0 OSS engine (mem0/mem0-ts, built to dist/).
//
// Everything identity-bearing stays Breadboard's: mem0 sees an opaque
// per-user tag and stores only derived index entries. The engine is imported
// dynamically, so a checkout without the built vendor package — or with the
// layer switched off — costs nothing and every caller degrades to lexical
// retrieval.
//
// Extraction LLM calls go to ChatMock's chat endpoint; embeddings go wherever
// lib/embeddings.ts points, so the semantic index lives in the same vector
// space as every other Breadboard retriever.

import fs from "node:fs";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { localChatmockBaseUrl } from "../chatmock-server.ts";
import { mem0Config, type Mem0Config } from "./config.ts";

export interface SemanticMemoryHit {
  mem0Id: string;
  text: string;
  /** Combined mem0 relevance, clamped to [0, 1]. */
  similarity: number;
}

export interface SemanticFact {
  mem0Id: string;
  text: string;
}

export interface SemanticMemoryClient {
  /** Index text verbatim — no LLM call. Resolves to the mem0 entry id. */
  index(
    text: string,
    scope: { userId: number; metadata?: Record<string, unknown> },
  ): Promise<string | null>;
  search(
    query: string,
    scope: { userId: number; topK?: number },
  ): Promise<SemanticMemoryHit[]>;
  /** LLM fact extraction over one exchange; returns the facts mem0 stored. */
  extract(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
    scope: { userId: number },
  ): Promise<SemanticFact[]>;
  remove(mem0Id: string): Promise<void>;
}

/** mem0-side identity. Opaque on purpose: mem0 never sees emails or names. */
export function mem0UserTag(userId: number): string {
  return `bb-user-${userId}`;
}

type Mem0Global = typeof globalThis & {
  __breadboardMem0?: { key: string; client: SemanticMemoryClient };
};

/**
 * The live client, or null when the layer is off or the vendor package is
 * absent. Cached on globalThis (keyed by config) to survive dev-mode HMR —
 * better-sqlite3 handles are cheap to hold and expensive to churn.
 */
export async function semanticMemoryClient(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SemanticMemoryClient | null> {
  const config = mem0Config(env);
  if (!config.enabled) return null;
  const key = [
    config.vectorStorePath,
    config.embedding.baseUrl,
    config.embedding.model,
    config.llmModel,
  ].join("|");
  const cache = globalThis as Mem0Global;
  if (cache.__breadboardMem0?.key === key) return cache.__breadboardMem0.client;
  try {
    const client = await createEngineClient(config, env);
    cache.__breadboardMem0 = { key, client };
    return client;
  } catch {
    // Missing vendor build, unwritable data dir, … — truthful degradation.
    return null;
  }
}

async function createEngineClient(
  config: Mem0Config,
  env: NodeJS.ProcessEnv,
): Promise<SemanticMemoryClient> {
  // mem0 phones telemetry to PostHog unless told otherwise. An explicit user
  // choice wins; the default here is off, matching "no network but ChatMock".
  if (env.MEM0_TELEMETRY === undefined) env.MEM0_TELEMETRY = "false";
  const { Memory } = await import("mem0ai/oss");
  fs.mkdirSync(config.dataDir, { recursive: true });
  const dimension = config.embedding.dimension > 0 ? config.embedding.dimension : undefined;
  const engine = new Memory({
    llm: {
      provider: "openai",
      config: {
        baseURL: localChatmockBaseUrl().replace(/\/$/, ""),
        apiKey: chatmockApiKeyValue(env),
        model: config.llmModel,
        temperature: 0,
        timeout: 60_000,
      },
    },
    embedder: {
      provider: "openai",
      config: {
        baseURL: config.embedding.baseUrl,
        apiKey: config.embedding.apiKey,
        model: config.embedding.model,
        ...(dimension !== undefined ? { embeddingDims: dimension } : {}),
      },
    },
    vectorStore: {
      provider: "memory", // mem0's misleadingly named SQLite-on-disk store
      config: {
        collectionName: "breadboard_durable",
        dbPath: config.vectorStorePath,
        ...(dimension !== undefined ? { dimension } : {}),
      },
    },
    historyStore: {
      provider: "sqlite",
      config: { historyDbPath: config.historyPath },
    },
  });

  return {
    async index(text, scope) {
      const added = await engine.add([{ role: "user", content: text }], {
        userId: mem0UserTag(scope.userId),
        infer: false,
        ...(scope.metadata ? { metadata: scope.metadata } : {}),
      });
      const id = added.results?.[0]?.id;
      if (id) return id;
      // mem0 deduplicates by exact hash and answers with an empty result for
      // text it already holds. Find the entry it kept instead.
      const hits = await engine.search(text, {
        filters: { user_id: mem0UserTag(scope.userId) },
        topK: 3,
      });
      return hits.results?.find((item) => item.memory === text)?.id ?? null;
    },

    async search(query, scope) {
      const found = await engine.search(query, {
        // search() rejects top-level entity params and requires snake_case
        // filter keys — camelCase silently matches nothing.
        filters: { user_id: mem0UserTag(scope.userId) },
        topK: scope.topK ?? 24,
      });
      return (found.results ?? []).flatMap((item) => {
        if (!item.id || typeof item.memory !== "string") return [];
        const score = typeof item.score === "number" ? item.score : 0;
        return [{
          mem0Id: item.id,
          text: item.memory,
          similarity: Math.max(0, Math.min(1, score)),
        }];
      });
    },

    async extract(messages, scope) {
      const added = await engine.add(
        messages.map((message) => ({
          role: message.role,
          content: message.content.slice(0, 4_000),
        })),
        { userId: mem0UserTag(scope.userId) },
      );
      return (added.results ?? []).flatMap((item) =>
        item.id && typeof item.memory === "string" && item.memory.trim()
          ? [{ mem0Id: item.id, text: item.memory }]
          : [],
      );
    },

    async remove(mem0Id) {
      if (!mem0Id) return;
      try {
        await engine.delete(mem0Id);
      } catch {
        // Deleting an entry that is already gone is success, not failure.
      }
    },
  };
}
