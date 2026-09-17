import test from "node:test";
import assert from "node:assert/strict";

await import("../scripts/learn-worker-import-hook.mjs");
const projection = await import("../src/lib/thought-topology/projection.ts");

test("ingest concept pages under Concepts/ publish; unstamped lesson pages and lessons elsewhere stay hidden", () => {
  const lesson = {
    relPath: "Concepts/13. exam-training/cylindrical-symmetry.md",
    knowledgeType: "learning-page",
    breadboardType: "learning_page",
    internal: "",
    draft: "",
    generatedBy: "document_ingestion",
    legacySubtopicPage: "",
    title: "13.2 Cylindrical Symmetry",
    sourceFile: "5EPF0 2024-10-23 - 1330 Eindhoven University of Technology Enter.mp3",
  };
  assert.equal(projection.quartzPublishesMarkdown(lesson), true);
  assert.equal(projection.quartzPublishesMarkdown({ ...lesson, generatedBy: "" }), false);
  assert.equal(projection.quartzPublishesMarkdown({ ...lesson, relPath: "learning/1. section/page.md" }), false);
  assert.equal(projection.quartzPublishesMarkdown({ ...lesson, generatedBy: "learn_button", relPath: "learning/1. section/page.md" }), true);
  assert.equal(projection.quartzPublishesMarkdown({ ...lesson, internal: "true" }), false);
});

test("the semantic projection drops ingest scaffolding sections and provenance lines from a concept page", () => {
  const body = [
    "# 13.2 Cylindrical Symmetry",
    "",
    "Source: [[5epf0-2024-10-23|Exam Training]]",
    "",
    "Locations: Transcript: top-view drawing of the field",
    "",
    "The symmetry of the infinite uniform line determines the direction of the field before any integration.",
    "",
    "## Page-Grounded Details",
    "",
    "#### Transcript",
    "",
    "All right. Good afternoon, everyone. It's good to see at least half of the students back here.",
    "",
    "## Core Ideas",
    "",
    "Rotational symmetry removes the azimuthal dependence of the field magnitude.",
    "",
    "## Source Anchors",
    "",
    "- Transcript: final direction of the electric field",
    "",
    "## Related Pages",
    "",
    "- [[spatial-model]]",
  ].join("\n");
  const kept = projection.authoredBody(body);
  assert.ok(kept.includes("The symmetry of the infinite uniform line"));
  assert.ok(kept.includes("## Core Ideas"));
  assert.ok(kept.includes("Rotational symmetry"));
  assert.ok(!kept.includes("Good afternoon"), "the grounding transcript excerpt is not the page's own text");
  assert.ok(!kept.includes("Page-Grounded"));
  assert.ok(!kept.includes("Source Anchors"));
  assert.ok(!kept.includes("Related Pages"));
  assert.ok(!kept.includes("Source: [["));
  assert.ok(!kept.includes("Locations:"));
});

test("embed text is clipped on code points and within the adapter's byte budget", () => {
  const { clipText, clipUtf8, SEMANTIC_TEXT_MAX_BYTES } = projection;
  const wellFormed = (value) => value === value.toWellFormed();

  // A cut that would land between the two halves of an emoji drops the pair.
  const emojiAtEdge = `${"a".repeat(9)}\u{1F600}b`;
  assert.equal(clipText(emojiAtEdge, 10), "a".repeat(9));
  assert.equal(clipText(emojiAtEdge, 11), `${"a".repeat(9)}\u{1F600}`);
  assert.equal(clipText(emojiAtEdge, 100), emojiAtEdge);
  for (let max = 1; max <= 12; max += 1) assert.ok(wellFormed(clipText(emojiAtEdge, max)), `clipText at ${max}`);

  // Bytes, not characters: a page of Greek letters is two bytes per character.
  const greek = "ω".repeat(10_000);
  const clipped = clipUtf8(greek, SEMANTIC_TEXT_MAX_BYTES);
  assert.ok(Buffer.byteLength(clipped, "utf8") <= SEMANTIC_TEXT_MAX_BYTES);
  assert.equal(clipped, "ω".repeat(8_000));
  assert.ok(wellFormed(clipUtf8(`${"a".repeat(15_999)}\u{1F600}`, SEMANTIC_TEXT_MAX_BYTES)));
  assert.equal(clipUtf8("short", SEMANTIC_TEXT_MAX_BYTES), "short");
});
