import { session as electronSession, type Session } from "electron";
import { isInlinePdfResponse } from "./pdf-viewer-redirect";
import { BROWSER_SOURCE_TIMEOUT_MS, fetchBrowserSource } from "./browser-source-download";

/**
 * Website PDFs open in Breadboard's own viewer, not Chromium's PDF plugin
 * (which goes blank when its view is detached on a tab switch and has none of
 * the viewer's tools). The main-frame response is answered with 204, which
 * leaves the tab on whatever page it showed; `open` then fetches the file with
 * the browser's cookies and opens the viewer. `open` returns false to let the
 * plugin have it (private tabs, agent tabs, a fallback after a failed hand-off).
 *
 * Electron keeps ONE onHeadersReceived listener per session: this is the
 * website session's.
 */
export function installBrowserPdfHandoff(
  target: Session,
  open: (webContentsId: number, url: string) => boolean,
): void {
  target.webRequest.onHeadersReceived(
    { urls: ["http://*/*", "https://*/*"], types: ["mainFrame"] },
    (details, callback) => {
      if (
        details.method !== "GET" || details.statusCode < 200 || details.statusCode >= 300 ||
        details.webContentsId === undefined || !isInlinePdfResponse(details.responseHeaders) ||
        !open(details.webContentsId, details.url)
      ) {
        callback({});
        return;
      }
      callback({ statusLine: "HTTP/1.1 204 No Content", responseHeaders: {} });
    },
  );
}

/** Download a website PDF with the browser's cookies and keep it as a document blob. */
export async function storeBrowserPdf(
  browserSession: Session,
  url: string,
  dashboardUrl: string,
): Promise<{ blobId: string; name: string }> {
  const signal = AbortSignal.timeout(BROWSER_SOURCE_TIMEOUT_MS);
  const { response, filename } = await fetchBrowserSource(browserSession, url, url, signal, () => {});
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength) throw new Error("The website returned an empty PDF.");
  const name = /\.pdf$/i.test(filename) ? filename : `${filename}.pdf`;
  const upload = await electronSession.defaultSession.fetch(
    new URL("/api/chat-attachments/documents", dashboardUrl).href,
    {
      method: "POST",
      body: bytes,
      credentials: "include",
      signal,
      headers: {
        "content-type": "application/pdf",
        "x-document-filename": encodeURIComponent(name),
        "x-document-store-only": "true",
      },
    },
  );
  const result = (await upload.json().catch(() => null)) as { blobId?: unknown } | null;
  if (!upload.ok || typeof result?.blobId !== "string") {
    throw new Error(`Breadboard could not keep the PDF (${upload.status}).`);
  }
  return { blobId: result.blobId, name };
}
