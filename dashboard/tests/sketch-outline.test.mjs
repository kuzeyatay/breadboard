// The hand-drawn outline under the blank chat's opener cards.
//
// The regression that motivates most of this: the outline used to be sized in
// percentages, and sat at the card's content height while the grid row
// stretched the card taller — the drawn line crossed straight through the
// middle of the card. Paths are now generated from the measured box, so the
// promise to test is that the drawing actually spans the box it was given,
// whatever shape that box is.

import assert from "node:assert/strict";
import test from "node:test";

import {
  SKETCH_MARGIN,
  sketchRectOutlines,
  sketchRectPath,
} from "../src/lib/hermes/sketch-outline.ts";

/** Every coordinate pair in a path string. */
function pointsOf(path) {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const points = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push([numbers[index], numbers[index + 1]]);
  }
  return points;
}

const BOX = { width: 280, height: 44, radius: 8 };

test("a pass is one closed hand-drawn line", () => {
  const path = sketchRectPath(31, BOX);
  assert.match(path, /^M -?\d/);
  assert.match(path, / Z$/);
  // Smoothed with curves, never a polygon of straight segments.
  assert.ok(path.includes(" C "));
  assert.ok(!path.includes(" L "));
});

test("the drawing spans the box it was measured from", () => {
  // A one-line card stretched tall by its two-line neighbour: the outline has
  // to reach the stretched bottom, not stop at the content height.
  const stretched = { width: 280, height: 66, radius: 8 };
  const points = pointsOf(sketchRectPath(31, stretched));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const surfaceWidth = stretched.width + SKETCH_MARGIN * 2;
  const surfaceHeight = stretched.height + SKETCH_MARGIN * 2;

  // The wobble may carry a knot a couple of pixels off the ideal line, and no
  // further; the line must actually visit all four edges.
  const slack = 4;
  assert.ok(Math.min(...ys) > -slack && Math.min(...ys) < slack + 4);
  assert.ok(Math.max(...ys) > surfaceHeight - slack - 4 && Math.max(...ys) < surfaceHeight + slack);
  assert.ok(Math.min(...xs) > -slack && Math.max(...xs) < surfaceWidth + slack);
});

test("the same box and seed always draw the same line", () => {
  assert.equal(sketchRectPath(31, BOX), sketchRectPath(31, BOX));
  assert.notEqual(sketchRectPath(31, BOX), sketchRectPath(32, BOX));
});

test("the two layers of a card are two different hands over the same box", () => {
  const outlines = sketchRectOutlines(BOX, 0);
  assert.notEqual(outlines.settled, outlines.pass);
  // And neighbouring cards do not share a drawing.
  assert.notEqual(outlines.pass, sketchRectOutlines(BOX, 1).pass);
});

test("a degenerate box does not produce a degenerate path", () => {
  // Radius larger than the box: clamped, not folded into NaN.
  const tiny = sketchRectPath(31, { width: 20, height: 12, radius: 40 });
  assert.doesNotMatch(tiny, /NaN/);
  assert.match(tiny, / Z$/);
});
