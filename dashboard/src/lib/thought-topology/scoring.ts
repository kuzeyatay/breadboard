import { createHash } from "node:crypto";
import type {
  TopologyEdge,
  TopologyEdgeOrigin,
  TopologyRelationType,
} from "./types.ts";

export const THOUGHT_TOPOLOGY_SCORING = Object.freeze({
  // v3: embedding affinity is the cosine of corpus-centred vectors. Raw
  // bge-small cosines of one Garden's pages all sit in a 0.70-0.83 band
  // (everything is "about this course"), so the median/MAD threshold always
  // saturated at its clamp and the absolute floor said nothing about the
  // pair. Subtracting the Garden's mean vector removes the shared component;
  // what remains measures what two pages have in common beyond the corpus.
  // Lexical overlap uses sublinear term frequency and ignores bare numbers.
  // v2: long documents carry section vectors (max-over-sections embedding
  // affinity), a pair without concept evidence renormalises its weights, and
  // sectioned documents get capacity proportional to their section count.
  // `version` is the stamp the dashboard route compares with a built map to
  // decide whether to regenerate it. The route compares ordinals (see
  // `scoringVersionOrdinal`): a map built by an older formula is rebuilt when
  // it is next opened; a map newer than the serving bundle is left alone.
  version: "thought-topology-affinity-v3",
  projectionVersion: "semantic-projection-v3",
  weights: Object.freeze({ embedding: 0.7, concept: 0.2, lexical: 0.1 }),
  conceptWeights: Object.freeze({ primary: 1.35, supporting: 1 }),
  /** Centring needs enough documents for a meaningful mean: with two or
   * three, centred vectors cancel each other. Strength ramps from 0 at
   * `centeringMinimumDocuments` documents to 1 at `centeringFullDocuments`
   * and the threshold scales blend the same way. */
  centering: Object.freeze({ minimumDocuments: 3, fullDocuments: 8 }),
  threshold: Object.freeze({
    madMultiplier: 2.5,
    madConsistency: 1.4826,
    /** Bounds for uncentred (raw cosine) scores, used when the Garden is
     * too small to centre. */
    raw: Object.freeze({
      minimum: 0.62,
      maximum: 0.82,
      smallGardenFallback: 0.68,
      anchorMargin: 0.04,
    }),
    /** Bounds for centred scores: a corpus-typical pair scores near 0, the
     * strongest real pairs 0.5-0.85 (measured over nine live Gardens: median
     * -0.05, MAD 0.09-0.13, p99 0.48-0.53, adaptive 0.27-0.42). */
    centered: Object.freeze({
      minimum: 0.18,
      maximum: 0.45,
      smallGardenFallback: 0.3,
      anchorMargin: 0.08,
    }),
    minimumDistributionSize: 8,
  }),
  selection: Object.freeze({
    candidateNeighbors: 12,
    crossFolderCandidates: 4,
    inferredEdgeCap: 6,
    /** A page (or a section) keeps up to this many pairs that score within
     * the scale's `anchorMargin` of its best pair, above the absolute
     * minimum. */
    anchorsPerUnit: 2,
  }),
  /** Score span above the threshold over which line width/opacity ramp to
   * their maximum. */
  visualSpan: 0.35,
});

/**
 * Numeric order of a scoring version stamp ("thought-topology-affinity-v3"
 * → 3), so a dashboard can tell a map built by an older formula (rebuild)
 * from one built by a newer formula than its own bundle (leave alone). An
 * unrecognised stamp orders before every known one.
 */
export function scoringVersionOrdinal(version: string | undefined): number {
  const match = /-v(\d+)$/.exec(String(version ?? ""));
  return match ? Number(match[1]) : -1;
}

export interface ThresholdScale {
  minimum: number;
  maximum: number;
  smallGardenFallback: number;
  anchorMargin: number;
}

/** How strongly a Garden of `documentCount` documents is centred (0..1). */
export function centeringStrength(documentCount: number): number {
  const { minimumDocuments, fullDocuments } = THOUGHT_TOPOLOGY_SCORING.centering;
  if (!Number.isFinite(documentCount)) return 0;
  return clamp(
    (documentCount - minimumDocuments) / (fullDocuments - minimumDocuments),
    0,
    1,
  );
}

/** Threshold bounds for a Garden centred with `centering` strength: the raw
 * and centred scales blended, because partially centred scores sit between
 * the two. */
