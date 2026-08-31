// Production retrieval backend — wraps the VENDORED GBrain engine.
//
// Uses only GBrain public operations:
//   * createEngine (engine-factory) + connect/initSchema/disconnect  (lifecycle)
//   * addSource (sources-ops)                                        (source registration)
//   * importFromContent (import-file)                                (ingestion: parse+chunk+embed)
//   * searchKeyword / searchVector (engine)                          (retrieval)
//   * embedQuery (embedding)                                         (query-side vector)
//   * getPage (engine)                                               (retrieve)
//   * getLinks / getBacklinks (engine)                               (graph connections)
//   * addLinksBatch (engine)                                         (graph link storage)
//   * deletePages / getAllSlugs (engine)                             (idempotent re-index)
//
// Documented compatibility shims (no public op exists):
//   * stats() uses engine.executeRaw for count(*) — GBrain exposes no lightweight
//     total-count API; executeRaw is a public engine method used throughout
//     gbrain core (e.g. sources-ops.ts), not a private field.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createEngine } from "../../../gbrain/src/core/engine-factory.ts";
import { importFromContent } from "../../../gbrain/src/core/import-file.ts";
import { addSource } from "../../../gbrain/src/core/sources-ops.ts";
import {
  embedBatch,
  embedQuery,
  getEmbeddingDimensions,
  getEmbeddingModelName,
} from "../../../gbrain/src/core/embedding.ts";
import type { BrainEngine } from "../../../gbrain/src/core/engine.ts";
import { configureEmbedding, type EmbeddingEnv, type EmbeddingSetup } from "./embedding-config.ts";
import { resolveSourceFilter, type RetrievalBackend } from "./types.ts";
import type {
  GBrainCitation,
  GBrainEmbeddingResponse,
  GBrainGraphResponse,
  GBrainIndexPage,
  GBrainMode,
  GBrainRegisterSourceResponse,
  GBrainRetrieveResponse,
  GBrainScope,
  GBrainSearchResponse,
  GBrainSearchResult,
  GBrainSynthesizeResponse,
} from "../types.ts";

const RRF_K = 60;
const WINDOWS_BUN_PGLITE_EINVAL_RETRY_DELAY_MS = 150;

interface FreshPgliteRecoveryOptions {
  pgDir: string;
  platform?: NodeJS.Platform;
  bunVersion?: string;
  delay?: (milliseconds: number) => Promise<void>;
  readDirectory?: (directory: string) => string[];
}

function isDirectoryEmpty(
  directory: string,
  readDirectory: (directory: string) => string[],
): boolean {
  try {
    return readDirectory(directory).length === 0;
  } catch {
    return false;
  }
}

function isWindowsBunPgliteEinval(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Original error: Non-Error rejection:") &&
    message.includes('"name":"ErrnoError"') &&
    /"errno":28(?:[,}])/u.test(message)
  );
}

function windowsBunPgliteEinvalMessage(): Error {
  return new Error(
    "PGLite rejected a fresh Windows/Bun store with EINVAL (errno 28) after one bounded retry. " +
      "The store was left unchanged; this is a runtime filesystem initialization failure, " +
      "not evidence of lock contention, database corruption, or disk exhaustion.",
  );
}

/**
 * Recover one known intermittent Windows/Bun PGLite cold-start failure.
 *
 * The retry is deliberately narrower than the service restart policy: it is
 * allowed only for Emscripten EINVAL on a persistent store that was empty
 * before the first attempt and remains empty before the second. No files are
 * removed, no existing store is retried, and the second attempt is final.
 */
export async function connectFreshPgliteWithWindowsRecovery<T>(
  connect: () => Promise<T>,
  options: FreshPgliteRecoveryOptions,
): Promise<T> {
  const platform = options.platform ?? process.platform;
  const bunVersion =
    options.bunVersion ??
    (process.versions as Readonly<Record<string, string | undefined>>).bun;
  const readDirectory = options.readDirectory ?? fs.readdirSync;
  const delay =
    options.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  const eligibleFreshStore =
    options.pgDir !== ":memory:" &&
    platform === "win32" &&
    Boolean(bunVersion) &&
    isDirectoryEmpty(options.pgDir, readDirectory);

  try {
    return await connect();
  } catch (error) {
    if (
      !eligibleFreshStore ||
      !isWindowsBunPgliteEinval(error) ||
      !isDirectoryEmpty(options.pgDir, readDirectory)
    ) {
      throw error;
    }

    await delay(WINDOWS_BUN_PGLITE_EINVAL_RETRY_DELAY_MS);
    if (!isDirectoryEmpty(options.pgDir, readDirectory)) throw error;

    try {
      return await connect();
    } catch (retryError) {
      if (
        isWindowsBunPgliteEinval(retryError) &&
        isDirectoryEmpty(options.pgDir, readDirectory)
      ) {
        throw windowsBunPgliteEinvalMessage();
      }
      throw retryError;
    }
  }
}

