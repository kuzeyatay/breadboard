// Durable retrieval store backed by PGLite (embedded Postgres via WASM).
//
// This is a purpose-built, first-party layer — NOT a canonical source of truth.
// It holds only DERIVED retrieval state: chunks, optional embeddings, an FTS
// index, and light graph links. Breadboard remains authoritative for the
// canonical markdown; registerSource re-indexes idempotently from that markdown.
//
// The full vendored GBrain engine (gbrain/src) is intentionally left unmodified
// and unimported here; standing up its ~90-operation schema is out of scope for
// the initial durable slice. This store implements exactly the retrieval
// Breadboard needs, so the trust boundary and durability can be proven end-to-end
// today, while the vendored engine remains available for a future swap behind the
// same adapter contract. See docs/GBRAIN_INTEGRATION.md.

import { PGlite } from "@electric-sql/pglite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cosine, resolveProvider, type EmbeddingProvider } from "./embedding.ts";
import type { RetrievalBackend } from "./backends/types.ts";
import type {
  GBrainCitation,
  GBrainGraphResponse,
  GBrainIndexPage,
  GBrainMode,
  GBrainRegisterSourceResponse,
  GBrainRetrieveResponse,
  GBrainScope,
  GBrainSearchResponse,
  GBrainSearchResult,
  GBrainSynthesizeResponse,
} from "./types.ts";

const CHUNK_MAX_CHARS = 900;
const RRF_K = 60;
const VECTOR_SCAN_CAP = 4000;

export interface StoreOptions {
  pgDir: string;
  embeddingProvider?: string;
  /** Where a remote embedder lives, when the provider is one. */
  embeddingBaseUrl?: string;
  embeddingModel?: string;
  embeddingApiKey?: string;
}

