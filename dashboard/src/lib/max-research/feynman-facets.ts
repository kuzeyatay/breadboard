import type { FeynmanInput, FeynmanResult } from "../feynman/service.ts";

/** Cover the planned facets without increasing the total paper/full-text budget. */
export async function collectFeynmanFacets(queries: readonly string[], research: (input: FeynmanInput) => Promise<FeynmanResult>): Promise<FeynmanResult[]> {
  const planned = [...new Set(queries.map(query => query.trim()).filter(Boolean))].slice(0, 3);
  const results: FeynmanResult[] = new Array(planned.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(2, planned.length)}, async () => {
    while (next < planned.length) {
      const index = next++;
      results[index] = await research({query: planned[index], limit: Math.floor(12 / planned.length), fullTextTop: Math.floor(3 / planned.length)});
    }
  }));
  const seen = new Set<string>();
  return results.map(result => ({...result, papers: result.papers.filter(paper => {
    const key = (paper.doi || paper.id).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })}));
}
