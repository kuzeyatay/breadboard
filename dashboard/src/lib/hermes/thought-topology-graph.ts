import type {
  ThoughtTopology,
  TopologyEdgeDirection,
  TopologyEdgeOrigin,
} from "../thought-topology/types.ts";
import type { ChatCocitation } from "./chat-cocitation.ts";

export const HERMES_TOPOLOGY_GRAPH_FORMAT =
  "breadboard-thought-topology-property-graph-v1";

export type HermesTopologyNodeType = "garden" | "folder" | "page";
export type HermesTopologyEdgeType = "contains" | "affinity";

export interface HermesTopologyGraphNode {
  id: string;
  type: HermesTopologyNodeType;
  title: string;
  summary: string;
  slug?: string;
  relPath?: string;
  folderPath?: string;
  contentKind?: string;
  knowledgeType?: string;
  primaryConcepts?: string[];
  supportingConcepts?: string[];
}

export interface HermesTopologyGraphEdge {
  id: string;
  source: string;
  target: string;
  type: HermesTopologyEdgeType;
  relation: string;
  direction: TopologyEdgeDirection | "source-to-target";
  weight: number;
  origin: TopologyEdgeOrigin | "structure" | "conversation";
  /** How many of the user's conversations cited both pages in one answer. */
  conversations?: number;
  explanation: string;
  /** The relation as a sentence, direction applied ("A depends on B"). */
  reads?: string;
  evidence: Array<{ kind: string; label: string; sourceNodeId?: string }>;
  visualWidth: number;
  provenance: {
    artifact: "thought-topology";
    sourceRevision: string;
    basis: "folder-structure" | "scored-connection" | "chat-cocitation";
  };
}

export interface HermesTopologyGraphQuery {
  start?: unknown;
  depth?: unknown;
  limit?: unknown;
  minWeight?: unknown;
  relationTypes?: unknown;
  includeHierarchy?: unknown;
  /** "out" follows typed relations as they read (A depends on B: A → B, so
   * prerequisites); "in" walks them backwards (what builds on A). */
  follow?: unknown;
  /** When set, return the shortest connection from start to this node. */
  target?: unknown;
  /** Page pairs the user's own chats cite together (server-derived, never a model argument). */
  chatLinks?: readonly ChatCocitation[];
}

/** How much the map's links can be trusted to show what is related. */
export interface HermesTopologyLinkQuality {
  status: "linked" | "sparse" | "structure-only";
  retrievalMode: ThoughtTopology["build"]["retrievalMode"];
  pages: number;
  inferredLinks: number;
  authoredLinks: number;
  typedLinks: number;
  /** Links added from the user's chats, beyond what the map already had. */
  chatLinks: number;
  startNodeLinks?: number;
  note: string;
}

export interface HermesTopologyGraphResult {
  format: typeof HERMES_TOPOLOGY_GRAPH_FORMAT;
  sourceRevision: string;
  scoringVersion: string;
  buildState: ThoughtTopology["build"]["state"];
  ontology: {
    nodeTypes: readonly HermesTopologyNodeType[];
    edgeTypes: readonly HermesTopologyEdgeType[];
    hierarchyRelation: "contains";
    weightMeaning: string;
  };
  linkQuality: HermesTopologyLinkQuality;
  path?: {
    target: HermesTopologyGraphNode | null;
    found: boolean;
    hops: number;
    reads: string[];
  };
  startNode: HermesTopologyGraphNode | null;
  nodes: HermesTopologyGraphNode[];
  edges: HermesTopologyGraphEdge[];
  traversal: {
    depth: number;
    limit: number;
    minWeight: number;
    relationTypes: string[];
    includeHierarchy: boolean;
    follow?: "out" | "in";
    truncated: boolean;
  };
  availableMatches?: Array<{
    id: string;
    title: string;
    type: HermesTopologyNodeType;
  }>;
}

interface PropertyGraph {
  nodes: HermesTopologyGraphNode[];
  edges: HermesTopologyGraphEdge[];
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function boundedText(value: string | undefined, limit: number): string {
  return (value ?? "").trim().slice(0, limit);
}

function comparable(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "")
    .toLocaleLowerCase();
}

/** Weight from conversation count: 2 chats → 0.75, 3 → 0.875, approaching 1. */
function chatWeight(conversations: number): number {
  return Math.round((1 - 0.5 ** conversations) * 1000) / 1000;
}

