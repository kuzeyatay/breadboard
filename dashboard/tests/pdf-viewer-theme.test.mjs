import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pdfViewer = fs.readFileSync(
  new URL(
    "../src/app/gardens/[clusterSlug]/pdf/[slug]/pdf-viewer-client.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("the PDF outline follows the active app theme", () => {
  const outline = pdfViewer.match(
    /<aside\s+id="pdf-document-outline"[\s\S]*?>/,
  )?.[0];

  assert.ok(outline, "the PDF outline should be rendered as an aside");
  assert.match(outline, /\bbg-gray-950\b/);
  assert.doesNotMatch(outline, /\bbg-\[#/);
});
