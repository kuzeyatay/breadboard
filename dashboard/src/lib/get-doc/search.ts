// Turning several catalogs into one ranked list of documents.
//
// Every source is asked at once, because they overlap heavily and the slowest
// one must not decide how long a search takes. What comes back is merged on
// identity (a DOI when there is one, the title otherwise), which is also what
// makes the ranking meaningful: a work three catalogs agree on is more likely
// to be the one that was asked for than a single fuzzy match.
//
// The last step is the one that matters for downloading. A hit with no PDF yet
// but with a DOI is handed to Unpaywall, which answers the single question
// "is there a legal free copy of this, and where" — that answer is what turns a
// row in the list into a working Download button.

import type { DocumentSourceId } from "./identity.ts";
import type { DocumentHit, RawHit, SourceReport } from "./types.ts";
import {
  availableSources,
  contactEmail,
  coreApiKey,
  resolveOpenAccessPdf,
  searchArxiv,
  searchCore,
  searchCrossref,
  searchEuropePmc,
  searchOpenAlex,
  searchSemanticScholar,
  type SourceQuery,
} from "./sources.ts";

/** Which catalog's full-text link to trust when several offer one. */
const PDF_PREFERENCE: DocumentSourceId[] = [
  "arxiv",
  "openalex",
  "europepmc",
  "core",
  "semanticscholar",
  "crossref",
];

export function identityKey(hit: { doi: string | null; title: string; year: number | null }): string {
  if (hit.doi) return `doi:${hit.doi}`;
  const normalized = hit.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `title:${normalized.slice(0, 120)}:${hit.year ?? ""}`;
}

function preferSource(left: DocumentSourceId, right: DocumentSourceId): DocumentSourceId {
  return PDF_PREFERENCE.indexOf(left) <= PDF_PREFERENCE.indexOf(right) ? left : right;
}

interface MergedHit extends RawHit {
  sources: DocumentSourceId[];
  /** Who produced `pdfUrl` — a catalog, or Unpaywall's DOI lookup. */
  pdfSource: DocumentSourceId | "unpaywall" | null;
}

/**
 * Fold every catalog's answer into one record per work. Fields are filled by
 * whoever has them: OpenAlex knows citations, Europe PMC and Semantic Scholar
 * carry real abstracts, arXiv has the only reliable preprint PDF.
 */
export function mergeHits(hits: RawHit[]): MergedHit[] {
  const merged = new Map<string, MergedHit>();
  for (const hit of hits) {
    if (!hit.title.trim()) continue;
    const key = identityKey(hit);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...hit,
        sources: [hit.source],
        pdfSource: hit.pdfUrl ? hit.source : null,
      });
      continue;
    }
    if (!existing.sources.includes(hit.source)) existing.sources.push(hit.source);
    existing.title = existing.title.length >= hit.title.length ? existing.title : hit.title;
    existing.authors = existing.authors.length >= hit.authors.length ? existing.authors : hit.authors;
    existing.year ??= hit.year;
    existing.venue ??= hit.venue;
    existing.doi ??= hit.doi;
    existing.citationCount ??= hit.citationCount;
    existing.landingPage ??= hit.landingPage;
    // The longest abstract is the complete one; catalogs truncate differently.
    if (hit.abstract && (!existing.abstract || hit.abstract.length > existing.abstract.length)) {
      existing.abstract = hit.abstract;
    }
    existing.openAccess ||= hit.openAccess;
    if (hit.pdfUrl) {
      const held =
        existing.pdfUrl && existing.pdfSource && existing.pdfSource !== "unpaywall"
          ? existing.pdfSource
          : null;
      if (!held || preferSource(held, hit.source) === hit.source) {
        existing.pdfUrl = hit.pdfUrl;
        existing.pdfSource = hit.source;
      }
    }
  }
  return [...merged.values()];
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s]+/g, " ")
        .split(/\s+/)
        .filter((term) => term.length > 3),
    ),
  ];
}

/**
 * Order the merged results. Agreement between catalogs and a working full text
 * dominate on purpose: the list exists to be downloaded from, so a paper nobody
 * can open ranks below one that opens, even if it is slightly more cited.
 */
export function rankHits(hits: MergedHit[], query: string): MergedHit[] {
  const terms = queryTerms(query);
  const scored = hits.map((hit) => {
    const haystack = `${hit.title} ${hit.abstract ?? ""}`.toLowerCase();
    const matched = terms.filter((term) => haystack.includes(term)).length;
    const titleMatched = terms.filter((term) => hit.title.toLowerCase().includes(term)).length;
    const score =
      (terms.length ? (matched / terms.length) * 3 + (titleMatched / terms.length) * 2 : 0) +
      hit.sources.length * 0.9 +
      (hit.pdfUrl ? 2.5 : 0) +
      (hit.openAccess ? 0.5 : 0) +
      Math.log10((hit.citationCount ?? 0) + 1) * 0.6;
    return { hit, score };
  });
  return scored
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.hit);
}

