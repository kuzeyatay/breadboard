import { contextBridge, ipcRenderer } from "electron";
import type { BrowserDownloadCommand, TabsCommand, TabsState } from "../shared/ipc-contract";

// The offline card only exposes download actions and its own sizing/close
// commands. It needs neither a workspace connection nor the general preload.
contextBridge.exposeInMainWorld("breadboardDesktop", {
  getTabsState: () => ipcRenderer.invoke("breadboard:downloads-state"),
  onTabsState: (listener: (state: TabsState) => void) => {
    const receive = (_event: unknown, state: TabsState) => listener(state);
    ipcRenderer.on("breadboard:tabs-state", receive);
    return () => ipcRenderer.removeListener("breadboard:tabs-state", receive);
  },
  tabs: (command: TabsCommand) => ipcRenderer.invoke("breadboard:downloads-command", command),
  getBrowserDownloads: () => ipcRenderer.invoke("breadboard:get-browser-downloads"),
  browserDownloadCommand: (command: BrowserDownloadCommand) => ipcRenderer.invoke("breadboard:browser-download-command", command),
});
