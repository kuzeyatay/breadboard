import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('voiceCompanion', {
  state: () => ipcRenderer.invoke('breadboard:voice-state'),
  conversation: () => ipcRenderer.invoke('breadboard:voice-conversation'),
  open: () => ipcRenderer.invoke('breadboard:voice-show'),
  close: () => ipcRenderer.invoke('breadboard:voice-hide'),
  setMinimized: (minimized: boolean) => ipcRenderer.invoke('breadboard:voice-minimize', minimized),
  onMinimized: (callback: (minimized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, minimized: boolean) => callback(minimized);
    ipcRenderer.on('breadboard:voice-minimized', listener);
    return () => ipcRenderer.removeListener('breadboard:voice-minimized', listener);
  },
  getScreenContextAccess: () => ipcRenderer.invoke('breadboard:voice-screen-context'),
  ready: () => ipcRenderer.invoke('breadboard:voice-ready'),
  onOpen: (callback: (open: boolean, conversationKey?: string | null) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, open: boolean, conversationKey?: string | null) => callback(open, conversationKey);
    ipcRenderer.on('breadboard:voice-open', listener);
    return () => ipcRenderer.removeListener('breadboard:voice-open', listener);
  },
  onNotification: (callback: (notice: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, notice: unknown) => callback(notice);
    ipcRenderer.on('breadboard:voice-notification', listener);
    return () => ipcRenderer.removeListener('breadboard:voice-notification', listener);
  },
});
