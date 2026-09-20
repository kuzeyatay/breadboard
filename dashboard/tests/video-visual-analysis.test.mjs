import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  augmentSourceMarkdown,
  evenlySample,
  transcriptWindow,
} from "../src/lib/scriberr/visual-analysis.ts";

const moduleSource = fs.readFileSync(
  path.join(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    "src", "lib", "scriberr", "visual-analysis.ts",
  ),
  "utf8",
);

const transcript = {
  title: "Lecture", language: "en", durationSeconds: 3600, sourceType: "youtube", speakers: [], transcriptionModel: null,
  segments: [
    { id: "a", startSeconds: 0, endSeconds: 20, speaker: null, text: "Welcome to the lecture." },
    { id: "b", startSeconds: 100, endSeconds: 130, speaker: null, text: "Gauss's law relates flux to enclosed charge." },
    { id: "c", startSeconds: 131, endSeconds: 160, speaker: null, text: "Here is the derivation on the board." },
    { id: "d", startSeconds: 900, endSeconds: 930, speaker: null, text: "Much later." },
  ],
};

test("frames are sampled evenly and each frame page carries the transcript said around it", () => {
  assert.deepEqual(evenlySample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4), [1, 4, 7, 10]);
  assert.deepEqual(evenlySample([1, 2], 4), [1, 2]);
  assert.equal(transcriptWindow(transcript, 120), "Gauss's law relates flux to enclosed charge. Here is the derivation on the board.");
  assert.equal(transcriptWindow(transcript, 500), "");
  assert.equal(transcriptWindow(null, 120), "");
});

test("the source note gains source_images, a what-the-video-shows section, and timestamped frame pages", () => {
  const markdown = [
    "---",
    'title: "Lecture 3"',
    'knowledge_type: "source-document"',
    "---",
    "",
    "# Lecture 3",
    "",
    "## Transcript",
    "",
    "[00:00] Welcome to the lecture.",
    "",
  ].join("\n");
  const out = augmentSourceMarkdown({
    markdown,
    analysis: "At 02:00 the board shows ∮E·dA = Q/ε0.",
    frames: [
      { url: "/em/assets/lecture-3-page-001.png", timestamp: "0:00", seconds: 0 },
      { url: "/em/assets/lecture-3-page-002.png", timestamp: "2:00", seconds: 120 },
    ],
    transcript,
  });
  assert.match(out, /^source_images: \["\/em\/assets\/lecture-3-page-001\.png", "\/em\/assets\/lecture-3-page-002\.png"\]$/m);
  assert.ok(out.indexOf("source_images:") < out.indexOf("\n---\n", 4), "source_images sits inside the frontmatter");
  assert.match(out, /## What the video shows\n\nAt 02:00 the board shows/);
  assert.match(out, /### Frame 2 \(00:02:00\)\n\n!\[Frame at 00:02:00\]\(\/em\/assets\/lecture-3-page-002\.png\)\n\nSaid around this moment: Gauss's law/);
  assert.match(out, /\[00:00\] Welcome to the lecture\./, "the transcript is kept intact");
  // Re-running replaces the frontmatter list instead of duplicating it.
  const again = augmentSourceMarkdown({ markdown: out, analysis: "x", frames: [{ url: "/em/assets/lecture-3-page-001.png", timestamp: "0:00", seconds: 0 }], transcript: null });
  assert.equal((again.match(/^source_images:/gm) ?? []).length, 1);
});

test("a failed reading is never published as what the video shows", () => {
  // The raw Watch report is a diagnostic: a warning line, encoder settings and
  // absolute paths to temporary frame files in a worker directory. Two videos
  // in a real garden carried that under "What the video shows" because the
  // ChatMock call had answered 400 and the report was used as a stand-in.
  const analysisStart = moduleSource.indexOf("const analysis = watched.chatmockAnalysis");
  assert.ok(analysisStart > 0, "expected the analysis to still come from the reading");
  const write = moduleSource.indexOf("fs.writeFileSync(sourcePath", analysisStart);
  assert.ok(write > analysisStart, "expected the source note to be written after it");
  const between = moduleSource.slice(analysisStart, write);
  assert.match(between, /if \(!analysis\) \{\s*throw new Error\(/);
  assert.doesNotMatch(moduleSource, /watched\.report/, "the raw report must not reach the note");

  // And the job says it failed rather than reporting Complete with an error
  // tucked into a field nobody reads.
  assert.match(moduleSource, /deps\.store\.transition\(job\.id, "failed", \{/);
});
