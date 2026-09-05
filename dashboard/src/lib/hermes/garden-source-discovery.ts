import { stripMarkup } from "../get-doc/sources.ts";
import { parseYouTubeUrl } from "../scriberr/youtube.ts";
import { SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_VIDEO_EXTENSIONS } from "../scriberr/paths.ts";

export const SOURCE_KINDS = ["audio", "video", "link", "pdf"] as const;
export type GardenSourceKind = (typeof SOURCE_KINDS)[number];
export interface DiscoveredGardenSource {
  kind: GardenSourceKind;
  title: string;
  url: string;
  description: string;
  importUrl: string | null;
}

export function sourceKind(value: unknown): GardenSourceKind {
  if (!SOURCE_KINDS.includes(value as GardenSourceKind)) {
    throw new Error("Source kind must be audio, video, link, or pdf.");
  }
  return value as GardenSourceKind;
}

export function publicSourceUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 4096) throw new Error("A source URL is required.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use a public HTTP or HTTPS source URL without credentials.");
  }
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Source URLs must use a standard web port.");
  url.hash = "";
  return url;
}

export function youtubeSourceUrl(value: string): string | null {
  try { return parseYouTubeUrl(value).canonicalUrl; } catch { return null; }
}

export function sourceSearchQuery(query: string, kind: GardenSourceKind): string {
  if (kind === "video") return `${query} YouTube`;
  if (kind === "audio") return `${query} mp3 audio`;
  return query;
}

/** Search snippets are evidence of discovery, never evidence that an import succeeded. */
export function sourcesFromSearchHtml(html: string, kind: GardenSourceKind, limit: number, query = ""): DiscoveredGardenSource[] {
  const found = new Map<string, DiscoveredGardenSource>();
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const anchors = html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const href = /\bhref=["']([^"']+)["']/i.exec(match[1])?.[1];
    if (!href) continue;
    try {
      const decoded = stripMarkup(href);
      const redirect = new URL(decoded, "https://duckduckgo.com");
      const raw = /(^|\.)duckduckgo\.com$/.test(redirect.hostname)
        ? redirect.searchParams.get("uddg") : redirect.href;
      const url = publicSourceUrl(raw).href;
      const youtube = youtubeSourceUrl(url);
      const pathname = new URL(url).pathname.toLowerCase();
      if (kind === "video" && !youtube && !SUPPORTED_VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) continue;
      const importable = kind !== "audio" || SUPPORTED_AUDIO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
      const canonical = youtube ?? url;
      if (found.has(canonical)) continue;
      const title = stripMarkup(match[2]).trim().slice(0, 240);
      const following = html.slice((match.index ?? 0) + match[0].length);
      const snippet = /^[\s\S]*?<(?:a|div)\b[^>]*class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(following.split('class="result__a"')[0]);
      const description = snippet ? stripMarkup(snippet[1]).trim().slice(0, 500) : "";
      if (terms.length && !terms.some((term) => `${title} ${description} ${canonical}`.toLowerCase().includes(term))) continue;
      found.set(canonical, {
        kind, title,
        url: canonical, description, importUrl: importable ? canonical : null,
      });
      if (found.size >= limit) break;
    } catch { /* Ignore malformed search links. */ }
  }
  return [...found.values()];
}

async function searchWeb(query: string, kind: GardenSourceKind, limit: number): Promise<DiscoveredGardenSource[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(sourceSearchQuery(query, kind))}`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    signal: AbortSignal.timeout(20_000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) throw new Error(`Web search returned ${response.status}.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Web search returned no content.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Web search response was too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const html = Buffer.concat(chunks).toString("utf8");
  if (/anomaly\.js|challenge-form/i.test(html)) throw new Error("Web search is temporarily blocked by the search provider.");
  return sourcesFromSearchHtml(html, kind, limit, query);
}

async function searchPdfs(query: string, limit: number): Promise<DiscoveredGardenSource[]> {
  const { searchDocuments } = await import("../get-doc/search.ts");
  const result = await searchDocuments({
    query: { query, limit, openAccessOnly: true, yearFrom: null, yearTo: null }, sources: null,
  });
  if (!result.documents.length && result.reports.every((report) => ["error", "skipped"].includes(report.status))) {
    throw new Error("Document search providers are unavailable.");
  }
  return result.documents.filter((doc) => doc.pdfUrl || doc.landingPage).slice(0, limit).map((doc) => ({
    kind: "pdf", title: doc.title, url: doc.landingPage ?? doc.pdfUrl!,
    importUrl: doc.pdfUrl, description: doc.description,
  }));
}

export async function discoverGardenSources(
  args: Record<string, unknown>,
  search: (query: string, kind: GardenSourceKind, limit: number) => Promise<DiscoveredGardenSource[]> =
    (query, kind, limit) => kind === "pdf" ? searchPdfs(query, limit) : searchWeb(query, kind, limit),
) {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query || query.length > 500) throw new Error("Search needs a query of 1–500 characters.");
  const kinds = args.kinds === undefined ? [...SOURCE_KINDS] : args.kinds;
  if (!Array.isArray(kinds) || !kinds.length || kinds.length > 4) throw new Error("Choose one to four source kinds.");
  const selected = [...new Set(kinds.map(sourceKind))];
  const limit = args.limit === undefined ? 3 : Number(args.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error("Search limit must be between 1 and 8 per kind.");
  const outcomes = await Promise.allSettled(selected.map((kind) => search(query, kind, limit)));
  return {
    query,
    results: outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? outcome.value.slice(0, limit) : []),
    reports: outcomes.map((outcome, index) => ({
      kind: selected[index],
      status: outcome.status === "fulfilled" ? (outcome.value.length ? "ok" : "empty") : "error",
      ...(outcome.status === "rejected" ? { error: outcome.reason instanceof Error ? outcome.reason.message : "Search failed." } : {}),
    })),
  };
}
