import { BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { hardenWindow, type AllowedOrigins } from "./security";
import { BREADBOARD_TITLE_BAR, rendererWebPreferences } from "./window-options";

const SHORTCUT = "Control+Alt+Space";
const CAPTURE_CHANNEL = "breadboard:clicky-capture";
const POINT_CHANNEL = "breadboard:clicky-point";
const CLICK_CHANNEL = "breadboard:clicky-click";
const RESET_CHANNEL = "breadboard:clicky-reset-target";
const POINTER_WIDTH = 42;
const POINTER_HEIGHT = 48;
const POINTER_OFFSET = 18;

export class ClickyCompanion {
  private window: BrowserWindow | null = null;
  private marker: BrowserWindow | null = null;
  private opening: Promise<void> | null = null;
  private targetUrl: string | null = null;
  private capturedDisplayIds = new Set<string>();
  private markerTimer: NodeJS.Timeout | null = null;
  private followTimer: NodeJS.Timeout | null = null;
  private markerPosition: { x: number; y: number } | null = null;
  private shortcutRegistered = false;
  private capturePending = false;
  private clickPending = false;
  private targetRevision = 0;
  private capturedDisplays = new Map<string, { x: number; y: number; width: number; height: number; scaleFactor: number }>();
  private clickTarget: {
    displayId: string;
    x: number;
    y: number;
    inputText?: string;
    pressEnter?: boolean;
    expiresAt: number;
  } | null = null;

  constructor(private readonly options: {
    dashboardUrl: () => string | null;
    allowed: AllowedOrigins;
      clickAt?: (x: number, y: number) => void | Promise<void>;
      typeText?: (text: string, pressEnter: boolean, x: number, y: number) => void | Promise<void>;
  }) {
    this.options.allowed.localFiles ??= new Set();
    this.options.allowed.localFiles.add(pathToFileURL(path.join(__dirname, "..", "clicky-overlay", "index.html")).toString());
    ipcMain.handle(CAPTURE_CHANNEL, (event) => this.capture(event));
    ipcMain.handle(POINT_CHANNEL, (event, target: unknown) => this.point(event, target));
    ipcMain.handle(CLICK_CHANNEL, (event) => this.click(event));
    ipcMain.handle(RESET_CHANNEL, (event) => {
      if (this.isCompanion(event)) { this.targetRevision++; this.clickTarget = null; this.resumeFollowing(); }
    });
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
      autoHideMenuBar: true, backgroundColor: BREADBOARD_TITLE_BAR.color,
      titleBarStyle: "hidden", titleBarOverlay: BREADBOARD_TITLE_BAR,
      webPreferences: rendererWebPreferences(path.join(__dirname, "..", "preload", "clicky-preload.js")),
    });
    this.window = companion;
    companion.setMenu(null);
    // The dashboard's shared document title must not rename this window.
    companion.on("page-title-updated", (event) => event.preventDefault());
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
      this.capturedDisplays.clear();
      this.clickTarget = null;
      this.targetRevision++;
      if (this.shortcutRegistered) globalShortcut.unregister(SHORTCUT);
      this.shortcutRegistered = false;
    });
    try {
      await companion.loadURL(this.targetUrl);
      if (companion.isDestroyed()) return;
      await this.createMarker();
      if (companion.isDestroyed()) return;
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
    this.capturedDisplays.clear();
    this.clickTarget = null;
    this.targetRevision++;
    this.resumeFollowing();
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"], thumbnailSize: { width: 1600, height: 1600 },
      });
      if (!this.isCompanion(event)) throw new Error("Clicky was closed during capture.");
      const displays = screen.getAllDisplays();
      const snapshots = sources.flatMap((source) => {
        const display = displays.find((candidate) => String(candidate.id) === source.display_id);
        if (!display || source.thumbnail.isEmpty()) return [];
        this.capturedDisplays.set(String(display.id), { ...display.bounds, scaleFactor: display.scaleFactor });
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
    const { displayId, x, y, inputText, pressEnter } = target as Record<string, unknown>;
    if (typeof displayId !== "string" || !this.capturedDisplayIds.has(displayId)
      || typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1000
      || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1000
      || (inputText !== undefined && (typeof inputText !== "string" || !inputText
        || inputText.length > 1_000 || /[\u0000-\u001f\u007f]/.test(inputText)))
      || (pressEnter !== undefined && typeof pressEnter !== "boolean")
      || (pressEnter === true && typeof inputText !== "string")) return false;
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === displayId);
    if (!display) return false;
    const marker = this.marker;
    if (!marker || marker.isDestroyed()) return false;
    if (this.markerTimer) clearTimeout(this.markerTimer);
    this.moveMarker(
      display.bounds.x + Math.round(x / 1000 * (display.bounds.width - 1)),
      display.bounds.y + Math.round(y / 1000 * (display.bounds.height - 1)),
    );
    this.markerTimer = setTimeout(() => {
      this.clickTarget = null;
      this.resumeFollowing();
    }, 60_000);
    this.clickTarget = {
      displayId,
      x: display.bounds.x + Math.round(x / 1000 * (display.bounds.width - 1)),
      y: display.bounds.y + Math.round(y / 1000 * (display.bounds.height - 1)),
      ...(typeof inputText === "string" ? { inputText, pressEnter: pressEnter === true } : {}),
      expiresAt: Date.now() + 60_000,
    };
    return true;
  }

  private async click(event: IpcMainInvokeEvent): Promise<boolean> {
    if (!this.isCompanion(event)) throw new Error("Desktop clicking is only available inside Clicky.");
    if (this.clickPending) throw new Error("A click is already in progress.");
    const target = this.clickTarget;
    if (!target || target.expiresAt < Date.now()) throw new Error("That target has expired. Ask Clicky to look again.");
    if (!this.options.clickAt) throw new Error("Restart Breadboard to enable desktop clicking.");
    if (target.inputText && !this.options.typeText) {
      throw new Error("Restart Breadboard to enable desktop typing.");
    }
    const display = screen.getAllDisplays().find((candidate) => String(candidate.id) === target.displayId);
    const captured = this.capturedDisplays.get(target.displayId);
    if (!display || !captured || display.scaleFactor !== captured.scaleFactor
      || ["x", "y", "width", "height"].some((key) => display.bounds[key as keyof Electron.Rectangle] !== captured[key as keyof Electron.Rectangle])) {
      this.clickTarget = null;
      throw new Error("The display changed. Ask Clicky to look again before clicking.");
    }
    this.clickPending = true;
    const revision = this.targetRevision;
    this.clickTarget = null; // A target can only be clicked once.
    const companion = this.window!;
    try {
      // Move Clicky's own conversation out of the way before delivering input.
      companion.hide();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (!this.isCompanion(event)) throw new Error("Clicky was closed before the click.");
      if (revision !== this.targetRevision) throw new Error("The click was cancelled.");
      const physical = screen.dipToScreenPoint({ x: target.x, y: target.y });
        await this.options.clickAt(physical.x, physical.y);
      await new Promise((resolve) => setTimeout(resolve, target.inputText ? 180 : 100));
      if (target.inputText) {
          await this.options.typeText!(target.inputText, target.pressEnter === true, physical.x, physical.y);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return true;
    } finally {
      if (!companion.isDestroyed()) companion.showInactive();
      this.clickPending = false;
      this.resumeFollowing();
    }
  }

  private async createMarker(): Promise<void> {
    const cursor = screen.getCursorScreenPoint();
    const marker = new BrowserWindow({
      x: cursor.x, y: cursor.y,
      width: POINTER_WIDTH, height: POINTER_HEIGHT, frame: false, transparent: true, show: false,
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
      if (this.marker !== marker || marker.isDestroyed()) return;
      this.followCursor();
      marker.showInactive();
      // Read desktop coordinates in the main process so following also works
      // outside Breadboard, and while the conversation is minimized or busy.
      this.followTimer = setInterval(() => this.followCursor(), 16);
    } catch (error) {
      if (this.marker === marker) this.clearMarker();
      throw error;
    }
  }

  private moveMarker(x: number, y: number): void {
    if (!this.marker || this.marker.isDestroyed()) return;
    if (this.markerPosition?.x === x && this.markerPosition.y === y) return;
    this.marker.setPosition(x, y, false);
    this.markerPosition = { x, y };
  }

  private followCursor(): void {
    if (!this.marker || this.marker.isDestroyed() || this.markerTimer) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = screen.getDisplayNearestPoint(cursor).bounds;
    // Keep the companion beside the real pointer and fully visible at edges.
    const x = cursor.x + POINTER_OFFSET + POINTER_WIDTH <= bounds.x + bounds.width
      ? cursor.x + POINTER_OFFSET : cursor.x - POINTER_OFFSET - POINTER_WIDTH;
    const y = cursor.y + POINTER_OFFSET + POINTER_HEIGHT <= bounds.y + bounds.height
      ? cursor.y + POINTER_OFFSET : cursor.y - POINTER_OFFSET - POINTER_HEIGHT;
    this.moveMarker(Math.max(bounds.x, x), Math.max(bounds.y, y));
  }

  private resumeFollowing(): void {
    if (this.markerTimer) clearTimeout(this.markerTimer);
    this.markerTimer = null;
    this.followCursor();
  }

  private clearMarker(): void {
    if (this.markerTimer) clearTimeout(this.markerTimer);
    this.markerTimer = null;
    if (this.followTimer) clearInterval(this.followTimer);
    this.followTimer = null;
    if (this.marker && !this.marker.isDestroyed()) this.marker.destroy();
    this.marker = null;
    this.markerPosition = null;
  }

  stop(): void {
    this.clearMarker();
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    ipcMain.removeHandler(CAPTURE_CHANNEL);
    ipcMain.removeHandler(POINT_CHANNEL);
    ipcMain.removeHandler(CLICK_CHANNEL);
    ipcMain.removeHandler(RESET_CHANNEL);
  }
}
