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
import { buildGardenProjection, type GardenProjection, type ProjectedTopologyNode } from "./projection.ts";
import {
  adaptiveThreshold,
  edgeVisualStyle,
  mergeAuthoredPairs,
  scoreAffinityPairs,
  selectSparseInferredEdges,
  stableHashText,
  THOUGHT_TOPOLOGY_SCORING,
} from "./scoring.ts";
import { commitThoughtTopology, readThoughtTopologyCache } from "./storage.ts";
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
    if (old && Number.isFinite(old.x) && Number.isFinite(old.y) && next && folder.depth > 1) {
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
): TopologyEvidence[] {
  const evidence: TopologyEvidence[] = sharedConcepts(left, right).slice(0, 5)
    .map((concept) => ({ kind: "concept", label: concept }));
  for (const claim of [...left.claimTexts, ...right.claimTexts].slice(0, 3)) {
    evidence.push({ kind: "claim", label: claim.slice(0, 240) });
  }
  if (origin !== "inferred") evidence.push({ kind: "authored", label: "Explicit Markdown relationship" });
  if (evidence.length === 0) evidence.push({ kind: "lexical", label: "Deterministic semantic projection overlap" });
  return evidence;
}

async function embedChangedNodes(
  nodes: ProjectedTopologyNode[],
  oldCache: ThoughtTopologyCache | null,
  versions: TopologyCacheVersions,
  embed: ThoughtTopologyBuildDependencies["embed"],
  signal?: AbortSignal,
): Promise<{ records: Record<string, ThoughtTopologyCacheNode>; available: boolean; model: string; dimension: number }> {
  const records: Record<string, ThoughtTopologyCacheNode> = {};
  const changed: ProjectedTopologyNode[] = [];
  for (const node of nodes) {
    const hashes = nodeCacheHashes(node.contentHash, versions);
    const old = oldCache?.nodes[node.id];
    if (old?.embeddingHash === hashes.embeddingHash && old.embeddingModel === versions.embeddingModel && old.embedding?.length) {
      records[node.id] = { ...old, id: node.id, folderId: node.folderId, contentHash: node.contentHash, semanticText: node.semanticText, lexicalText: node.lexicalText };
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
        summary: old?.summaryHash === hashes.summaryHash
          ? old.summary
          : extractiveNodeSummary(node.title, node.semanticText),
      };
    }
  }
  if (changed.length > 0 && embed) {
    try {
      for (let offset = 0; offset < changed.length; offset += 64) {
        const batch = changed.slice(offset, offset + 64);
        const response = await embed(batch.map((node) => node.semanticText), signal);
        if (response.model !== versions.embeddingModel || response.vectors.length !== batch.length || response.vectors.some((vector) => vector.length !== response.dimension)) {
          throw new Error("embedding_identity_mismatch");
        }
        batch.forEach((node, index) => {
          records[node.id].embedding = response.vectors[index];
          records[node.id].embeddingDimension = response.dimension;
          records[node.id].embeddingModel = response.model;
        });
      }
    } catch {
      // One incomplete vector space is worse than deterministic degradation.
      for (const record of Object.values(records)) {
        record.embedding = null;
        record.embeddingDimension = 0;
      }
    }
  }
  const dimensions = new Set(Object.values(records).map((record) => record.embedding?.length ?? 0));
  const available = nodes.length > 0 && dimensions.size === 1 && !dimensions.has(0);
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
  signal?: AbortSignal;
  dependencies?: ThoughtTopologyBuildDependencies;
}): Promise<{ topology: ThoughtTopology; cache: ThoughtTopologyCache }> {
  const dependencies = input.dependencies ?? {};
  const versions = dependencies.cacheVersions ?? DEFAULT_TOPOLOGY_CACHE_VERSIONS;
  const generator = dependencies.generator === undefined
    ? createDefaultTopologyGenerator(versions.summaryModel)
    : dependencies.generator ?? undefined;
  const embed = dependencies.embed ?? ((texts, signal) => new GBrainClient().embed(texts, signal));
  const embedding = await embedChangedNodes(input.projection.nodes, input.oldCache, versions, embed, input.signal);
  const positions = positionNodes(input.projection, input.oldCache);

  const changedForSummary = input.projection.nodes.filter((node) => {
    const hashes = nodeCacheHashes(node.contentHash, versions);
    return input.oldCache?.nodes[node.id]?.summaryHash !== hashes.summaryHash;
  });
  const summaries = await mapWithConcurrency(changedForSummary, 3, (node) =>
    enrichNodeSummary({ title: node.title, semanticText: node.semanticText, generator, model: versions.summaryModel }));
  changedForSummary.forEach((node, index) => {
    embedding.records[node.id].summary = summaries[index];
    embedding.records[node.id].summaryHash = nodeCacheHashes(node.contentHash, versions).summaryHash;
  });
  for (const node of input.projection.nodes) {
    node.summary = embedding.records[node.id].summary;
    const position = positions.get(node.id);
    if (position) {
      Object.assign(node, position);
      Object.assign(embedding.records[node.id], position);
    }
    node.embedding = embedding.records[node.id].embedding;
  }

  const candidates = scoreAffinityPairs(input.projection.nodes, embedding.available);
  const threshold = adaptiveThreshold(candidates.map((candidate) => candidate.score));
  const inferred = selectSparseInferredEdges(candidates, threshold);
  const merged = mergeAuthoredPairs(inferred, input.projection.authoredEdges, candidates);
  const byId = new Map(input.projection.nodes.map((node) => [node.id, node]));
  const nextEdgeCache: ThoughtTopologyCache["edges"] = {};
  const edgeInputs = merged.flatMap((candidate) => {
    const left = byId.get(candidate.source);
    const right = byId.get(candidate.target);
    if (!left || !right) return [];
    const evidence = edgeEvidence(left, right, candidate.origin);
    const pairHash = topologyPairHash(embedding.records[left.id].embeddingHash, embedding.records[right.id].embeddingHash, versions);
    const explanationHash = edgeExplanationHash(pairHash, evidence, versions);
    return [{ candidate, left, right, evidence, pairHash, explanationHash, old: input.oldCache?.edges[pairHash] }];
  });
  const changedEdges = edgeInputs.filter((edge) => edge.old?.explanationHash !== edge.explanationHash);
  const edgeEnrichments = await mapWithConcurrency(changedEdges, 3, (edge) =>
    enrichEdgeExplanation({
      sourceTitle: edge.left.title,
      targetTitle: edge.right.title,
      sourceProjection: edge.left.semanticText,
      targetProjection: edge.right.semanticText,
      sharedConcepts: sharedConcepts(edge.left, edge.right),
      components: edge.candidate.components,
      score: edge.candidate.score,
      threshold,
      generator,
      model: versions.summaryModel,
    }));
  const enrichmentByHash = new Map(changedEdges.map((edge, index) => [edge.explanationHash, edgeEnrichments[index]]));
  const edges: TopologyEdge[] = edgeInputs.map((edge) => {
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

  const folderPositions = new Map(input.projection.folders.map((folder) => [folder.id, { x: folder.x, y: folder.y }]));
  for (const folder of input.projection.folders) {
    const childTitles = input.projection.nodes.filter((node) => node.folderId === folder.id).map((node) => node.title);
    const semanticText = `${folder.title}. Pages: ${childTitles.join(", ") || "none"}.`;
    const contentHash = stableHashText("folder-summary", semanticText);
    const hashes = nodeCacheHashes(contentHash, versions);
    const old = input.oldCache?.nodes[`meta:${folder.id}`];
    const summary = old?.summaryHash === hashes.summaryHash
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
  }
  const gardenSemanticText = `${input.gardenTitle}. Folders: ${input.projection.folders.filter((folder) => folder.depth === 1).map((folder) => folder.title).join(", ")}. Pages: ${input.projection.nodes.slice(0, 80).map((node) => node.title).join(", ")}.`;
  const gardenContentHash = stableHashText("garden-summary", gardenSemanticText);
  const gardenHashes = nodeCacheHashes(gardenContentHash, versions);
  const oldGarden = input.oldCache?.nodes["meta:garden"];
  const gardenSummary = oldGarden?.summaryHash === gardenHashes.summaryHash
    ? oldGarden.summary
    : await enrichNodeSummary({ title: input.gardenTitle, semanticText: gardenSemanticText, generator, model: versions.summaryModel });
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
    nodes: input.projection.nodes.map(({ semanticText: _semanticText, lexicalText: _lexicalText, claimTexts: _claimTexts, headings: _headings, embedding: _embedding, ...node }) => node),
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
  const knowledge = scanClusterKnowledge(input.contentRoot, input.gardenId, { migrateSources: false });
  const projection = buildGardenProjection({ gardenDir, gardenId: input.gardenId, gardenTitle: before.title, knowledge });
  const oldCache = readThoughtTopologyCache(gardenDir);
  const built = await buildThoughtTopologyFromProjection({
    clusterId: input.clusterId,
    gardenId: input.gardenId,
    gardenTitle: before.title,
    projection,
    oldCache,
    signal: input.signal,
    dependencies: input.dependencies,
  });
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");

  const after = readThoughtTopologyRolloutStateById(input.clusterId, database);
  if (!after?.enabled || after.revision !== input.revision) {
    return { status: "stale", clusterId: input.clusterId, revision: input.revision, nodes: built.topology.nodes.length, edges: built.topology.edges.length, mode: built.topology.build.retrievalMode };
  }
  const verificationKnowledge = scanClusterKnowledge(input.contentRoot, input.gardenId, { migrateSources: false });
  const verificationProjection = buildGardenProjection({ gardenDir, gardenId: input.gardenId, gardenTitle: after.title, knowledge: verificationKnowledge });
  if (verificationProjection.sourceRevision !== projection.sourceRevision) {
    return { status: "stale", clusterId: input.clusterId, revision: input.revision, nodes: built.topology.nodes.length, edges: built.topology.edges.length, mode: built.topology.build.retrievalMode };
  }
  commitThoughtTopology(gardenDir, built.cache, built.topology);
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
