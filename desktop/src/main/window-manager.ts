import { BrowserWindow, app, nativeTheme, screen, shell } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  hardenWindow,
  isNavigationAllowed,
  type AllowedOrigins,
} from "./security";
import {
  mainWindowOptions,
  popupBackgroundColor,
  titleBarForSurface,
} from "./window-options";
import type {
  BreadboardWindowSurface,
  BreadboardWindowTheme,
} from "./window-options";
import {
  FIRST_PAINT_MAX_WAIT_MS,
  FIRST_PAINT_PROBE_MAX_WAIT_MS,
  REVEAL_FRAME_MAX_WAIT_MS,
  waitForFirstPaint,
  waitForViewportFrame,
} from "./first-paint";
import { isFullScreenShortcut } from "./tab-model";
import { TabManager } from "./tab-manager";

export { FIRST_PAINT_MAX_WAIT_MS, FIRST_PAINT_PROBE_MAX_WAIT_MS, isFullScreenShortcut };

export interface WindowManagerOptions {
  allowed: AllowedOrigins;
  startupHtmlPath: string;
  recoveryHtmlPath?: string;
  loadingHtmlPath?: string;
  preloadPath: string;
  iconPath?: string;
  minimumStartupVisibleMs?: number;
  welcomeGateMaxWaitMs?: number;
  initialTheme?: BreadboardWindowTheme;
  /** Overrides for the two timings that decide how long a stuck reconnect can
   *  stay stuck. Only tests set these; see the constants they default to. */
  loadWatchdogMs?: number;
  recoveryHeartbeatMs?: number;
  /** Where window recovery reports what it is doing. Silent when omitted. */
  log?: (line: string) => void;
  /** Lets the shell retire non-main safety windows before the app closes. */
  onMainWindowCloseRequested?: () => void;
  /** Lets F12 open the inspector in any tab. Development builds only. */
  devTools?: boolean;
  /** Durable record of unpacked extensions loaded into the isolated browser profile. */
  browserExtensionsConfigDir?: string;
  browserVisitedLinksConfigDir?: string;
  browserHistoryConfigDir?: string;
  tabSessionConfigDir?: string;
  onBrowserAgentPageReady?: (runId: string, targetUrl: string) => Promise<boolean>;
}

interface DashboardPreload {
  window: BrowserWindow;
  url: string;
  restoredWindows: BrowserWindow[];
  /** Resolves after the default page and every restored tab are ready. */
  settled: Promise<"loaded" | "failed">;
}

export const DEFAULT_MINIMUM_STARTUP_VISIBLE_MS = 2_200;
export const WINDOW_VISIBILITY_FALLBACK_MS = 1_500;

interface NativeThemeTarget {
  themeSource: "system" | BreadboardWindowTheme;
}

/**
 * Make sandboxed web pages see the same preferred colour scheme as Breadboard.
 * Internal pages use `data-theme`; sites such as Google read Chromium's
 * `prefers-color-scheme` media feature instead.
 */
export function synchronizeNativeTheme(
  theme: BreadboardWindowTheme,
  target: NativeThemeTarget | undefined = nativeTheme,
): void {
  if (target) target.themeSource = theme;
}

export const LOCAL_PAGE_RECOVERY_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;
/**
 * A retry only reschedules itself when the load reports back. A navigation that
 * reports nothing at all therefore ends the loop and strands the recovery scene
 * on screen — which is exactly what a restarting dev server can produce, since
 * the listening socket can accept a connection that the process behind it is no
 * longer in a position to answer. Nothing distinguishes that from a slow first
 * compile except how long it lasts, so the ceiling is set well past even a cold
 * route build: it exists to break deadlocks, never to interrupt progress.
 */
export const LOCAL_PAGE_LOAD_WATCHDOG_MS = 90_000;
/**
 * Every step of the retry loop is armed by the step before it, so any path that
 * returns without arming the next one ends the loop and leaves the reconnect
 * scene up for good. The watchdog covers a load that reports nothing; nothing
 * covered the loop itself losing its place — and it can, because the retired
 * window keeps its listeners and writes to the same recovery state the
 * replacement is retrying from. This ticks over that state and restarts the
 * loop whenever it finds no attempt in flight, scheduled, or painting.
 */
export const RECOVERY_HEARTBEAT_MS = 15_000;
/** Floor between two attempts to put the reconnect scene back on screen. */
export const RECOVERY_SCENE_RESHOW_MS = 2_000;

/** Back off quickly at first, then keep checking without spinning forever. */
export function localPageRecoveryDelayMs(attempt: number): number {
  const index = Math.max(
    0,
    Math.min(LOCAL_PAGE_RECOVERY_DELAYS_MS.length - 1, Math.trunc(attempt)),
  );
  return LOCAL_PAGE_RECOVERY_DELAYS_MS[index] ?? 5_000;
}
/**
 * The welcome screen is dismissed by hand, so there is deliberately no hurry.
 * The cap only exists so a startup renderer that never reaches the welcome (a
 * broken or stale startup bundle) cannot strand a healthy app on the loader.
 */
export const WELCOME_GATE_MAX_WAIT_MS = 5 * 60_000;
/** Native state changes are normally already settled during preload. This cap
 * only covers someone changing maximize/full-screen state while it loads. */
export const NATIVE_WINDOW_STATE_WAIT_MS = 1_500;

/** Off-desktop fallback for platforms without native window opacity. */
export const OFFSCREEN_PRELOAD_ORIGIN = -32_000;

interface LocalPageRecoveryState {
  url: string;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Armed for the duration of one load attempt; see the watchdog constant. */
  watchdog: ReturnType<typeof setTimeout> | null;
  replacement: BrowserWindow | null;
  paintToken: number;
  /** Outstanding paint probes. An attempt with one running is still accounted
   *  for even though its watchdog has been stood down; see the heartbeat. */
  paintWaits: number;
  /** Runs only while a replacement owns the loop; see the heartbeat constant. */
  heartbeat: ReturnType<typeof setInterval> | null;
}

