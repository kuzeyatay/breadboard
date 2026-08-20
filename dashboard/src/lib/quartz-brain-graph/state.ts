import type { QuartzBrainGraph } from "./types.ts";

export interface QuartzFocusState {
  activeNodes: Set<string>;
  activeLinks: Set<string>;
}

export function quartzFocusState(
  graph: QuartzBrainGraph,
  nodeId: string | null,
): QuartzFocusState {
  const activeNodes = new Set<string>();
  const activeLinks = new Set<string>();
  if (!nodeId) return { activeNodes, activeLinks };
  activeNodes.add(nodeId);
  for (const link of graph.links) {
    if (link.source === nodeId || link.target === nodeId) {
      activeLinks.add(link.id);
      activeNodes.add(link.source);
      activeNodes.add(link.target);
    }
  }
  return { activeNodes, activeLinks };
}

export function quartzLabelAlpha(
  zoom: number,
  options: { hovered?: boolean; selected?: boolean; searchMatch?: boolean } = {},
): number {
  if (options.hovered || options.selected || options.searchMatch) return 1;
  // Keep a restrained baseline at fit-to-view scale. The old zero-alpha
  // default made every label vanish until the graph was zoomed a long way in.
  return Math.min(0.92, Math.max(0.16, (zoom - 0.45) / 1.45));
}

export function quartzLayoutStorageKey(
  layoutKey: string,
  revision: string,
  scopeKey: string,
): string {
  return `breadboard:brain-layout:${layoutKey}:${scopeKey}:${revision}`;
}

export function graphSearchMatches(
  graph: QuartzBrainGraph,
  query: string,
): Set<string> {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return new Set();
  return new Set(
    graph.nodes
      .filter((node) =>
        [node.label, node.kind, node.metadata.subtitle, node.metadata.gardenSlug]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalized),
      )
      .map((node) => node.id),
  );
}
