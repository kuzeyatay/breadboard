import type { IpcRenderer } from "electron";
import type {
  BrowserBookmark,
  ClickyLaunchResult,
  ClickyLauncherState,
  DesktopNotificationToast,
  NotificationOverlaySize,
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
  getStartupSound: "breadboard:get-startup-sound",
  setStartupSound: "breadboard:set-startup-sound",
  getCurrentLocationPreference: "breadboard:get-current-location-preference",
  setCurrentLocationPreference: "breadboard:set-current-location-preference",
  startupContinue: "breadboard:startup-continue",
  startupAwaitDashboard: "breadboard:startup-await-dashboard",
  startupState: "breadboard:startup-state",
  openTeachController: "breadboard:open-teach-controller",
  closeTeachController: "breadboard:close-teach-controller",
  getTabsState: "breadboard:get-tabs-state",
  tabsCommand: "breadboard:tabs-command",
  tabsState: "breadboard:tabs-state",
  notificationToast: "breadboard:notification-toast",
  getBrowserNavigation: "breadboard:get-browser-navigation",
  setBrowserNavigation: "breadboard:set-browser-navigation",
  getBrowserBookmarks: "breadboard:get-browser-bookmarks",
  setBrowserBookmarks: "breadboard:set-browser-bookmarks",
  getBrowserShortcuts: "breadboard:get-browser-shortcuts",
  setBrowserShortcuts: "breadboard:set-browser-shortcuts",
  getClickyState: "breadboard:get-clicky-state",
  launchClicky: "breadboard:launch-clicky",
  openClickyProject: "breadboard:open-clicky-project",
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
  ipcRenderer.on(PRELOAD_IPC_CHANNELS.tabsState, (_event, state) => {
    for (const listener of tabsListeners) listener(state as TabsState);
  });
  const notificationListeners = new Set<(notice: DesktopNotificationToast) => void>();
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
    // finished app. Always resolves — the shell caps the wait rather than
    // reporting failure.
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
    // Whether the startup screen's chime may sound. Both the startup screen
    // that plays it and the Profile switch that sets it read the same answer
    // from the shell, which is the only place either of them can share.
    getStartupSound: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getStartupSound) as Promise<boolean>,
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
    getTabsState: (): Promise<TabsState> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.getTabsState) as Promise<TabsState>,
    onTabsState: (listener: (state: TabsState) => void): (() => void) => {
      tabsListeners.add(listener);
      return () => tabsListeners.delete(listener);
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
    /** Readiness for the native macOS Clicky companion. */
    getClickyState: (): Promise<ClickyLauncherState> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.getClickyState,
      ) as Promise<ClickyLauncherState>,
    /** Launch the built Clicky app without accepting a renderer-supplied path. */
    launchClicky: (): Promise<ClickyLaunchResult> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.launchClicky,
      ) as Promise<ClickyLaunchResult>,
    /** Open the cloned Xcode project when Clicky still needs its first build. */
    openClickyProject: (): Promise<ClickyLaunchResult> =>
      ipcRenderer.invoke(
        PRELOAD_IPC_CHANNELS.openClickyProject,
      ) as Promise<ClickyLaunchResult>,
  };
}

export type BreadboardDesktopApi = ReturnType<typeof createDesktopApi>;

if (typeof process !== "undefined" && typeof process.versions.electron === "string") {
  const electron = require("electron") as typeof import("electron");
  electron.contextBridge.exposeInMainWorld(
    "breadboardDesktop",
    createDesktopApi(electron.ipcRenderer as IpcRenderer),
  );
}
