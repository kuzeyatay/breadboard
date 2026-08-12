import type { IpcRenderer } from "electron";

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
  startupContinue: "breadboard:startup-continue",
  startupAwaitDashboard: "breadboard:startup-await-dashboard",
  startupState: "breadboard:startup-state",
} as const;

export interface StartupServiceView {
  id: string;
  displayName: string;
  required: boolean;
  state: string;
  lastError: string | null;
  restarts: number;
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
    setTheme: (surface: "light" | "dark" | "voice"): Promise<boolean> =>
      ipcRenderer.invoke(PRELOAD_IPC_CHANNELS.setTheme, surface) as Promise<boolean>,
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
