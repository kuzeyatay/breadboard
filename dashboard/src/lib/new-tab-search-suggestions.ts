import type { SearchSuggestion } from "../app/browser/browser-recent-searches.ts";
import { SEARCH_LABELS, type BreadboardSearchResult } from "./breadboard-search.ts";
import { looksLikeBrowserAddress, normalizeRecentSearches } from "../app/browser/browser-recent-searches.ts";

export const RECENT_SEARCH_LIMIT = 25;
export type SearchScope = "breadboard" | "web";
export interface SearchHistoryEntry { query: string; scope: SearchScope }
export interface NewTabSuggestion extends SearchSuggestion {
  scope: SearchScope;
  result?: BreadboardSearchResult;
  href?: string;
}

export function normalizeSearchHistory(value: unknown): SearchHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: SearchHistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item.query !== "string" || !["breadboard", "web"].includes(item.scope)) continue;
    const query = item.query.trim().slice(0, 200);
    const key = `${item.scope}:${query.toLocaleLowerCase()}`;
    if (!query || seen.has(key)) continue;
    seen.add(key);
    entries.push({ query, scope: item.scope });
    if (entries.length === 80) break;
  }
  return entries;
}

export function newTabSearchSuggestions(query: string, history: SearchHistoryEntry[], results: BreadboardSearchResult[], browserSearches: readonly string[] = []): NewTabSuggestion[] {
  const value = query.trim();
  const seen = new Set<string>();
  const recent: NewTabSuggestion[] = [
    ...normalizeRecentSearches(browserSearches).map((search): NewTabSuggestion => ({
      id: `browser-search:${search}`, value: search, label: search, detail: "Search the web",
      source: "history", scope: "web",
    })),
    ...history.filter(entry => entry.scope === "breadboard" || !looksLikeBrowserAddress(entry.query)).map((entry): NewTabSuggestion => ({ id: `history:${entry.scope}:${entry.query}`, value: entry.query, label: entry.query,
      detail: entry.scope === "web" ? "Search the web" : "Search Breadboard", source: "history", scope: entry.scope })),
  ].filter(entry => {
    const key = `${entry.scope}:${entry.value.toLocaleLowerCase()}`;
    if (seen.has(key) || !`${entry.label}\n${entry.value}`.toLocaleLowerCase().includes(value.toLocaleLowerCase())) return false;
    seen.add(key);
    return true;
  }).slice(0, value ? 4 : RECENT_SEARCH_LIMIT);
  if (!value) return recent;
  return [...recent,
    { value, label: value, detail: "Search Breadboard", source: "breadboard" as const, scope: "breadboard" as const },
    { value, label: value, detail: looksLikeBrowserAddress(value) ? "Go to website" : "Search the web", source: "web" as const, scope: "web" as const },
    ...results.slice(0, 8 - recent.length - 2).map(result => ({ id: result.id, value: result.title, label: result.title,
      detail: `${SEARCH_LABELS[result.type]} · ${result.context}`, source: "breadboard" as const, scope: "breadboard" as const, result })),
  ];
}

type VisitedDestination = { value: string; href: string; reason: string };
export interface InlineCompletion { value: string; rest: string; scope: SearchScope; reason: string; href?: string }

/**
 * One ghost completion for the search box, picked from past activity. Each
 * list is most-recent-first; earlier entries and repeats count more, so a
 * site visited daily beats a search made once. The higher-scoring scope wins.
 */
export function inlineCompletion(query: string, lists: ReadonlyArray<{ scope: SearchScope; reason?: string; values: readonly (string | VisitedDestination | null)[] }>): InlineCompletion | null {
  const needle = query.trimStart().toLocaleLowerCase();
  if (!needle || query !== query.trimStart()) return null;
  let best: InlineCompletion | null = null;
  let bestScore = 0;
  const scores = new Map<string, number>();
  for (const { scope, values, reason = `What you typed matches one of your recent ${scope === "web" ? "web" : "Breadboard"} searches.` } of lists) {
    for (const [rank, candidate] of values.slice(0, 500).entries()) {
      if (!candidate) continue;
      const value = (typeof candidate === "string" ? candidate : candidate.value).trim();
      if (value.length <= query.length || value.length > 200 || !value.toLocaleLowerCase().startsWith(needle)) continue;
      const href = typeof candidate === "string" ? undefined : candidate.href;
      const key = JSON.stringify([scope, value.toLocaleLowerCase(), href]);
      const score = (scores.get(key) ?? 0) + 1 / (1 + rank / 5);
      scores.set(key, score);
      if (score > bestScore) {
        bestScore = score;
        const rest = value.slice(query.length);
        best = { value: query + rest, rest, scope, reason: typeof candidate === "string" ? reason : candidate.reason, ...(href && { href }) };
      }
    }
  }
  return best;
}

export function webActivityCompletion(query: string, searches: readonly string[], visits: readonly { url: string; title: string }[]): InlineCompletion | null {
  if (!query || query !== query.trimStart()) return null;
  const needle = query.toLocaleLowerCase();
  const matches = (value: string) => value.length > query.length && value.length <= 200 && value.toLocaleLowerCase().startsWith(needle);
  const destinations = visits.slice(0, 500).map((visit): VisitedDestination | null => {
    let url: URL;
    try { url = new URL(visit.url); } catch { return null; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const site = /^https?:\/\//u.test(needle) ? url.origin
      : needle.startsWith("www.") ? url.host : url.host.replace(/^www\./u, "");
    if (matches(site)) return { value: site, href: url.origin + "/", reason: `You visited ${url.host}, and its address starts with what you typed.` };
    const path = site + url.pathname;
    if (url.pathname !== "/" && matches(path)) return { value: path, href: url.href, reason: `This matches a page address you visited on ${url.host}.` };
    const title = visit.title.trim();
    return matches(title) ? { value: title, href: url.href, reason: `This matches the title of a page you visited on ${url.host}.` } : null;
  });
  return inlineCompletion(query, [{ scope: "web", values: searches }, { scope: "web", values: destinations }]);
}

export function webDestinationUrl(value: string): string {
  if (looksLikeBrowserAddress(value)) {
    try {
      const url = new URL(/^https?:\/\//iu.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
      if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    } catch { /* A malformed address can still be searched. */ }
  }
  return webSearchUrl(value);
}

export function webSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}
