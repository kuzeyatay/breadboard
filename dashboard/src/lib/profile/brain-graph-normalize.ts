import type {
  BrainEdge,
  BrainGraphFragment,
  BrainGraphLimits,
  BrainGraphResponse,
  BrainNode,
  BrainNodeKind,
  OptionalBrainNodeKind,
} from "./brain-graph-types.ts";

const NODE_KINDS = new Set<BrainNodeKind | OptionalBrainNodeKind>([
  "user",
  "organization",
  "person",
  "member",
  "agent",
  "garden",
  "source",
  "page",
  "concept",
  "project",
  "memory",
  "conversation",
  "artifact",
  "buzz_channel",
  "buzz_thread",
  "buzz_canvas",
  "workflow",
  "repository",
  "task",
  "schedule",
  "calendar_event",
  "agent_run",
]);

const SAFE_ROUTES = [
  "/profile",
  "/dashboard",
  "/gardens",
  "/garden",
  "/artifacts",
  "/buzz",
  "/review",
  "/plan",
];

export function safeBrainHref(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  if (/[\u0000-\u001f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value, "https://breadboard.invalid");
    if (url.origin !== "https://breadboard.invalid") return undefined;
    return SAFE_ROUTES.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    )
      ? `${url.pathname}${url.search}${url.hash}`
      : undefined;
  } catch {
    return undefined;
  }
}

function validNode(node: BrainNode): boolean {
  return (
    typeof node.id === "string" &&
    node.id.length > 0 &&
    node.id.length <= 320 &&
    typeof node.label === "string" &&
    node.label.trim().length > 0 &&
    node.label.length <= 240 &&
    NODE_KINDS.has(node.kind)
  );
}

function recencyScore(value: string | undefined, now = Date.now()): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now - timestamp) / 86_400_000);
  return Math.exp(-days / 120);
}

function nodeImportance(node: BrainNode, degree: number): number {
  const anchor =
    node.kind === "user"
      ? 1
      : node.kind === "organization" || node.kind === "garden"
        ? 0.82
        : node.kind === "artifact" || node.kind === "memory"
          ? 0.3
          : 0;
  const degreeScore = Math.min(1, Math.log2(degree + 1) / 6);
  const recent = recencyScore(node.updatedAt ?? node.createdAt);
  const activity = Math.min(1, Math.max(0, Number(node.metrics?.activity ?? 0)) / 20);
  // Deterministic overview score: anchors 45%, explicit degree 30%, recency
  // 15%, and recorded activity 10%. No model or content similarity is used.
  return Math.min(1, anchor * 0.45 + degreeScore * 0.3 + recent * 0.15 + activity * 0.1);
}

function mergeNode(left: BrainNode, right: BrainNode): BrainNode {
  const leftImportance = left.metrics?.importance ?? 0;
  const rightImportance = right.metrics?.importance ?? 0;
  const preferred = rightImportance > leftImportance ? right : left;
  return {
    ...left,
    ...preferred,
    href: safeBrainHref(preferred.href ?? left.href),
    origins: [...new Set([...left.origins, ...right.origins])],
    expandable: left.expandable || right.expandable,
    metrics: { ...left.metrics, ...right.metrics },
    metadata: { ...left.metadata, ...right.metadata },
  };
}

function edgeKey(edge: BrainEdge): string {
  return `${edge.source}\0${edge.target}\0${edge.relation}\0${edge.origin}`;
}

function mergeEdge(left: BrainEdge, right: BrainEdge): BrainEdge {
  return {
    ...left,
    ...right,
    explicit: left.explicit || right.explicit,
    weight: Math.max(left.weight ?? 0, right.weight ?? 0) || undefined,
    confidence: Math.max(left.confidence ?? 0, right.confidence ?? 0) || undefined,
  };
}

export interface NormalizedBrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  counts: Record<string, number>;
  truncated: boolean;
}

export function normalizeBrainGraph(
  fragments: readonly BrainGraphFragment[],
  limits: Pick<BrainGraphLimits, "maxNodes" | "maxEdges">,
): NormalizedBrainGraph {
  const nodesById = new Map<string, BrainNode>();
  for (const fragment of fragments) {
    for (const rawNode of fragment.nodes) {
      if (!validNode(rawNode)) continue;
      const node = {
        ...rawNode,
        label: rawNode.label.trim().slice(0, 240),
        href: safeBrainHref(rawNode.href),
        origins: [...new Set(rawNode.origins)],
      };
      const current = nodesById.get(node.id);
      nodesById.set(node.id, current ? mergeNode(current, node) : node);
    }
  }

  const edgesByKey = new Map<string, BrainEdge>();
  for (const fragment of fragments) {
    for (const edge of fragment.edges) {
      if (
        !edge.id ||
        edge.source === edge.target ||
        !nodesById.has(edge.source) ||
        !nodesById.has(edge.target)
      ) {
        continue;
      }
      const key = edgeKey(edge);
      const current = edgesByKey.get(key);
      edgesByKey.set(key, current ? mergeEdge(current, edge) : edge);
    }
  }

  const degree = new Map<string, number>();
  for (const edge of edgesByKey.values()) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  for (const [id, node] of nodesById) {
    const nodeDegree = degree.get(id) ?? 0;
    nodesById.set(id, {
      ...node,
      metrics: {
        ...node.metrics,
        degree: nodeDegree,
        importance: nodeImportance(node, nodeDegree),
      },
    });
  }

  let truncated = fragments.some((fragment) => fragment.truncated === true);
  let nodes = [...nodesById.values()];
  if (nodes.length > limits.maxNodes) {
    truncated = true;
    nodes = nodes
      .sort(
        (left, right) =>
          (right.metrics?.importance ?? 0) - (left.metrics?.importance ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limits.maxNodes);
  }
  nodes.sort((left, right) => left.id.localeCompare(right.id));

  const visibleIds = new Set(nodes.map((node) => node.id));
  let edges = [...edgesByKey.values()].filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );
  if (edges.length > limits.maxEdges) {
    truncated = true;
    edges = edges
      .sort(
        (left, right) =>
          Number(right.explicit) - Number(left.explicit) ||
          (right.weight ?? 1) - (left.weight ?? 1) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limits.maxEdges);
  }
  edges.sort((left, right) => left.id.localeCompare(right.id));

  const counts: Record<string, number> = {};
  for (const node of nodes) counts[node.kind] = (counts[node.kind] ?? 0) + 1;
  counts.total = nodes.length;
  counts.edges = edges.length;

  return { nodes, edges, counts, truncated };
}

export function mergeBrainGraphResponse(
  current: BrainGraphResponse,
  fragment: BrainGraphResponse,
): BrainGraphResponse {
  const normalized = normalizeBrainGraph(
    [
      { nodes: current.nodes, edges: current.edges },
      { nodes: fragment.nodes, edges: fragment.edges },
    ],
    { maxNodes: 2_000, maxEdges: 5_000 },
  );
  return {
    ...current,
    revision: fragment.revision,
    nodes: normalized.nodes,
    edges: normalized.edges,
    counts: normalized.counts,
    truncated: current.truncated || fragment.truncated || normalized.truncated,
    warnings: [...current.warnings, ...fragment.warnings].filter(
      (warning, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.source === warning.source && candidate.code === warning.code,
        ) === index,
    ),
  };
}
