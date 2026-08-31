import type { IpcRenderer } from "electron";
import type { WindowThemeSchedule } from "../shared/ipc-contract";

export const PRELOAD_IPC_CHANNELS = {
  getVersions: "breadboard:get-versions",
  getStartupState: "breadboard:get-startup-state",
  retryService: "breadboard:retry-service",
  openLogs: "breadboard:open-logs",
  copyDiagnostics: "breadboard:copy-diagnostics",
  quit: "breadboard:quit",
  pickFolder: "breadboard:pick-folder",
  openMicrophoneSettings: "breadboard:open-microphone-settings",
  allowThemeLocation: "breadboard:allow-theme-location",
  setTheme: "breadboard:set-theme",
  getStartupSound: "breadboard:get-startup-sound",
  setStartupSound: "breadboard:set-startup-sound",
  startupContinue: "breadboard:startup-continue",
  startupAwaitDashboard: "breadboard:startup-await-dashboard",
  startupState: "breadboard:startup-state",
  openTeachController: "breadboard:open-teach-controller",
  closeTeachController: "breadboard:close-teach-controller",
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
    // While someone demonstrates a task they are working in another
    // application, so the recording indicator and the Finish button have to
    // float above it. The shell owns that window; the page asks for it by
    // session id and gets false back when the shell will not open one, which is
    // the signal the browser build uses to fall back to its in-page controller.
    openTeachController: (sessionId: string): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.openTeachController, sessionId) as Promise<boolean>,
    closeTeachController: (): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.closeTeachController) as Promise<boolean>,
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
