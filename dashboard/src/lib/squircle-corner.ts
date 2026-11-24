/**
 * Squircle corner geometry, matching CSS `corner-shape: squircle`.
 *
 * Every rounded edge in Breadboard draws as a squircle (globals.css). CSS
 * defines `squircle` as `superellipse(2)`: inside the corner's radius box the
 * curve is |x|^4 + |y|^4 = 1 rather than the circle's |x|^2 + |y|^2 = 1. Any
 * line that is drawn *along* a card's edge — the hand-drawn sketch outlines,
 * the composer beam — has to walk this same curve, or it parts from the card
 * at every corner.
 */

/**
 * Whether an element's corners actually render as squircles. Circles and
 * pills opt back into `round`, and a browser without `corner-shape` draws
 * plain arcs, so a drawn line asks the element instead of assuming.
 */
export function hasSquircleCorners(style: CSSStyleDeclaration): boolean {
  const shape = String(
    style.getPropertyValue("corner-top-left-shape") || style.getPropertyValue("corner-shape") || "",
  ).trim();
  return shape === "squircle" || /^superellipse\(\s*2(\.0+)?\s*\)$/.test(shape);
}

/**
 * The shell's squircle default for a standalone document Breadboard serves
 * (an OAuth popup, a sandboxed preview iframe) that cannot see globals.css.
 * Zero specificity, so the document's own rules win; circles and pills
 * written as 50% / 999px radii stay round.
 */
export const SQUIRCLE_DOCUMENT_CSS =
  ":where(*),:where(*)::before,:where(*)::after{corner-shape:squircle}" +
  ":where([style*=\"border-radius: 50%\"],[style*=\"border-radius: 999px\"],[style*=\"border-radius: 9999px\"]){corner-shape:round}";

/** Adds `corner-shape: round` beside full-round radii in a document's own CSS. */
export function keepFullRoundCorners<T>(css: T): T {
  if (typeof css !== "string") return css;
  return css.replace(
    /(border-radius\s*:\s*(?:50%|100%|\d{3,}px)\s*(?:!important)?)\s*(;|(?=\}))/g,
    "$1;corner-shape:round;",
  ) as T;
}

/** Superellipse exponent of CSS `corner-shape: squircle`. */
export const SQUIRCLE_EXPONENT = 4;

/**
 * Bezier handle length, as a fraction of the radius, for one cubic that
 * approximates a squircle quarter (the circle's is 0.5523). Chosen so the
 * cubic's midpoint lands on the curve's 45° point, 0.5^(1/4) of the radius
 * out: 0.5 + 0.375 * k = 0.8409.
 */
export const SQUIRCLE_BEZIER_HANDLE = (Math.pow(0.5, 1 / SQUIRCLE_EXPONENT) - 0.5) / 0.375;

const SAMPLES = 96;
const POWER = 2 / SQUIRCLE_EXPONENT;

function unitPoint(angle: number): [number, number] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [Math.sign(c) * Math.pow(Math.abs(c), POWER), Math.sign(s) * Math.pow(Math.abs(s), POWER)];
}

/** Cumulative arc length of one unit-radius quarter, sampled by angle. */
const cumulative: number[] = (() => {
  const lengths = [0];
  let previous = unitPoint(0);
  for (let index = 1; index <= SAMPLES; index += 1) {
    const next = unitPoint((index / SAMPLES) * (Math.PI / 2));
    lengths.push(lengths[index - 1] + Math.hypot(next[0] - previous[0], next[1] - previous[1]));
    previous = next;
  }
  return lengths;
})();

/** Arc length of one squircle corner of radius 1 (a circle's is π/2). */
export const SQUIRCLE_QUARTER_LENGTH = cumulative[SAMPLES];

/** The local sweep angle that sits `fraction` of the way along the corner by arc length. */
function sweepAtFraction(fraction: number): number {
  const target = Math.min(1, Math.max(0, fraction)) * SQUIRCLE_QUARTER_LENGTH;
  let low = 0;
  let high = SAMPLES;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] <= target) low = middle;
    else high = middle;
  }
  const span = cumulative[high] - cumulative[low] || 1;
  const step = low + (target - cumulative[low]) / span;
  return (step / SAMPLES) * (Math.PI / 2);
}

/**
 * A point on a squircle corner with its outward unit normal, for geometry that
 * pushes features off the edge. The normal is the superellipse's gradient
 * (x^3, y^3), so it stays perpendicular to the drawn curve.
 */
export function squircleCornerSample(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  fraction: number,
): { x: number; y: number; nx: number; ny: number } {
  const [ux, uy] = unitPoint(startAngle + sweepAtFraction(fraction));
  const gx = Math.sign(ux) * Math.pow(Math.abs(ux), SQUIRCLE_EXPONENT - 1);
  const gy = Math.sign(uy) * Math.pow(Math.abs(uy), SQUIRCLE_EXPONENT - 1);
  const length = Math.hypot(gx, gy) || 1;
  return { x: centerX + ux * radius, y: centerY + uy * radius, nx: gx / length, ny: gy / length };
}

/** An SVG path for a squircle-cornered rectangle, one cubic per corner. */
export function squircleRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const k = r * (1 - SQUIRCLE_BEZIER_HANDLE);
  const right = x + width;
  const bottom = y + height;
  const n = (value: number) => Math.round(value * 100) / 100;
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(right - r)}`,
    `C${n(right - k)} ${n(y)} ${n(right)} ${n(y + k)} ${n(right)} ${n(y + r)}`,
    `V${n(bottom - r)}`,
    `C${n(right)} ${n(bottom - k)} ${n(right - k)} ${n(bottom)} ${n(right - r)} ${n(bottom)}`,
    `H${n(x + r)}`,
    `C${n(x + k)} ${n(bottom)} ${n(x)} ${n(bottom - k)} ${n(x)} ${n(bottom - r)}`,
    `V${n(y + r)}`,
    `C${n(x)} ${n(y + k)} ${n(x + k)} ${n(y)} ${n(x + r)} ${n(y)}`,
    "Z",
  ].join(" ");
}

/**
 * A point on a squircle corner. `startAngle` names the quarter the same way a
 * circular arc would (-π/2 for top-right, 0 bottom-right, π/2 bottom-left, π
 * top-left, walking clockwise); `fraction` is how far along it, by arc length.
 */
export function squircleCornerPoint(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  fraction: number,
): [number, number] {
  const [x, y] = unitPoint(startAngle + sweepAtFraction(fraction));
  return [centerX + x * radius, centerY + y * radius];
}
