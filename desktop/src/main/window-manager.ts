import { BrowserWindow, app } from "electron";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  hardenWindow,
  isNavigationAllowed,
  type AllowedOrigins,
} from "./security";
import { mainWindowOptions } from "./window-options";
import type { BreadboardWindowTheme } from "./window-options";

export interface WindowManagerOptions {
  allowed: AllowedOrigins;
  startupHtmlPath: string;
  recoveryHtmlPath?: string;
  preloadPath: string;
  iconPath?: string;
  minimumStartupVisibleMs?: number;
  welcomeGateMaxWaitMs?: number;
  dashboardPreloadGraceMs?: number;
  initialTheme?: BreadboardWindowTheme;
  /** Where window recovery reports what it is doing. Silent when omitted. */
  log?: (line: string) => void;
}

interface DashboardPreload {
  window: BrowserWindow;
  url: string;
  /** Resolves when the hidden dashboard has painted, or given up. */
  settled: Promise<"loaded" | "failed">;
}

export const DEFAULT_MINIMUM_STARTUP_VISIBLE_MS = 2_200;
export const WINDOW_VISIBILITY_FALLBACK_MS = 1_500;
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
/**
 * How long the click waits for a dashboard that is still painting. The welcome
 * is not offered until the preload has painted, so this is only reached when
 * that wait hit its own cap; showing a half-loaded dashboard still beats
 * throwing the work away and starting the load over in the startup window.
 */
export const DASHBOARD_PRELOAD_GRACE_MS = 1_200;
/**
 * How long the startup screen stays on its loading field after the services are
 * healthy, waiting for the dashboard rendering behind it to paint. The welcome
 * is the last thing before the handoff, so it must not be offered before there
 * is something to hand off to: a click has to open the app, not open a wait.
 * Generous on purpose: the loading field is made to be sat through, and every
 * second spent here is a second the click does not have to. Reaching the cap
 * means offering a welcome over a dashboard that is still coming, so it is set
 * past what even a cold first compile takes — it exists only so a dashboard
 * that never paints at all cannot strand a person on the loading field.
 */
export const DASHBOARD_PAINT_MAX_WAIT_MS = 60_000;
/**
 * Ceiling on the in-page paint probe, so a page that paints but never settles
 * is discovered here rather than at the much longer outer cap.
 */
export const FIRST_PAINT_PROBE_MAX_WAIT_MS = 12_000;
/**
 * The probe caps itself, but only if it runs: a renderer wedged on its main
 * thread never reaches the timer it set. Recovery hands the window back on the
 * far side of this wait, so an unsettled probe is the difference between a
 * dashboard returning and a person staring at the reconnect scene forever.
 */
export const FIRST_PAINT_MAX_WAIT_MS = FIRST_PAINT_PROBE_MAX_WAIT_MS + 3_000;

/**
 * Where a preloading window waits while it renders. Windows clamps this to
 * roughly -26000, which is still far outside any real desktop; the window is
 * transparent as well, so a platform that ignores the position entirely still
 * shows nothing.
 */
export const OFFSCREEN_PRELOAD_ORIGIN = -32_000;

/**
 * Resolves once the hydrated page has actually put pixels up. `did-finish-load`
 * fires when the document is done, which for an App Router page is before React
 * has hydrated and before client-only panels have rendered anything — swapping
 * inside that window is precisely what shows a dashboard of empty frames.
 *
 * A contentful paint is what proves there are pixels: animation frames keep
 * running in a window Chromium is not rasterizing, so rAF alone cannot tell a
 * painted page from a parked one — measured, not assumed. Fonts settling, then
 * an idle main thread, then two animation frames on top of that is the proxy
 * for "hydration is done and its result has been painted too".
 */
