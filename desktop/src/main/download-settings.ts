import * as fs from "node:fs";
import * as path from "node:path";
import type { DownloadItem, IpcMain, IpcMainInvokeEvent, Session } from "electron";
import { IPC_CHANNELS, type DownloadSettingsState, type DownloadSettingsResult } from "../shared/ipc-contract";
import { atomicWriteFile } from "./runtime-config";

export const DOWNLOAD_SETTINGS_FILE = "download-settings.json";

/** Shared by regular downloads and PDF exports, across windows and restarts. */
export class DownloadSettings {
  private state: DownloadSettingsState;
  private readonly sessions = new WeakSet<Session>();
  private readonly destinations = new Set<string>();

  constructor(private readonly configDir: string, defaultDirectory: string,
    private readonly log: (message: string) => void = () => {}) {
    this.state = { directory: defaultDirectory, askWhereToSave: false };
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(configDir, DOWNLOAD_SETTINGS_FILE), "utf8"));
      if (typeof saved.directory === "string" && path.isAbsolute(saved.directory)) this.state.directory = saved.directory;
      if (typeof saved.askWhereToSave === "boolean") this.state.askWhereToSave = saved.askWhereToSave;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.log(`Could not read download settings: ${String(error)}`);
    }
  }

  read(): DownloadSettingsState { return { ...this.state }; }

  private save(next: DownloadSettingsState): DownloadSettingsState {
    atomicWriteFile(path.join(this.configDir, DOWNLOAD_SETTINGS_FILE), JSON.stringify(next));
    this.state = next;
    return this.read();
  }

  setAskWhereToSave(enabled: boolean): DownloadSettingsState {
    return this.save({ ...this.state, askWhereToSave: enabled });
  }

  setDirectory(directory: string): DownloadSettingsState {
    if (!path.isAbsolute(directory) || !fs.statSync(directory).isDirectory()) throw new Error("Invalid download folder.");
    fs.accessSync(directory, fs.constants.W_OK);
    return this.save({ ...this.state, directory });
  }

  attach(session: Session): void {
    if (this.sessions.has(session)) return;
    this.sessions.add(session);
    session.on("will-download", (_event, item) => this.configure(item));
  }

  private configure(item: DownloadItem): void {
    // Other native download flows may already own an explicit destination.
    if (item.getSavePath()) return;
    const filename = path.basename(item.getFilename().replace(/\\/g, "/"))
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/, "") || "download";
    const safeName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ? `_${filename}` : filename;
    const { directory, askWhereToSave } = this.read();
    const defaultPath = path.join(directory, safeName);
    item.setSaveDialogOptions({ defaultPath });
    if (askWhereToSave) return;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.accessSync(directory, fs.constants.W_OK);
      const ext = path.extname(safeName);
      const stem = safeName.slice(0, safeName.length - ext.length);
      for (let suffix = 0; suffix < 10_000; suffix++) {
        const destination = path.join(directory, suffix ? `${stem} (${suffix})${ext}` : safeName);
        const key = process.platform === "win32" ? destination.toLowerCase() : destination;
        if (this.destinations.has(key)) continue;
        let reservation: fs.Stats;
        try {
          // Reserve atomically, including against simultaneous PDF exports and
          // dangling symlinks. Chromium writes to the path we have just created.
          const descriptor = fs.openSync(destination, "wx", 0o600);
          try { reservation = fs.fstatSync(descriptor); }
          finally { fs.closeSync(descriptor); }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
          throw error;
        }
        const clearEmptyReservation = () => {
          try {
            const remaining = fs.lstatSync(destination);
            if (remaining.ino === reservation.ino && remaining.dev === reservation.dev && remaining.size === 0) fs.unlinkSync(destination);
          } catch { /* Chromium may already have removed a cancelled download. */ }
        };
        try { item.setSavePath(destination); }
        catch (error) { clearEmptyReservation(); throw error; }
        this.destinations.add(key);
        item.once("done", (_event, state) => {
          this.destinations.delete(key);
          if (state !== "completed") clearEmptyReservation();
        });
        return;
      }
      throw new Error("No unused download name is available.");
    } catch (error) {
      // Keep Electron's native picker available if the saved folder is unavailable.
      this.log(`Could not use the download folder; asking for a destination: ${String(error)}`);
    }
  }
}

export function registerDownloadSettingsHandlers(ipc: Pick<IpcMain, "handle">, options: {
  settings: DownloadSettings;
  trusted: (event: IpcMainInvokeEvent) => boolean;
  chooseDirectory: (event: IpcMainInvokeEvent, current: string) => Promise<string | null>;
}): void {
  ipc.handle(IPC_CHANNELS.getDownloadSettings, event => {
    if (!options.trusted(event)) throw new Error("Download settings are only available in Breadboard.");
    return options.settings.read();
  });
  ipc.handle(IPC_CHANNELS.setDownloadPrompt, (event, enabled: unknown): DownloadSettingsResult => {
    if (!options.trusted(event) || typeof enabled !== "boolean") return { ok: false, error: "Invalid download preference." };
    try { return { ok: true, settings: options.settings.setAskWhereToSave(enabled) }; }
    catch { return { ok: false, error: "Could not save the download preference. Try again." }; }
  });
  ipc.handle(IPC_CHANNELS.chooseDownloadDirectory, async (event): Promise<DownloadSettingsResult> => {
    if (!options.trusted(event)) return { ok: false, error: "Download settings are only available in Breadboard." };
    try {
      const directory = await options.chooseDirectory(event, options.settings.read().directory);
      return { ok: true, settings: directory === null ? options.settings.read() : options.settings.setDirectory(directory) };
    } catch { return { ok: false, error: "Could not save that download folder. Check folder access and try again." }; }
  });
}
