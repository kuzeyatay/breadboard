import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session, type DownloadItem, type Session } from "electron";
import { BROWSER_SOURCE_MAX_BYTES, BROWSER_SOURCE_TIMEOUT_MS, browserSourceFilename } from "./browser-source-download";
import { isInlinePdfResponse } from "./pdf-viewer-redirect";

export interface BrowserPdfOpen {
  dashboardUrl: string;
  signal: AbortSignal;
  complete(blobId: string, name: string): void;
  fail(error: unknown): void;
}

const viewerDownloads = new WeakSet<DownloadItem>();
export function isBrowserPdfHandoff(item: DownloadItem): boolean {
  return viewerDownloads.has(item);
}

async function storeDownload(item: DownloadItem, open: BrowserPdfOpen, name: string): Promise<void> {
  const file = join(tmpdir(), `breadboard-pdf-${randomUUID()}.pdf`);
  const signal = AbortSignal.any([open.signal, AbortSignal.timeout(BROWSER_SOURCE_TIMEOUT_MS)]);
  try {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => item.cancel();
      item.setSavePath(file);
      item.once("done", (_event, state) => {
        signal.removeEventListener("abort", cancel);
        if (state === "completed" && item.getReceivedBytes() <= BROWSER_SOURCE_MAX_BYTES) resolve();
        else reject(new Error(`PDF transfer ${state}.`));
      });
      item.on("updated", () => { if (item.getReceivedBytes() > BROWSER_SOURCE_MAX_BYTES) cancel(); });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
    signal.throwIfAborted();
    const body = await openAsBlob(file, { type: "application/pdf" });
    const response = await session.defaultSession.fetch(new URL("/api/chat-attachments/documents", open.dashboardUrl).href, {
      method: "POST", body, credentials: "include", redirect: "error", signal,
      headers: { "x-document-filename": encodeURIComponent(name), "x-document-store-only": "true" },
    });
    const result = await response.json() as { blobId?: unknown };
    if (!response.ok || typeof result.blobId !== "string") throw new Error(`Could not store PDF (${response.status}).`);
    open.complete(result.blobId, name);
  } catch (error) {
    open.fail(error);
  } finally {
    await rm(file, { force: true }).catch(() => {});
  }
}

/** Let Chromium finish the original navigation's authenticated response once.
 * A unique suggested filename pairs it with its DownloadItem even when several
 * tabs open the same URL. Ordinary downloads keep their settings and history. */
export function installBrowserPdfHandoff(
  target: Session, begin: (webContentsId: number, url: string) => BrowserPdfOpen | null,
): void {
  const pending = new Map<string, { open: BrowserPdfOpen; name: string; timer: NodeJS.Timeout }>();
  target.prependListener("will-download", (_event, item: DownloadItem) => {
    const key = item.getFilename();
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    clearTimeout(entry.timer);
    viewerDownloads.add(item);
    void storeDownload(item, entry.open, entry.name);
  });
  target.webRequest.onHeadersReceived(
    { urls: ["http://*/*", "https://*/*"], types: ["mainFrame"] },
    (details, callback) => {
      if (details.resourceType !== "mainFrame" || details.method !== "GET" || details.statusCode !== 200 ||
          details.webContentsId === undefined || !isInlinePdfResponse(details.responseHeaders)) {
        callback({});
        return;
      }
      const headers = { ...details.responseHeaders };
      const length = Object.keys(headers).find(key => key.toLowerCase() === "content-length");
      if (length && Number(headers[length]) > BROWSER_SOURCE_MAX_BYTES) { callback({}); return; }
      const open = begin(details.webContentsId, details.url);
      if (!open) { callback({}); return; }
      const disposition = Object.keys(headers).find(key => key.toLowerCase() === "content-disposition");
      const filename = browserSourceFilename(disposition ? headers[disposition]?.[0] ?? null : null, new URL(details.url));
      if (disposition) delete headers[disposition];
      const key = `breadboard-${randomUUID()}.pdf`;
      const timer = setTimeout(() => {
        pending.delete(key);
        open.fail(new Error("PDF transfer did not start."));
      }, BROWSER_SOURCE_TIMEOUT_MS);
      timer.unref();
      pending.set(key, { open, name: /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`, timer });
      headers["Content-Disposition"] = [`attachment; filename="${key}"`];
      callback({ responseHeaders: headers });
    },
  );
}
