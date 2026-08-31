import { BrowserWindow, globalShortcut, screen, type Display } from "electron";
import fs from "node:fs";
import path from "node:path";
import { hardenWindow, type AllowedOrigins } from "./security";
import {
  COMPUTER_USE_CANCEL_FILENAME,
  freshComputerUseAppearance,
  isComputerUseStateFilename,
  type ComputerUseAppearance,
} from "./computer-use-state";

const STATE_POLL_MS = 150;
const CURSOR_POLL_MS = 16;
const CURSOR_WINDOW_SIZE = 92;

export interface ComputerUseIndicatorOptions {
  dataDir: string;
  overlayHtmlPath: string;
  allowed: AllowedOrigins;
  log?: (line: string) => void;
}

/**
 * Electron-owned, capture-excluded affordance for approved real-desktop use.
 * It never accepts pointer input; Escape is the sole global interaction.
 */
export class ComputerUseIndicator {
  private readonly options: ComputerUseIndicatorOptions;
  private readonly dataDir: string;
  private readonly cancelPath: string;
  private readonly edgeWindows = new Map<number, BrowserWindow>();
  private cursorWindow: BrowserWindow | null = null;
  private stateTimer: NodeJS.Timeout | null = null;
  private cursorTimer: NodeJS.Timeout | null = null;
  private active = false;
  private appearance: ComputerUseAppearance | null = null;
  private started = false;
  private shortcutRegistered = false;
  private cancelRequested = false;
  private cancelSequence = 0;

  constructor(options: ComputerUseIndicatorOptions) {
    this.options = options;
    this.dataDir = options.dataDir;
    this.cancelPath = path.join(options.dataDir, COMPUTER_USE_CANCEL_FILENAME);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.refreshState();
    this.stateTimer = setInterval(() => this.refreshState(), STATE_POLL_MS);
    this.stateTimer.unref?.();
  }

  stop(): void {
    this.started = false;
    if (this.stateTimer) clearInterval(this.stateTimer);
    this.stateTimer = null;
    this.deactivate();
    this.appearance = null;
  }

  private refreshState(): void {
    if (!this.started) return;
    let nextAppearance: ComputerUseAppearance | null = null;
    try {
      const stateFiles = fs.readdirSync(this.dataDir).filter(isComputerUseStateFilename);
      for (const name of stateFiles) {
        try {
          const appearance = freshComputerUseAppearance(
            fs.readFileSync(path.join(this.dataDir, name), "utf8"),
          );
          if (appearance === "red") {
            nextAppearance = "red";
            break;
          }
          if (appearance === "green") nextAppearance = "green";
        } catch {
          // A producer may be replacing its heartbeat while this scan runs.
        }
      }
    } catch {
      // The on-demand service has not started yet, or ended without cleanup.
    }
    if (nextAppearance === this.appearance && this.active === (nextAppearance !== null)) return;
    if (this.active) this.deactivate();
    this.appearance = nextAppearance;
    if (nextAppearance) this.activate();
  }

  private activate(): void {
    if (this.active) return;
    this.active = true;
    this.cancelRequested = false;
    this.syncEdgeWindows();
    this.ensureCursorWindow();
    screen.on("display-added", this.handleDisplaysChanged);
    screen.on("display-removed", this.handleDisplaysChanged);
    screen.on("display-metrics-changed", this.handleDisplaysChanged);
    this.shortcutRegistered = globalShortcut.register("Escape", () => this.requestCancel());
    if (!this.shortcutRegistered) this.log("could not register the global Escape shortcut");
    this.cursorTimer = setInterval(() => this.placeCursorWindow(), CURSOR_POLL_MS);
    this.cursorTimer.unref?.();
  }

  private deactivate(): void {
    if (!this.active && this.edgeWindows.size === 0 && !this.cursorWindow) return;
    this.active = false;
    this.cancelRequested = false;
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    this.cursorTimer = null;
    screen.removeListener("display-added", this.handleDisplaysChanged);
    screen.removeListener("display-removed", this.handleDisplaysChanged);
    screen.removeListener("display-metrics-changed", this.handleDisplaysChanged);
    if (this.shortcutRegistered) globalShortcut.unregister("Escape");
    this.shortcutRegistered = false;
    for (const window of this.edgeWindows.values()) this.destroyWindow(window);
    this.edgeWindows.clear();
    if (this.cursorWindow) this.destroyWindow(this.cursorWindow);
    this.cursorWindow = null;
  }

