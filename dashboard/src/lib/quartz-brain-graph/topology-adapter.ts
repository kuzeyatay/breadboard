import type {
  BrainEdge,
  BrainGraphResponse,
  BrainNode,
} from "../profile/brain-graph-types.ts";
import { detectTopics } from "./topics.ts";

export interface TopologyPayload {
  sourceHierarchy?: Array<{ id: string; source: string; target: string }>;
  sourceConnectionCount?: number;
  isPagePath?: boolean;
  garden: {
    id: number;
    slug: string;
    title: string;
    summary: { state: string; text: string };
  };
  folders: Array<{
    id: string;
    path: string;
    parentId: string | null;
    title: string;
    depth: number;
    gardenTone?: number;
    nodeCount: number;
    summary: { state: string; text: string };
    pageSlug?: string;
    x?: number;
    y?: number;
  }>;
  nodes: Array<{
    id: string;
    slug: string;
    relPath: string;
    folderId: string;
    title: string;
    kind?: "markdown" | "source" | "internal-concept" | "chat";
    knowledgeType: string;
    sourceType?: string;
    summary: { state: string; text: string };
    primaryConcepts: string[];
    supportingConcepts: string[];
    wordCount?: number;
    activityTimes?: number[];
    /** Leiden topic group; the renderer colors pages by `index`. */
    topic?: { index: number; label: string };
    x?: number;
    y?: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    structural?: boolean;
    changedAt?: number;
    origin?: "inferred" | "authored" | "provenance";
    score?: number;
    threshold?: number;
    relationType?: string;
    direction?: "directed" | "undirected";
    explanation?: { state: string; text: string };
    evidence?: Array<{ kind: string; label: string }>;
  }>;
  build: {
    state: string;
    threshold: number;
    retrievalMode: string;
  };
}

export interface QuartzTopologyProjection {
  payload: TopologyPayload;
  hrefByNodeId: ReadonlyMap<string, string>;
  gardenCount: number;
}

