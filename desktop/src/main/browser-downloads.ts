import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { DownloadItem, Session } from "electron";
import type { BrowserDownload, BrowserDownloadCommand, BrowserDownloadsSnapshot } from "../shared/ipc-contract";
import { atomicWriteFile } from "./runtime-config";

export const BROWSER_DOWNLOADS_FILE = "browser-downloads.json";

interface FileActions {
  openPath(path: string): Promise<string>;
  showItemInFolder(path: string): void;
}

function isDownload(value: unknown): value is BrowserDownload {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 100 &&
    typeof item.filename === "string" && typeof item.url === "string" &&
    typeof item.savePath === "string" && (!item.savePath || path.isAbsolute(item.savePath)) &&
    typeof item.active === "boolean" &&
    ["progressing", "completed", "cancelled", "interrupted"].includes(String(item.state)) &&
    [item.startedAt, item.receivedBytes, item.totalBytes].every(value =>
      typeof value === "number" && Number.isFinite(value) && value >= 0);
}

/** One durable download collection for the built-in browser's Chromium profile. */
export class BrowserDownloads {
  private items: BrowserDownload[] = [];
  private readonly live = new Map<string, DownloadItem>();
  private readonly sessions = new Set<Session>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writable = true;
  private error: string | null = null;
  private quitting = false;

  constructor(
    private readonly configDir: string,
    private readonly files: FileActions,
    private readonly log: (message: string) => void = () => {},
  ) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(configDir, BROWSER_DOWNLOADS_FILE), "utf8"));
      if (saved?.version !== 1 || !Array.isArray(saved.items) || !saved.items.every(isDownload) ||
          new Set(saved.items.map((item: BrowserDownload) => item.id)).size !== saved.items.length) {
        throw new Error("Invalid downloads file");
      }
      this.items = saved.items.map((item: BrowserDownload) => ({
        ...item, active: false,
        state: item.active || item.state === "progressing" ? "interrupted" : item.state,
      }));
      if (saved.items.some((item: BrowserDownload) => item.active || item.state === "progressing")) this.flush();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      // Keep an unreadable file intact rather than replacing the user's history.
      this.writable = false;
      this.error = "Couldn’t load saved downloads. New downloads may not be saved.";
      this.log(`Could not read browser downloads: ${String(error)}`);
    }
  }

  snapshot(): BrowserDownloadsSnapshot {
    return { items: this.items.map(item => ({ ...item })), error: this.error };
  }

  flush(): boolean {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.writable) return false;
    try {
      atomicWriteFile(path.join(this.configDir, BROWSER_DOWNLOADS_FILE), JSON.stringify({ version: 1, items: this.items }));
      this.error = null;
      return true;
    } catch (error) {
      this.error = "Couldn’t save the download list. Check available disk space.";
      this.log(`Could not save browser downloads: ${String(error)}`);
      return false;
    }
  }

  attach(browserSession: Session): void {
    if (this.sessions.has(browserSession)) return;
    this.sessions.add(browserSession);
    browserSession.on("will-download", (_event, item) => this.track(item));
  }

  prepareForQuit(): void {
    this.quitting = true;
    for (const entry of this.items) {
      if (!entry.active) continue;
      entry.active = false;
      entry.state = "interrupted";
    }
    this.flush();
  }

  private track(item: DownloadItem): void {
    const id = randomUUID();
    const entry: BrowserDownload = {
      id, filename: item.getFilename(), url: item.getURL(), savePath: item.getSavePath(),
      startedAt: Date.now(), receivedBytes: item.getReceivedBytes(), totalBytes: Math.max(0, item.getTotalBytes()),
      state: "progressing", active: true,
    };
    this.live.set(id, item);
    this.items.unshift(entry);
    this.flush();
    const update = (state: BrowserDownload["state"], done: boolean) => {
      // Chromium cancels downloads while the app tears down. Preserve the
      // distinction between a restart and the person's explicit Cancel action.
      if (this.quitting) return;
      entry.state = state;
      entry.active = !done;
      entry.savePath = item.getSavePath();
      entry.filename = item.getFilename();
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = Math.max(0, item.getTotalBytes());
      if (done) {
        this.live.delete(id);
        this.flush();
      } else if (!this.timer) {
        // Keep progress live in memory; bound disk writes during large downloads.
        this.timer = setTimeout(() => this.flush(), 1_000);
        this.timer.unref();
      }
    };
    item.on("updated", (_event, state) => update(state, false));
    item.once("done", (_event, state) => update(state, true));
  }

  async command(command: BrowserDownloadCommand): Promise<{ ok: boolean; error?: string }> {
    try {
      if (command.type === "clear" || command.type === "remove") {
        const previous = this.items;
        this.items = previous.filter(item => item.active || (command.type === "remove" && item.id !== command.id));
        if (!this.flush()) {
          this.items = previous;
          return { ok: false, error: this.error ?? "Couldn’t update downloads." };
        }
        return { ok: true };
      }
      const entry = this.items.find(item => item.id === command.id);
      if (!entry) return { ok: false, error: "This download is no longer in the list." };
      if (command.type === "cancel") {
        const item = this.live.get(entry.id);
        if (!item) return { ok: false, error: "This download has already stopped." };
        item.cancel();
        return { ok: true };
      }
      if (command.type === "open" && entry.state !== "completed") {
        return { ok: false, error: "This download hasn’t completed." };
      }
      // Accept only IDs from the renderer; paths always come from Electron's
      // download record. Removing history never removes the downloaded file.
      if (!entry.savePath || !fs.existsSync(entry.savePath) || !fs.statSync(entry.savePath).isFile()) {
        return { ok: false, error: "This file was moved or deleted." };
      }
      if (command.type === "show") this.files.showItemInFolder(entry.savePath);
      else {
        const error = await this.files.openPath(entry.savePath);
        if (error) return { ok: false, error: "Couldn’t open this file. Try showing it in its folder." };
      }
      return { ok: true };
    } catch (error) {
      this.log(`Browser download action failed: ${String(error)}`);
      return { ok: false, error: "Couldn’t update this download. Try again." };
    }
  }
}
