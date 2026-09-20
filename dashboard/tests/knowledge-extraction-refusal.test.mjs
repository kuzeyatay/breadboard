// Concept extraction must never answer with invented knowledge.
//
// A garden held a video source whose "Summary" was the first 800 characters of
// the transcript, cut mid-word, and whose single "concept" was the video's own
// title. Nothing had gone wrong visibly: the extraction had failed and the
// caller had been handed a fabricated map built out of the source's own words,
// which then published exactly like a real one. These tests pin the refusal.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
await import("../scripts/learn-worker-import-hook.mjs");

const { extractDocumentKnowledge } = await import("../src/lib/knowledge.ts");

const TRANSCRIPT = [
  "Today we will be dealing with these four Maxwell's equations.",
  "The full name of Maxwell is James Clerk Maxwell.",
  "He was a Scottish physicist who unified electricity, magnetism and light.",
].join("\n");

function clientReturning(content) {
  return {
    chat: {
      completions: {
        async create() {
          return { choices: [{ message: { content } }] };
        },
      },
    },
  };
}

function clientThrowing(error) {
  return {
    chat: {
      completions: {
        async create() {
          throw error;
        },
      },
    },
  };
}

const request = {
  model: "selected-model",
  title: "Best Explanation of Maxwell's Equations",
  sourceType: "video",
  sourceLabel: "https://example.invalid/watch",
  pages: [{ label: "Transcript", text: TRANSCRIPT }],
  text: TRANSCRIPT,
};

test("an unreachable model fails the extraction instead of inventing one", async () => {
  await assert.rejects(
    extractDocumentKnowledge({
      ...request,
      client: clientThrowing(new Error("Connection error.")),
    }),
    (error) => {
      assert.equal(error.name, "KnowledgeExtractionFailedError");
      // The failure must not carry the source's own words back as a result.
      assert.doesNotMatch(error.message, /Scottish physicist/);
      return true;
    },
  );
});

test("an empty model answer fails rather than becoming a transcript prefix", async () => {
  await assert.rejects(
    extractDocumentKnowledge({ ...request, client: clientReturning("{}") }),
    (error) => error.name === "KnowledgeExtractionFailedError",
  );
});

test("unparseable output fails rather than becoming headings and a prefix", async () => {
  await assert.rejects(
    extractDocumentKnowledge({
      ...request,
      client: clientReturning("I could not do that."),
    }),
    (error) => error.name === "KnowledgeExtractionFailedError",
  );
});

test("an honest 'no durable knowledge' answer is still accepted", async () => {
  const extraction = await extractDocumentKnowledge({
    ...request,
    client: clientReturning(JSON.stringify({
      documentTitle: "Best Explanation of Maxwell's Equations",
      summary: "A channel trailer with no teachable content.",
      topics: [],
      relationships: [],
      suggestedTags: [],
    })),
  });
  assert.equal(extraction.topics.length, 0);
  assert.equal(extraction.summary, "A channel trailer with no teachable content.");
});

test("a real answer is returned with the model's own summary", async () => {
  const extraction = await extractDocumentKnowledge({
    ...request,
    client: clientReturning(JSON.stringify({
      documentTitle: "Maxwell's equations",
      summary: "Four equations unifying electricity, magnetism and light.",
      topics: [{
        title: "Gauss's law",
        explanation: "Electric flux through a closed surface is the enclosed charge over epsilon nought.",
        keyPoints: ["Flux is proportional to enclosed charge"],
        sourceEvidence: ["00:04:12"],
        locations: ["Transcript"],
        relatedTopics: [],
        tags: ["electrostatics"],
      }],
      relationships: [],
      suggestedTags: ["electromagnetism"],
    })),
  });
  assert.equal(extraction.summary, "Four equations unifying electricity, magnetism and light.");
  assert.deepEqual(extraction.topics.map((topic) => topic.title), ["Gauss's law"]);
});

test("the callers that publish a source do not swallow the refusal", async () => {
  const fs = await import("node:fs");
  const read = (relative) =>
    fs.readFileSync(path.join(dashboardRoot, "src", "lib", relative), "utf8");

  for (const file of ["garden-link-import.ts", "scriberr/ingest.ts"]) {
    const source = read(file);
    const call = source.indexOf("extractDocumentKnowledge({");
    assert.ok(call > 0, `${file} should still extract knowledge`);
    // No `catch` may sit between the call and the write that follows it.
    const tail = source.slice(call, source.indexOf("writeDocumentKnowledge({", call));
    assert.doesNotMatch(tail, /\bcatch\b/, `${file} swallows the extraction failure`);
    assert.doesNotMatch(source, /fallbackExtraction/, `${file} still fabricates an extraction`);
  }
});

test("a link import extracts with the profile default model, not the product default", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(
    path.join(dashboardRoot, "src", "lib", "garden-link-import.ts"), "utf8",
  );
  assert.match(source, /selectedModelForUser\(userId\)/);
  assert.doesNotMatch(source, /DEFAULT_MODEL/, "the import pins the product default");
});
