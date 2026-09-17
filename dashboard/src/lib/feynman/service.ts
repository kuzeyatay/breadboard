import { createHash } from "node:crypto";
import {
  arxivUrl, crossrefUrl, europePmcUrl, normalizeDoi,
  parseArxivFeed, parseCrossrefItems, parseEuropePmcResults,
} from "../get-doc/sources.ts";
import type { RawHit } from "../get-doc/types.ts";
import {
  buildCitationGraph, scorePapers, generatePaperCritiques,
  enrichPapersWithFullText, fetchEuropePmcPaperContent,
  type PaperRecord,
} from "../../vendor/feynman/rank/paper-rank.ts";

export const FEYNMAN_TOOL = "feynman_research";
export const FEYNMAN_VERSION = "0.3.49";
const SOURCE_NAMES = { arxiv: "arXiv", crossref: "Crossref", europepmc: "Europe PMC" } as const;
type Source = keyof typeof SOURCE_NAMES;
type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const clean = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const titleKey = (value: string) => clean(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export class FeynmanError extends Error {
  code: "invalid_arguments" | "sources_unavailable" | "aborted";
  constructor(code: "invalid_arguments" | "sources_unavailable" | "aborted", message: string) {
    super(message);
    this.name = "FeynmanError";
    this.code = code;
  }
}

export interface FeynmanInput { query: string; limit?: number; fullTextTop?: number }
export interface FeynmanSourceReport {
  source: string;
  status: "ok" | "empty" | "error";
  count: number;
  url?: string;
  reason?: string;
}
export function validateFeynmanInput(input: FeynmanInput): Required<FeynmanInput> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 600) throw new FeynmanError("invalid_arguments", "Provide a research query of 1–600 characters.");
  const limit = input.limit ?? 10;
  const fullTextTop = input.fullTextTop ?? 2;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new FeynmanError("invalid_arguments", "Choose 1–20 papers.");
  if (!Number.isInteger(fullTextTop) || fullTextTop < 0 || fullTextTop > 3) throw new FeynmanError("invalid_arguments", "Choose 0–3 full texts to inspect.");
  return { query, limit, fullTextTop };
}

/** Public GETs only. No environment credentials, user-provided URLs, or cookies. */
function publicFetch(fetchImpl: typeof fetch, signal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["api.crossref.org", "export.arxiv.org", "www.ebi.ac.uk"].includes(url.hostname)) {
      throw new Error("Feynman refused a source outside its public catalog allowlist.");
    }
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])]);
    const response = await fetchImpl(url.toString(), {
      method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { accept: "application/json,application/atom+xml,application/xml,text/xml", "user-agent": "Breadboard-Feynman/1.0" },
      signal: requestSignal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${url.hostname} returned HTTP ${response.status}.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`${url.hostname} returned an empty response.`);
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        requestSignal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8 * 1024 * 1024) throw new Error(`${url.hostname} exceeded the response size limit.`);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    requestSignal.throwIfAborted();
    return new Response(Buffer.concat(chunks), { headers: { "content-type": response.headers.get("content-type") ?? "text/plain" } });
  };
}

function paperFromHit(hit: RawHit, sourceRank: number): PaperRecord {
  const url = hit.landingPage ?? (hit.doi ? `https://doi.org/${hit.doi}` : "");
  const identity = hit.doi ? `doi:${hit.doi}` : url || `title:${titleKey(hit.title)}`;
  return {
    paperId: createHash("sha256").update(identity).digest("hex").slice(0, 20),
    // The upstream graph calls this field openAlexId; it accepts any stable ID.
    // These are DOI/catalog identities, never fabricated OpenAlex work IDs.
    openAlexId: identity,
    ...(hit.doi ? { doi: hit.doi } : {}),
    ...(hit.year ? { year: hit.year } : {}),
    title: clean(hit.title), authors: hit.authors, venue: hit.venue ?? undefined,
    abstract: hit.abstract ? clean(hit.abstract) : undefined,
    urls: [
      ...(url ? [{ type: "landing" as const, url }] : []),
      ...(hit.openAccess && hit.pdfUrl ? [{ type: "pdf" as const, url: hit.pdfUrl, isOpenAccess: true }] : []),
    ],
    citationCount: hit.citationCount ?? 0, citationCountKnown: hit.citationCount !== null,
    references: [], relatedWorks: [], concepts: [], topics: [], sourceRank,
    graphRole: "seed", isOpenAccess: hit.openAccess, isRetracted: false,
    provenance: [{ source: SOURCE_NAMES[hit.source as Source], fields: ["title", "authors", "year", "abstract", "citationCount"] }],
  };
}

