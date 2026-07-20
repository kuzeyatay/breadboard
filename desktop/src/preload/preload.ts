import { contextBridge, ipcRenderer } from "electron";

/**
 * Narrow, typed desktop API. No command execution, no filesystem access, no
 * secrets. Only startup/diagnostic state and a few explicit operator actions.
 */
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

const startupListeners = new Set<(state: StartupStateView) => void>();
ipcRenderer.on("breadboard:startup-state", (_event, state: StartupStateView) => {
  for (const listener of startupListeners) listener(state);
});

const api = {
  /** App + shell version info (no paths, no secrets). */
  getVersions: (): Promise<{ app: string; electron: string }> =>
    ipcRenderer.invoke("breadboard:get-versions") as Promise<{ app: string; electron: string }>,
  /** Subscribe to startup/service state updates. Returns unsubscribe. */
  onStartupState: (listener: (state: StartupStateView) => void): (() => void) => {
    startupListeners.add(listener);
    return () => startupListeners.delete(listener);
  },
  /** Current startup state snapshot. */
  getStartupState: (): Promise<StartupStateView> =>
    ipcRenderer.invoke("breadboard:get-startup-state") as Promise<StartupStateView>,
  /** Retry a failed service by id (validated in main). */
  retryService: (serviceId: string): Promise<boolean> =>
    ipcRenderer.invoke("breadboard:retry-service", serviceId) as Promise<boolean>,
  /** Open the logs folder in the OS file manager. */
  openLogsFolder: (): Promise<void> =>
    ipcRenderer.invoke("breadboard:open-logs") as Promise<void>,
  /** Copy redacted diagnostics to the clipboard. */
  copyDiagnostics: (): Promise<void> =>
    ipcRenderer.invoke("breadboard:copy-diagnostics") as Promise<void>,
  /** Quit the app (services are shut down by the main process). */
  quit: (): Promise<void> => ipcRenderer.invoke("breadboard:quit") as Promise<void>,
  /**
   * Native folder picker for OpenHarness filesystem grants. Returns the
   * selected directory's canonical path, or null if cancelled. The desktop
   * shell only picks and normalizes the path — persisting the grant, scoping,
   * audit and revocation all stay in Breadboard's existing
   * /api/openharness/filesystem-grants flow.
   */
  pickFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("breadboard:pick-folder") as Promise<string | null>,
};

export type BreadboardDesktopApi = typeof api;

contextBridge.exposeInMainWorld("breadboardDesktop", api);
