import { runInDocument, type DocumentProbeTarget } from "./first-paint";

/** A server-rendered page can paint well before its client tab bar mounts. */
export const TAB_CHROME_PROBE = `new Promise(resolve => {
  const ready = () => {
    const bar = document.querySelector('.desktop-title-bar');
    return !bar || !!bar.querySelector('[role="tablist"]');
  };
  if (ready()) return resolve(true);
  const finish = value => { observer.disconnect(); clearTimeout(timer); resolve(value); };
  const observer = new MutationObserver(() => { if (ready()) finish(true); });
  const timer = setTimeout(() => finish(false), 1000);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})`;

/**
 * How long the outgoing page may stay in front while the arriving page mounts
 * its strip. A page that has no strip after this (hydration failed, a renderer
 * starved under load) comes forward anyway: a caption row without tabs for a
 * moment is recoverable, a window that never switches is not.
 */
export const TAB_CHROME_MAX_WAIT_MS = 5_000;

/** Keep the outgoing controls available until the new page owns a tab strip.
 * Every probe cleans itself up; cancelling or closing the tab ends the wait.
 * Plain documents without Breadboard chrome need no hydration handshake. */
export async function waitForTabChrome(
  contents: DocumentProbeTarget,
  stillPending: () => boolean,
  maxWaitMs = TAB_CHROME_MAX_WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (!contents.isDestroyed() && stillPending()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await Promise.race([
        runInDocument(contents, TAB_CHROME_PROBE, true),
        new Promise(resolve => { ceiling = setTimeout(() => resolve(false), Math.min(1_250, remaining)); }),
      ]);
      if (ready === true) return;
    } catch {
      // Navigation or renderer teardown invalidated this document's probe.
      return;
    } finally {
      if (ceiling) clearTimeout(ceiling);
    }
  }
}