async function searchSource(source: Source, query: string, limit: number, fetcher: typeof fetch) {
  const args = { query, limit, openAccessOnly: false, yearFrom: null, yearTo: null };
  // Explicit null keeps Crossref in the anonymous pool even if another tool has a contact configured.
  const url = new URL(source === "arxiv" ? arxivUrl(args) : source === "crossref" ? crossrefUrl(args, null) : europePmcUrl(args));
  if (source === "crossref") url.searchParams.set("select", `${url.searchParams.get("select")},reference`);
  const response = await fetcher(url.toString());
  const payload: unknown = source === "arxiv" ? await response.text() : await response.json();
  const hits = source === "arxiv" ? parseArxivFeed(String(payload)) : source === "crossref" ? parseCrossrefItems(payload) : parseEuropePmcResults(payload);
  const entries = source === "crossref" ? list(record(record(payload).message).items) : list(record(record(payload).resultList).result);
  const metadata = new Map(entries.map((item) => {
    const row = record(item);
    return [normalizeDoi(row.DOI ?? row.doi) ?? titleKey(String(row.title ?? "")), row];
  }));
  const papers = hits.slice(0, limit).map((hit, index) => {
    const paper = paperFromHit(hit, index + 1);
    const row = metadata.get(hit.doi ?? titleKey(hit.title)) ?? {};
    if (source === "crossref") {
      paper.references = list(row.reference).flatMap((ref) => {
        const doi = normalizeDoi(record(ref).DOI);
        return doi ? [`doi:${doi}`] : [];
      });
    }
    if (source === "europepmc") {
      if (/^PMC\d+$/.test(String(row.pmcid))) paper.pmcid = String(row.pmcid);
      if (row.source === "MED" && /^\d+$/.test(String(row.id))) {
        paper.pmid = String(row.id);
        if (!paper.urls.length) paper.urls.push({ type: "landing", url: `https://europepmc.org/article/MED/${paper.pmid}` });
      }
      paper.isRetracted = row.isRetracted === "Y";
    }
    if (source === "arxiv") paper.arxivId = paper.urls[0]?.url.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/)?.[1];
    return paper;
  });
  return { papers, url: url.toString() };
}

