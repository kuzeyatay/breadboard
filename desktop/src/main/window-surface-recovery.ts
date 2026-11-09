import { setNotificationViewVisible } from "./notification-visible-region";
import { webContents, type BrowserWindow, type WebContentsView } from "electron";

/** Reattach a selected surface after the native window itself was hidden or
 * minimized. Merely covering the window leaves the live view in place. */
export function installWindowSurfaceRecovery(
  window: BrowserWindow,
  selectedViews: () => ReadonlySet<WebContentsView> | undefined,
): void {
  let pending: ReturnType<typeof setImmediate> | undefined;
  const recover = () => {
    pending = undefined;
    if (window.isDestroyed() || window.isMinimized() || !window.isVisible()) return;
    const selected = selectedViews();
    if (!selected?.size) return;
    const parent = window.contentView;
    const children = parent.children;
    const focused = window.isFocused() ? webContents.getFocusedWebContents() : null;
    for (const view of selected) {
      const index = children.indexOf(view);
      const contents = view.webContents;
      if (index < 0 || contents.isDestroyed()) continue;
      const throttled = contents.getBackgroundThrottling();
      if (!throttled) contents.setBackgroundThrottling(true);
      try {
        // Preserve the native stack, including the toolbar, split panes and
        // overlays. The WebContents and its document live through the reattach.
        parent.removeChildView(view);
        parent.addChildView(view, index);
        setNotificationViewVisible(view, true);
      } finally {
        if (!throttled && !contents.isDestroyed()) contents.setBackgroundThrottling(false);
      }
    }
    if (focused && !focused.isDestroyed() && window.isFocused() && !focused.isFocused()) focused.focus();
  };
  const schedule = () => {
    if (!pending && !window.isDestroyed()) pending = setImmediate(recover);
  };
  window.on("show", schedule);
  window.on("restore", schedule);
  window.once("closed", () => {
    if (pending) clearImmediate(pending);
  });
}
