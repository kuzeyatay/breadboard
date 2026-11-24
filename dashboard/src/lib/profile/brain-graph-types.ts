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
  activityTimes?: number[];
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
  changedAt?: number;
  /** Affinity threshold used to admit this semantic edge. */
  threshold?: number;
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
}

export interface BrainGraphResponse {
  revision: string;
  layoutKey: string;
  generatedAt: string;
  scope: BrainScope;
  nodes: BrainNode[];
  edges: BrainEdge[];
  counts: Record<string, number>;
  warnings: BrainWarning[];
  scopeOptions: BrainScopeOption[];
  capabilities: {
    thoughtTopology: boolean;
    organization: boolean;
  };
  diagnostics: BrainGraphDiagnostics;
}

export interface BrainGraphFragment {
  nodes: BrainNode[];
  edges: BrainEdge[];
  warnings?: BrainWarning[];
}

/** The Knowledge map is never cut off: a source builds every authorized page. */
export interface BrainGraphSourceAdapter<TContext> {
  readonly name: string;
  buildOverview(
    context: TContext,
    scope: BrainScope,
    signal?: AbortSignal,
  ): Promise<BrainGraphFragment> | BrainGraphFragment;
}
