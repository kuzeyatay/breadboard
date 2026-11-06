import { BrowserWindow, desktopCapturer, ipcMain, Menu, nativeImage, screen, session, Tray, type WebContents } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

const CHANNEL = "breadboard:screen-recording";
const MAX_BYTES = 100 * 1024 * 1024;
export interface RecordingResult {
  id: string; state: "starting" | "recording" | "stopping" | "complete" | "failed";
  sourceId: string; startedAt: string; durationSeconds: number; maxDurationSeconds: number;
  bytes: number; filename?: string; mimeType?: string; error?: string;
}
interface Recording {
  owner: string; result: RecordingResult; window: BrowserWindow;
  file?: fs.FileHandle; ready: Promise<void>; resolveReady: () => void; rejectReady: (e: Error) => void;
  done: Promise<void>; resolveDone: () => void; finishing?: Promise<void>;
  deadline?: ReturnType<typeof setTimeout>; watchdog?: ReturnType<typeof setTimeout>;
  tray?: Tray; writing: Promise<void>; started: number; releaseSource?: () => void;
}
interface RecordingTab { contents: WebContents; prepare: () => Promise<() => void> }

/** Runs only in our isolated, hidden recorder document, never in a user tab. */
export async function recordScreen(duration: number, fps: number): Promise<void> {
  const host = window as unknown as {
    recordingHost: { send: (kind: string, data?: unknown) => Promise<void> };
    stopScreenRecording?: () => void;
  };
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chunks = Promise.resolve();
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    const mimeType = ["video/mp4;codecs=avc1.42001E", "video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("This desktop runtime cannot encode screen video.");
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
    host.stopScreenRecording = () => { if (recorder?.state !== "inactive") recorder?.stop(); };
    recorder.ondataavailable = event => {
      if (event.data.size) chunks = chunks.then(async () => host.recordingHost.send("chunk", await event.data.arrayBuffer()));
      void chunks.catch(() => host.stopScreenRecording?.());
    };
    recorder.onerror = () => { void host.recordingHost.send("error", "Screen video encoding failed."); host.stopScreenRecording?.(); };
    recorder.onstop = () => {
      clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
      void chunks.then(() => host.recordingHost.send("finished"), () => host.recordingHost.send("error", "The recording could not be saved."));
    };
    stream.getVideoTracks()[0]!.onended = () => host.stopScreenRecording?.();
    await host.recordingHost.send("format", mimeType);
    recorder.start(1000);
    timer = setTimeout(() => host.stopScreenRecording?.(), duration * 1000);
    await host.recordingHost.send("ready");
  } catch (error) {
    clearTimeout(timer);
    stream?.getTracks().forEach(track => track.stop());
    await host.recordingHost.send("error", error instanceof Error ? error.message : "Screen recording failed.");
  }
}

/** One bounded recorder, owned by the authenticated agent run. No external
 * processes, foreground windows, microphone capture, or persistent permissions. */
export class ScreenRecordingManager {
  private active?: Recording;
  private records = new Map<string, Recording>();
  private closed = false;
  private readonly directory: string;
  constructor(dataRoot: string, private tabs: () => RecordingTab[] = () => []) {
    this.directory = path.join(dataRoot, "screen-recordings");
  }

  owners(): string[] { return [...new Set([...this.records.values()].map(record => record.owner))]; }

  async sources() {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
    return [
      ...sources.map(source => ({ id: source.id, name: source.name, kind: source.id.startsWith("screen:") ? "screen" : "window", displayId: source.display_id,
        primary: source.display_id === String(screen.getPrimaryDisplay().id) })),
      ...this.tabs().map(tab => ({ id: `tab:${tab.contents.id}`, name: tab.contents.getTitle(), kind: "tab", displayId: "", primary: false })),
    ];
  }

