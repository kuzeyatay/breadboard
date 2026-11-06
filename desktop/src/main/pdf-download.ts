import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { IpcMain, WebContents } from "electron";
import { IPC_CHANNELS, type SavePdfDownloadRequest, type SavePdfDownloadResult } from "../shared/ipc-contract";

const MAX_PDF_BYTES = 128 * 1024 * 1024;

export function registerPdfDownloadHandler(ipc: Pick<IpcMain, "handle">, options: {
  ownsSender: (sender: WebContents) => boolean;
  dashboardUrl: () => string | null;
  downloadsDirectory: () => string;
  askWhereToSave?: () => boolean;
  chooseSavePath?: (sender: WebContents, defaultPath: string) => Promise<string | null>;
  onSaved: (savePath: string, sourceUrl: string) => void;
  log: (message: string) => void;
}): void {
  ipc.handle(IPC_CHANNELS.savePdfDownload, async (event, request: unknown) => {
    const sourceUrl = event.senderFrame?.url;
    const dashboardUrl = options.dashboardUrl();
    let trusted = false;
    try {
      trusted = Boolean(sourceUrl && dashboardUrl && options.ownsSender(event.sender) &&
        event.senderFrame === event.sender.mainFrame &&
        new URL(sourceUrl).origin === new URL(dashboardUrl).origin);
    } catch { /* A destroyed or invalid frame has no download authority. */ }
    if (!trusted) return { ok: false, error: "PDF downloads are only available in Breadboard." };
    const result = await savePdfToDownloads(options.downloadsDirectory(), request,
      options.askWhereToSave?.() && options.chooseSavePath
        ? defaultPath => options.chooseSavePath!(event.sender, defaultPath) : undefined);
    if (result.ok) {
      try { options.onSaved(result.savePath, sourceUrl!); }
      catch (error) { options.log(`Could not record saved PDF: ${String(error)}`); }
    }
    return result;
  });
}

function isPdfDownload(value: unknown): value is SavePdfDownloadRequest {
  if (!value || typeof value !== "object") return false;
  const { filename, data } = value as Record<string, unknown>;
  return typeof filename === "string" && filename.length > 4 && filename.length <= 180 &&
    filename === filename.trim() && !/[<>:"/\\|?*\x00-\x1f]/.test(filename) &&
    !filename.startsWith(".") && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(filename) &&
    /\.pdf$/i.test(filename) && data instanceof ArrayBuffer &&
    data.byteLength >= 5 && data.byteLength <= MAX_PDF_BYTES &&
    Buffer.from(data, 0, 5).toString("ascii") === "%PDF-";
}

/** Resolve only after all bytes are written, flushed, and the file is closed. */
export async function savePdfToDownloads(
  downloadsDirectory: string,
  request: unknown,
  chooseSavePath?: (defaultPath: string) => Promise<string | null>,
): Promise<SavePdfDownloadResult> {
  if (!isPdfDownload(request)) return { ok: false, error: "The PDF download is invalid." };
  let createdPath: string | undefined;
  try {
    if (chooseSavePath) {
      const savePath = await chooseSavePath(path.join(downloadsDirectory, request.filename));
      if (!savePath) return { ok: false, cancelled: true, error: "Download cancelled." };
      if (!path.isAbsolute(savePath)) throw new Error("Invalid download destination.");
      // The native picker authorizes replacing this exact file. Stage and flush
      // beside it first, so a failed export leaves an existing document intact.
      const temporary = path.join(path.dirname(savePath), `.breadboard-${randomUUID()}.tmp`);
      const file = await fs.open(temporary, "wx", 0o600);
      createdPath = temporary;
      try {
        await file.writeFile(Buffer.from(request.data));
        await file.sync();
      } finally { await file.close(); }
      await fs.rename(temporary, savePath);
      createdPath = undefined;
      return { ok: true, filename: path.basename(savePath), savePath };
    }
    await fs.mkdir(downloadsDirectory, { recursive: true });
    const base = request.filename.slice(0, -4);
    for (let suffix = 0; suffix < 10_000; suffix++) {
      const filename = suffix ? `${base} (${suffix}).pdf` : request.filename;
      const savePath = path.join(downloadsDirectory, filename);
      let file;
      try {
        // Exclusive creation also prevents concurrent exports from overwriting
        // one another or following an existing symlink at the destination.
        file = await fs.open(savePath, "wx", 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
      createdPath = savePath;
      try {
        await file.writeFile(Buffer.from(request.data));
        await file.sync();
      } finally {
        await file.close();
      }
      return { ok: true, filename, savePath };
    }
    throw new Error("No unused download name is available.");
  } catch {
    if (createdPath) await fs.unlink(createdPath).catch(() => {});
    return { ok: false, error: "Could not save the PDF to the download folder. Check folder access and available disk space, then try again." };
  }
}
