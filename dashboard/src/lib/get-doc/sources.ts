// The catalogs Get Doc searches, and the parsing of what each one returns.
//
// Every source here is an open scholarly API, and the only full texts Get Doc
// ever reaches for are the ones those APIs publish as legally free: an author
// manuscript in a repository, a publisher's own open-access PDF, an arXiv
// preprint. Shadow libraries are deliberately absent — they distribute paywalled
// articles without the publisher's authorization, and an agent that downloads
// from one puts that on the user's own network.
//
// Each adapter is split in two: a pure parser over the catalog's JSON/XML, which
// the tests exercise without a network, and a thin fetch wrapper around it. A
// catalog that is slow, rate-limited or down costs its own results and nothing
// else — the search reports what it lost rather than failing.

import type { DocumentSourceId } from "./identity.ts";
import type { RawHit } from "./types.ts";

const REQUEST_TIMEOUT_MS = 20_000;
const USER_AGENT = "Breadboard-GetDoc/1.0 (+https://github.com/breadboard)";

/**
 * The address the polite pools want. OpenAlex and Crossref serve anonymous
 * callers from a slower shared pool and ask for a contact address to move you
 * off it; Unpaywall refuses the request outright without one.
 */
export function contactEmail(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured =
    env.GET_DOC_CONTACT_EMAIL?.trim() ||
    env.OPENALEX_MAILTO?.trim() ||
    env.UNPAYWALL_EMAIL?.trim() ||
    "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configured) ? configured : null;
}

export function coreApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.CORE_API_KEY?.trim() || null;
}

export interface SourceQuery {
  query: string;
  limit: number;
  openAccessOnly: boolean;
  yearFrom: number | null;
  yearTo: number | null;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) {
    throw new Error(`${new URL(url).host} returned ${response.status}`);
  }
  return response.json();
}