function chatEvidence(link: ChatCocitation) {
  return {
    kind: "conversation",
    label: `Cited together in ${link.conversations} of your chats${link.question ? `, for example: "${link.question}"` : ""}`,
  };
}

/** Chat co-citations as graph edges. A pair the map already links gains the
 * chat as evidence instead of a duplicate edge. */
function withChatLinks(
  topology: ThoughtTopology,
  nodes: readonly HermesTopologyGraphNode[],
  edges: HermesTopologyGraphEdge[],
  chatLinks: readonly ChatCocitation[],
): HermesTopologyGraphEdge[] {
  if (!chatLinks.length) return edges;
  const byPath = new Map(
    nodes
      .filter((node) => node.type === "page" && node.relPath)
      .map((node) => [node.relPath!.replace(/\.md$/i, "").toLocaleLowerCase(), node]),
  );
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const existing = new Map(
    edges.filter((edge) => edge.type === "affinity").map((edge) => [pairKey(edge.source, edge.target), edge]),
  );
  const added: HermesTopologyGraphEdge[] = [];
  for (const link of chatLinks) {
    const left = byPath.get(link.left);
    const right = byPath.get(link.right);
    if (!left || !right || left.id === right.id) continue;
    const known = existing.get(pairKey(left.id, right.id));
    if (known) {
      known.conversations = link.conversations;
      known.evidence = [chatEvidence(link), ...known.evidence].slice(0, 12);
      continue;
    }
    const edge: HermesTopologyGraphEdge = {
      id: `chat:${pairKey(left.id, right.id).replace("\u0000", ":")}`,
      source: left.id,
      target: right.id,
      type: "affinity",
      relation: "co-studied",
      direction: "undirected",
      weight: chatWeight(link.conversations),
      origin: "conversation",
      conversations: link.conversations,
      reads: `You studied ${left.title} and ${right.title} together in ${link.conversations} chats.`,
      explanation: `Answers in ${link.conversations} of the user's conversations cited both pages together. This shows what the user studies together, not what the sources say.`,
      evidence: [chatEvidence(link)],
      visualWidth: 1,
      provenance: { artifact: "thought-topology", sourceRevision: topology.sourceRevision, basis: "chat-cocitation" },
    };
    existing.set(pairKey(left.id, right.id), edge);
    added.push(edge);
  }
  return [...edges, ...added];
}

