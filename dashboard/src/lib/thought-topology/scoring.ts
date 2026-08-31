import { createHash } from "node:crypto";
import type {
  TopologyEdge,
  TopologyEdgeOrigin,
  TopologyRelationType,
} from "./types.ts";

export const THOUGHT_TOPOLOGY_SCORING = Object.freeze({
  version: "thought-topology-affinity-v1",
  projectionVersion: "semantic-projection-v1",
  weights: Object.freeze({ embedding: 0.7, concept: 0.2, lexical: 0.1 }),
  conceptWeights: Object.freeze({ primary: 1.35, supporting: 1 }),
  threshold: Object.freeze({
    madMultiplier: 2.5,
    madConsistency: 1.4826,
    minimum: 0.62,
    maximum: 0.82,
    smallGardenFallback: 0.68,
    minimumDistributionSize: 8,
  }),
  selection: Object.freeze({
    candidateNeighbors: 12,
    crossFolderCandidates: 4,
    inferredEdgeCap: 6,
  }),
});

export interface ScoringDocument {
  id: string;
  folderId: string;
  primaryConcepts: string[];
  supportingConcepts: string[];
  lexicalText: string;
  embedding?: number[] | null;
}

export interface AffinityCandidate {
  source: string;
  target: string;
  sourceFolderId: string;
  targetFolderId: string;
  score: number;
  components: {
    embedding: number;
    concept: number;
    lexical: number;
  };
}

export interface AuthoredCandidate {
  source: string;
  target: string;
  relationType?: TopologyRelationType;
  origin?: Extract<TopologyEdgeOrigin, "authored" | "provenance">;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "do",
  "for",
  "from",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "not",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "this",
  "to",
  "use",
  "used",
  "using",
  "was",
  "we",
  "were",
  "when",
  "where",
  "which",
  "with",
]);

export function stableHashText(...values: unknown[]): string {
  return createHash("sha256")
    .update(values.map((value) => String(value ?? "")).join("\u0000"))
    .digest("hex");
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator > 0 ? clamp(dot / denominator, -1, 1) : 0;
}

function conceptWeights(
  document: Pick<ScoringDocument, "primaryConcepts" | "supportingConcepts">,
) {
  const weights = new Map<string, number>();
  for (const concept of document.supportingConcepts) {
    if (concept)
      weights.set(concept, THOUGHT_TOPOLOGY_SCORING.conceptWeights.supporting);
  }
  for (const concept of document.primaryConcepts) {
    if (concept)
      weights.set(concept, THOUGHT_TOPOLOGY_SCORING.conceptWeights.primary);
  }
  return weights;
}

export function buildConceptIdf(
  documents: readonly ScoringDocument[],
): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const document of documents) {
    const concepts = new Set([
      ...document.primaryConcepts,
      ...document.supportingConcepts,
    ]);
    for (const concept of concepts)
      frequencies.set(concept, (frequencies.get(concept) ?? 0) + 1);
  }
  const output = new Map<string, number>();
  for (const [concept, frequency] of frequencies) {
    output.set(concept, Math.log((documents.length + 1) / (frequency + 1)) + 1);
  }
  return output;
}

export function idfWeightedConceptJaccard(
  left: Pick<ScoringDocument, "primaryConcepts" | "supportingConcepts">,
  right: Pick<ScoringDocument, "primaryConcepts" | "supportingConcepts">,
  idf: ReadonlyMap<string, number>,
): number {
  const leftWeights = conceptWeights(left);
  const rightWeights = conceptWeights(right);
  const union = new Set([...leftWeights.keys(), ...rightWeights.keys()]);
  let intersectionWeight = 0;
  let unionWeight = 0;
  for (const concept of union) {
    const inverseFrequency = idf.get(concept) ?? 1;
    const leftWeight = leftWeights.get(concept) ?? 0;
    const rightWeight = rightWeights.get(concept) ?? 0;
    intersectionWeight += Math.min(leftWeight, rightWeight) * inverseFrequency;
    unionWeight += Math.max(leftWeight, rightWeight) * inverseFrequency;
  }
  return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

export function lexicalTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .slice(0, 4000);
}

export type SparseVector = Map<string, number>;

