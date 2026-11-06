import { contextBridge, ipcRenderer } from "electron";
import type { TabsCommand, TabsState } from "../shared/ipc-contract";

let state: TabsState | undefined;
const listeners = new Set<(value: TabsState) => void>();
ipcRenderer.on("breadboard:tabs-state", (_event, value: TabsState) => {
  state = value;
  for (const listener of listeners) listener(value);
});
ipcRenderer.on("breadboard:shell-event", (_event, name: string, detail: unknown) => {
  window.dispatchEvent(new CustomEvent(name, { detail }));
});

// This renderer has no general IPC, process, filesystem, terminal, or service
// access. Its main-frame endpoint validates both the command and its target.
contextBridge.exposeInMainWorld("breadboardDesktop", {
  getTabsState: () => ipcRenderer.invoke("breadboard:shell-state"),
  onTabsState: (listener: (value: TabsState) => void) => {
    listeners.add(listener);
    if (state) listener(state);
    return () => listeners.delete(listener);
  },
  tabs: (command: TabsCommand & { targetTabId?: number; generation?: number; presentationRevision?: number }) => {
    const tab = state?.tabs.find(tab => tab.id === state?.activeId);
    return ipcRenderer.invoke("breadboard:shell-command", {
      command, targetId: command.targetTabId ?? tab?.id,
      generation: command.generation ?? tab?.generation,
      revision: command.presentationRevision ?? state?.presentationRevision,
    });
  },
  getBrowserBookmarks: (owner: string) => ipcRenderer.invoke("breadboard:get-browser-bookmarks", owner),
  setBrowserBookmarks: (owner: string, items: unknown) => ipcRenderer.invoke("breadboard:set-browser-bookmarks", owner, items),
  getBrowserRecentSearches: (owner: string) => ipcRenderer.invoke("breadboard:get-browser-recent-searches", owner),
  setBrowserRecentSearches: (owner: string, items: unknown) => ipcRenderer.invoke("breadboard:set-browser-recent-searches", owner, items),
  getBrowserHistory: () => ipcRenderer.invoke("breadboard:get-browser-history"),
  browserHistoryCommand: (command: unknown) => ipcRenderer.invoke("breadboard:browser-history-command", command),
  browserDownloadCommand: (command: unknown) => ipcRenderer.invoke("breadboard:browser-download-command", command),
  getBrowserSuggestions: (query: string) => ipcRenderer.invoke("breadboard:shell-suggestions", query),
  getBrowserDownloads: () => ipcRenderer.invoke("breadboard:get-browser-downloads"),
  onBrowserDownloads: (listener: (value: unknown) => void) => {
    const receive = (_event: unknown, value: unknown) => listener(value);
    ipcRenderer.on("breadboard:browser-downloads", receive);
    return () => ipcRenderer.removeListener("breadboard:browser-downloads", receive);
  },
});
