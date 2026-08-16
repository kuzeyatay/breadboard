// The Garden card's note count. Uploaded documents land in `sources/` and
// generated study pages under a numbered section folder, so a count that only
// reads the Garden root reports "No notes yet" for a Garden that is full.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { countClusterMarkdown } from "../src/lib/garden-directory.ts";

const roots = [];

function makeGarden(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "note-count-"));
  roots.push(root);
  for (const rel of files) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "---\ntitle: Note\n---\n\nbody\n", "utf-8");
  }
  return root;
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

describe("countClusterMarkdown", () => {
  test("counts notes in sub-folders, not just the Garden root", () => {
    const root = makeGarden([
      "_index.md",
      "sources/_index.md",
      "sources/textbook.md",
      "sources/study-guide.md",
    ]);
    assert.equal(countClusterMarkdown(root), 2);
  });

  test("counts a root note and a nested one together", () => {
    const root = makeGarden([
      "_index.md",
      "loose-note.md",
      "1. section/_index.md",
      "1. section/page-one.md",
      "1. section/deeper/page-two.md",
    ]);
    assert.equal(countClusterMarkdown(root), 3);
  });

  test("skips folder indexes, assets, dotfolders and the Internal namespace", () => {
    const root = makeGarden([
      "_index.md",
      "index.md",
      "sources/textbook.md",
      "assets/caption.md",
      ".breadboard/planning/Learning Unit Contract.md",
      "Internal/Concept Graph/flux-density.md",
    ]);
    assert.equal(countClusterMarkdown(root), 1);
  });

  test("ignores non-markdown files", () => {
    const root = makeGarden(["sources/textbook.md", "sources/textbook.pdf"]);
    assert.equal(countClusterMarkdown(root), 1);
  });

  test("returns 0 for a Garden with no directory on disk", () => {
    assert.equal(countClusterMarkdown(path.join(os.tmpdir(), "no-such-garden")), 0);
  });
});
