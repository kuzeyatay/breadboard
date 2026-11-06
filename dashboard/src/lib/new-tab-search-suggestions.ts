import type { SearchSuggestion } from "../app/browser/browser-recent-searches.ts";
import { SEARCH_LABELS, type BreadboardSearchResult } from "./breadboard-search.ts";
import { looksLikeBrowserAddress, normalizeRecentSearches } from "../app/browser/browser-recent-searches.ts";

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
  }).slice(0, 4);
  if (!value) return recent;
  return [...recent,
    { value, label: value, detail: "Search Breadboard", source: "breadboard" as const, scope: "breadboard" as const },
    { value, label: value, detail: looksLikeBrowserAddress(value) ? "Go to website" : "Search the web", source: "web" as const, scope: "web" as const },
    ...results.slice(0, 8 - recent.length - 2).map(result => ({ id: result.id, value: result.title, label: result.title,
      detail: `${SEARCH_LABELS[result.type]} · ${result.context}`, source: "breadboard" as const, scope: "breadboard" as const, result })),
  ];
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
