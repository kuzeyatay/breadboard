import {
  adaptiveThreshold,
  buildConceptIdf,
  buildTfidfVectors,
  combinedAffinity,
  cosineSimilarity,
  embeddingCentering,
  idfWeightedConceptJaccard,
  sparseCosine,
  centeredVector,
  type AffinityCandidate,
  type EmbeddingCentering,
  type ScoringDocument,
} from "../thought-topology/scoring.ts";
import { brainEdgeId } from "./brain-graph-ids.ts";
import type { BrainEdge, BrainNodeKind } from "./brain-graph-types.ts";

const MAX_DOCUMENTS = 600;
const MAX_DOCUMENTS_PER_GARDEN = 120;
const MAX_LINKS_PER_NODE = 2;
const MAX_LINKS_PER_GARDEN_PAIR = 12;

const CROSS_GARDEN_EVIDENCE_STOP_WORDS = new Set([
  "about",
  "actually",
  "after",
  "again",
  "against",
  "already",
  "also",
  "always",
  "another",
  "apply",
  "around",
  "assume",
  "back",
  "because",
  "become",
  "becomes",
  "before",
  "between",
  "both",
  "cases",
  "certain",
  "course",
  "could",
  "describe",
  "document",
  "each",
  "eindhoven",
  "engineering",
  "enter",
  "even",
  "first",
  "frac",
  "full",
  "fully",
  "here",
  "into",
  "just",
  "lecture",
  "learning",
  "like",
  "many",
  "measure",
  "more",
  "most",
  "much",
  "nothing",
  "only",
  "other",
  "over",
  "page",
  "question",
  "same",
  "should",
  "since",
  "side",
  "some",
  "source",
  "such",
  "technology",
  "than",
  "then",
  "there",
  "these",
  "thought",
  "those",
  "through",
  "university",
  "very",
  "will",
  "what",
  "where",
  "which",
  "while",
  "would",
]);

export interface CrossGardenDocument extends ScoringDocument {
  gardenSlug: string;
  gardenTitle: string;
  label: string;
  nodeKind: BrainNodeKind;
  embeddingModel?: string;
  wordCount: number;
}

interface CrossGardenCandidate extends AffinityCandidate {
  gardenPair: string;
  threshold: number;
  embeddingAvailable: boolean;
}

function gardenPair(left: string, right: string): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function embeddingIdentity(document: CrossGardenDocument): string | null {
  const dimension = document.embedding?.length ?? 0;
  if (!dimension || !document.embeddingModel) return null;
  return `${document.embeddingModel}\u0000${dimension}`;
}

function documentRank(document: CrossGardenDocument): number {
  const kind = document.nodeKind === "concept" ? 3 : document.nodeKind === "page" ? 2 : 1;
  const concepts = document.primaryConcepts.length + document.supportingConcepts.length;
  return kind * 1_000_000 + concepts * 10_000 + Math.min(document.wordCount, 9_999);
}

/** Keep the cross-Garden pass bounded without letting one large Garden use the
 * whole budget. Round-robin selection preserves representation from every
 * authorized Garden, while each Garden contributes its most useful pages first. */
function boundedDocuments(documents: readonly CrossGardenDocument[]): CrossGardenDocument[] {
  const groups = new Map<string, CrossGardenDocument[]>();
  for (const document of documents) {
    const group = groups.get(document.gardenSlug) ?? [];
    group.push(document);
    groups.set(document.gardenSlug, group);
  }
  const orderedGroups = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) =>
      group
        .sort(
          (left, right) => documentRank(right) - documentRank(left) || left.id.localeCompare(right.id),
        )
        .slice(0, MAX_DOCUMENTS_PER_GARDEN),
    );
  const selected: CrossGardenDocument[] = [];
  for (let index = 0; selected.length < MAX_DOCUMENTS; index += 1) {
    let added = false;
    for (const group of orderedGroups) {
      const document = group[index];
      if (!document) continue;
      selected.push(document);
      added = true;
      if (selected.length >= MAX_DOCUMENTS) break;
    }
    if (!added) break;
  }
  return selected;
}

