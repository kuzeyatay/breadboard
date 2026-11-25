import { nodeStreamToWeb } from "./node-stream-to-web.ts";
import { externalRuntimeFilesystem as fs } from "./external-runtime-filesystem.ts";
import { matchesValidator, parseRangeHeader, rangeIsStillValid } from "./http-range.ts";

/** Serve an already-authorized file with bounded reads, including when a viewer seeks or closes. */
export function fileContentResponse(request: Request, path: string, size: number, init: HeadersInit): Response {
  const headers = new Headers(init);
  headers.set("Accept-Ranges", "bytes");
  const validator = headers.get("ETag");
  if (validator && matchesValidator(request.headers.get("if-none-match"), validator)) {
    return new Response(null, { status: 304, headers });
  }
  const ifRange = request.headers.get("if-range");
  const requested = parseRangeHeader(!ifRange || (validator && rangeIsStillValid(ifRange, validator))
    ? request.headers.get("range") : null, size);
  if (requested.kind === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const range = requested.kind === "range" ? requested.range : undefined;
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  headers.set("Content-Length", String(range ? range.end - range.start + 1 : size));
  const body = size === 0 || request.method === "HEAD" ? null : nodeStreamToWeb(
    fs.createReadStream(path, { start: range?.start ?? 0, end: range?.end ?? size - 1, signal: request.signal }),
  );
  return new Response(body, { status: range ? 206 : 200, headers });
}