  private readonly handleDisplaysChanged = (): void => {
    if (!this.active) return;
    this.syncEdgeWindows();
  };

  private syncEdgeWindows(): void {
    const displays = screen.getAllDisplays();
    const currentIds = new Set(displays.map((display) => display.id));
    for (const [id, window] of this.edgeWindows) {
      if (currentIds.has(id)) continue;
      this.destroyWindow(window);
      this.edgeWindows.delete(id);
    }
    const primaryId = screen.getPrimaryDisplay().id;
    for (const display of displays) {
      const current = this.edgeWindows.get(display.id);
      if (current && !current.isDestroyed()) {
        current.setBounds(display.bounds, false);
        continue;
      }
      this.edgeWindows.set(display.id, this.createOverlayWindow(display, display.id === primaryId));
    }
  }

  private createOverlayWindow(display: Display, banner: boolean): BrowserWindow {
    const window = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      title: "Bread is using your computer",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.prepareOverlayWindow(window);
    void window
      .loadFile(this.options.overlayHtmlPath, {
        query: {
          surface: "edge",
          banner: banner ? "true" : "false",
          appearance: this.appearance ?? "green",
        },
      })
      .then(() => {
        if (!window.isDestroyed() && this.active) window.showInactive();
      })
      .catch((error) => this.log(`edge overlay failed to load: ${this.errorMessage(error)}`));
    return window;
  }

  private ensureCursorWindow(): void {
    if (this.cursorWindow && !this.cursorWindow.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const half = Math.floor(CURSOR_WINDOW_SIZE / 2);
    const window = new BrowserWindow({
      x: point.x - half,
      y: point.y - half,
      width: CURSOR_WINDOW_SIZE,
      height: CURSOR_WINDOW_SIZE,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      focusable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      title: "Bread cursor highlight",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    this.cursorWindow = window;
    this.prepareOverlayWindow(window);
    void window
      .loadFile(this.options.overlayHtmlPath, {
        query: { surface: "cursor", appearance: this.appearance ?? "green" },
      })
      .then(() => {
        if (!window.isDestroyed() && this.active) window.showInactive();
      })
      .catch((error) => this.log(`cursor overlay failed to load: ${this.errorMessage(error)}`));
  }

  private prepareOverlayWindow(window: BrowserWindow): void {
    hardenWindow(window, this.options.allowed);
    window.setIgnoreMouseEvents(true, { forward: false });
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // The person sees the safety affordance; screenshots given to the model do
    // not, so it cannot mistake the border or notice for part of the target UI.
    window.setContentProtection(true);
  }

  private placeCursorWindow(): void {
    if (!this.active) return;
    this.ensureCursorWindow();
    const window = this.cursorWindow;
    if (!window || window.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    const half = Math.floor(CURSOR_WINDOW_SIZE / 2);
    window.setPosition(point.x - half, point.y - half, false);
  }

  private requestCancel(): void {
    if (!this.active || this.cancelRequested) return;
    this.cancelRequested = true;
    try {
      fs.mkdirSync(path.dirname(this.cancelPath), { recursive: true });
      this.cancelSequence += 1;
      fs.writeFileSync(
        this.cancelPath,
        `${Date.now()}:${process.pid}:${this.cancelSequence}`,
        { encoding: "utf8", mode: 0o600 },
      );
      const allowRetry = setTimeout(() => {
        if (this.active) this.cancelRequested = false;
      }, 750);
      allowRetry.unref?.();
    } catch (error) {
      this.cancelRequested = false;
      this.log(`could not request computer-use cancellation: ${this.errorMessage(error)}`);
    }
  }

  private destroyWindow(window: BrowserWindow): void {
    if (!window.isDestroyed()) window.destroy();
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private log(line: string): void {
    this.options.log?.(`[computer-use] ${line}`);
  }
}

export function defaultComputerUseOverlayHtmlPath(moduleDir: string): string {
  return path.join(moduleDir, "..", "computer-use-overlay", "index.html");
}
