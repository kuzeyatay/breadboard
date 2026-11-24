// The renderer and dashboard share the Leiden implementation exported below.
// The Louvain entry point remains available to older callers.

export interface TopicEdge {
  source: string;
  target: string;
  weight: number;
}

export interface Topic {
  index: number;
  label: string;
  memberIds: string[];
}

/** Colored topics; smaller groups and the long tail stay the default color. */
export const MAX_TOPICS = 8;
const MAX_LEVELS = 10;

/** Louvain modularity communities: node id -> community number. */
export function louvainCommunities(
  nodeIds: readonly string[],
  edges: readonly TopicEdge[],
): Map<string, number> {
  const ids = [...new Set(nodeIds)].sort();
  const indexOf = new Map(ids.map((id, index) => [id, index]));
  let adjacency: Array<Map<number, number>> = ids.map(() => new Map());
  for (const edge of edges) {
    const u = indexOf.get(edge.source);
    const v = indexOf.get(edge.target);
    if (u === undefined || v === undefined || u === v || !(edge.weight > 0)) continue;
    adjacency[u].set(v, (adjacency[u].get(v) ?? 0) + edge.weight);
    adjacency[v].set(u, (adjacency[v].get(u) ?? 0) + edge.weight);
  }

  // membership[original node] = community in the current (aggregated) graph
  let membership = ids.map((_, index) => index);

  for (let level = 0; level < MAX_LEVELS; level += 1) {
    const n = adjacency.length;
    const degree = adjacency.map((row) => [...row.values()].reduce((sum, w) => sum + w, 0));
    const total = degree.reduce((sum, value) => sum + value, 0);
    if (total === 0) break;

    const community = adjacency.map((_, index) => index);
    const communityDegree = [...degree];
    let moved = false;
    for (let improved = true; improved;) {
      improved = false;
      for (let node = 0; node < n; node += 1) {
        const current = community[node];
        const links = new Map<number, number>();
        for (const [neighbor, weight] of adjacency[node]) {
          if (neighbor === node) continue;
          const target = community[neighbor];
          links.set(target, (links.get(target) ?? 0) + weight);
        }
        communityDegree[current] -= degree[node];
        let best = current;
        let bestGain = (links.get(current) ?? 0) - (communityDegree[current] * degree[node]) / total;
        for (const [candidate, weight] of links) {
          const gain = weight - (communityDegree[candidate] * degree[node]) / total;
          if (gain > bestGain + 1e-12) {
            best = candidate;
            bestGain = gain;
          }
        }
        communityDegree[best] += degree[node];
        if (best !== current) {
          community[node] = best;
          improved = true;
          moved = true;
        }
      }
    }
    if (!moved) break;

    // Renumber densely and fold each community into one node.
    const renumber = new Map<number, number>();
    for (const value of community) if (!renumber.has(value)) renumber.set(value, renumber.size);
    const folded: Array<Map<number, number>> = Array.from({ length: renumber.size }, () => new Map());
    for (let node = 0; node < n; node += 1) {
      const from = renumber.get(community[node])!;
      for (const [neighbor, weight] of adjacency[node]) {
        const to = renumber.get(community[neighbor])!;
        folded[from].set(to, (folded[from].get(to) ?? 0) + weight);
      }
    }
    membership = membership.map((value) => renumber.get(community[value])!);
    adjacency = folded;
  }

  return new Map(ids.map((id, index) => [id, membership[index]]));
}

export { detectTopics, leidenCommunities } from "../../vendor/quartz-thought-topology/communities.ts";