export function thresholdScale(centering = 1): ThresholdScale {
  const { raw, centered } = THOUGHT_TOPOLOGY_SCORING.threshold;
  const t = clamp(Number.isFinite(centering) ? centering : 1, 0, 1);
  const mix = (a: number, b: number) => a + (b - a) * t;
  return {
    minimum: mix(raw.minimum, centered.minimum),
    maximum: mix(raw.maximum, centered.maximum),
    smallGardenFallback: mix(raw.smallGardenFallback, centered.smallGardenFallback),
    anchorMargin: mix(raw.anchorMargin, centered.anchorMargin),
  };
}

export interface ScoringSection {
  label: string;
  embedding: number[] | null;
}

export interface ScoringDocument {
  id: string;
  folderId: string;
  primaryConcepts: string[];
  supportingConcepts: string[];
  lexicalText: string;
  embedding?: number[] | null;
  /**
   * Vectors for the parts of a long document (a textbook's chapters). A
   * whole-book vector is a blur of everything the book covers, so it sits at
   * a middling distance from every page about one topic; its sections do not.
   */
  sections?: ScoringSection[];
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
  /** The section of either document that produced the embedding affinity,
   * when a section rather than the whole document did. */
  sections?: { source?: string; target?: string };
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

export interface EmbeddingCentering {
  /** Mean of every whole-document vector in the Garden (sections excluded:
   * a book with thirty chapters must not pull the mean towards itself). */
  mean: number[];
  /** 0 = raw cosine, 1 = fully centred; see `centeringStrength`. */
  strength: number;
}

/**
 * The Garden's mean vector and how much of it to remove. Every page of one
 * course shares a large common component ("electromagnetics, lecture,
 * Eindhoven"); cosine on raw vectors is dominated by it and reports 0.7-0.8
 * for any two pages of the Garden. Centring removes that component so the
 * cosine reflects the pair's own shared topic (the "all-but-the-mean"
 * correction used for sentence embeddings).
 */
export function embeddingCentering(
  documents: readonly Pick<ScoringDocument, "embedding">[],
): EmbeddingCentering {
  const vectors = documents
    .map((document) => document.embedding ?? [])
    .filter((vector) => vector.length > 0);
  const dimension = vectors[0]?.length ?? 0;
  const mean = new Array<number>(dimension).fill(0);
  if (vectors.length === 0) return { mean, strength: 0 };
  for (const vector of vectors) {
    if (vector.length !== dimension) continue;
    for (let index = 0; index < dimension; index += 1) {
      mean[index] += Number(vector[index]) / vectors.length;
    }
  }
  return { mean, strength: centeringStrength(vectors.length) };
}

export function centeredVector(
  vector: readonly number[],
  centering: EmbeddingCentering | undefined,
): number[] {
  if (
    !centering ||
    centering.strength <= 0 ||
    centering.mean.length !== vector.length
  )
    return [...vector];
  const { mean, strength } = centering;
  return vector.map((value, index) => value - strength * mean[index]);
}

/** Cosine of the centred vectors. It is signed: a pair on opposite sides of
 * the corpus mean scores below 0. Flooring it at 0 would pile half of every
 * Garden's pairs onto one value and blind the median/MAD threshold. */
export function centeredCosine(
  left: readonly number[],
  right: readonly number[],
  centering: EmbeddingCentering | undefined,
): number {
  return cosineSimilarity(
    centeredVector(left, centering),
    centeredVector(right, centering),
  );
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

/** Words of the text, without stop words and without bare numbers: dates,
 * page numbers and timestamps in ingest headers made every transcript of a
 * course share vocabulary that says nothing about its topic. */
export function lexicalTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) ?? [])
    .filter(
      (token) =>
        token.length > 1 && !STOP_WORDS.has(token) && !/^[\d:.-]+$/.test(token),
    )
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
      // Sublinear term frequency: the twentieth "field" in a transcript
      // says little more than the fifth, and raw counts let a long page's
      // commonest words drown the terms that name its topic.
      vector.set(token, (1 + Math.log(count)) * idf);
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

/**
 * Weighted mix of the components that can be measured for the pair, with the
 * weights renormalised over those. Two source documents carry no concept
 * annotations; counting that as a concept overlap of zero capped their score
 * at 0.8 and kept every such pair under the absolute floor however close
 * their vectors were. Absence of a signal is not a negative signal.
 */