function gardenCentering(
  documents: readonly CrossGardenDocument[],
): Map<string, EmbeddingCentering> {
  const groups = new Map<string, CrossGardenDocument[]>();
  for (const document of documents) {
    const identity = embeddingIdentity(document);
    if (!identity) continue;
    const key = `${document.gardenSlug}\u0000${identity}`;
    const group = groups.get(key) ?? [];
    group.push(document);
    groups.set(key, group);
  }
  const output = new Map<string, EmbeddingCentering>();
  for (const [key, group] of groups) {
    const centering = embeddingCentering(group);
    // With three or fewer documents the mean makes every vector cancel its
    // peers. Such tiny Gardens use concept/lexical evidence until they grow.
    if (centering.strength > 0) output.set(key, centering);
  }
  return output;
}

function centeredEmbedding(
  document: CrossGardenDocument,
  centers: ReadonlyMap<string, EmbeddingCentering>,
): number[] | null {
  const identity = embeddingIdentity(document);
  if (!identity || !document.embedding) return null;
  const centering = centers.get(`${document.gardenSlug}\u0000${identity}`);
  return centering ? centeredVector(document.embedding, centering) : null;
}

function hasConcepts(document: CrossGardenDocument): boolean {
  return document.primaryConcepts.length + document.supportingConcepts.length > 0;
}

function sharedConcepts(left: CrossGardenDocument, right: CrossGardenDocument): string[] {
  const rightConcepts = new Set([...right.primaryConcepts, ...right.supportingConcepts]);
  return [...new Set([...left.primaryConcepts, ...left.supportingConcepts])]
    .filter((concept) => rightConcepts.has(concept))
    .sort()
    .slice(0, 4);
}

function sharedTerms(
  left: CrossGardenDocument,
  right: CrossGardenDocument,
  lexicalVectors: ReadonlyMap<string, ReadonlyMap<string, number>>,
): string[] {
  const leftVector = lexicalVectors.get(left.id) ?? new Map();
  const rightVector = lexicalVectors.get(right.id) ?? new Map();
  return [...leftVector.keys()]
    .filter(
      (term) =>
        rightVector.has(term) &&
        term.length >= 5 &&
        !term.includes("'") &&
        !CROSS_GARDEN_EVIDENCE_STOP_WORDS.has(term),
    )
    .sort(
      (leftTerm, rightTerm) =>
        Math.min(rightVector.get(rightTerm) ?? 0, leftVector.get(rightTerm) ?? 0) -
          Math.min(rightVector.get(leftTerm) ?? 0, leftVector.get(leftTerm) ?? 0) ||
        leftTerm.localeCompare(rightTerm),
    )
    .slice(0, 4);
}

function explanation(
  left: CrossGardenDocument,
  right: CrossGardenDocument,
  lexicalVectors: ReadonlyMap<string, ReadonlyMap<string, number>>,
): {
  text: string;
  evidence: string[];
} {
  const concepts = sharedConcepts(left, right);
  const terms = sharedTerms(left, right, lexicalVectors);
  const shared = [...concepts, ...terms.filter((term) => !concepts.includes(term))].slice(0, 5);
  const because = shared.length > 0
    ? ` Shared evidence includes ${shared.join(", ")}.`
    : " Their latest semantic representations identify the same topic beyond either Garden's general subject.";
  return {
    text: `“${left.label}” in ${left.gardenTitle} and “${right.label}” in ${right.gardenTitle} form a cross-Garden semantic match.${because} This link is recalculated from the latest Thought Topology builds.`,
    evidence: [
      `Cross-Garden match: ${left.gardenTitle} ↔ ${right.gardenTitle}`,
      ...concepts.map((concept) => `Shared concept: ${concept}`),
      ...terms.map((term) => `Shared term: ${term}`),
    ].slice(0, 6),
  };
}

/**
 * Infer sparse links between pages in different authorized Gardens.
 *
 * Each Garden is centred independently before vectors are compared. That
 * removes its broad course-level vocabulary and lets the shared subtopic
 * survive—for example, an electromagnetics lecture on polarization can match
 * an optics page without treating every page from both courses as equivalent.
 */
