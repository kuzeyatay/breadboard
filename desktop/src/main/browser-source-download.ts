import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { net, type Session } from "electron";

export const BROWSER_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
export const BROWSER_SOURCE_TIMEOUT_MS = 90_000;

function webUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Choose an exact file URL from the linked browser page.");
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Browser downloads require an HTTP or HTTPS URL without credentials.");
  }
  url.hash = "";
  return url;
}

// The first request stays within the tab's existing authority. A redirect may
// reach a public HTTPS CDN, but must not probe a different local service.
export async function browserSourceDestination(value: string, pageUrl: string, redirect = false): Promise<URL> {
  const url = webUrl(value);
  const page = webUrl(pageUrl);
  if (url.origin === page.origin) return url;
  if (!redirect) throw new Error("The file URL must belong to the linked browser page's site. Open its source tab first.");
  if (url.protocol !== "https:" || url.port) throw new Error("The file redirected outside its site to an unsafe destination.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => {
    if (isIP(address) === 6) {
      // Only global unicast IPv6; reject mapped IPv4 and local/link-local ranges.
      return !/^[23][0-9a-f]{3}:/i.test(address);
    }
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  })) throw new Error("The file redirected to a private network address outside the linked site.");
  return url;
}

export function browserSourceFilename(disposition: string | null, url: URL): string {
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition ?? "")?.[1];
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(disposition ?? "");
  let name = encoded ?? plain?.[1] ?? plain?.[2] ?? url.pathname.split("/").pop() ?? "source";
  try { name = decodeURIComponent(name); } catch { /* Preserve a malformed display name safely. */ }
  return name.replaceAll("\\", "/").split("/").pop()!.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").trim().slice(0, 180) || "source";
}

// The bundled Electron's session.fetch rejects manual redirects instead of exposing a
// 3xx response. Use its native request events so each hop can be checked before
// following, with the same Chromium session and no cookie extraction.
function requestBrowserSource(session: Session, url: string, credentials: "include" | "omit", signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = net.request({ session, url, method: "GET", redirect: "manual", credentials,
      headers: { accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5", "cache-control": "no-cache" } });
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let finished = false;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      controller?.error(error);
      reject(error);
      request.abort();
    };
    const abort = () => fail(new Error("The browser download was aborted."));
    signal.addEventListener("abort", abort, { once: true });
    request.on("error", fail);
    request.on("login", (_info, callback) => callback());
    // ClientRequest's writable close can precede its response in this Electron
    // version. Completion is response.end; response.aborted/error handle failures.
    request.on("redirect", (status, _method, destination) => {
      finished = true;
      signal.removeEventListener("abort", abort);
      resolve(new Response(null, { status, headers: { location: destination } }));
      request.abort();
    });
    request.on("response", response => {
      const headers = new Headers();
      for (const key of ["content-type", "content-length", "content-disposition"]) {
        const value = response.headers[key];
        if (value) headers.set(key, Array.isArray(value) ? value[0]! : value);
      }
      if ([204, 205, 304].includes(response.statusCode)) {
        finished = true;
        signal.removeEventListener("abort", abort);
        resolve(new Response(null, { status: response.statusCode, headers }));
        request.abort();
        return;
      }
      let size = 0;
      const stream = new ReadableStream<Uint8Array>({
        start(sink) {
          controller = sink;
          response.on("error", fail);
          response.on("aborted", abort);
          response.on("end", () => { if (!finished) { finished = true; signal.removeEventListener("abort", abort); sink.close(); } });
          response.on("data", chunk => {
            if (finished) return;
            size += chunk.length;
            if (size > BROWSER_SOURCE_MAX_BYTES) { fail(new Error("The browser file exceeds the 64 MiB download limit.")); return; }
            sink.enqueue(new Uint8Array(chunk));
          });
        },
        cancel() { finished = true; signal.removeEventListener("abort", abort); request.abort(); },
      });
      resolve(new Response(stream, { status: response.statusCode, headers }));
    });
    request.end();
  });
}

/** Cookies stay in Chromium. The caller streams only the body and safe metadata. */
export async function fetchBrowserSource(
  session: Session,
  pageUrl: string,
  sourceUrl: string,
  signal: AbortSignal,
  assertCurrent: () => void,
  requestSource = (url: string, credentials: "include" | "omit", signal: AbortSignal) => requestBrowserSource(session, url, credentials, signal),
): Promise<{ response: Response; filename: string }> {
  let current = await browserSourceDestination(sourceUrl, pageUrl);
  for (let hop = 0; hop <= 5; hop++) {
    assertCurrent();
    signal.throwIfAborted();
    const response = await requestSource(current.href, current.origin === new URL(pageUrl).origin ? "include" : "omit", signal);
    assertCurrent();
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("The file redirect has no destination.");
      current = await browserSourceDestination(new URL(location, current).href, pageUrl, true);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Browser file download returned ${response.status}. Check access in the linked tab.`);
    }
    const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (["text/html", "application/xhtml+xml", "application/json"].includes(mime ?? "")) {
      await response.body?.cancel();
      throw new Error("The link returned a page instead of a file. Use the page's download link and check that you are signed in.");
    }
    if (Number(response.headers.get("content-length")) > BROWSER_SOURCE_MAX_BYTES) {
      await response.body?.cancel();
      throw new Error("The browser file exceeds the 64 MiB download limit.");
    }
    return { response, filename: browserSourceFilename(response.headers.get("content-disposition"), current) };
  }
  throw new Error("Too many browser file redirects.");
}