function propertyGraph(topology: ThoughtTopology): PropertyGraph {
  const gardenNodeId = `garden:${topology.garden.slug}`;
  const rootFolderId =
    topology.folders.find((folder) => !folder.path)?.id ?? "folder:$root";
  const nodes: HermesTopologyGraphNode[] = [
    {
      id: gardenNodeId,
      type: "garden",
      title: topology.garden.title,
      slug: topology.garden.slug,
      summary: boundedText(topology.garden.summary.text, 800),
    },
    ...topology.folders
      .filter((folder) => Boolean(folder.path))
      .map(
        (folder): HermesTopologyGraphNode => ({
          id: folder.id,
          type: "folder",
          title: folder.title,
          folderPath: folder.path,
          slug: folder.pageSlug,
          summary: boundedText(folder.summary.text, 800),
        }),
      ),
    ...topology.nodes.map(
      (node): HermesTopologyGraphNode => ({
        id: node.id,
        type: "page",
        title: node.title,
        slug: node.slug,
        relPath: node.relPath,
        summary: boundedText(node.summary.text, 800),
        contentKind: node.kind,
        knowledgeType: node.knowledgeType,
        primaryConcepts: node.primaryConcepts.slice(0, 16),
        supportingConcepts: node.supportingConcepts.slice(0, 16),
      }),
    ),
  ];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const structuralEdges: HermesTopologyGraphEdge[] = [];

  for (const folder of topology.folders) {
    if (!folder.path || !nodeIds.has(folder.id)) continue;
    const parent =
      folder.parentId &&
      folder.parentId !== rootFolderId &&
      nodeIds.has(folder.parentId)
        ? folder.parentId
        : gardenNodeId;
    structuralEdges.push({
      id: `hierarchy:${parent}:${folder.id}`,
      source: parent,
      target: folder.id,
      type: "contains",
      relation: "contains",
      direction: "source-to-target",
      weight: 1,
      origin: "structure",
      explanation: `${nodes.find((node) => node.id === parent)?.title ?? topology.garden.title} contains ${folder.title}.`,
      evidence: [{ kind: "authored", label: folder.path }],
      visualWidth: 1,
      provenance: {
        artifact: "thought-topology",
        sourceRevision: topology.sourceRevision,
        basis: "folder-structure",
      },
    });
  }

  for (const page of topology.nodes) {
    if (!nodeIds.has(page.id)) continue;
    const parent =
      page.folderId !== rootFolderId && nodeIds.has(page.folderId)
        ? page.folderId
        : gardenNodeId;
    structuralEdges.push({
      id: `hierarchy:${parent}:${page.id}`,
      source: parent,
      target: page.id,
      type: "contains",
      relation: "contains",
      direction: "source-to-target",
      weight: 1,
      origin: "structure",
      explanation: `${nodes.find((node) => node.id === parent)?.title ?? topology.garden.title} contains ${page.title}.`,
      evidence: [
        { kind: "authored", label: page.relPath, sourceNodeId: page.id },
      ],
      visualWidth: 1,
      provenance: {
        artifact: "thought-topology",
        sourceRevision: topology.sourceRevision,
        basis: "folder-structure",
      },
    });
  }

  const titles = new Map(nodes.map((node) => [node.id, node.title]));
  const affinityEdges = topology.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map(
      (edge): HermesTopologyGraphEdge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "affinity",
        relation: edge.relationType,
        direction: edge.direction,
        weight: edge.score,
        origin: edge.origin,
        reads: relationSentence(
          edge.relationType,
          edge.direction,
          titles.get(edge.source) ?? edge.source,
          titles.get(edge.target) ?? edge.target,
        ),
        explanation: boundedText(edge.explanation.text, 1_200),
        evidence: edge.evidence.slice(0, 12).map((item) => ({
          kind: item.kind,
          label: boundedText(item.label, 400),
          ...(item.sourceNodeId ? { sourceNodeId: item.sourceNodeId } : {}),
        })),
        visualWidth: edge.visual.width,
        provenance: {
          artifact: "thought-topology",
          sourceRevision: topology.sourceRevision,
          basis: "scored-connection",
        },
      }),
    );

  return { nodes, edges: [...structuralEdges, ...affinityEdges] };
}

const RELATION_VERBS: Record<string, string> = {
  "depends-on": "depends on",
  "derives-from": "derives from",
  "applies-to": "applies to",
  extends: "extends",
  "contrasts-with": "contrasts with",
  "example-of": "is an example of",
  "part-of": "is part of",
  "shares-mechanism": "shares a mechanism with",
  "measured-by": "is measured by",
};

/** Typed edges read subject → object; source-to-target means "source
 * <relation> target" (verified on live data: 1.88 Best Approximation
 * depends-on 1.80 Orthogonal Complements). */
function orientedEnds(
  edge: Pick<HermesTopologyGraphEdge, "type" | "relation" | "direction" | "source" | "target">,
): { subject: string; object: string } | null {
  if (edge.type !== "affinity" || !RELATION_VERBS[edge.relation]) return null;
  if (edge.direction === "source-to-target") return { subject: edge.source, object: edge.target };
  if (edge.direction === "target-to-source") return { subject: edge.target, object: edge.source };
  return null;
}

function relationSentence(
  relation: string,
  direction: TopologyEdgeDirection,
  sourceTitle: string,
  targetTitle: string,
): string {
  const verb = RELATION_VERBS[relation];
  if (direction === "undirected" && (relation === "contrasts-with" || relation === "shares-mechanism")) {
    return `${sourceTitle} ${verb} ${targetTitle}.`;
  }
  if (!verb || direction === "undirected") {
    return `${sourceTitle} and ${targetTitle} are related${verb ? ` (${verb})` : ""}.`;
  }
  const [subject, object] =
    direction === "target-to-source" ? [targetTitle, sourceTitle] : [sourceTitle, targetTitle];
  return `${subject} ${verb} ${object}.`;
}

/** Whether absent links mean anything. A Garden built without embeddings
 * (concept-lexical) has folder structure but almost no inferred links, so
 * "no neighbours" there says nothing about relatedness. */
