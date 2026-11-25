import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { findGardenSourceNote, readSourceFrontmatter, resolveSourcePdfMarkdownPath } from "../src/lib/source-pdf-garden.ts";

const dashboardRoot = path.resolve(import.meta.dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(dashboardRoot, relative), "utf8");
}

test("the Sim agent resolves its delayed registry import inside the vendored namespace", () => {
  const source = read("src/lib/sim/blocks/blocks/agent.ts");
  assert.match(source, /require\(['"]@\/lib\/sim\/blocks\/registry['"]\)/);
  assert.doesNotMatch(source, /require\(['"]@\/blocks\/registry['"]\)/);
});

test("the source PDF route reads garden content only at runtime", () => {
  const source = read("src/app/api/documents/[slug]/source-pdf/route.ts");
  const history = read(
    "src/app/api/documents/[slug]/source-pdf/history/route.ts",
  );
  const walker = read("src/lib/source-pdf-garden.ts");
  assert.doesNotMatch(source, /from ["']@\/lib\/knowledge["']/);
  assert.match(source, /from ["']@\/lib\/source-pdf-garden["']/);
  assert.match(
    walker,
    /readdirSync\(\s*\/\* turbopackIgnore: true \*\/ directory/,
  );
  assert.match(walker, /openSync\(\/\* turbopackIgnore: true \*\/ markdownPath/);
  assert.match(source, /readSourceFrontmatter\(markdownPath\)/);
  assert.match(source, /fileContentResponse\(request, context\.pdfPath/);
  assert.match(source, /from ["']@\/lib\/garden-source-pdf-path["']/);
  for (const writer of [source, history]) {
    assert.match(writer, /acquireGardenMutationLease/);
  }
});

test("the source PDF walker preserves missing-path and duplicate ordering behavior", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-pdf-walk-"));
  const cluster = path.join(root, "garden");
  const later = path.join(cluster, "b", "source.md");
  const earlier = path.join(cluster, "a", "source.md");
  fs.mkdirSync(path.dirname(later), { recursive: true });
  fs.mkdirSync(path.dirname(earlier), { recursive: true });
  fs.writeFileSync(later, "later\n");
  fs.writeFileSync(earlier, "earlier\n");

  try {
    assert.equal(resolveSourcePdfMarkdownPath(cluster, "source"), earlier);
    assert.equal(resolveSourcePdfMarkdownPath(path.join(root, "missing"), "source"), null);
    assert.equal(resolveSourcePdfMarkdownPath(earlier, "source"), null);
    assert.equal(resolveSourcePdfMarkdownPath(cluster, "../source"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a published source lookup reads one header, including long Unicode headers and legacy paths", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bb-source-header-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sources = path.join(root, "sources");
  fs.mkdirSync(sources);
  const file = path.join(sources, "Lecture 1.md");
  const label = 'Universiteit – "Résumé"';
  const header = `---\r\nknowledge_type: "source-document"\r\ntitle: ${JSON.stringify(label)}\r\nsource_pdf: "/garden/assets/source.pdf"\r\n`;
  fs.writeFileSync(file, header + "---\r\n" + "body".repeat(50_000));
  const wholeRead = t.mock.method(fs, "readFileSync");
  const found = findGardenSourceNote(root, "sources/lecture-1");
  assert.equal(found.title, label);
  assert.equal(found.slug, "Lecture 1");
  assert.equal(found.relPath, "sources/Lecture 1.md");
  assert.equal(wholeRead.mock.callCount(), 0, "reading a short header must not read the full extracted PDF text");
  assert.equal(findGardenSourceNote(root, "sources/../outside"), null);

  fs.writeFileSync(file, header + "description: " + "é".repeat(8192) + '\r\nsource_file: "Lecture.pdf"\r\n---\r\nBody');
  assert.equal(readSourceFrontmatter(file).source_file, "Lecture.pdf");
  fs.writeFileSync(path.join(sources, "lecture-1.md"), header + "---\r\n");
  assert.equal(findGardenSourceNote(root, "sources/lecture-1"), null, "an ambiguous published name uses the existing list ordering");
  fs.writeFileSync(path.join(sources, "legacy.md"), '---\nsource: "upload"\n---\n');
  assert.equal(findGardenSourceNote(root, "sources/legacy"), null, "the index still infers older source types");
});
