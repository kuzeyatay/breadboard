import { renderThoughtTopology as renderGeneratedThoughtTopology } from "./renderer.generated.js";

import type { TopologyPayload } from "@/lib/quartz-brain-graph/topology-adapter.ts";

export interface D3Config {
  mode: "links" | "thought-topology";
  drag: boolean;
  zoom: boolean;
  depth: number;
  scope: "folder" | "garden" | "all";
  clickToNavigate: boolean;
  scale: number;
  repelForce: number;
  centerForce: number;
  linkDistance: number;
  fontSize: number;
  opacityScale: number;
  removeTags: string[];
  showTags: boolean;
  focusOnHover: boolean;
  enableRadial: boolean;
}

export type FullSlug = string & { readonly __brand: "full" };

export interface ThoughtTopologyRenderContext {
  scopeCluster: string;
  scopeFolderPath: string | null;
  configuredDepth: number;
  onNavigate?: (nodeId: string, targetSlug: string) => void;
  onInvestigate?: (request: {
    nodeSlug: string;
    nodeTitle: string;
    prompt: string;
  }) => void;
}

type RenderThoughtTopology = (
  container: HTMLElement,
  currentSlug: FullSlug,
  config: D3Config,
  payload: TopologyPayload,
  context: ThoughtTopologyRenderContext,
) => Promise<() => void>;

// The generated module is a browser bundle of the canonical Quartz source.
// This typed boundary keeps the dashboard build independent of Quartz's
// workspace location without maintaining a second renderer implementation.
export const renderThoughtTopology = renderGeneratedThoughtTopology as RenderThoughtTopology;
