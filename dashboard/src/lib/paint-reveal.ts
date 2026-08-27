// Watercolor reveal engine — a Canvas 2D port of AirFan003/PaintPomodoro's p5
// sketch (background/mark-generator.js + overlay/watercolor.js). The artwork is
// NOT shown directly; it is repainted as thousands of translucent, noise-warped
// pigment splotches sampled from the image, built up from the centre outward as
// the reveal fraction grows — giving the soft, bleeding watercolor look.

const GRID_SIZE = 7;
const MAX_SAMPLE_WIDTH = 520;

interface RawMark {
  nx: number;
  ny: number;
  r: number;
  g: number;
  b: number;
  rot: number; // 0..1 (hue)
  mw: number;
  mh: number;
  sortKey: number;
}

interface Layout {
  scale: number;
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
  gridSize: number;
}

interface ExpandedMark {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  pigment: { r: number; g: number; b: number };
}

type Noise3 = (x: number, y: number, z: number) => number;

type Rng = () => number;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TWO_PI = Math.PI * 2;

// Deterministic PRNG so a given mark paints the same splotch shape every frame
// (needed so a mark can fade in over many frames without shimmering).
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function markHash(x: number, y: number, salt: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

// Smooth 3D value noise (replaces p5's noise) for coherent, organic dab edges.
function makeNoise(): Noise3 {
  const perm = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) base[i] = i;
  for (let i = 255; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i += 1) perm[i] = base[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const corner = (x: number, y: number, z: number) =>
    perm[(perm[(perm[x & 255] + y) & 255] + z) & 255] / 255;
  return (x, y, z) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const w = fade(z - zi);
    const c000 = corner(xi, yi, zi);
    const c100 = corner(xi + 1, yi, zi);
    const c010 = corner(xi, yi + 1, zi);
    const c110 = corner(xi + 1, yi + 1, zi);
    const c001 = corner(xi, yi, zi + 1);
    const c101 = corner(xi + 1, yi, zi + 1);
    const c011 = corner(xi, yi + 1, zi + 1);
    const c111 = corner(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, u);
    const x10 = lerp(c010, c110, u);
    const x01 = lerp(c001, c101, u);
    const x11 = lerp(c011, c111, u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  };
}

function rgbToHsb(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function sampleImageData(img: HTMLImageElement): { data: Uint8ClampedArray; w: number; h: number } {
  const scale = Math.min(1, MAX_SAMPLE_WIDTH / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(img, 0, 0, w, h);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

function sampleCellColor(data: Uint8ClampedArray, w: number, h: number, cx: number, cy: number) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let dy = 0; dy < GRID_SIZE; dy += 1) {
    for (let dx = 0; dx < GRID_SIZE; dx += 1) {
      const px = Math.min(w - 1, cx + dx);
      const py = Math.min(h - 1, cy + dy);
      const i = (py * w + px) * 4;
      if (data[i + 3] < 40) continue;
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count += 1;
    }
  }
  if (count === 0) return null;
  return { r: Math.round(rSum / count), g: Math.round(gSum / count), b: Math.round(bSum / count) };
}

function generateMarks(data: Uint8ClampedArray, w: number, h: number): RawMark[] {
  const marks: RawMark[] = [];
  for (let y = 0; y < h; y += GRID_SIZE) {
    for (let x = 0; x < w; x += GRID_SIZE) {
      const color = sampleCellColor(data, w, h, x, y);
      if (!color) continue;
      const nx = (x + GRID_SIZE / 2) / w;
      const ny = (y + GRID_SIZE / 2) / h;
      const hsb = rgbToHsb(color.r, color.g, color.b);
      const dxc = nx - 0.5;
      const dyc = ny - 0.5;
      const wobble = (markHash(Math.round(nx * 1000), Math.round(ny * 1000), 99) - 0.5) * 0.06;
      marks.push({
        nx,
        ny,
        r: color.r,
        g: color.g,
        b: color.b,
        rot: hsb.h,
        mw: Math.min(1.4, hsb.v * 2),
        mh: Math.min(1.6, (1 / Math.max(hsb.s, 0.12)) * 0.55),
        sortKey: Math.sqrt(dxc * dxc + dyc * dyc) + wobble,
      });
    }
  }
  marks.sort((a, b) => a.sortKey - b.sortKey); // centre-out
  return marks;
}

function computeLayout(sw: number, sh: number, cw: number, ch: number): Layout {
  const scale = Math.min(cw / sw, ch / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  return {
    scale,
    drawW,
    drawH,
    offsetX: (cw - drawW) / 2,
    offsetY: (ch - drawH) / 2,
    gridSize: GRID_SIZE,
  };
}

function expandMark(m: RawMark, layout: Layout): ExpandedMark {
  const cellSize = layout.gridSize * layout.scale;
  const shapeScale = Math.max(m.mw, m.mh, 0.85);
  const nx1k = Math.round(m.nx * 1000);
  const ny1k = Math.round(m.ny * 1000);
  const h1 = markHash(nx1k, ny1k, 1);
  const h2 = markHash(nx1k, ny1k, 2);
  const h6 = markHash(nx1k, ny1k, 6);
  const size = cellSize * Math.max(2.0, shapeScale * 2.75);
  return {
    x: layout.offsetX + m.nx * layout.drawW + (h1 - 0.5) * cellSize * 0.16,
    y: layout.offsetY + m.ny * layout.drawH + (h2 - 0.5) * cellSize * 0.16,
    pigment: { r: m.r, g: m.g, b: m.b },
    rotation: m.rot * TWO_PI + (h6 - 0.5) * 0.5,
    w: size,
    h: size * lerp(0.82, 1.18, h1),
  };
}

function depositDab(
  ctx: CanvasRenderingContext2D,
  noise: Noise3,
  x: number,
  y: number,
  radius: number,
  pigment: { r: number; g: number; b: number },
  alpha: number,
  rng: Rng = Math.random,
) {
  const rr = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const layers = Math.floor(rr(3, 6));
  for (let layer = 0; layer < layers; layer += 1) {
    const t = layer / layers;
    const r = radius * (1 - t * 0.68) * rr(0.85, 1.18);
    const a = alpha * (1 - t * 0.48) * rr(0.72, 1.2);
    ctx.fillStyle = `rgba(${pigment.r},${pigment.g},${pigment.b},${Math.min(1, a / 255)})`;
    ctx.beginPath();
    const verts = Math.floor(rr(7, 12));
    for (let v = 0; v < verts; v += 1) {
      const ang = (TWO_PI / verts) * v + rr(-0.35, 0.35);
      const n = noise(x * 0.011 + Math.cos(ang) * 0.35, y * 0.011 + Math.sin(ang) * 0.35, layer + v * 0.06);
      const wobble = 0.28 + n * 0.9;
      const rx = r * wobble * rr(0.85, 1.22);
      const ry = r * wobble * rr(0.7, 1.32);
      const vx = x + Math.cos(ang) * rx;
      const vy = y + Math.sin(ang) * ry;
      if (v === 0) ctx.moveTo(vx, vy);
      else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function depositSplotch(
  ctx: CanvasRenderingContext2D,
  noise: Noise3,
  mark: ExpandedMark,
  richness: number,
  sessionOpacity: number,
  rng: Rng = Math.random,
) {
  const rr = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const { x, y, w, h, rotation, pigment } = mark;
  const strength = clamp(richness * sessionOpacity * rr(0.55, 1.05), 0.38, 0.82);
  const spread = Math.max(w, h);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation + rr(-0.2, 0.2));
  depositDab(ctx, noise, 0, 0, spread * 0.52, pigment, rr(14, 24) * strength, rng);
  depositDab(ctx, noise, rr(-4, 4), rr(-4, 4), spread * rr(0.32, 0.44), pigment, rr(18, 30) * strength * rr(0.8, 1.15), rng);
  depositDab(ctx, noise, rr(-3, 3), rr(-3, 3), spread * rr(0.22, 0.34), pigment, rr(14, 24) * strength * rr(0.75, 1.2), rng);
  ctx.scale(w / spread, h / spread);
  depositDab(ctx, noise, 0, 0, spread * rr(0.3, 0.42), pigment, rr(16, 26) * strength * rr(0.85, 1.1), rng);
  depositDab(ctx, noise, rr(-4, 4), rr(-4, 4), spread * rr(0.18, 0.32), pigment, rr(10, 20) * strength * rr(0.7, 1.15), rng);
  ctx.restore();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

const PAPER = "#fbf8f2";
const FADE_FRAMES = 42; // ~0.7s for a new mark to fade in
const INCOMING_CAP = 90; // max marks fading in at once (bounds per-frame cost)

interface Incoming {
  index: number;
  age: number;
}

/**
 * Builds permanent splotches on an offscreen `wash` and animates only while new
 * paint is being revealed. Between reveal updates the visible canvas stays still.
 */
export class PaintReveal {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private wash: HTMLCanvasElement;
  private wctx: CanvasRenderingContext2D;
  private noise: Noise3;
  private marks: RawMark[] = [];
  private sampleW = 0;
  private sampleH = 0;
  private layout: Layout | null = null;
  private painted = 0;
  private target = 0;
  private targetFraction = 0;
  private incoming: Incoming[] = [];
  private raf = 0;
  private token = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.wash = document.createElement("canvas");
    this.wash.width = canvas.width || 1;
    this.wash.height = canvas.height || 1;
    const wctx = this.wash.getContext("2d");
    if (!wctx) throw new Error("no 2d context");
    this.wctx = wctx;
    this.noise = makeNoise();
    this.paper();
    this.render();
  }

  private paper() {
    this.wctx.setTransform(1, 0, 0, 1, 0, 0);
    this.wctx.fillStyle = PAPER;
    this.wctx.fillRect(0, 0, this.wash.width, this.wash.height);
  }

  /** Draw one mark (deterministic shape via seeded RNG) at a given opacity. */
  private drawMark(ctx: CanvasRenderingContext2D, index: number, alphaScale: number) {
    if (!this.layout) return;
    const sessionOpacity = lerp(0.6, 0.95, this.targetFraction);
    ctx.save();
    ctx.globalAlpha = alphaScale;
    depositSplotch(ctx, this.noise, expandMark(this.marks[index], this.layout), 0.94, sessionOpacity, mulberry32(index + 1));
    ctx.restore();
  }

  /** Instantly (re)paint the first `count` marks into the wash — used on resize. */
  private repaint(count: number) {
    this.paper();
    for (let i = 0; i < count; i += 1) this.drawMark(this.wctx, i, 1);
    this.painted = count;
  }

  private render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.wash, 0, 0);

    for (const item of this.incoming) {
      const f = item.age / FADE_FRAMES;
      this.drawMark(this.ctx, item.index, f * f * (3 - 2 * f)); // smoothstep fade-in
    }
  }

  private startAnimation() {
    if (!this.destroyed && !this.raf) {
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private frame = () => {
    this.raf = 0;
    if (this.destroyed) return;

    // 1. Queue new marks to fade in (adaptive rate; a small backlog trickles).
    if (this.painted < this.target && this.marks.length && this.layout) {
      const backlog = this.target - this.painted;
      const perFrame = Math.min(10, Math.max(1, Math.ceil(backlog * 0.03)));
      for (let n = 0; n < perFrame && this.painted < this.target && this.incoming.length < INCOMING_CAP; n += 1) {
        this.incoming.push({ index: this.painted, age: 0 });
        this.painted += 1;
      }
    }

    // 2. Advance fading marks; commit each to the wash once fully faded in.
    const stillFading: Incoming[] = [];
    for (const item of this.incoming) {
      item.age += 1;
      if (item.age >= FADE_FRAMES) this.drawMark(this.wctx, item.index, 1);
      else stillFading.push(item);
    }
    this.incoming = stillFading;

    // 3. Composite the wash and any marks that are actively fading in.
    this.render();

    if (this.painted < this.target || this.incoming.length > 0) this.startAnimation();
  };

  /** Size both buffers to the viewport and re-lay-out the painting. */
  resizeCanvas(width: number, height: number) {
    if (this.destroyed) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.canvas.width = w;
    this.canvas.height = h;
    this.wash.width = w;
    this.wash.height = h;
    this.incoming = [];
    if (this.marks.length && this.sampleW) {
      this.layout = computeLayout(this.sampleW, this.sampleH, w, h);
      this.repaint(this.painted);
    } else {
      this.paper();
    }
    this.render();
    if (this.painted < this.target) this.startAnimation();
  }

  /** Load + sample an image and reset the wash (canvas keeps its current size). */
  async load(url: string): Promise<void> {
    if (this.destroyed) return;
    const myToken = (this.token += 1);
    const img = await loadImage(url);
    if (this.destroyed || myToken !== this.token) return; // superseded or disposed
    const { data, w, h } = sampleImageData(img);
    this.marks = generateMarks(data, w, h);
    this.sampleW = w;
    this.sampleH = h;
    this.layout = computeLayout(w, h, this.canvas.width, this.canvas.height);
    this.painted = 0;
    this.target = 0;
    this.targetFraction = 0;
    this.incoming = [];
    this.paper();
    this.render();
  }

  /**
   * Set how much of the painting should be revealed. Monotonic within a piece —
   * pausing or resetting the timer never un-paints; only `load()` (a new piece)
   * clears the wash.
   */
  setTarget(fraction: number): void {
    if (this.destroyed || !this.marks.length) return;
    const clamped = clamp(fraction, 0, 1);
    this.targetFraction = Math.max(this.targetFraction, clamped);
    this.target = Math.max(this.target, Math.floor(clamped * this.marks.length));
    if (this.painted < this.target || this.incoming.length > 0) this.startAnimation();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.token += 1;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.incoming = [];
    this.marks = [];
    this.layout = null;
    this.sampleW = 0;
    this.sampleH = 0;
    this.painted = 0;
    this.target = 0;
    this.targetFraction = 0;
    // Resizing a canvas to zero releases its native drawing buffer. Clearing
    // only the RAF leaves both the visible and off-screen RGBA allocations
    // resident until a later garbage collection, which is especially costly
    // on repeated route navigation at high-DPI fullscreen sizes.
    this.wash.width = 0;
    this.wash.height = 0;
    this.canvas.width = 0;
    this.canvas.height = 0;
  }

  get ready(): boolean {
    return this.marks.length > 0 && this.layout !== null;
  }
}
