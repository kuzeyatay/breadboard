import { Readable } from "node:stream";
import { externalRuntimeFilesystem as fs } from "../external-runtime-filesystem.ts";
import type { GardenFileStore, GardenFileScope } from "./store.ts";

/** Single-range streaming keeps large originals out of the server heap. */
export function gardenFileContentResponse(request: Request, store: GardenFileStore, scope: GardenFileScope, fileId: string): Response {
  const url = new URL(request.url), version = url.searchParams.has("version") ? Number(url.searchParams.get("version")) : undefined;
  const file = store.content(scope, fileId, version), size = file.version.size;
  const download = url.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": file.entry.mimeType,
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${file.entry.name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.entry.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16)}`)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Breadboard-File-Revision": String(file.entry.revision),
    "X-Breadboard-File-Name": encodeURIComponent(file.entry.name),
    ETag: `"${file.version.sha256}"`,
  };
  let start = 0, end = size - 1, status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]) || size === 0) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1; }
    else { start = Math.max(0, size - Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    status = 206; headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(Math.max(0, end - start + 1));
  const body = request.method === "HEAD" || size === 0 ? null : Readable.toWeb(fs.createReadStream(file.path, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
