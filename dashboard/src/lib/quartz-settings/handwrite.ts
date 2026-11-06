// Adapted from yashlamba/handwrite (MIT). See src/vendor/handwrite/README.md.
import config from '../../vendor/handwrite/default.json';
import BitmapImage from './bitmap';
// @ts-ignore -- Upstream JavaScript packages do not ship TypeScript declarations.
import Potrace from 'potrace/lib/Potrace.js';
// @ts-ignore -- The application already ships OpenType.js.
import { Font, Glyph, Path, parse } from 'opentype.js';

export const GLYPHS: number[] = config.glyphs;
type Box = { x: number; y: number; width: number; height: number; area: number };
export type Pixels = { width: number; height: number; data: Uint8ClampedArray };

function morphology(input: Uint8Array, width: number, height: number, dilate: boolean) {
  const horizontal = new Uint8Array(input.length), result = new Uint8Array(input.length);
  for (let y = 0; y < height; y++) for (let x = 2; x < width - 2; x++) {
    const i = y * width + x;
    const count = input[i - 2] + input[i - 1] + input[i] + input[i + 1] + input[i + 2];
    horizontal[i] = Number(dilate ? count > 0 : count === 5);
  }
  for (let y = 2; y < height - 2; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    const count = horizontal[i - 2 * width] + horizontal[i - width] + horizontal[i] + horizontal[i + width] + horizontal[i + 2 * width];
    result[i] = Number(dilate ? count > 0 : count === 5);
  }
  return result;
}

export function detectCells({ width, height, data }: Pixels): Box[] {
  if (width < 640 || height < 800 || width * height > 6_000_000 || data.length !== width * height * 4) {
    throw new Error('Use a clear, upright scan of the whole template, at least 640 × 800 pixels.');
  }
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = Number(data[i * 4 + 3] > 127 && (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 < config.threshold_value);
  }
  const closed = morphology(morphology(mask, width, height, true), width, height, false);
  const queue = new Int32Array(closed.length), candidates: Box[] = [];
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start]) continue;
    let read = 0, end = 1, minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; closed[start] = 0;
    while (read < end) {
      const i = queue[read++], x = i % width, y = Math.floor(i / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const next of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (next >= 0 && next < closed.length && closed[next]) { closed[next] = 0; queue[end++] = next; }
      }
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (w < width * .055 || w > width * .17 || h < height * .035 || h > height * .12 || w / h < .65 || w / h > 1.5) continue;
    // The enclosing rectangle must reach all four sides, not merely be a large glyph.
    let edge = 0;
    for (let i = 0; i < end; i++) {
      const x = queue[i] % width, y = Math.floor(queue[i] / width);
      if (x < minX + w * .12 || x > maxX - w * .12 || y < minY + h * .12 || y > maxY - h * .12) edge++;
    }
    if (edge / end > .75 && end > (w + h) * 1.3) candidates.push({ x: minX, y: minY, width: w, height: h, area: w * h });
  }
  const boxes = candidates.sort((a, b) => b.area - a.area).slice(0, 80).sort((a, b) => a.y + a.height / 2 - b.y - b.height / 2);
  if (boxes.length !== 80) throw new Error(`Found ${boxes.length} of 80 boxes. Scan the entire template upright, with all borders visible and no shadows.`);
  const ordered: Box[] = [];
  const median = [...boxes].sort((a, b) => a.area - b.area)[40].area;
  for (let row = 0; row < 10; row++) {
    const group = boxes.slice(row * 8, row * 8 + 8).sort((a, b) => a.x - b.x);
    if (group.some(b => b.area < median * .65 || b.area > median * 1.5) ||
        Math.max(...group.map(b => b.y)) - Math.min(...group.map(b => b.y)) > group[0].height * .45 ||
        group.some((b, i) => i && b.x < group[i - 1].x + group[i - 1].width * .8)) {
      throw new Error('The boxes are not aligned. Straighten the scan and include the complete 8-column, 10-row template.');
    }
    ordered.push(...group);
  }
  return ordered;
}

