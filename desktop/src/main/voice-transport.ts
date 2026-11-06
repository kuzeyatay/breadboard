import type { Session } from 'electron';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_UPLOAD_BYTES = 26 * 1024 * 1024;

/** Only the app's authenticated speech routes may bypass Chromium's HTTP/1 pool. */
export function voiceRequestUrl(value: string, dashboardUrl: string | null, method: string): URL | null {
  if (!dashboardUrl || !METHODS.has(method)) return null;
  try {
    const base = new URL(dashboardUrl), url = new URL(value);
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
        base.username || base.password || url.origin !== base.origin || url.username || url.password ||
        !/^\/api\/speech\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(url.pathname)) return null;
    return url;
  } catch { return null; }
}

/** Stream audio back immediately. No credentials, private audio, or transcripts
 * are cached; the route still applies the app's authentication and validation. */
export async function forwardVoiceRequest(url: URL, request: Request, target: Pick<Session, 'cookies'>,
  fetchVoice: typeof fetch = fetch): Promise<Response> {
  let body: ArrayBuffer | undefined;
  if (request.body && request.method !== 'GET') {
    const reader = request.body.getReader();
    const parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_UPLOAD_BYTES) {
          await reader.cancel();
          return Response.json({ error: 'Voice recordings may be at most 25 MB.' }, {
            status: 413, headers: { 'Access-Control-Allow-Origin': url.origin },
          });
        }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    body = Uint8Array.from(Buffer.concat(parts)).buffer;
  }
  const cookies = await target.cookies.get({ url: url.href });
  const headers = new Headers({
    Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
    Origin: url.origin,
  });
  for (const name of ['content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const response = await fetchVoice(url.href, {
    method: request.method, body, headers, redirect: 'error', cache: 'no-store',
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(15 * 60_000)]),
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Access-Control-Allow-Origin': url.origin,
      'Cache-Control': 'private, no-store',
      'Vary': 'Origin',
      'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
    },
  });
}
