import type { DesktopBrowserHistoryEntry } from "@/lib/desktop-browser-tabs";
import { recentSearchFromInput } from "./browser-recent-searches.ts";

export interface BrowserHistoryRow {
  kind: "page" | "search";
  id: string;
  url: string;
  title: string;
  search?: string;
  visitedAt?: number;
}

export function browserHistoryRows(pages: DesktopBrowserHistoryEntry[], searches: string[]): BrowserHistoryRow[] {
  const visitedSearches = new Set(pages.map((page) => recentSearchFromInput(page.url)).filter(Boolean));
  return [
    ...pages.map((page): BrowserHistoryRow => ({ ...page, id: page.url, kind: "page" })),
    ...searches.filter((search) => !visitedSearches.has(search)).map((search): BrowserHistoryRow => ({
      kind: "search", id: `search:${search}`, title: search, search,
      url: `https://www.google.com/search?q=${encodeURIComponent(search)}`,
    })),
  ];
}

export function filterBrowserHistory(rows: BrowserHistoryRow[], query: string): BrowserHistoryRow[] {
  const filter = query.trim().toLocaleLowerCase();
  return rows.filter((row) => `${row.title}\n${row.url}`.toLocaleLowerCase().includes(filter));
}