export function topologyLinkQuality(
  topology: ThoughtTopology,
  startNodeId?: string,
  graphEdges: readonly HermesTopologyGraphEdge[] = [],
): HermesTopologyLinkQuality {
  const chatEdges = graphEdges.filter((edge) => edge.origin === "conversation");
  const chatLinks = chatEdges.length;
  const startChatLinks = startNodeId
    ? chatEdges.filter((edge) => edge.source === startNodeId || edge.target === startNodeId).length
    : 0;
  const pages = topology.nodes.length;
  const inferredLinks = topology.edges.filter((edge) => edge.origin === "inferred").length;
  const authoredLinks = topology.edges.length - inferredLinks;
  const typedLinks = topology.edges.filter((edge) => edge.relationType !== "related").length;
  const perPage = pages ? topology.edges.length / pages : 0;
  const status: HermesTopologyLinkQuality["status"] =
    topology.edges.length === 0 || perPage < 0.2
      ? "structure-only"
      : perPage < 1 || topology.build.retrievalMode === "concept-lexical"
        ? "sparse"
        : "linked";
  const startNodeLinks = startNodeId?.startsWith("page:")
    ? topology.edges.filter((edge) => edge.source === startNodeId || edge.target === startNodeId).length
    : undefined;
  const why =
    topology.build.retrievalMode === "concept-lexical"
      ? "it was built while the embedding service was unavailable"
      : "few connections cleared the scoring threshold";
  const note =
    status === "structure-only"
      ? `This map has ${topology.edges.length} links for ${pages} pages because ${why}. Only folder structure is reliable; a missing neighbour says nothing about whether pages are related. Use garden_search to find related pages.`
      : status === "sparse"
        ? `This map is sparse (${topology.edges.length} links for ${pages} pages) because ${why}. Treat a missing link as weak evidence and confirm with garden_search.`
        : "Links are similarity-scored and model-typed navigation aids, not proof; a missing link does not mean the ideas are unrelated.";
  return {
    status,
    retrievalMode: topology.build.retrievalMode,
    pages,
    inferredLinks,
    authoredLinks,
    typedLinks,
    chatLinks,
    ...(startNodeLinks !== undefined ? { startNodeLinks } : {}),
    note: [
      note,
      startNodeLinks === 0 && status !== "structure-only" ? "This page itself has no scored links in the map." : "",
      chatLinks
        ? `${chatLinks} co-studied links come from the user's own chats${startChatLinks ? ` (${startChatLinks} touch this page)` : ""}; they show what the user studies together, not what the sources claim.`
        : "",
    ].filter(Boolean).join(" "),
  };
}

function nodeAliases(
  node: HermesTopologyGraphNode,
  gardenSlug: string,
): string[] {
  const aliases = [
    node.id,
    node.title,
    node.slug,
    node.relPath,
    node.folderPath,
  ].filter((value): value is string => Boolean(value));
  if (node.slug?.startsWith(`${gardenSlug}/`)) {
    aliases.push(node.slug.slice(gardenSlug.length + 1));
  }
  if (node.type === "garden") aliases.push(gardenSlug, `garden:${gardenSlug}`);
  return [...new Set(aliases.map(comparable).filter(Boolean))];
}

function resolveNode(
  nodes: readonly HermesTopologyGraphNode[],
  gardenSlug: string,
  reference: unknown,
): HermesTopologyGraphNode | null {
  if (typeof reference !== "string" || !reference.trim()) return null;
  const wanted = comparable(reference);
  const exact = nodes.filter((node) =>
    nodeAliases(node, gardenSlug).includes(wanted),
  );
  if (exact.length === 1) return exact[0];
  return exact.find((node) => comparable(node.id) === wanted) ?? null;
}

function relationFilter(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLocaleLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 12);
}

function edgeOrder(
  left: HermesTopologyGraphEdge,
  right: HermesTopologyGraphEdge,
): number {
  if (left.type !== right.type) return left.type === "affinity" ? -1 : 1;
  return right.weight - left.weight || left.id.localeCompare(right.id);
}