function chunkContent(content: string): string[] {
  const blocks = content
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const block of blocks) {
    if ((current + "\n\n" + block).length > CHUNK_MAX_CHARS && current) {
      chunks.push(current);
      current = block;
    } else {
      current = current ? current + "\n\n" + block : block;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [content.slice(0, CHUNK_MAX_CHARS)];
}

/** Intersect requested sources with the authorized set. Fail closed on empty scope. */
function resolveSourceFilter(scope: GBrainScope, requested?: string[]): string[] {
  const authorized = new Set((scope.authorizedSourceIds ?? []).filter(Boolean));
  if (authorized.size === 0) return [];
  if (!requested || requested.length === 0) return [...authorized];
  return requested.filter((id) => authorized.has(id));
}

// Deterministic, first-party PGLite store. This is the `fake` backend — a
// test-only / explicitly-named fallback. It is NEVER the default and is NEVER
// reported as "gbrain" in status (backendName = "fake"). The production backend
// is GBrainEngineBackend, which wraps the vendored GBrain engine.
export class GBrainStore implements RetrievalBackend {
  readonly backendName = "fake" as const;
  private db: PGlite | null = null;
  private provider: EmbeddingProvider;
  private ready = false;

  constructor(private options: StoreOptions) {
    this.provider = resolveProvider(options.embeddingProvider ?? "chatmock", {
      baseUrl: options.embeddingBaseUrl,
      model: options.embeddingModel,
      apiKey: options.embeddingApiKey,
    });
  }

  get embeddingsAvailable(): boolean {
    return this.provider.dimension > 0;
  }

  get mode(): GBrainMode {
    return this.embeddingsAvailable ? "hybrid" : "lexical_degraded";
  }

  get providerName(): string {
    return this.provider.name;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    // A remote embedder is asked to prove itself before the store reports
    // hybrid: a configured endpoint that is not running would otherwise claim a
    // retrieval mode it cannot deliver.
    if (this.provider.probe) await this.provider.probe();
    if (this.options.pgDir !== ":memory:") {
      fs.mkdirSync(path.dirname(this.options.pgDir), { recursive: true });
    }
    this.db = new PGlite(this.options.pgDir === ":memory:" ? undefined : this.options.pgDir);
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        source_id TEXT PRIMARY KEY,
        label     TEXT NOT NULL,
        revision  TEXT NOT NULL,
        embedded  BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS pages (
        source_id TEXT NOT NULL,
        page_id   TEXT NOT NULL,
        title     TEXT NOT NULL,
        path      TEXT NOT NULL,
        content   TEXT NOT NULL,
        PRIMARY KEY (source_id, page_id)
      );
      CREATE TABLE IF NOT EXISTS chunks (
        id        BIGSERIAL PRIMARY KEY,
        source_id TEXT NOT NULL,
        page_id   TEXT NOT NULL,
        ordinal   INT  NOT NULL,
        content   TEXT NOT NULL,
        embedding TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_fts ON chunks USING gin (to_tsvector('english', content));
      CREATE TABLE IF NOT EXISTS links (
        source_id      TEXT NOT NULL,
        page_id        TEXT NOT NULL,
        target_page_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
    `);
    this.ready = true;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.ready = false;
    }
  }

  private require(): PGlite {
    if (!this.db) throw new Error("store_not_initialized");
    return this.db;
  }

  async stats(): Promise<{ sources: number; pages: number; chunks: number }> {
    const db = this.require();
    const s = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM sources`);
    const p = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM pages`);
    const c = await db.query<{ c: number }>(`SELECT count(*)::int AS c FROM chunks`);
    return { sources: s.rows[0].c, pages: p.rows[0].c, chunks: c.rows[0].c };
  }

  /** Idempotent full re-index of one source from canonical markdown. */
  async registerSource(
    sourceId: string,
    label: string,
    pages: GBrainIndexPage[],
  ): Promise<GBrainRegisterSourceResponse> {
    const db = this.require();
    const warnings: string[] = [];
    const revision = crypto
      .createHash("sha256")
      .update(JSON.stringify(pages.map((p) => [p.pageId, p.content])))
      .digest("hex")
      .slice(0, 16);

    await db.exec("BEGIN");
    try {
      await db.query(`DELETE FROM chunks WHERE source_id = $1`, [sourceId]);
      await db.query(`DELETE FROM pages WHERE source_id = $1`, [sourceId]);
      await db.query(`DELETE FROM links WHERE source_id = $1`, [sourceId]);
      let chunkCount = 0;
      let embeddedAll = this.embeddingsAvailable;
      for (const page of pages) {
        await db.query(
          `INSERT INTO pages (source_id, page_id, title, path, content) VALUES ($1,$2,$3,$4,$5)`,
          [sourceId, page.pageId, page.title, page.path, page.content],
        );
        for (const target of page.links ?? []) {
          await db.query(
            `INSERT INTO links (source_id, page_id, target_page_id) VALUES ($1,$2,$3)`,
            [sourceId, page.pageId, target],
          );
        }
        const chunks = chunkContent(page.content);
        for (let i = 0; i < chunks.length; i++) {
          let embedding: string | null = null;
          if (this.embeddingsAvailable) {
            const vec = await this.provider.embed(chunks[i]);
            if (vec) embedding = JSON.stringify(vec);
            else embeddedAll = false;
          }
          await db.query(
            `INSERT INTO chunks (source_id, page_id, ordinal, content, embedding) VALUES ($1,$2,$3,$4,$5)`,
            [sourceId, page.pageId, i, chunks[i], embedding],
          );
          chunkCount++;
        }
      }
      await db.query(
        `INSERT INTO sources (source_id, label, revision, embedded, updated_at)
         VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (source_id) DO UPDATE SET label = EXCLUDED.label,
           revision = EXCLUDED.revision, embedded = EXCLUDED.embedded, updated_at = now()`,
        [sourceId, label, revision, embeddedAll],
      );
      await db.exec("COMMIT");
      if (!this.embeddingsAvailable) {
        warnings.push("Indexed in lexical_degraded mode; no embedding provider configured.");
      }
      return {
        sourceId,
        pagesIndexed: pages.length,
        chunksIndexed: chunkCount,
        embedded: embeddedAll,
        mode: this.mode,
        revision,
        warnings,
      };
    } catch (err) {
      await db.exec("ROLLBACK").catch(() => {});
      throw err;
    }
  }

  private async lexicalRank(
    sources: string[],
    query: string,
    limit: number,
  ): Promise<Array<{ id: number; source_id: string; page_id: string; content: string; rank: number }>> {
    const db = this.require();
    const placeholders = sources.map((_, i) => `$${i + 2}`).join(",");
    const res = await db.query<{
      id: number;
      source_id: string;
      page_id: string;
      content: string;
      rank: number;
    }>(
      `SELECT id, source_id, page_id, content,
              ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) AS rank
       FROM chunks
       WHERE source_id IN (${placeholders})
         AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT ${Math.max(1, limit * 3)}`,
      [query, ...sources],
    );
    return res.rows;
  }

  private async vectorRank(
    sources: string[],
    query: string,
    limit: number,
  ): Promise<Array<{ id: number; source_id: string; page_id: string; content: string; sim: number }>> {
    if (!this.embeddingsAvailable) return [];
    const qvec = await this.provider.embed(query);
    if (!qvec) return [];
    const db = this.require();
    const placeholders = sources.map((_, i) => `$${i + 1}`).join(",");
    const res = await db.query<{
      id: number;
      source_id: string;
      page_id: string;
      content: string;
      embedding: string | null;
    }>(
      `SELECT id, source_id, page_id, content, embedding FROM chunks
       WHERE source_id IN (${placeholders}) AND embedding IS NOT NULL
       LIMIT ${VECTOR_SCAN_CAP}`,
      sources,
    );
    return res.rows
      .map((row) => ({
        id: row.id,
        source_id: row.source_id,
        page_id: row.page_id,
        content: row.content,
        sim: cosine(qvec, JSON.parse(row.embedding as string) as number[]),
      }))
      // A vector stored under a previous embedding model has a different width
      // and scores 0; dropping those rows keeps them from padding the result
      // list ahead of chunks that genuinely matched.
      .filter((row) => row.sim > 0)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, limit * 3);
  }

  private async pageMeta(sourceId: string, pageId: string): Promise<{ title: string; path: string } | null> {
    const db = this.require();
    const res = await db.query<{ title: string; path: string }>(
      `SELECT title, path FROM pages WHERE source_id = $1 AND page_id = $2`,
      [sourceId, pageId],
    );
    return res.rows[0] ?? null;
  }

  async search(
    scope: GBrainScope,
    query: string,
    requested: string[] | undefined,
    limit = 8,
  ): Promise<GBrainSearchResponse> {
    const sources = resolveSourceFilter(scope, requested);
    const warnings: string[] = [];
    if (sources.length === 0) {
      return { results: [], mode: this.mode, warnings: ["No authorized sources in scope."] };
    }
    const q = (query ?? "").slice(0, 2000).trim();
    if (!q) return { results: [], mode: this.mode, warnings: ["Empty query."] };

    const [lex, vec] = await Promise.all([
      this.lexicalRank(sources, q, limit),
      this.vectorRank(sources, q, limit),
    ]);

    // Reciprocal-rank fusion of the two ranked lists.
    const scores = new Map<number, { row: { source_id: string; page_id: string; content: string }; score: number }>();
    lex.forEach((row, i) => {
      scores.set(row.id, { row, score: 1 / (RRF_K + i + 1) });
    });
    vec.forEach((row, i) => {
      const existing = scores.get(row.id);
      const add = 1 / (RRF_K + i + 1);
      if (existing) existing.score += add;
      else scores.set(row.id, { row, score: add });
    });

    const ranked = [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    const results: GBrainSearchResult[] = [];
    for (const entry of ranked) {
      const meta = await this.pageMeta(entry.row.source_id, entry.row.page_id);
      const citation: GBrainCitation = {
        sourceId: entry.row.source_id,
        pageId: entry.row.page_id,
        title: meta?.title ?? entry.row.page_id,
        path: meta?.path,
        excerpt: entry.row.content.slice(0, 320),
        score: Number(entry.score.toFixed(6)),
      };
      results.push({
        title: meta?.title ?? entry.row.page_id,
        excerpt: entry.row.content.slice(0, 320),
        citation,
      });
    }
    if (!this.embeddingsAvailable) {
      warnings.push("Retrieval ran in lexical_degraded mode (no embeddings).");
    }
    return { results, mode: this.mode, warnings };
  }

  async retrieve(scope: GBrainScope, sourceId: string, pageId: string): Promise<GBrainRetrieveResponse> {
    const sources = resolveSourceFilter(scope, [sourceId]);
    if (sources.length === 0) {
      return { found: false, warnings: ["Source is outside the authorized scope."] };
    }
    const db = this.require();
    const res = await db.query<{ title: string; path: string; content: string }>(
      `SELECT title, path, content FROM pages WHERE source_id = $1 AND page_id = $2`,
      [sourceId, pageId],
    );
    const row = res.rows[0];
    if (!row) return { found: false, warnings: ["Page not found."] };
    return {
      found: true,
      title: row.title,
      path: row.path,
      content: row.content,
      citation: { sourceId, pageId, title: row.title, path: row.path, excerpt: row.content.slice(0, 320) },
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
    const db = this.require();
    const placeholders = sources.map((_, i) => `$${i + 2}`).join(",");
    const res = await db.query<{ source_id: string; page_id: string; target_page_id: string; direction: string }>(
      `SELECT source_id, page_id, target_page_id, 'out' AS direction FROM links
         WHERE page_id = $1 AND source_id IN (${placeholders})
       UNION
       SELECT source_id, page_id, target_page_id, 'in' AS direction FROM links
         WHERE target_page_id = $1 AND source_id IN (${placeholders})
       LIMIT ${limit}`,
      [pageId, ...sources],
    );
    const neighbors = [];
    for (const row of res.rows) {
      const neighborId = row.direction === "out" ? row.target_page_id : row.page_id;
      const meta = await this.pageMeta(row.source_id, neighborId);
      neighbors.push({
        sourceId: row.source_id,
        pageId: neighborId,
        title: meta?.title ?? neighborId,
        relation: row.direction === "out" ? "links_to" : "linked_from",
      });
    }
    return { neighbors, warnings: [] };
  }

  /** Extractive synthesis: assembles retrieved excerpts with citations. Never
   *  invents content and never falls back to un-grounded model knowledge. */
  async synthesize(
    scope: GBrainScope,
    query: string,
    requested: string[] | undefined,
    limit = 6,
  ): Promise<GBrainSynthesizeResponse> {
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
