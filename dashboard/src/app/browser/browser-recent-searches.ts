const ADDRESS_PATTERN =
  /^(?:https?:\/\/|localhost(?::\d+)?(?:\/|$)|[^\s/]+\.[a-z]{2,}(?:\/|$))/iu;

export function looksLikeBrowserAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value.trim());
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
