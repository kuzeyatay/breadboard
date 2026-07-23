import { BrowserWindow, app } from "electron";
import * as path from "node:path";
import { hardenWindow, type AllowedOrigins } from "./security";
import { mainWindowOptions } from "./window-options";

export interface WindowManagerOptions {
  allowed: AllowedOrigins;
  startupHtmlPath: string;
  preloadPath: string;
  iconPath?: string;
  minimumStartupVisibleMs?: number;
}

export const DEFAULT_MINIMUM_STARTUP_VISIBLE_MS = 2_200;

export function remainingStartupVisibleMs(
  shownAt: number,
  now: number,
  minimumMs = DEFAULT_MINIMUM_STARTUP_VISIBLE_MS,
): number {
  return Math.max(0, minimumMs - Math.max(0, now - shownAt));
}

/**
 * Owns the single main BrowserWindow. It first shows the local startup screen
 * and is navigated to the dashboard once all required services are healthy.
 */
export class WindowManager {
  private readonly options: WindowManagerOptions;
  private mainWindow: BrowserWindow | null = null;
  private startupShownAt: number | null = null;

  constructor(options: WindowManagerOptions) {
    this.options = options;
  }

  get window(): BrowserWindow | null {
    return this.mainWindow;
  }

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;
    const window = new BrowserWindow(
      mainWindowOptions(this.options.preloadPath, this.options.iconPath),
    );
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
    this.startupShownAt = Date.now();
  }

  async showDashboard(dashboardUrl: string): Promise<void> {
    const window = this.createMainWindow();
    if (this.startupShownAt !== null) {
      const remaining = remainingStartupVisibleMs(
        this.startupShownAt,
        Date.now(),
        this.options.minimumStartupVisibleMs,
      );
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
    }
    await window.loadURL(dashboardUrl);
    this.startupShownAt = null;
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
