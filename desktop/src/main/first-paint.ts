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

/** The parser can paint while the main HTML response is still open. */
export async function waitForDocumentFrame(contents: WebContents, signal: AbortSignal): Promise<boolean> {
  if (contents.isDestroyed() || signal.aborted) return false;
  const release = allowBackgroundFrames(contents);
  try {
    const frame = contents.mainFrame;
    const probe = frame.executeJavaScript(`new Promise(resolve => {
      let observer;
      let done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); observer?.disconnect(); document.removeEventListener('readystatechange', parsed); resolve(value); };
      const timer = setTimeout(() => finish(false), 1200);
      const painted = () => requestAnimationFrame(() => requestAnimationFrame(() => finish(true)));
      const parsed = () => { if (document.readyState !== 'loading') painted(); };
      if (performance.getEntriesByName('first-contentful-paint').length) { painted(); return; }
      observer = new PerformanceObserver(list => {
        if (list.getEntries().some(entry => entry.name === 'first-contentful-paint')) painted();
      });
      observer.observe({type:'paint', buffered:true});
      // Frame-only/canvas/empty documents need not emit a top-level FCP. Once
      // parsed, two frames of this document suffice; subresources may continue.
      document.addEventListener('readystatechange', parsed);
      parsed();
    })`, false);
    return await new Promise<boolean>(resolve => {
      const finish = (ready: boolean) => { clearTimeout(timer); signal.removeEventListener("abort", cancel); resolve(ready); };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, 1500);
      signal.addEventListener("abort", cancel, { once: true });
      void probe.then(value => finish(value === true && !signal.aborted), cancel);
    });
  } catch { return false; }
  finally { release(); }
}

/** Background preparation may stop waiting after this without claiming that
 * the page painted. Foreground handoffs instead wait until cancelled. */
export const REVEAL_FRAME_MAX_WAIT_MS = 2_500;

interface PaintProbeTarget {
  isDestroyed(): boolean;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

interface DocumentFrame {
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

/** What a probe of the *current* document needs from a page. */
export interface DocumentProbeTarget extends PaintProbeTarget {
  readonly mainFrame?: DocumentFrame | null;
  getBackgroundThrottling?(): boolean;
  setBackgroundThrottling?(allowed: boolean): void;
}

const frameLeases = new WeakMap<DocumentProbeTarget, { count: number; throttled: boolean }>();

/** Chromium can classify even an attached, parked view as hidden and stop rAF.
 * Share this lease with startup preparation so one completed wait cannot put a
 * still-pending foreground renderer back to sleep. */
export function allowBackgroundFrames(contents: DocumentProbeTarget): () => void {
  if (contents.isDestroyed() || !contents.getBackgroundThrottling || !contents.setBackgroundThrottling) return () => {};
  let lease = frameLeases.get(contents);
  if (!lease) {
    lease = { count: 0, throttled: contents.getBackgroundThrottling() };
    contents.setBackgroundThrottling(false);
    frameLeases.set(contents, lease);
  }
  lease.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lease.count > 0) return;
    frameLeases.delete(contents);
    if (!contents.isDestroyed()) contents.setBackgroundThrottling!(lease.throttled);
  };
}

/**
 * Evaluate in the document a page has right now.
 *
 * `webContents.executeJavaScript` is not that: Electron holds it back until
 * `did-stop-loading` whenever the main frame is still loading, and a page can
 * be DOM-ready yet loading for as long as it likes (an App Router response
 * still streaming a Suspense boundary, a subresource that never answers). A
 * probe queued behind that never runs, and each retry stacks another
 * `did-stop-loading` listener on the page. The main frame's own
 * `executeJavaScript` runs at once in whatever document the frame holds.
 */
export function runInDocument(
  contents: DocumentProbeTarget,
  code: string,
  userGesture = false,
  // Same result type as Electron's executeJavaScript, which this replaces.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  let frame: DocumentFrame | null | undefined;
  try {
    frame = contents.mainFrame;
  } catch {
    // A page mid-teardown has no frame to offer; the plain path rejects below.
  }
  try {
    return (frame ?? contents).executeJavaScript(code, userGesture);
  } catch (error) {
    // A frame disposed mid-navigation throws synchronously. Callers chain
    // .catch(); a throw here would abort their event handler instead.
    return Promise.reject(error);
  }
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
 * Confirm fresh animation frames after attaching a tab. A timeout, cancellation,
 * or destroyed document is not a frame. Use a null deadline with a signal for a
 * foreground handoff: a slow renderer must not uncover an empty window.
 */
export async function waitForRevealFrame(
  contents: DocumentProbeTarget | WebContents,
  maxWaitMs: number | null = REVEAL_FRAME_MAX_WAIT_MS,
  signal?: AbortSignal,
): Promise<boolean> {
  if (contents.isDestroyed() || signal?.aborted) return false;
  return new Promise<boolean>(resolve => {
    const release = allowBackgroundFrames(contents);
    let settled = false;
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (ceiling) clearTimeout(ceiling);
      signal?.removeEventListener("abort", cancel);
      release();
      resolve(ready);
    };
    const cancel = () => finish(false);
    signal?.addEventListener("abort", cancel, { once: true });
    if (maxWaitMs !== null) ceiling = setTimeout(cancel, maxWaitMs);
    try {
      void runInDocument(contents, REVEAL_FRAME_PROBE, true).then(
        () => finish(!contents.isDestroyed() && !signal?.aborted),
        cancel,
      );
    } catch {
      cancel();
    }
  });
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