export function remainingStartupVisibleMs(
  shownAt: number,
  now: number,
  minimumMs = DEFAULT_MINIMUM_STARTUP_VISIBLE_MS,
): number {
  return Math.max(0, minimumMs - Math.max(0, now - shownAt));
}

/**
 * Carry the shell's persisted theme into a dashboard origin that may not have
 * existed on the previous launch—or may contain an older choice from a port
 * used before. The page treats this durable launch value as authoritative.
 */
export function dashboardUrlWithTheme(
  dashboardUrl: string,
  theme: BreadboardWindowTheme,
): string {
  try {
    const target = new URL(dashboardUrl);
    target.searchParams.set("theme", theme);
    return target.toString();
  } catch {
    return dashboardUrl;
  }
}

/**
 * Owns the single main BrowserWindow. It first shows the local startup screen
 * and is navigated to the dashboard once all required services are healthy.
 */
export class WindowManager {
  private readonly options: WindowManagerOptions;
  private mainWindow: BrowserWindow | null = null;
  /**
   * Set only by the native `close` event for the window that is still current.
   * A renderer/GPU failure can make Electron emit `closed` without that user
   * intent; the application lifecycle uses this distinction to reopen instead
   * of interpreting a crash as a request to quit.
   */
  private mainWindowCloseRequested = false;
  private startupShownAt: number | null = null;
  private startupContinued = false;
  private readonly startupContinueWaiters = new Set<() => void>();
  private dashboardPreload: DashboardPreload | null = null;
  /** The floating recording controller, while a demonstration is being taught. */
  private teachControllerWindow: BrowserWindow | null = null;
  private recoverySceneShownAt = 0;
  private currentTheme: BreadboardWindowTheme;
  private readonly localPageRecovery = new WeakMap<
    BrowserWindow,
    LocalPageRecoveryState
  >();
  private readonly windowSurfaces = new WeakMap<
    BrowserWindow,
    BreadboardWindowSurface
  >();
  /** The browser-style tabs every Breadboard window carries. */
  readonly tabs: TabManager;

  constructor(options: WindowManagerOptions) {
    this.options = options;
    this.currentTheme = options.initialTheme ?? "light";
    synchronizeNativeTheme(this.currentTheme);
    this.tabs = new TabManager({
      allowed: options.allowed,
      preloadPath: options.preloadPath,
      loadingHtmlPath: () => this.loadingHtmlPath(),
      recoveryHtmlPath: () => this.recoveryHtmlPath(),
      theme: () => this.currentTheme,
      openWindow: (url) => {
        this.openPopupWindow(url);
      },
      openExternal: (url) => {
        void shell.openExternal(url);
      },
      devTools: options.devTools,
      browserExtensionsConfigDir: options.browserExtensionsConfigDir,
      browserVisitedLinksConfigDir: options.browserVisitedLinksConfigDir,
      browserHistoryConfigDir: options.browserHistoryConfigDir,
      tabSessionConfigDir: options.tabSessionConfigDir,
      log: options.log,
      onBrowserAgentPageReady: options.onBrowserAgentPageReady,
    });
  }

  get window(): BrowserWindow | null {
    return this.mainWindow;
  }

  /** The theme the windows are in, for anything drawn to match them. */
  get theme(): BreadboardWindowTheme {
    return this.currentTheme;
  }

  /** Read and clear the close intent associated with the last main window. */
  consumeMainWindowCloseRequest(): boolean {
    const requested = this.mainWindowCloseRequested;
    this.mainWindowCloseRequested = false;
    return requested;
  }

  rememberTheme(theme: BreadboardWindowTheme): void {
    this.currentTheme = theme;
    synchronizeNativeTheme(theme);
    this.tabs.synchronizeBrowserTheme(theme);
  }

  private log(line: string): void {
    this.options.log?.(`[window] ${line}`);
  }

  private revealWhenReady(window: BrowserWindow): void {
    const reveal = () => {
      if (!window.isDestroyed() && !window.isVisible()) window.show();
    };
    const fallback = setTimeout(reveal, WINDOW_VISIBILITY_FALLBACK_MS);
    window.once("ready-to-show", () => {
      clearTimeout(fallback);
      reveal();
    });
    window.once("closed", () => clearTimeout(fallback));
  }

  /** A hardened, still-hidden Breadboard window. Callers decide when it shows. */
  private buildWindow(backgroundColor?: string): BrowserWindow {
    const options = mainWindowOptions(
      this.options.preloadPath,
      this.options.iconPath,
      process.platform,
      this.currentTheme,
    );
    const window = new BrowserWindow(
      // The colour is settled at construction: it is what Chromium paints for
      // the frames before the renderer has one of its own, so setting it after
      // the fact would be setting it too late.
      backgroundColor ? { ...options, backgroundColor } : options,
    );
    hardenWindow(
      window,
      this.options.allowed,
      (url) => this.openPopupWindow(url),
      (url) => this.tabs.openLocalTab(window.webContents, url),
      (url, background) =>
        this.tabs.openExternalTab(window.webContents, url, background),
    );
    // Keyboard shortcuts — full screen included — are the tab manager's, so
    // they work the same in a window's own page and in every tab it holds.
    this.tabs.attach(window);
    this.installTitleBarOverlayUpkeep(window);
    return window;
  }