const FIRST_PAINT_PROBE = `new Promise((resolve) => {
  const done = () => resolve(true);
  setTimeout(done, ${FIRST_PAINT_PROBE_MAX_WAIT_MS});
  const afterPaint = () => requestAnimationFrame(() => requestAnimationFrame(done));
  const whenIdle = () =>
    typeof requestIdleCallback === "function"
      ? requestIdleCallback(afterPaint, { timeout: 2000 })
      : setTimeout(afterPaint, 200);
  const whenHydrated = () => {
    const fonts = document.fonts && document.fonts.ready;
    if (fonts && typeof fonts.then === "function") fonts.then(whenIdle, whenIdle);
    else whenIdle();
  };
  if (typeof PerformanceObserver !== "function") return whenHydrated();
  let advanced = false;
  const advance = () => {
    if (advanced) return;
    advanced = true;
    whenHydrated();
  };
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name !== "first-contentful-paint") continue;
        observer.disconnect();
        advance();
      }
    });
    // \`buffered\` matters: the paint usually lands before this probe is injected.
    observer.observe({ type: "paint", buffered: true });
  } catch (error) {
    advance();
  }
})`;

interface FullScreenShortcutInput {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  shift: boolean;
  isAutoRepeat: boolean;
}

interface LocalPageRecoveryState {
  url: string;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Armed for the duration of one load attempt; see the watchdog constant. */
  watchdog: ReturnType<typeof setTimeout> | null;
  replacement: BrowserWindow | null;
  paintToken: number;
}