function mergePapers(groups: PaperRecord[][]): PaperRecord[] {
  const papers: PaperRecord[] = [];
  const byDoi = new Map<string, PaperRecord>();
  const byTitle = new Map<string, PaperRecord>();
  // Interleave catalog ranks so the first provider does not consume the candidate budget.
  for (let index = 0; index < Math.max(0, ...groups.map((group) => group.length)); index++) {
    for (const group of groups) {
      const incoming = group[index];
      if (!incoming) continue;
      const key = titleKey(incoming.title);
      const titleMatch = byTitle.get(key);
      const existing = (incoming.doi ? byDoi.get(incoming.doi) : undefined) ??
        (titleMatch && (!titleMatch.doi || !incoming.doi || titleMatch.doi === incoming.doi) ? titleMatch : undefined);
      if (!existing) {
        papers.push(incoming);
        byTitle.set(key, incoming);
        if (incoming.doi) byDoi.set(incoming.doi, incoming);
        continue;
      }
      if (incoming.doi && !existing.doi) {
        existing.doi = incoming.doi;
        existing.openAlexId = `doi:${incoming.doi}`;
        byDoi.set(incoming.doi, existing);
      }
      existing.abstract = (incoming.abstract?.length ?? 0) > (existing.abstract?.length ?? 0) ? incoming.abstract : existing.abstract;
      existing.pmcid ??= incoming.pmcid;
      existing.pmid ??= incoming.pmid;
      existing.arxivId ??= incoming.arxivId;
      existing.isOpenAccess ||= incoming.isOpenAccess;
      existing.isRetracted ||= incoming.isRetracted;
      existing.citationCount = Math.max(existing.citationCount, incoming.citationCount);
      existing.citationCountKnown ||= incoming.citationCountKnown;
      existing.references = [...new Set([...existing.references, ...incoming.references])];
      existing.provenance.push(...incoming.provenance);
      for (const url of incoming.urls) if (!existing.urls.some((item) => item.url === url.url)) existing.urls.push(url);
    }
  }
  return papers.map((paper, index) => ({ ...paper, sourceRank: index + 1 }));
}

export async function researchFeynman(input: FeynmanInput, options: { signal?: AbortSignal; fetchImpl?: typeof fetch; now?: Date } = {}) {
  const args = validateFeynmanInput(input);
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(90_000)]);
  const checkAbort = () => { if (signal.aborted) throw new FeynmanError("aborted", "Feynman research was stopped or exceeded its deadline."); };
  checkAbort();
  const fetcher = publicFetch(options.fetchImpl ?? fetch, signal);
  const sources = Object.keys(SOURCE_NAMES) as Source[];
  const settled = await Promise.allSettled(sources.map((source) => searchSource(source, args.query, args.limit, fetcher)));
  checkAbort();
  const sourceReports: FeynmanSourceReport[] = settled.map((result, index) => ({
    source: SOURCE_NAMES[sources[index]],
    status: result.status === "fulfilled" ? (result.value.papers.length ? "ok" : "empty") : "error",
    count: result.status === "fulfilled" ? result.value.papers.length : 0,
    ...(result.status === "fulfilled" ? { url: result.value.url } : { reason: result.reason instanceof Error ? result.reason.message : "Source request failed." }),
  }));
  if (settled.every((result) => result.status === "rejected")) throw new FeynmanError("sources_unavailable", sourceReports.map((report) => `${report.source}: ${report.reason}`).join(" "));
  const candidates = mergePapers(settled.flatMap((result) => result.status === "fulfilled" ? [result.value.papers] : []));
  const graph = buildCitationGraph(candidates);
  const now = options.now ?? new Date();
  const initialScores = candidates.length ? scorePapers(candidates, graph, args.query, now) : [];
  const enriched = await enrichPapersWithFullText(candidates, initialScores, {
    top: args.fullTextTop, fetchedAt: now.toISOString(),
    fetcher: async (paper) => {
      checkAbort();
      // Europe PMC resolves DOI/PMID to a public full-text XML record when available.
      return fetchEuropePmcPaperContent(paper, fetcher);
    },
  });
  checkAbort();
  const byId = new Map(enriched.map((paper) => [paper.paperId, paper]));
  const scores = enriched.length ? scorePapers(enriched, graph, args.query, now) : [];
  // Upstream labels metadata as OpenAlex. Preserve actual provider attribution.
  for (const score of scores) {
    const source = byId.get(score.paperId)!.provenance.map((item) => item.source).join(" + ");
    for (const value of Object.values(score.signals)) {
      value.explanation = value.explanation.replaceAll("OpenAlex", "The source catalog");
      for (const evidence of value.evidence) {
        evidence.source = evidence.source.replace(/OpenAlex (?:Works API|work object)/g, source);
        if (evidence.span) evidence.span.source = evidence.span.source.replace(/OpenAlex (?:Works API|work object)/g, source);
      }
    }
    score.warnings = score.warnings.map((warning) => warning.replaceAll("OpenAlex", "The source catalog"));
  }
  const critiques = generatePaperCritiques(enriched, scores, Math.min(args.limit, 10));
  const papers = scores.slice(0, args.limit).map((score) => {
    const paper = byId.get(score.paperId)!;
    return {
      id: paper.paperId, title: paper.title, authors: paper.authors, year: paper.year,
      doi: paper.doi, urls: paper.urls, abstract: paper.abstract,
      citationCount: paper.citationCountKnown ? paper.citationCount : null,
      openAccess: paper.isOpenAccess, isRetracted: paper.isRetracted,
      fullText: { status: paper.fullTextStatus ?? "not_requested", source: paper.fullTextSource, error: paper.fullTextError, characters: paper.fullText?.length ?? 0 },
      score, critique: critiques.find((critique) => critique.paperId === paper.paperId), provenance: paper.provenance,
    };
  });
  return {
    engine: "Feynman PaperRank", version: FEYNMAN_VERSION, query: args.query,
    generatedAt: now.toISOString(), status: papers.length ? "completed" : "empty",
    sources: sourceReports, papers,
    websites: papers.flatMap((paper) => {
      const url = paper.urls.find((item) => item.type === "landing")?.url;
      return url ? [{ url, title: paper.title }] : [];
    }),
    graph: { nodes: graph.nodes.length, edges: graph.edges.length },
    limitations: [
      "Read-first scores are candidate-relative heuristics, not probabilities of correctness or proof of scientific quality.",
      "Citation counts differ between catalogs; missing counts are excluded. Citation graphs cover only returned candidates.",
      "Method and reproducibility signals are text heuristics. Metadata-only papers have not been read in full; no experiments were run.",
      ...sourceReports.filter((report) => report.status === "error").map((report) => `${report.source}: ${report.reason}`),
    ],
  };
}

