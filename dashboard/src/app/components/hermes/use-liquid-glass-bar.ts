"use client";

// Drives ybouane/liquidglass over a single bar element.
//
// The library is unusually opinionated about structure: the glass element and
// everything it refracts have to be *direct children* of one root, the root's
// own background is never sampled, and every non-glass child is rasterised
// through html-to-image and then cached per element+size. That last point is
// the one that shapes this hook — a backdrop layer that changes size re-runs
// the rasteriser, so callers pass fixed-size layers and this hook only ever
// invalidates them explicitly (theme flip, wallpaper swap).
//
// Everything here degrades to nothing: without WebGL, with reduced
// transparency requested, or if init throws, the phase stays "off" and the
// caller keeps its flat bar.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { GlassConfig, LiquidGlass } from "@ybouane/liquidglass";
import {
  createPageSceneSource,
  primeSceneCanvas,
  type PageSceneSource,
} from "./liquid-glass-scene";

export type LiquidGlassPhase =
  /** No glass: unsupported, disabled, or init failed. Render the flat bar. */
  | "off"
  /** Backdrop layers are mounted so the shader has something to sample. */
  | "preparing"
  /** The shader owns the bar. Safe to drop the flat fill. */
  | "active";

type Options = {
  /** LiquidGlass root. The glass element and the backdrops must be its own children. */
  rootRef: RefObject<HTMLElement | null>;
  /** The element that becomes glass. */
  glassRef: RefObject<HTMLElement | null>;
  /**
   * Direct children of the root whose pixels feed the refraction. Keep their
   * size stable: each distinct size costs a fresh html-to-image capture.
   */
  backdropRefs: readonly RefObject<HTMLElement | null>[];
  /** Per-element shader config, serialised into `data-config` for the library. */
  config: Partial<GlassConfig>;
  /**
   * Live page behind the bar. The canvas must be one of the backdrop children;
   * `rootSelector` picks the element whose pixels get rasterised into it.
   */
  scene?: {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    rootSelector: string;
    /** True when a wallpaper layer below should show through the scene. */
    transparentFloor: boolean;
  };
  enabled?: boolean;
};

function liquidGlassSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NEXT_PUBLIC_LIQUID_GLASS === "off") return false;
  // A glass bar is exactly the kind of translucency this query opts out of.
  if (window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches) return false;
  try {
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl") ??
      (probe.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    // Hand the probe context straight back; browsers cap how many stay alive.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function useLiquidGlassBar({
  rootRef,
  glassRef,
  backdropRefs,
  config,
  scene,
  enabled = true,
}: Options): { phase: LiquidGlassPhase; refreshBackdrops: () => void } {
  const [phase, setPhase] = useState<LiquidGlassPhase>("off");
  const instanceRef = useRef<LiquidGlass | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const sceneSourceRef = useRef<PageSceneSource | null>(null);

  // Callers build this array inline every render, so it is read through a ref
  // rather than tracked as a dependency.
  const backdropsRef = useRef(backdropRefs);
  backdropsRef.current = backdropRefs;

  const configKey = JSON.stringify(config);

  // Deciding support has to happen on the client, and the backdrop layers may
  // only mount once it says yes — they sit above the dock's own background, so
  // mounting them for a bar that never turns to glass would show the raw
  // wallpaper instead of the bar's fill.
  useEffect(() => {
    if (!enabled) {
      setPhase("off");
      return;
    }
    setPhase((current) => (current === "off" && liquidGlassSupported() ? "preparing" : current));
  }, [enabled]);

  // "preparing" and "active" both mean "an instance should exist", so the
  // effect keys off that rather than off `phase` — otherwise resolving to
  // "active" would immediately tear the new instance back down.
  const shouldInit = phase !== "off";

  useEffect(() => {
    if (!shouldInit) return;
    const root = rootRef.current;
    const glass = glassRef.current;
    if (!root || !glass) return;

    let cancelled = false;
    glass.dataset.config = configKey;
    // Must happen before init: the library pre-warms its scene during init, and
    // an unpainted canvas contributes nothing, leaving the default white fill.
    primeSceneCanvas(
      sceneRef.current?.canvasRef.current ?? null,
      sceneRef.current?.transparentFloor ?? false,
    );

    void (async () => {
      try {
        const { LiquidGlass } = await import("@ybouane/liquidglass");
        if (cancelled) return;
        const instance = await LiquidGlass.init({ root, glassElements: [glass] });
        if (cancelled) {
          instance.destroy();
          return;
        }
        instanceRef.current = instance;
        setPhase("active");
      } catch (error) {
        if (cancelled) return;
        // A lost WebGL context or a tainted capture is not worth breaking the
        // dock over — the flat bar is a complete fallback, not a degraded one.
        console.warn("LiquidGlass: terminal bar fell back to its flat surface.", error);
        setPhase("off");
      }
    })();

    return () => {
      cancelled = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, [shouldInit, configKey, rootRef, glassRef]);

  // The library caches a raster per element+size, so a backdrop that only
  // changed colour (theme flip) or source (new wallpaper) looks unchanged to
  // it. Drop the cache entry and mark the glasses that sample it.
  const refreshBackdrops = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    for (const ref of backdropsRef.current) {
      const element = ref.current;
      if (!element) continue;
      instance.capture.invalidateCache(element);
      instance.markChanged(element);
    }
    // A palette change repaints the page too, so the scene raster is stale in
    // the same breath.
    sceneSourceRef.current?.scheduleCapture(true);
  }, []);

  useEffect(() => {
    if (phase !== "active") return;
    const observer = new MutationObserver(refreshBackdrops);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, [phase, refreshBackdrops]);

  // Live page behind the bar. Scrolling only re-blits from the cached raster;
  // the rasteriser itself runs on mount, on resize, and after the page has
  // been quiet for a moment following a real content change.
  useEffect(() => {
    if (phase !== "active") return;
    const instance = instanceRef.current;
    const dock = rootRef.current;
    const canvas = sceneRef.current?.canvasRef.current;
    const selector = sceneRef.current?.rootSelector;
    const sceneRoot = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (!instance || !dock || !canvas || !sceneRoot) return;

    const source = createPageSceneSource({
      sceneRoot,
      exclude: [dock],
      canvas,
      transparentFloor: () => sceneRef.current?.transparentFloor ?? false,
      onPainted: () => instance.markChanged(canvas),
    });
    // Floor and sheen immediately, so the bar never sits on white while the
    // first rasterisation is still in flight.
    source.repaint();
    sceneSourceRef.current = source;
    source.scheduleCapture(true);

    const onScroll = () => source.repaint();
    const onResize = () => {
      source.repaint();
      source.scheduleCapture();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    // Attributes are deliberately not watched: hover and focus classes fire
    // constantly and none of them are worth a rasterisation.
    const observer = new MutationObserver((mutations) => {
      // Chat streaming happens inside the dock, which the capture excludes.
      if (mutations.every((mutation) => dock.contains(mutation.target))) return;
      source.scheduleCapture();
    });
    observer.observe(sceneRoot, { subtree: true, childList: true, characterData: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      observer.disconnect();
      source.destroy();
      sceneSourceRef.current = null;
    };
  }, [phase, rootRef]);

  return { phase, refreshBackdrops };
}
