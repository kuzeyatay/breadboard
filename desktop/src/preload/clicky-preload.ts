// A sandboxed preload must be self-contained: Electron cannot require our other files here.
import { contextBridge, ipcRenderer } from "electron";

let shortcutAvailable = true;
ipcRenderer.on("breadboard:clicky-shortcut", (_event, available: boolean) => {
  shortcutAvailable = available;
});

contextBridge.exposeInMainWorld("clickyCompanion", {
  capture: () => ipcRenderer.invoke("breadboard:clicky-capture"),
  point: (target: unknown) => ipcRenderer.invoke("breadboard:clicky-point", target),
  click: () => ipcRenderer.invoke("breadboard:clicky-click"),
  resetTarget: () => ipcRenderer.invoke("breadboard:clicky-reset-target"),
  onToggleVoice: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("breadboard:clicky-toggle-voice", listener);
    return () => ipcRenderer.removeListener("breadboard:clicky-toggle-voice", listener);
  },
  onShortcut: (callback: (available: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, available: boolean) => callback(available);
    ipcRenderer.on("breadboard:clicky-shortcut", listener);
    callback(shortcutAvailable);
    return () => ipcRenderer.removeListener("breadboard:clicky-shortcut", listener);
  },
});
