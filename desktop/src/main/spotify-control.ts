const actions = new Set(["pause", "resume", "next", "previous", "seek", "transfer", "play-track", "play-playlist", "play-artist", "play-album", "import-history"]);
export type SpotifyResponse = { status: number; body: string };
export type SpotifyRequest = { resource: "player" | "engine"; method: "GET" | "POST" | "DELETE"; body?: Record<string, unknown> };

export function validateSpotifyRequest(request: unknown): asserts request is SpotifyRequest {
  const value = request as Partial<SpotifyRequest> | null;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["resource", "method", "body"].includes(key)) ||
      !["player", "engine"].includes(String(value.resource)) ||
      !["GET", "POST", "DELETE"].includes(String(value.method))) throw new Error("Invalid Spotify request.");
  if (value.method === "GET") {
    if (value.body !== undefined) throw new Error("Invalid Spotify request.");
  } else if (!value.body || typeof value.body !== "object" || Array.isArray(value.body)) throw new Error("Invalid Spotify request.");
  else if (value.resource === "engine") {
    if (Object.keys(value.body).length !== 1 || typeof value.body.viewId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.body.viewId)) throw new Error("Invalid Spotify lease.");
  } else if (value.method !== "POST" || !actions.has(String(value.body.action))) throw new Error("Invalid Spotify control.");
  if (value.body && Buffer.byteLength(JSON.stringify(value.body)) > 64 * 1024) throw new Error("Spotify control is too large.");
}

function transientTransportFailure(error: unknown): boolean {
  const value = error as {name?: string; code?: string; cause?: {code?: string}} | null;
  return ["TimeoutError", "AbortError"].includes(value?.name ?? "") ||
    ["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT"].includes(value?.cause?.code ?? value?.code ?? "");
}

/** Use Node's connection pool for interactive controls. Chromium's HTTP/1
 * slots can all be occupied by the dashboard's long-lived event streams. */
export async function sendSpotifyRequest(input: {
  dashboardUrl: string;
  request: unknown;
  readCookies: (url: string) => Promise<Array<{ name: string; value: string }>>;
  fetch?: typeof fetch;
}): Promise<SpotifyResponse> {
  validateSpotifyRequest(input.request);
  const value = input.request;
  const target = new URL(value.resource === "engine" ? "/api/hermes/connections/spotify/engine" : "/api/browser/spotify", input.dashboardUrl);
  if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.username || target.password) throw new Error("Invalid Spotify control origin.");
  const body = value.body === undefined ? undefined : JSON.stringify(value.body);
  const cookies = await input.readCookies(target.href);
  const retryable = value.method === "GET" || value.resource === "engine";
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await (input.fetch ?? fetch)(target, {
        method: value.method, body,
        headers: { "Content-Type": "application/json", Cookie: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ") },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(retryable ? 10_000 : 25_000),
      });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        if (reader) for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 128 * 1024) { await reader.cancel(); throw new Error("Invalid Spotify control response."); }
          chunks.push(chunk.value);
        }
      } finally { reader?.releaseLock(); }
      return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
    } catch (error) {
      if (retryable && attempt === 0 && transientTransportFailure(error)) continue;
      // Transport outages are expected operational failures, not unhandled IPC
      // exceptions. Never replay a possibly-applied playback command.
      return {status: 503, body: JSON.stringify({
        code: retryable ? "spotify_transport_unavailable" : "spotify_control_unconfirmed",
        message: retryable ? "Spotify is temporarily unavailable. Reconnecting…" : "Spotify could not confirm that control. Check playback before trying again.",
      })};
    }
  }
}