export function isFullScreenShortcut(input: FullScreenShortcutInput): boolean {
  if (input.type !== "keyDown" || input.isAutoRepeat) return false;
  if (input.key.toUpperCase() === "F11") return true;
  return input.key.toLowerCase() === "f" && input.shift && (input.control || input.meta);
}

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
  private startupContinued = false;
  private readonly startupContinueWaiters = new Set<() => void>();
  private dashboardPreload: DashboardPreload | null = null;
  private currentTheme: BreadboardWindowTheme;
  private readonly localPageRecovery = new WeakMap<
    BrowserWindow,
    LocalPageRecoveryState
  >();

  constructor(options: WindowManagerOptions) {
    this.options = options;
    this.currentTheme = options.initialTheme ?? "light";
  }

  get window(): BrowserWindow | null {
    return this.mainWindow;
  }

  rememberTheme(theme: BreadboardWindowTheme): void {
    this.currentTheme = theme;
  }

  private log(line: string): void {
    this.options.log?.(`[window] ${line}`);
  }

  private installWindowShortcuts(window: BrowserWindow): void {
    window.webContents.on("before-input-event", (event, input) => {
      if (!isFullScreenShortcut(input)) return;
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    });
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
  private buildWindow(): BrowserWindow {
    const window = new BrowserWindow(
      mainWindowOptions(
        this.options.preloadPath,
        this.options.iconPath,
        process.platform,
        this.currentTheme,
      ),
    );
    hardenWindow(window, this.options.allowed, (url) => this.openPopupWindow(url));
    this.installWindowShortcuts(window);
    return window;
  }

  /**
   * Park a window where it renders for real without ever being seen.
   *
   * A window that is only hidden still runs its scripts, and with background
   * throttling off it even runs its animation frames — but Chromium rasterizes
   * nothing for it. Revealing one is what leaves the app showing a flat sheet of
   * its background colour while the whole page paints from cold, which is the
   * wait the welcome screen exists to absorb. Off the desktop, fully
   * transparent and click-through, it paints like any other window.
   */
  private parkOffscreen(window: BrowserWindow): void {
    const reference = this.mainWindow;
    // Paint at the size it will be revealed at, so the swap is not a resize: a
    // maximized startup window handed a 1440-wide render would lay the whole
    // dashboard out again in front of the person. `setBounds` rather than
    // `setSize` — Windows counts its invisible resize border in the latter.
    const shown =
      reference && !reference.isDestroyed() && reference !== window
        ? reference.getBounds()
        : window.getBounds();
    window.setOpacity(0);
    window.setSkipTaskbar(true);
    // Invisible is not intangible: this window is raised above the startup
    // screen, and the welcome below it is dismissed by a click.
    window.setIgnoreMouseEvents(true);
    window.setBounds({
      x: OFFSCREEN_PRELOAD_ORIGIN,
      y: OFFSCREEN_PRELOAD_ORIGIN,
      width: shown.width,
      height: shown.height,
    });
    // Not `show`: the startup screen keeps the focus until the person leaves it.
    window.showInactive();
  }

  /** Undoes {@link parkOffscreen}, short of moving the window back on screen —
   *  the caller owns that, because it also owns maximized and full-screen. */
  private unparkWindow(window: BrowserWindow): void {
    window.setIgnoreMouseEvents(false);
    window.setSkipTaskbar(false);
    window.setOpacity(1);
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
    window.webContents.on("did-finish-load", () => {
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
        rememberAllowedUrl(failedUrl);
        this.clearLoadWatchdog(state);
        this.scheduleLocalPageRecovery(window, state);
      },
    );
    window.webContents.on("render-process-gone", () => {
      this.clearLoadWatchdog(state);
      this.scheduleLocalPageRecovery(window, state);
    });
    window.once("closed", () => {
      if (state.timer !== null) clearTimeout(state.timer);
      state.timer = null;
      this.clearLoadWatchdog(state);
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
    state.watchdog = setTimeout(() => {
      state.watchdog = null;
      if (window.isDestroyed()) return;
      this.log(
        `load of ${state.url} answered nothing for ${LOCAL_PAGE_LOAD_WATCHDOG_MS}ms; abandoning it and retrying`,
      );
      state.paintToken += 1;
      try {
        window.webContents.stop();
      } catch {
        // A window torn down between the check and the call. The retry below
        // finds it destroyed and stops there.
      }
      retry();
    }, LOCAL_PAGE_LOAD_WATCHDOG_MS);
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
      void this.waitForFirstPaint(replacement).then(() => {
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
    void failedWindow
      .loadFile(this.recoveryHtmlPath(), {
        query: { theme: this.currentTheme },
      })
      .catch(() => undefined);
    retry();
  }

  private scheduleMainWindowReplacementLoad(
    state: LocalPageRecoveryState,
  ): void {
    const replacement = state.replacement;
    if (!replacement || replacement.isDestroyed() || state.timer !== null) return;
    const delay = localPageRecoveryDelayMs(state.attempt);
    state.attempt += 1;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.replacement !== replacement || replacement.isDestroyed()) return;
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
    this.log(`dashboard came back; handing the window over to ${state.url}`);

    // These listeners belong only to the offscreen retry phase. The adopted
    // window gets a fresh recovery state below; leaving both sets installed
    // would make every later navigation run an obsolete paint probe as well.
    replacement.webContents.removeAllListeners("did-fail-load");
    replacement.webContents.removeAllListeners("render-process-gone");
    replacement.webContents.removeAllListeners("did-finish-load");
    this.unparkWindow(replacement);
    this.mainWindow = replacement;
    this.installLocalPageRecovery(replacement, state.url);
    this.installMainWindowLifetime(replacement);
    replacement.show();
    failedWindow.destroy();
  }

  private installMainWindowLifetime(window: BrowserWindow): void {
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
    const window = this.buildWindow();
    this.installLocalPageRecovery(window, targetUrl);
    this.revealWhenReady(window);
    void window.loadURL(targetUrl);
    return window;
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
  private beginDashboardPreload(dashboardUrl: string): DashboardPreload {
    const existing = this.dashboardPreload;
    if (existing && existing.url === dashboardUrl && !existing.window.isDestroyed()) {
      return existing;
    }
    this.discardDashboardPreload();
    const window = this.buildWindow();
    this.parkOffscreen(window);
    this.installLocalPageRecovery(window, dashboardUrl);
    const settled = new Promise<"loaded" | "failed">((resolve) => {
      // Deliberately not `ready-to-show`: it fires at the first paint of the
      // shell, long before the page it is meant to be handing over has content.
      window.webContents.once("did-finish-load", () => {
        void this.waitForFirstPaint(window).then(() => resolve("loaded"));
      });
      window.webContents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
        // -3 is ABORTED, which a redirect raises on its way to a good page.
        if (isMainFrame && errorCode !== -3) resolve("failed");
      });
      window.once("closed", () => resolve("failed"));
    });
    const preload: DashboardPreload = { window, url: dashboardUrl, settled };
    this.dashboardPreload = preload;
    void window.loadURL(dashboardUrl).catch(() => undefined);
    return preload;
  }

  /** Runs {@link FIRST_PAINT_PROBE} in the loaded page; never throws, always
   *  settles. The probe's own cap lives inside the renderer, so it is no help
   *  when the renderer is the thing that has stopped. */
  private async waitForFirstPaint(
    window: BrowserWindow,
    maxWaitMs = FIRST_PAINT_MAX_WAIT_MS,
  ): Promise<void> {
    if (window.isDestroyed()) return;
    let ceiling: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        window.webContents.executeJavaScript(FIRST_PAINT_PROBE, true),
        new Promise((resolve) => {
          ceiling = setTimeout(resolve, maxWaitMs);
        }),
      ]);
    } catch {
      // Navigated away, closed, or refused the evaluation. The page is no worse
      // off than it was before this check existed, and stalling here would cost
      // the person the whole outer wait for nothing.
    } finally {
      if (ceiling) clearTimeout(ceiling);
    }
  }

  /**
   * Resolves once the preloaded dashboard has painted, so the startup screen
   * can hold the welcome back until there is a finished page to dissolve into.
   * Returns immediately when nothing is preloading, and gives up at
   * `maxWaitMs` so a dashboard that never paints cannot trap the app on the
   * startup screen — the swap that follows is bounded on its own besides.
   */
  async waitForDashboardPaint(
    maxWaitMs: number = DASHBOARD_PAINT_MAX_WAIT_MS,
  ): Promise<void> {
    const preload = this.dashboardPreload;
    if (!preload || preload.window.isDestroyed()) return;
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      preload.settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, maxWaitMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  private discardDashboardPreload(): void {
    const preload = this.dashboardPreload;
    this.dashboardPreload = null;
    if (preload && !preload.window.isDestroyed()) preload.window.destroy();
  }

  /**
   * Put the loaded window exactly where the startup window was and retire that
   * one, so the swap reads as the same window continuing rather than a new one
   * opening in front.
   */
  private swapToDashboardPreload(): boolean {
    const preload = this.dashboardPreload;
    if (!preload || preload.window.isDestroyed()) return false;
    this.dashboardPreload = null;
    const dashboard = preload.window;
    const startup = this.mainWindow;
    // Back on screen first, still transparent: the move is what the compositor
    // sees, and it should not see a half-placed window at full opacity.
    if (startup && !startup.isDestroyed() && startup !== dashboard) {
      if (startup.isFullScreen()) dashboard.setFullScreen(true);
      else if (startup.isMaximized()) dashboard.maximize();
      else dashboard.setBounds(startup.getBounds());
    } else {
      dashboard.center();
    }
    this.unparkWindow(dashboard);
    this.mainWindow = dashboard;
    this.installMainWindowLifetime(dashboard);
    dashboard.show();
    if (startup && !startup.isDestroyed() && startup !== dashboard) startup.destroy();
    return true;
  }

  async showDashboard(dashboardUrl: string): Promise<void> {
    const window = this.createMainWindow();
    if (this.startupShownAt !== null) {
      const preload = this.beginDashboardPreload(dashboardUrl);
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
      const grace = this.options.dashboardPreloadGraceMs ?? DASHBOARD_PRELOAD_GRACE_MS;
      const outcome = await Promise.race([
        preload.settled,
        new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), grace)),
      ]);
      if (outcome !== "failed" && this.swapToDashboardPreload()) {
        this.startupShownAt = null;
        return;
      }
      // A dashboard that would not load is reported by the window the person is
      // already looking at, exactly as it was before it loaded ahead.
      this.discardDashboardPreload();
    }
    this.installLocalPageRecovery(window, dashboardUrl);
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
