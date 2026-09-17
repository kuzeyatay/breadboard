import { FullSlug } from "../../util/path"

const GLOBAL_SEARCH_ROOTS = new Set([
  "",
  "404",
  "index",
  "private-library",
  "private-quartz",
  "public-library",
  "public-quartz",
  "static",
  "tags",
])

/**
 * Garden pages only need to search their own garden. Library and generated
 * pages retain the original site-wide search behaviour.
 */
export function searchScope(currentSlug: FullSlug): string | null {
  const root = String(currentSlug).replace(/^\/+/, "").split("/")[0] ?? ""
  return GLOBAL_SEARCH_ROOTS.has(root) ? null : root
}

export function scopeSearchEntries<T>(
  data: Record<string, T>,
  currentSlug: FullSlug,
): Array<[FullSlug, T]> {
  const scope = searchScope(currentSlug)
  const entries = Object.entries(data) as Array<[FullSlug, T]>
  if (scope === null) return entries
  return entries.filter(([slug]) => slug === scope || slug.startsWith(`${scope}/`))
}
