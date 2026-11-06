import type { IpcRenderer } from "electron";
import type {
  BrowserBookmark,
  BrowserSignInsState,
  BrowserHistoryCommand,
  BrowserHistorySnapshot,
  BrowserDownloadCommand,
  BrowserDownloadsSnapshot,
  DownloadSettingsState,
  DownloadSettingsResult,
  ChatgptWebTabRequest,
  ChatgptWebTabResult,
  DesktopNotificationToast,
  NotificationOverlaySize,
  OpenLocalPathRequest,
  OpenLocalPathResult,
  SavePdfDownloadRequest,
  SavePdfDownloadResult,
  TabsCommand,
  TabsState,
  WindowThemeSchedule,
} from "../shared/ipc-contract";

export const PRELOAD_IPC_CHANNELS = {
  getVersions: "breadboard:get-versions",
  getStartupState: "breadboard:get-startup-state",
  retryService: "breadboard:retry-service",
  openLogs: "breadboard:open-logs",
  copyDiagnostics: "breadboard:copy-diagnostics",
  quit: "breadboard:quit",
  restartApp: "breadboard:restart-app",
  pickFolder: "breadboard:pick-folder",
  openMicrophoneSettings: "breadboard:open-microphone-settings",
  allowThemeLocation: "breadboard:allow-theme-location",
  setTheme: "breadboard:set-theme",
  getThemeState: "breadboard:get-theme-state",
  getStartupSound: "breadboard:get-startup-sound",
  claimStartupSound: "breadboard:claim-startup-sound",
  setStartupSound: "breadboard:set-startup-sound",
  getCurrentLocationPreference: "breadboard:get-current-location-preference",
  setCurrentLocationPreference: "breadboard:set-current-location-preference",
  startupContinue: "breadboard:startup-continue",
  startupAwaitDashboard: "breadboard:startup-await-dashboard",
  startupState: "breadboard:startup-state",
  openTeachController: "breadboard:open-teach-controller",
  closeTeachController: "breadboard:close-teach-controller",
  getTabsState: "breadboard:get-tabs-state",
  getBrowserTerminalAccess: "breadboard:get-browser-terminal-access",
  spotifyRequest: "breadboard:spotify-request",
  readTerminalData: "breadboard:read-terminal-data",
  cancelTerminalData: "breadboard:cancel-terminal-data",
  textHighlightRequest: "breadboard:text-highlight-request",
  tabsCommand: "breadboard:tabs-command",
  tabsState: "breadboard:tabs-state",
  browserInlineAnswerState: "breadboard:browser-inline-answer-state",
  browserInlineAnswerAction: "breadboard:browser-inline-answer-action",
  notificationToast: "breadboard:notification-toast",
  notificationOverlayVisibility: "breadboard:notification-overlay-visibility",
  getBrowserNavigation: "breadboard:get-browser-navigation",
  getBrowserSignIns: "breadboard:get-browser-sign-ins",
  openBrowserSignIn: "breadboard:open-browser-sign-in",
  resetBrowserSignIns: "breadboard:reset-browser-sign-ins",
  chatgptWebTab: "breadboard:chatgpt-web-tab",
  setBrowserNavigation: "breadboard:set-browser-navigation",
  getBrowserBookmarks: "breadboard:get-browser-bookmarks",
  setBrowserBookmarks: "breadboard:set-browser-bookmarks",
  getBrowserShortcuts: "breadboard:get-browser-shortcuts",
  setBrowserShortcuts: "breadboard:set-browser-shortcuts",
  getBrowserRecentSearches: "breadboard:get-browser-recent-searches",
  getBrowserHistory: "breadboard:get-browser-history",
  browserHistoryCommand: "breadboard:browser-history-command",
  browserHistoryChanged: "breadboard:browser-history-changed",
  setBrowserRecentSearches: "breadboard:set-browser-recent-searches",
  getBrowserDownloads: "breadboard:get-browser-downloads",
  browserDownloadCommand: "breadboard:browser-download-command",
  savePdfDownload: "breadboard:save-pdf-download",
  getDownloadSettings: "breadboard:get-download-settings",
  setDownloadPrompt: "breadboard:set-download-prompt",
  chooseDownloadDirectory: "breadboard:choose-download-directory",
  openLocalPath: "breadboard:open-local-path",
} as const;

export interface StartupServiceView {
  id: string;
  displayName: string;
  required: boolean;
  state: string;
  lastError: string | null;
  restarts: number;
  /** Reused from an instance that was already running, not started here. */
  adopted?: boolean;
}

