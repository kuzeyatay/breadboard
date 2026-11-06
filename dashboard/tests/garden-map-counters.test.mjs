import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BREADBOARD_LEARN_SOURCE_ROOT = path.join(dashboardRoot, "src");
await import("../scripts/learn-worker-import-hook.mjs");
const { scanClusterKnowledge } = await import(
  pathToFileURL(path.join(dashboardRoot, "src", "lib", "knowledge.ts")).href
);

test("Garden map distinguishes concept pages from Learn lessons and internal nodes", () => {
  const contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-map-counts-"));
  const gardenSlug = "course";
  const gardenDir = path.join(contentRoot, gardenSlug);
  const write = (relativePath, frontmatter, body = "") => {
    const filePath = path.join(gardenDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `---\n${frontmatter}\n---\n\n${body}\n`, "utf8");
  };

  try {
    write("sources/source.md", 'title: "Source"\nknowledge_type: "source-document"');
    write(
      "Concepts/1. Signals/signal.md",
      'title: "Signal"\nknowledge_type: "learning-page"\ngenerated_by: "document_ingestion"\nsource_document: "source"',
      "Source-derived concept page.",
    );
    write(
      "learning/1. Signals/lesson.md",
      'title: "Lesson"\nknowledge_type: "learning-page"\ngenerated_by: "learn_button"',
      "See [[signal]].",
    );
    write(
      "Internal/Concept Graph/concept-signal.md",
      'title: "Internal signal"\nknowledge_type: "internal-concept"',
    );

    const { stats } = scanClusterKnowledge(contentRoot, gardenSlug, {
      migrateSources: false,
    });
    assert.equal(stats.documents, 1);
    assert.equal(stats.textbookPages, 1);
    assert.equal(stats.conceptPages, 1);
    assert.equal(stats.conceptNodes, 1);
    assert.ok(stats.links > 0);
  } finally {
    fs.rmSync(contentRoot, { recursive: true, force: true });
  }
});
