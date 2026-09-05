import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

import db from "../db.ts";
import { GBrainClient, type AdapterEmbeddingResponse } from "../gbrain/client.ts";
import { scanClusterKnowledge } from "../knowledge.ts";
import { GLOBAL_MODEL_SENTINEL } from "../ai-models.ts";
import {
  createDefaultTopologyGenerator,
  enrichEdgeExplanation,
  enrichNodeSummary,
  extractiveNodeSummary,
  mapWithConcurrency,
  type ModelTextGenerator,
} from "./enrichment.ts";
import {
  DEFAULT_TOPOLOGY_CACHE_VERSIONS,
  edgeExplanationHash,
  nodeCacheHashes,
  topologyPairHash,
  type TopologyCacheVersions,
} from "./cache.ts";
import { buildGardenProjection, DOCUMENT_SUMMARY_VERSION, gardenContentFingerprint, type GardenProjection, type ProjectedTopologyNode } from "./projection.ts";
import {
  adaptiveThreshold,
  documentCapacities,
  edgeVisualStyle,
  embeddingCentering,
  mergeAuthoredPairs,
  scoreAffinityPairs,
  selectSparseInferredEdges,
  stableHashText,
  THOUGHT_TOPOLOGY_SCORING,
} from "./scoring.ts";
import { commitThoughtTopology, readThoughtTopology, readThoughtTopologyCache } from "./storage.ts";
import { readThoughtTopologyRolloutStateById } from "./state.ts";
import {
  THOUGHT_TOPOLOGY_SCHEMA_VERSION,
  type EnrichmentText,
  type ThoughtTopology,
  type ThoughtTopologyCache,
  type ThoughtTopologyCacheNode,
  type TopologyEdge,
  type TopologyEvidence,
  type TopologyFolder,
} from "./types.ts";

export interface ThoughtTopologyBuildDependencies {
  embed?: (texts: string[], signal?: AbortSignal) => Promise<AdapterEmbeddingResponse>;
  generator?: ModelTextGenerator | null;
  now?: () => Date;
  cacheVersions?: TopologyCacheVersions;
}

export interface ThoughtTopologyBuildResult {
  status: "built" | "stale" | "skipped";
  clusterId: number;
  revision: number;
  nodes: number;
  edges: number;
  mode: "semantic-vector" | "concept-lexical" | "disabled";
  sourceRevision?: string;
}

function seededUnit(value: string, offset: number): number {
  const hash = stableHashText(value, offset);
  return Number.parseInt(hash.slice(0, 8), 16) / 0xffffffff;
}

function deterministicFolderPositions(
  folders: TopologyFolder[],
  cached: ThoughtTopologyCache | null,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const root = folders.find((folder) => folder.depth === 0);
  if (root) positions.set(root.id, { x: 0, y: 0 });
  const top = folders.filter((folder) => folder.depth === 1).sort((left, right) => left.id.localeCompare(right.id));
  const weights = top.map((folder) => Math.max(1, Math.sqrt(folder.nodeCount + 1)));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = -Math.PI / 2;
  for (let index = 0; index < top.length; index += 1) {
    const arc = Math.PI * 2 * weights[index] / total;
    const angle = cursor + arc / 2;
    positions.set(top[index].id, { x: Math.cos(angle) * 300, y: Math.sin(angle) * 300 });
    cursor += arc;
  }
  for (const folder of folders.filter((item) => item.depth > 1)) {
    const parent = positions.get(folder.parentId ?? "") ?? { x: 0, y: 0 };
    const angle = seededUnit(folder.id, 1) * Math.PI * 2;
    const radius = 115 + seededUnit(folder.id, 2) * 55;
    positions.set(folder.id, { x: parent.x + Math.cos(angle) * radius, y: parent.y + Math.sin(angle) * radius });
  }
  for (const folder of folders) {
    const old = cached?.nodes[`meta:${folder.id}`];
    const next = positions.get(folder.id);
    if (old && Number.isFinite(old.x) && Number.isFinite(old.y) && next && folder.depth > 0) {
      positions.set(folder.id, { x: old.x!, y: old.y! });
    }
  }
  return positions;
}

