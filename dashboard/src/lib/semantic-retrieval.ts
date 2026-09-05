import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import db from './db.ts';
import { embedTexts, embeddingSettings } from './embeddings.ts';
import type { ClusterKnowledge, KnowledgeNode } from './knowledge.ts';
import {
  normalizeLookupText,
  resolveConcept,
  type ClaimRecord,
  type ConceptRegistry,
} from './semantic-core.ts';
import { readGardenSemanticArtifacts } from './garden-semantics.ts';

const DEFAULT_MAX_CHUNKS = 8;
const DEFAULT_CONTEXT_BUDGET = 18_000;
const RRF_K = 60;

// Indexing happens inside a chat request, so it gets a budget rather than as
// long as it takes. Both bounds are per garden, per call; whatever is left over
// is picked up by the next question.
const EMBED_CHUNKS_PER_PASS = 256;
const EMBED_BUDGET_MS = 20_000;
// A single batch, not the whole pass: the pass has its own deadline above.
const EMBED_TIMEOUT_MS = 30_000;

export interface EmbeddingProvider {
  model: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface RetrievalGarden {
  slug: string;
  name: string;
  rootPath: string;
  knowledge: ClusterKnowledge;
}

export interface RetrievalChunk {
  id: string;
  gardenSlug: string;
  gardenName: string;
  pageSlug: string;
  pageRelPath: string;
  pageTitle: string;
  sectionTitle: string;
  heading: string;
  content: string;
  primaryConcepts: string[];
  supportingConcepts: string[];
  claimIds: string[];
  claimTexts: string[];
  evidenceAnchors: string[];
  sourceType: string;
  sourceFile: string;
  locations: string[];
  sourcePriority: number;
  contentHash: string;
}

export interface RankedRetrievalChunk extends RetrievalChunk {
  score: number;
  lexicalRank?: number;
  semanticRank?: number;
  relationshipPaths: string[];
}

export interface RetrievalResult {
  chunks: RankedRetrievalChunk[];
  resolvedConceptIds: string[];
  context: string;
  sources: string[];
  lexicalUsed: boolean;
  semanticUsed: boolean;
  embeddingWarning?: string;
  indexedChunks: number;
}

type SqliteDatabase = Database.Database;

export function createEphemeralRetrievalDatabase(): SqliteDatabase {
  return new Database(':memory:');
}

interface ChunkRow {
  id: string;
  garden_slug: string;
  garden_name: string;
  page_slug: string;
  page_rel_path: string;
  page_title: string;
  section_title: string;
  heading: string;
  content: string;
  primary_concepts: string;
  supporting_concepts: string;
  claim_ids: string;
  claim_texts: string;
  evidence_anchors: string;
  source_type: string;
  source_file: string;
  locations: string;
  source_priority: number;
  content_hash: string;
  vector_json?: string | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function markdownBody(value: string): string {
  return value.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

function jsonStrings(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function chunkFromRow(row: ChunkRow): RetrievalChunk {
  return {
    id: row.id,
    gardenSlug: row.garden_slug,
    gardenName: row.garden_name,
    pageSlug: row.page_slug,
    pageRelPath: row.page_rel_path,
    pageTitle: row.page_title,
    sectionTitle: row.section_title,
    heading: row.heading,
    content: row.content,
    primaryConcepts: jsonStrings(row.primary_concepts),
    supportingConcepts: jsonStrings(row.supporting_concepts),
    claimIds: jsonStrings(row.claim_ids),
    claimTexts: jsonStrings(row.claim_texts),
    evidenceAnchors: jsonStrings(row.evidence_anchors),
    sourceType: row.source_type,
    sourceFile: row.source_file,
    locations: jsonStrings(row.locations),
    sourcePriority: row.source_priority,
    contentHash: row.content_hash,
  };
}

export function ensureSemanticRetrievalSchema(database: SqliteDatabase = db): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS semantic_chunks (
      id TEXT PRIMARY KEY,
      garden_slug TEXT NOT NULL,
      garden_name TEXT NOT NULL,
      page_slug TEXT NOT NULL,
      page_rel_path TEXT NOT NULL,
      page_title TEXT NOT NULL,
      section_title TEXT NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      primary_concepts TEXT NOT NULL,
      supporting_concepts TEXT NOT NULL,
      claim_ids TEXT NOT NULL,
      claim_texts TEXT NOT NULL,
      evidence_anchors TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_file TEXT NOT NULL,
      locations TEXT NOT NULL,
      source_priority INTEGER NOT NULL DEFAULT 0,
      page_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_garden_page
      ON semantic_chunks(garden_slug, page_rel_path);
    CREATE INDEX IF NOT EXISTS idx_semantic_chunks_content_hash
      ON semantic_chunks(content_hash);
    CREATE TABLE IF NOT EXISTS semantic_embedding_cache (
      content_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      vector_json TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(content_hash, model)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS semantic_chunks_fts USING fts5(
      id UNINDEXED,
      garden_slug UNINDEXED,
      title,
      heading,
      content,
      concepts,
      claims,
      anchors,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
}

/**
 * Remove indexed learner content for one garden without touching source
 * chunks or another garden's rows. Passing no page paths clears every indexed
 * `learning/` page for the garden. A caller that has independently verified a
 * generated page outside that tree may include it in
 * `verifiedGeneratedPageRelPaths`.
 *
 * FTS rows must be removed while the base rows still exist because their ids
 * are selected from `semantic_chunks`.
 */
export function clearLearnSemanticChunks(
  input: {
    gardenSlug: string;
    pageRelPaths?: readonly string[];
    verifiedGeneratedPageRelPaths?: readonly string[];
  },
  database: SqliteDatabase = db,
): { deletedChunks: number; deletedFtsRows: number } {
  ensureSemanticRetrievalSchema(database);
  const gardenSlug = input.gardenSlug.trim();
  if (!gardenSlug) return { deletedChunks: 0, deletedFtsRows: 0 };

  const clearAllLearningPages = input.pageRelPaths === undefined;
  const normalizePaths = (values: readonly string[]): string[] =>
    values
      .map((relPath) =>
        relPath
          .trim()
          .replace(/\\/g, '/')
          .replace(/^\.\//, '')
          .replace(/^\/+/, ''),
      )
      .filter(Boolean);
  const scopedLearningPaths = input.pageRelPaths
    ? normalizePaths(input.pageRelPaths).filter((relPath) =>
        relPath.toLowerCase().startsWith('learning/'))
    : [];
  const verifiedGeneratedPaths = normalizePaths(
    input.verifiedGeneratedPageRelPaths ?? [],
  ).filter((relPath) => {
    const lower = relPath.toLowerCase();
    return lower !== '_index.md' &&
      !lower.startsWith('sources/') &&
      !lower.startsWith('assets/') &&
      !lower.startsWith('.breadboard/');
  });
  const normalizedPaths = Array.from(new Set([
    ...scopedLearningPaths,
    ...verifiedGeneratedPaths,
  ]));
  if (!clearAllLearningPages && normalizedPaths.length === 0) {
    return { deletedChunks: 0, deletedFtsRows: 0 };
  }

  const deleteAllLearningFts = database.prepare(`
    DELETE FROM semantic_chunks_fts
    WHERE id IN (
      SELECT id FROM semantic_chunks
      WHERE garden_slug = ?
        AND lower(replace(page_rel_path, char(92), '/')) LIKE 'learning/%'
    )
  `);
  const deleteAllLearningChunks = database.prepare(`
    DELETE FROM semantic_chunks
    WHERE garden_slug = ?
      AND lower(replace(page_rel_path, char(92), '/')) LIKE 'learning/%'
  `);
  const deletePageFts = database.prepare(`
    DELETE FROM semantic_chunks_fts
    WHERE id IN (
      SELECT id FROM semantic_chunks
      WHERE garden_slug = ?
        AND lower(replace(page_rel_path, char(92), '/')) = lower(?)
    )
  `);
  const deletePageChunks = database.prepare(`
    DELETE FROM semantic_chunks
    WHERE garden_slug = ?
      AND lower(replace(page_rel_path, char(92), '/')) = lower(?)
  `);

  return database.transaction(() => {
    let deletedFtsRows = clearAllLearningPages
      ? deleteAllLearningFts.run(gardenSlug).changes
      : 0;
    for (const relPath of normalizedPaths) {
      deletedFtsRows += deletePageFts.run(gardenSlug, relPath).changes;
    }
    let deletedChunks = clearAllLearningPages
      ? deleteAllLearningChunks.run(gardenSlug).changes
      : 0;
    for (const relPath of normalizedPaths) {
      deletedChunks += deletePageChunks.run(gardenSlug, relPath).changes;
    }
    return { deletedChunks, deletedFtsRows };
  })();
}

function markdownBlocks(value: string): string[] {
  const blocks: string[] = [];
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  let current: string[] = [];
  let inFence = false;
  let inDisplayMath = false;
  const flush = () => {
    const block = current.join('\n').trim();
    if (block) blocks.push(block);
    current = [];
  };
  for (const line of lines) {
    if (/^```/.test(line.trim())) inFence = !inFence;
    if (/^\s*\$\$/.test(line)) inDisplayMath = !inDisplayMath;
    if (!inFence && !inDisplayMath && !line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function splitOversizedBlock(block: string, maxWords: number): string[] {
  if (wordCount(block) <= maxWords) return [block];
  if (/^```|^\$\$/m.test(block)) return [block];
  const sentences = block.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const output: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && wordCount(`${current} ${sentence}`) > maxWords) {
      output.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }
  if (current) output.push(current);
  return output;
}

export function headingAwareChunks(
  markdown: string,
  options: { targetWords?: number; maxWords?: number; overlapWords?: number } = {},
): Array<{ heading: string; content: string }> {
  const targetWords = options.targetWords ?? 600;
  const maxWords = options.maxWords ?? 800;
  const overlapWords = options.overlapWords ?? 60;
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current = { heading: '', body: [] as string[] };
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      if (current.body.length > 0 || current.heading) sections.push(current);
      current = { heading: heading[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.body.length > 0 || current.heading) sections.push(current);

  const output: Array<{ heading: string; content: string }> = [];
  for (const section of sections) {
    const blocks = markdownBlocks(section.body.join('\n')).flatMap((block) =>
      splitOversizedBlock(block, maxWords),
    );
    let selected: string[] = [];
    let selectedWords = 0;
    const flush = () => {
      if (selected.length === 0) return;
      output.push({ heading: section.heading, content: selected.join('\n\n').trim() });
      const words = selected.join(' ').split(/\s+/).filter(Boolean);
      const overlap = words.slice(Math.max(0, words.length - overlapWords)).join(' ');
      selected = overlap ? [overlap] : [];
      selectedWords = overlap ? wordCount(overlap) : 0;
    };
    for (const block of blocks) {
      const count = wordCount(block);
      if (selectedWords >= targetWords || (selectedWords > 0 && selectedWords + count > maxWords)) flush();
      selected.push(block);
      selectedWords += count;
    }
    if (selected.length > 0) {
      const content = selected.join('\n\n').trim();
      if (content) output.push({ heading: section.heading, content });
    }
  }
  return output.filter((chunk) => chunk.content.length > 0);
}

function sectionTitle(node: KnowledgeNode): string {
  const segments = node.relPath.replace(/\\/g, '/').split('/');
  const root = segments[0]?.toLowerCase();
  return segments.length >= 3 && (root === 'learning' || root === 'concepts')
    ? segments[1]
    : '';
}

function sourcePriority(sourceType: string): number {
  const normalized = normalizeLookupText(sourceType);
  if (/lecture|notes?/.test(normalized)) return 4;
  if (/exam|solution|resit/.test(normalized)) return 3;
  if (/reader|textbook/.test(normalized)) return 2;
  if (/slides?|tutorial|lab/.test(normalized)) return 1;
  return 0;
}

function conceptSearchTerms(slugs: string[], registry: ConceptRegistry): string[] {
  return slugs.flatMap((slug) => {
    const concept = resolveConcept(slug, registry);
    return concept ? [concept.slug, concept.preferredLabel, ...concept.aliases] : [slug];
  });
}

function retrievalChunksForNode(input: {
  garden: RetrievalGarden;
  node: KnowledgeNode;
  registry: ConceptRegistry;
  claims: ClaimRecord[];
}): RetrievalChunk[] {
  const { garden, node, registry } = input;
  const pageClaims = input.claims.filter(
    (claim) => claim.pageRelPath === node.relPath || node.claimIds.includes(claim.id),
  );
  const evidenceAnchors = [...new Set([
    ...node.sourceAnchors,
    ...pageClaims.flatMap((claim) => claim.evidenceAnchors),
    ...node.locations,
  ])];
  const conceptTerms = conceptSearchTerms([...node.primaryConcepts, ...node.supportingConcepts], registry);
  const pageContent = markdownBody(node.content);
  const chunks = headingAwareChunks(pageContent);
  // Garden navigation needs the full nested path, not the basename-only graph
  // slug. Basename links sent every page inside a folder to a non-existent
  // root URL and produced the persistent "garden is being prepared" fallback.
  const pageSlug = node.relPath.replace(/\\/g, '/').replace(/\.md$/i, '');
  const pageContext = JSON.stringify({
    page: node.relPath,
    pageSlug,
    title: node.title,
    concepts: conceptTerms,
    claims: pageClaims.map((claim) => claim.text),
    anchors: evidenceAnchors,
  });
  const pageHash = sha256(pageContext + pageContent);
  return chunks.map((chunk, index) => {
    const contextPrefix = [
      `Garden: ${garden.name}`,
      sectionTitle(node) ? `Section: ${sectionTitle(node)}` : '',
      `Page: ${node.title}`,
      chunk.heading ? `Heading: ${chunk.heading}` : '',
      node.primaryConcepts.length > 0 ? `Primary concepts: ${conceptSearchTerms(node.primaryConcepts, registry).join(', ')}` : '',
      node.supportingConcepts.length > 0 ? `Supporting concepts: ${conceptSearchTerms(node.supportingConcepts, registry).join(', ')}` : '',
      node.sourceType ? `Source type: ${node.sourceType}` : '',
      evidenceAnchors.length > 0 ? `Evidence anchors: ${evidenceAnchors.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    const contentHash = sha256(`${contextPrefix}\n\n${chunk.content}`);
    return {
      id: sha256(`${garden.slug}:${node.relPath}:${index}:${contentHash}`).slice(0, 32),
      gardenSlug: garden.slug,
      gardenName: garden.name,
      pageSlug,
      pageRelPath: node.relPath,
      pageTitle: node.title,
      sectionTitle: sectionTitle(node),
      heading: chunk.heading,
      content: chunk.content,
      primaryConcepts: node.primaryConcepts,
      supportingConcepts: node.supportingConcepts,
      claimIds: pageClaims.map((claim) => claim.id),
      claimTexts: pageClaims.map((claim) => claim.text),
      evidenceAnchors,
      sourceType: node.sourceType,
      sourceFile: node.sourceFile || node.fileName,
      locations: node.locations,
      sourcePriority: sourcePriority(node.sourceType),
      contentHash,
      pageHash,
      conceptTerms,
    } as RetrievalChunk & { pageHash: string; conceptTerms: string[] };
  });
}

/**
 * The embedder this retriever uses when a caller does not supply one.
 *
 * This used to require `BREADBOARD_EMBEDDING_MODEL` and a paid key, and
 * returned null without them — so on a normal install the semantic half of this
 * "hybrid" retriever never ran and every answer was lexical. It now defaults to
 * ChatMock's local model, which needs neither. `BREADBOARD_EMBEDDINGS=off`
 * restores the old behaviour deliberately rather than by omission.
 */
export function embeddingProviderFromEnv(): EmbeddingProvider | null {
  const settings = embeddingSettings();
  if (!settings.model) return null;
  return {
    model: settings.model,
    async embed(texts: string[]) {
      if (texts.length === 0) return [];
      const { vectors } = await embedTexts(texts, settings, { timeoutMs: EMBED_TIMEOUT_MS });
      return vectors;
    },
  };
}

/**
 * Fill in the vectors this garden is missing, without holding up the answer.
 *
 * Indexing runs inside `retrieveGraphRag`, which runs inside a chat request, so
 * an unbounded first pass over a large garden would stall a reply for minutes
 * the first time anyone asked it anything. The budget makes the index warm over
 * successive questions instead: a chunk with no vector simply scores zero on
 * the semantic side and is still reachable lexically, so partial coverage
 * degrades smoothly rather than lying.
 */
async function cacheMissingEmbeddings(
  database: SqliteDatabase,
  chunks: RetrievalChunk[],
  provider: EmbeddingProvider,
): Promise<void> {
  const existing = database.prepare(
    'SELECT 1 FROM semantic_embedding_cache WHERE content_hash = ? AND model = ?',
  );
  const missing = chunks
    .filter((chunk) => !existing.get(chunk.contentHash, provider.model))
    .slice(0, EMBED_CHUNKS_PER_PASS);
  const insert = database.prepare(`
    INSERT OR REPLACE INTO semantic_embedding_cache
      (content_hash, model, vector_json, dimensions, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const deadline = Date.now() + EMBED_BUDGET_MS;
  for (let index = 0; index < missing.length; index += 32) {
    if (Date.now() > deadline) break;
    const batch = missing.slice(index, index + 32);
    const vectors = await provider.embed(batch.map((chunk) => chunk.content));
    const transaction = database.transaction(() => {
      for (let vectorIndex = 0; vectorIndex < batch.length; vectorIndex += 1) {
        const vector = vectors[vectorIndex];
        if (!Array.isArray(vector) || vector.length === 0) continue;
        insert.run(
          batch[vectorIndex].contentHash,
          provider.model,
          JSON.stringify(vector),
          vector.length,
          new Date().toISOString(),
        );
      }
    });
    transaction();
  }
}

export async function indexRetrievalGarden(input: {
  garden: RetrievalGarden;
  database?: SqliteDatabase;
  embeddingProvider?: EmbeddingProvider | null;
}): Promise<{ indexedChunks: number; changedPages: number; embeddingWarning?: string }> {
  const database = input.database ?? db;
  ensureSemanticRetrievalSchema(database);
  const { registry, claims } = readGardenSemanticArtifacts(input.garden.rootPath, input.garden.slug);
  const eligibleNodes = input.garden.knowledge.nodes.filter(
    (node) =>
      node.internal !== 'true' &&
      node.draft !== 'true' &&
      (node.type === 'learning-page' ||
        node.breadboardType === 'learning_page' ||
        node.type === 'source-document'),
  );
  const chunks = eligibleNodes.flatMap((node) =>
    retrievalChunksForNode({ garden: input.garden, node, registry, claims: claims.claims }),
  );
  const chunksByPage = new Map<string, Array<RetrievalChunk & { pageHash: string; conceptTerms: string[] }>>();
  for (const chunk of chunks as Array<RetrievalChunk & { pageHash: string; conceptTerms: string[] }>) {
    const list = chunksByPage.get(chunk.pageRelPath) ?? [];
    list.push(chunk);
    chunksByPage.set(chunk.pageRelPath, list);
  }
  const currentPageHashes = database.prepare(
    'SELECT page_hash FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path = ? LIMIT 1',
  );
  const deleteFts = database.prepare(
    'DELETE FROM semantic_chunks_fts WHERE id IN (SELECT id FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path = ?)',
  );
  const deleteChunks = database.prepare(
    'DELETE FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path = ?',
  );
  const insertChunk = database.prepare(`
    INSERT INTO semantic_chunks (
      id, garden_slug, garden_name, page_slug, page_rel_path, page_title,
      section_title, heading, content, primary_concepts, supporting_concepts,
      claim_ids, claim_texts, evidence_anchors, source_type, source_file,
      locations, source_priority, page_hash, content_hash, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = database.prepare(`
    INSERT INTO semantic_chunks_fts
      (id, garden_slug, title, heading, content, concepts, claims, anchors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let changedPages = 0;
  const writePage = database.transaction((pageChunks: Array<RetrievalChunk & { pageHash: string; conceptTerms: string[] }>) => {
    const first = pageChunks[0];
    deleteFts.run(first.gardenSlug, first.pageRelPath);
    deleteChunks.run(first.gardenSlug, first.pageRelPath);
    for (const chunk of pageChunks) {
      insertChunk.run(
        chunk.id, chunk.gardenSlug, chunk.gardenName, chunk.pageSlug, chunk.pageRelPath,
        chunk.pageTitle, chunk.sectionTitle, chunk.heading, chunk.content,
        JSON.stringify(chunk.primaryConcepts), JSON.stringify(chunk.supportingConcepts),
        JSON.stringify(chunk.claimIds), JSON.stringify(chunk.claimTexts),
        JSON.stringify(chunk.evidenceAnchors), chunk.sourceType, chunk.sourceFile,
        JSON.stringify(chunk.locations), chunk.sourcePriority, chunk.pageHash,
        chunk.contentHash, new Date().toISOString(),
      );
      insertFts.run(
        chunk.id, chunk.gardenSlug, chunk.pageTitle, chunk.heading, chunk.content,
        chunk.conceptTerms.join(' '), chunk.claimTexts.join(' '), chunk.evidenceAnchors.join(' '),
      );
    }
  });
  for (const pageChunks of chunksByPage.values()) {
    const existing = currentPageHashes.get(
      input.garden.slug,
      pageChunks[0].pageRelPath,
    ) as { page_hash?: string } | undefined;
    if (existing?.page_hash === pageChunks[0].pageHash) continue;
    writePage(pageChunks);
    changedPages += 1;
  }
  const validPages = new Set(chunksByPage.keys());
  const stale = database.prepare(
    'SELECT DISTINCT page_rel_path FROM semantic_chunks WHERE garden_slug = ?',
  ).all(input.garden.slug) as Array<{ page_rel_path: string }>;
  for (const row of stale) {
    if (validPages.has(row.page_rel_path)) continue;
    deleteFts.run(input.garden.slug, row.page_rel_path);
    deleteChunks.run(input.garden.slug, row.page_rel_path);
  }

  let embeddingWarning: string | undefined;
  if (input.embeddingProvider) {
    try {
      await cacheMissingEmbeddings(database, chunks, input.embeddingProvider);
    } catch (error) {
      embeddingWarning = error instanceof Error ? error.message : 'Embedding indexing failed';
    }
  }
  return { indexedChunks: chunks.length, changedPages, ...(embeddingWarning ? { embeddingWarning } : {}) };
}

function ftsQuery(value: string): string {
  const tokens = normalizeLookupText(value)
    .split(' ')
    .filter((token) => token.length > 1)
    .slice(0, 24);
  return [...new Set(tokens)].map((token) => `"${token.replace(/"/g, '')}"`).join(' OR ');
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function conceptMatches(chunk: RetrievalChunk, slugs: Set<string>): { primary: number; supporting: number } {
  return {
    primary: chunk.primaryConcepts.filter((slug) => slugs.has(slug)).length,
    supporting: chunk.supportingConcepts.filter((slug) => slugs.has(slug)).length,
  };
}

function tokenOverlap(query: string, value: string): number {
  const queryTokens = new Set(normalizeLookupText(query).split(' ').filter((token) => token.length > 1));
  const valueTokens = new Set(normalizeLookupText(value).split(' ').filter(Boolean));
  let hits = 0;
  for (const token of queryTokens) if (valueTokens.has(token)) hits += 1;
  return queryTokens.size > 0 ? hits / queryTokens.size : 0;
}

function relationNeighbors(
  conceptIds: Set<string>,
  registry: ConceptRegistry,
  claims: ClaimRecord[],
): Map<string, string> {
  const neighbors = new Map<string, string>();
  const allowed = new Set([
    'prerequisite-of', 'measured-by', 'derived-from', 'contrasts-with',
    'limits', 'example-of', 'causes', 'enables', 'applies-to', 'emits-when',
  ]);
  const add = (source: string, predicate: string, target: string) => {
    if (!conceptIds.has(source) || !allowed.has(predicate)) return;
    const targetConcept = registry.concepts.find((concept) => concept.id === target);
    if (targetConcept && !neighbors.has(targetConcept.slug)) {
      neighbors.set(targetConcept.slug, `${source} -[${predicate}]-> ${target}`);
    }
  };
  for (const concept of registry.concepts) {
    for (const relation of concept.relations) add(concept.id, relation.predicate, relation.target);
    for (const target of concept.broader) add(concept.id, 'prerequisite-of', target);
    for (const target of concept.related) add(concept.id, 'related-to', target);
  }
  for (const claim of claims) {
    if (claim.object) add(claim.subject, claim.predicate, claim.object);
  }
  return neighbors;
}

function rowsForGardens(database: SqliteDatabase, gardenSlugs: string[]): ChunkRow[] {
  if (gardenSlugs.length === 0) return [];
  const placeholders = gardenSlugs.map(() => '?').join(', ');
  return database.prepare(
    `SELECT * FROM semantic_chunks WHERE garden_slug IN (${placeholders})`,
  ).all(...gardenSlugs) as ChunkRow[];
}

export async function retrieveGraphRag(input: {
  query: string;
  gardens: RetrievalGarden[];
  database?: SqliteDatabase;
  embeddingProvider?: EmbeddingProvider | null;
  maxChunks?: number;
  contextBudget?: number;
}): Promise<RetrievalResult> {
  const database = input.database ?? db;
  const provider = input.embeddingProvider === undefined
    ? embeddingProviderFromEnv()
    : input.embeddingProvider;
  let indexedChunks = 0;
  let embeddingWarning: string | undefined;
  for (const garden of input.gardens) {
    const indexed = await indexRetrievalGarden({ garden, database, embeddingProvider: provider });
    indexedChunks += indexed.indexedChunks;
    if (indexed.embeddingWarning) embeddingWarning = indexed.embeddingWarning;
  }

  const gardenSlugs = input.gardens.map((garden) => garden.slug);
  const registries = new Map<string, ConceptRegistry>();
  const claimsByGarden = new Map<string, ClaimRecord[]>();
  const resolvedConceptIds = new Set<string>();
  const resolvedSlugs = new Set<string>();
  const expansionTerms: string[] = [];
  for (const garden of input.gardens) {
    const artifacts = readGardenSemanticArtifacts(garden.rootPath, garden.slug);
    registries.set(garden.slug, artifacts.registry);
    claimsByGarden.set(garden.slug, artifacts.claims.claims);
    for (const concept of artifacts.registry.concepts) {
      const terms = [concept.slug, concept.preferredLabel, ...concept.aliases];
      const normalizedQuery = normalizeLookupText(input.query);
      if (!terms.some((term) => {
        const normalized = normalizeLookupText(term);
        return normalized && (normalizedQuery === normalized || normalizedQuery.includes(normalized));
      })) continue;
      resolvedConceptIds.add(concept.id);
      resolvedSlugs.add(concept.slug);
      expansionTerms.push(concept.preferredLabel, ...concept.aliases);
    }
  }

  const lexicalQuery = ftsQuery([input.query, ...expansionTerms].join(' '));
  const lexicalRows: ChunkRow[] = [];
  if (lexicalQuery && gardenSlugs.length > 0) {
    const placeholders = gardenSlugs.map(() => '?').join(', ');
    lexicalRows.push(...database.prepare(`
      SELECT c.*
      FROM semantic_chunks_fts
      JOIN semantic_chunks c ON c.id = semantic_chunks_fts.id
      WHERE semantic_chunks_fts MATCH ?
        AND c.garden_slug IN (${placeholders})
      ORDER BY bm25(semantic_chunks_fts, 0.0, 0.0, 8.0, 5.0, 1.0, 4.0, 3.0, 7.0)
      LIMIT 60
    `).all(lexicalQuery, ...gardenSlugs) as ChunkRow[]);
  }

  let semanticRows: ChunkRow[] = [];
  let semanticUsed = false;
  if (provider && !embeddingWarning) {
    try {
      const [queryVector] = await provider.embed([input.query]);
      const rows = rowsForGardens(database, gardenSlugs);
      const vectorStatement = database.prepare(
        'SELECT vector_json FROM semantic_embedding_cache WHERE content_hash = ? AND model = ?',
      );
      semanticRows = rows
        .map((row) => {
          const cached = vectorStatement.get(row.content_hash, provider.model) as { vector_json?: string } | undefined;
          const vector = cached?.vector_json ? JSON.parse(cached.vector_json) as number[] : [];
          return { row, score: cosineSimilarity(queryVector ?? [], vector) };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 60)
        .map((item) => item.row);
      semanticUsed = semanticRows.length > 0;
    } catch (error) {
      embeddingWarning = error instanceof Error ? error.message : 'Embedding retrieval failed';
    }
  }

  const fused = new Map<string, RankedRetrievalChunk>();
  const addRank = (rows: ChunkRow[], kind: 'lexical' | 'semantic') => {
    rows.forEach((row, index) => {
      const chunk = chunkFromRow(row);
      const current = fused.get(chunk.id) ?? { ...chunk, score: 0, relationshipPaths: [] };
      current.score += 1 / (RRF_K + index + 1);
      if (kind === 'lexical') current.lexicalRank = index + 1;
      else current.semanticRank = index + 1;
      fused.set(chunk.id, current);
    });
  };
  addRank(lexicalRows, 'lexical');
  addRank(semanticRows, 'semantic');

  for (const chunk of fused.values()) {
    const matches = conceptMatches(chunk, resolvedSlugs);
    chunk.score += matches.primary * 0.18 + matches.supporting * 0.08;
    chunk.score += tokenOverlap(input.query, chunk.pageTitle) * 0.14;
    chunk.score += tokenOverlap(input.query, chunk.claimTexts.join(' ')) * 0.12;
    if (chunk.evidenceAnchors.some((anchor) => normalizeLookupText(input.query).includes(normalizeLookupText(anchor)))) {
      chunk.score += 0.25;
    }
    if (chunk.evidenceAnchors.length > 0) chunk.score += 0.04;
    chunk.score += chunk.sourcePriority * 0.01;
  }

  const allRows = rowsForGardens(database, gardenSlugs);
  for (const garden of input.gardens) {
    const registry = registries.get(garden.slug)!;
    const directIds = new Set(
      [...resolvedConceptIds].filter((id) => registry.concepts.some((concept) => concept.id === id)),
    );
    for (const chunk of [...fused.values()].filter((item) => item.gardenSlug === garden.slug).slice(0, 4)) {
      for (const slug of [...chunk.primaryConcepts, ...chunk.supportingConcepts]) {
        const concept = resolveConcept(slug, registry);
        if (concept) directIds.add(concept.id);
      }
    }
    const neighbors = relationNeighbors(directIds, registry, claimsByGarden.get(garden.slug) ?? []);
    let expanded = 0;
    for (const [slug, relationPath] of neighbors) {
      const candidates = allRows
        .filter((row) => row.garden_slug === garden.slug)
        .map(chunkFromRow)
        .filter((chunk) => chunk.primaryConcepts.includes(slug) || chunk.supportingConcepts.includes(slug))
        .slice(0, 2);
      for (const chunk of candidates) {
        const current = fused.get(chunk.id) ?? { ...chunk, score: 0.01, relationshipPaths: [] };
        current.score += chunk.primaryConcepts.includes(slug) ? 0.08 : 0.04;
        if (!current.relationshipPaths.includes(relationPath)) current.relationshipPaths.push(relationPath);
        fused.set(chunk.id, current);
        expanded += 1;
        if (expanded >= 6) break;
      }
      if (expanded >= 6) break;
    }
  }

  const maxChunks = Math.max(1, Math.min(input.maxChunks ?? DEFAULT_MAX_CHUNKS, 16));
  const budget = Math.max(2_000, input.contextBudget ?? DEFAULT_CONTEXT_BUDGET);
  const ranked = [...fused.values()].sort(
    (left, right) => right.score - left.score || left.id.localeCompare(right.id),
  );
  const selected: RankedRetrievalChunk[] = [];
  const selectedIds = new Set<string>();
  const chunksPerPage = new Map<string, number>();
  let usedCharacters = 0;
  const trySelect = (chunk: RankedRetrievalChunk): boolean => {
    const estimate = chunk.content.length + chunk.claimTexts.join(' ').length + 500;
    if (selected.length > 0 && usedCharacters + estimate > budget) return false;
    selected.push(chunk);
    selectedIds.add(chunk.id);
    chunksPerPage.set(chunk.pageRelPath, (chunksPerPage.get(chunk.pageRelPath) ?? 0) + 1);
    usedCharacters += estimate;
    return true;
  };
  // Preserve page diversity before adding a second chunk from any page. This
  // prevents a long high-scoring page from consuming the entire context budget.
  for (const chunk of ranked) {
    if ((chunksPerPage.get(chunk.pageRelPath) ?? 0) > 0) continue;
    trySelect(chunk);
    if (selected.length >= maxChunks) break;
  }
  if (selected.length < maxChunks) {
    for (const chunk of ranked) {
      if (selectedIds.has(chunk.id) || (chunksPerPage.get(chunk.pageRelPath) ?? 0) >= 2) continue;
      trySelect(chunk);
      if (selected.length >= maxChunks) break;
    }
  }
  const context = selected.map((chunk, index) => [
    `## Retrieved evidence ${index + 1}: ${chunk.pageTitle}`,
    `Garden: ${chunk.gardenName}`,
    chunk.sectionTitle ? `Section: ${chunk.sectionTitle}` : '',
    chunk.heading ? `Heading: ${chunk.heading}` : '',
    `Page path: ${chunk.pageRelPath}`,
    `Source: ${chunk.sourceFile}`,
    chunk.locations.length > 0 ? `Locations: ${chunk.locations.join(', ')}` : '',
    chunk.evidenceAnchors.length > 0 ? `Evidence anchors: ${chunk.evidenceAnchors.join(', ')}` : '',
    chunk.primaryConcepts.length > 0 ? `Primary concepts: ${chunk.primaryConcepts.join(', ')}` : '',
    chunk.supportingConcepts.length > 0 ? `Supporting concepts: ${chunk.supportingConcepts.join(', ')}` : '',
    chunk.claimTexts.length > 0 ? `Claims:\n${chunk.claimTexts.map((claim) => `- ${claim}`).join('\n')}` : '',
    chunk.relationshipPaths.length > 0 ? `Relationship paths:\n${chunk.relationshipPaths.map((relation) => `- ${relation}`).join('\n')}` : '',
    '',
    chunk.content,
  ].filter((line) => line !== '').join('\n')).join('\n\n---\n\n');
  const sources = [...new Set(selected.map((chunk) => `${chunk.pageTitle} (${chunk.gardenName})`))];
  return {
    chunks: selected,
    resolvedConceptIds: [...resolvedConceptIds].sort(),
    context,
    sources,
    lexicalUsed: lexicalRows.length > 0,
    semanticUsed,
    ...(embeddingWarning ? { embeddingWarning } : {}),
    indexedChunks,
  };
}

export function reciprocalRankFusion<T extends { id: string }>(
  rankings: T[][],
  k = RRF_K,
): Array<{ item: T; score: number }> {
  const fused = new Map<string, { item: T; score: number }>();
  for (const ranking of rankings) {
    ranking.forEach((item, index) => {
      const current = fused.get(item.id) ?? { item, score: 0 };
      current.score += 1 / (k + index + 1);
      fused.set(item.id, current);
    });
  }
  return [...fused.values()].sort(
    (left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id),
  );
}