export function combinedAffinity(
  components: AffinityCandidate["components"],
  embeddingAvailable = true,
  conceptAvailable = true,
): number {
  const weights = THOUGHT_TOPOLOGY_SCORING.weights;
  let sum = weights.lexical * components.lexical;
  let activeWeight = weights.lexical;
  if (embeddingAvailable) {
    sum += weights.embedding * components.embedding;
    activeWeight += weights.embedding;
  }
  if (conceptAvailable) {
    sum += weights.concept * components.concept;
    activeWeight += weights.concept;
  }
  return activeWeight > 0 ? sum / activeWeight : 0;
}

function hasConcepts(
  document: Pick<ScoringDocument, "primaryConcepts" | "supportingConcepts">,
): boolean {
  return (
    document.primaryConcepts.some(Boolean) ||
    document.supportingConcepts.some(Boolean)
  );
}

/**
 * Embedding affinity of two documents: the whole-document cosine, or the
 * best match between one document's sections and the other document as a
 * whole when that is closer. Sections are matched against whole documents
 * only; section-to-section matching would let any two long books connect on
 * a single shared paragraph.
 */
export function sectionAwareEmbeddingAffinity(
  left: Pick<ScoringDocument, "embedding" | "sections">,
  right: Pick<ScoringDocument, "embedding" | "sections">,
  centering?: EmbeddingCentering,
): { value: number; sections?: AffinityCandidate["sections"] } {
  const leftWhole = centeredVector(left.embedding ?? [], centering);
  const rightWhole = centeredVector(right.embedding ?? [], centering);
  // Signed on purpose (see `centeredCosine`); the selection floor and the
  // threshold decide what is close enough, not a clamp at 0.
  let value = cosineSimilarity(leftWhole, rightWhole);
  let sections: AffinityCandidate["sections"] | undefined;
  for (const section of left.sections ?? []) {
    if (!section.embedding?.length) continue;
    const score = cosineSimilarity(
      centeredVector(section.embedding, centering),
      rightWhole,
    );
    if (score > value) {
      value = score;
      sections = { source: section.label };
    }
  }
  for (const section of right.sections ?? []) {
    if (!section.embedding?.length) continue;
    const score = cosineSimilarity(
      leftWhole,
      centeredVector(section.embedding, centering),
    );
    if (score > value) {
      value = score;
      sections = { target: section.label };
    }
  }
  return sections ? { value, sections } : { value };
}