export type FeynmanResult = Awaited<ReturnType<typeof researchFeynman>>;

export function feynmanEvidenceText(result: FeynmanResult): string {
  const escape = (value: string) => clean(value).replace(/[\[\]<>]/g, "");
  return [
    `Feynman PaperRank: ${result.query}`,
    `Retrieved ${result.generatedAt}. ${result.graph.nodes} candidates; ${result.graph.edges} local citation edges.`,
    ...result.papers.map((paper) => {
      const url = paper.urls.find((item) => item.type === "landing")?.url ?? paper.urls[0]?.url;
      return [
        `${paper.score.rank}. ${url ? `[${escape(paper.title)}](${url.replace(/[()\s]/g, encodeURIComponent)})` : escape(paper.title)} (${paper.year ?? "year unavailable"}) — read-first score ${paper.score.readFirstScore}/100.`,
        paper.isRetracted ? "RETRACTED: treat as a retracted work, not supporting evidence." : "",
        `Source: ${paper.provenance.map((entry) => entry.source).join("; ")}. Full text: ${paper.fullText.status}. Citations: ${paper.citationCount ?? "unknown"}.`,
        paper.abstract ? `Source abstract: ${paper.abstract}` : "No abstract returned; metadata only.",
        paper.critique ? `Heuristic critique: ${paper.critique.verdict}\n${paper.critique.concerns.map((item) => item.detail).join("\n")}` : "",
        ...Object.values(paper.score.signals).flatMap((value) => value.evidence
          .filter((item) => item.span)
          .sort((left, right) => Number(right.span!.field.startsWith("full_text")) - Number(left.span!.field.startsWith("full_text")))
          .slice(0, 2)
          .map((item) => `Source excerpt (${item.span!.source}, ${item.span!.field}): ${item.span!.text}`)),
      ].filter(Boolean).join("\n");
    }),
    `Source coverage: ${result.sources.map((source) => `${source.source}: ${source.status} (${source.count})`).join("; ")}.`,
    ...result.limitations,
  ].join("\n\n").slice(0, 40_000);
}