export function queryThoughtTopologyGraph(
  topology: ThoughtTopology,
  input: HermesTopologyGraphQuery,
): HermesTopologyGraphResult {
  const graph = propertyGraph(topology);
  graph.edges = withChatLinks(topology, graph.nodes, graph.edges, input.chatLinks ?? []);
  const depth = Math.floor(boundedNumber(input.depth, 1, 0, 3));
  const limit = Math.floor(boundedNumber(input.limit, 24, 2, 50));
  const minWeight = boundedNumber(input.minWeight, 0, 0, 1);
  const relationTypes = relationFilter(input.relationTypes);
  const follow = input.follow === "out" || input.follow === "in" ? input.follow : undefined;
  const wantsPath = typeof input.target === "string" && Boolean(input.target.trim());
  // Hierarchy makes every sibling two hops apart, which drowns typed
  // relations; directed walks and paths only use it when asked explicitly.
  const includeHierarchy =
    follow || wantsPath ? input.includeHierarchy === true : input.includeHierarchy !== false;
  const startNode = resolveNode(graph.nodes, topology.garden.slug, input.start);
  const base = {
    format: HERMES_TOPOLOGY_GRAPH_FORMAT,
    sourceRevision: topology.sourceRevision,
    scoringVersion: topology.scoringVersion,
    buildState: topology.build.state,
    linkQuality: topologyLinkQuality(topology, startNode?.id, graph.edges),
    ontology: {
      nodeTypes: ["garden", "folder", "page"] as const,
      edgeTypes: ["contains", "affinity"] as const,
      hierarchyRelation: "contains" as const,
      weightMeaning:
        "Affinity weight is the Thought Topology score from 0 to 1; larger values are stronger connections. Contains edges have structural weight 1.",
    },
  } as const;
  if (!startNode) {
    const wanted =
      typeof input.start === "string" ? comparable(input.start) : "";
    const availableMatches = graph.nodes
      .filter(
        (node) =>
          !wanted ||
          nodeAliases(node, topology.garden.slug).some((alias) =>
            alias.includes(wanted),
          ),
      )
      .slice(0, 8)
      .map((node) => ({ id: node.id, title: node.title, type: node.type }));
    return {
      ...base,
      startNode: null,
      nodes: [],
      edges: [],
      traversal: {
        depth,
        limit,
        minWeight,
        relationTypes,
        includeHierarchy,
        ...(follow ? { follow } : {}),
        truncated: false,
      },
      ...(availableMatches.length ? { availableMatches } : {}),
    };
  }

  const requestedRelations = new Set(relationTypes);
  const semanticWildcard = requestedRelations.has("semantic-affinity");
  const eligibleEdges = graph.edges
    .filter((edge) => includeHierarchy || edge.type !== "contains")
    .filter((edge) => edge.type === "contains" || edge.weight >= minWeight)
    .filter(
      (edge) =>
        edge.type === "contains" ||
        requestedRelations.size === 0 ||
        (edge.type === "affinity" && semanticWildcard) ||
        requestedRelations.has(edge.relation.toLocaleLowerCase()),
    )
    .sort(edgeOrder);
  // Undirected walks see each edge from both ends; a directed walk only
  // enters an edge from the end it reads away from.
  const adjacent = new Map<string, Array<{ edge: HermesTopologyGraphEdge; next: string }>>();
  const link = (from: string, edge: HermesTopologyGraphEdge, next: string) =>
    adjacent.set(from, [...(adjacent.get(from) ?? []), { edge, next }]);
  for (const edge of eligibleEdges) {
    if (follow) {
      const ends = orientedEnds(edge);
      if (!ends) continue;
      if (follow === "out") link(ends.subject, edge, ends.object);
      else link(ends.object, edge, ends.subject);
    } else {
      link(edge.source, edge, edge.target);
      link(edge.target, edge, edge.source);
    }
  }

  if (wantsPath) {
    const target = resolveNode(graph.nodes, topology.garden.slug, input.target);
    // Cheapest route, where a typed relation costs less than a generic one.
    // A source document links to every page derived from it, so routing
    // through one makes any two pages two hops apart and explains nothing:
    // it may only be an endpoint.
    const kindById = new Map(graph.nodes.map((node) => [node.id, node.contentKind]));
    const stepCost = (edge: HermesTopologyGraphEdge) =>
      edge.type === "contains" ? 2 : RELATION_VERBS[edge.relation] ? 1 : 1.5;
    const cameFrom = new Map<string, { from: string; edge: HermesTopologyGraphEdge }>();
    const cost = new Map([[startNode.id, 0]]);
    const hops = new Map([[startNode.id, 0]]);
    const done = new Set<string>();
    // ponytail: linear-scan priority queue, fine for Gardens of ~1k nodes; use a heap past that.
    while (target && !done.has(target.id)) {
      let current: string | undefined;
      for (const [id, value] of cost) {
        if (!done.has(id) && (current === undefined || value < cost.get(current)!)) current = id;
      }
      if (current === undefined) break;
      done.add(current);
      const throughSource = current !== startNode.id && kindById.get(current) === "source";
      if (throughSource || hops.get(current)! >= 6) continue;
      for (const { edge, next: neighbor } of adjacent.get(current) ?? []) {
        const nextCost = cost.get(current)! + stepCost(edge);
        if (done.has(neighbor) || nextCost >= (cost.get(neighbor) ?? Infinity)) continue;
        cost.set(neighbor, nextCost);
        hops.set(neighbor, hops.get(current)! + 1);
        cameFrom.set(neighbor, { from: current, edge });
      }
    }
    const pathEdges: HermesTopologyGraphEdge[] = [];
    for (let at = target?.id; at && cameFrom.has(at); at = cameFrom.get(at)!.from) {
      pathEdges.unshift(cameFrom.get(at)!.edge);
    }
    const found = Boolean(target && (target.id === startNode.id || pathEdges.length));
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const pathNodeIds = [...new Set([startNode.id, ...pathEdges.flatMap((edge) => [edge.source, edge.target])])];
    return {
      ...base,
      path: {
        target,
        found,
        hops: pathEdges.length,
        reads: pathEdges.map((edge) => edge.reads ?? edge.explanation),
      },
      startNode,
      nodes: found ? pathNodeIds.map((id) => byId.get(id)!).filter(Boolean) : [startNode],
      edges: pathEdges,
      traversal: { depth: pathEdges.length, limit, minWeight, relationTypes, includeHierarchy, ...(follow ? { follow } : {}), truncated: false },
      ...(!target
        ? { availableMatches: graph.nodes.filter((node) => nodeAliases(node, topology.garden.slug).some((alias) => alias.includes(comparable(String(input.target))))).slice(0, 8).map((node) => ({ id: node.id, title: node.title, type: node.type })) }
        : {}),
    };
  }

  const visited = new Set<string>([startNode.id]);
  let frontier = new Set<string>([startNode.id]);
  let truncated = false;
  for (let level = 0; level < depth && frontier.size; level += 1) {
    const next = new Set<string>();
    const candidates = [...frontier]
      .flatMap((nodeId) => adjacent.get(nodeId) ?? [])
      .sort((left, right) => edgeOrder(left.edge, right.edge));
    for (const { next: nodeId } of candidates) {
      if (visited.has(nodeId)) continue;
      if (visited.size >= limit) {
        truncated = true;
        break;
      }
      visited.add(nodeId);
      next.add(nodeId);
    }
    frontier = next;
  }

  const maxEdges = Math.min(100, limit * 4);
  const allSelectedEdges = eligibleEdges.filter(
    (edge) =>
      visited.has(edge.source) &&
      visited.has(edge.target) &&
      (!follow || orientedEnds(edge) !== null),
  );
  if (allSelectedEdges.length > maxEdges) truncated = true;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodes = [
    startNode,
    ...[...visited]
      .filter((id) => id !== startNode.id)
      .map((id) => byId.get(id))
      .filter((node): node is HermesTopologyGraphNode => Boolean(node))
      .sort(
        (left, right) =>
          left.type.localeCompare(right.type) ||
          left.title.localeCompare(right.title),
      ),
  ];

  return {
    ...base,
    startNode,
    nodes,
    edges: allSelectedEdges.slice(0, maxEdges),
    traversal: {
      depth,
      limit,
      minWeight,
      relationTypes,
      includeHierarchy,
      truncated,
    },
  };
}

/** A smaller packet suitable for every-turn system context; tools return the full graph. */
export function compactThoughtTopologyGraph(
  result: HermesTopologyGraphResult,
): object {
  return {
    format: result.format,
    sourceRevision: result.sourceRevision,
    startNode: result.startNode?.id ?? null,
    linkQuality: { status: result.linkQuality.status, note: result.linkQuality.note },
    nodes: result.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      ...(node.slug ? { slug: node.slug } : {}),
      ...(node.folderPath ? { folderPath: node.folderPath } : {}),
    })),
    edges: result.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      relation: edge.relation,
      direction: edge.direction,
      weight: edge.weight,
      origin: edge.origin,
      ...(edge.reads ? { reads: edge.reads } : {}),
      ...(edge.conversations ? { conversations: edge.conversations } : {}),
    })),
    traversal: result.traversal,
  };
}
