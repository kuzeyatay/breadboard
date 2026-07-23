// Retrieval backend abstraction.
//
// Two implementations sit behind this interface:
//   * `gbrain` (production default) — wraps the VENDORED GBrain engine via its
//     public interfaces (createEngine, importFromContent, searchKeyword,
//     searchVector, getLinks/getBacklinks). This is the real integration.
//   * `fake` (test-only) — a deterministic first-party PGLite store. Never the
//     default; startup rejects it in packaged production unless a test flag is on.
//
// The external adapter HTTP contract (server.ts) is identical for both.

import type {
  GBrainGraphResponse,
  GBrainRegisterSourceResponse,
  GBrainRetrieveResponse,
  GBrainScope,
  GBrainSearchResponse,
  GBrainSynthesizeResponse,
  GBrainMode,
  GBrainIndexPage,
} from "../types.ts";

export interface RetrievalBackend {
  /** Stable identifier surfaced in health/status. Never lie: the fake backend
   *  reports "fake", not "gbrain". */
  readonly backendName: "gbrain" | "fake";
  readonly mode: GBrainMode;
  readonly providerName: string;
  readonly embeddingsAvailable: boolean;

  init(): Promise<void>;
  close(): Promise<void>;
  stats(): Promise<{ sources: number; pages: number; chunks: number }>;

  registerSource(
    sourceId: string,
    label: string,
    pages: GBrainIndexPage[],
  ): Promise<GBrainRegisterSourceResponse>;

  search(
    scope: GBrainScope,
    query: string,
    requested: string[] | undefined,
    limit?: number,
  ): Promise<GBrainSearchResponse>;

  retrieve(scope: GBrainScope, sourceId: string, pageId: string): Promise<GBrainRetrieveResponse>;

  graphNeighbors(
    scope: GBrainScope,
    pageId: string,
    sourceId: string | undefined,
    limit?: number,
  ): Promise<GBrainGraphResponse>;

  synthesize(
    scope: GBrainScope,
    query: string,
    requested: string[] | undefined,
    limit?: number,
  ): Promise<GBrainSynthesizeResponse>;
}

/** Intersect requested sources with the authorized set. Fail closed on empty scope.
 *  Shared by both backends so the trust boundary is identical. */
export function resolveSourceFilter(scope: GBrainScope, requested?: string[]): string[] {
  const authorized = new Set((scope.authorizedSourceIds ?? []).filter(Boolean));
  if (authorized.size === 0) return [];
  if (!requested || requested.length === 0) return [...authorized];
  return requested.filter((id) => authorized.has(id));
}
