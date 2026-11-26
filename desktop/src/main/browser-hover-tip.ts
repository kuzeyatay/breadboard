import { WebContentsView, type BrowserWindow } from "electron";

/** What a hovered passage says: your own note, or who you follow left a crumb there. */
export interface HoverTipContent { title?: string; body: string; tone?: string }

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:light dark}
html,body{margin:0;background:transparent;overflow:hidden}
#tip{position:absolute;left:14px;top:10px;box-sizing:border-box;width:max-content;max-width:288px;padding:8px 11px 9px;border-radius:12px;corner-shape:squircle;
  font:12.5px/1.42 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;letter-spacing:-.003em;
  background:rgba(255,255,255,.96);color:#1d1d1f;border:.5px solid rgba(0,0,0,.12);box-shadow:0 6px 22px rgba(0,0,0,.16),0 1px 3px rgba(0,0,0,.08);
  -webkit-backdrop-filter:blur(20px);overflow-wrap:anywhere;white-space:pre-wrap}
html[data-theme=dark] #tip{background:rgba(44,44,46,.96);color:#f5f5f7;border-color:rgba(255,255,255,.14);box-shadow:0 6px 22px rgba(0,0,0,.45)}
#title{display:flex;align-items:center;gap:6px;font-weight:600;white-space:normal}
#title:empty{display:none}
#title i{flex:none;width:8px;height:8px;border-radius:50%;corner-shape:round}
#body{display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden}
#title:not(:empty)+#body{margin-top:2px;opacity:.78}
</style></head><body><div id="tip"><div id="title"></div><div id="body"></div></div></body></html>`;

/**
 * A small read-only card drawn above a hovered highlight. It is a trusted view
 * over the website, not part of it: the page only says which passage is
 * hovered, and never sees the note or the name shown here.
 */
export class BrowserHoverTip {
  private readonly view: WebContentsView;
  private ready: Promise<void>;
  private shown = false;
  private request = 0;
  /** The tab whose page the card describes. */
  ownerId: number | null = null;

  constructor(private readonly window: BrowserWindow) {
    this.view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, spellcheck: false } });
    this.view.setBackgroundColor("#00000000");
    this.view.setVisible(false);
    // Room to lay the card out at its natural width before it is measured and placed.
    this.view.setBounds({ x: 0, y: 0, width: 316, height: 260 });
    this.view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.view.webContents.on("will-navigate", event => event.preventDefault());
    this.ready = this.view.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(PAGE)).catch(() => undefined);
  }

  /** `rect` is the passage in window coordinates. The card sits above it, or below when there is no room. */
  async show(ownerId: number, rect: { x: number; y: number; width: number; height: number }, content: HoverTipContent, theme: "light" | "dark") {
    const request = ++this.request;
    this.ownerId = ownerId;
    await this.ready;
    if (request !== this.request || this.window.isDestroyed() || this.view.webContents.isDestroyed()) return;
    const size = await this.view.webContents.executeJavaScript(`(() => {
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      const title = document.getElementById("title"), body = document.getElementById("body");
      title.textContent = ${JSON.stringify(content.title ?? "")};
      if (${JSON.stringify(Boolean(content.tone && content.title))}) { const dot = document.createElement("i"); dot.style.background = ${JSON.stringify(content.tone ?? "")}; title.prepend(dot); }
      body.textContent = ${JSON.stringify(content.body)};
      const box = document.getElementById("tip").getBoundingClientRect();
      return { width: Math.ceil(box.width) + 28, height: Math.ceil(box.height) + 30 };
    })()`).catch(() => null) as { width: number; height: number } | null;
    if (!size || request !== this.request || this.window.isDestroyed()) return;
    const [windowWidth = 800, windowHeight = 600] = this.window.getContentSize();
    // The view keeps a clear margin round the card (14px at the sides, 10px above, 20px below) for its shadow.
    const width = Math.min(size.width, 316), height = Math.min(size.height, 260);
    const x = Math.round(Math.max(0, Math.min(rect.x + rect.width / 2 - width / 2, windowWidth - width)));
    const above = rect.y - height + 14;
    const y = Math.round(above >= 0 ? above : Math.min(rect.y + rect.height - 6, windowHeight - height));
    this.view.setBounds({ x, y, width, height });
    // Re-adding a child puts it on top of the website's view.
    this.window.contentView.addChildView(this.view);
    this.view.setVisible(true);
    this.shown = true;
  }

  hide() {
    this.request++;
    this.ownerId = null;
    if (!this.shown || this.window.isDestroyed()) return;
    this.shown = false;
    this.view.setVisible(false);
  }

  destroy() {
    this.request++;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