  async start(owner: string, args: Record<string, unknown>): Promise<RecordingResult> {
    if (this.closed) throw new Error("The screen recorder is shutting down.");
    if (this.active) throw new Error("A screen recording is already running. Stop it before starting another.");
    const duration = args.durationSeconds ?? 30;
    const fps = args.fps ?? 15;
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 120) throw new Error("Choose durationSeconds from 1 to 120.");
    if (typeof fps !== "number" || !Number.isInteger(fps) || fps < 1 || fps > 30) throw new Error("Choose fps from 1 to 30.");
    if (typeof args.sourceId !== "string") throw new Error("Choose a sourceId from recording_sources.");
    const id = randomUUID();
    const isolatedSession = session.fromPartition(`screen-recording-${id}`);
    const window = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true, width: 320, height: 200,
      webPreferences: { session: isolatedSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false, preload: path.join(__dirname, "../preload/screen-recording-preload.js") } });
    let resolveReady!: () => void, rejectReady!: (e: Error) => void, resolveDone!: () => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => {});
    const record: Recording = { owner, window, ready, resolveReady, rejectReady,
      done: new Promise<void>(resolve => { resolveDone = resolve; }), resolveDone: () => resolveDone(), writing: Promise.resolve(), started: 0,
      result: { id, state: "starting", sourceId: args.sourceId, startedAt: "", durationSeconds: 0, maxDurationSeconds: duration, bytes: 0 } };
    this.active = record;
    this.records.set(id, record);
    // Bound completed receipts in memory. Files remain available until claimed
    // by the chat artifact importer or discarded with their owning run.
    for (const [key, value] of this.records) if (this.records.size > 32 && value !== this.active) { void this.removeFile(value); this.records.delete(key); }
    const channel = `${CHANNEL}:${window.webContents.id}`;
    ipcMain.handle(channel, async (event, kind: string, data: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || record.finishing) throw new Error("Recorder is unavailable.");
      if (kind === "format") {
        if (record.file || typeof data !== "string" || !/^video\/(mp4|webm)(;|$)/.test(data)) throw new Error("Invalid recording format.");
        record.result.mimeType = data.split(";")[0];
        record.result.filename = `${id}.${data.startsWith("video/mp4") ? "mp4" : "webm"}`;
        record.writing = record.writing.then(async () => {
          await fs.mkdir(this.directory, { recursive: true });
          record.file = await fs.open(path.join(this.directory, record.result.filename!), "wx", 0o600);
        });
        await record.writing;
      } else if (kind === "ready") {
        if (!record.file || record.result.state !== "starting") throw new Error("Recorder was not initialized.");
        record.started = Date.now(); record.result.startedAt = new Date(record.started).toISOString(); record.result.state = "recording";
        record.resolveReady();
      } else if (kind === "chunk") {
        if (!record.file || !(data instanceof ArrayBuffer) || data.byteLength > 8 * 1024 * 1024 || record.result.bytes + data.byteLength > MAX_BYTES) {
          void this.finish(record, "The recording exceeded its file size limit."); throw new Error("Recording size limit reached.");
        }
        const buffer = Buffer.from(data);
        record.writing = record.writing.then(() => record.file!.writeFile(buffer));
        try { await record.writing; record.result.bytes += buffer.length; }
        catch { void this.finish(record, "The recording could not be written to disk."); throw new Error("Could not save recording."); }
      } else if (kind === "finished") void this.finish(record);
      else if (kind === "error") void this.finish(record, typeof data === "string" ? data.slice(0, 200) : "Screen capture failed.");
      else throw new Error("Unknown recorder event.");
    });
    record.done.then(() => { ipcMain.removeHandler(channel); isolatedSession.setDisplayMediaRequestHandler(null); });
    isolatedSession.setDisplayMediaRequestHandler((request, callback) => {
      const deny = () => {
        try { callback({}); } catch { /* Electron 33 throws as well as denying a missing video source. */ }
        void this.finish(record, "The capture source is unavailable or screen capture permission was denied.");
      };
      if (request.frame !== window.webContents.mainFrame || request.audioRequested || record.result.state !== "starting") { deny(); return; }
      const tab = this.tabs().find(tab => `tab:${tab.contents.id}` === record.result.sourceId);
      if (tab && !tab.contents.isDestroyed()) { callback({ video: tab.contents.mainFrame }); return; }
      void desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } }).then(sources => {
        const source = sources.find(source => source.id === record.result.sourceId);
        if (source && this.active === record) callback({ video: source }); else deny();
      }).catch(deny);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.webContents.once("render-process-gone", () => { void this.finish(record, "The screen recorder stopped unexpectedly."); });
    window.once("closed", () => { if (!record.finishing) void this.finish(record, "The screen recorder closed unexpectedly."); });
    record.watchdog = setTimeout(() => { void this.finish(record, "Screen recording did not start in time. Check screen capture permissions."); }, 10_000);
    try {
      const tab = this.tabs().find(tab => `tab:${tab.contents.id}` === record.result.sourceId);
      if (tab) {
        const release = await tab.prepare();
        if (record.finishing) release(); else record.releaseSource = release;
      }
      if (record.finishing || record.result.state !== "starting") throw new Error("Recording was cancelled during startup.");
      await window.loadFile(path.join(__dirname, "../screen-recording/index.html"));
      // A private renderer receives only this narrow IPC channel.
      await window.webContents.executeJavaScript(`window.recordingHost.configure(${JSON.stringify(channel)})`);
      void window.webContents.executeJavaScript(`(${recordScreen.toString()})(${duration}, ${fps})`, true).catch(() => this.finish(record, "The screen recorder could not initialize."));
      await ready;
      clearTimeout(record.watchdog);
      const pixels = Buffer.alloc(16 * 16 * 4);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x - 7.5) ** 2 + (y - 7.5) ** 2 <= 49) {
        const offset = (y * 16 + x) * 4; pixels[offset] = 50; pixels[offset + 1] = 50; pixels[offset + 2] = 230; pixels[offset + 3] = 255;
      }
      record.tray = new Tray(nativeImage.createFromBitmap(pixels, { width: 16, height: 16 }));
      record.tray.setToolTip("Breadboard is recording your screen");
      record.tray.setContextMenu(Menu.buildFromTemplate([{ label: "Stop screen recording", click: () => { void this.stop(owner, id); } }]));
      record.deadline = setTimeout(() => { void this.stop(owner, id); }, duration * 1000);
      return { ...record.result };
    } catch (error) {
      await this.finish(record, error instanceof Error ? error.message : "Screen recording could not start.");
      throw new Error(record.result.error);
    }
  }

  private owned(owner: string, id: unknown): Recording {
    const record = typeof id === "string" ? this.records.get(id) : undefined;
    if (!record || record.owner !== owner) throw new Error("Recording not found for this run. Use the recordingId returned by recording_start.");
    return record;
  }
  status(owner: string, id: unknown): RecordingResult {
    const record = this.owned(owner, id);
    return { ...record.result, durationSeconds: record.started && !record.finishing ? (Date.now() - record.started) / 1000 : record.result.durationSeconds };
  }
  async stop(owner: string, id: unknown): Promise<RecordingResult> {
    const record = this.owned(owner, id);
    if (!record.finishing && record.result.state !== "stopping") {
      record.result.state = "stopping";
      clearTimeout(record.watchdog);
      record.watchdog = setTimeout(() => { void this.finish(record, "The screen recorder did not finish saving."); }, 5_000);
      void record.window.webContents.executeJavaScript("window.stopScreenRecording?.()").catch(() => this.finish(record, "The screen recorder became unavailable."));
    }
    await record.done;
    return { ...record.result };
  }
  private finish(record: Recording, error?: string): Promise<void> {
    if (record.finishing) return record.finishing;
    record.finishing = Promise.resolve().then(async () => {
      clearTimeout(record.deadline); clearTimeout(record.watchdog); record.tray?.destroy();
      if (!record.window.isDestroyed()) record.window.destroy();
      try { record.releaseSource?.(); } catch { /* The captured tab may already have closed. */ }
      try { await record.writing; } catch { error ??= "The recording could not be saved."; }
      try { await record.file?.close(); } catch { error ??= "The recording could not be saved."; }
      error ??= record.result.bytes ? undefined : "No video frames were captured.";
      record.result.durationSeconds = record.started ? (Date.now() - record.started) / 1000 : 0;
      record.result.state = error ? "failed" : "complete";
      if (error) { record.result.error = error; await this.removeFile(record); }
      record.rejectReady(new Error(error ?? "Recording stopped before startup completed."));
      if (this.active === record) this.active = undefined;
      record.resolveDone();
    });
    return record.finishing;
  }
  private async removeFile(record: Recording) {
    if (record.result.filename) await fs.rm(path.join(this.directory, record.result.filename), { force: true }).catch(() => {});
  }
  async release(owner: string): Promise<void> {
    for (const [id, record] of this.records) if (record.owner === owner) {
      if (!record.finishing) await this.stop(owner, id);
      await record.done; await this.removeFile(record); this.records.delete(id);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const owner of new Set([...this.records.values()].map(record => record.owner))) await this.release(owner);
  }
}
