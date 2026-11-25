import type { Session } from "electron";

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** The desktop may read only an artifact preview on its own loopback dashboard. */
export function artifactPreviewUrl(value: string, dashboardUrl: string | null): URL | null {
  if (!dashboardUrl) return null;
  try {
    const base = new URL(dashboardUrl);
    const url = new URL(value);
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) ||
        base.username || base.password || url.origin !== base.origin || url.username || url.password ||
        !/^\/api\/hermes\/artifacts\/art_[\w-]+\/preview$/.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

/** Use Node's connection pool, with the app session's current authentication.
 * Private previews are never placed in the immutable public asset cache. */
export async function readArtifactPreview(url: URL, target: { cookies: Pick<Session["cookies"], "get"> },
  request: Request, fetchImage: typeof fetch = fetch): Promise<Response> {
  const cookies = await target.cookies.get({ url: url.href });
  const upstream = new Headers({ Accept: request.headers.get("accept") || "*/*", "Accept-Encoding": "identity",
    Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") });
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) upstream.set(name, value);
  }
  const response = await fetchImage(url.href, {
    redirect: "error", cache: "no-store",
    headers: upstream,
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
  });
  const headers = new Headers({
    "Access-Control-Allow-Origin": url.origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Range, Content-Length",
    "Cache-Control": "private, no-store",
    "Vary": "Origin",
    "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
  });
  // PDF.js must see the server's actual slice and length to seek in the document.
  if (!response.headers.has("content-encoding") || response.headers.get("content-encoding") === "identity") {
    for (const name of ["accept-ranges", "content-range", "content-length"]) {
      const value = response.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
  }
  if (!response.ok) {
    await response.body?.cancel();
    headers.delete("content-length");
    return new Response(null, { status: response.status, headers });
  }
  let body = response.body;
  if (body && /^image\//i.test(headers.get("content-type")!)) {
    if (Number(headers.get("content-length")) > MAX_IMAGE_BYTES) {
      await body.cancel();
      throw new Error("Artifact image is too large");
    }
    // Let the renderer decode arriving bytes while enforcing the limit on chunked images too.
    let size = 0;
    body = body.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new Error("Artifact image is too large");
        controller.enqueue(chunk);
      },
    }));
  }
  return new Response(body, { status: response.status, headers });
}
