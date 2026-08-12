"use client";

// Feeds the real page to the liquid-glass bar.
//
// LiquidGlass can only refract pixels that live inside its own root, and the
// page behind a fixed dock does not. Rasterising the page into the root as a
// normal child is not an option either: the library re-runs html-to-image
// whenever such a child changes size, which on a resizable dock means every
// drag frame.
//
// So the page is rasterised once, off to the side, and the strip behind the
// bar is blitted out of that raster into a <canvas> child. The library draws
// <canvas> children straight through drawImage — no html-to-image, no cache,
// no size sensitivity — so scrolling costs one small blit per frame and the
// expensive part only re-runs when the page itself actually changes.

import { toCanvas } from "html-to-image";

/** Quiet period before a DOM change is worth re-rasterising for. */
const CAPTURE_DEBOUNCE_MS = 800;
/** Floor between two rasterisations, however chatty the page is. */
const CAPTURE_MIN_INTERVAL_MS = 3000;
/** Canvases have per-side limits, and a raster this large is already overkill. */
const MAX_RASTER_SIDE_PX = 12_000;

/** Resolve a CSS colour to rgba() at the given alpha, via the canvas parser. */
function withAlpha(color: string, alpha: number): string {
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return color;
  probe.fillStyle = "#000";
  probe.fillStyle = color;
  const resolved = probe.fillStyle;
  if (typeof resolved === "string" && resolved.startsWith("#") && resolved.length === 7) {
    const r = parseInt(resolved.slice(1, 3), 16);
    const g = parseInt(resolved.slice(3, 5), 16);
    const b = parseInt(resolved.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return resolved;
}

type PaintArgs = {
  canvas: HTMLCanvasElement;
  /** Cached page raster; null until the first capture lands. */
  raster: HTMLCanvasElement | null;
  rasterScale: number;
  rasterOrigin: { x: number; y: number };
  /** Leave the floor unpainted so a wallpaper layer below can show through. */
  transparentFloor: boolean;
};

/**
 * Paint the single layer the glass refracts: page-background floor, then the
 * live page, then a warm sheen.
 *
 * This used to be three sibling <div>s. The library rasterises non-media
 * children through html-to-image, and when any of them failed to rasterise the
 * scene kept the library's default #ffffff fill — which is exactly why the bar
 * rendered as a white slab with only the page content punched through it.
 * Folding all three into one <canvas> means the library takes the drawImage
 * fast path, nothing depends on a rasteriser succeeding, and there is no
 * multi-layer paint ordering left to get wrong.
 */
export function paintSceneCanvas({
  canvas,
  raster,
  rasterScale,
  rasterOrigin,
  transparentFloor,
}: PaintArgs): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const box = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(box.width * dpr));
  const height = Math.max(1, Math.round(box.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const root = getComputedStyle(document.documentElement);
  const paperBg = root.getPropertyValue("--paper-bg").trim() || "#e6f0e6";
  const paperRaised = root.getPropertyValue("--paper-raised").trim() || "#fffefb";
  const terminalBar = root.getPropertyValue("--terminal-bar").trim() || "#e8d7bd";

  context.clearRect(0, 0, width, height);

  // The page's own floor. Without it the glass refracts nothing where the page
  // is plain background, and the library's white shows instead of your green.
  if (!transparentFloor) {
    context.fillStyle = paperBg;
    context.fillRect(0, 0, width, height);
  }

  if (raster) {
    // The raster is in page coordinates relative to the scene root's own
    // top-left, so the strip's page position picks the slice directly.
    const sourceX = (box.left + window.scrollX - rasterOrigin.x) * rasterScale;
    const sourceY = (box.top + window.scrollY - rasterOrigin.y) * rasterScale;
    context.drawImage(
      raster,
      sourceX,
      sourceY,
      box.width * rasterScale,
      box.height * rasterScale,
      0,
      0,
      width,
      height,
    );
  }

  // A sheen, lit along the top edge the way a pane is. It doubles as the
  // legibility scrim: a dark page element passing under the bar should tint the
  // glass, not take it over, or the bar's own label stops being readable.
  const sheen = context.createLinearGradient(0, 0, 0, height);
  sheen.addColorStop(0, withAlpha(paperRaised, 0.52));
  sheen.addColorStop(0.52, withAlpha(terminalBar, 0.32));
  sheen.addColorStop(1, withAlpha(terminalBar, 0.42));
  context.fillStyle = sheen;
  context.fillRect(0, 0, width, height);
}

/**
 * Paint floor and sheen before any capture exists, so the very first frame the
 * library composites already has a real surface instead of white.
 */
export function primeSceneCanvas(
  canvas: HTMLCanvasElement | null,
  transparentFloor: boolean,
): void {
  if (!canvas) return;
  paintSceneCanvas({
    canvas,
    raster: null,
    rasterScale: 1,
    rasterOrigin: { x: 0, y: 0 },
    transparentFloor,
  });
}

export type PageSceneSource = {
  /** Repaint the strip from the cached raster. rAF-coalesced and cheap. */
  repaint: () => void;
  /** Re-rasterise the page. Debounced and rate limited unless `now`. */
  scheduleCapture: (now?: boolean) => void;
  destroy: () => void;
};

type Options = {
  /** Element whose pixels sit behind the bar. */
  sceneRoot: HTMLElement;
  /** Subtrees to leave out — the dock itself, and anything floating over it. */
  exclude: readonly HTMLElement[];
  /** The <canvas> child of the LiquidGlass root that receives the strip. */
  canvas: HTMLCanvasElement;
  /** True while a wallpaper layer sits below and should show through. */
  transparentFloor: () => boolean;
  /** Called after the strip changes, so the shader can be marked dirty. */
  onPainted: () => void;
};

function pageBox(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

export function createPageSceneSource({
  sceneRoot,
  exclude,
  canvas,
  transparentFloor,
  onPainted,
}: Options): PageSceneSource {
  let raster: HTMLCanvasElement | null = null;
  let rasterScale = 1;
  let rasterOrigin = { x: 0, y: 0 };
  let capturing = false;
  let lastCaptureAt = Number.NEGATIVE_INFINITY;
  let debounceTimer: number | null = null;
  let frame = 0;
  let destroyed = false;

  function paint() {
    if (destroyed) return;
    paintSceneCanvas({
      canvas,
      raster,
      rasterScale,
      rasterOrigin,
      transparentFloor: transparentFloor(),
    });
    onPainted();
  }

  function repaint() {
    if (destroyed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  async function capture() {
    // A hidden tab still fires mutations; rasterising for nobody is waste.
    if (destroyed || capturing || document.hidden) return;
    capturing = true;
    lastCaptureAt = performance.now();
    try {
      const origin = pageBox(sceneRoot);
      const longest = Math.max(origin.width, origin.height);
      const scale = longest > MAX_RASTER_SIDE_PX ? MAX_RASTER_SIDE_PX / longest : 1;
      // Toasts, modals and the dock float over the page rather than sitting
      // behind the glass, and baking one into the raster would freeze it there
      // until the next capture. They are mounted at the top of the scene root,
      // so a shallow scan catches them without a getComputedStyle per node.
      const floating = new Set<HTMLElement>(exclude);
      for (const child of Array.from(sceneRoot.children)) {
        if (child instanceof HTMLElement && window.getComputedStyle(child).position === "fixed") {
          floating.add(child);
        }
      }
      const next = await toCanvas(sceneRoot, {
        // The result is blurred and refracted, so device pixels buy nothing.
        pixelRatio: scale,
        filter: (node) =>
          !(node instanceof HTMLElement) ||
          (!floating.has(node) && !node.hasAttribute("data-glass-scene-exclude")),
        // The wallpaper has its own viewport-anchored layer. Inside a
        // foreignObject clone `background-attachment: fixed` resolves against
        // the whole page instead of the viewport, which would land the crop in
        // the wrong place — so the scene carries content only.
        style: { background: "transparent" },
      });
      if (destroyed) return;
      raster = next;
      rasterScale = scale;
      rasterOrigin = { x: origin.x, y: origin.y };
      // Readable in devtools: tells you at a glance whether the bar is
      // refracting the live page or only its own backdrop layers.
      canvas.dataset.glassScene = "ready";
      repaint();
    } catch (error) {
      // Keep whatever the bar is already refracting rather than blanking it.
      canvas.dataset.glassScene = "failed";
      console.warn(
        "LiquidGlass: page capture failed, so the bar is refracting only its own " +
          "backdrop layers. The glass still renders; it just cannot show the page.",
        error,
      );
    } finally {
      capturing = false;
    }
  }

  function scheduleCapture(now = false) {
    if (destroyed) return;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    const sinceLast = performance.now() - lastCaptureAt;
    const wait = now
      ? 0
      : Math.max(CAPTURE_DEBOUNCE_MS, CAPTURE_MIN_INTERVAL_MS - sinceLast);
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void capture();
    }, wait);
  }

  return {
    repaint,
    scheduleCapture,
    destroy() {
      destroyed = true;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      if (frame) cancelAnimationFrame(frame);
      raster = null;
    },
  };
}
