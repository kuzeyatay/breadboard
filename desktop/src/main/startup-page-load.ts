import type { WebContents } from "electron";
import { runInDocument } from "./first-paint";

// Cold development routes and their first widget requests can exceed 30s.
// This is a diagnostic interval. The owner keeps waiting when work is pending.
export const STARTUP_PAGE_LOAD_MAX_WAIT_MS = 120_000;

/** App pages explicitly report hydration and initial data readiness. External
 * pages have no marker and keep their normal document/paint loading contract. */
export function startupReadinessProbe(maxWaitMs: number): string {
  return `new Promise((resolve) => {
    const root = document.documentElement;
    if (!root.hasAttribute("data-breadboard-startup")) return resolve(true);
    let readySince = null;
    const started = Date.now();
    const check = () => {
      const ready = root.dataset.breadboardStartup === "ready" &&
        Array.from(document.images).every(image => image.loading === "lazy" || image.complete);
      if (!ready) readySince = null;
      else if (readySince === null) readySince = Date.now();
      // Let effects triggered by initial responses enroll their follow-up reads.
      if (readySince !== null && Date.now() - readySince >= 250) return resolve(true);
      if (Date.now() - started >= ${Math.max(0, maxWaitMs)}) return resolve(false);
      setTimeout(check, 50);
    };
    check();
  })`;
}

/** The outer deadline also covers a wedged or destroyed renderer. */
export async function waitForStartupPageReady(contents: WebContents, maxWaitMs: number): Promise<boolean> {
  if (contents.isDestroyed() || maxWaitMs <= 0) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unavailable: () => void = () => {};
  try {
    return await Promise.race([
      runInDocument(contents, startupReadinessProbe(maxWaitMs)).then(value => value === true),
      new Promise<boolean>(resolve => {
        unavailable = () => resolve(false);
        contents.once("destroyed", unavailable);
        contents.once("render-process-gone", unavailable);
        timer = setTimeout(unavailable, maxWaitMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    contents.removeListener("destroyed", unavailable);
    contents.removeListener("render-process-gone", unavailable);
  }
}

/** Wait for the document and subresources. A false result is not readiness:
 * the owner distinguishes a slow navigation from a failed or destroyed page. */
export function waitForStartupPageLoad(
  contents: WebContents,
  maxWaitMs = STARTUP_PAGE_LOAD_MAX_WAIT_MS,
): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(false);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = (loaded: boolean) => {
      clearTimeout(timer);
      contents.removeListener("did-finish-load", loadedPage);
      contents.removeListener("did-stop-loading", stoppedLoading);
      contents.removeListener("did-fail-load", failedPage);
      contents.removeListener("destroyed", unavailable);
      contents.removeListener("render-process-gone", unavailable);
      resolve(loaded);
    };
    const loadedPage = () => finish(true);
    const stoppedLoading = () => {
      if (contents.getURL() && !contents.isLoading()) finish(true);
    };
    const unavailable = () => finish(false);
    const failedPage = (_event: unknown, code: number, _description: string, _url: string, mainFrame: boolean) => {
      if (mainFrame && code !== -3) finish(false);
    };
    timer = setTimeout(() => finish(false), maxWaitMs);
    contents.on("did-finish-load", loadedPage);
    // A base tab can be enrolled from inside its own did-finish-load handler,
    // while Electron still reports isLoading(). Its stop event follows next.
    contents.on("did-stop-loading", stoppedLoading);
    contents.on("did-fail-load", failedPage);
    contents.on("destroyed", unavailable);
    contents.on("render-process-gone", unavailable);
    // loadURL has already been issued. An empty initial document is not ready.
    if (contents.getURL() && !contents.isLoading()) finish(true);
  });
}
