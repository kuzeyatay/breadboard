import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("breadboardFind", {
  search: (text: string, forward = true, findNext = false) => ipcRenderer.send("breadboard:find-command", { type: "browser-find", text, forward, findNext }),
  close: () => ipcRenderer.send("breadboard:find-command", { type: "browser-find-close" }),
  onResult: (callback: (result?: { matches: number; activeMatchOrdinal: number }) => void) => {
    ipcRenderer.on("breadboard:find-result", (_event, result) => callback(result));
  },
  onFocus: (callback: () => void) => { ipcRenderer.on("breadboard:find-focus", () => callback()); },
});
