import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { lazyRetrievalGarden } from "../src/lib/hermes/garden-reader.ts";
import { retrieveGraphRag } from "../src/lib/semantic-retrieval.ts";

// Older lessons (knowledge-topic), plain notes and sprint pages were dropped by
// the retrieval reader and indexer until 2026-11-20, so whole Gardens answered
// only from their source books.
test("Garden retrieval indexes knowledge-topic, note and sprint-page lessons", async (t) => {
  const contentPath = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-page-types-"));
  const database = new Database(":memory:");
  t.after(() => {
    database.close();
    fs.rmSync(contentPath, { recursive: true, force: true });
  });
  const garden = path.join(contentPath, "fixture");
  fs.mkdirSync(garden, { recursive: true });
  const pages = {
    "routh.md": ["knowledge-topic", "Routh Hurwitz Cubic Stability", "quokkastability"],
    "fading.md": ["note", "Temporal Diversity", "quokkadiversity"],
    "fields.md": ["sprint-page", "Fields and Vector Geometry", "quokkafields"],
  };
  for (const [file, [type, title, word]] of Object.entries(pages)) {
    fs.writeFileSync(path.join(garden, file),
      `---\ntitle: "${title}"\nknowledge_type: "${type}"\n---\n\n# ${title}\n\nThis lesson explains ${word} in plain words with enough text to index.\n`);
  }

  const retrievalGarden = await lazyRetrievalGarden(contentPath, { slug: "fixture", name: "Fixture" });
  for (const [, title, word] of Object.values(pages)) {
    const result = await retrieveGraphRag({ query: word, gardens: [retrievalGarden], database, embeddingProvider: null, indexEmbeddings: false });
    assert.ok(result.chunks.some((chunk) => chunk.pageTitle === title), `${title} was not retrieved`);
  }
});
