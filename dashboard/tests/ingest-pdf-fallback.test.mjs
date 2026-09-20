import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("PDF formatting fallback", () => {
  const repoRoot = path.resolve(process.cwd());
  const executor = () =>
    fs.readFileSync(
      path.join(repoRoot, "src", "lib", "runtime-v2", "ingest-executor.ts"),
      "utf8",
    );

  test("does not surface Council chunk formatting failures as upload warnings", () => {
    const ingestWorker = executor();

    assert.doesNotMatch(ingestWorker, /Chunked PDF formatting fallback used/);
    assert.match(ingestWorker, /saved extracted text fallback instead/);
    assert.match(ingestWorker, /warning: ""/);
  });

  test("an upload that asked for a map and did not get one is not saved", () => {
    // It used to be. The source landed with the document's own first 300
    // characters under "## Summary", no topics, and a warning beside it, which
    // reads exactly like a real source until you open it.
    const ingestWorker = executor();

    assert.doesNotMatch(ingestWorker, /mapGenerationWarning/);
    assert.doesNotMatch(ingestWorker, /Map generation failed/);
    assert.doesNotMatch(
      ingestWorker,
      /plainText\.trim\(\)\.slice\(0, 300\)/,
      "no branch may pass the document's opening characters off as a summary",
    );
    assert.match(
      ingestWorker,
      /mapGenerated: generateMap && !skipKnowledgeExtraction/,
    );
  });

  test("nothing catches the extraction between the call and the garden write", () => {
    const ingestWorker = executor();
    const call = ingestWorker.indexOf("extraction = await extractDocumentKnowledge({");
    const write = ingestWorker.indexOf("await writeDocumentKnowledge({", call);

    assert.ok(call > 0, "the executor should still extract knowledge");
    assert.ok(write > call, "the garden write should still follow it");
    assert.doesNotMatch(
      ingestWorker.slice(call, write),
      /\bcatch\b/,
      "the extraction failure must reach the worker, which retains the blob for Resume",
    );
  });

  test("a declined map says so instead of inventing a summary", () => {
    const ingestWorker = executor();
    assert.match(
      ingestWorker,
      /summary: `Uploaded \$\{filename\} without map generation\.`/,
    );
  });
});

describe("a failed ingestion names its own reason", () => {
  test("concept-extraction failure gets its own public message", async () => {
    const { isConceptExtractionFailure, publicIngestFailureMessage } = await import(
      "../scripts/runtime-v2-document-ingestion-worker.mjs"
    );

    const refusal = new Error("Concept extraction failed for this source.");
    refusal.name = "KnowledgeExtractionFailedError";
    assert.ok(isConceptExtractionFailure(refusal));

    const incomplete = new Error("section 2 of 5");
    incomplete.name = "IncompleteKnowledgeExtractionError";
    assert.ok(isConceptExtractionFailure(incomplete));

    // A failed garden rollback wraps the original failure; the reason survives.
    assert.ok(isConceptExtractionFailure(
      new AggregateError([refusal, new Error("rollback incomplete")], "both"),
    ));
    assert.ok(!isConceptExtractionFailure(new Error("disk full")));

    assert.match(
      publicIngestFailureMessage({ conceptExtraction: true }),
      /nothing was added to the garden\. Resume the upload/,
    );
    // Quota still wins: it is the one a person fixes differently.
    assert.match(
      publicIngestFailureMessage({ providerQuota: true, conceptExtraction: true }),
      /rate-limited or out of credits/,
    );
    assert.equal(publicIngestFailureMessage({}), "Runtime job execution failed.");
  });

  test("the host accepts every message the worker can send", async () => {
    const compatibility = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "runtime-v2", "ingest-compatibility.ts"),
      "utf8",
    );
    const { publicIngestFailureMessage } = await import(
      "../scripts/runtime-v2-document-ingestion-worker.mjs"
    );
    for (const classification of [{}, { providerQuota: true }, { conceptExtraction: true }]) {
      assert.ok(
        compatibility.includes(publicIngestFailureMessage(classification)),
        `the compatibility boundary rejects ${JSON.stringify(classification)}`,
      );
    }
  });
});
