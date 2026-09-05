import type { WebContents } from "electron";

/** A startup page must finish its document and subresources, not just reach
 * DOM-ready. A failed or closed page is terminal too; redirects are not. */
export function waitForStartupPageLoad(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (loaded: boolean) => {
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
