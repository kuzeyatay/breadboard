import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("PDF formatting fallback", () => {
  const repoRoot = path.resolve(process.cwd());

  test("does not surface Council chunk formatting failures as upload warnings", () => {
    const ingestWorker = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "runtime-v2", "ingest-executor.ts"),
      "utf8",
    );

    assert.doesNotMatch(ingestWorker, /Chunked PDF formatting fallback used/);
    assert.match(ingestWorker, /saved extracted text fallback instead/);
    assert.match(ingestWorker, /warning: ""/);
  });

  test("saves the source note when Council map generation fails", () => {
    const ingestWorker = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "runtime-v2", "ingest-executor.ts"),
      "utf8",
    );

    assert.match(ingestWorker, /Map generation failed for \$\{filename\}; saved source note/);
    assert.match(ingestWorker, /mapGenerationWarning/);
    assert.match(
      ingestWorker,
      /mapGenerated:\s*generateMap && !mapGenerationWarning && !skipKnowledgeExtraction/,
    );
  });

  test("does not downgrade an incomplete chunked extraction to a successful upload", () => {
    const ingestWorker = fs.readFileSync(
      path.join(repoRoot, "src", "lib", "runtime-v2", "ingest-executor.ts"),
      "utf8",
    );
    const extractionCatch = ingestWorker.indexOf(
      "if (error instanceof IncompleteKnowledgeExtractionError) throw error;",
    );
    const fallbackWarning = ingestWorker.indexOf(
      "Map generation failed for ${filename}; saved source note",
    );

    assert.notEqual(extractionCatch, -1);
    assert.ok(
      extractionCatch < fallbackWarning,
      "the integrity error must be rethrown before the optional map fallback",
    );
  });
});
