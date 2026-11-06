import type { Session } from "electron";

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Long-lived app feeds must not consume Chromium's six document/API sockets. */
export function appStreamUrl(value: string, dashboardUrl: string | null, method: string): URL | null {
  if (!dashboardUrl) return null;
  try {
    const base = new URL(dashboardUrl), url = new URL(value);
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
        base.username || base.password || url.origin !== base.origin || url.username || url.password) return null;
    const session = /^\/api\/hermes\/sessions\/[\w-]+\/(events|direct)$/.exec(url.pathname);
    if (session && method === (session[1] === "events" ? "GET" : "POST")) return url;
    if (method === "GET" && /^\/api\/[\w-]+\/(?:agents\/[\w-]+\/)?runs\/[\w-]+\/events$/.test(url.pathname)) return url;
  } catch { /* Malformed URLs keep the normal request path. */ }
  return null;
}

/** Preserve streaming, authentication and cancellation without buffering replies
 * or caching private chat data. Only a trusted, one-use redirect may call this. */
export async function forwardAppStream(url: URL, request: Request, target: Pick<Session, "cookies">,
  fetchStream: typeof fetch = fetch): Promise<Response> {
  const headers = new Headers({ Accept: "text/event-stream", Origin: url.origin });
  for (const name of ["accept", "content-type", "last-event-id"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  let body: ArrayBuffer | undefined;
  if (request.body && request.method === "POST") {
    const reader = request.body.getReader();
    const parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_UPLOAD_BYTES) {
          await reader.cancel();
          return new Response("Chat request is too large", {
            status: 413, headers: { "Access-Control-Allow-Origin": url.origin },
          });
        }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    body = Uint8Array.from(Buffer.concat(parts)).buffer;
  }
  const cookies = await target.cookies.get({ url: url.href });
  headers.set("Cookie", cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; "));
  // Bound connection/header setup, not the duration of a healthy agent run.
  const opening = new AbortController();
  const timer = setTimeout(() => opening.abort(), 30_000);
  timer.unref?.();
  try {
    const response = await fetchStream(url.href, {
      method: request.method, body, headers, redirect: "error", cache: "no-store",
      signal: AbortSignal.any([request.signal, opening.signal]),
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Access-Control-Allow-Origin": url.origin,
        "Access-Control-Allow-Credentials": "true",
        "Cache-Control": "private, no-store",
        Vary: "Origin",
        "Content-Type": response.headers.get("content-type") ?? "text/event-stream",
      },
    });
  } finally { clearTimeout(timer); }
}