function crop(pixels: Pixels, box: Box): Pixels {
  const size = 160, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.min(pixels.width - 1, Math.floor(box.x + box.width / 16 + x * box.width * 7 / (8 * size)));
    const sy = Math.min(pixels.height - 1, Math.floor(box.y + box.height / 16 + y * box.height * 7 / (8 * size)));
    const from = (sy * pixels.width + sx) * 4, to = (y * size + x) * 4;
    const value = (pixels.data[from] + pixels.data[from + 1] + pixels.data[from + 2]) / 3 < config.threshold_value ? 0 : 255;
    data[to] = data[to + 1] = data[to + 2] = value; data[to + 3] = 255;
  }
  return { width: size, height: size, data };
}

function metrics(character: string): [number, number] {
  if ('.,'.includes(character)) return [character === '.' ? 95 : 170, character === '.' ? 0 : -80];
  if (';:'.includes(character)) return [350, character === ';' ? -80 : 0];
  if ('"\''.includes(character)) return [210, 480];
  if ('-+=' .includes(character)) return [character === '-' ? 80 : 330, character === '-' ? 240 : 150];
  if ('gjpqy'.includes(character)) return [690, -190];
  if (/[a-z]/.test(character) && !'bdfhklt'.includes(character)) return [500, 0];
  return [700, 0];
}

export async function generateHandwriting(pixels: Pixels, progress: (value: number) => void = () => {}) {
  const cells = detectCells(pixels), glyphs = [new Glyph({ name: '.notdef', advanceWidth: 500, path: new Path() }), new Glyph({ name: 'space', unicode: 32, advanceWidth: 320, path: new Path() })];
  const missing: string[] = [];
  for (let index = 0; index < GLYPHS.length; index++) {
    const unicode = GLYPHS[index], character = String.fromCodePoint(unicode), image = crop(pixels, cells[index]);
    const trace = new Potrace({ threshold: config.threshold_value, turdSize: 2, optTolerance: .2 });
    // Potrace's public image API, with an in-memory bitmap adapter in browser builds.
    await new Promise<void>((resolve, reject) => trace.loadImage(new BitmapImage(image), (error: Error | null) => error ? reject(error) : resolve()));
    const pathData = / d="([^"]*)"/.exec(trace.getPathTag())?.[1];
    if (!pathData?.trim()) { missing.push(character); continue; }
    const outline = Path.fromSVG(pathData, { flipY: true }), bounds = outline.getBoundingBox();
    const [targetHeight, bottom] = metrics(character), scale = targetHeight / Math.max(1, bounds.y2 - bounds.y1);
    const table = config.typography_parameters.bearing_table as Record<string, (number | null)[]>;
    const bearings = table[character] ?? table.Default, left = Math.max(20, bearings[0] ?? 60), right = Math.max(20, bearings[1] ?? 60);
    for (const command of outline.commands) for (const suffix of ['', '1', '2']) {
      if (typeof command[`x${suffix}`] === 'number') command[`x${suffix}`] = (command[`x${suffix}`] - bounds.x1) * scale + left;
      if (typeof command[`y${suffix}`] === 'number') command[`y${suffix}`] = (command[`y${suffix}`] - bounds.y1) * scale + bottom;
    }
    glyphs.push(new Glyph({ name: `uni${unicode.toString(16).padStart(4, '0')}`, unicode,
      advanceWidth: Math.round((bounds.x2 - bounds.x1) * scale + left + right), path: outline }));
    progress(Math.round((index + 1) / GLYPHS.length * 100));
  }
  if (missing.length) throw new Error(`These boxes are empty or too faint: ${missing.join(' ')}. Fill them in dark ink and scan again.`);
  const font = new Font({ familyName: 'My Handwriting', styleName: 'Regular', unitsPerEm: 1000, ascender: 850, descender: -250, glyphs });
  const bytes = font.toArrayBuffer();
  validateHandwritingFont(bytes);
  return bytes as ArrayBuffer;
}

export function validateHandwritingFont(bytes: ArrayBuffer) {
  if (bytes.byteLength > 2_000_000 || bytes.byteLength < 100) throw new Error('Use a handwriting font exported from these settings (maximum 2 MB).');
  let font;
  try { font = parse(bytes); } catch { throw new Error('This file is not a valid OpenType handwriting font.'); }
  if (GLYPHS.some(code => !font.charToGlyphIndex(String.fromCodePoint(code)))) throw new Error('The font must contain all 80 Handwrite characters.');
  return bytes;
}
