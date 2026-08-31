import type {
  ThoughtTopology,
  TopologyEdgeDirection,
  TopologyEdgeOrigin,
} from "../thought-topology/types.ts";

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
  origin: TopologyEdgeOrigin | "structure";
  explanation: string;
  evidence: Array<{ kind: string; label: string; sourceNodeId?: string }>;
  visualWidth: number;
  provenance: {
    artifact: "thought-topology";
    sourceRevision: string;
    basis: "folder-structure" | "scored-connection";
  };
}

export interface HermesTopologyGraphQuery {
  start?: unknown;
  depth?: unknown;
  limit?: unknown;
  minWeight?: unknown;
  relationTypes?: unknown;
  includeHierarchy?: unknown;
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
  startNode: HermesTopologyGraphNode | null;
  nodes: HermesTopologyGraphNode[];
  edges: HermesTopologyGraphEdge[];
  traversal: {
    depth: number;
    limit: number;
    minWeight: number;
    relationTypes: string[];
    includeHierarchy: boolean;
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
  const depth = Math.floor(boundedNumber(input.depth, 1, 0, 3));
  const limit = Math.floor(boundedNumber(input.limit, 24, 2, 50));
  const minWeight = boundedNumber(input.minWeight, 0, 0, 1);
  const relationTypes = relationFilter(input.relationTypes);
  const includeHierarchy = input.includeHierarchy !== false;
  const startNode = resolveNode(graph.nodes, topology.garden.slug, input.start);
  const base = {
    format: HERMES_TOPOLOGY_GRAPH_FORMAT,
    sourceRevision: topology.sourceRevision,
    scoringVersion: topology.scoringVersion,
    buildState: topology.build.state,
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
  const adjacent = new Map<string, HermesTopologyGraphEdge[]>();
  for (const edge of eligibleEdges) {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge]);
  }

  const visited = new Set<string>([startNode.id]);
  let frontier = new Set<string>([startNode.id]);
  let truncated = false;
  for (let level = 0; level < depth && frontier.size; level += 1) {
    const next = new Set<string>();
    const candidates = [...frontier]
      .flatMap((nodeId) => adjacent.get(nodeId) ?? [])
      .sort(edgeOrder);
    for (const edge of candidates) {
      const neighborIds = [edge.source, edge.target].filter(
        (nodeId) => !visited.has(nodeId),
      );
      for (const nodeId of neighborIds) {
        if (visited.size >= limit) {
          truncated = true;
          break;
        }
        visited.add(nodeId);
        next.add(nodeId);
      }
      if (visited.size >= limit) break;
    }
    frontier = next;
  }

  const maxEdges = Math.min(100, limit * 4);
  const allSelectedEdges = eligibleEdges.filter(
    (edge) => visited.has(edge.source) && visited.has(edge.target),
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
    })),
    traversal: result.traversal,
  };
}