/** The first sentences of an abstract, as a stand-in description. */
export function summarizeAbstract(abstract: string | null, limit = 320): string {
  if (!abstract) return "";
  const clean = abstract.replace(/^abstract[:\s-]*/i, "").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${(lastStop > 120 ? cut.slice(0, lastStop + 1) : cut).trim()}…`;
}

export interface SearchProgress {
  onSourceDone?: (report: SourceReport) => void;
  onStage?: (stage: string, detail?: string) => void;
}

function reportFor(source: DocumentSourceId, outcome: PromiseSettledResult<RawHit[]>): {
  report: SourceReport;
  hits: RawHit[];
} {
  if (outcome.status === "rejected") {
    const reason = outcome.reason;
    return {
      hits: [],
      report: {
        source,
        status: "error",
        count: 0,
        note:
          reason instanceof Error
            ? reason.name === "AbortError" || reason.name === "TimeoutError"
              ? "timed out"
              : reason.message.slice(0, 200)
            : "unavailable",
      },
    };
  }
  return {
    hits: outcome.value,
    report: {
      source,
      status: outcome.value.length ? "ok" : "empty",
      count: outcome.value.length,
    },
  };
}

export interface SearchOutcome {
  documents: DocumentHit[];
  reports: SourceReport[];
  /** True when Unpaywall could not be consulted, which costs some PDFs. */
  unpaywallSkipped: boolean;
}

/**
 * Run one search across every requested catalog and return the ranked list,
 * with a legal PDF attached wherever one exists.
 */
export async function searchDocuments(input: {
  query: SourceQuery;
  sources: DocumentSourceId[] | null;
  progress?: SearchProgress;
  env?: NodeJS.ProcessEnv;
}): Promise<SearchOutcome> {
  const env = input.env ?? process.env;
  const { ready, unavailable } = availableSources(env);
  const requested = input.sources ?? ready;
  const selected = requested.filter((source) => ready.includes(source));
  const reports: SourceReport[] = unavailable
    .filter((entry) => requested.includes(entry.source))
    .map((entry) => ({ source: entry.source, status: "skipped", count: 0, note: entry.reason }));

  input.progress?.onStage?.("searching", `${selected.length} catalogs`);

  const runners: Array<{ source: DocumentSourceId; run: () => Promise<RawHit[]> }> = selected.map(
    (source) => ({
      source,
      run: () => {
        switch (source) {
          case "openalex":
            return searchOpenAlex(input.query);
          case "arxiv":
            return searchArxiv(input.query);
          case "europepmc":
            return searchEuropePmc(input.query);
          case "semanticscholar":
            return searchSemanticScholar(input.query);
          case "crossref":
            return searchCrossref(input.query);
          case "core": {
            const key = coreApiKey(env);
            return key ? searchCore(input.query, key) : Promise.resolve([]);
          }
        }
      },
    }),
  );

  const settled = await Promise.allSettled(runners.map((runner) => runner.run()));
  const raw: RawHit[] = [];
  settled.forEach((outcome, index) => {
    const { report, hits } = reportFor(runners[index].source, outcome);
    reports.push(report);
    input.progress?.onSourceDone?.(report);
    raw.push(...hits);
  });

  const ranked = rankHits(mergeHits(raw), input.query.query);
  // Resolve full text for a few more than will be shown: an open-access filter
  // applied after resolution would otherwise shrink the list below the limit.
  const considered = ranked.slice(0, Math.min(input.query.limit * 2, 60));

  const email = contactEmail(env);
  const needsResolution = considered.filter((hit) => !hit.pdfUrl && hit.doi);
  if (email && needsResolution.length) {
    input.progress?.onStage?.("resolving", `${needsResolution.length} full texts`);
    // Serial on purpose: Unpaywall asks callers to stay under 100k/day and a
    // burst from every result at once is how a polite pool stops being polite.
    for (const hit of needsResolution.slice(0, 25)) {
      const location = await resolveOpenAccessPdf(hit.doi!, email);
      if (!location) continue;
      hit.openAccess = true;
      hit.landingPage ??= location.landingPage;
      if (location.pdfUrl) {
        hit.pdfUrl = location.pdfUrl;
        hit.pdfSource = "unpaywall";
      }
    }
  }

  const filtered = input.query.openAccessOnly
    ? considered.filter((hit) => Boolean(hit.pdfUrl))
    : considered;

  const documents: DocumentHit[] = filtered.slice(0, input.query.limit).map((hit, index) => ({
    id: `doc_${index + 1}`,
    title: hit.title,
    authors: hit.authors,
    year: hit.year,
    venue: hit.venue,
    doi: hit.doi,
    abstract: hit.abstract,
    description: summarizeAbstract(hit.abstract),
    openAccess: hit.openAccess || Boolean(hit.pdfUrl),
    citationCount: hit.citationCount,
    landingPage: hit.landingPage ?? (hit.doi ? `https://doi.org/${hit.doi}` : null),
    pdfUrl: hit.pdfUrl,
    pdfSource: hit.pdfUrl ? hit.pdfSource : null,
    sources: hit.sources,
  }));

  return {
    documents,
    reports,
    unpaywallSkipped: !email && needsResolution.length > 0,
  };
}