async function readText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url, { headers: { accept: "application/atom+xml" } });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} returned ${response.status}`);
  }
  return response.text();
}

// ---- shared normalizing -----------------------------------------------------

/** DOIs are compared constantly; every catalog spells them differently. */
export function normalizeDoi(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const withoutPrefix = trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
  return /^10\.\d{4,9}\/\S+$/.test(withoutPrefix) ? withoutPrefix : null;
}

function text(value: unknown, maxLength = 4_000): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function year(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 1400 && parsed < 2200 ? parsed : null;
}

function count(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    // Several catalogs still hand out http links for hosts that serve https;
    // upgrading is both safer and what the host would redirect to anyway.
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Strip the JATS/HTML markup catalogs leave inside abstract fields. */
export function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// ---- OpenAlex ---------------------------------------------------------------

/**
 * OpenAlex ships abstracts as an inverted index — word to the positions it
 * occupies — because the full string is not theirs to redistribute. Putting the
 * words back in order is allowed and is the only way to read one.
 */
export function reconstructAbstract(value: unknown): string | null {
  const index = record(value);
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of list(positions)) {
      if (typeof position === "number" && position >= 0 && position < 20_000) {
        words[position] = word;
      }
    }
  }
  const joined = words.filter(Boolean).join(" ").trim();
  return joined ? joined.slice(0, 4_000) : null;
}

export function openAlexUrl(query: SourceQuery, email: string | null): string {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query.query);
  url.searchParams.set("per-page", String(Math.min(Math.max(query.limit * 2, 10), 50)));
  const filters: string[] = [];
  if (query.openAccessOnly) filters.push("open_access.is_oa:true");
  if (query.yearFrom) filters.push(`from_publication_date:${query.yearFrom}-01-01`);
  if (query.yearTo) filters.push(`to_publication_date:${query.yearTo}-12-31`);
  if (filters.length) url.searchParams.set("filter", filters.join(","));
  if (email) url.searchParams.set("mailto", email);
  return url.toString();
}

export function parseOpenAlexWorks(payload: unknown): RawHit[] {
  return list(record(payload).results).flatMap((entry): RawHit[] => {
    const work = record(entry);
    const title = text(work.display_name, 500);
    if (!title) return [];
    const primary = record(work.primary_location);
    const bestOa = record(work.best_oa_location);
    const openAccess = record(work.open_access);
    return [
      {
        source: "openalex",
        title,
        authors: list(work.authorships)
          .map((authorship) => text(record(record(authorship).author).display_name, 200))
          .filter((name): name is string => Boolean(name))
          .slice(0, 25),
        year: year(work.publication_year),
        venue:
          text(record(primary.source).display_name, 300) ??
          text(record(bestOa.source).display_name, 300),
        doi: normalizeDoi(work.doi),
        abstract: reconstructAbstract(work.abstract_inverted_index),
        openAccess: openAccess.is_oa === true,
        citationCount: count(work.cited_by_count),
        landingPage:
          httpsUrl(primary.landing_page_url) ??
          httpsUrl(bestOa.landing_page_url) ??
          httpsUrl(work.doi) ??
          httpsUrl(work.id),
        pdfUrl: httpsUrl(bestOa.pdf_url) ?? httpsUrl(primary.pdf_url) ?? httpsUrl(openAccess.oa_url),
      },
    ];
  });
}

export async function searchOpenAlex(query: SourceQuery): Promise<RawHit[]> {
  return parseOpenAlexWorks(await readJson(openAlexUrl(query, contactEmail())));
}

// ---- arXiv ------------------------------------------------------------------

export function arxivUrl(query: SourceQuery): string {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query.query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(Math.min(Math.max(query.limit, 5), 50)));
  url.searchParams.set("sortBy", "relevance");
  return url.toString();
}

function xmlValue(entry: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(entry);
  return match ? stripMarkup(match[1]) || null : null;
}

/**
 * arXiv answers in Atom. The feed is small and well-formed and the dashboard
 * carries no XML parser, so the entries are read with bounded expressions
 * rather than pulling in a dependency for one endpoint.
 */
export function parseArxivFeed(xml: string): RawHit[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) ?? [];
  return entries.flatMap((entry): RawHit[] => {
    const title = xmlValue(entry, "title");
    if (!title) return [];
    const identifier = xmlValue(entry, "id");
    const published = xmlValue(entry, "published") ?? "";
    const pdfLink = /<link[^>]*title="pdf"[^>]*href="([^"]+)"/i.exec(entry)?.[1] ?? null;
    const abstractPage = identifier ? httpsUrl(identifier) : null;
    return [
      {
        source: "arxiv",
        title,
        authors: [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
          .map((match) => stripMarkup(match[1]))
          .filter(Boolean)
          .slice(0, 25),
        year: year(published.slice(0, 4)),
        venue: xmlValue(entry, "arxiv:journal_ref") ?? "arXiv preprint",
        doi: normalizeDoi(xmlValue(entry, "arxiv:doi")),
        abstract: xmlValue(entry, "summary"),
        // Every arXiv record is free to read; that is the point of arXiv.
        openAccess: true,
        citationCount: null,
        landingPage: abstractPage,
        pdfUrl: httpsUrl(pdfLink) ?? (abstractPage ? abstractPage.replace("/abs/", "/pdf/") : null),
      },
    ];
  });
}

export async function searchArxiv(query: SourceQuery): Promise<RawHit[]> {
  return parseArxivFeed(await readText(arxivUrl(query)));
}

// ---- Europe PMC -------------------------------------------------------------

export function europePmcUrl(query: SourceQuery): string {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  const clauses = [query.query];
  if (query.openAccessOnly) clauses.push("OPEN_ACCESS:y");
  if (query.yearFrom || query.yearTo) {
    clauses.push(`PUB_YEAR:[${query.yearFrom ?? 1500} TO ${query.yearTo ?? 2200}]`);
  }
  url.searchParams.set("query", clauses.join(" AND "));
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(Math.min(Math.max(query.limit, 5), 50)));
  return url.toString();
}

export function parseEuropePmcResults(payload: unknown): RawHit[] {
  return list(record(record(payload).resultList).result).flatMap((entry): RawHit[] => {
    const result = record(entry);
    const title = text(result.title, 500);
    if (!title) return [];
    const openAccess = result.isOpenAccess === "Y";
    const pmcid = text(result.pmcid, 40);
    const fullTexts = list(record(result.fullTextUrlList).fullTextUrl).map(record);
    const pdfLink = fullTexts.find(
      (link) => text(link.documentStyle, 40)?.toLowerCase() === "pdf",
    );
    const named = list(record(result.authorList).author)
      .map((author) => text(record(author).fullName, 200))
      .filter((name): name is string => Boolean(name));
    // Older records carry only the flattened string, so it is the fallback.
    const authors = named.length
      ? named
      : (text(result.authorString, 2_000) ?? "")
          .split(/,\s*/)
          .map((name) => name.trim().replace(/\.$/, ""))
          .filter(Boolean);
    return [
      {
        source: "europepmc",
        title,
        authors: authors.slice(0, 25),
        year: year(result.pubYear),
        venue: text(record(record(result.journalInfo).journal).title, 300),
        doi: normalizeDoi(result.doi),
        abstract: text(result.abstractText, 4_000),
        openAccess,
        citationCount: count(result.citedByCount),
        landingPage:
          httpsUrl(fullTexts.find((link) => link.site === "Europe_PMC")?.url) ??
          (pmcid ? `https://europepmc.org/article/PMC/${pmcid}` : null),
        pdfUrl:
          httpsUrl(pdfLink?.url) ??
          // The open-access subset always renders a PDF at this address, which
          // is more reliable than the publisher links in the same list.
          (openAccess && pmcid ? `https://europepmc.org/articles/${pmcid}?pdf=render` : null),
      },
    ];
  });
}

