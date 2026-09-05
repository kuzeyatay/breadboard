import type { WebContents } from "electron";

/**
 * Ceiling on the in-page paint probe, so a page that paints but never settles
 * is discovered here rather than at the much longer outer cap.
 */
export const FIRST_PAINT_PROBE_MAX_WAIT_MS = 12_000;
/**
 * The probe caps itself, but only if it runs: a renderer wedged on its main
 * thread never reaches the timer it set. Recovery hands the window back on the
 * far side of this wait, so an unsettled probe is the difference between a
 * dashboard returning and a person staring at the reconnect scene forever.
 */
export const FIRST_PAINT_MAX_WAIT_MS = FIRST_PAINT_PROBE_MAX_WAIT_MS + 3_000;

/**
 * Resolves once the hydrated page has actually put pixels up. `did-finish-load`
 * fires when the document is done, which for an App Router page is before React
 * has hydrated and before client-only panels have rendered anything — swapping
 * inside that window is precisely what shows a dashboard of empty frames.
 *
 * A contentful paint is what proves there are pixels: animation frames keep
 * running in a window Chromium is not rasterizing, so rAF alone cannot tell a
 * painted page from a parked one — measured, not assumed. Fonts settling, then
 * an idle main thread, then two animation frames on top of that is the proxy
 * for "hydration is done and its result has been painted too".
 */
export const FIRST_PAINT_PROBE = `new Promise((resolve) => {
  const done = () => resolve(true);
  setTimeout(done, ${FIRST_PAINT_PROBE_MAX_WAIT_MS});
  const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(done));
  const whenIdle = () =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(afterPaint, { timeout: 2000 })
      : setTimeout(afterPaint, 200);
  const whenHydrated = () => {
    const fonts = document.fonts && document.fonts.ready;
    if (fonts && typeof fonts.then === "function") fonts.then(whenIdle, whenIdle);
    else whenIdle();
  };
  if (typeof PerformanceObserver !== "function") return whenHydrated();
  let advanced = false;
  const advance = () => {
    if (advanced) return;
    advanced = true;
    whenHydrated();
  };
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name !== "first-contentful-paint") continue;
        observer.disconnect();
        advance();
      }
    });
    // \`buffered\` matters: the paint usually lands before this probe is injected.
    observer.observe({ type: "paint", buffered: true });
  } catch (error) {
    advance();
  }
})`;

/**
 * A tab on its way to the front renders its first frame out of the window's
 * visible area while the page in front stays on screen. Once DOM-ready has
 * fired, two animation frames are enough to prove one compositor pass has
 * happened. Do not wait for fonts, page idle, or the load event here: those
 * can take seconds and are allowed to finish after the tab becomes visible.
 */
export const REVEAL_FRAME_PROBE = `new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
})`;

/** A ceiling for polish, not a page-load deadline: DOM-ready has already
 * replaced the cold initial document before this begins, and a renderer
 * deprioritised under load must not hold the previous page in front forever. */
export const REVEAL_FRAME_MAX_WAIT_MS = 2_500;

interface PaintProbeTarget {
  isDestroyed(): boolean;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

async function settleWithin(action: Promise<unknown>, maxWaitMs: number): Promise<void> {
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      action,
      new Promise((resolve) => {
        ceiling = setTimeout(resolve, maxWaitMs);
      }),
    ]);
  } finally {
    if (ceiling) clearTimeout(ceiling);
  }
}

/** Runs {@link FIRST_PAINT_PROBE} in the loaded page; never throws, always
 *  settles. The probe's own cap lives inside the renderer, so it is no help
 *  when the renderer is the thing that has stopped. */
export async function waitForFirstPaint(
  contents: PaintProbeTarget | WebContents,
  maxWaitMs = FIRST_PAINT_MAX_WAIT_MS,
): Promise<void> {
  if (contents.isDestroyed()) return;
  let ceiling: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      contents.executeJavaScript(FIRST_PAINT_PROBE, true),
      new Promise((resolve) => {
        ceiling = setTimeout(resolve, maxWaitMs);
      }),
    ]);
  } catch {
    // Navigated away, closed, or refused the evaluation. The page is no worse
    // off than it was before this check existed, and stalling here would cost
    // the person the whole outer wait for nothing.
  } finally {
    if (ceiling) clearTimeout(ceiling);
  }
}

/**
 * Wait until a tab attached out of sight has a composited frame and can be
 * moved in front of the page currently on screen. Never throws, always
 * settles.
 */
export async function waitForRevealFrame(
  contents: PaintProbeTarget | WebContents,
  maxWaitMs = REVEAL_FRAME_MAX_WAIT_MS,
): Promise<void> {
  if (contents.isDestroyed()) return;
  try {
    await settleWithin(contents.executeJavaScript(REVEAL_FRAME_PROBE, true), maxWaitMs);
  } catch {
    // Navigated, closed, or refused the evaluation. The outer ceiling on the
    // reveal still brings the tab forward.
  }
}

/** A native resize can reach Chromium after its next animation frame. Wait for
 * two frames and check their viewport. A mismatch lets the caller re-read the
 * native size, which can still be changing during a display/DPI transition. */
export async function waitForViewportFrame(
  contents: WebContents,
  size: readonly number[],
  maxWaitMs = REVEAL_FRAME_MAX_WAIT_MS,
): Promise<boolean | undefined> {
  if (contents.isDestroyed()) return;
  const zoom = contents.getZoomFactor();
  const [width, height] = size.map(value => Math.round(value / zoom));
  try {
    let painted: boolean | undefined;
    await settleWithin(contents.executeJavaScript(`new Promise((resolve) => {
      const matches = () => innerWidth === ${width} && innerHeight === ${height};
      requestAnimationFrame(() => {
        const matched = matches();
        requestAnimationFrame(() => resolve(matched && matches()));
      });
    })`, true).then(result => { painted = result === true; }), maxWaitMs);
    return painted;
  } catch {
    // A closing or unavailable renderer must not strand the startup screen.
  }
}
