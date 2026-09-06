import type { NativeImage, WebContents } from "electron";

/** Capture pixels without making a hidden/detached tab visible to Chromium.
 *
 * Electron 33's default capturePage() temporarily increments the visible
 * capturer count. Its completion hides the view again, which can dereference a
 * null focused Aura window after a tab switch (0xC0000005). stayHidden avoids
 * that visibility transition even if the tab is detached during the capture.
 * Do not focus, show, or reparent a view here; its owner controls visibility.
 */
export function capturePagePreservingVisibility(
  contents: Pick<WebContents, "isDestroyed" | "isCrashed" | "capturePage">,
): Promise<NativeImage> {
  if (contents.isDestroyed() || contents.isCrashed()) {
    return Promise.reject(new Error("The page is no longer available for a screenshot."));
  }
  return contents.capturePage(undefined, { stayHidden: true });
}
