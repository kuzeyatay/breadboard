import type { SketchBox, SketchOutlines } from "./hermes/sketch-outline";

const inset = 1.75;
const round = (n: number) => Math.round(n * 100) / 100;
const smooth = (n: number) => n * n * (3 - 2 * n);

/** Each edge has its own fixed, pixel-sized waves. Changing the dock's height
 * must not redistribute knots around the whole perimeter and shake the top. */
function outline(box: SketchBox, seed: number, wobble: number): string {
  const left = inset, top = inset;
  const right = Math.max(left, box.width - inset);
  const bottom = Math.max(top, box.height - inset);
  const r = Math.max(0, Math.min(box.radius, (right - left) / 2, (bottom - top) / 2));
  const k = r * 0.55228475;
  let path = `M ${round(left + r)} ${top}`;
  function curve(...values: number[]) { path += ` C ${values.map(round).join(" ")}`; }
  function edge(x: number, y: number, dx: number, dy: number, length: number, phase: number) {
    if (length <= 0) return;
    const offset = (d: number) => {
      const fade = smooth(Math.min(1, Math.max(0, d / 40)))
        * smooth(Math.min(1, Math.max(0, (length - d) / 40)));
      return wobble * (0.65 * Math.sin(d / 22 + phase) + 0.35 * Math.sin(d / 37 + phase * 2)) * fade;
    };
    const slope = (d: number) => (offset(d + 0.01) - offset(d - 0.01)) / 0.02;
    const point = (d: number, o: number) => [x + dx * d - dy * o, y + dy * d + dx * o];
    for (let a = 0; a < length; a += 30) {
      const b = Math.min(length, a + 30), step = (b - a) / 3;
      curve(...point(a + step, offset(a) + slope(a) * step),
        ...point(b - step, offset(b) - slope(b) * step), ...point(b, offset(b)));
    }
  }
  edge(left + r, top, 1, 0, right - left - 2 * r, seed);
  curve(right - r + k, top, right, top + r - k, right, top + r);
  edge(right, top + r, 0, 1, bottom - top - 2 * r, seed + 2);
  curve(right, bottom - r + k, right - r + k, bottom, right - r, bottom);
  edge(right - r, bottom, -1, 0, right - left - 2 * r, seed + 4);
  curve(left + r - k, bottom, left, bottom - r + k, left, bottom - r);
  edge(left, bottom - r, 0, -1, bottom - top - 2 * r, seed + 6);
  curve(left, top + r - k, left + r - k, top, left + r, top);
  return `${path} Z`;
}

export function terminalDockOutlines(box: SketchBox): SketchOutlines {
  return { settled: outline(box, 1.7, 0.85), pass: outline(box, 4.1, 1.3) };
}