  /**
   * Park a window where it renders for real without ever being seen.
   *
   * A window that is only hidden still runs its scripts, and with background
   * throttling off it even runs its animation frames — but Chromium rasterizes
   * nothing for it. Revealing one is what leaves the app showing a flat sheet of
   * its background colour while the whole page paints from cold, which is the
   * wait the welcome screen exists to absorb. Fully transparent and
   * click-through, it paints like any other window.
   */
  private parkOffscreen(window: BrowserWindow): void {
    const reference = this.mainWindow;
    // Keep the preload on the same display, at the same content size. Moving it
    // to a distant offscreen coordinate can select another monitor and DPI;
    // bringing that render back stretches its old frame until Chromium repaints.
    const shown =
      reference && !reference.isDestroyed() && reference !== window
        ? reference.getContentBounds()
        : window.getContentBounds();
    window.setOpacity(0);
    window.setSkipTaskbar(true);
    // Invisible is not intangible: this window is raised above the startup
    // screen, and the welcome below it is dismissed by a click.
    window.setIgnoreMouseEvents(true);
    window.setContentBounds(process.platform === "linux"
      // Electron does not support window opacity on Linux.
      ? { ...shown, x: OFFSCREEN_PRELOAD_ORIGIN, y: OFFSCREEN_PRELOAD_ORIGIN }
      : shown);
    // Not `show`: the startup screen keeps the focus until the person leaves it.
    window.showInactive();
    // Native maximize/full-screen transitions have their own Windows animation.
    // If one starts only after the welcome is dismissed, the transparent
    // replacement becomes visible at its restored bounds in the top-left and
    // then grows to fill the screen. Put the invisible preload into its final
    // native state now, before its page even starts loading, so that animation
    // finishes behind the welcome as well.
    if (reference && !reference.isDestroyed() && reference !== window) {
      if (reference.isFullScreen()) window.setFullScreen(true);
      else if (reference.isMaximized()) window.maximize();
    }
  }

  /** Restore native styles before waiting for the final frame: on Windows,
   * changing the mouse-event style can also change the client-area rounding. */
  private prepareWindowReveal(window: BrowserWindow): void {
    window.setIgnoreMouseEvents(false);
    window.setSkipTaskbar(false);
  }

  /** Reveal only after geometry, native styles and rendering have settled. */
  private unparkWindow(window: BrowserWindow): void {
    window.setOpacity(1);
    // Opacity is the last thing done to a parked window and the first thing
    // that costs it its caption colour, so the strip is re-stated here.
    this.applyTitleBarOverlay(window);
  }

