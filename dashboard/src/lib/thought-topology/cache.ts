import { stableHashText, THOUGHT_TOPOLOGY_SCORING } from "./scoring.ts";
import { EDGE_EXPLANATION_PROMPT_VERSION, NODE_SUMMARY_PROMPT_VERSION, TOPOLOGY_EMBEDDING_MODEL } from "./projection.ts";

export interface TopologyCacheVersions {
  embeddingModel: string;
  projectionVersion: string;
  nodePromptVersion: string;
  edgePromptVersion: string;
  summaryModel: string;
  scoringVersion: string;
}

export const DEFAULT_TOPOLOGY_CACHE_VERSIONS: TopologyCacheVersions = Object.freeze({
  embeddingModel: TOPOLOGY_EMBEDDING_MODEL,
  projectionVersion: THOUGHT_TOPOLOGY_SCORING.projectionVersion,
  nodePromptVersion: NODE_SUMMARY_PROMPT_VERSION,
  edgePromptVersion: EDGE_EXPLANATION_PROMPT_VERSION,
  summaryModel: "default",
  scoringVersion: THOUGHT_TOPOLOGY_SCORING.version,
});

export function nodeCacheHashes(
  contentHash: string,
  versions: TopologyCacheVersions = DEFAULT_TOPOLOGY_CACHE_VERSIONS,
): { embeddingHash: string; summaryHash: string } {
  return {
    embeddingHash: stableHashText("embedding", contentHash, versions.embeddingModel, versions.projectionVersion),
    summaryHash: stableHashText("summary", contentHash, versions.summaryModel, versions.nodePromptVersion),
  };
}

export function topologyPairHash(
  leftEmbeddingHash: string,
  rightEmbeddingHash: string,
  versions: TopologyCacheVersions = DEFAULT_TOPOLOGY_CACHE_VERSIONS,
): string {
  const sorted = [leftEmbeddingHash, rightEmbeddingHash].sort();
  return stableHashText("pair", sorted[0], sorted[1], versions.scoringVersion);
}

export function edgeExplanationHash(
  pairHash: string,
  evidence: unknown,
  versions: TopologyCacheVersions = DEFAULT_TOPOLOGY_CACHE_VERSIONS,
): string {
  return stableHashText("edge-explanation", pairHash, JSON.stringify(evidence), versions.summaryModel, versions.edgePromptVersion);
}