export async function searchEuropePmc(query: SourceQuery): Promise<RawHit[]> {
  return parseEuropePmcResults(await readJson(europePmcUrl(query)));
}

// ---- Semantic Scholar -------------------------------------------------------

export function semanticScholarUrl(query: SourceQuery): string {
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", query.query);
  url.searchParams.set("limit", String(Math.min(Math.max(query.limit, 5), 50)));
  url.searchParams.set(
    "fields",
    "title,abstract,year,venue,authors,externalIds,openAccessPdf,citationCount,url,isOpenAccess",
  );
  if (query.yearFrom || query.yearTo) {
    url.searchParams.set("year", `${query.yearFrom ?? ""}-${query.yearTo ?? ""}`);
  }
  if (query.openAccessOnly) url.searchParams.set("openAccessPdf", "");
  return url.toString();
}

export function parseSemanticScholarPapers(payload: unknown): RawHit[] {
  return list(record(payload).data).flatMap((entry): RawHit[] => {
    const paper = record(entry);
    const title = text(paper.title, 500);
    if (!title) return [];
    const openAccessPdf = record(paper.openAccessPdf);
    const external = record(paper.externalIds);
    const arxivId = text(external.ArXiv, 60);
    return [
      {
        source: "semanticscholar",
        title,
        authors: list(paper.authors)
          .map((author) => text(record(author).name, 200))
          .filter((name): name is string => Boolean(name))
          .slice(0, 25),
        year: year(paper.year),
        venue: text(paper.venue, 300),
        doi: normalizeDoi(external.DOI),
        abstract: text(paper.abstract, 4_000),
        openAccess: paper.isOpenAccess === true || Boolean(text(openAccessPdf.url, 2_000)),
        citationCount: count(paper.citationCount),
        landingPage: httpsUrl(paper.url),
        pdfUrl:
          httpsUrl(openAccessPdf.url) ??
          (arxivId ? `https://arxiv.org/pdf/${arxivId}` : null),
      },
    ];
  });
}

export async function searchSemanticScholar(query: SourceQuery): Promise<RawHit[]> {
  return parseSemanticScholarPapers(await readJson(semanticScholarUrl(query)));
}

// ---- Crossref ---------------------------------------------------------------

export function crossrefUrl(query: SourceQuery, email: string | null): string {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", query.query);
  url.searchParams.set("rows", String(Math.min(Math.max(query.limit, 5), 50)));
  url.searchParams.set("select", "DOI,title,author,issued,container-title,abstract,is-referenced-by-count,URL");
  const filters: string[] = [];
  if (query.yearFrom) filters.push(`from-pub-date:${query.yearFrom}-01-01`);
  if (query.yearTo) filters.push(`until-pub-date:${query.yearTo}-12-31`);
  if (filters.length) url.searchParams.set("filter", filters.join(","));
  if (email) url.searchParams.set("mailto", email);
  return url.toString();
}

/**
 * Crossref is the registry of record for DOIs, so it is searched for identity
 * and metadata, never for full text: the `link` array it carries points at
 * publisher endpoints intended for text mining, which answer a licensed IP
 * range and 403 everyone else. Whether a Crossref hit is downloadable is left
 * to Unpaywall, which answers that exact question.
 */
