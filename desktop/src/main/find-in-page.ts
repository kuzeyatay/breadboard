import { WebContentsView, type BrowserWindow, type Event as ElectronEvent, type Input, type WebContents } from "electron";
import * as path from "node:path";
import { isTabsCommand, type TabsCommand } from "../shared/ipc-contract";

export type FindCommand = Extract<TabsCommand, { type: "browser-find" | "browser-find-close" }>;

/** Chromium searches text inputs too. Keep the find controls in a separate
 * native view so they never become matches and stay above embedded websites. */
export class FindInPage {
  readonly view: WebContentsView;
  readonly contents: WebContents;
  private ready = false;
  private closed = false;
  private result?: { matches: number; activeMatchOrdinal: number };

  constructor(
    private readonly window: BrowserWindow,
    readonly ownerId: number,
    private readonly top: number,
    theme: string,
    private readonly onCommand: (command: FindCommand) => void,
    onInput: (event: ElectronEvent, input: Input) => void,
    private readonly onClose: () => void,
  ) {
    this.view = new WebContentsView({ webPreferences: {
      preload: path.join(__dirname, "../preload/find-in-page-preload.js"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
    } });
    this.contents = this.view.webContents;
    this.view.setBackgroundColor("#00000000");
    this.contents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.contents.on("will-navigate", event => event.preventDefault());
    this.contents.on("before-input-event", onInput);
    this.contents.on("ipc-message", (_event, channel, command) => {
      if (channel !== "breadboard:find-command" || !isTabsCommand(command)) return;
      if (command.type === "browser-find-close") this.close();
      else if (command.type === "browser-find") this.onCommand(command);
    });
    this.contents.on("render-process-gone", () => this.close());
    this.contents.once("did-finish-load", () => {
      if (this.closed) return;
      this.ready = true;
      this.layout();
      this.view.setVisible(true);
      this.update(this.result);
      this.focus();
    });
    window.on("resize", this.layout);
    window.on("closed", this.close);
    window.contentView.addChildView(this.view);
    this.layout();
    void this.contents.loadFile(path.join(__dirname, "../startup/find-in-page.html"), { query: { theme } })
      .catch(() => this.close());
  }

  layout = (): void => {
    if (this.closed || this.window.isDestroyed()) return;
    const [windowWidth = 800, windowHeight = 600] = this.window.getContentSize();
    const width = Math.max(1, Math.min(406, windowWidth));
    // A one-pixel strip keeps Chromium painting before the controls are ready.
    // Electron 33 does not reliably resume painting a view created invisible.
    this.view.setBounds({ x: Math.max(0, windowWidth - width), y: this.ready ? Math.max(0, Math.min(this.top, windowHeight - 50)) : -49, width, height: 50 });
    this.window.contentView.addChildView(this.view);
  };

  focus(): void {
    if (!this.ready || this.closed) return;
    this.layout();
    this.contents.focus();
    this.contents.send("breadboard:find-focus");
  }

  update(result?: { matches: number; activeMatchOrdinal: number }): void {
    this.result = result;
    if (this.ready && !this.closed) this.contents.send("breadboard:find-result", result);
  }

  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.window.removeListener("resize", this.layout);
    this.window.removeListener("closed", this.close);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    if (!this.contents.isDestroyed()) this.contents.close();
    this.onClose();
  };
}