export interface StartupStateView {
  phase: "preparing" | "starting" | "ready" | "failed";
  message: string;
  services: StartupServiceView[];
  failure?: {
    serviceId: string;
    displayName: string;
    reason: string;
    logTail: string[];
  };
}

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown;
}

export function createDesktopApi(ipcRenderer: IpcRendererLike) {
  const startupListeners = new Set<(state: StartupStateView) => void>();
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.startupState, (_event, state) => {
    for (const listener of startupListeners) listener(state as StartupStateView);
  });
  const tabsListeners = new Set<(state: TabsState) => void>();
  const inlineStateListeners = new Set<(state: unknown) => void>();
  const inlineActionListeners = new Set<(action: unknown) => void>();
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.browserInlineAnswerState, (_event, state) => { for (const listener of inlineStateListeners) listener(state); });
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.browserInlineAnswerAction, (_event, action) => { for (const listener of inlineActionListeners) listener(action); });
  const historyListeners = new Set<() => void>();
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.browserHistoryChanged, () => {
    for (const listener of historyListeners) listener();
  });
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.tabsState, (_event, state) => {
    const tabs = state as TabsState;
    if (typeof document !== "undefined") {
      const apply = () => {
        document.documentElement.dataset.persistentWindowShell = String(tabs.persistentShell === true);
        const activeGroup = tabs.groups?.find(group => group.split && !group.collapsed && tabs.tabs.find(tab => tab.id === tabs.activeId)?.groupId === group.id);
        const foreground = tabs.selfId === tabs.activeId || tabs.selfId === tabs.presentedId ||
          Boolean(activeGroup && tabs.tabs.some(tab => tab.id === tabs.selfId && tab.groupId === activeGroup.id));
        document.documentElement.dataset.desktopTabActive = String(foreground);
        if (!document.getElementById("breadboard-window-shell-style")) {
          const style = document.createElement("style");
          style.id = "breadboard-window-shell-style";
          style.textContent = 'html[data-persistent-window-shell="true"]{--breadboard-titlebar-height:0px!important}html[data-persistent-window-shell="true"] :is(.desktop-title-bar,.bb-nav-progress){display:none!important}[data-desktop-tab-active="false"] *,[data-desktop-tab-active="false"] *::before,[data-desktop-tab-active="false"] *::after{animation-play-state:paused!important}';
          document.head?.append(style);
        }
      };
      if (document.documentElement) apply();
      else document.addEventListener("DOMContentLoaded", apply, { once: true });
    }
    for (const listener of tabsListeners) listener(tabs);
  });
  const notificationListeners = new Set<(notice: DesktopNotificationToast) => void>();
  let notificationOverlayVisible = false;
  const notificationVisibilityListeners = new Set<(visible: boolean) => void>();
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.notificationOverlayVisibility, (_event, visible) => {
    notificationOverlayVisible = visible === true;
    for (const listener of notificationVisibilityListeners) listener(notificationOverlayVisible);
  });
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.notificationToast, (_event, notice) => {
    for (const listener of notificationListeners) {
      listener(notice as DesktopNotificationToast);
    }
  });

  return {
    getVersions: (): Promise<{ app: string; electron: string }> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getVersions) as Promise<{
        app: string;
        electron: string;
      }>,
    onStartupState: (listener: (state: StartupStateView) => void): (() => void) => {
      startupListeners.add(listener);
      return () => startupListeners.delete(listener);
    },
    getStartupState: (): Promise<StartupStateView> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getStartupState) as Promise<StartupStateView>,
    retryService: (serviceId: string): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.retryService, serviceId) as Promise<boolean>,
    openLogsFolder: (): Promise<void> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.openLogs) as Promise<void>,
    copyDiagnostics: (): Promise<void> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.copyDiagnostics) as Promise<void>,
    quit: (): Promise<void> => ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.quit) as Promise<void>,
    /**
     * Relaunch the complete application. Development launches rebuild the
     * artifacts used by their active dashboard mode before they close.
     */
    restartBreadboard: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.restartApp) as Promise<boolean>,
    // The startup screen ends on a welcome the person dismisses themselves; this
    // is the renderer telling the shell its dissolve has finished and the
    // dashboard may take the window.
    continueToDashboard: (): Promise<void> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.startupContinue) as Promise<void>,
    // Resolves when the dashboard loading behind the startup screen has
    // painted, so the welcome is not offered until a click on it would open a
    // finished app. Pending tab and widget loads keep this promise waiting.
    awaitDashboardReady: (): Promise<void> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.startupAwaitDashboard) as Promise<void>,
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.pickFolder) as Promise<string | null>,
    openMicrophoneSettings: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.openMicrophoneSettings) as Promise<boolean>,
    // The Profile switch is the explicit user gesture that opens this narrow
    // permission. No other renderer receives geolocation by default.
    allowThemeLocation: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.allowThemeLocation) as Promise<boolean>,
    // "voice" is not a theme but a full-screen surface that owns the window
    // chrome while it is open; the window goes back to its theme on close.
    // The dashboard adds how it chose the theme (see WindowThemeSchedule) so
    // the next launch opens on the right side of sunrise; the overlay does not.
    setTheme: (
      surface: "light" | "dark" | "voice",
      schedule?: WindowThemeSchedule,
    ): Promise<boolean> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.setTheme,
        ...(schedule ? [surface, schedule] : [surface]),
      ) as Promise<boolean>,
    getThemeState: (): Promise<{ theme: "light" | "dark"; schedule: WindowThemeSchedule } | null> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getThemeState) as Promise<{
        theme: "light" | "dark"; schedule: WindowThemeSchedule;
      } | null>,
    // Whether the startup screen's chime may sound. Both the startup screen
    // that plays it and the Profile switch that sets it read the same answer
    // from the shell, which is the only place either of them can share.
    getStartupSound: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getStartupSound) as Promise<boolean>,
    // Playback is granted once per launch, only to the current startup page.
    claimStartupSound: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.claimStartupSound) as Promise<boolean>,
    /** Resolves false when the choice could not be written down. */
    setStartupSound: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.setStartupSound, enabled) as Promise<boolean>,
    // The answer-location consent belongs to this installation. The actual
    // coordinates never cross this bridge; the renderer asks the device for a
    // fresh, coarse fix after restoring an enabled preference.
    getCurrentLocationPreference: (): Promise<boolean | null> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.getCurrentLocationPreference,
      ) as Promise<boolean | null>,
    /** Resolves false when the durable choice could not be written. */
    setCurrentLocationPreference: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.setCurrentLocationPreference,
        enabled,
      ) as Promise<boolean>,
    // While someone demonstrates a task they are working in another
    // application, so the recording indicator and the Finish button have to
    // float above it. The shell owns that window; the page asks for it by
    // session id and gets false back when the shell will not open one, which is
    // the signal the browser build uses to fall back to its in-page controller.
    openTeachController: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.openTeachController, sessionId) as Promise<boolean>,
    closeTeachController: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.closeTeachController) as Promise<boolean>,
    // Browser navigation. The shell owns the tabs of the window this page is
    // in; the page draws the strip from the state it is sent and asks for
    // changes by command. The state arrives whenever any of it changes, and
    // can be asked for outright on first paint.
    getBrowserSignIns: (): Promise<BrowserSignInsState> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getBrowserSignIns) as Promise<BrowserSignInsState>,
    openBrowserSignIn: (url?: string): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.openBrowserSignIn, url) as Promise<boolean>,
    resetBrowserSignIns: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.resetBrowserSignIns) as Promise<boolean>,
    /** The shell's ChatGPT tab for the OpenAI (web) provider, opened on demand. */
    chatgptWebTab: (request: ChatgptWebTabRequest): Promise<ChatgptWebTabResult> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.chatgptWebTab, request) as Promise<ChatgptWebTabResult>,
    getTabsState: (): Promise<TabsState> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getTabsState) as Promise<TabsState>,
    getBrowserTerminalAccess: (): Promise<{ port: number; token: string } | null> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getBrowserTerminalAccess) as Promise<{ port: number; token: string } | null>,
    spotifyRequest: (request: Record<string, unknown>): Promise<{ status: number; body: string }> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.spotifyRequest, request) as Promise<{ status: number; body: string }>,
    readTerminalData: (id: string, path: string): Promise<{ status: number; body: string }> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.readTerminalData, { id, path }) as Promise<{ status: number; body: string }>,
    cancelTerminalData: (id: string): void => { void ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.cancelTerminalData, id).catch(() => undefined); },
    textHighlightRequest: (body: string): Promise<{ status: number; body: string }> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.textHighlightRequest, body) as Promise<{ status: number; body: string }>,
    onTabsState: (listener: (state: TabsState) => void): (() => void) => {
      tabsListeners.add(listener);
      return () => tabsListeners.delete(listener);
    },
    onBrowserInlineAnswerState: (listener: (state: unknown) => void): (() => void) => {
      inlineStateListeners.add(listener); return () => inlineStateListeners.delete(listener);
    },
    onBrowserInlineAnswerAction: (listener: (action: unknown) => void): (() => void) => {
      inlineActionListeners.add(listener); return () => inlineActionListeners.delete(listener);
    },
    /** Resolves false when the window could not do what was asked. */
    tabs: (command: TabsCommand): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.tabsCommand, command) as Promise<boolean>,
    /** Send a page-local notice to the window-level host above every tab. */
    publishNotificationToast: (notice: DesktopNotificationToast): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.tabsCommand, {
        type: "notification-toast",
        notice,
      }) as Promise<boolean>,
    /** Listen inside the dedicated overlay renderer for page-local notices. */
    onNotificationToast: (
      listener: (notice: DesktopNotificationToast) => void,
    ): (() => void) => {
      notificationListeners.add(listener);
      return () => notificationListeners.delete(listener);
    },
    /** Replay the shell's current visibility before announcing any cards. */
    onNotificationOverlayVisibility: (listener: (visible: boolean) => void): (() => void) => {
      notificationVisibilityListeners.add(listener);
      listener(notificationOverlayVisible);
      return () => notificationVisibilityListeners.delete(listener);
    },
    /** Resize the native overlay to exactly its interactive card content. */
    resizeNotificationOverlay: (size: NotificationOverlaySize): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.tabsCommand, {
        type: "notification-overlay-resize",
        size,
      }) as Promise<boolean>,
    // The Profile switch for the tabs, held by the shell for the same reason
    // the startup sound is: it has to be known before any account is.
    getBrowserNavigation: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getBrowserNavigation) as Promise<boolean>,
    /** Resolves false when the choice could not be written down. */
    setBrowserNavigation: (enabled: boolean): Promise<boolean> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.setBrowserNavigation,
        enabled,
      ) as Promise<boolean>,
    // Bookmarks are kept by the shell so a development port change or a full
    // application restart cannot strand them in one renderer origin.
    getBrowserBookmarks: (ownerKey: string): Promise<BrowserBookmark[] | null> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.getBrowserBookmarks,
        ownerKey,
      ) as Promise<BrowserBookmark[] | null>,
    /** Resolves false when the complete bounded collection could not be written. */
    setBrowserBookmarks: (
      ownerKey: string,
      bookmarks: BrowserBookmark[],
    ): Promise<boolean> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.setBrowserBookmarks,
        ownerKey,
        bookmarks,
      ) as Promise<boolean>,
    getBrowserShortcuts: (ownerKey: string): Promise<BrowserBookmark[] | null> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getBrowserShortcuts, ownerKey) as Promise<BrowserBookmark[] | null>,
    setBrowserShortcuts: (ownerKey: string, shortcuts: BrowserBookmark[]): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.setBrowserShortcuts, ownerKey, shortcuts) as Promise<boolean>,
    getBrowserRecentSearches: (ownerKey: string): Promise<string[] | null> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getBrowserRecentSearches, ownerKey) as Promise<string[] | null>,
    getBrowserHistory: (): Promise<BrowserHistorySnapshot> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getBrowserHistory) as Promise<BrowserHistorySnapshot>,
    browserHistoryCommand: (command: BrowserHistoryCommand): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.browserHistoryCommand, command) as Promise<boolean>,
    onBrowserHistoryChanged: (listener: () => void): (() => void) => {
      historyListeners.add(listener);
      return () => { historyListeners.delete(listener); };
    },
    setBrowserRecentSearches: (ownerKey: string, searches: string[]): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.setBrowserRecentSearches, ownerKey, searches) as Promise<boolean>,
    getBrowserDownloads: (): Promise<BrowserDownloadsSnapshot> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getBrowserDownloads) as Promise<BrowserDownloadsSnapshot>,
    browserDownloadCommand: (command: BrowserDownloadCommand): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.browserDownloadCommand, command) as Promise<{ ok: boolean; error?: string }>,
    savePdfDownload: (request: SavePdfDownloadRequest): Promise<SavePdfDownloadResult> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.savePdfDownload, request) as Promise<SavePdfDownloadResult>,
    getDownloadSettings: (): Promise<DownloadSettingsState> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getDownloadSettings) as Promise<DownloadSettingsState>,
    setDownloadPrompt: (enabled: boolean): Promise<DownloadSettingsResult> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.setDownloadPrompt, enabled) as Promise<DownloadSettingsResult>,
    chooseDownloadDirectory: (): Promise<DownloadSettingsResult> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.chooseDownloadDirectory) as Promise<DownloadSettingsResult>,
    /** Open a produced folder in the file explorer, or reveal a produced file. */
    openLocalPath: (request: OpenLocalPathRequest): Promise<OpenLocalPathResult> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.openLocalPath,
        request,
      ) as Promise<OpenLocalPathResult>,
  };
}

