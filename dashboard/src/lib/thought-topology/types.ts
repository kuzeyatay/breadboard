export const THOUGHT_TOPOLOGY_SCHEMA_VERSION = 1;

export type EnrichmentState = "ready" | "pending" | "degraded" | "failed";

export interface EnrichmentText {
  state: EnrichmentState;
  text: string;
  model?: string;
  promptVersion?: string;
  generatedAt?: string;
}

export interface TopologyEvidence {
  kind: "concept" | "lexical" | "claim" | "heading" | "authored";
  label: string;
  sourceNodeId?: string;
}

export interface TopologyFolder {
  id: string;
  path: string;
  parentId: string | null;
  title: string;
  depth: number;
  nodeCount: number;
  summary: EnrichmentText;
  pageSlug?: string;
  x?: number;
  y?: number;
}

export interface TopologyNode {
  id: string;
  slug: string;
  relPath: string;
  folderId: string;
  title: string;
  kind: "markdown" | "source" | "internal-concept";
  knowledgeType: string;
  contentHash: string;
  summary: EnrichmentText;
  primaryConcepts: string[];
  supportingConcepts: string[];
  claimIds: string[];
  wordCount: number;
  x?: number;
  y?: number;
}

export type TopologyEdgeOrigin = "inferred" | "authored" | "provenance";
export type TopologyEdgeDirection =
  | "undirected"
  | "source-to-target"
  | "target-to-source";

export const TOPOLOGY_RELATION_TYPES = [
  "depends-on",
  "derives-from",
  "applies-to",
  "extends",
  "contrasts-with",
  "example-of",
  "part-of",
  "shares-mechanism",
  "measured-by",
  "related",
] as const;

export type TopologyRelationType = (typeof TOPOLOGY_RELATION_TYPES)[number];

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  origin: TopologyEdgeOrigin;
  score: number;
  previousScore?: number;
  threshold?: number;
  components: {
    embedding: number;
    concept: number;
    lexical: number;
  };
  relationType: TopologyRelationType;
  direction: TopologyEdgeDirection;
  explanation: EnrichmentText;
  evidence: TopologyEvidence[];
  pairHash: string;
  visual: {
    width: number;
    opacity: number;
    distance: number;
    strength: number;
  };
}

export interface ThoughtTopology {
  schemaVersion: number;
  scoringVersion: string;
  sourceRevision: string;
  garden: {
    id: number;
    slug: string;
    title: string;
    summary: EnrichmentText;
  };
  folders: TopologyFolder[];
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  build: {
    state: "ready" | "building" | "degraded" | "failed";
    generatedAt: string;
    embeddingModel: string;
    embeddingDimension: number;
    summaryModel: string;
    nodePromptVersion: string;
    edgePromptVersion: string;
    retrievalMode: "semantic-vector" | "concept-lexical";
    threshold: number;
  };
}

export interface ThoughtTopologyCacheNode {
  id: string;
  folderId: string;
  contentHash: string;
  embeddingHash: string;
  summaryHash: string;
  semanticText: string;
  lexicalText: string;
  embeddingModel: string;
  embeddingDimension: number;
  embedding: number[] | null;
  summary: EnrichmentText;
  x?: number;
  y?: number;
}

export interface ThoughtTopologyCacheEdge {
  pairHash: string;
  explanationHash: string;
  explanation: EnrichmentText;
  relationType: TopologyRelationType;
  direction: TopologyEdgeDirection;
  score: number;
}

export interface ThoughtTopologyCache {
  schemaVersion: number;
  sourceRevision: string;
  scoringVersion: string;
  nodes: Record<string, ThoughtTopologyCacheNode>;
  edges: Record<string, ThoughtTopologyCacheEdge>;
}

export type ThoughtTopologyApiResponse =
  | { enabled: false; mode: "links" }
  | {
      enabled: true;
      mode: "thought-topology";
      topology: ThoughtTopology;
      stale?: boolean;
      status?: {
        state: "building" | "failed" | "stale";
        message: string;
      };
    };
