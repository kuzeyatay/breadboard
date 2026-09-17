/** Share a bounded result list across complementary queries, deduplicating papers. */
export function mergeQueryResults<T extends { title: string; doi?: string | null }>(
  groups: readonly (readonly T[])[], limit: number,
): T[] {
  const merged: T[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...groups.map(group => group.length));
  for (let index = 0; index < depth && merged.length < limit; index += 1) {
    for (const group of groups) {
      const document = group[index];
      if (!document) continue;
      const key = document.doi?.trim().toLowerCase() || document.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(document);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}
