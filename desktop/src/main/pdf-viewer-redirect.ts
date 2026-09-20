import type { Session } from "electron";

/**
 * Breadboard reads PDFs and plays video in its own viewers — pdf.js with
 * annotations, the Ask palette, the remembered page; the video player with the
 * app's controls and a way back. A frame that navigates straight to a
 * dashboard URL answering with those bytes (a middle-click or "open in new
 * tab" on the address a viewer fetches, an agent-driven navigation, a tab
 * restored on that address) would otherwise land in Chromium's built-in PDF
 * plugin or its bare media viewer, which have none of that and do not look
 * like Breadboard. The shell notices the content type at the response and
 * turns it into a redirect to the viewer route for that file, so the guarantee
 * holds no matter which click produced the raw address.
 *
 * Only the dashboard origin is covered: the sandboxed browser lives on its own
 * session, and a garden's static site is another origin whose files the viewer
 * cannot fetch. Downloads (`Content-Disposition: attachment`) pass untouched.
 */

type ResponseHeaders = Record<string, string[] | string> | undefined;

function header(headers: ResponseHeaders, name: string): string {
  if (!headers) return "";
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  if (!key) return "";
  const value = headers[key];
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function displayedInline(headers: ResponseHeaders): boolean {
  return !/^\s*attachment/i.test(header(headers, "content-disposition"));
}

function contentType(headers: ResponseHeaders): string {
  return header(headers, "content-type").split(";")[0]!.trim().toLowerCase();
}

/** A PDF the frame would display, as opposed to one it would save to disk. */
export function isInlinePdfResponse(headers: ResponseHeaders): boolean {
  const type = contentType(headers);
  if (type !== "application/pdf" && type !== "application/x-pdf") return false;
  return displayedInline(headers);
}

/**
 * A video the frame would display. `application/octet-stream` is deliberately
 * not treated as video: a route that does not say what it is serving is not
 * evidence enough to hijack the navigation.
 */
export function isInlineVideoResponse(headers: ResponseHeaders): boolean {
  const type = contentType(headers);
  if (!type.startsWith("video/")) return false;
  return displayedInline(headers);
}

/**
 * The viewer page for a dashboard address that serves a PDF. The endpoints a
 * viewer already exists for get that viewer; anything else gets the generic
 * `/pdf?src=` reader, which fetches the same address with the same cookies.
 */
export function breadboardPdfViewerPath(rawUrl: URL): string {
  const segments = rawUrl.pathname.split("/").filter(Boolean);
  const [api, first, second, third, fourth] = segments;
  const hash = rawUrl.hash;
  if (api === "api") {
    const clusterSlug = rawUrl.searchParams.get("clusterSlug");
    if (first === "documents" && second && third === "source-pdf" && !fourth && clusterSlug) {
      return `/gardens/${encodeURIComponent(clusterSlug)}/pdf/${second}${hash}`;
    }
    if (first === "chat-attachments" && second === "documents" && third && !fourth) {
      return `/attachments/${third}/pdf${hash}`;
    }
    if (first === "hermes" && second === "artifacts" && third && fourth === "preview" && segments.length === 5) {
      const query = new URLSearchParams();
      for (const key of ["conversationId", "version"]) {
        const value = rawUrl.searchParams.get(key);
        if (value) query.set(key, value);
      }
      const suffix = query.toString();
      return `/artifacts/${third}/pdf${suffix ? `?${suffix}` : ""}${hash}`;
    }
  }
  const query = new URLSearchParams({ src: `${rawUrl.pathname}${rawUrl.search}` });
  const name = decodeURIComponent(segments[segments.length - 1] ?? "");
  if (/\.pdf$/i.test(name)) query.set("name", name);
  return `/pdf?${query.toString()}${hash}`;
}

/**
 * The player page for a dashboard address that serves a video. A video
 * artifact has its own route; anything else gets the generic `/video?src=`
 * player, which fetches the same address with the same cookies.
 */
export function breadboardVideoPlayerPath(rawUrl: URL): string {
  const segments = rawUrl.pathname.split("/").filter(Boolean);
  const [api, first, second, third, fourth] = segments;
  if (
    api === "api" && first === "hermes" && second === "artifacts" &&
    third && fourth === "preview" && segments.length === 5
  ) {
    const query = new URLSearchParams();
    for (const key of ["conversationId", "version"]) {
      const value = rawUrl.searchParams.get(key);
      if (value) query.set(key, value);
    }
    const suffix = query.toString();
    return `/artifacts/${third}/video${suffix ? `?${suffix}` : ""}`;
  }
  const query = new URLSearchParams({ src: `${rawUrl.pathname}${rawUrl.search}` });
  const name = decodeURIComponent(segments[segments.length - 1] ?? "");
  if (/\.(mp4|m4v|mov|webm|mkv|avi|ogv)$/i.test(name)) query.set("name", name);
  return `/video?${query.toString()}`;
}

function viewerPathFor(rawUrl: URL, headers: ResponseHeaders): string | null {
  if (isInlinePdfResponse(headers)) return breadboardPdfViewerPath(rawUrl);
  if (isInlineVideoResponse(headers)) return breadboardVideoPlayerPath(rawUrl);
  return null;
}

/**
 * Where a main-frame response should be sent instead, or null to leave it be.
 */
export function pdfViewerRedirectFor(
  url: string,
  headers: ResponseHeaders,
  dashboardOrigin: string | null,
): string | null {
  if (!dashboardOrigin) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== dashboardOrigin) return null;
  const viewerPath = viewerPathFor(parsed, headers);
  if (!viewerPath) return null;
  return new URL(viewerPath, dashboardOrigin).toString();
}

const BODY_HEADERS = new Set([
  "content-type",
  "content-disposition",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
]);

export interface PdfViewerRedirectOptions {
  /** The dashboard's origin once the runtime is up; null until then. */
  dashboardOrigin: () => string | null;
  log?: (line: string) => void;
}

/**
 * Install the guard on the session product pages load in. Electron keeps one
 * `onHeadersReceived` listener per session, so this must stay the only one.
 */
export function installPdfViewerRedirect(
  targetSession: Session,
  options: PdfViewerRedirectOptions,
): void {
  targetSession.webRequest.onHeadersReceived(
    { urls: ["http://*/*", "https://*/*"], types: ["mainFrame"] },
    (details, callback) => {
      const viewer = pdfViewerRedirectFor(
        details.url,
        details.responseHeaders,
        options.dashboardOrigin(),
      );
      if (!viewer) {
        callback({});
        return;
      }
      options.log?.(`[media] opening ${details.url} in the Breadboard viewer`);
      const responseHeaders: Record<string, string[] | string> = {};
      for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
        if (!BODY_HEADERS.has(key.toLowerCase())) responseHeaders[key] = value;
      }
      responseHeaders.Location = [viewer];
      callback({ statusLine: "HTTP/1.1 302 Found", responseHeaders });
    },
  );
}
