import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  clearLearnSemanticChunks,
  headingAwareChunks,
  indexRetrievalGarden,
  reciprocalRankFusion,
  retrieveGraphRag,
} from "../src/lib/semantic-retrieval.ts";
import {
  createEmptyClaimStore,
  createEmptyConceptRegistry,
  mergeConcept,
  normalizeClaimRecord,
} from "../src/lib/semantic-core.ts";

function knowledgeNode(overrides) {
  return {
    id: overrides.relPath,
    slug: path.basename(overrides.relPath, ".md"),
    fileName: path.basename(overrides.relPath),
    folder: path.dirname(overrides.relPath),
    relPath: overrides.relPath,
    title: overrides.title,
    type: overrides.type ?? "learning-page",
    sourceType: overrides.sourceType ?? "lecture notes",
    sourceFile: "reader.pdf",
    sourcePdf: "reader.pdf",
    sourceDocument: "reader.pdf",
    textbookPage: "",
    breadboardType: overrides.breadboardType ?? "learning_page",
    draft: "false",
    generatedBy: "test",
    generated_by: "test",
    internal: "false",
    flagColor: "",
    locations: overrides.locations ?? [],
    sourceAnchors: overrides.sourceAnchors ?? [],
    tags: [...overrides.primaryConcepts, ...(overrides.supportingConcepts ?? [])],
    primaryConcepts: overrides.primaryConcepts,
    supportingConcepts: overrides.supportingConcepts ?? [],
    claimIds: overrides.claimIds ?? [],
    related: [],
    date: "",
    wordCount: overrides.content.split(/\s+/).length,
    excerpt: overrides.content.slice(0, 120),
    content: overrides.content,
  };
}

function makeRetrievalGarden() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-retrieval-"));
  fs.mkdirSync(path.join(root, ".breadboard"), { recursive: true });
  let registry = createEmptyConceptRegistry("fixture");
  registry = mergeConcept(registry, {
    slug: "lif-neuron",
    preferredLabel: "Leaky integrate-and-fire neuron",
    aliases: ["LIF"],
  });
  registry = mergeConcept(registry, {
    slug: "spike-threshold",
    preferredLabel: "Spike threshold",
    relations: [],
  });
  for (const slug of [
    "surrogate-gradient",
    "ann-to-snn-conversion",
    "stdp",
    "energy-efficiency",
    "inference-latency",
    "spike-count",
    "energy-accuracy-tradeoff",
  ]) {
    registry = mergeConcept(registry, { slug });
  }
  const claim = normalizeClaimRecord({
    text: "A LIF neuron emits a spike when membrane potential crosses its threshold.",
    subject: "lif-neuron",
    predicate: "emits-when",
    object: "spike-threshold",
    learningUnitId: "unit-lif",
    pageRelPath: "learning/neurons/lif.md",
    evidenceAnchors: ["S1.P4"],
    status: "source-verified",
    registry,
  });
  fs.writeFileSync(path.join(root, ".breadboard/concept-registry.json"), `${JSON.stringify(registry, null, 2)}\n`);
  fs.writeFileSync(path.join(root, ".breadboard/claims.json"), `${JSON.stringify({
    ...createEmptyClaimStore("fixture"),
    claims: [claim],
  }, null, 2)}\n`);

  const lif = knowledgeNode({
    relPath: "learning/neurons/lif.md",
    title: "Leaky integrate-and-fire dynamics",
    primaryConcepts: ["lif-neuron"],
    claimIds: [claim.id],
    sourceAnchors: ["S1.P4"],
    content: "# Membrane dynamics\n\nThe neuron integrates current while leakage reduces its state over time.",
  });
  const threshold = knowledgeNode({
    relPath: "learning/neurons/threshold.md",
    title: "Threshold crossing and reset",
    primaryConcepts: ["spike-threshold"],
    sourceAnchors: ["S1.P5"],
    content: "# Firing rule\n\nCrossing the boundary creates an output event, followed by a reset.",
  });
  const training = knowledgeNode({
    relPath: "learning/training/surrogate.md",
    title: "Surrogate-gradient training",
    primaryConcepts: ["surrogate-gradient"],
    supportingConcepts: ["energy-efficiency"],
    sourceAnchors: ["S1.P8"],
    content: "# Training strategy\n\nSurrogate gradients enable direct training while trading classification accuracy against energy cost.",
  });
  const comparison = knowledgeNode({
    relPath: "learning/comparison/tradeoffs.md",
    title: "Accuracy and energy tradeoffs",
    primaryConcepts: ["energy-accuracy-tradeoff"],
    supportingConcepts: ["surrogate-gradient", "ann-to-snn-conversion", "stdp", "energy-efficiency"],
    sourceAnchors: ["S1.P9.T1"],
    content: "# Choosing a strategy\n\nCompare surrogate training, ANN-to-SNN conversion, and STDP by accuracy, energy, latency, and spike count.",
  });
  const slides = knowledgeNode({
    relPath: "sources/slides.md",
    title: "Deployment slides",
    type: "source-document",
    breadboardType: "source_document",
    sourceType: "slides",
    primaryConcepts: [],
    sourceAnchors: ["S2.P2"],
    content: "# Authority fixture\n\nmatchedauthorityphrase explains the deployment constraint.",
  });
  const lecture = knowledgeNode({
    relPath: "sources/lecture.md",
    title: "Deployment lecture notes",
    type: "source-document",
    breadboardType: "source_document",
    sourceType: "lecture notes",
    primaryConcepts: [],
    sourceAnchors: ["S3.P2"],
    content: "# Authority fixture\n\nmatchedauthorityphrase explains the deployment constraint.",
  });
  return {
    root,
    garden: {
      slug: "fixture",
      name: "Fixture garden",
      rootPath: root,
      knowledge: {
        nodes: [lif, threshold, training, comparison, slides, lecture],
        edges: [],
        tree: [],
        orphanTopics: [],
        stats: {
          documents: 2,
          topics: 0,
          textbookPages: 0,
          conceptNodes: 0,
          learningPages: 4,
          generatedNotes: 0,
          links: 0,
          words: lif.wordCount + threshold.wordCount + training.wordCount + comparison.wordCount + slides.wordCount + lecture.wordCount,
        },
      },
    },
  };
}

