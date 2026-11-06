/** The source tree needs direct links only, in the caller's reading order. */
export function buildKnowledgeTree<Node extends { slug: string }>(
  sources: readonly Node[],
  topics: readonly Node[],
  edges: readonly { source: string; target: string; relation: string }[],
): { tree: { source: Node; topics: Node[] }[]; orphanTopics: Node[] } {
  const sourceSlugs = new Set(sources.map(source => source.slug));
  const topicSlugs = new Set(topics.map(topic => topic.slug));
  const sourcesByTopic = new Map<string, Set<string>>();
  const connect = (source: string, topic: string) => {
    if (!sourceSlugs.has(source) || !topicSlugs.has(topic)) return;
    let linked = sourcesByTopic.get(topic);
    if (!linked) sourcesByTopic.set(topic, linked = new Set());
    linked.add(source);
  };
  // Previously each source/topic pair scanned all edges, blocking the server
  // for large gardens. Index each edge once, including links in either direction.
  for (const edge of edges) {
    if (edge.relation === "shared-topic") continue;
    connect(edge.source, edge.target);
    connect(edge.target, edge.source);
  }

  const topicsBySource = new Map<string, Node[]>();
  const orphanTopics: Node[] = [];
  for (const topic of topics) {
    const linked = sourcesByTopic.get(topic.slug);
    if (!linked) {
      orphanTopics.push(topic);
      continue;
    }
    for (const source of linked) {
      let ordered = topicsBySource.get(source);
      if (!ordered) topicsBySource.set(source, ordered = []);
      ordered.push(topic);
    }
  }
  return {
    tree: sources.map(source => ({ source, topics: topicsBySource.get(source.slug) ?? [] })),
    orphanTopics,
  };
}