export function parseCrossrefItems(payload: unknown): RawHit[] {
  return list(record(record(payload).message).items).flatMap((entry): RawHit[] => {
    const item = record(entry);
    const title = text(list(item.title)[0], 500);
    if (!title) return [];
    const issued = list(list(record(item.issued)["date-parts"])[0]);
    const abstract = text(item.abstract, 6_000);
    return [
      {
        source: "crossref",
        title,
        authors: list(item.author)
          .map((author) => {
            const person = record(author);
            const given = text(person.given, 100);
            const family = text(person.family, 100);
            return [given, family].filter(Boolean).join(" ") || text(person.name, 200);
          })
          .filter((name): name is string => Boolean(name))
          .slice(0, 25),
        year: year(issued[0]),
        venue: text(list(item["container-title"])[0], 300),
        doi: normalizeDoi(item.DOI),
        abstract: abstract ? stripMarkup(abstract).slice(0, 4_000) : null,
        openAccess: false,
        citationCount: count(item["is-referenced-by-count"]),
        landingPage: httpsUrl(item.URL),
        pdfUrl: null,
      },
    ];
  });
}

export async function searchCrossref(query: SourceQuery): Promise<RawHit[]> {
  return parseCrossrefItems(await readJson(crossrefUrl(query, contactEmail())));
}

// ---- CORE -------------------------------------------------------------------

export function parseCoreResults(payload: unknown): RawHit[] {
  return list(record(payload).results).flatMap((entry): RawHit[] => {
    const work = record(entry);
    const title = text(work.title, 500);
    if (!title) return [];
    const doi = normalizeDoi(work.doi);
    return [
      {
        source: "core",
        title,
        authors: list(work.authors)
          .map((author) => text(record(author).name, 200))
          .filter((name): name is string => Boolean(name))
          .slice(0, 25),
        year: year(work.yearPublished),
        venue: text(work.publisher, 300),
        doi,
        abstract: text(work.abstract, 4_000),
        // CORE aggregates open repositories; everything it indexes is readable.
        openAccess: true,
        citationCount: count(work.citationCount),
        landingPage:
          httpsUrl(list(work.sourceFulltextUrls)[0]) ??
          (doi ? `https://doi.org/${doi}` : null),
        pdfUrl: httpsUrl(work.downloadUrl),
      },
    ];
  });
}

export async function searchCore(query: SourceQuery, apiKey: string): Promise<RawHit[]> {
  const payload = await readJson("https://api.core.ac.uk/v3/search/works", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q: query.query,
      limit: Math.min(Math.max(query.limit, 5), 50),
    }),
  });
  return parseCoreResults(payload);
}

// ---- Unpaywall --------------------------------------------------------------

export interface OpenAccessLocation {
  pdfUrl: string | null;
  landingPage: string | null;
  version: string | null;
}

export function parseUnpaywall(payload: unknown): OpenAccessLocation | null {
  const data = record(payload);
  if (data.is_oa !== true) return null;
  const best = record(data.best_oa_location);
  const pdfUrl = httpsUrl(best.url_for_pdf);
  const landingPage = httpsUrl(best.url_for_landing_page) ?? httpsUrl(best.url);
  if (!pdfUrl && !landingPage) return null;
  return { pdfUrl, landingPage, version: text(best.version, 60) };
}

/** Ask Unpaywall where a DOI's free full text lives. Null when there is none. */
export async function resolveOpenAccessPdf(
  doi: string,
  email: string,
): Promise<OpenAccessLocation | null> {
  const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
  url.searchParams.set("email", email);
  try {
    return parseUnpaywall(await readJson(url.toString()));
  } catch {
    // A DOI Unpaywall has never seen is a 404, which is an answer, not a fault.
    return null;
  }
}

/** Which catalogs can run right now, and why the others cannot. */
export function availableSources(env: NodeJS.ProcessEnv = process.env): {
  ready: DocumentSourceId[];
  unavailable: Array<{ source: DocumentSourceId; reason: string }>;
} {
  const ready: DocumentSourceId[] = [
    "openalex",
    "arxiv",
    "europepmc",
    "semanticscholar",
    "crossref",
  ];
  const unavailable: Array<{ source: DocumentSourceId; reason: string }> = [];
  if (coreApiKey(env)) ready.push("core");
  else {
    unavailable.push({
      source: "core",
      reason: "CORE needs a free API key in CORE_API_KEY.",
    });
  }
  return { ready, unavailable };
}
