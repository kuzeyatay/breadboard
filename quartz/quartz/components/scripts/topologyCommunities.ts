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
const MIN_TOPIC_SIZE = 3;
const MAX_LEVELS = 10;


/** Weighted modularity with Leiden local moving, constrained singleton
 * refinement, and aggregation initialized from the coarse partition.
 * Stable traversal and maximum positive gain give deterministic map colours. */
export function leidenCommunities(idsInput: readonly string[], edges: readonly TopicEdge[]) {
  const ids = [...new Set(idsInput)].sort()
  const index = new Map(ids.map((id, i) => [id, i]))
  let graph = ids.map(() => new Map<number, number>())
  for (const { source, target, weight } of edges) {
    const a = index.get(source), b = index.get(target)
    if (a === undefined || b === undefined || a === b || !Number.isFinite(weight) || weight <= 0) continue
    graph[a].set(b, (graph[a].get(b) ?? 0) + weight)
    graph[b].set(a, (graph[b].get(a) ?? 0) + weight)
  }
  let original = ids.map((_, i) => i)
  let coarse = [...original]
  for (let level = 0; level < MAX_LEVELS; level++) {
    const degree = graph.map(row => [...row.values()].reduce((a, b) => a + b, 0))
    const mass = degree.reduce((a, b) => a + b, 0)
    if (!mass) break
    const volumes = new Float64Array(graph.length)
    coarse.forEach((c, i) => { volumes[c] += degree[i] })
    let moved = true
    while (moved) {
      moved = false
      for (let i = 0; i < graph.length; i++) {
        const old = coarse[i], weights = new Map<number, number>()
        for (const [j, w] of graph[i]) if (i !== j) weights.set(coarse[j], (weights.get(coarse[j]) ?? 0) + w)
        volumes[old] -= degree[i]
        let best = old, gain = (weights.get(old) ?? 0) - degree[i] * volumes[old] / mass
        for (const [candidate, weight] of weights) {
          const next = weight - degree[i] * volumes[candidate] / mass
          if (next > gain + 1e-12) { best = candidate; gain = next }
        }
        coarse[i] = best
        volumes[best] += degree[i]
        if (best !== old) moved = true
      }
    }
    // Refine from singletons inside each coarse community. Both the singleton
    // and its destination must be sufficiently connected to the parent.
    const refined = graph.map((_, i) => i)
    const sizes = graph.map(() => 1), volume = [...degree]
    const cut = graph.map((row, i) => [...row].reduce((w, [j, n]) => w + (j !== i && coarse[i] === coarse[j] ? n : 0), 0))
    const admissible = (i: number) => cut[i] + 1e-12 >= volume[i] * (volumes[coarse[i]] - volume[i]) / mass
    for (let i = 0; i < graph.length; i++) {
      if (sizes[i] !== 1 || refined[i] !== i || !admissible(i)) continue
      const links = new Map<number, number>()
      for (const [j, w] of graph[i]) {
        if (j !== i && coarse[j] === coarse[i]) links.set(refined[j], (links.get(refined[j]) ?? 0) + w)
      }
      let target = i, gain = 0
      for (const [c, w] of links) {
        const next = w - degree[i] * volume[c] / mass
        if (admissible(c) && next > gain + 1e-12) { target = c; gain = next }
      }
      if (target === i) continue
      refined[i] = target
      sizes[target]++
      volume[target] += degree[i]
      cut[target] += cut[i] - 2 * links.get(target)!
    }
    const labels = [...new Set(refined)]
    if (labels.length === graph.length || level === MAX_LEVELS - 1) break
    const renumber = new Map(labels.map((label, i) => [label, i]))
    const membership = refined.map(c => renumber.get(c)!)
    const nextGraph = labels.map(() => new Map<number, number>())
    graph.forEach((row, i) => {
      for (const [j, w] of row) {
        const target = membership[j], links = nextGraph[membership[i]]
        links.set(target, (links.get(target) ?? 0) + w)
      }
    })
    original = original.map(i => membership[i])
    const coarseNames = new Map<number, number>()
    coarse = labels.map(label => {
      const old = coarse[label]
      if (!coarseNames.has(old)) coarseNames.set(old, coarseNames.size)
      return coarseNames.get(old)!
    })
    graph = nextGraph
  }
  return new Map(ids.map((id, i) => [id, coarse[original[i]]]))
}
/**
 * The largest communities become topics, named after the concepts their
 * pages share most (falling back to the best-connected page's title).
 */
export function detectTopics(
  nodes: ReadonlyArray<{ id: string; title: string; concepts: readonly string[] }>,
  edges: readonly TopicEdge[],
): Topic[] {
  const communities = leidenCommunities(nodes.map((node) => node.id), edges);
  const groups = new Map<number, typeof nodes[number][]>();
  for (const node of nodes) {
    const community = communities.get(node.id);
    if (community === undefined) continue;
    const group = groups.get(community) ?? [];
    group.push(node);
    groups.set(community, group);
  }
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + edge.weight);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + edge.weight);
  }

  return [...groups.values()]
    .filter((group) => group.length >= MIN_TOPIC_SIZE)
    .map((group) => ({ group, label: topicLabel(group, degree) }))
    .sort((left, right) => right.group.length - left.group.length || left.label.localeCompare(right.label))
    .slice(0, MAX_TOPICS)
    .map(({ group, label }, index, all) => {
      // Two groups can share their top concepts; number the later ones.
      const earlier = all.slice(0, index).filter((entry) => entry.label === label).length;
      return {
        index,
        label: earlier > 0 ? `${label} ${earlier + 1}` : label,
        memberIds: group.map((node) => node.id),
      };
    });
}

function topicLabel(
  group: ReadonlyArray<{ id: string; title: string; concepts: readonly string[] }>,
  degree: ReadonlyMap<string, number>,
): string {
  const counts = new Map<string, { label: string; count: number }>();
  for (const node of group) {
    for (const concept of new Set(node.concepts.map((value) => value.trim()).filter(Boolean))) {
      const key = concept.toLowerCase();
      const entry = counts.get(key) ?? { label: concept, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  const shared = [...counts.values()]
    .filter((entry) => entry.count >= 2)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .filter((entry, index, sorted) => index === 0 || (index === 1 && entry.count * 2 >= sorted[0].count))
    .map((entry) => entry.label);
  if (shared.length > 0) return shared.join(" and ");
  const hub = [...group].sort(
    (left, right) => (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0) || left.title.localeCompare(right.title),
  )[0];
  return hub.title;
}
