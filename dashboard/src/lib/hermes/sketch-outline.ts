/**
 * A card outline drawn the way a hand draws one.
 *
 * The voice screen's ring is `inkRingPath`: knots placed around a circle, each
 * pushed a little off it, smoothed with Catmull-Rom so the wobble stays a line
 * rather than a polygon. This is the same idea walked around a rounded
 * rectangle, for the blank chat's opener cards. A geometric `<rect>` was tried
 * first and read as machine-drawn next to the ring it was supposed to echo.
 *
 * Paths are generated in real pixel coordinates from the card's measured size
 * — not percentages. Percentages put the drawn outline at the card's content
 * height while a grid row stretched it taller; a measured path in a matching
 * viewBox cannot disagree with the card it was measured from.
 */

import { seededRandom } from "../speech/voice-conversation.ts";

export interface SketchBox {
  /** The card's border box, in CSS pixels. */
  width: number;
  height: number;
  /** The card's own corner radius. Read from the card, never restated. */
  radius: number;
}

/** How far beyond the card's border box the drawing surface extends. */
export const SKETCH_MARGIN = 1;

/** Half the stroke sits either side of the card's 1px border. */
const STROKE_INSET = 1.75;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * One closed pass around the rounded rectangle: knots at even distances along
 * the perimeter, each jittered a little off the line, joined with Catmull-Rom
 * so the hand stays smooth through its own wobble.
 */
export function sketchRectPath(
  seed: number,
  box: SketchBox,
  wobble = 1.1,
): string {
  const surfaceWidth = box.width + SKETCH_MARGIN * 2;
  const surfaceHeight = box.height + SKETCH_MARGIN * 2;
  const left = STROKE_INSET;
  const top = STROKE_INSET;
  const right = surfaceWidth - STROKE_INSET;
  const bottom = surfaceHeight - STROKE_INSET;
  const radius = Math.max(
    0,
    Math.min(box.radius, (right - left) / 2, (bottom - top) / 2),
  );

  const straightWidth = right - left - 2 * radius;
  const straightHeight = bottom - top - 2 * radius;
  const arcLength = (Math.PI * radius) / 2;
  const perimeter = 2 * straightWidth + 2 * straightHeight + 4 * arcLength;

  // Clockwise from the end of the top-left corner, in arc length. Each entry
  // maps a distance within its segment to a point on the ideal outline.
  const segments: Array<{
    length: number;
    at: (t: number) => [number, number];
  }> = [
    { length: straightWidth, at: (t) => [left + radius + t, top] },
    {
      length: arcLength,
      at: (t) => {
        const angle = -Math.PI / 2 + (t / arcLength) * (Math.PI / 2);
        return [right - radius + Math.cos(angle) * radius, top + radius + Math.sin(angle) * radius];
      },
    },
    { length: straightHeight, at: (t) => [right, top + radius + t] },
    {
      length: arcLength,
      at: (t) => {
        const angle = (t / arcLength) * (Math.PI / 2);
        return [right - radius + Math.cos(angle) * radius, bottom - radius + Math.sin(angle) * radius];
      },
    },
    { length: straightWidth, at: (t) => [right - radius - t, bottom] },
    {
      length: arcLength,
      at: (t) => {
        const angle = Math.PI / 2 + (t / arcLength) * (Math.PI / 2);
        return [left + radius + Math.cos(angle) * radius, bottom - radius + Math.sin(angle) * radius];
      },
    },
    { length: straightHeight, at: (t) => [left, bottom - radius - t] },
    {
      length: arcLength,
      at: (t) => {
        const angle = Math.PI + (t / arcLength) * (Math.PI / 2);
        return [left + radius + Math.cos(angle) * radius, top + radius + Math.sin(angle) * radius];
      },
    },
  ];

  const pointAt = (distance: number): [number, number] => {
    let remaining = ((distance % perimeter) + perimeter) % perimeter;
    for (const segment of segments) {
      if (remaining <= segment.length) return segment.at(remaining);
      remaining -= segment.length;
    }
    return segments[0].at(0);
  };

  // A knot roughly every 30px keeps the wobble at the wavelength of the voice
  // ring's — closer and the line shivers, further and it reads as bent.
  const random = seededRandom(seed);
  const count = Math.max(12, Math.round(perimeter / 30));
  const knots: Array<[number, number]> = [];
  for (let index = 0; index < count; index += 1) {
    const [x, y] = pointAt((index / count) * perimeter);
    knots.push([
      x + (random() - 0.5) * 2 * wobble,
      y + (random() - 0.5) * 2 * wobble,
    ]);
  }

  const at = (index: number) => knots[(index + knots.length) % knots.length];
  let path = `M ${round(knots[0][0])} ${round(knots[0][1])}`;
  for (let index = 0; index < knots.length; index += 1) {
    const [x0, y0] = at(index - 1);
    const [x1, y1] = at(index);
    const [x2, y2] = at(index + 1);
    const [x3, y3] = at(index + 2);
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    path += ` C ${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${round(x2)} ${round(y2)}`;
  }
  return `${path} Z`;
}

export interface SketchOutlines {
  /** The settled line: whole, faint, always there. */
  settled: string;
  /** The pass that draws along it, rests, and lifts. */
  pass: string;
}

/**
 * The two layers of one card. Different seeds, and a little more wobble on the
 * pass than the settled line: the hand going over a line never follows it
 * exactly, which is most of what reads as a hand at all.
 */
export function sketchRectOutlines(box: SketchBox, cardIndex: number): SketchOutlines {
  return {
    settled: sketchRectPath(47 + cardIndex * 13, box, 0.85),
    pass: sketchRectPath(101 + cardIndex * 29, box, 1.3),
  };
}
