// Breadboard's host for Timeline Studio: serves the built editor (dist/) on one loopback
// port with upstream's isolation headers, and injects bridge.js so the Video Studio page
// can call the editor's own WebMCP tools. Upstream files stay untouched.
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const port = Number(arg("port", process.env.TIMELINE_STUDIO_PORT || 8797));
const root = resolve(arg("dist", join(here, "..", "dist")));
const bridge = readFileSync(join(here, "bridge.js"));

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2", ".ttf": "font/ttf", ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".task": "application/octet-stream", ".onnx": "application/octet-stream" };
const HEADERS = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff" };

function indexHtml() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  return html.replace(/<head([^>]*)>/i, `<head$1><script src="/__breadboard/bridge.js"></script>`);
}

createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/__breadboard/health") { response.writeHead(200, { "Content-Type": "application/json" }); return response.end('{"ok":true}'); }
  if (url.pathname === "/__breadboard/bridge.js") { response.writeHead(200, { ...HEADERS, "Content-Type": "text/javascript", "Cache-Control": "no-store" }); return response.end(bridge); }
  let file;
  try { file = normalize(join(root, decodeURIComponent(url.pathname))); } catch { response.writeHead(400); return response.end(); }
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); return response.end(); }
  const isFile = existsSync(file) && statSync(file).isFile();
  // SPA fallback, as upstream's netlify.toml does; index.html always carries the bridge.
  if (!isFile || file === join(root, "index.html")) {
    if (extname(url.pathname) && !isFile) { response.writeHead(404, HEADERS); return response.end(); }
    response.writeHead(200, { ...HEADERS, "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
    return response.end(indexHtml());
  }
  response.writeHead(200, { ...HEADERS, "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": statSync(file).size,
    "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`timeline-studio listening on http://127.0.0.1:${port}`));
