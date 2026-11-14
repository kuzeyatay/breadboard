import { WebContentsView, type BrowserWindow, type WebContents } from "electron";
import { rendererWebPreferences } from "./window-options";
import { trackTransparentNotificationView } from "./notification-visible-region";

/** Card pages are served by the dashboard. While it restarts (~10 s) the load
 * fails with a connection reset; cards stay invisible until their page reports
 * a size, so retry quietly instead of dropping the person's selection. */
export async function loadCardPage(
  card: { readonly contents: WebContents; readonly isClosed: boolean; close(): void },
  url: string,
  log: (line: string) => void,
  { deadlineMs = 20_000, retryMs = 1_000 } = {},
): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (let attempt = 1; ; attempt++) {
    try { await card.contents.loadURL(url); return; } catch (error) {
      if (card.isClosed || card.contents.isDestroyed()) return;
      if (Date.now() + retryMs > deadline) {
        log(`Browser card could not load ${new URL(url).pathname} after ${attempt} attempts: ${String(error)}`);
        card.close();
        return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, retryMs));
    if (card.isClosed || card.contents.isDestroyed()) return;
  }
}

/** A small trusted view above Chromium's website view; CSS z-index cannot
 * cross native views. The website retains its original size and scroll. */
export class BrowserToolbarPopover {
  readonly view: WebContentsView;
  readonly contents: WebContents;
  private closed = false;
  private revealed = false;
  private modalDepth = 0;
  private readonly cleanups: Array<() => void> = [];

  get isClosed(): boolean { return this.closed; }

  constructor(
    private readonly window: BrowserWindow,
    readonly ownerId: number,
    private readonly anchor: { x: number; y: number },
    preloadPath: string,
    private readonly outside: WebContents[],
    private readonly onClose: () => void,
    private readonly maxWidth = 440,
  ) {
    this.view = new WebContentsView({ webPreferences: rendererWebPreferences(preloadPath) });
    this.contents = this.view.webContents;
    this.view.setBackgroundColor("#00000000");
    trackTransparentNotificationView(this.view, '[role="dialog"], .bb-chat-selection-menu, [role="alert"]');
    // Keep one pixel visible so Chromium can run layout/ResizeObserver before
    // the renderer reports the card's height. No blank panel covers the page.
    const [width = 800] = window.getContentSize();
    this.view.setBounds({ x: width - 1, y: -159, width: Math.min(maxWidth, Math.max(1, width - 16)), height: 160 });
    window.contentView.addChildView(this.view);
    const dismiss = () => this.close();
    const dismissOnFocus = () => { if (!this.modalDepth) dismiss(); };
    // Focus going to the page or the shell means "clicked outside" only once
    // the card is on screen and holds the focus. While it is still loading it
    // was closed by any focus change, so the selected text got no card at all.
    const dismissOnOutsideFocus = () => { if (this.revealed) dismissOnFocus(); };
    for (const contents of outside) {
      contents.on("focus", dismissOnOutsideFocus);
      this.cleanups.push(() => { if (!contents.isDestroyed()) contents.removeListener("focus", dismissOnOutsideFocus); });
    }
    window.on("blur", dismissOnFocus);
    window.on("resize", dismiss);
    window.on("hide", dismiss);
    window.on("closed", dismiss);
    this.cleanups.push(() => {
      window.removeListener("blur", dismissOnFocus);
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

  /**
   * The card measures itself in CSS pixels, and Breadboard's pages share one
   * zoom level. At 110% a card sized with its own numbers got a view about a
   * tenth too small and lost its right and bottom edges.
   */
  private zoom(): number {
    return this.contents.isDestroyed() ? 1 : this.contents.getZoomFactor() || 1;
  }

  private layout(cssHeight: number): void {
    const zoom = this.zoom();
    const height = cssHeight * zoom;
    const [windowWidth = 800, windowHeight = 600] = this.window.getContentSize();
    const width = Math.min(Math.ceil(this.maxWidth * zoom), Math.max(1, windowWidth - 16));
    // Near the bottom edge the card moves up to fit; it used to keep its place
    // and lose whatever did not fit below it.
    const cardHeight = Math.max(1, Math.min(Math.ceil(height), 480, windowHeight - 16));
    const y = Math.max(0, Math.min(Math.round(this.anchor.y), windowHeight - cardHeight - 8));
    this.view.setBounds({
      x: Math.max(8, Math.min(Math.round(this.anchor.x) - width, windowWidth - width - 8)),
      y, width, height: cardHeight,
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

  /** A folder chooser temporarily takes focus; keep its result and any error
   * in the card that opened it. Tab changes and window teardown still dismiss. */
  async keepOpenDuring<T>(operation: () => Promise<T>): Promise<T> {
    this.modalDepth++;
    try { return await operation(); }
    finally {
      this.modalDepth--;
      if (!this.closed && !this.contents.isDestroyed()) this.contents.focus();
    }
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
