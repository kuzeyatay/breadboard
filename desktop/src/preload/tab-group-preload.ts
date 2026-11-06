import { contextBridge, ipcRenderer } from "electron";
import type { TabsCommand, TabsState } from "../shared/ipc-contract";

// The local menu only needs group commands and the window's current tab state.
contextBridge.exposeInMainWorld("breadboardDesktop", {
  getTabsState: () => ipcRenderer.invoke("breadboard:group-state"),
  onTabsState: (listener: (state: TabsState) => void) => {
    const receive = (_event: unknown, state: TabsState) => listener(state);
    ipcRenderer.on("breadboard:tabs-state", receive);
    return () => ipcRenderer.removeListener("breadboard:tabs-state", receive);
  },
  tabs: (command: TabsCommand) => ipcRenderer.invoke("breadboard:group-command", command),
});