export function buildCrossGardenEdges(
  input: readonly CrossGardenDocument[],
): BrainEdge[] {
  const documents = boundedDocuments(input);
  if (new Set(documents.map((document) => document.gardenSlug)).size < 2) return [];

  const byId = new Map(documents.map((document) => [document.id, document]));
  const centers = gardenCentering(documents);
  const conceptIdf = buildConceptIdf(documents);
  const lexicalVectors = buildTfidfVectors(documents);
  const candidates: Array<Omit<CrossGardenCandidate, "threshold">> = [];

  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < documents.length; rightIndex += 1) {
      const left = documents[leftIndex];
      const right = documents[rightIndex];
      if (left.gardenSlug === right.gardenSlug) continue;
      const leftEmbedding = centeredEmbedding(left, centers);
      const rightEmbedding = centeredEmbedding(right, centers);
      const embeddingAvailable = Boolean(
        leftEmbedding &&
        rightEmbedding &&
        embeddingIdentity(left) === embeddingIdentity(right) &&
        leftEmbedding.length === rightEmbedding.length,
      );
      const components = {
        embedding: embeddingAvailable
          ? cosineSimilarity(leftEmbedding!, rightEmbedding!)
          : 0,
        concept: idfWeightedConceptJaccard(left, right, conceptIdf),
        lexical: sparseCosine(
          lexicalVectors.get(left.id) ?? new Map(),
          lexicalVectors.get(right.id) ?? new Map(),
        ),
      };
      candidates.push({
        source: left.id,
        target: right.id,
        sourceFolderId: left.folderId,
        targetFolderId: right.folderId,
        components,
        score: combinedAffinity(
          components,
          embeddingAvailable,
          hasConcepts(left) && hasConcepts(right),
        ),
        gardenPair: gardenPair(left.gardenSlug, right.gardenSlug),
        embeddingAvailable,
      });
    }
  }

  const candidatesByGardenPair = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const group = candidatesByGardenPair.get(candidate.gardenPair) ?? [];
    group.push(candidate);
    candidatesByGardenPair.set(candidate.gardenPair, group);
  }
  const eligible: CrossGardenCandidate[] = [];
  for (const group of candidatesByGardenPair.values()) {
    // Independently-centred vector scores use the same scale as a normal
    // Thought Topology build. Lexical-only matches share that conservative
    // minimum and must still clear the pair's observed distribution.
    const threshold = adaptiveThreshold(group.map((candidate) => candidate.score), 1);
    for (const candidate of group) {
      if (candidate.score >= threshold) eligible.push({ ...candidate, threshold });
    }
  }

  eligible.sort(
    (left, right) =>
      right.score - right.threshold - (left.score - left.threshold) ||
      right.score - left.score ||
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target),
  );
  const degrees = new Map<string, number>();
  const gardenPairCounts = new Map<string, number>();
  const selected: CrossGardenCandidate[] = [];
  for (const candidate of eligible) {
    if ((degrees.get(candidate.source) ?? 0) >= MAX_LINKS_PER_NODE) continue;
    if ((degrees.get(candidate.target) ?? 0) >= MAX_LINKS_PER_NODE) continue;
    if ((gardenPairCounts.get(candidate.gardenPair) ?? 0) >= MAX_LINKS_PER_GARDEN_PAIR) continue;
    selected.push(candidate);
    degrees.set(candidate.source, (degrees.get(candidate.source) ?? 0) + 1);
    degrees.set(candidate.target, (degrees.get(candidate.target) ?? 0) + 1);
    gardenPairCounts.set(
      candidate.gardenPair,
      (gardenPairCounts.get(candidate.gardenPair) ?? 0) + 1,
    );
  }

  return selected.flatMap((candidate) => {
    const left = byId.get(candidate.source);
    const right = byId.get(candidate.target);
    if (!left || !right) return [];
    const detail = explanation(left, right, lexicalVectors);
    const [source, target] = left.id < right.id ? [left.id, right.id] : [right.id, left.id];
    return [{
      id: brainEdgeId(source, target, "related_to", "thought-topology"),
      source,
      target,
      relation: "related_to" as const,
      origin: "thought-topology" as const,
      explicit: false,
      confidence: candidate.score,
      weight: candidate.score,
      threshold: candidate.threshold,
      semanticRelation: "cross-garden-related",
      direction: "undirected",
      explanation: detail.text,
      evidence: detail.evidence,
    }];
  });
}