const STRUCTURAL_RELATIONS = new Set(["belongs_to", "contains", "owns"]);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function concepts(node: BrainNode): string[] {
  const value = text(node.metadata?.primaryConcepts);
  if (!value) return [];
  return value
    .split(/\s*[·,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function summary(node: BrainNode) {
  return {
    state: "ready",
    text: node.subtitle?.trim() || `${node.label} in ${node.gardenSlug ?? "this garden"}.`,
  };
}

function edgeScore(edge: BrainEdge): number {
  const value = edge.confidence ?? edge.weight ?? 0.68;
  return Math.max(0, Math.min(1, value));
}

/**
 * Rebuild the authorized Garden hierarchy in the renderer's native payload.
 *
 * The Knowledge graph holds Gardens only — Quartz's Thought Topology
 * deliberately describes Gardens — so this keeps Garden/folder/page nodes,
 * the viewer's chats beside the pages they cited, and their semantic lines.
 */
export function projectBrainGraphToQuartzTopology(
  graph: BrainGraphResponse,
): QuartzTopologyProjection {
  const gardenNodes = graph.nodes
    .filter((node) => node.kind === "garden" && node.gardenSlug)
    .sort((left, right) => left.label.localeCompare(right.label));
  const gardenIds = new Set(gardenNodes.map((node) => node.id));
  const gardenSlugs = new Set(gardenNodes.map((node) => node.gardenSlug!));
  const folderNodes = graph.nodes.filter(
    (node) => node.kind === "folder" && node.gardenSlug && gardenSlugs.has(node.gardenSlug),
  );
  const folderIds = new Set(folderNodes.map((node) => node.id));
  const pageNodes = graph.nodes.filter(
    (node) =>
      node.kind !== "garden" &&
      node.kind !== "folder" &&
      Boolean(node.gardenSlug) &&
      gardenSlugs.has(node.gardenSlug!),
  );
  const pageIds = new Set(pageNodes.map((node) => node.id));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const hrefByNodeId = new Map<string, string>();

  for (const node of [...gardenNodes, ...folderNodes, ...pageNodes]) {
    if (node.href) hrefByNodeId.set(node.id, node.href);
  }

  const incomingStructural = new Map<string, BrainEdge>();
  for (const edge of graph.edges) {
    if (!STRUCTURAL_RELATIONS.has(edge.relation) || incomingStructural.has(edge.target)) continue;
    if (!gardenIds.has(edge.source) && !folderIds.has(edge.source)) continue;
    incomingStructural.set(edge.target, edge);
  }

  const rootId = "profile-thought-topology:root";
  const folders: TopologyPayload["folders"] = [{
    id: rootId,
    path: "",
    parentId: null,
    title: "Garden root",
    depth: 0,
    nodeCount: pageNodes.length,
    summary: {
      state: graph.warnings.length > 0 ? "degraded" : "ready",
      text: `${gardenNodes.length} accessible ${gardenNodes.length === 1 ? "garden" : "gardens"}.`,
    },
  }];

  const gardenTones = new Map([...gardenIds].sort().map((id, i) => [id, i % 8]));
  for (const garden of gardenNodes) {
    const directCount = pageNodes.filter((node) => node.gardenSlug === garden.gardenSlug).length;
    folders.push({
      id: garden.id,
      path: garden.gardenSlug!,
      parentId: rootId,
      title: garden.label,
      depth: 1,
      gardenTone: gardenTones.get(garden.id),
      nodeCount: directCount,
      summary: summary(garden),
      pageSlug: garden.gardenSlug,
    });
  }

  const folderDepth = new Map(gardenNodes.map((node) => [node.id, 1]));
  for (const folder of [...folderNodes].sort((left, right) =>
    (finiteNumber(left.metadata?.folderDepth) ?? 0) -
      (finiteNumber(right.metadata?.folderDepth) ?? 0) ||
    left.label.localeCompare(right.label),
  )) {
    const fallbackGarden = gardenNodes.find((node) => node.gardenSlug === folder.gardenSlug);
    if (!fallbackGarden) continue;
    const parentCandidate = incomingStructural.get(folder.id)?.source;
    const parentId = parentCandidate && (gardenIds.has(parentCandidate) || folderIds.has(parentCandidate))
      ? parentCandidate
      : fallbackGarden.id;
    const depth = (folderDepth.get(parentId) ?? 1) + 1;
    folderDepth.set(folder.id, depth);
    folders.push({
      id: folder.id,
      path: [folder.gardenSlug, text(folder.metadata?.folderPath) ?? folder.label]
        .filter(Boolean)
        .join("/"),
      parentId,
      title: folder.label,
      depth,
      nodeCount: finiteNumber(folder.metrics?.activity) ?? 0,
      summary: summary(folder),
      pageSlug: folder.href ? folder.id : undefined,
    });
  }

  const nodes: TopologyPayload["nodes"] = pageNodes.map((node) => {
    const fallbackGarden = gardenNodes.find((garden) => garden.gardenSlug === node.gardenSlug)!;
    const parentCandidate = incomingStructural.get(node.id)?.source;
    const folderId = parentCandidate && (folderIds.has(parentCandidate) || gardenIds.has(parentCandidate))
      ? parentCandidate
      : fallbackGarden.id;
    const kind = node.kind === "source"
      ? "source"
      : node.kind === "concept"
        ? "internal-concept"
        : node.kind === "conversation"
          ? "chat"
          : "markdown";
    return {
      id: node.id,
      slug: node.id,
      relPath: node.label,
      folderId,
      title: node.label,
      kind,
      knowledgeType: text(node.metadata?.knowledgeType) ?? node.kind,
      sourceType: text(node.metadata?.sourceType),
      summary: summary(node),
      primaryConcepts: concepts(node),
      supportingConcepts: [],
      activityTimes: node.activityTimes,
      wordCount: finiteNumber(node.metrics?.wordCount) ?? finiteNumber(node.metrics?.activity) ?? 0,
    };
  });

  const mapIds = new Set([...gardenIds, ...folderIds, ...pageIds]);
  const sourceHierarchy = graph.edges
    .filter(edge => edge.relation === "contains" && !edge.semanticRelation && mapIds.has(edge.source) && mapIds.has(edge.target))
    .map(({ id, source, target }) => ({ id, source, target }));

  const edges: TopologyPayload["edges"] = graph.edges
    .filter(
      (edge) =>
        mapIds.has(edge.source) &&
        mapIds.has(edge.target) &&
        (edge.relation !== "contains" || Boolean(edge.semanticRelation)),
    )
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      origin: edge.explicit ? "authored" : "inferred",
      score: edgeScore(edge),
      changedAt: edge.changedAt,
      threshold: finiteNumber(edge.threshold) ?? 0.68,
      relationType: edge.semanticRelation ?? edge.relation.replaceAll("_", "-"),
      direction: edge.direction === "directed" ? "directed" as const : "undirected" as const,
      explanation: {
        state: edge.explanation ? "ready" : "degraded",
        text: edge.explanation ?? "",
      },
      evidence: (edge.evidence ?? []).map((label) => ({ kind: "claim", label })),
    }));

  // Chats sit beside the pages they cited; topics describe the pages alone.
  const topics = detectTopics(
    nodes
      .filter((node) => node.kind !== "chat")
      .map((node) => ({ id: node.id, title: node.title, concepts: node.primaryConcepts })),
    graph.edges.filter(edge => pageIds.has(edge.source) && pageIds.has(edge.target) && !STRUCTURAL_RELATIONS.has(edge.relation))
      .map(edge => ({ source: edge.source, target: edge.target, weight: edgeScore(edge) })),
  );
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  for (const topic of topics) {
    for (const id of topic.memberIds) {
      nodes[nodeIndex.get(id)!].topic = { index: topic.index, label: topic.label };
    }
  }

  const organizationId = graph.scope.kind === "organization" ? graph.scope.organizationId : null;
  const scopeLabel = organizationId
    ? `${graph.scopeOptions.find((option) => option.organizationId === organizationId)?.label ?? "Organization"} gardens`
    : "Knowledge";

  return {
    payload: {
      garden: {
        id: 0,
        slug: `profile-${graph.layoutKey.replace(/[^a-z0-9-]+/gi, "-").toLowerCase()}`,
        title: scopeLabel,
        summary: {
          state: graph.warnings.length > 0 ? "degraded" : "ready",
          text: `${scopeLabel} contains ${gardenNodes.length} ${gardenNodes.length === 1 ? "garden" : "gardens"} and ${nodes.length} ${nodes.length === 1 ? "page" : "pages"}.`,
        },
      },
      folders,
      nodes,
      edges,
      sourceHierarchy,
      sourceConnectionCount: sourceHierarchy.length + edges.length,
      build: {
        state: graph.warnings.length > 0 ? "degraded" : "ready",
        threshold: 0.68,
        retrievalMode: "semantic-vector",
      },
    },
    hrefByNodeId,
    gardenCount: gardenNodes.length,
  };
}