export function buildTfidfVectors(
  documents: readonly ScoringDocument[],
): Map<string, SparseVector> {
  const tokenLists = new Map<string, string[]>();
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    const tokens = lexicalTokens(document.lexicalText);
    tokenLists.set(document.id, tokens);
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const vectors = new Map<string, SparseVector>();
  for (const document of documents) {
    const tokens = tokenLists.get(document.id) ?? [];
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    const vector = new Map<string, number>();
    for (const [token, count] of counts) {
      const idf =
        Math.log(
          (documents.length + 1) / ((documentFrequency.get(token) ?? 0) + 1),
        ) + 1;
      vector.set(token, (count / Math.max(1, tokens.length)) * idf);
    }
    vectors.set(document.id, vector);
  }
  return vectors;
}

export function sparseCosine(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): number {
  if (left.size === 0 || right.size === 0) return 0;
  const [small, large] =
    left.size <= right.size ? [left, right] : [right, left];
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [term, value] of small) dot += value * (large.get(term) ?? 0);
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm);
  return denominator > 0 ? Math.max(0, dot / denominator) : 0;
}

export function combinedAffinity(
  components: AffinityCandidate["components"],
  embeddingAvailable = true,
): number {
  const weights = THOUGHT_TOPOLOGY_SCORING.weights;
  if (embeddingAvailable) {
    return (
      weights.embedding * components.embedding +
      weights.concept * components.concept +
      weights.lexical * components.lexical
    );
  }
  const deterministicWeight = weights.concept + weights.lexical;
  return deterministicWeight > 0
    ? (weights.concept * components.concept +
        weights.lexical * components.lexical) /
        deterministicWeight
    : 0;
}

export function scoreAffinityPairs(
  documents: readonly ScoringDocument[],
  embeddingAvailable: boolean,
): AffinityCandidate[] {
  const idf = buildConceptIdf(documents);
  const lexical = buildTfidfVectors(documents);
  const pairs: AffinityCandidate[] = [];
  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < documents.length;
      rightIndex += 1
    ) {
      const left = documents[leftIndex];
      const right = documents[rightIndex];
      const components = {
        embedding: embeddingAvailable
          ? Math.max(
              0,
              cosineSimilarity(left.embedding ?? [], right.embedding ?? []),
            )
          : 0,
        concept: idfWeightedConceptJaccard(left, right, idf),
        lexical: sparseCosine(
          lexical.get(left.id) ?? new Map(),
          lexical.get(right.id) ?? new Map(),
        ),
      };
      pairs.push({
        source: left.id,
        target: right.id,
        sourceFolderId: left.folderId,
        targetFolderId: right.folderId,
        components,
        score: combinedAffinity(components, embeddingAvailable),
      });
    }
  }
  return pairs;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function adaptiveThreshold(scores: readonly number[]): number {
  const config = THOUGHT_TOPOLOGY_SCORING.threshold;
  if (scores.length < config.minimumDistributionSize)
    return config.smallGardenFallback;
  const center = median(scores);
  const deviation = median(scores.map((score) => Math.abs(score - center)));
  return clamp(
    center + config.madMultiplier * config.madConsistency * deviation,
    config.minimum,
    config.maximum,
  );
}

function unorderedPairKey(source: string, target: string): string {
  return source < target
    ? `${source}\u0000${target}`
    : `${target}\u0000${source}`;
}

function candidateNeighborhoods(
  candidates: readonly AffinityCandidate[],
): Map<string, Set<string>> {
  const byNode = new Map<string, AffinityCandidate[]>();
  for (const candidate of candidates) {
    for (const nodeId of [candidate.source, candidate.target]) {
      const list = byNode.get(nodeId) ?? [];
      list.push(candidate);
      byNode.set(nodeId, list);
    }
  }
  const neighborhoods = new Map<string, Set<string>>();
  for (const [nodeId, candidatesForNode] of byNode) {
    const sorted = [...candidatesForNode].sort(
      (left, right) =>
        right.score - left.score ||
        unorderedPairKey(left.source, left.target).localeCompare(
          unorderedPairKey(right.source, right.target),
        ),
    );
    const normal = sorted.slice(
      0,
      THOUGHT_TOPOLOGY_SCORING.selection.candidateNeighbors,
    );
    const crossFolder = sorted
      .filter(
        (candidate) => candidate.sourceFolderId !== candidate.targetFolderId,
      )
      .slice(0, THOUGHT_TOPOLOGY_SCORING.selection.crossFolderCandidates);
    const neighbors = new Set<string>();
    for (const candidate of [...normal, ...crossFolder]) {
      neighbors.add(
        candidate.source === nodeId ? candidate.target : candidate.source,
      );
    }
    neighborhoods.set(nodeId, neighbors);
  }
  return neighborhoods;
}

