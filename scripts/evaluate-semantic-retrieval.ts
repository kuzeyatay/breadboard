import fs from 'node:fs';
import path from 'node:path';
import {
  createEphemeralRetrievalDatabase,
  retrieveGraphRag,
} from '../dashboard/src/lib/semantic-retrieval.ts';
import {
  parseSemanticMarkdown,
  semanticFrontmatterArray,
  validateGardenSemantics,
} from '../dashboard/src/lib/garden-semantics.ts';

interface EvaluationQuery {
  query: string;
  expectedPages: string[];
  expectedAnchors?: string[];
}

interface EvaluationFixture {
  k?: number;
  queries: EvaluationQuery[];
}

function frontmatterString(data: Record<string, string | string[]>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

function scanEvaluationKnowledge(gardenDir: string) {
  const nodes: Array<Record<string, unknown>> = [];
  const walk = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md') || entry.name === '_index.md') continue;
      const relPath = path.relative(gardenDir, absolute).replace(/\\/g, '/');
      const parsed = parseSemanticMarkdown(fs.readFileSync(absolute, 'utf8'));
      const inLearning = relPath.startsWith('learning/');
      const inSources = relPath.startsWith('sources/');
      if (!inLearning && !inSources) continue;
      const type = inSources ? 'source-document' : frontmatterString(parsed.data, 'knowledge_type') || 'learning-page';
      if (inLearning && type !== 'learning-page' && type !== 'textbook-page') continue;
      const title = frontmatterString(parsed.data, 'title') || path.basename(entry.name, '.md');
      const primaryConcepts = inLearning ? semanticFrontmatterArray(parsed.data, 'primaryConcepts') : [];
      const supportingConcepts = inLearning ? semanticFrontmatterArray(parsed.data, 'supportingConcepts') : [];
      const words = parsed.body.split(/\s+/).filter(Boolean);
      nodes.push({
        id: relPath,
        slug: path.basename(entry.name, '.md'),
        fileName: entry.name,
        folder: path.dirname(relPath).replace(/\\/g, '/'),
        relPath,
        title,
        type,
        sourceType: frontmatterString(parsed.data, 'source_type'),
        sourceFile: frontmatterString(parsed.data, 'source_file'),
        sourcePdf: frontmatterString(parsed.data, 'source_pdf'),
        sourceDocument: frontmatterString(parsed.data, 'source_document'),
        textbookPage: '',
        breadboardType: frontmatterString(parsed.data, 'breadboardType'),
        draft: frontmatterString(parsed.data, 'draft'),
        generatedBy: frontmatterString(parsed.data, 'generatedBy'),
        generated_by: frontmatterString(parsed.data, 'generated_by'),
        internal: frontmatterString(parsed.data, 'internal'),
        flagColor: frontmatterString(parsed.data, 'flag_color'),
        locations: semanticFrontmatterArray(parsed.data, 'locations'),
        sourceAnchors: semanticFrontmatterArray(parsed.data, 'sourceAnchors'),
        tags: inLearning ? semanticFrontmatterArray(parsed.data, 'tags') : [],
        primaryConcepts,
        supportingConcepts,
        claimIds: inLearning ? semanticFrontmatterArray(parsed.data, 'claimIds') : [],
        related: semanticFrontmatterArray(parsed.data, 'related'),
        date: frontmatterString(parsed.data, 'date'),
        wordCount: words.length,
        excerpt: words.slice(0, 50).join(' '),
        content: parsed.body,
      });
    }
  };
  walk(path.join(gardenDir, 'learning'));
  walk(path.join(gardenDir, 'sources'));
  return {
    nodes,
    edges: [],
    tree: [],
    orphanTopics: [],
    stats: {
      documents: nodes.filter((node) => node.type === 'source-document').length,
      topics: 0,
      textbookPages: 0,
      conceptNodes: 0,
      learningPages: nodes.filter((node) => node.type !== 'source-document').length,
      generatedNotes: 0,
      links: 0,
      words: nodes.reduce((sum, node) => sum + Number(node.wordCount ?? 0), 0),
    },
  };
}