export type BreadboardDesktopApi = ReturnType<typeof createDesktopApi>;

/** Runs in the page world; keep this function self-contained for serialization. */
export function installBackgroundReadPriority(): void {
  const host = window as typeof window & { __breadboardBackgroundReadPriority?: boolean };
  if (host.__breadboardBackgroundReadPriority ||
      !/^https?:$/.test(location.protocol) || !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname)) return;
  host.__breadboardBackgroundReadPriority = true;
  const nativeFetch = window.fetch;
  // Restored native views can report "visible" even when their tab is folded.
  // Use the shell's tab identity. Ordinary fetches have a higher Chromium
  // priority than async bootstrap scripts; a workspace full of polling tabs
  // can otherwise starve every script/PDF reader on the six HTTP/1 sockets.
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    if (document.documentElement?.dataset.desktopTabActive === "false" && init?.priority === undefined) {
      try {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.origin === location.origin && (method === "GET" || method === "HEAD")) {
          return nativeFetch.call(this, input, { ...init, priority: "low" });
        }
      } catch { /* Let fetch report malformed input with its normal semantics. */ }
    }
    // Preserve writes, streaming bodies, signals, credentials, explicit
    // priorities and external requests. No request is cancelled or deferred.
    return nativeFetch.call(this, input, init);
  };
}