export function selectSparseInferredEdges(
  candidates: readonly AffinityCandidate[],
  threshold: number,
): AffinityCandidate[] {
  const neighborhoods = candidateNeighborhoods(candidates);
  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.score >= threshold &&
        neighborhoods.get(candidate.source)?.has(candidate.target) &&
        neighborhoods.get(candidate.target)?.has(candidate.source),
    )
    .sort(
      (left, right) =>
        right.score - left.score ||
        unorderedPairKey(left.source, left.target).localeCompare(
          unorderedPairKey(right.source, right.target),
        ),
    );
  const degrees = new Map<string, number>();
  const selected: AffinityCandidate[] = [];
  for (const candidate of eligible) {
    if (
      (degrees.get(candidate.source) ?? 0) >=
        THOUGHT_TOPOLOGY_SCORING.selection.inferredEdgeCap ||
      (degrees.get(candidate.target) ?? 0) >=
        THOUGHT_TOPOLOGY_SCORING.selection.inferredEdgeCap
    )
      continue;
    selected.push(candidate);
    degrees.set(candidate.source, (degrees.get(candidate.source) ?? 0) + 1);
    degrees.set(candidate.target, (degrees.get(candidate.target) ?? 0) + 1);
  }
  return selected;
}

export function mergeAuthoredPairs(
  inferred: readonly AffinityCandidate[],
  authored: readonly AuthoredCandidate[],
  allCandidates: readonly AffinityCandidate[],
): Array<
  AffinityCandidate & {
    origin: TopologyEdgeOrigin;
    relationType: TopologyRelationType;
  }
> {
  const scored = new Map(
    allCandidates.map((candidate) => [
      unorderedPairKey(candidate.source, candidate.target),
      candidate,
    ]),
  );
  const merged = new Map<
    string,
    AffinityCandidate & {
      origin: TopologyEdgeOrigin;
      relationType: TopologyRelationType;
    }
  >();
  for (const candidate of inferred) {
    merged.set(unorderedPairKey(candidate.source, candidate.target), {
      ...candidate,
      origin: "inferred",
      relationType: "related",
    });
  }
  for (const authoredEdge of authored) {
    const key = unorderedPairKey(authoredEdge.source, authoredEdge.target);
    const candidate = scored.get(key) ?? {
      source: authoredEdge.source,
      target: authoredEdge.target,
      sourceFolderId: "",
      targetFolderId: "",
      score: 0,
      components: { embedding: 0, concept: 0, lexical: 0 },
    };
    merged.set(key, {
      ...candidate,
      source: authoredEdge.source,
      target: authoredEdge.target,
      origin: authoredEdge.origin ?? "authored",
      relationType: authoredEdge.relationType ?? "related",
    });
  }
  return [...merged.values()].sort((left, right) =>
    unorderedPairKey(left.source, left.target).localeCompare(
      unorderedPairKey(right.source, right.target),
    ),
  );
}

export function edgeVisualStyle(
  score: number,
  threshold: number,
  origin: TopologyEdgeOrigin,
): TopologyEdge["visual"] {
  if (origin !== "inferred") {
    return { width: 2.2, opacity: 0.68, distance: 125, strength: 0.18 };
  }
  const unit = clamp(
    (score - threshold) / Math.max(0.000001, 1 - threshold),
    0,
    1,
  );
  return {
    width: 0.7 + 6.3 * unit ** 1.2,
    opacity: 0.22 + 0.7 * unit,
    distance: 180 - 100 * unit,
    strength: 0.08 + 0.32 * unit,
  };
}
