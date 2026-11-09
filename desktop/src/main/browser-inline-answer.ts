import { setNotificationViewVisible, trackTransparentNotificationView } from "./notification-visible-region";
import { WebContentsView, type BrowserWindow, type Rectangle } from "electron";
import { rendererWebPreferences } from "./window-options";
import { IPC_CHANNELS } from "../shared/ipc-contract";
import type { BrowserSelection } from "../shared/web-text-selection";
import type { BrowserInlineAnswerState } from "../shared/browser-inline-answer";

/** A card-sized trusted view. The rest of the website keeps receiving input. */
export class BrowserInlineAnswer {
  readonly view: WebContentsView;
  readonly contents;
  readonly selection: BrowserSelection;
  private closed = false;
  private ready = false;
  private revealed = false;
  private size = { width: 612, height: 220 };
  private manual: { x: number; y: number } | null = null;
  private visible = true;
  private viewport: Rectangle;
  private anchor: { x: number; y: number; height?: number };
  state: BrowserInlineAnswerState;
  get isClosed() { return this.closed; }
  get isVisible() { return this.ready && !this.closed && this.visible; }
  constructor(private window: BrowserWindow, readonly ownerId: number, selection: BrowserSelection,
    viewport: Rectangle, anchor: { x: number; y: number; height?: number }, preloadPath: string, private onClose: () => void, private note?: string) {
    this.selection = selection; this.viewport = viewport; this.anchor = anchor;
    this.state = { requestId: selection.requestId!, selectionId: selection.reference!.id, content: { pending: false, canAsk: false } };
    this.view = new WebContentsView({ webPreferences: rendererWebPreferences(preloadPath) });
    this.contents = this.view.webContents;
    this.view.setBackgroundColor("#00000000");
    trackTransparentNotificationView(this.view, '.bb-inline-answer, .bb-chat-selection-menu, [role="dialog"]');
    this.view.setBounds({ x: viewport.x + viewport.width - 1, y: viewport.y - 999, width: Math.min(612, viewport.width), height: 1000 });
    window.contentView.addChildView(this.view);
    this.contents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.contents.on("will-navigate", event => event.preventDefault());
    this.contents.on("render-process-gone", () => this.close());
  }
  publish() {
    if (!this.ready || this.closed || this.contents.isDestroyed()) return;
    this.contents.send(IPC_CHANNELS.browserInlineAnswerState, { ...this.state, content: { ...this.state.content, note: this.note }, selection: this.selection.reference,
      conversationId: this.selection.conversationId,
      viewport: { width: this.viewport.width, height: this.viewport.height } });
  }
  connect() { this.ready = true; this.publish(); }
  update(state: BrowserInlineAnswerState) { this.state = { ...state, content: { ...state.content, ownerReady: true } }; this.publish(); }
  position(viewport: Rectangle, anchor = this.anchor, visible = this.visible) {
    const changed = viewport.width !== this.viewport.width || viewport.height !== this.viewport.height;
    this.viewport = viewport; this.anchor = anchor; this.visible = visible; this.layout();
    if (changed) this.publish();
  }
  resize(width: number, height: number) {
    this.size = { width, height }; this.layout();
    if (!this.revealed && !this.closed && this.visible && !this.contents.isDestroyed()) { this.revealed = true; this.contents.focus(); }
  }
  move(dx: number, dy: number) {
    const current = this.view.getBounds();
    this.manual = { x: current.x + dx, y: current.y + dy }; this.layout();
  }
  private layout() {
    if (this.closed || this.window.isDestroyed()) return;
    const pane = this.viewport;
    const width = Math.max(1, Math.min(this.size.width, pane.width));
    const height = Math.max(1, Math.min(this.size.height, pane.height));
    const below = this.anchor.y + (this.anchor.height ?? 18) + 6;
    const y = pane.height - below >= height || below < pane.height / 2 ? below : this.anchor.y - height - 6;
    this.view.setBounds({ width: Math.ceil(width), height: Math.ceil(height),
      x: Math.round(Math.max(pane.x, Math.min(pane.x + pane.width - width, this.manual?.x ?? pane.x + this.anchor.x - 24))),
      y: Math.round(Math.max(pane.y, Math.min(pane.y + pane.height - height, this.manual?.y ?? pane.y + y))) });
    setNotificationViewVisible(this.view, this.visible);
  }
  close() {
    if (this.closed) return; this.closed = true;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    this.onClose();
    if (!this.contents.isDestroyed()) { this.contents.stop(); this.contents.close(); }
  }
}
