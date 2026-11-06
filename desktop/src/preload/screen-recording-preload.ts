import { contextBridge, ipcRenderer } from "electron";

let channel: string | undefined;
contextBridge.exposeInMainWorld("recordingHost", {
  configure(value: string) {
    if (channel || !/^breadboard:screen-recording:\d+$/.test(value)) throw new Error("Invalid recorder channel.");
    channel = value;
  },
  send(kind: string, data?: unknown) {
    if (!channel) throw new Error("Recorder is not configured.");
    return ipcRenderer.invoke(channel, kind, data);
  },
});