describe("semantic retrieval", () => {
  test("chunks by headings while preserving fenced and display-math blocks", () => {
    const chunks = headingAwareChunks(`# Model

Intro paragraph.

\`\`\`ts
const state = update(input)
\`\`\`

## Equation

$$
v(t) = v_0 e^{-t / tau}
$$`, { targetWords: 8, maxWords: 12, overlapWords: 0 });

    assert.ok(chunks.some((chunk) => chunk.content.includes("const state = update(input)")));
    assert.ok(chunks.some((chunk) => chunk.content.includes("v(t) = v_0")));
    assert.ok(chunks.some((chunk) => chunk.heading === "Equation"));
  });

  test("indexes changed pages only and expands one hop over typed claims", async (t) => {
    const { root, garden } = makeRetrievalGarden();
    const database = new Database(":memory:");
    t.after(() => {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    const first = await indexRetrievalGarden({ garden, database, embeddingProvider: null });
    const second = await indexRetrievalGarden({ garden, database, embeddingProvider: null });
    assert.equal(first.changedPages, 6);
    assert.equal(second.changedPages, 0);

    const result = await retrieveGraphRag({
      query: "How does a LIF model integrate current?",
      gardens: [garden],
      database,
      embeddingProvider: null,
      maxChunks: 4,
    });

    assert.equal(result.lexicalUsed, true);
    assert.equal(result.semanticUsed, false);
    assert.equal(result.chunks[0].pageRelPath, "learning/neurons/lif.md");
    const expanded = result.chunks.find((chunk) => chunk.pageRelPath === "learning/neurons/threshold.md");
    assert.ok(expanded);
    assert.ok(expanded.relationshipPaths.some((item) => item.includes("emits-when")));
    assert.match(result.context, /Evidence anchors: S1\.P4/);
  });

  test("clears only scoped learner chunks, removing FTS rows before base rows", async (t) => {
    const { root, garden } = makeRetrievalGarden();
    const database = new Database(":memory:");
    t.after(() => {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    const otherGarden = { ...garden, slug: "other", name: "Other garden" };
    await indexRetrievalGarden({ garden, database, embeddingProvider: null });
    await indexRetrievalGarden({ garden: otherGarden, database, embeddingProvider: null });

    // A legacy/frontmatter-marked learner page can live outside learning/.
    // Clear receives this exact path from the independently verified filesystem
    // cleanup and must remove its semantic rows too.
    database.prepare(
      "UPDATE semantic_chunks SET page_rel_path = ? WHERE garden_slug = ? AND page_rel_path = ?",
    ).run("notes/generated.md", garden.slug, "learning/neurons/threshold.md");

    const count = (sql, ...params) => database.prepare(sql).get(...params).count;
    const targetChunks = count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path = ?",
      garden.slug,
      "learning/neurons/lif.md",
    );
    const fixtureSourceChunks = count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path LIKE 'sources/%'",
      garden.slug,
    );
    const otherChunks = count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ?",
      otherGarden.slug,
    );

    const scoped = clearLearnSemanticChunks({
      gardenSlug: garden.slug,
      pageRelPaths: [
        "learning/neurons/lif.md",
        "learning/neurons/lif.md",
        "sources/lecture.md",
      ],
    }, database);
    assert.deepEqual(scoped, {
      deletedChunks: targetChunks,
      deletedFtsRows: targetChunks,
    });
    assert.equal(count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path = ?",
      garden.slug,
      "learning/neurons/lif.md",
    ), 0);
    assert.equal(count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path LIKE 'sources/%'",
      garden.slug,
    ), fixtureSourceChunks);
    assert.equal(count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ?",
      otherGarden.slug,
    ), otherChunks);

    const remaining = clearLearnSemanticChunks({
      gardenSlug: garden.slug,
      verifiedGeneratedPageRelPaths: ["notes/generated.md"],
    }, database);
    assert.ok(remaining.deletedChunks > 0);
    assert.equal(remaining.deletedFtsRows, remaining.deletedChunks);
    assert.equal(count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path LIKE 'learning/%'",
      garden.slug,
    ), 0);
    assert.equal(count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ? AND page_rel_path = ?",
      garden.slug,
      "notes/generated.md",
    ), 0);
    assert.equal(count(
      "SELECT COUNT(*) AS count FROM semantic_chunks_fts WHERE garden_slug = ?",
      garden.slug,
    ), fixtureSourceChunks);
    assert.equal(count(
      "SELECT COUNT(*) AS count FROM semantic_chunks WHERE garden_slug = ?",
      otherGarden.slug,
    ), otherChunks);
  });

  test("resolves LIF aliases and exact source anchors through BM25", async (t) => {
    const { root, garden } = makeRetrievalGarden();
    const database = new Database(":memory:");
    t.after(() => {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    for (const query of ["LIF", "leaky integrate fire", "threshold neuron model", "S1.P4"]) {
      const result = await retrieveGraphRag({
        query,
        gardens: [garden],
        database,
        embeddingProvider: null,
        maxChunks: 4,
      });
      assert.equal(result.chunks[0]?.pageRelPath, "learning/neurons/lif.md", query);
    }
  });

  test("retrieves both training and comparison evidence for a tradeoff question", async (t) => {
    const { root, garden } = makeRetrievalGarden();
    const database = new Database(":memory:");
    t.after(() => {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    const result = await retrieveGraphRag({
      query: "Which training strategy trades accuracy against energy?",
      gardens: [garden],
      database,
      embeddingProvider: null,
      maxChunks: 6,
    });
    const pages = new Set(result.chunks.map((chunk) => chunk.pageRelPath));
    assert.ok(pages.has("learning/training/surrogate.md"));
    assert.ok(pages.has("learning/comparison/tradeoffs.md"));
  });

  test("uses configured embeddings and falls back honestly when they fail", async (t) => {
    const { root, garden } = makeRetrievalGarden();
    const semanticDb = new Database(":memory:");
    const fallbackDb = new Database(":memory:");
    t.after(() => {
      semanticDb.close();
      fallbackDb.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const provider = {
      model: "fixture-embedding",
      async embed(texts) {
        return texts.map((text) =>
          /semantic-vector-query|Crossing the boundary/i.test(text) ? [1, 0] : [0, 1]);
      },
    };
    const semantic = await retrieveGraphRag({
      query: "semantic-vector-query",
      gardens: [garden],
      database: semanticDb,
      embeddingProvider: provider,
      maxChunks: 3,
    });
    assert.equal(semantic.semanticUsed, true);
    assert.equal(semantic.chunks[0]?.pageRelPath, "learning/neurons/threshold.md");

    const failingProvider = {
      model: "broken-embedding",
      async embed() {
        throw new Error("fixture embedding unavailable");
      },
    };
    const fallback = await retrieveGraphRag({
      query: "LIF integrates current",
      gardens: [garden],
      database: fallbackDb,
      embeddingProvider: failingProvider,
      maxChunks: 3,
    });
    assert.equal(fallback.semanticUsed, false);
    assert.match(fallback.embeddingWarning ?? "", /fixture embedding unavailable/);
    assert.equal(fallback.chunks[0]?.pageRelPath, "learning/neurons/lif.md");
  });

  test("uses recorded source authority as a deterministic tie-break boost", async (t) => {
    const { root, garden } = makeRetrievalGarden();
    const database = new Database(":memory:");
    t.after(() => {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    });
    const result = await retrieveGraphRag({
      query: "matchedauthorityphrase",
      gardens: [garden],
      database,
      embeddingProvider: null,
      maxChunks: 3,
    });
    const sources = result.chunks.filter((chunk) => chunk.pageRelPath.startsWith("sources/"));
    assert.equal(sources[0]?.pageRelPath, "sources/lecture.md");
    assert.equal(sources[1]?.pageRelPath, "sources/slides.md");
  });

  test("fuses lexical and semantic rankings deterministically", () => {
    const fused = reciprocalRankFusion([
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
    ]);
    assert.deepEqual(fused.map(({ item }) => item.id), ["b", "a", "c"]);
  });
});