function positionNodes(
  projection: GardenProjection,
  cache: ThoughtTopologyCache | null,
): Map<string, { x: number; y: number }> {
  const folderPositions = deterministicFolderPositions(projection.folders, cache);
  for (const folder of projection.folders) {
    const position = folderPositions.get(folder.id);
    if (position) Object.assign(folder, position);
  }
  const output = new Map<string, { x: number; y: number }>();
  for (const node of projection.nodes) {
    const old = cache?.nodes[node.id];
    if (old?.folderId === node.folderId && Number.isFinite(old.x) && Number.isFinite(old.y)) {
      output.set(node.id, { x: old.x!, y: old.y! });
      continue;
    }
    const anchor = folderPositions.get(node.folderId) ?? { x: 0, y: 0 };
    const angle = seededUnit(node.id, 3) * Math.PI * 2;
    const radius = 35 + seededUnit(node.id, 4) * 90;
    output.set(node.id, { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius });
  }
  return output;
}

function sharedConcepts(left: ProjectedTopologyNode, right: ProjectedTopologyNode): string[] {
  const rightConcepts = new Set([...right.primaryConcepts, ...right.supportingConcepts]);
  return [...new Set([...left.primaryConcepts, ...left.supportingConcepts])]
    .filter((concept) => rightConcepts.has(concept))
    .sort();
}

function edgeEvidence(
  left: ProjectedTopologyNode,
  right: ProjectedTopologyNode,
  origin: TopologyEdge["origin"],
  sections?: { source?: string; target?: string },
): TopologyEvidence[] {
  const evidence: TopologyEvidence[] = [];
  // A long document relates through one of its parts; name it, so the map
  // says "chapter 9 of the textbook", not just "the textbook".
  if (sections?.source) evidence.push({ kind: "heading", label: sections.source, sourceNodeId: left.id });
  if (sections?.target) evidence.push({ kind: "heading", label: sections.target, sourceNodeId: right.id });
  for (const concept of sharedConcepts(left, right).slice(0, 5)) {
    evidence.push({ kind: "concept", label: concept });
  }
  for (const claim of [...left.claimTexts, ...right.claimTexts].slice(0, 3)) {
    evidence.push({ kind: "claim", label: claim.slice(0, 240) });
  }
  if (origin !== "inferred") evidence.push({ kind: "authored", label: "Explicit Markdown relationship" });
  if (evidence.length === 0) evidence.push({ kind: "lexical", label: "Deterministic semantic projection overlap" });
  return evidence;
}

/**
 * The GBrain adapter reports the model under its engine's provider-prefixed
 * name (`openai:local/bge-small-en-v1.5`) while ChatMock reports the bare id.
 * Both are the same vector space; only the bare id is the cache identity.
 */
const EMBED_BATCH_SIZE = 8;

export function canonicalEmbeddingModel(model: string): string {
  return model.trim().replace(/^[a-z][a-z0-9_-]*:(?=[^/]+\/)/i, "");
}

/** A page's own summary as a ready enrichment, or null when it states none. */
function documentNodeSummary(node: Pick<ProjectedTopologyNode, "documentSummary">): EnrichmentText | null {
  return node.documentSummary
    ? { state: "ready", text: node.documentSummary, promptVersion: DOCUMENT_SUMMARY_VERSION }
    : null;
}

/**
 * A pure addition can be joined to the published graph without selecting the
 * old graph again. Existing pages must be byte-identical and remain in their
 * folders; moves, edits and deletions intentionally take the normal repair
 * path so obsolete relationships can be removed.
 */
function addedNodeIds(
  previous: ThoughtTopology | null | undefined,
  projection: GardenProjection,
): Set<string> | null {
  if (!previous || projection.nodes.length <= previous.nodes.length) return null;
  const nextNodes = new Map(projection.nodes.map((node) => [node.id, node]));
  const oldFolders = new Map(previous.folders.map((folder) => [folder.id, folder]));
  const nextFolders = new Map(projection.folders.map((folder) => [folder.id, folder]));
  const oldNodesAreUnchanged = previous.nodes.every((node) => {
    const next = nextNodes.get(node.id);
    return Boolean(
      next &&
      next.contentHash === node.contentHash &&
      next.folderId === node.folderId &&
      next.relPath === node.relPath,
    );
  });
  const oldFoldersAreUnchanged = [...oldFolders].every(([id, folder]) => {
    const next = nextFolders.get(id);
    return Boolean(next && next.path === folder.path && next.parentId === folder.parentId);
  });
  if (!oldNodesAreUnchanged || !oldFoldersAreUnchanged) return null;
  const previousIds = new Set(previous.nodes.map((node) => node.id));
  return new Set(projection.nodes.filter((node) => !previousIds.has(node.id)).map((node) => node.id));
}

