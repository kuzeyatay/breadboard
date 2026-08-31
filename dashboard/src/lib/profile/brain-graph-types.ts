export type BrainNodeKind =
  | "user"
  | "organization"
  | "person"
  | "member"
  | "agent"
  | "garden"
  | "folder"
  | "source"
  | "page"
  | "concept"
  | "project"
  | "memory"
  | "conversation"
  | "artifact"
  | "buzz_channel"
  | "buzz_thread";

export type OptionalBrainNodeKind =
  | "buzz_canvas"
  | "workflow"
  | "repository"
  | "task"
  | "schedule"
  | "calendar_event"
  | "agent_run";

export type BrainRelation =
  | "owns"
  | "member_of"
  | "contains"
  | "derived_from"
  | "links_to"
  | "mentions"
  | "about"
  | "produced"
  | "created_in"
  | "supports"
  | "shared_with"
  | "discussed_in"
  | "participated_in"
  | "authored"
  | "replied_to"
  | "attached_to"
  | "generated_by"
  | "related_to"
  | "belongs_to"
  | "references"
  | "scheduled_by";

export type BrainEdgeOrigin =
  | "canonical"
  | "conversation"
  | "memory"
  | "artifact"
  | "organization"
  | "buzz"
  | "agent"
  | "thought-topology"
  | "gbrain-derived";

export type BrainScope =
  | { kind: "personal" }
  | { kind: "all" }
  | { kind: "organization"; organizationId: string };

export interface BrainNode {
  id: string;
  kind: BrainNodeKind | OptionalBrainNodeKind;
  label: string;
  subtitle?: string;
  href?: string;
  origins: BrainEdgeOrigin[];
  organizationId?: string;
  gardenId?: string;
  gardenSlug?: string;
  createdAt?: string;
  updatedAt?: string;
  expandable: boolean;
  metrics?: {
    degree?: number;
    wordCount?: number;
    activity?: number;
    importance?: number;
  };
  metadata?: Record<string, string | number | boolean | null>;
}

export interface BrainEdge {
  id: string;
  source: string;
  target: string;
  relation: BrainRelation;
  origin: BrainEdgeOrigin;
  explicit: boolean;
  confidence?: number;
  createdAt?: string;
  weight?: number;
  organizationId?: string;
  gardenId?: string;
  semanticRelation?: string;
  direction?: string;
  explanation?: string;
  evidence?: string[];
}

export interface BrainWarning {
  source: string;
  code: string;
  message: string;
}

export interface BrainScopeOption {
  id: string;
  kind: "personal" | "all" | "organization";
  label: string;
  organizationId?: string;
}

export interface BrainGraphDiagnostics {
  buildMs: number;
  adapterMs: Record<string, number>;
  overviewNodeCount: number;
  overviewEdgeCount: number;
  truncated: boolean;
}

export interface BrainGraphResponse {
  revision: string;
  layoutKey: string;
  generatedAt: string;
  scope: BrainScope;
  nodes: BrainNode[];
  edges: BrainEdge[];
  counts: Record<string, number>;
  truncated: boolean;
  warnings: BrainWarning[];
  scopeOptions: BrainScopeOption[];
  capabilities: {
    buzz: boolean;
    thoughtTopology: boolean;
    organization: boolean;
    expansion: boolean;
    pathFinding: boolean;
  };
  diagnostics: BrainGraphDiagnostics;
}

export interface BrainGraphFragment {
  nodes: BrainNode[];
  edges: BrainEdge[];
  warnings?: BrainWarning[];
  truncated?: boolean;
}

export interface BrainGraphLimits {
  maxNodes: number;
  maxEdges: number;
  maxGardens: number;
  maxKnowledgeNodesPerGarden: number;
  maxConversations: number;
  maxMemories: number;
  maxArtifacts: number;
  maxBuzzRooms: number;
  maxBuzzThreadsPerRoom: number;
}

export interface BrainGraphSourceAdapter<TContext> {
  readonly name: string;
  buildOverview(
    context: TContext,
    scope: BrainScope,
    limits: BrainGraphLimits,
    signal?: AbortSignal,
  ): Promise<BrainGraphFragment> | BrainGraphFragment;
  expand?(
    context: TContext,
    scope: BrainScope,
    nodeId: string,
    depth: number,
    limits: BrainGraphLimits,
    signal?: AbortSignal,
  ): Promise<BrainGraphFragment> | BrainGraphFragment;
}

export const DEFAULT_BRAIN_GRAPH_LIMITS: BrainGraphLimits = {
  maxNodes: 1_500,
  maxEdges: 3_500,
  maxGardens: 100,
  maxKnowledgeNodesPerGarden: 450,
  maxConversations: 160,
  maxMemories: 300,
  maxArtifacts: 300,
  maxBuzzRooms: 120,
  maxBuzzThreadsPerRoom: 40,
};
