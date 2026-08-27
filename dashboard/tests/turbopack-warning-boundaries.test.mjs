import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";

import { resolveSourcePdfMarkdownPath } from "../src/lib/source-pdf-garden.ts";

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
  const walker = read("src/lib/source-pdf-garden.ts");
  assert.doesNotMatch(source, /from ["']@\/lib\/knowledge["']/);
  assert.match(source, /from ["']@\/lib\/source-pdf-garden["']/);
  assert.match(
    walker,
    /readdirSync\(\s*\/\* turbopackIgnore: true \*\/ directory/,
  );
  assert.match(
    source,
    /readFileSync\(\/\* turbopackIgnore: true \*\/ markdownPath/,
  );
  assert.match(
    source,
    /readFileSync\(\/\* turbopackIgnore: true \*\/ context\.pdfPath/,
  );
  assert.match(
    source,
    /path\.resolve\(\s*\/\* turbopackIgnore: true \*\/ clusterDir,\s*["']assets["']/,
  );
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
