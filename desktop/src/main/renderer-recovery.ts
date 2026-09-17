import type { WebContents } from "electron";

/**
 * Electron 33 emits render-process-gone inside Chromium's process-death
 * notification. Navigating or creating a replacement window there can re-enter
 * renderer startup before teardown completes and crash the browser process.
 * Use a later event-loop turn, not a promise microtask. See electron/electron#51900.
 */
export function installRendererRecovery(
  contents: WebContents,
  recover: () => void,
): () => void {
  let pending: ReturnType<typeof setImmediate> | null = null;
  const cancel = () => {
    if (pending !== null) clearImmediate(pending);
    pending = null;
  };
  const gone = () => {
    if (contents.isDestroyed() || pending !== null) return;
    pending = setImmediate(() => {
      pending = null;
      if (!contents.isDestroyed()) recover();
    });
  };
  const navigating = (
    _event: Electron.Event,
    _url: string,
    _isInPlace: boolean,
    isMainFrame: boolean,
  ) => {
    // An explicit reload or navigation already replaced the failed page.
    if (isMainFrame) cancel();
  };
  const dispose = () => {
    cancel();
    contents.removeListener("render-process-gone", gone);
    contents.removeListener("did-start-navigation", navigating);
    contents.removeListener("destroyed", dispose);
  };
  contents.on("render-process-gone", gone);
  contents.on("did-start-navigation", navigating);
  contents.once("destroyed", dispose);
  return dispose;
}
