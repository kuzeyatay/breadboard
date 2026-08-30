#!/usr/bin/env node

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MAX_URL_BYTES = 8 * 1024;
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function fail(message) {
  process.stderr.write(`[runtime-v2-quartz-static] ${message}\n`);
  process.exit(1);
}

function parsePort(argv) {
  if (argv.length !== 2 || argv[0] !== "--port" || !/^[1-9]\d{0,4}$/u.test(argv[1])) {
    fail("expected exactly --port <Runtime-allocated-port>");
  }
  const port = Number(argv[1]);
  if (!Number.isSafeInteger(port) || port > 65_535) fail("the Runtime port is invalid");
  return port;
}

function requiredRoot() {
  const value = process.env.BREADBOARD_QUARTZ_PUBLIC_ROOT?.trim() ?? "";
  if (!value || !path.isAbsolute(value) || value.includes("\0")) {
    fail("the sealed Quartz public root is invalid");
  }
  return path.resolve(value);
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function publicFile(root, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  const directoryRequest = segments.length === 0 || decoded.endsWith("/");
  const relative = directoryRequest
    ? path.join(...segments, "index.html")
    : path.join(...segments);
  // A clean Quartz slug may contain dots (for example, a numbered lesson such
  // as `1.1-fields`). Treating path.extname(slug) as proof that the request is
  // for an asset skips the emitted `slug.html` file. Exact files still win,
  // while every non-directory route also gets the normal clean-URL fallbacks.
  const candidates = directoryRequest
    ? [relative]
    : [relative, `${relative}.html`, path.join(relative, "index.html")];
  if (!fs.existsSync(root)) return null;
  const canonicalRoot = fs.realpathSync.native(root);
  for (const candidate of candidates) {
    const target = path.resolve(root, candidate);
    if (!within(root, target) || !fs.existsSync(target)) continue;
    const metadata = fs.lstatSync(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    const canonical = fs.realpathSync.native(target);
    if (within(canonicalRoot, canonical)) return { path: canonical, size: metadata.size };
  }
  return null;
}

function trailingSlashRedirect(root, requestPath) {
  if (requestPath === "/" || !requestPath.endsWith("/")) return null;
  const slashless = requestPath.replace(/\/+$/u, "");
  return publicFile(root, `${slashless}.html`) ? slashless : null;
}

function sendJson(response, status, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": String(body.byteLength),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

const port = parsePort(process.argv.slice(2));
const publicRoot = requiredRoot();
const server = http.createServer((request, response) => {
  if (!request.url || Buffer.byteLength(request.url, "utf8") > MAX_URL_BYTES) {
    sendJson(response, 400, { ok: false, error: "invalid_request" });
    return;
  }
  let url;
  try {
    url = new URL(request.url, `http://127.0.0.1:${port}`);
  } catch {
    sendJson(response, 400, { ok: false, error: "invalid_request" });
    return;
  }
  if (url.pathname === "/__health") {
    sendJson(response, 200, {
      ready: true,
      service: "quartz-static",
      published: fs.existsSync(path.join(publicRoot, "index.html")),
    });
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    sendJson(response, 405, { ok: false, error: "method_not_allowed" });
    return;
  }
  const file = publicFile(publicRoot, url.pathname);
  const redirectPath = file ? null : trailingSlashRedirect(publicRoot, url.pathname);
  if (redirectPath) {
    response.writeHead(302, {
      "cache-control": "no-store",
      "content-length": "0",
      location: `${redirectPath}${url.search}`,
      "x-content-type-options": "nosniff",
    });
    response.end();
    return;
  }
  if (!file) {
    const body = Buffer.from(
      "<!doctype html><meta charset=utf-8><title>Breadboard</title><p>Your garden is being prepared.</p>",
      "utf8",
    );
    response.writeHead(404, {
      "cache-control": "no-store",
      "content-length": String(body.byteLength),
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }
  const contentType = MIME_TYPES.get(path.extname(file.path).toLowerCase()) ?? "application/octet-stream";
  response.writeHead(200, {
    "cache-control": contentType.startsWith("text/html") ? "no-cache" : "public, max-age=300",
    "content-length": String(file.size),
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream = fs.createReadStream(file.path);
  stream.once("error", () => response.destroy());
  stream.pipe(response);
});

server.on("error", (error) => fail(error instanceof Error ? error.message : "server failed"));
server.listen(port, "127.0.0.1");

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 4_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