/** Publish the native CAD navigation hint without requiring a dashboard rebuild.
 * Keep this self-contained: it runs in the renderer's isolated preload world.
 * It advertises only the canvas, never the surrounding chat or parameter UI.
 */
export function installCadNavigationHint(): () => void {
  const prefix = "Breadboard CAD | ";
  let point: { x: number; y: number } | null = null;
  let original = "";
  let published: string | null = null;
  const release = () => {
    if (published !== null && document.title === published) document.title = original;
    published = null;
  };
  const update = () => {
    const hit = point && document.elementFromPoint(point.x, point.y);
    const editing = document.activeElement?.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
    );
    if (!hit || hit.tagName !== "CANVAS" || !hit.closest('[aria-label="CAD viewer"]') ||
        !document.hasFocus() || document.hidden || editing) {
      release();
      return;
    }
    // Newer dashboard viewers can publish the same hint. Let their scoped
    // lifecycle own it rather than nesting prefixes or restoring their title.
    if (published === null && document.title.startsWith(prefix)) return;
    if (published === null || document.title !== published) original = document.title;
    published = prefix + (original || "Breadboard");
    if (document.title !== published) document.title = published;
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
    point = { x: event.clientX, y: event.clientY };
    update();
  };
  const leave = () => { point = null; release(); };
  document.addEventListener("pointermove", move, true);
  document.addEventListener("pointerdown", move, true);
  document.addEventListener("focusin", update);
  document.addEventListener("visibilitychange", leave);
  document.documentElement.addEventListener("pointerleave", leave);
  window.addEventListener("blur", leave);
  const timer = window.setInterval(update, 100);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerdown", move, true);
    document.removeEventListener("focusin", update);
    document.removeEventListener("visibilitychange", leave);
    document.documentElement.removeEventListener("pointerleave", leave);
    window.removeEventListener("blur", leave);
    release();
  };
}

if (typeof process !== "undefined" && typeof process.versions.electron === "string") {
  const electron = require("electron") as typeof import("electron");
  electron.contextBridge.exposeInMainWorld(
    "breadboardDesktop",
    createDesktopApi(electron.ipcRenderer as IpcRenderer),
  );
  void electron.webFrame.executeJavaScript(`(${installBackgroundReadPriority.toString()})()`)
    .catch(() => { /* A document replaced during preload needs no installation. */ });
  const installCadHint = () => {
    const dispose = installCadNavigationHint();
    window.addEventListener("pagehide", dispose, { once: true });
  };
  if (document.documentElement) installCadHint();
  else document.addEventListener("DOMContentLoaded", installCadHint, { once: true });
}
