// Typed internal contract for the Breadboard GBrain adapter.
//
// This is the ONLY surface Breadboard's dashboard talks to. It is deliberately
// narrow: search, retrieve, synthesize, graph neighbors, source registration,
// sync, and health. There is no admin, no arbitrary import, no delete, no schema
// mutation, no shell. Every request that touches knowledge carries a
// server-derived authorization scope; an empty scope fails closed.

export interface GBrainScope {
  /** Breadboard user id, as a string. Server-derived; never a model argument. */
  userId: string;
  /** Internal GBrain source ids the caller is authorized to read. */
  authorizedSourceIds: string[];
}

export interface GBrainSearchRequest {
  scope: GBrainScope;
  query: string;
  /** Optional narrowing to a subset of the authorized sources. */
  sourceIds?: string[];
  limit?: number;
}

export interface GBrainCitation {
  /** Internal GBrain source id. Breadboard maps this back to a garden/page. */
  sourceId: string;
  pageId?: string;
  title: string;
  path?: string;
  excerpt?: string;
  score?: number;
}

export type GBrainMode = "hybrid" | "lexical_degraded";

export interface GBrainSearchResult {
  title: string;
  excerpt: string;
  citation: GBrainCitation;
}

export interface GBrainSearchResponse {
  results: GBrainSearchResult[];
  mode: GBrainMode;
  warnings: string[];
}

export interface GBrainRetrieveRequest {
  scope: GBrainScope;
  sourceId: string;
  pageId: string;
}

export interface GBrainRetrieveResponse {
  found: boolean;
  title?: string;
  path?: string;
  content?: string;
  citation?: GBrainCitation;
  warnings: string[];
}

export interface GBrainSynthesizeRequest {
  scope: GBrainScope;
  query: string;
  sourceIds?: string[];
  limit?: number;
}

export interface GBrainSynthesizeResponse {
  /** Extractive synthesis assembled from retrieved chunks. Never hallucinated. */
  synthesis: string;
  citations: GBrainCitation[];
  mode: GBrainMode;
  warnings: string[];
}

export interface GBrainGraphRequest {
  scope: GBrainScope;
  pageId: string;
  sourceId?: string;
  limit?: number;
}

export interface GBrainGraphNeighbor {
  sourceId: string;
  pageId: string;
  title: string;
  relation: string;
}

export interface GBrainGraphResponse {
  neighbors: GBrainGraphNeighbor[];
  warnings: string[];
}

/** A page pushed into the index. Content is canonical Breadboard markdown. */
export interface GBrainIndexPage {
  pageId: string;
  title: string;
  path: string;
  content: string;
  /** Optional outbound links (target pageIds) for graph neighbor lookups. */
  links?: string[];
}

export interface GBrainRegisterSourceRequest {
  sourceId: string;
  /** Opaque Breadboard-owned label, e.g. the garden slug. Never a filesystem path. */
  label: string;
  pages: GBrainIndexPage[];
}

export interface GBrainRegisterSourceResponse {
  sourceId: string;
  pagesIndexed: number;
  chunksIndexed: number;
  embedded: boolean;
  mode: GBrainMode;
  revision: string;
  warnings: string[];
}

export interface GBrainHealth {
  status: "healthy" | "degraded";
  ready: boolean;
  mode: GBrainMode;
  embeddingProvider: string;
  embeddingsAvailable: boolean;
  sources: number;
  pages: number;
  chunks: number;
  dataDir: string;
  version: string;
}
