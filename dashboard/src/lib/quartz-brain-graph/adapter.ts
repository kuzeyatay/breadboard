import type { BrainGraphResponse } from "../profile/brain-graph-types.ts";
import type { QuartzBrainGraph } from "./types.ts";

export function adaptBrainGraph(response: BrainGraphResponse): QuartzBrainGraph {
  return {
    nodes: response.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      href: node.href,
      cluster:
        node.organizationId ?? node.gardenId ?? node.gardenSlug ?? node.kind,
      weight: Math.max(
        0.2,
        node.metrics?.importance ?? Math.min(1, (node.metrics?.degree ?? 0) / 12),
      ),
      metadata: node,
    })),
    links: response.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.relation,
      origin: edge.origin,
      explicit: edge.explicit,
      weight: Math.max(
        0.1,
        edge.weight ?? edge.confidence ?? (edge.explicit ? 1 : 0.55),
      ),
      metadata: edge,
    })),
  };
}
