import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  augmentSourceMarkdown,
  evenlySample,
  hasCompletedVisualAnalysis,
  kickPendingVisualAnalyses,
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
  assert.equal(hasCompletedVisualAnalysis(out), true);
  assert.equal(hasCompletedVisualAnalysis(markdown), false);
});

test("a durable visual analysis can resume at publication without rerunning Watch", () => {
  assert.match(moduleSource, /if \(hasCompletedVisualAnalysis\(fs\.readFileSync\(sourcePath, "utf8"\)\)\) \{/);
  assert.match(moduleSource, /await deps\.publish\(`video visual analysis for \$\{sourceSlug\}`,[\s\S]*?job\.userId\);/);
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

test("every Watch-selected frame is saved and optional description failure does not lose the video", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "watch-frames-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "course/sources/lecture.md");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, '---\ntitle: Lecture\n---\n## Transcript\nAll the lecture text.\n');
  const frame = path.join(root, "watch.png");
  fs.writeFileSync(frame, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1cAAAAASUVORK5CYII=", "base64"));
  const job = { id: `frames-${path.basename(root)}`, userId: 1, gardenId: "course", status: "analyzing_visuals", analysis: "watch",
    sourceSlug: "lecture", outputRelativePath: "sources/lecture.md", inputKind: "youtube", canonicalUrl: "https://example.test/lecture" };
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const store = {
    listJobsForCluster: () => [job], getJob: () => job,
    transition: (_id, state) => { job.status = state; if (["completed", "failed"].includes(state)) finish(state); },
  };
  let described = 0;
  let published = 0;
  const logs = [];
  kickPendingVisualAnalyses({ store, contentPath: root, ffmpegPath: "unused", log: message => logs.push(message),
    runWatch: async () => ({ report: "", chatmockAnalysis: "The board changes at every timestamp.",
      framePaths: Array.from({ length: 31 }, (_, i) => ({ path: frame, timestamp: `0:${String(i).padStart(2, "0")}` })) }),
    describeSource: async (userId, garden, source) => {
      assert.deepEqual([userId, garden, source], [1, "course", "sources/lecture.md"]);
      described++;
      throw new Error("description service is offline");
    },
    publish: async () => { published++; },
  }, 1);
  assert.equal(await completed, "completed");
  assert.equal(described, 1);
  assert.equal(published, 1);
  assert.equal(fs.readdirSync(path.join(root, "course/assets")).length, 31);
  const markdown = fs.readFileSync(sourcePath, "utf8");
  assert.equal((markdown.match(/^### Frame /gm) ?? []).length, 31);
  assert.match(markdown, /### Frame 31 \(00:00:30\)/);
  assert.match(logs.join("\n"), /descriptions are pending/);
});
