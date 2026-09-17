import test from "node:test";
import assert from "node:assert/strict";
import {
  placeInteractiveVisualAnchor,
  stripInteractiveVisualWriterMarkers,
} from "../src/lib/visualization-opportunities.ts";

const lesson = [
  "### One physical channel, several logical channels",
  "",
  "A shared physical channel gives several users one common pool of capacity.",
  "",
  "### Choosing the dimension that separates users",
  "",
  "Frequency, time, and code are three ways to divide the same resource.",
  "",
  "<!-- learning-unit:U2:interactive-visual -->",
  "",
  "### What remains the same when the partition changes",
  "",
  "The total capacity is fixed.",
].join("\n");

test("the writer marker places the visual where the idea is taught, not after the introduction", () => {
  const placed = placeInteractiveVisualAnchor(lesson, "U2");
  assert.equal(placed.insertionAnchor, "learning-unit:U2:interactive-visual");
  assert.equal(placed.placedByWriter, true);
  const markerIndex = placed.markdown.indexOf("<!-- learning-unit:U2:interactive-visual -->");
  assert.ok(markerIndex > placed.markdown.indexOf("Frequency, time, and code"));
  assert.ok(markerIndex < placed.markdown.indexOf("### What remains the same"));
  assert.doesNotMatch(placed.markdown, /after-introduction/);
});

test("a missing, repeated, or inline writer marker falls back to after the introduction", () => {
  const withoutMarker = lesson.replace("<!-- learning-unit:U2:interactive-visual -->\n\n", "");
  const repeated = lesson + "\n\n<!-- learning-unit:U2:interactive-visual -->\n";
  const inline = lesson.replace(
    "\n\n<!-- learning-unit:U2:interactive-visual -->",
    " <!-- learning-unit:U2:interactive-visual -->",
  );
  for (const markdown of [withoutMarker, repeated, inline]) {
    const placed = placeInteractiveVisualAnchor(markdown, "U2");
    assert.equal(placed.insertionAnchor, "learning-unit:U2:after-introduction");
    assert.equal(placed.placedByWriter, false);
    assert.doesNotMatch(placed.markdown, /interactive-visual -->/);
    const fallback = placed.markdown.indexOf("<!-- learning-unit:U2:after-introduction -->");
    assert.ok(fallback > placed.markdown.indexOf("A shared physical channel"));
    assert.ok(fallback < placed.markdown.indexOf("### Choosing the dimension"));
  }
});

test("an existing fallback marker is not duplicated", () => {
  const markdown = "Intro paragraph.\n\n<!-- learning-unit:U2:after-introduction -->\n\nMore prose.";
  const placed = placeInteractiveVisualAnchor(markdown, "U2");
  assert.equal(placed.markdown.split("after-introduction").length - 1, 1);
});

test("a page without a planned visual keeps no stray writer marker", () => {
  assert.doesNotMatch(stripInteractiveVisualWriterMarkers(lesson), /interactive-visual/);
});
