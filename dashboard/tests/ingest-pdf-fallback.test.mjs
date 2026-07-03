import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("PDF formatting fallback", () => {
  const repoRoot = path.resolve(process.cwd());

  test("does not surface Council chunk formatting failures as upload warnings", () => {
    const ingestRoute = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "ingest", "route.ts"),
      "utf8",
    );

    assert.doesNotMatch(ingestRoute, /Chunked PDF formatting fallback used/);
    assert.match(ingestRoute, /saved extracted text fallback instead/);
    assert.match(ingestRoute, /warning: ""/);
  });

  test("saves the source note when Council map generation fails", () => {
    const ingestRoute = fs.readFileSync(
      path.join(repoRoot, "src", "app", "api", "ingest", "route.ts"),
      "utf8",
    );

    assert.match(ingestRoute, /Map generation failed for \$\{filename\}; saved source note/);
    assert.match(ingestRoute, /mapGenerationWarning/);
    assert.match(ingestRoute, /mapGenerated: generateMap && !mapGenerationWarning/);
  });
});