/**
 * The payload narrowed to `keepIds` (a topic, or a path): those pages, the
 * lines between them, and only the folders that lead down to them, so the
 * renderer does not draw every empty Garden and folder around a small view.
 */
export function filterTopologyPayload(
  payload: TopologyPayload,
  keepIds: ReadonlySet<string>,
): TopologyPayload {
  const nodes = payload.nodes.filter((node) => keepIds.has(node.id));
  const folderById = new Map(payload.folders.map((folder) => [folder.id, folder]));
  const keptFolders = new Set<string>();
  for (const node of nodes) {
    for (let id: string | null = node.folderId; id && !keptFolders.has(id); id = folderById.get(id)?.parentId ?? null) {
      keptFolders.add(id);
    }
  }
  return {
    ...payload,
    folders: payload.folders.filter((folder) => keptFolders.has(folder.id)),
    nodes,
    edges: payload.edges.filter((edge) => keepIds.has(edge.source) && keepIds.has(edge.target)),
  };
}

/** Fewest-step chain of connections from `from` to `to`, or null when none. */
export function shortestTopologyPath(
  edges: TopologyPayload["edges"],
  from: string,
  to: string,
): string[] | null {
  if (from === to) return [from];
  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const edge of edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  const previous = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of neighbors.get(queue[index]) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, queue[index]);
      if (next === to) {
        const path = [to];
        while (path[0] !== from) path.unshift(previous.get(path[0])!);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}
