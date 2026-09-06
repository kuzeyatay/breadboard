import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('voiceCompanion', {
  state: () => ipcRenderer.invoke('breadboard:voice-state'),
  open: () => ipcRenderer.invoke('breadboard:voice-show'),
  close: () => ipcRenderer.invoke('breadboard:voice-hide'),
  onOpen: (callback: (open: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, open: boolean) => callback(open);
    ipcRenderer.on('breadboard:voice-open', listener);
    return () => ipcRenderer.removeListener('breadboard:voice-open', listener);
  },
  onNotification: (callback: (notice: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, notice: unknown) => callback(notice);
    ipcRenderer.on('breadboard:voice-notification', listener);
    return () => ipcRenderer.removeListener('breadboard:voice-notification', listener);
  },
});
