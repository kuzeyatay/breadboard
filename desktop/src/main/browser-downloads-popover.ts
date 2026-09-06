import { WebContentsView, type BrowserWindow, type WebContents } from "electron";
import { rendererWebPreferences } from "./window-options";

/** A small trusted view above Chromium's website view; CSS z-index cannot
 * cross native views. The website retains its original size and scroll. */
export class BrowserDownloadsPopover {
  readonly view: WebContentsView;
  readonly contents: WebContents;
  private closed = false;
  private revealed = false;
  private readonly cleanups: Array<() => void> = [];

  get isClosed(): boolean { return this.closed; }

  constructor(
    private readonly window: BrowserWindow,
    readonly ownerId: number,
    private readonly anchor: { x: number; y: number },
    preloadPath: string,
    private readonly outside: WebContents[],
    private readonly onClose: () => void,
  ) {
    this.view = new WebContentsView({ webPreferences: rendererWebPreferences(preloadPath) });
    this.contents = this.view.webContents;
    this.view.setBackgroundColor("#00000000");
    // Keep one pixel visible so Chromium can run layout/ResizeObserver before
    // the renderer reports the card's height. No blank panel covers the page.
    const [width = 800] = window.getContentSize();
    this.view.setBounds({ x: width - 1, y: -159, width: Math.min(440, width - 16), height: 160 });
    window.contentView.addChildView(this.view);
    const dismiss = () => this.close();
    for (const contents of outside) {
      contents.on("focus", dismiss);
      this.cleanups.push(() => { if (!contents.isDestroyed()) contents.removeListener("focus", dismiss); });
    }
    window.on("blur", dismiss);
    window.on("resize", dismiss);
    window.on("hide", dismiss);
    window.on("closed", dismiss);
    this.cleanups.push(() => {
      window.removeListener("blur", dismiss);
      window.removeListener("resize", dismiss);
      window.removeListener("hide", dismiss);
      window.removeListener("closed", dismiss);
    });
    this.contents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") { event.preventDefault(); this.close(true); }
    });
    this.contents.on("render-process-gone", dismiss);
    this.contents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.contents.on("will-navigate", event => event.preventDefault());
  }

  private layout(height: number): void {
    const [windowWidth = 800, windowHeight = 600] = this.window.getContentSize();
    const width = Math.min(440, Math.max(1, windowWidth - 16));
    const y = Math.max(0, Math.min(Math.round(this.anchor.y), windowHeight - 48));
    this.view.setBounds({
      x: Math.max(8, Math.min(Math.round(this.anchor.x) - width, windowWidth - width - 8)),
      y, width, height: Math.max(1, Math.min(Math.ceil(height), 480, windowHeight - y - 8)),
    });
  }

  resize(height: number): void {
    if (this.closed || this.window.isDestroyed()) return;
    this.layout(height);
    if (this.revealed) return;
    this.revealed = true;
    this.view.setVisible(true);
    this.contents.focus();
  }

  close(restoreFocus = false): void {
    if (this.closed) return;
    this.closed = true;
    for (const cleanup of this.cleanups) cleanup();
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    this.onClose();
    if (!this.contents.isDestroyed()) this.contents.close();
    if (restoreFocus && !this.window.isDestroyed()) {
      this.window.focus();
      const owner = this.outside[0];
      if (owner && !owner.isDestroyed()) owner.focus();
    }
  }
}
