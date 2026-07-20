import { BrowserWindow, app } from "electron";
import * as path from "node:path";
import { hardenWindow, type AllowedOrigins } from "./security";

export interface WindowManagerOptions {
  allowed: AllowedOrigins;
  startupHtmlPath: string;
  preloadPath: string;
  iconPath?: string;
}

/**
 * Owns the single main BrowserWindow. It first shows the local startup screen
 * and is navigated to the dashboard once all required services are healthy.
 */
export class WindowManager {
  private readonly options: WindowManagerOptions;
  private mainWindow: BrowserWindow | null = null;

  constructor(options: WindowManagerOptions) {
    this.options = options;
  }

  get window(): BrowserWindow | null {
    return this.mainWindow;
  }

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;
    const window = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 980,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#10251c",
      title: "Breadboard",
      ...(this.options.iconPath ? { icon: this.options.iconPath } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        preload: this.options.preloadPath,
        spellcheck: false,
      },
    });
    hardenWindow(window, this.options.allowed);
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      this.mainWindow = null;
    });
    this.mainWindow = window;
    return window;
  }

  async showStartupScreen(): Promise<void> {
    const window = this.createMainWindow();
    await window.loadFile(this.options.startupHtmlPath);
  }

  async showDashboard(dashboardUrl: string): Promise<void> {
    const window = this.createMainWindow();
    await window.loadURL(dashboardUrl);
  }

  /** Reload dashboard content without touching backend services. */
  reload(): void {
    this.mainWindow?.webContents.reload();
  }

  sendToRenderer(channel: string, payload: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }

  static quitAll(): void {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    app.quit();
  }
}

export function defaultStartupHtmlPath(moduleDir: string): string {
  return path.join(moduleDir, "..", "startup", "index.html");
}

export function defaultPreloadPath(moduleDir: string): string {
  return path.join(moduleDir, "..", "preload", "preload.js");
}
