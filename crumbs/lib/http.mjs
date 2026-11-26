// A tiny HTTP layer: JSON in and out, open CORS for reads, and a per-key rate limit.
import { createServer } from "node:http";

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const buckets = new Map();
/** Allow `limit` hits per `windowMs` for one key. */
export function rateLimit(key, limit, windowMs = 60_000) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) { buckets.set(key, { count: 1, reset: now + windowMs }); return; }
  if (++bucket.count > limit) throw new HttpError(429, "Please wait a moment and try again.");
  if (buckets.size > 20000) for (const [name, value] of buckets) if (value.reset < now) buckets.delete(name);
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That request is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * `handler({ method, path, query, host, ip, raw, body, headers })` returns a
 * plain object (sent as JSON), `{ status, headers, text }` for anything else,
 * or `{ stream(sink) }` for server-sent events: `sink.send(data)` writes one
 * event, `sink.ping()` a keep-alive comment, and `sink.onClose(fn)` runs when
 * the client goes away.
 */
export function serve({ port, host = "0.0.0.0", handler, bodyLimit = 256 * 1024, name }) {
  const server = createServer(async (request, response) => {
    const send = (status, headers, payload) => { response.writeHead(status, { "access-control-allow-origin": "*", "x-content-type-options": "nosniff", ...headers }); response.end(payload); };
    try {
      if (request.method === "OPTIONS") return send(204, { "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-max-age": "86400" });
      const url = new URL(request.url, "http://local");
      const raw = ["POST", "PUT", "DELETE"].includes(request.method) ? await readBody(request, bodyLimit) : Buffer.alloc(0);
      let body = {};
      if (raw.length) { try { body = JSON.parse(raw.toString("utf8")); } catch { throw new HttpError(400, "Send JSON."); } }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Send a JSON object.");
      const ip = String(request.headers["fly-client-ip"] ?? request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").split(",")[0].trim();
      const result = await handler({ method: request.method, path: url.pathname, pathWithQuery: url.pathname + url.search, query: url.searchParams,
        host: String(request.headers.host ?? "").toLowerCase(), ip, raw, body, headers: request.headers });
      if (result && typeof result.stream === "function") {
        response.writeHead(200, { "access-control-allow-origin": "*", "x-content-type-options": "nosniff", "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
        response.flushHeaders?.();
        request.socket.setKeepAlive?.(true);
        const closers = [];
        let open = true;
        const close = () => { if (!open) return; open = false; for (const fn of closers) { try { fn(); } catch { /* one listener's failure is not the others' */ } } };
        request.on("close", close); response.on("error", close);
        return result.stream({
          send: data => { if (open) response.write(`data: ${JSON.stringify(data)}\n\n`); },
          ping: () => { if (open) response.write(": ping\n\n"); },
          onClose: fn => closers.push(fn),
        });
      }
      if (result && typeof result.text === "string") return send(result.status ?? 200, result.headers ?? { "content-type": "text/plain; charset=utf-8" }, result.text);
      send(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, JSON.stringify(result ?? {}));
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(`[${name}]`, error);
      send(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, JSON.stringify({ error: status === 500 ? "Something went wrong on our side." : error.message }));
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

export function requireAdmin(headers, token) {
  if (!token || headers.authorization !== `Bearer ${token}`) throw new HttpError(401, "Admin token required.");
}
