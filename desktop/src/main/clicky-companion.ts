import { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { hardenWindow, type AllowedOrigins } from "./security";
import { rendererWebPreferences } from "./window-options";

const SHORTCUT = "Control+Alt+Space";
const CAPTURE_CHANNEL = "breadboard:clicky-capture";
const POINT_CHANNEL = "breadboard:clicky-point";

export class ClickyCompanion {
  private window: BrowserWindow | null = null;
  private marker: BrowserWindow | null = null;
  private opening: Promise<void> | null = null;
  private targetUrl: string | null = null;
  private capturedDisplayIds = new Set<string>();
  private markerTimer: NodeJS.Timeout | null = null;
  private shortcutRegistered = false;
  private capturePending = false;

  constructor(private readonly options: {
    dashboardUrl: () => string | null;
    allowed: AllowedOrigins;
  }) {
    this.options.allowed.localFiles ??= new Set();
    this.options.allowed.localFiles.add(pathToFileURL(path.join(__dirname, "..", "clicky-overlay", "index.html")).toString());
    ipcMain.handle(CAPTURE_CHANNEL, (event) => this.capture(event));
    ipcMain.handle(POINT_CHANNEL, (event, target: unknown) => this.point(event, target));
  }

  async launch(): Promise<void> {
    if (this.opening) return this.opening;
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
      return;
    }
    this.opening = this.open();
    try { await this.opening; } finally { this.opening = null; }
  }

  private async open(): Promise<void> {
    const dashboardUrl = this.options.dashboardUrl();
    if (!dashboardUrl) throw new Error("Breadboard is still starting. Try again in a moment.");
    this.targetUrl = new URL("/clicky", dashboardUrl).toString();
    const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(420, workArea.width);
    const height = Math.min(620, workArea.height);
    const companion = new BrowserWindow({
      width, height,
      x: workArea.x + Math.max(0, workArea.width - width - 20),
      y: workArea.y + Math.max(0, workArea.height - height - 20),
      minWidth: 320, minHeight: 360,
      title: "Clicky", show: false, alwaysOnTop: true,
      autoHideMenuBar: true, backgroundColor: "#f8f5ee",
      webPreferences: rendererWebPreferences(path.join(__dirname, "..", "preload", "clicky-preload.js")),
    });
    this.window = companion;
    companion.setMenu(null);
    // Screenshots should show the app being discussed, without Clicky covering it.
    companion.setContentProtection(true);
    hardenWindow(companion, this.options.allowed);
    const guardNavigation = (event: Electron.Event, url: string) => {
      if (url !== this.targetUrl) event.preventDefault();
    };
    companion.webContents.on("will-navigate", guardNavigation);
    companion.webContents.on("will-redirect", guardNavigation);
    companion.on("closed", () => {
      if (this.window === companion) this.window = null;
      this.clearMarker();
      this.capturedDisplayIds.clear();
      if (this.shortcutRegistered) globalShortcut.unregister(SHORTCUT);
      this.shortcutRegistered = false;
    });
    try {
      await companion.loadURL(this.targetUrl);
      companion.show();
      this.shortcutRegistered = globalShortcut.register(SHORTCUT, () => {
        if (!this.window || this.window.isDestroyed()) return;
        if (this.window.isMinimized()) this.window.restore();
        this.window.showInactive();
        this.window.webContents.send("breadboard:clicky-toggle-voice");
      });
      // Report shortcut conflicts to the UI; the microphone button remains usable.
      companion.webContents.send("breadboard:clicky-shortcut", this.shortcutRegistered);
    } catch (error) {
      if (!companion.isDestroyed()) companion.destroy();
      throw error;
    }
  }

  private isCompanion(event: IpcMainInvokeEvent): boolean {
    return Boolean(this.window && !this.window.isDestroyed()
      && event.sender === this.window.webContents
      && event.senderFrame === event.sender.mainFrame
      && event.senderFrame?.url === this.targetUrl);
  }

  private async capture(event: IpcMainInvokeEvent) {
    if (!this.isCompanion(event)) throw new Error("Screen capture is only available inside Clicky.");
    if (this.capturePending) throw new Error("A screen snapshot is already in progress.");
    this.capturePending = true;
    this.capturedDisplayIds.clear();
    this.clearMarker();
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"], thumbnailSize: { width: 1600, height: 1600 },
      });
      if (!this.isCompanion(event)) throw new Error("Clicky was closed during capture.");
      const displays = screen.getAllDisplays();
      const snapshots = sources.flatMap((source) => {
        const display = displays.find((candidate) => String(candidate.id) === source.display_id);
        if (!display || source.thumbnail.isEmpty()) return [];
        const size = source.thumbnail.getSize();
        return [{ displayId: String(display.id), width: size.width, height: size.height,
          dataUrl: `data:image/jpeg;base64,${source.thumbnail.toJPEG(75).toString("base64")}` }];
      }).slice(0, 4);
      if (!snapshots.length) throw new Error("Windows could not capture a display. Check screen-capture access and try again.");
      this.capturedDisplayIds = new Set(snapshots.map((snapshot) => snapshot.displayId));
      return snapshots;
    } finally {
      this.capturePending = false;
    }
  }

  private async point(event: IpcMainInvokeEvent, target: unknown): Promise<boolean> {
    if (!this.isCompanion(event) || !target || typeof target !== "object") return false;
    const { displayId, x, y } = target as Record<string, unknown>;
    if (typeof displayId !== "string" || !this.capturedDisplayIds.has(displayId)
      || typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1000
      || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1000) return false;
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === displayId);
    if (!display) return false;
    this.clearMarker();
    const marker = new BrowserWindow({
      x: display.bounds.x + Math.round(x / 1000 * (display.bounds.width - 1)),
      y: display.bounds.y + Math.round(y / 1000 * (display.bounds.height - 1)),
      width: 42, height: 48, frame: false, transparent: true, show: false,
      focusable: false, resizable: false, skipTaskbar: true, hasShadow: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.marker = marker;
    marker.setIgnoreMouseEvents(true);
    marker.setAlwaysOnTop(true, "screen-saver");
    marker.setContentProtection(true);
    hardenWindow(marker, this.options.allowed);
    try {
      await marker.loadFile(path.join(__dirname, "..", "clicky-overlay", "index.html"));
      if (this.marker !== marker || marker.isDestroyed()) return false;
      marker.showInactive();
      this.markerTimer = setTimeout(() => this.clearMarker(), 5000);
      return true;
    } catch {
      if (this.marker === marker) this.clearMarker();
      return false;
    }
  }

  private clearMarker(): void {
    if (this.markerTimer) clearTimeout(this.markerTimer);
    this.markerTimer = null;
    if (this.marker && !this.marker.isDestroyed()) this.marker.destroy();
    this.marker = null;
  }

  stop(): void {
    this.clearMarker();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    ipcMain.removeHandler(CAPTURE_CHANNEL);
    ipcMain.removeHandler(POINT_CHANNEL);
  }
}
