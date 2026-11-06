import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('breadboardDictation', {
  ready: () => ipcRenderer.invoke('breadboard:dictation-ready'),
  screenContext: (id: number) => ipcRenderer.invoke('breadboard:dictation-screen', id),
  report: (report: unknown) => ipcRenderer.send('breadboard:dictation-report', report),
  onCommand: (callback: (command: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown) => callback(command);
    ipcRenderer.on('breadboard:dictation-command', listener);
    return () => ipcRenderer.removeListener('breadboard:dictation-command', listener);
  },
});
