// Breadboard-owned GBrain retrieval types.
//
// These are the shapes Breadboard hands to Hermes. They are deliberately
// distinct from the raw adapter types: a Breadboard citation is keyed on the
// GARDEN (slug + page), never on an internal GBrain source id or a filesystem
// path. Internal ids and paths never cross this boundary.

export type GBrainRetrievalMode = "hybrid" | "lexical_degraded";

/** A citation Breadboard trusts and can render/open. Internal ids stay server-side. */
export interface BreadboardCitation {
  gardenId: string; // garden slug
  gardenName?: string;
  pageSlug?: string;
  title: string;
  /** Quartz-relative path for opening the page when authorized. Never absolute. */
  path?: string;
  excerpt?: string;
  /** Retrieval score, preserved for auditing; not shown as a user-facing number. */
  score?: number;
}

export interface GBrainSearchOutput {
  results: Array<{ title: string; excerpt: string; citation: BreadboardCitation }>;
  mode: GBrainRetrievalMode;
  warnings: string[];
}

export interface GBrainSynthesizeOutput {
  synthesis: string;
  citations: BreadboardCitation[];
  mode: GBrainRetrievalMode;
  warnings: string[];
}

export interface GBrainRetrieveOutput {
  found: boolean;
  title?: string;
  path?: string;
  content?: string;
  citation?: BreadboardCitation;
  warnings: string[];
}

export interface GBrainConnectionsOutput {
  neighbors: Array<{ gardenId: string; pageSlug: string; title: string; relation: string }>;
  warnings: string[];
}

export type GBrainStatusState =
  | "disabled"
  | "available-but-stopped"
  | "unavailable"
  | "degraded"
  | "healthy";

export interface GBrainStatusOutput {
  state: GBrainStatusState;
  mode: GBrainRetrievalMode | null;
  embeddingsAvailable: boolean;
  configuredGardens: number;
  message: string;
}

/** Durable result returned by the disposable Runtime V2 indexing worker. */
export interface GBrainSyncResult {
  clusterId: number;
  sourceId: string;
  status: "synced" | "stale" | "skipped";
  pagesIndexed: number;
  chunksIndexed: number;
  mode: string;
  revision?: string;
  error?: string;
}