export function scoreAffinityPairs(
  documents: readonly ScoringDocument[],
  embeddingAvailable: boolean,
): AffinityCandidate[] {
  const idf = buildConceptIdf(documents);
  const lexical = buildTfidfVectors(documents);
  const centering = embeddingAvailable
    ? embeddingCentering(documents)
    : undefined;
  const pairs: AffinityCandidate[] = [];
  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < documents.length;
      rightIndex += 1
    ) {
      const left = documents[leftIndex];
      const right = documents[rightIndex];
      const embedding = embeddingAvailable
        ? sectionAwareEmbeddingAffinity(left, right, centering)
        : { value: 0 };
      const components = {
        embedding: embedding.value,
        concept: idfWeightedConceptJaccard(left, right, idf),
        lexical: sparseCosine(
          lexical.get(left.id) ?? new Map(),
          lexical.get(right.id) ?? new Map(),
        ),
      };
      const conceptAvailable = hasConcepts(left) && hasConcepts(right);
      pairs.push({
        source: left.id,
        target: right.id,
        sourceFolderId: left.folderId,
        targetFolderId: right.folderId,
        components,
        score: combinedAffinity(components, embeddingAvailable, conceptAvailable),
        ...(embedding.sections ? { sections: embedding.sections } : {}),
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

/**
 * Median + 2.5 robust standard deviations of the pair scores, clamped to the
 * bounds of the scale the scores were measured on (`centering` = the
 * strength `scoreAffinityPairs` used, see `centeringStrength`).
 */
export function adaptiveThreshold(
  scores: readonly number[],
  centering = 1,
): number {
  const config = THOUGHT_TOPOLOGY_SCORING.threshold;
  const scale = thresholdScale(centering);
  if (scores.length < config.minimumDistributionSize)
    return scale.smallGardenFallback;
  const center = median(scores);
  const deviation = median(scores.map((score) => Math.abs(score - center)));
  return clamp(
    center + config.madMultiplier * config.madConsistency * deviation,
    scale.minimum,
    scale.maximum,
  );
}

function unorderedPairKey(source: string, target: string): string {
  return source < target
    ? `${source}\u0000${target}`
    : `${target}\u0000${source}`;
}

/**
 * How many connections a document can justify. A single-vector page keeps
 * the fixed defaults; a document embedded as N sections may carry N, because
 * each section is a distinct place another page can relate to. A textbook
 * spanning a whole course is linked from most of its lectures, not six.
 */
export function documentCapacities(
  documents: readonly Pick<ScoringDocument, "id" | "sections">[],
): Map<string, number> {
  const output = new Map<string, number>();
  for (const document of documents) {
    const sections = (document.sections ?? []).filter(
      (section) => section.embedding?.length,
    ).length;
    if (sections > 1) output.set(document.id, sections);
  }
  return output;
}

function candidateNeighborhoods(
  candidates: readonly AffinityCandidate[],
  capacities: ReadonlyMap<string, number>,
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
      Math.max(
        THOUGHT_TOPOLOGY_SCORING.selection.candidateNeighbors,
        capacities.get(nodeId) ?? 0,
      ),
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
  capacities: ReadonlyMap<string, number> = new Map(),
  centering = 1,
): AffinityCandidate[] {
  const neighborhoods = candidateNeighborhoods(candidates, capacities);
  const edgeCap = (nodeId: string) =>
    Math.max(
      THOUGHT_TOPOLOGY_SCORING.selection.inferredEdgeCap,
      capacities.get(nodeId) ?? 0,
    );
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
  const chosen = new Set<string>();
  const admit = (candidate: AffinityCandidate): void => {
    const key = unorderedPairKey(candidate.source, candidate.target);
    if (chosen.has(key)) return;
    if (
      (degrees.get(candidate.source) ?? 0) >= edgeCap(candidate.source) ||
      (degrees.get(candidate.target) ?? 0) >= edgeCap(candidate.target)
    )
      return;
    chosen.add(key);
    selected.push(candidate);
    degrees.set(candidate.source, (degrees.get(candidate.source) ?? 0) + 1);
    degrees.set(candidate.target, (degrees.get(candidate.target) ?? 0) + 1);
  };
  for (const candidate of eligible) admit(candidate);

  // Nearest-neighbour anchors. The median/MAD threshold is relative to the
  // Garden: a homogeneous corpus (thirty lectures of one course) pushes it
  // to the clamp and can leave every page unconnected even though each has
  // an obvious closest page. Every unit therefore keeps the pairs that are
  // nearly as good as its best one, when they clear the absolute minimum. A
  // unit is a page, or one section of a long document: a textbook chapter
  // has a nearest lecture of its own, and a book that anchored only through
  // its best chapter would link to one lecture instead of the ones it covers.
  const { minimum: floor, anchorMargin } = thresholdScale(centering);
  const { anchorsPerUnit } = THOUGHT_TOPOLOGY_SCORING.selection;
  const units = new Map<string, AffinityCandidate[]>();
  const attach = (unit: string, candidate: AffinityCandidate) => {
    const list = units.get(unit) ?? [];
    list.push(candidate);
    units.set(unit, list);
  };
  for (const candidate of candidates) {
    if (candidate.score < floor) continue;
    attach(candidate.source, candidate);
    attach(candidate.target, candidate);
    if (candidate.sections?.source) attach(`${candidate.source}\u0000${candidate.sections.source}`, candidate);
    if (candidate.sections?.target) attach(`${candidate.target}\u0000${candidate.sections.target}`, candidate);
  }
  const byScore = (left: AffinityCandidate, right: AffinityCandidate) =>
    right.score - left.score ||
    unorderedPairKey(left.source, left.target).localeCompare(
      unorderedPairKey(right.source, right.target),
    );
  // Proposals are admitted strongest first across the whole Garden, so a
  // page's best pair is never blocked by weaker anchors that merely came
  // earlier in the unit order and filled its partner's cap.
  const proposals = new Map<string, AffinityCandidate>();
  for (const list of units.values()) {
    const ranked = [...list].sort(byScore);
    const bestScore = ranked[0].score;
    for (const candidate of ranked.slice(0, anchorsPerUnit)) {
      if (candidate.score < bestScore - anchorMargin) break;
      proposals.set(unorderedPairKey(candidate.source, candidate.target), candidate);
    }
  }
  for (const candidate of [...proposals.values()].sort(byScore)) admit(candidate);
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
  // A fixed span above the threshold, not "up to 1": centred scores of the
  // strongest real pairs top out well below 1, and the widest line should
  // go to them rather than to a pair that never occurs.
  const unit = clamp(
    (score - threshold) / THOUGHT_TOPOLOGY_SCORING.visualSpan,
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