const gardenArg = process.argv[2];
const fixtureArg = process.argv[3];
if (!gardenArg || !fixtureArg) {
  console.error('Usage: node --experimental-strip-types scripts/evaluate-semantic-retrieval.ts <garden-path> <queries.json>');
  process.exitCode = 1;
} else {
  const gardenDir = path.resolve(gardenArg);
  const fixturePath = path.resolve(fixtureArg);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as EvaluationFixture;
  const gardenSlug = path.basename(gardenDir);
  const knowledge = scanEvaluationKnowledge(gardenDir);
  const database = createEphemeralRetrievalDatabase();
  const k = Math.max(1, Math.min(fixture.k ?? 8, 16));
  let expectedCount = 0;
  let recalledCount = 0;
  let reciprocalRankTotal = 0;
  let queryHitCount = 0;
  let expectedAnchorCount = 0;
  let coveredAnchorCount = 0;
  const queryResults: Array<Record<string, unknown>> = [];

  try {
    for (const item of fixture.queries) {
      const result = await retrieveGraphRag({
        query: item.query,
        gardens: [{ slug: gardenSlug, name: gardenSlug, rootPath: gardenDir, knowledge }],
        database,
        embeddingProvider: null,
        maxChunks: k,
      });
      const rankedPages = [...new Set(result.chunks.map((chunk) => chunk.pageRelPath))];
      const expected = new Set(item.expectedPages.map((page) => page.replace(/\\/g, '/')));
      const hits = rankedPages.filter((page) => expected.has(page));
      expectedCount += expected.size;
      recalledCount += hits.length;
      if (hits.length > 0) queryHitCount += 1;
      const firstRank = rankedPages.findIndex((page) => expected.has(page));
      reciprocalRankTotal += firstRank >= 0 ? 1 / (firstRank + 1) : 0;
      const returnedAnchors = new Set(result.chunks.flatMap((chunk) => chunk.evidenceAnchors));
      const expectedAnchors = item.expectedAnchors ?? [];
      expectedAnchorCount += expectedAnchors.length;
      coveredAnchorCount += expectedAnchors.filter((anchor) => returnedAnchors.has(anchor)).length;
      queryResults.push({
        query: item.query,
        expectedPages: [...expected],
        rankedPages,
        hits,
        reciprocalRank: firstRank >= 0 ? 1 / (firstRank + 1) : 0,
        lexicalUsed: result.lexicalUsed,
        semanticUsed: result.semanticUsed,
      });
    }
  } finally {
    database.close();
  }

  const semantic = validateGardenSemantics(gardenDir);
  const metrics = semantic.metrics;
  const output = {
    garden: gardenSlug,
    queryCount: fixture.queries.length,
    k,
    recallAtK: expectedCount > 0 ? recalledCount / expectedCount : 0,
    mrr: fixture.queries.length > 0 ? reciprocalRankTotal / fixture.queries.length : 0,
    expectedPageHitRate: fixture.queries.length > 0 ? queryHitCount / fixture.queries.length : 0,
    sourceAnchorCoverage: expectedAnchorCount > 0 ? coveredAnchorCount / expectedAnchorCount : 1,
    conceptSingletonRatio: metrics.uniqueConcepts > 0 ? metrics.singletonConcepts / metrics.uniqueConcepts : 0,
    sharedConceptPagePairCount: metrics.sharedConceptPagePairs,
    claimsWithEvidencePercentage:
      metrics.claimsWithEvidence + metrics.claimsWithoutEvidence > 0
        ? (metrics.claimsWithEvidence / (metrics.claimsWithEvidence + metrics.claimsWithoutEvidence)) * 100
        : 0,
    hardSemanticFailures: semantic.hardFailures,
    diagnostics: semantic.diagnostics,
    queries: queryResults,
  };
  console.log(JSON.stringify(output, null, 2));
  if (semantic.hardFailures.length > 0) process.exitCode = 2;
}
