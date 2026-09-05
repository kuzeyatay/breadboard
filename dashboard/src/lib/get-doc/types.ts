// What a found document looks like once every catalog has been normalized into
// one shape. Shared by the search pipeline, the run manager, the API routes and
// the chat card, so the browser and the server describe a paper the same way.

import type { DocumentSourceId } from "./identity.ts";

export interface DocumentHit {
  /** Stable within a run — this is what a download request names. */
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  /** Journal, conference or repository the work appeared in. */
  venue: string | null;
  doi: string | null;
  /** The abstract as published, when a catalog carries one. */
  abstract: string | null;
  /** One or two sentences on what this is and why it matched. */
  description: string;
  /**
   * How the paper bears on what was asked, judged from its metadata and
   * abstract: `direct` answers it, `adjacent` informs it, `none` merely shares
   * words with it. Absent when the describe pass did not run.
   */
  bearing?: "direct" | "adjacent" | "none";
  /** True when a legal, free full text was found for it. */
  openAccess: boolean;
  citationCount: number | null;
  /** The page a human should open — publisher, repository or catalog record. */
  landingPage: string | null;
  /** Direct link to the PDF, when one is legally available. */
  pdfUrl: string | null;
  /** Which resolver produced `pdfUrl`, for the "where did this come from" line. */
  pdfSource: DocumentSourceId | "unpaywall" | null;
  /** Every catalog that returned this work, best first. */
  sources: DocumentSourceId[];
}

/** How one catalog fared, so a partial search can say what it is missing. */
export interface SourceReport {
  source: DocumentSourceId;
  status: "ok" | "empty" | "error" | "skipped";
  /** Results this catalog contributed before merging. */
  count: number;
  /** Why it was skipped or how it failed, in one line. */
  note?: string;
}

/** A hit as one catalog reported it, before merging and ranking. */
export interface RawHit {
  source: DocumentSourceId;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  abstract: string | null;
  openAccess: boolean;
  citationCount: number | null;
  landingPage: string | null;
  pdfUrl: string | null;
}
