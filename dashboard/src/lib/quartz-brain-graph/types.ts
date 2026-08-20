import type {
  BrainEdge,
  BrainEdgeOrigin,
  BrainNode,
  BrainNodeKind,
  BrainRelation,
  OptionalBrainNodeKind,
} from "../profile/brain-graph-types.ts";

export interface QuartzBrainNode {
  id: string;
  label: string;
  kind: BrainNodeKind | OptionalBrainNodeKind;
  href?: string;
  cluster?: string;
  weight: number;
  visited?: boolean;
  metadata: BrainNode;
}

export interface QuartzBrainLink {
  id: string;
  source: string;
  target: string;
  relation: BrainRelation;
  origin: BrainEdgeOrigin;
  explicit: boolean;
  weight: number;
  metadata: BrainEdge;
}

export interface QuartzBrainGraph {
  nodes: QuartzBrainNode[];
  links: QuartzBrainLink[];
}

export interface QuartzBrainRendererOptions {
  layoutStorageKey: string;
  selectedNodeIds?: ReadonlySet<string>;
  selectedEdgeIds?: ReadonlySet<string>;
  evidenceNodeIds?: ReadonlySet<string>;
  evidenceEdgeIds?: ReadonlySet<string>;
  visibleNodeIds?: ReadonlySet<string>;
  onSelect?: (nodeId: string, additive: boolean) => void;
  onSelectEdge?: (edgeId: string) => void;
  onOpen?: (nodeId: string, href?: string) => void;
  onHover?: (nodeId: string | null) => void;
  onFailure?: (reason: "webgl" | "context-lost" | "initialization") => void;
  onSettled?: (settleMs: number) => void;
}

export interface QuartzBrainRendererController {
  updateGraph(graph: QuartzBrainGraph, selectedParentId?: string): void;
  updateOptions(options: Partial<QuartzBrainRendererOptions>): void;
  setSearch(query: string): void;
  focusNode(nodeId: string): void;
  fitToView(): void;
  zoomBy(factor: number): void;
  resetLayout(): void;
  destroy(): void;
}
