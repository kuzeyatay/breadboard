// Citation normalization + authorization validation.
//
// GBrain returns citations keyed on internal source ids. Before ANY citation
// crosses back to Hermes we (1) map its source id to a garden the caller is
// authorized for, and (2) drop it if it cannot be mapped. A synthesized textual
// citation can never establish authorization — only the server-owned mapping can.

import type { AdapterCitation } from "./client.ts";
import type { BreadboardCitation } from "./types.ts";

export interface AuthorizedSource {
  sourceId: string;
  gardenId: string; // slug
  gardenName?: string;
}

export function buildAuthorizedIndex(sources: AuthorizedSource[]): Map<string, AuthorizedSource> {
  const map = new Map<string, AuthorizedSource>();
  for (const s of sources) map.set(s.sourceId, s);
  return map;
}

/** Map one adapter citation into a Breadboard citation, or null if it does not
 *  resolve to an authorized garden. Never emits an absolute path or internal id. */
export function normalizeCitation(
  citation: AdapterCitation,
  authorized: Map<string, AuthorizedSource>,
): BreadboardCitation | null {
  const source = authorized.get(citation.sourceId);
  if (!source) return null; // unmapped/unauthorized -> dropped
  const pageSlug = citation.pageId;
  return {
    gardenId: source.gardenId,
    gardenName: source.gardenName,
    pageSlug,
    title: citation.title,
    // Garden-relative page path for opening in Quartz; never the absolute disk path.
    path: pageSlug ? `/${source.gardenId}/${pageSlug}` : undefined,
    excerpt: citation.excerpt,
    score: typeof citation.score === "number" ? citation.score : undefined,
  };
}

export function normalizeCitations(
  citations: AdapterCitation[],
  authorized: Map<string, AuthorizedSource>,
): { citations: BreadboardCitation[]; dropped: number } {
  const out: BreadboardCitation[] = [];
  let dropped = 0;
  for (const c of citations) {
    const mapped = normalizeCitation(c, authorized);
    if (mapped) out.push(mapped);
    else dropped++;
  }
  return { citations: out, dropped };
}
