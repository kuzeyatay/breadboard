import { WebContentsView, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import type { TabsState } from "../shared/ipc-contract";
import { installRendererRecovery } from "./renderer-recovery";

/** One bundled renderer per window; it does not load or hydrate a Next route. */
export class WindowShell {
  readonly view = new WebContentsView({ webPreferences: {
    preload: path.join(__dirname, "../preload/window-shell-preload.js"),
    sandbox: true, contextIsolation: true, nodeIntegration: false,
    webviewTag: false, spellcheck: false, backgroundThrottling: true,
  } });
  readonly contents = this.view.webContents;
  ready = false;

  constructor(getState: () => TabsState | null, command: (value: unknown) => boolean | Promise<boolean>, ready: () => void) {
    this.view.setBackgroundColor("#00000000");
    const mainFrame = (event: IpcMainInvokeEvent) => event.senderFrame === this.contents.mainFrame;
    this.contents.ipc.handle("breadboard:shell-state", event => mainFrame(event) ? getState() : null);
    this.contents.ipc.handle("breadboard:shell-command", (event, value: unknown) => mainFrame(event) ? command(value) : false);
    this.contents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.contents.on("will-navigate", event => event.preventDefault());
    this.contents.on("will-attach-webview", event => event.preventDefault());
    this.contents.on("dom-ready", () => { this.ready = true; ready(); });
    this.contents.on("render-process-gone", () => { this.ready = false; });
    installRendererRecovery(this.contents, () => {
      if (!this.contents.isDestroyed()) this.contents.reload();
    });
    void this.contents.loadFile(path.join(__dirname, "../window-shell/index.html")).catch(() => undefined);
  }
  close(): void { if (!this.contents.isDestroyed()) this.contents.close(); }
}
