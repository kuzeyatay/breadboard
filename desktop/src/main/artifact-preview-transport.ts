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
export async function readArtifactPreview(url: URL, target: Pick<Session, "cookies">,
  signal: AbortSignal, fetchImage: typeof fetch = fetch): Promise<Response> {
  const cookies = await target.cookies.get({ url: url.href });
  const response = await fetchImage(url.href, {
    redirect: "error", cache: "no-store",
    headers: { Accept: "image/*", Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  const headers = {
    "Access-Control-Allow-Origin": url.origin,
    "Cache-Control": "private, no-store",
    "Vary": "Origin",
    "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
  };
  if (!response.ok) {
    await response.body?.cancel();
    return new Response(null, { status: response.status, headers });
  }
  // The viewer also fetches text/code previews through this endpoint. Preserve
  // those reads; only image blobs need the bounded buffering below.
  if (!/^image\//i.test(headers["Content-Type"])) return new Response(response.body, { status: response.status, headers });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (reader) for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error("Artifact image is too large"); }
      chunks.push(chunk.value);
    }
  } finally { reader?.releaseLock(); }
  return new Response(Buffer.concat(chunks), { status: response.status, headers });
}
