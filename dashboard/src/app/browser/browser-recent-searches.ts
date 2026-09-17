const ADDRESS_PATTERN =
  /^(?:https?:\/\/|localhost(?::\d+)?(?:\/|$)|[^\s/]+\.[a-z]{2,}(?:\/|$))/iu;

export function looksLikeBrowserAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value.trim());
}

export interface SearchSuggestion {
  value: string;
  label: string;
  detail?: string;
  source: "google" | "history";
}

export function searchSuggestions(
  query: string,
  recentSearches: readonly string[],
  google: readonly string[],
): SearchSuggestion[] {
  const value = query.trim();
  const normalized = value.toLocaleLowerCase();
  const remembered: SearchSuggestion[] = recentSearches
    .filter((entry) => entry.toLocaleLowerCase().includes(normalized))
    .map((entry) => ({ value: entry, label: entry, source: "history" }));
  const predictions: SearchSuggestion[] = (value && !looksLikeBrowserAddress(value) ? google : [])
    .map((entry) => ({ value: entry, label: entry, source: "google" }));
  if (value && !looksLikeBrowserAddress(value) && !predictions.some((entry) => entry.value.toLocaleLowerCase() === normalized)) {
    predictions.unshift({ value, label: value, detail: "Search with Google", source: "google" });
  }
  const seen = new Set<string>();
  return [...remembered, ...predictions]
    .filter((entry) => {
      const key = entry.value.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

/** Return only a term that Breadboard actually sent to search. */
export function recentSearchFromInput(input: string): string | null {
  const clean = input.trim().slice(0, 300);
  if (!clean) return null;
  try {
    const url = new URL(clean);
    if (/^(?:www\.)?google\./iu.test(url.hostname) && url.pathname === "/search") {
      return url.searchParams.get("q")?.trim().slice(0, 300) || null;
    }
    return null;
  } catch {
    return looksLikeBrowserAddress(clean) ? null : clean;
  }
}

/** Clean old mixed page/search history while migrating it to recent searches. */
export function normalizeRecentSearches(value: unknown, limit = 80): string[] {
  if (!Array.isArray(value)) return [];
  const searches: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const search = recentSearchFromInput(entry);
    if (!search || seen.has(search)) continue;
    seen.add(search);
    searches.push(search);
    if (searches.length === limit) break;
  }
  return searches;
}