function topologyMatchesVersions(
  topology: ThoughtTopology,
  versions: TopologyCacheVersions,
): boolean {
  return topology.scoringVersion === versions.scoringVersion &&
    topology.build.nodePromptVersion === versions.nodePromptVersion &&
    topology.build.edgePromptVersion === versions.edgePromptVersion &&
    topology.build.summaryModel === versions.summaryModel &&
    (topology.build.embeddingModel === versions.embeddingModel || topology.build.embeddingModel === "unavailable");
}

function topologyHasRetryableEnrichment(topology: ThoughtTopology): boolean {
  // `pending` existed in artifacts produced by the old explanation budget.
  // It is incomplete, not reusable, and must be rebuilt just like a failed or
  // degraded enrichment.
  const retryable = (value: EnrichmentText) => value.state !== "ready";
  return retryable(topology.garden.summary) ||
    topology.folders.some((folder) => retryable(folder.summary)) ||
    topology.nodes.some((node) => retryable(node.summary)) ||
    topology.edges.some((edge) => retryable(edge.explanation));
}

async function embedChangedNodes(
  nodes: ProjectedTopologyNode[],
  oldCache: ThoughtTopologyCache | null,
  versions: TopologyCacheVersions,
  embed: ThoughtTopologyBuildDependencies["embed"],
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<{ records: Record<string, ThoughtTopologyCacheNode>; available: boolean; model: string; dimension: number }> {
  const records: Record<string, ThoughtTopologyCacheNode> = {};
  const changed: ProjectedTopologyNode[] = [];
  // Section vectors are keyed by the section text's hash, so a rebuild after
  // a page edit re-embeds only the chapters that changed. Missing ones are
  // embedded in this run alongside changed whole documents.
  const pendingSections: Array<{ nodeId: string; index: number; text: string }> = [];
  const sectionRecords = (node: ProjectedTopologyNode, old: ThoughtTopologyCacheNode | undefined) => {
    if (node.spans.length === 0) return undefined;
    const reusable = old?.embeddingModel === versions.embeddingModel ? old.sections ?? [] : [];
    return node.spans.map((span, index) => {
      const cached = reusable.find((section) => section.hash === span.hash && section.embedding?.length);
      if (!cached) pendingSections.push({ nodeId: node.id, index, text: span.text });
      return { hash: span.hash, label: span.label, embedding: cached?.embedding ?? null };
    });
  };
  for (const node of nodes) {
    const hashes = nodeCacheHashes(node.contentHash, versions);
    const old = oldCache?.nodes[node.id];
    if (old?.embeddingHash === hashes.embeddingHash && old.embeddingModel === versions.embeddingModel && old.embedding?.length) {
      records[node.id] = { ...old, id: node.id, folderId: node.folderId, contentHash: node.contentHash, semanticText: node.semanticText, lexicalText: node.lexicalText, sections: sectionRecords(node, old) };
    } else {
      changed.push(node);
      records[node.id] = {
        id: node.id,
        folderId: node.folderId,
        contentHash: node.contentHash,
        embeddingHash: hashes.embeddingHash,
        summaryHash: hashes.summaryHash,
        semanticText: node.semanticText,
        lexicalText: node.lexicalText,
        embeddingModel: versions.embeddingModel,
        embeddingDimension: 0,
        embedding: null,
        summary: old?.summaryHash === hashes.summaryHash && old.summary.state === "ready"
          ? old.summary
          : documentNodeSummary(node) ?? extractiveNodeSummary(node.title, node.semanticText),
        sections: sectionRecords(node, old),
      };
    }
  }
  const requests: Array<{ text: string; assign: (vector: number[], dimension: number) => void; reset: () => void }> = [
    ...changed.map((node) => ({
      text: node.semanticText,
      assign: (vector: number[], dimension: number) => {
        records[node.id].embedding = vector;
        records[node.id].embeddingDimension = dimension;
        records[node.id].embeddingModel = versions.embeddingModel;
      },
      reset: () => {
        records[node.id].embedding = null;
        records[node.id].embeddingDimension = 0;
      },
    })),
    ...pendingSections.map((pending) => ({
      text: pending.text,
      assign: (vector: number[]) => {
        records[pending.nodeId].sections![pending.index].embedding = vector;
      },
      reset: () => {
        records[pending.nodeId].sections![pending.index].embedding = null;
      },
    })),
  ];
  if (requests.length > 0 && embed) {
    try {
      // Small batches: ChatMock embeds long pages at roughly one per second
      // on the CPU, and each batch must finish inside the adapter's budget.
      for (let offset = 0; offset < requests.length; offset += EMBED_BATCH_SIZE) {
        const batch = requests.slice(offset, offset + EMBED_BATCH_SIZE);
        const response = await embed(batch.map((request) => request.text), signal);
        if (canonicalEmbeddingModel(response.model) !== versions.embeddingModel || response.vectors.length !== batch.length || response.vectors.some((vector) => vector.length !== response.dimension)) {
          throw new Error("embedding_identity_mismatch");
        }
        batch.forEach((request, index) => request.assign(response.vectors[index], response.dimension));
        onProgress?.(Math.min(1, (offset + batch.length) / requests.length));
      }
    } catch {
      // One incomplete vector space is worse than deterministic degradation, so
      // nothing embedded in this run may score. Vectors reused from the cache
      // stay: they are still valid, and keeping them means the next successful
      // build only embeds what changed instead of re-embedding the garden.
      for (const request of requests) request.reset();
    }
  }
  const dimensions = new Set(Object.values(records).map((record) => record.embedding?.length ?? 0));
  const available = nodes.length > 0 && dimensions.size === 1 && !dimensions.has(0);
  // A section vector from another space, or one that failed to embed, must
  // not score; the whole-document vector still does.
  for (const record of Object.values(records)) {
    for (const section of record.sections ?? []) {
      if (section.embedding && section.embedding.length !== (record.embedding?.length ?? 0)) section.embedding = null;
    }
  }
  return {
    records,
    available,
    model: available ? versions.embeddingModel : "unavailable",
    dimension: available ? [...dimensions][0] : 0,
  };
}

export async function buildThoughtTopologyFromProjection(input: {
  clusterId: number;
  gardenId: string;
  gardenTitle: string;
  projection: GardenProjection;
  oldCache: ThoughtTopologyCache | null;
  previousTopology?: ThoughtTopology | null;
  signal?: AbortSignal;
  dependencies?: ThoughtTopologyBuildDependencies;
  contentFingerprint?: string;
  onProgress?: (percent: number) => void;
}): Promise<{ topology: ThoughtTopology; cache: ThoughtTopologyCache }> {
  const dependencies = input.dependencies ?? {};
  const versions = dependencies.cacheVersions ?? DEFAULT_TOPOLOGY_CACHE_VERSIONS;
  const generator = dependencies.generator === undefined
    ? createDefaultTopologyGenerator(versions.summaryModel)
    : dependencies.generator ?? undefined;
  const embed = dependencies.embed ?? ((texts, signal) => new GBrainClient().embed(texts, signal));
  const embedding = await embedChangedNodes(
    input.projection.nodes,
    input.oldCache,
    versions,
    embed,
    input.signal,
    (fraction) => input.onProgress?.(20 + Math.floor(fraction * 35)),
  );
  input.onProgress?.(55);
  const positions = positionNodes(input.projection, input.oldCache);

  // A cached enrichment is reused only while it is "ready": a degraded summary
  // or explanation records that the model was unavailable, so every later
  // build retries it instead of carrying the fallback text forever.
  // Pages that state their own summary (frontmatter description or lead
  // paragraph) show exactly that text; the model only summarises the rest.
  const changedForSummary = input.projection.nodes.filter((node) => {
    const hashes = nodeCacheHashes(node.contentHash, versions);
    const old = input.oldCache?.nodes[node.id];
    // A document summary always replaces a cached model summary; it costs nothing.
    if (node.documentSummary && old?.summary.promptVersion !== DOCUMENT_SUMMARY_VERSION) return true;
    return old?.summaryHash !== hashes.summaryHash || old.summary.state !== "ready";
  });
  const modelSummarised = changedForSummary.filter((node) => !documentNodeSummary(node));
  const summaries = await mapWithConcurrency(modelSummarised, 3, (node) =>
    enrichNodeSummary({ title: node.title, semanticText: node.semanticText, generator, model: versions.summaryModel }));
  input.onProgress?.(68);
  const summaryByNode = new Map(modelSummarised.map((node, index) => [node.id, summaries[index]]));
  for (const node of changedForSummary) {
    embedding.records[node.id].summary = documentNodeSummary(node) ?? summaryByNode.get(node.id)!;
    embedding.records[node.id].summaryHash = nodeCacheHashes(node.contentHash, versions).summaryHash;
  }
  for (const node of input.projection.nodes) {
    node.summary = embedding.records[node.id].summary;
    const position = positions.get(node.id);
    if (position) {
      Object.assign(node, position);
      Object.assign(embedding.records[node.id], position);
    }
    node.embedding = embedding.records[node.id].embedding;
    node.sections = embedding.records[node.id].sections?.map((section) => ({ label: section.label, embedding: section.embedding }));
  }

  const additions = addedNodeIds(input.previousTopology, input.projection);
  const candidates = scoreAffinityPairs(input.projection.nodes, embedding.available);
  // The scale the pair scores live on: centred cosine for a Garden with
  // enough pages, raw cosine for a tiny one (see `embeddingCentering`).
  const centering = embedding.available ? embeddingCentering(input.projection.nodes).strength : 0;
  const threshold = adaptiveThreshold(candidates.map((candidate) => candidate.score), centering);
  // Authored pairs are edges already; letting them compete for a page's
  // inferred anchors would spend those on links the page has regardless.
  const authoredKeys = new Set(input.projection.authoredEdges.map((edge) => [edge.source, edge.target].sort().join("\u0000")));
  const inferable = candidates.filter((candidate) => !authoredKeys.has([candidate.source, candidate.target].sort().join("\u0000")));
  const inferred = selectSparseInferredEdges(inferable, threshold, documentCapacities(input.projection.nodes), centering);
  const merged = mergeAuthoredPairs(inferred, input.projection.authoredEdges, candidates)
    // For a pure addition, the published relationships between old pages are
    // already authoritative. Only choose relationships that place a new page
    // into that graph; the old edge set is copied below without reconstruction.
    .filter((candidate) =>
      additions === null || additions.has(candidate.source) || additions.has(candidate.target));
  const byId = new Map(input.projection.nodes.map((node) => [node.id, node]));
  const nextEdgeCache: ThoughtTopologyCache["edges"] = {};
  // The model explains a long document's edge from the part that matched,
  // not from its table of contents.
  const spanProjection = (node: ProjectedTopologyNode, label: string | undefined) =>
    (label ? node.spans.find((span) => span.label === label)?.text : undefined) ?? node.semanticText;
  const edgeInputs = merged.flatMap((candidate) => {
    const left = byId.get(candidate.source);
    const right = byId.get(candidate.target);
    if (!left || !right) return [];
    const evidence = edgeEvidence(left, right, candidate.origin, candidate.sections);
    const pairHash = topologyPairHash(embedding.records[left.id].embeddingHash, embedding.records[right.id].embeddingHash, versions);
    const explanationHash = edgeExplanationHash(pairHash, evidence, versions);
    return [{ candidate, left, right, evidence, pairHash, explanationHash, old: input.oldCache?.edges[pairHash] }];
  });
  const changedEdges = edgeInputs
    .filter((edge) =>
      edge.old?.explanationHash !== edge.explanationHash || edge.old.explanation.state !== "ready")
    .sort((left, right) => right.candidate.score - left.candidate.score || left.pairHash.localeCompare(right.pairHash));
  // The renderer artifact is an atomic snapshot: do not construct or commit
  // it until every selected connection has an explanation. Concurrency keeps
  // large Gardens moving without exposing a half-enriched graph.
  let completedExplanations = 0;
  const edgeEnrichments = await mapWithConcurrency(changedEdges, 3, async (edge) => {
    const enrichment = await enrichEdgeExplanation({
      sourceTitle: edge.left.title,
      targetTitle: edge.right.title,
      sourceProjection: spanProjection(edge.left, edge.candidate.sections?.source),
      targetProjection: spanProjection(edge.right, edge.candidate.sections?.target),
      sharedConcepts: sharedConcepts(edge.left, edge.right),
      components: edge.candidate.components,
      score: edge.candidate.score,
      threshold,
      generator,
      model: versions.summaryModel,
    });
    completedExplanations += 1;
    input.onProgress?.(
      68 + Math.floor((completedExplanations / Math.max(1, changedEdges.length)) * 14),
    );
    return enrichment;
  });
  input.onProgress?.(82);
  const enrichmentByHash = new Map(changedEdges.map((edge, index) => [edge.explanationHash, edgeEnrichments[index]]));
  let edges: TopologyEdge[] = edgeInputs.map((edge) => {
    const enrichment = enrichmentByHash.get(edge.explanationHash);
    const explanation = enrichment?.explanation ?? edge.old?.explanation ?? { state: "degraded" as const, text: "This connection is preserved from authored Markdown.", promptVersion: versions.edgePromptVersion };
    const relationType = edge.candidate.origin === "inferred"
      ? enrichment?.relationType ?? edge.old?.relationType ?? "related"
      : edge.candidate.relationType;
    const direction = edge.candidate.origin === "inferred"
      ? enrichment?.direction ?? edge.old?.direction ?? "undirected"
      : relationType === "related" ? "undirected" : "source-to-target";
    nextEdgeCache[edge.pairHash] = {
      pairHash: edge.pairHash,
      explanationHash: edge.explanationHash,
      explanation,
      relationType,
      direction,
      score: edge.candidate.score,
    };
    return {
      id: `edge:${edge.pairHash.slice(0, 20)}`,
      source: edge.candidate.source,
      target: edge.candidate.target,
      origin: edge.candidate.origin,
      score: edge.candidate.score,
      previousScore: edge.old?.score,
      threshold: edge.candidate.origin === "inferred" ? threshold : undefined,
      components: edge.candidate.components,
      relationType,
      direction,
      explanation,
      evidence: edge.evidence,
      pairHash: edge.pairHash,
      visual: edgeVisualStyle(edge.candidate.score, threshold, edge.candidate.origin),
    };
  });
  if (additions !== null && input.previousTopology) {
    const retainedIds = new Set(input.projection.nodes.map((node) => node.id));
    const preserved = input.previousTopology.edges.filter(
      (edge) =>
        retainedIds.has(edge.source) &&
        retainedIds.has(edge.target) &&
        !additions.has(edge.source) &&
        !additions.has(edge.target),
    );
    for (const edge of preserved) {
      const cached = input.oldCache?.edges[edge.pairHash];
      nextEdgeCache[edge.pairHash] = cached ?? {
        pairHash: edge.pairHash,
        explanationHash: edgeExplanationHash(edge.pairHash, edge.evidence, versions),
        explanation: edge.explanation,
        relationType: edge.relationType,
        direction: edge.direction,
        score: edge.score,
      };
    }
    edges = [...preserved, ...edges].sort((left, right) => left.id.localeCompare(right.id));
  }

  const folderPositions = new Map(input.projection.folders.map((folder) => [folder.id, { x: folder.x, y: folder.y }]));
  for (const [folderIndex, folder] of input.projection.folders.entries()) {
    const childTitles = input.projection.nodes.filter((node) => node.folderId === folder.id).map((node) => node.title);
    const semanticText = `${folder.title}. Pages: ${childTitles.join(", ") || "none"}.`;
    const contentHash = stableHashText("folder-summary", semanticText);
    const hashes = nodeCacheHashes(contentHash, versions);
    const old = input.oldCache?.nodes[`meta:${folder.id}`];
    const summary = old?.summaryHash === hashes.summaryHash && old.summary.state === "ready"
      ? old.summary
      : await enrichNodeSummary({ title: folder.title, semanticText, generator, model: versions.summaryModel });
    folder.summary = summary;
    embedding.records[`meta:${folder.id}`] = {
      id: `meta:${folder.id}`,
      folderId: folder.id,
      contentHash,
      embeddingHash: "structural",
      summaryHash: hashes.summaryHash,
      semanticText,
      lexicalText: semanticText,
      embeddingModel: "none",
      embeddingDimension: 0,
      embedding: null,
      summary,
      ...folderPositions.get(folder.id),
    };
    input.onProgress?.(
      82 + Math.floor(((folderIndex + 1) / Math.max(1, input.projection.folders.length)) * 12),
    );
  }
  const gardenSemanticText = `${input.gardenTitle}. Folders: ${input.projection.folders.filter((folder) => folder.depth === 1).map((folder) => folder.title).join(", ")}. Pages: ${input.projection.nodes.slice(0, 80).map((node) => node.title).join(", ")}.`;
  const gardenContentHash = stableHashText("garden-summary", gardenSemanticText);
  const gardenHashes = nodeCacheHashes(gardenContentHash, versions);
  const oldGarden = input.oldCache?.nodes["meta:garden"];
  const gardenSummary = oldGarden?.summaryHash === gardenHashes.summaryHash && oldGarden.summary.state === "ready"
    ? oldGarden.summary
    : await enrichNodeSummary({ title: input.gardenTitle, semanticText: gardenSemanticText, generator, model: versions.summaryModel });
  input.onProgress?.(96);
  embedding.records["meta:garden"] = {
    id: "meta:garden",
    folderId: "",
    contentHash: gardenContentHash,
    embeddingHash: "structural",
    summaryHash: gardenHashes.summaryHash,
    semanticText: gardenSemanticText,
    lexicalText: gardenSemanticText,
    embeddingModel: "none",
    embeddingDimension: 0,
    embedding: null,
    summary: gardenSummary,
    x: 0,
    y: 0,
  };

  const generatedAt = (dependencies.now?.() ?? new Date()).toISOString();
  const degraded = !embedding.available ||
    gardenSummary.state !== "ready" ||
    input.projection.nodes.some((node) => node.summary.state !== "ready") ||
    edges.some((edge) => edge.explanation.state !== "ready");
  const topology: ThoughtTopology = {
    schemaVersion: THOUGHT_TOPOLOGY_SCHEMA_VERSION,
    scoringVersion: versions.scoringVersion,
    sourceRevision: input.projection.sourceRevision,
    garden: { id: input.clusterId, slug: input.gardenId, title: input.gardenTitle, summary: gardenSummary },
    folders: input.projection.folders,
    nodes: input.projection.nodes.map(({ semanticText: _semanticText, lexicalText: _lexicalText, claimTexts: _claimTexts, headings: _headings, embedding: _embedding, documentSummary: _documentSummary, spans: _spans, sections: _sections, ...node }) => node),
    edges,
    build: {
      state: degraded ? "degraded" : "ready",
      generatedAt,
      embeddingModel: embedding.model,
      embeddingDimension: embedding.dimension,
      summaryModel: versions.summaryModel,
      nodePromptVersion: versions.nodePromptVersion,
      edgePromptVersion: versions.edgePromptVersion,
      retrievalMode: embedding.available ? "semantic-vector" : "concept-lexical",
      threshold,
      ...(input.contentFingerprint ? { contentFingerprint: input.contentFingerprint } : {}),
    },
  };
  const cache: ThoughtTopologyCache = {
    schemaVersion: THOUGHT_TOPOLOGY_SCHEMA_VERSION,
    sourceRevision: input.projection.sourceRevision,
    scoringVersion: versions.scoringVersion,
    nodes: embedding.records,
    edges: nextEdgeCache,
  };
  return { topology, cache };
}

export async function buildThoughtTopologyInRuntimeWorker(input: {
  clusterId: number;
  userId: number;
  gardenId: string;
  revision: number;
  contentRoot: string;
  database?: Database.Database;
  signal?: AbortSignal;
  dependencies?: ThoughtTopologyBuildDependencies;
  onProgress?: (percent: number) => void;
}): Promise<ThoughtTopologyBuildResult> {
  const database = input.database ?? db;
  const before = readThoughtTopologyRolloutStateById(input.clusterId, database);
  if (!before?.enabled || before.userId !== input.userId || before.slug !== input.gardenId) {
    return { status: "skipped", clusterId: input.clusterId, revision: input.revision, nodes: 0, edges: 0, mode: "disabled" };
  }
  if (before.revision !== input.revision) {
    return { status: "stale", clusterId: input.clusterId, revision: input.revision, nodes: 0, edges: 0, mode: "disabled" };
  }
  const gardenDir = path.join(input.contentRoot, input.gardenId);
  if (!fs.existsSync(gardenDir)) throw new Error("Garden content is unavailable.");
  // Stamped before scanning so any write racing this build reads as drift.
  const contentFingerprint = gardenContentFingerprint(gardenDir);
  const previous = readThoughtTopology(gardenDir);
  const oldCache = readThoughtTopologyCache(gardenDir);
  const versions = input.dependencies?.cacheVersions ?? DEFAULT_TOPOLOGY_CACHE_VERSIONS;
  const reusable =
    previous &&
    oldCache &&
    oldCache.sourceRevision === previous.sourceRevision &&
    topologyMatchesVersions(previous, versions) &&
    !topologyHasRetryableEnrichment(previous)
      ? { topology: previous, cache: oldCache }
      : null;
  const keepExistingTopology = (): ThoughtTopologyBuildResult => {
    // A queue revision can move for bookkeeping that does not alter published
    // Markdown. Keep the exact graph and simply advance its cheap drift stamp
    // when filesystem metadata changed.
    if (reusable!.topology.build.contentFingerprint !== contentFingerprint) {
      commitThoughtTopology(gardenDir, reusable!.cache, {
        ...reusable!.topology,
        build: { ...reusable!.topology.build, contentFingerprint },
      });
    }
    input.onProgress?.(100);
    return {
      status: "built",
      clusterId: input.clusterId,
      revision: input.revision,
      nodes: reusable!.topology.nodes.length,
      edges: reusable!.topology.edges.length,
      mode: reusable!.topology.build.retrievalMode,
      sourceRevision: reusable!.topology.sourceRevision,
    };
  };
  // The fingerprint is deliberately cheap: the normal idle/read path avoids
  // even scanning or projecting the Markdown tree.
  if (reusable?.topology.build.contentFingerprint === contentFingerprint) {
    return keepExistingTopology();
  }

  const knowledge = scanClusterKnowledge(input.contentRoot, input.gardenId, { migrateSources: false });
  const projection = buildGardenProjection({ gardenDir, gardenId: input.gardenId, gardenTitle: before.title, knowledge });
  if (reusable?.topology.sourceRevision === projection.sourceRevision) {
    return keepExistingTopology();
  }
  input.onProgress?.(18);
  const built = await buildThoughtTopologyFromProjection({
    clusterId: input.clusterId,
    gardenId: input.gardenId,
    gardenTitle: before.title,
    projection,
    oldCache,
    previousTopology: previous,
    signal: input.signal,
    dependencies: input.dependencies,
    contentFingerprint,
    onProgress: input.onProgress,
  });
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");

  const after = readThoughtTopologyRolloutStateById(input.clusterId, database);
  if (!after?.enabled) {
    return { status: "stale", clusterId: input.clusterId, revision: input.revision, nodes: built.topology.nodes.length, edges: built.topology.edges.length, mode: built.topology.build.retrievalMode };
  }
  // The revision counter may move while a build runs (a document delete, a
  // Learn cleanup retry). Publish anyway when the projection is byte-identical:
  // the artifact is exact for the Garden's current content, and refusing would
  // starve a Garden that changes every few minutes, since every build of it
  // would go stale. The newer queued row still runs and confirms from cache.
  // Content that actually changed underneath the build is never published.
  const verificationKnowledge = scanClusterKnowledge(input.contentRoot, input.gardenId, { migrateSources: false });
  const verificationProjection = buildGardenProjection({ gardenDir, gardenId: input.gardenId, gardenTitle: after.title, knowledge: verificationKnowledge });
  input.onProgress?.(98);
  if (verificationProjection.sourceRevision !== projection.sourceRevision) {
    return { status: "stale", clusterId: input.clusterId, revision: input.revision, nodes: built.topology.nodes.length, edges: built.topology.edges.length, mode: built.topology.build.retrievalMode };
  }
  // A garden that already has a semantic map keeps it while the embedding
  // service is down. Concept-lexical scoring rarely clears the affinity
  // threshold, so committing it here would silently replace a connected map
  // with an unconnected one; failing the job leaves the previous map served
  // and the queue row records why.
  if (previous?.build.retrievalMode === "semantic-vector" && built.topology.build.retrievalMode === "concept-lexical") {
    throw new Error("Embedding service unavailable; the previous semantic Thought Topology was kept.");
  }
  commitThoughtTopology(gardenDir, built.cache, built.topology);
  input.onProgress?.(100);
  return {
    status: "built",
    clusterId: input.clusterId,
    revision: input.revision,
    nodes: built.topology.nodes.length,
    edges: built.topology.edges.length,
    mode: built.topology.build.retrievalMode,
    sourceRevision: built.topology.sourceRevision,
  };
}