  /** Wait for a native state change while the replacement remains transparent.
   * This event does not prove that Chromium has painted the resized viewport. */
  private waitForWindowState(
    window: BrowserWindow,
    event: "enter-full-screen" | "leave-full-screen" | "maximize" | "unmaximize",
    alreadySet: () => boolean,
    setState: () => void,
  ): Promise<void> {
    if (window.isDestroyed() || alreadySet()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // Electron types each BrowserWindow event as a separate overload, which
      // does not accept the finite union used by this shared helper.
      const nativeEvents = window as unknown as {
        once: (name: string, listener: () => void) => void;
        removeListener: (name: string, listener: () => void) => void;
      };
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        nativeEvents.removeListener(event, finish);
        nativeEvents.removeListener("closed", finish);
        resolve();
      };
      nativeEvents.once(event, finish);
      nativeEvents.once("closed", finish);
      setState();
      if (!settled) timer = setTimeout(finish, NATIVE_WINDOW_STATE_WAIT_MS);
    });
  }

  /** Mirror the state as it exists at the instant of the handoff. Normally the
   * preload already matches; this also covers using the caption controls while
   * the welcome screen is open. */
  private async matchWindowState(
    window: BrowserWindow,
    reference: BrowserWindow,
  ): Promise<void> {
    const fullScreen = reference.isFullScreen();
    const maximized = !fullScreen && reference.isMaximized();
    const bounds = reference.getContentBounds();
    // A user can move the startup screen between monitors while it loads.
    // Native maximize/full-screen operates on the replacement's current display.
    if (screen.getDisplayMatching(window.getBounds()).id !==
        screen.getDisplayMatching(reference.getBounds()).id) {
      await this.waitForWindowState(window, "leave-full-screen",
        () => !window.isFullScreen(), () => window.setFullScreen(false));
      await this.waitForWindowState(window, "unmaximize",
        () => !window.isMaximized(), () => window.unmaximize());
      if (window.isDestroyed()) return;
      window.setContentBounds(bounds);
    }

    if (fullScreen) {
      await this.waitForWindowState(
        window,
        "enter-full-screen",
        () => window.isFullScreen(),
        () => window.setFullScreen(true),
      );
      return;
    }

    await this.waitForWindowState(
      window,
      "leave-full-screen",
      () => !window.isFullScreen(),
      () => window.setFullScreen(false),
    );
    if (window.isDestroyed()) return;

    if (maximized) {
      await this.waitForWindowState(
        window,
        "maximize",
        () => window.isMaximized(),
        () => window.maximize(),
      );
      return;
    }

    await this.waitForWindowState(
      window,
      "unmaximize",
      () => !window.isMaximized(),
      () => window.unmaximize(),
    );
    if (!window.isDestroyed()) window.setContentBounds(bounds);
  }

  /**
   * State Breadboard's colours on a window's native caption strip again.
   *
   * The Windows controls overlay is themed per window, and Windows drops that
   * theme back to its own default on the transitions that rebuild the window
   * frame — being shown, restored, leaving maximized or full screen, and being
   * made transparent and opaque again, which is how a preloaded dashboard is
   * revealed. Nothing reports that it happened. What is left is a pale grey
   * rectangle in the corner the buttons sit in, over a page that has agreed on
   * its colours everywhere else. The overlay cannot be read back, so this
   * writes rather than compares; the call is cheap and idempotent.
   */
  private applyTitleBarOverlay(window: BrowserWindow): void {
    if (process.platform !== "win32" || window.isDestroyed()) return;
    // The surface a window last reported, so a full-screen one (voice mode) is
    // repainted in its own chrome rather than dragged back to the app theme.
    const surface = this.windowSurfaces.get(window) ?? this.currentTheme;
    try {
      window.setTitleBarOverlay(titleBarForSurface(surface));
    } catch {
      // A window built without an overlay throws rather than ignoring this —
      // its chrome belongs to the system, and is not Breadboard's to paint.
    }
  }

  /** The surface a window is showing, as its renderer last reported it. */
  rememberWindowSurface(window: BrowserWindow, surface: BreadboardWindowSurface): void {
    this.windowSurfaces.set(window, surface);
  }

  private installTitleBarOverlayUpkeep(window: BrowserWindow): void {
    if (process.platform !== "win32") return;
    const restated = () => this.applyTitleBarOverlay(window);
    window.on("show", restated);
    window.on("restore", restated);
    window.on("maximize", restated);
    window.on("unmaximize", restated);
    window.on("leave-full-screen", restated);
  }

  /** The scene a window waits in while the page it was opened for is built. */
  private loadingHtmlPath(): string {
    return (
      this.options.loadingHtmlPath ??
      path.join(path.dirname(this.options.startupHtmlPath), "loading.html")
    );
  }

  private recoveryHtmlPath(): string {
    return (
      this.options.recoveryHtmlPath ??
      path.join(path.dirname(this.options.startupHtmlPath), "recovery.html")
    );
  }

  /**
   * File pages are allowed so Electron can show its own startup and recovery
   * scenes. Neither is an application page worth returning to, however. Keep
   * them out of the remembered dashboard history while retaining file-backed
   * pages used by integration fixtures and packaged local surfaces.
   */
  private isRecoverableLocalPage(url: string): boolean {
    if (!isNavigationAllowed(this.options.allowed, url)) return false;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "file:") return true;
      const excludedPaths = [
        this.options.startupHtmlPath,
        this.recoveryHtmlPath(),
        this.loadingHtmlPath(),
      ].map((file) => pathToFileURL(file).pathname);
      return !excludedPaths.includes(parsed.pathname);
    } catch {
      return false;
    }
  }

  /**
   * A development Next.js server deliberately restarts near its heap limit.
   * If that lands during a renderer reload, Chromium leaves the native window
   * showing only its background color. Keep the last good local URL and retry
   * it until the supervised service is answering again. The same guard helps a
   * popped-out local surface survive a short service restart.
   */
  private installLocalPageRecovery(
    window: BrowserWindow,
    initialUrl: string,
  ): void {
    const existing = this.localPageRecovery.get(window);
    if (existing) {
      existing.url = initialUrl;
      return;
    }

    const state: LocalPageRecoveryState = {
      url: initialUrl,
      attempt: 0,
      timer: null,
      watchdog: null,
      replacement: null,
      paintToken: 0,
      paintWaits: 0,
      heartbeat: null,
    };
    this.localPageRecovery.set(window, state);

    const rememberAllowedUrl = (url: string) => {
      if (this.isRecoverableLocalPage(url)) state.url = url;
    };
    window.webContents.on("did-navigate", (_event, url) => {
      rememberAllowedUrl(url);
    });
    window.webContents.on("did-navigate-in-page", (_event, url) => {
      rememberAllowedUrl(url);
    });
    // Once a replacement owns the retry loop, this window has been retired to
    // the reconnect scene and shares nothing with the attempt in flight but the
    // state object. Its remaining events are about a page nobody is waiting for
    // any more, and letting them clear that state disarms the only thing
    // bringing the dashboard back.
    const retired = () => state.replacement !== null;
    window.webContents.on("did-finish-load", () => {
      if (retired()) return;
      const url = window.webContents.getURL();
      // Chromium may finish loading its internal error document after emitting
      // did-fail-load. Only a real Breadboard URL proves recovery succeeded.
      if (!this.isRecoverableLocalPage(url)) return;
      rememberAllowedUrl(url);
      state.attempt = 0;
      this.clearLoadWatchdog(state);
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
    });
    window.webContents.on(
      "did-fail-load",
      (_event, errorCode, _description, failedUrl, isMainFrame) => {
        // -3 is an intentional aborted navigation, normally a redirect. The
        // watchdog stays armed through one: the navigation it belongs to is
        // still the attempt in flight, and something has to outlive a redirect
        // that leads nowhere.
        if (!isMainFrame || errorCode === -3) return;
        if (retired()) return;
        rememberAllowedUrl(failedUrl);
        this.clearLoadWatchdog(state);
        this.scheduleLocalPageRecovery(window, state);
      },
    );
    window.webContents.on("render-process-gone", () => {
      if (retired()) {
        // Navigating a live http: page to the local reconnect scene retires its
        // renderer, and Chromium reports that teardown here. Put the scene back
        // if it went with it, but leave the retry loop alone: this is the exact
        // event that used to strand the scene by clearing a watchdog belonging
        // to a load in another window entirely.
        this.showRecoveryScene(window);
        return;
      }
      this.clearLoadWatchdog(state);
      this.scheduleLocalPageRecovery(window, state);
    });
    window.once("closed", () => {
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
      this.clearLoadWatchdog(state);
      this.stopRecoveryHeartbeat(state);
      state.paintToken += 1;
      const replacement = state.replacement;
      state.replacement = null;
      if (replacement && !replacement.isDestroyed()) replacement.destroy();
    });
  }

  private scheduleLocalPageRecovery(
    window: BrowserWindow,
    state: LocalPageRecoveryState,
  ): void {
    if (window === this.mainWindow) {
      this.beginMainWindowRecovery(window, state);
      return;
    }
    if (window.isDestroyed() || state.timer !== null) return;
    const delay = localPageRecoveryDelayMs(state.attempt);
    state.attempt += 1;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (window.isDestroyed()) return;
      this.armLoadWatchdog(window, state, () =>
        this.scheduleLocalPageRecovery(window, state),
      );
      void window.loadURL(state.url).catch(() => {
        this.clearLoadWatchdog(state);
        this.scheduleLocalPageRecovery(window, state);
      });
    }, delay);
  }

  private clearLoadWatchdog(state: LocalPageRecoveryState): void {
    if (state.watchdog !== null) clearTimeout(state.watchdog);
    state.watchdog = null;
  }

  /** Put the local reconnect scene in a window. Rate limited, because the
   *  renderer this restores can itself be the one that just died. */
  private showRecoveryScene(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    const now = Date.now();
    if (now - this.recoverySceneShownAt < RECOVERY_SCENE_RESHOW_MS) return;
    this.recoverySceneShownAt = now;
    void window
      .loadFile(this.recoveryHtmlPath(), { query: { theme: this.currentTheme } })
      .catch(() => undefined);
  }

  private startRecoveryHeartbeat(state: LocalPageRecoveryState): void {
    if (state.heartbeat !== null) return;
    state.heartbeat = setInterval(() => {
      const replacement = state.replacement;
      if (!replacement || replacement.isDestroyed()) {
        this.stopRecoveryHeartbeat(state);
        return;
      }
      // Scheduled, in flight under a watchdog, or painting: all three mean the
      // loop still has somewhere to go on its own.
      if (state.timer !== null || state.watchdog !== null || state.paintWaits > 0) return;
      this.log(
        `reconnect has nothing in flight for ${state.url}; the retry loop lost its place, restarting it`,
      );
      this.scheduleMainWindowReplacementLoad(state);
    }, this.options.recoveryHeartbeatMs ?? RECOVERY_HEARTBEAT_MS);
    // Never hold the app open for a window that is only waiting.
    state.heartbeat.unref?.();
  }

  private stopRecoveryHeartbeat(state: LocalPageRecoveryState): void {
    if (state.heartbeat !== null) clearInterval(state.heartbeat);
    state.heartbeat = null;
  }

  /**
   * Keep one load attempt accountable. Every other path out of a retry is an
   * event the load itself raises; this is the one that covers a load raising
   * nothing, by abandoning the navigation so its failure becomes observable.
   */
  private armLoadWatchdog(
    window: BrowserWindow,
    state: LocalPageRecoveryState,
    retry: () => void,
  ): void {
    this.clearLoadWatchdog(state);
    const watchdogMs = this.options.loadWatchdogMs ?? LOCAL_PAGE_LOAD_WATCHDOG_MS;
    state.watchdog = setTimeout(() => {
      state.watchdog = null;
      if (window.isDestroyed()) return;
      this.log(
        `load of ${state.url} answered nothing for ${watchdogMs}ms; abandoning it and retrying`,
      );
      state.paintToken += 1;
      try {
        window.webContents.stop();
      } catch {
        // A window torn down between the check and the call. The retry below
        // finds it destroyed and stops there.
      }
      retry();
    }, watchdogMs);
  }

  /**
   * Keep a useful local scene on screen while a replacement dashboard retries
   * and paints offscreen. The old behavior retried in the visible renderer;
   * during a Next.js restart that exposed nothing but BrowserWindow's native
   * background color, and a successful retry still had to hydrate in public.
   */
  private beginMainWindowRecovery(
    failedWindow: BrowserWindow,
    state: LocalPageRecoveryState,
  ): void {
    if (failedWindow.isDestroyed() || state.replacement) return;

    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    state.paintToken += 1;

    const replacement = this.buildWindow();
    state.replacement = replacement;
    this.parkOffscreen(replacement);

    const retry = () => this.scheduleMainWindowReplacementLoad(state);
    replacement.webContents.on("did-fail-load", (
      _event,
      errorCode,
      _description,
      _failedUrl,
      isMainFrame,
    ) => {
      // -3 is an intentional aborted navigation, normally a redirect. Leaving
      // the watchdog armed through it is deliberate: the attempt is still in
      // flight, and a redirect chain that dies quietly must not end the loop.
      if (!isMainFrame || errorCode === -3) return;
      this.clearLoadWatchdog(state);
      state.paintToken += 1;
      retry();
    });
    replacement.webContents.on("render-process-gone", () => {
      this.clearLoadWatchdog(state);
      state.paintToken += 1;
      retry();
    });
    replacement.webContents.on("did-finish-load", () => {
      const loadedUrl = replacement.webContents.getURL();
      this.clearLoadWatchdog(state);
      // Chromium finishes loading its own error document, so a finished load is
      // not yet a recovered one. Retrying rather than returning is what keeps a
      // dashboard that came back from being met with a window that stopped
      // asking for it.
      if (!this.isRecoverableLocalPage(loadedUrl)) {
        state.paintToken += 1;
        retry();
        return;
      }
      state.url = loadedUrl;
      state.attempt = 0;
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
      const paintToken = ++state.paintToken;
      state.paintWaits += 1;
      void this.waitForFirstPaint(replacement).then(() => {
        state.paintWaits -= 1;
        // A newer attempt owns the outcome now, and retired windows are somebody
        // else's to finish. Both are handled elsewhere; leaving is correct.
        if (state.replacement !== replacement || state.paintToken !== paintToken) return;
        if (replacement.isDestroyed()) return;
        if (!this.isRecoverableLocalPage(replacement.webContents.getURL())) {
          // It wandered off the app while painting. Nothing else is armed for
          // this attempt, so the retry has to be asked for here.
          retry();
          return;
        }
        this.swapToRecoveredMainWindow(failedWindow, replacement, state);
      });
    });

    // Replacing a crashed renderer with a file page gives immediate, reliable
    // feedback while the network-backed dashboard is unavailable.
    this.log(`dashboard page lost; showing the reconnect scene and retrying ${state.url}`);
    this.recoverySceneShownAt = 0;
    this.showRecoveryScene(failedWindow);
    this.startRecoveryHeartbeat(state);
    retry();
  }

  private scheduleMainWindowReplacementLoad(
    state: LocalPageRecoveryState,
  ): void {
    const replacement = state.replacement;
    if (!replacement || replacement.isDestroyed() || state.timer !== null) return;
    const delay = localPageRecoveryDelayMs(state.attempt);
    const attempt = (state.attempt += 1);
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.replacement !== replacement || replacement.isDestroyed()) return;
      // Once the delay reaches its ceiling this is roughly a line a minute, and
      // a reconnect that does not lift is unreadable without knowing whether
      // anything was still asking for the page.
      if (attempt <= 3 || attempt % 12 === 0) {
        this.log(`reconnect attempt ${attempt} for ${state.url}`);
      }
      this.armLoadWatchdog(replacement, state, () =>
        this.scheduleMainWindowReplacementLoad(state),
      );
      void replacement.loadURL(state.url).catch(() => {
        this.clearLoadWatchdog(state);
        this.scheduleMainWindowReplacementLoad(state);
      });
    }, delay);
  }

  private swapToRecoveredMainWindow(
    failedWindow: BrowserWindow,
    replacement: BrowserWindow,
    state: LocalPageRecoveryState,
  ): void {
    if (
      this.mainWindow !== failedWindow ||
      failedWindow.isDestroyed() ||
      replacement.isDestroyed() ||
      state.replacement !== replacement
    ) {
      if (!replacement.isDestroyed()) replacement.destroy();
      state.replacement = null;
      this.stopRecoveryHeartbeat(state);
      // Giving up here is only correct when there is no longer a reconnect
      // scene to lift. A window still sitting on one has to be handed a fresh
      // attempt, or this is the quiet return that strands it.
      if (this.mainWindow === failedWindow && !failedWindow.isDestroyed()) {
        this.log(`reconnect attempt was retired before it landed; starting another`);
        this.beginMainWindowRecovery(failedWindow, state);
      }
      return;
    }

    if (failedWindow.isFullScreen()) replacement.setFullScreen(true);
    else if (failedWindow.isMaximized()) replacement.maximize();
    else replacement.setBounds(failedWindow.getBounds());

    state.replacement = null;
    state.paintToken += 1;
    if (state.timer !== null) clearTimeout(state.timer);
    state.timer = null;
    this.clearLoadWatchdog(state);
    this.stopRecoveryHeartbeat(state);
    this.log(`dashboard came back; handing the window over to ${state.url}`);

    // These listeners belong only to the offscreen retry phase. The adopted
    // window gets a fresh recovery state below; leaving both sets installed
    // would make every later navigation run an obsolete paint probe as well.
    replacement.webContents.removeAllListeners("did-fail-load");
    replacement.webContents.removeAllListeners("render-process-gone");
    replacement.webContents.removeAllListeners("did-finish-load");
    this.prepareWindowReveal(replacement);
    this.unparkWindow(replacement);
    this.mainWindowCloseRequested = false;
    this.mainWindow = replacement;
    this.installLocalPageRecovery(replacement, state.url);
    this.installMainWindowLifetime(replacement);
    // The tabs beside the failed page are whole pages of their own; they move
    // over before the window they were in is taken down with it.
    this.tabs.transfer(failedWindow, replacement);
    replacement.show();
    failedWindow.destroy();
  }

  private installMainWindowLifetime(window: BrowserWindow): void {
    window.on("close", () => {
      // Retired startup/recovery windows are destroyed after their replacement
      // has become current. Their close events must not turn that handoff into
      // an application quit request.
      if (this.mainWindow === window) {
        this.mainWindowCloseRequested = true;
        this.options.onMainWindowCloseRequested?.();
      }
    });
    window.on("closed", () => {
      // Only if it is still the main window: a dashboard swap retires this one
      // deliberately, and must not blank out its replacement.
      if (this.mainWindow === window) this.mainWindow = null;
      // A hidden window left loading would keep the app alive past the last
      // visible one, since `window-all-closed` would never fire.
      this.discardDashboardPreload();
    });
  }

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) return this.mainWindow;
    const window = this.buildWindow();
    // `ready-to-show` can be missed when Chromium's first hidden paint stalls
    // (seen on Windows after a dev rebuild). Never leave a healthy app running
    // indefinitely without a visible native window.
    this.revealWhenReady(window);
    this.mainWindowCloseRequested = false;
    this.installMainWindowLifetime(window);
    this.mainWindow = window;
    return window;
  }

  /**
   * Open a local URL in its own hardened Breadboard window — a second instance
   * of the app (e.g. the Work timer / Paint Pomodoro), so it lives beside the
   * dashboard instead of navigating it away.
   */
  openPopupWindow(targetUrl: string): BrowserWindow {
    // A window opened for a page that paints its own palette should wait in
    // that palette, not in Breadboard's — the sheet Chromium paints between two
    // documents is the one thing the loading scene below cannot cover.
    const window = this.buildWindow(
      popupBackgroundColor(targetUrl, this.currentTheme),
    );
    this.tabs.trackSessionWindow(window);
    this.installLocalPageRecovery(window, targetUrl);
    this.revealWhenReady(window);
    void this.loadThroughLoadingScene(window, targetUrl);
    return window;
  }

  /**
   * The small always-on-top window that controls a teaching session.
   *
   * While someone is demonstrating a task they are working in another
   * application, not in Breadboard, so the recording indicator, the elapsed
   * time and the Finish button have to be somewhere they can still see and
   * reach. A compact floating window is what the desktop shell is for; the page
   * inside it is an ordinary local Breadboard route, so the browser build keeps
   * working with an in-page controller instead.
   *
   * It is deliberately small and corner-parked: a recording controller that
   * covers the thing being recorded defeats itself.
   */
  openTeachControllerWindow(targetUrl: string): BrowserWindow | null {
    if (!isNavigationAllowed(this.options.allowed, targetUrl)) return null;
    const existing = this.teachControllerWindow;
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing;
    }

    const window = new BrowserWindow({
      width: 320,
      height: 132,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      frame: false,
      transparent: false,
      alwaysOnTop: true,
      skipTaskbar: false,
      show: false,
      title: "Recording a demonstration",
      backgroundColor: "#141414",
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    hardenWindow(window, this.options.allowed, (url) => this.openPopupWindow(url));
    // Above ordinary windows without stealing focus from the application the
    // person is demonstrating in.
    window.setAlwaysOnTop(true, "floating");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    const display = screen.getPrimaryDisplay().workArea;
    window.setBounds({
      x: Math.max(display.x, display.x + display.width - 340),
      y: display.y + 20,
      width: 320,
      height: 132,
    });

    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) window.showInactive();
    });
    window.once("closed", () => {
      if (this.teachControllerWindow === window) this.teachControllerWindow = null;
    });

    this.teachControllerWindow = window;
    void window.loadURL(targetUrl).catch(() => undefined);
    return window;
  }

  closeTeachControllerWindow(): boolean {
    const window = this.teachControllerWindow;
    this.teachControllerWindow = null;
    if (!window || window.isDestroyed()) return false;
    window.destroy();
    return true;
  }

  /**
   * Open a page behind the app's own loading scene.
   *
   * A local page can take seconds to answer the first time it is asked for —
   * long enough that a window showing nothing but its background colour is what
   * a person sees when they click. Nothing can be drawn into that gap from the
   * page's side, because there is no document yet. So the window is given one:
   * the same field the app starts on, painted from a local file that loads
   * instantly, and Chromium holds it on screen until the real page has a frame
   * of its own to replace it with.
   */
  private async loadThroughLoadingScene(
    window: BrowserWindow,
    targetUrl: string,
  ): Promise<void> {
    try {
      await window.loadFile(this.loadingHtmlPath(), {
        query: { theme: this.currentTheme },
      });
    } catch {
      // The scene is a courtesy. A window that cannot show it still opens.
    }
    if (window.isDestroyed()) return;
    await window.loadURL(targetUrl).catch(() => undefined);
  }

  async showStartupScreen(): Promise<void> {
    const window = this.createMainWindow();
    // A fresh startup screen means a fresh welcome to dismiss, and any dashboard
    // loaded ahead of a service that has since died is not worth keeping.
    this.startupContinued = false;
    this.discardDashboardPreload();
    await window.loadFile(this.options.startupHtmlPath, {
      query: { theme: this.currentTheme },
    });
    if (!window.isVisible()) window.show();
    this.startupShownAt = Date.now();
  }

  /** The startup renderer reporting that its welcome dissolve has finished. */
  markStartupContinued(): void {
    this.startupContinued = true;
    const waiters = [...this.startupContinueWaiters];
    this.startupContinueWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  /**
   * Resolves once the welcome screen has been dismissed. Ordering is not a
   * hazard: a dismissal that lands before anyone waits is remembered.
   */
  waitForStartupContinue(
    maxWaitMs: number = this.options.welcomeGateMaxWaitMs ?? WELCOME_GATE_MAX_WAIT_MS,
  ): Promise<void> {
    if (this.startupContinued) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const settle = () => {
        this.startupContinueWaiters.delete(settle);
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(settle, maxWaitMs);
      this.startupContinueWaiters.add(settle);
    });
  }

  /**
   * Render the dashboard in a hidden window while the startup screen is still
   * up. Its paint is what ends the loading field and brings up the welcome, so
   * by the time there is a greeting to dismiss the app behind it is finished.
   */
  private beginDashboardPreload(launchUrl: string, dashboardUrl: string): DashboardPreload {
    const existing = this.dashboardPreload;
    if (existing && existing.url === launchUrl && !existing.window.isDestroyed()) {
      return existing;
    }
    this.discardDashboardPreload();
    const window = this.buildWindow();
    this.parkOffscreen(window);
    this.installLocalPageRecovery(window, launchUrl);
    const restoredWindows: BrowserWindow[] = [];
    const settled = new Promise<"loaded" | "failed">((resolve) => {
      // Deliberately not `ready-to-show`: it fires at the first paint of the
      // shell, long before the page it is meant to be handing over has content.
      window.webContents.once("did-finish-load", () => {
        void Promise.all([
          this.waitForFirstPaint(window),
          this.tabs.restoreSession(window, dashboardUrl, () => {
            const restored = this.buildWindow();
            restoredWindows.push(restored);
            this.parkOffscreen(restored);
            this.installLocalPageRecovery(restored, launchUrl);
            void restored.loadURL(launchUrl).catch(() => undefined);
            return restored;
          }, true),
        ]).then(() => resolve("loaded"), () => resolve("failed"));
      });
      window.webContents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
        // -3 is ABORTED, which a redirect raises on its way to a good page.
        if (isMainFrame && errorCode !== -3) resolve("failed");
      });
      window.once("closed", () => resolve("failed"));
    });
    const preload: DashboardPreload = { window, url: launchUrl, restoredWindows, settled };
    this.dashboardPreload = preload;
    void window.loadURL(launchUrl).catch(() => undefined);
    return preload;
  }

  /** The shared paint probe, run in this window's own page; see first-paint.ts. */
  private async waitForFirstPaint(
    window: BrowserWindow,
    maxWaitMs = FIRST_PAINT_MAX_WAIT_MS,
  ): Promise<void> {
    if (window.isDestroyed()) return;
    await waitForFirstPaint(window.webContents, maxWaitMs);
  }

  private async waitForWindowFrame(window: BrowserWindow): Promise<void> {
    const deadline = Date.now() + REVEAL_FRAME_MAX_WAIT_MS;
    while (!window.isDestroyed() && Date.now() < deadline) {
      const size = window.getContentSize();
      const painted = await waitForViewportFrame(window.webContents, size, deadline - Date.now());
      if (window.isDestroyed() || painted === undefined) return;
      const current = window.getContentSize();
      // Caption/DPI updates can finish asynchronously even after maximize has
      // fired. If they changed the client area, wait for that viewport too.
      if (painted && size[0] === current[0] && size[1] === current[1]) return;
    }
  }

  /**
   * Hold the welcome until all startup tabs have loaded and painted. There is
   * no elapsed-time bypass: a slow tab must finish behind the loading screen.
   */
  async waitForDashboardPaint(): Promise<void> {
    const preload = this.dashboardPreload;
    if (!preload || preload.window.isDestroyed()) return;
    await preload.settled;
  }

  private discardDashboardPreload(): void {
    const preload = this.dashboardPreload;
    this.dashboardPreload = null;
    for (const window of preload?.restoredWindows ?? []) {
      if (!window.isDestroyed()) window.destroy();
    }
    if (preload && !preload.window.isDestroyed()) preload.window.destroy();
  }

  /**
   * Put the loaded window exactly where the startup window was and retire that
   * one, so the swap reads as the same window continuing rather than a new one
   * opening in front.
   */
  private async swapToDashboardPreload(): Promise<boolean> {
    const preload = this.dashboardPreload;
    if (!preload || preload.window.isDestroyed()) return false;
    const dashboard = preload.window;
    const startup = this.mainWindow;
    // Match any caption-control change made while the welcome was open, still
    // at zero opacity. In the normal path this is already settled because
    // parkOffscreen staged the native state before the page started loading.
    if (startup && !startup.isDestroyed() && startup !== dashboard) {
      await this.matchWindowState(dashboard, startup);
    } else {
      dashboard.center();
    }
    for (const window of preload.restoredWindows) {
      if (dashboard.isDestroyed()) return false;
      if (window.isDestroyed()) continue;
      await this.matchWindowState(window, dashboard);
    }
    // First paint happened before the final geometry was applied. Keep the
    // startup screen in front until each resized viewport has a fresh frame.
    const windows = [dashboard, ...preload.restoredWindows];
    for (const window of windows) {
      if (!window.isDestroyed()) this.prepareWindowReveal(window);
    }
    await Promise.all(windows.filter(window => !window.isDestroyed())
      .map(window => this.waitForWindowFrame(window)));
    if (dashboard.isDestroyed() || this.dashboardPreload !== preload) return false;
    this.dashboardPreload = null;
    this.mainWindowCloseRequested = false;
    this.mainWindow = dashboard;
    this.installMainWindowLifetime(dashboard);
    for (const window of windows) {
      if (!window.isDestroyed()) this.unparkWindow(window);
    }
    // These windows are already shown at zero opacity. Calling show again can
    // replay a native show transition; only focus needs to change at handoff.
    dashboard.focus();
    if (startup && !startup.isDestroyed() && startup !== dashboard) startup.destroy();
    return true;
  }

  async showDashboard(dashboardUrl: string, defaultScreenUrl = dashboardUrl): Promise<void> {
    // LocalStorage belongs to an origin, and the supervised dashboard can use a
    // different port on the next launch. Give a fresh or previously reused
    // origin the durable shell preference before its first paint instead of
    // letting missing/stale origin storage reset the last active decision.
    const launchUrl = dashboardUrlWithTheme(defaultScreenUrl, this.currentTheme);
    const window = this.createMainWindow();
    if (this.startupShownAt !== null) {
      const preload = this.beginDashboardPreload(launchUrl, dashboardUrl);
      // Hold the reveal until the person clicks through the welcome, so the
      // dashboard arrives into the dissolve rather than cutting across it.
      await this.waitForStartupContinue();
      const remaining = remainingStartupVisibleMs(
        this.startupShownAt,
        Date.now(),
        this.options.minimumStartupVisibleMs,
      );
      if (remaining > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, remaining));
      }
      const outcome = await preload.settled;
      if (outcome === "loaded" && (await this.swapToDashboardPreload())) {
        this.startupShownAt = null;
        return;
      }
      // A dashboard that would not load is reported by the window the person is
      // already looking at, exactly as it was before it loaded ahead.
      this.discardDashboardPreload();
    }
    if (window.isDestroyed()) return;
    this.installLocalPageRecovery(window, launchUrl);
    // A window that already has a page on screen — the startup screen, almost
    // always — keeps showing it until the dashboard has painted. One that has
    // nothing in it yet (the app reopened after its last window was closed)
    // would be a flat sheet for the whole load, so it waits in the scene first.
    if (!window.webContents.getURL()) {
      await window
        .loadFile(this.loadingHtmlPath(), { query: { theme: this.currentTheme } })
        .catch(() => undefined);
      if (window.isDestroyed()) return;
    }
    await window.loadURL(launchUrl);
    this.startupShownAt = null;
    await this.restoreTabSession(dashboardUrl, defaultScreenUrl);
  }

  private async restoreTabSession(dashboardUrl: string, defaultScreenUrl: string): Promise<void> {
    const window = this.mainWindow;
    if (!window || window.isDestroyed()) return;
    await this.tabs.restoreSession(window, dashboardUrl, () => this.openPopupWindow(defaultScreenUrl));
  }

  /** Reload the page in front without touching backend services. */
  reload(): void {
    const window = BrowserWindow.getFocusedWindow() ?? this.mainWindow;
    if (!window || window.isDestroyed()) return;
    this.tabs.reloadActive(window);
  }

  sendToRenderer(channel: string, payload: unknown): void {
    const window = this.mainWindow;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
    try {
      window.webContents.send(channel, payload);
    } catch (error) {
      // A local dashboard restart can dispose its RenderFrameHost a fraction
      // before Electron marks the BrowserWindow/WebContents destroyed. Sending
      // inside that gap throws synchronously. A state notification is
      // replayable after recovery; it must never take down the main process.
      this.log(
        `renderer unavailable while sending ${channel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
