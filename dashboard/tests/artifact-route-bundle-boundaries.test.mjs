import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const previewRoute = source(
  "../src/app/api/hermes/artifacts/[artifactId]/preview/route.ts",
);
const genOfficeRoute = source(
  "../src/app/api/hermes/artifacts/[artifactId]/genoffice/route.ts",
);
const officeSave = source("../src/lib/hermes/artifact-office-save.ts");
const pdfSave = source("../src/lib/hermes/artifact-pdf-save.ts");

test("artifact read routes do not compile the generic document editor graph", () => {
  assert.doesNotMatch(previewRoute, /artifact-document-editor/);
  assert.doesNotMatch(genOfficeRoute, /artifact-document-editor/);
  assert.match(previewRoute, /artifact-pdf-save/);
  assert.match(genOfficeRoute, /artifact-office-save/);
});

test("specialized save modules stay independent of heavyweight editor readers", () => {
  for (const moduleSource of [officeSave, pdfSave]) {
    assert.doesNotMatch(moduleSource, /pdf-parse/);
    assert.doesNotMatch(moduleSource, /genoffice\/agent-query/);
    assert.doesNotMatch(moduleSource, /office\/agent-query/);
  }
  assert.match(officeSave, /runOfficeCli/);
  assert.match(pdfSave, /importArtifactVersion/);
});