interface EngineSearchRow {
  slug: string;
  title: string;
  chunk_text: string;
  chunk_id: number;
  score: number;
  source_id?: string;
}

export interface GBrainBackendOptions {
  pgDir: string;
  embeddingEnv: EmbeddingEnv;
}

export class GBrainEngineBackend implements RetrievalBackend {
  readonly backendName = "gbrain" as const;
  private engine: BrainEngine | null = null;
  private embedding: EmbeddingSetup = { available: false, provider: "none", model: null, dimensions: null };

  constructor(private options: GBrainBackendOptions) {}

  get embeddingsAvailable(): boolean {
    return this.embedding.available;
  }
  get mode(): GBrainMode {
    return this.embeddingsAvailable ? "hybrid" : "lexical_degraded";
  }
  get providerName(): string {
    return this.embedding.provider;
  }

  async embedTexts(texts: string[]): Promise<GBrainEmbeddingResponse> {
    if (!this.embeddingsAvailable) throw new Error("embedding_unavailable");
    const vectors = await embedBatch(texts, { maxRetries: 0 });
    const dimension = getEmbeddingDimensions();
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== dimension)) {
      throw new Error("embedding_unavailable");
    }
    return {
      model: getEmbeddingModelName(),
      dimension,
      vectors: vectors.map((vector) => Array.from(vector)),
    };
  }

  async init(): Promise<void> {
    // configureGateway MUST precede initSchema so the embedding column is sized
    // to the configured dimension.
    this.embedding = configureEmbedding(this.options.embeddingEnv);
    if (this.options.pgDir !== ":memory:") {
      fs.mkdirSync(this.options.pgDir, { recursive: true });
    }
    const config = { engine: "pglite" as const, database_path: this.options.pgDir === ":memory:" ? undefined : this.options.pgDir };
    this.engine = await connectFreshPgliteWithWindowsRecovery(
      async () => {
        // Each attempt owns a new engine. PGLiteEngine.connect() releases its
        // lock when create() rejects, so the one recovery attempt cannot reuse
        // partially initialized process state.
        const engine = await createEngine(config as never);
        await engine.connect(config as never);
        return engine;
      },
      { pgDir: this.options.pgDir },
    );
    await this.engine.initSchema();
  }

  async close(): Promise<void> {
    if (this.engine) {
      await this.engine.disconnect();
      this.engine = null;
    }
  }

  private require(): BrainEngine {
    if (!this.engine) throw new Error("backend_not_initialized");
    return this.engine;
  }

  async stats(): Promise<{ sources: number; pages: number; chunks: number }> {
    const engine = this.require() as BrainEngine & {
      executeRaw<T>(sql: string, params?: unknown[]): Promise<T[]>;
    };
    const one = async (sql: string): Promise<number> => {
      const rows = await engine.executeRaw<{ c: number | string }>(sql);
      const count = Number(rows[0]?.c);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("gbrain_stats_invalid_count");
      }
      return count;
    };
    return {
      sources: await one("SELECT count(*)::int AS c FROM sources"),
      pages: await one("SELECT count(*)::int AS c FROM pages WHERE deleted_at IS NULL"),
      chunks: await one("SELECT count(*)::int AS c FROM content_chunks"),
    };
  }

  private async ensureSource(sourceId: string, label: string): Promise<void> {
    const engine = this.require();
    try {
      await addSource(engine, { id: sourceId, name: label });
    } catch (err) {
      // Idempotent: an already-registered source is fine.
      if (err instanceof Error && /already registered|source_id_taken/i.test(err.message)) return;
      throw err;
    }
  }

  private buildMarkdown(page: GBrainIndexPage): string {
    const body = page.content.trim();
    // Ensure an H1 title so GBrain's parser records the Breadboard title verbatim.
    if (/^#\s+/m.test(body.split("\n")[0] ?? "")) return body;
    return `# ${page.title}\n\n${body}`;
  }

  async registerSource(
    sourceId: string,
    label: string,
    pages: GBrainIndexPage[],
  ): Promise<GBrainRegisterSourceResponse> {
    const engine = this.require();
    const warnings: string[] = [];
    await this.ensureSource(sourceId, label);

    // Idempotent full re-index: drop pages no longer present, then import.
    const incoming = new Set(pages.map((p) => p.pageId));
    const existing = await engine.getAllSlugs({ sourceId }).catch(() => new Set<string>());
    const toDelete = [...existing].filter((slug) => !incoming.has(slug));
    if (toDelete.length) {
      await engine.deletePages(toDelete, { sourceId }).catch(() => {});
    }

    let chunkCount = 0;
    for (const page of pages) {
      const result = await importFromContent(engine, page.pageId, this.buildMarkdown(page), {
        sourceId,
        noEmbed: !this.embeddingsAvailable,
        source_kind: "breadboard-sync",
      });
      chunkCount += result.chunks ?? 0;
    }

    // Second pass: store the Breadboard knowledge-graph links (both endpoints now
    // exist as pages). GBrain's batch JOIN silently drops edges to unknown slugs.
    const links = [] as Array<{
      from_slug: string;
      to_slug: string;
      link_type: string;
      link_source: string;
      from_source_id: string;
      to_source_id: string;
    }>;
    for (const page of pages) {
      for (const target of page.links ?? []) {
        if (typeof target === "string" && target && target !== page.pageId) {
          links.push({
            from_slug: page.pageId,
            to_slug: target,
            link_type: "related",
            link_source: "manual",
            from_source_id: sourceId,
            to_source_id: sourceId,
          });
        }
      }
    }
    if (links.length) {
      await engine.addLinksBatch(links as never).catch(() => {
        warnings.push("Some knowledge-graph links could not be stored.");
      });
    }

    const revision = crypto
      .createHash("sha256")
      .update(JSON.stringify(pages.map((p) => [p.pageId, p.content])))
      .digest("hex")
      .slice(0, 16);

    if (!this.embeddingsAvailable) {
      warnings.push("Indexed in lexical_degraded mode; no embedding provider configured.");
    }
    return {
      sourceId,
      pagesIndexed: pages.length,
      chunksIndexed: chunkCount,
      embedded: this.embeddingsAvailable,
      mode: this.mode,
      revision,
      warnings,
    };
  }

  private toResult(row: EngineSearchRow, fallbackSource: string): GBrainSearchResult {
    const excerpt = (row.chunk_text ?? "").slice(0, 320);
    const citation: GBrainCitation = {
      sourceId: row.source_id ?? fallbackSource,
      pageId: row.slug,
      title: row.title ?? row.slug,
      path: row.slug,
      excerpt,
      score: typeof row.score === "number" ? Number(row.score.toFixed(6)) : undefined,
    };
    return { title: row.title ?? row.slug, excerpt, citation };
  }

  async search(
    scope: GBrainScope,
    query: string,
    requested: string[] | undefined,
    limit = 8,
  ): Promise<GBrainSearchResponse> {
    const sources = resolveSourceFilter(scope, requested);
    if (sources.length === 0) {
      return { results: [], mode: this.mode, warnings: ["No authorized sources in scope."] };
    }
    const q = (query ?? "").slice(0, 2000).trim();
    if (!q) return { results: [], mode: this.mode, warnings: ["Empty query."] };
    const engine = this.require();
    const warnings: string[] = [];

    const keyword = (await engine
      .searchKeyword(q, { sourceIds: sources, limit: limit * 2 } as never)
      .catch(() => [])) as EngineSearchRow[];

    let vector: EngineSearchRow[] = [];
    if (this.embeddingsAvailable) {
      try {
        const qvec = await embedQuery(q);
        vector = (await engine.searchVector(qvec, { sourceIds: sources, limit: limit * 2 } as never)) as EngineSearchRow[];
      } catch {
        warnings.push("Vector search failed; returned keyword results only.");
      }
    }

    // Reciprocal-rank fusion keyed on (source_id, slug, chunk_id).
    const key = (r: EngineSearchRow) => `${r.source_id ?? sources[0]}::${r.slug}::${r.chunk_id}`;
    const scores = new Map<string, { row: EngineSearchRow; score: number }>();
    keyword.forEach((row, i) => scores.set(key(row), { row, score: 1 / (RRF_K + i + 1) }));
    vector.forEach((row, i) => {
      const k = key(row);
      const add = 1 / (RRF_K + i + 1);
      const existing = scores.get(k);
      if (existing) existing.score += add;
      else scores.set(k, { row, score: add });
    });

    const ranked = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    const results = ranked.map((e) => this.toResult(e.row, sources[0]));
    if (!this.embeddingsAvailable) warnings.push("Retrieval ran in lexical_degraded mode (no embeddings).");
    return { results, mode: this.mode, warnings };
  }

  async retrieve(scope: GBrainScope, sourceId: string, pageId: string): Promise<GBrainRetrieveResponse> {
    const sources = resolveSourceFilter(scope, [sourceId]);
    if (sources.length === 0) return { found: false, warnings: ["Source is outside the authorized scope."] };
    const engine = this.require();
    const page = await engine.getPage(pageId, { sourceId }).catch(() => null);
    if (!page || (page.source_id && page.source_id !== sourceId)) {
      return { found: false, warnings: ["Page not found."] };
    }
    const content = page.compiled_truth ?? "";
    return {
      found: true,
      title: page.title,
      path: pageId,
      content,
      citation: { sourceId, pageId, title: page.title, path: pageId, excerpt: content.slice(0, 320) },
      warnings: [],
    };
  }

  async graphNeighbors(
    scope: GBrainScope,
    pageId: string,
    sourceId: string | undefined,
    limit = 12,
  ): Promise<GBrainGraphResponse> {
    const sources = resolveSourceFilter(scope, sourceId ? [sourceId] : undefined);
    if (sources.length === 0) return { neighbors: [], warnings: ["No authorized sources in scope."] };
    const engine = this.require();
    const neighbors: GBrainGraphResponse["neighbors"] = [];
    const seen = new Set<string>();
    for (const src of sources) {
      const out = (await engine.getLinks(pageId, { sourceId: src }).catch(() => [])) as Array<{
        to_slug: string;
        from_slug: string;
      }>;
      const inbound = (await engine.getBacklinks(pageId, { sourceId: src }).catch(() => [])) as Array<{
        to_slug: string;
        from_slug: string;
      }>;
      for (const link of out) {
        const target = link.to_slug;
        const k = `${src}::${target}::links_to`;
        if (target && target !== pageId && !seen.has(k)) {
          seen.add(k);
          neighbors.push({ sourceId: src, pageId: target, title: target, relation: "links_to" });
        }
      }
      for (const link of inbound) {
        const target = link.from_slug;
        const k = `${src}::${target}::linked_from`;
        if (target && target !== pageId && !seen.has(k)) {
          seen.add(k);
          neighbors.push({ sourceId: src, pageId: target, title: target, relation: "linked_from" });
        }
      }
      if (neighbors.length >= limit) break;
    }
    // Enrich titles where cheap.
    for (const n of neighbors.slice(0, limit)) {
      const page = await engine.getPage(n.pageId, { sourceId: n.sourceId }).catch(() => null);
      if (page?.title) n.title = page.title;
    }
    return { neighbors: neighbors.slice(0, limit), warnings: [] };
  }

  async synthesize(
    scope: GBrainScope,
    query: string,
    requested: string[] | undefined,
    limit = 6,
  ): Promise<GBrainSynthesizeResponse> {
    // Extractive synthesis grounded in ACTUAL GBrain retrieval. LLM synthesis is
    // deferred until a chat provider is configured (documented limitation); this
    // never falls back to un-grounded model knowledge.
    const search = await this.search(scope, query, requested, limit);
    if (search.results.length === 0) {
      return {
        synthesis: "",
        citations: [],
        mode: search.mode,
        warnings: [...search.warnings, "No grounded material found for synthesis."],
      };
    }
    const lines = search.results.map(
      (r, i) => `[${i + 1}] ${r.title}: ${r.excerpt.replace(/\s+/g, " ").trim()}`,
    );
    return {
      synthesis: lines.join("\n"),
      citations: search.results.map((r) => r.citation),
      mode: search.mode,
      warnings: search.warnings,
    };
  }
}
