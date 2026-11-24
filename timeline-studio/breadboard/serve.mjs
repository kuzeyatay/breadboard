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

// Breadboard's look: upstream hard-codes a neon cyan palette, so every colour literal in the built CSS and JS
// is moved onto Breadboard's dark botanical theme as it is served. Cyan accents become the botanical green,
// blue-grey surfaces become Breadboard's green-grey, and other hues are toned down.
// Light mode turns the surfaces and text around (dark grounds become Breadboard's pale paper, light text dark) and
// keeps the pale green accent; accent-coloured text is darkened so it stays readable on paper. Pure black stays
// (the video stage and shadows).
export function themeColor(r, g, b, mode = "dark", text = false) {
  if (mode === "light" && r === 0 && g === 0 && b === 0 && !text) return [0, 0, 0];
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2, d = max - min;
  if (d === 0 && (mode === "light" || l === 0 || l >= 0.3)) return mode === "light" ? Array(3).fill(Math.round((0.97 - 0.85 * l) * 255)) : [r, g, b];
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), h = 0, L = l;
  const [R, G, B] = [r / 255, g / 255, b / 255];
  if (d > 0) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  const grey = s < 0.35 || d < 0.1; // near-white and near-black tints count as greys too
  // The editor sits inside Quartz, so it wears Quartz's palette: dark grounds #18181a (a neutral grey), light
  // grounds #e6f0e6, accent #91b7a1 in dark and #84a59d / #4f6f68 (text) in light.
  const accent = !grey && h >= 150 && h <= 200;
  if (grey) {
    if (mode === "dark" && l < 0.3) { h = 240; s = 0.04; }
    else if (mode === "light" && l < 0.3) { h = 120; s = 0.25; }                // becomes a light ground
    else { h = 140; s = Math.min(s, 0.12); }
  }
  else if (accent) { h = mode === "light" ? 166 : 145; s = mode === "light" ? 0.17 : 0.2; } // the neon cyan accent
  else if (h > 200 && h <= 250) { h = 205; s = Math.min(s, 0.3); }        // electric blues
  else s = Math.min(s, 0.5);
  // Near-black text upstream only sits on the accent or on light controls, which stay light: it stays dark.
  // Dark grounds sit on Quartz's #18181a (upstream's #07090d) with panels a step lighter.
  if (mode === "dark" && grey && l < 0.3) L = 0.07 + l * 0.7 + (l > 0.2 ? (l - 0.2) * 0.2 : 0);
  if (mode === "dark" && accent) L = Math.min(0.72, l + 0.08);
  if (mode === "light") L = grey ? (text && l < 0.12 ? l : 0.97 - 0.55 * l - (l > 0.3 ? 0.3 * (l - 0.3) : 0)) : accent ? (text ? 0.37 : 0.58) : text ? Math.min(l, 0.36) : l;
  const c = (1 - Math.abs(2 * L - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r1, g1, b1].map(v => Math.round((v + L - c / 2) * 255));
}
const hex = n => n.toString(16).padStart(2, "0");
// A colour right after a plain `color:` is text.
const isText = (source, offset) => /(?<![-\w])color:\s*$/.test(source.slice(Math.max(0, offset - 12), offset));
export function retheme(text, mode = "dark") {
  return text
    .replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g, (match, digits, offset, source) => {
      // 3/4-digit hex: as CSS reads it. Ids and hashes such as "#abc123" in JS also change, harmlessly.
      const full = digits.length <= 4 ? [...digits].map(c => c + c).join("") : digits;
      return `#${themeColor(...[0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)), mode, isText(source, offset)).map(hex).join("")}${full.slice(6)}`;
    })
    .replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g, (match, r, g, b, offset, source) => {
      const [r2, g2, b2] = themeColor(+r, +g, +b, mode, isText(source, offset));
      return match.replace(/\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/, `${r2}, ${g2}, ${b2}`);
    });
}
// Upstream's own project name, autosave clock and community links belong to its website, not to a Breadboard editor.
const THEME_CSS = `.project-title,.autosave,.topbar-community-links,.file-menu-resources{display:none!important}
:root{font-family:var(--font-source-sans,"Source Sans 3"),Inter,ui-sans-serif,system-ui,sans-serif}`;
const themed = new Map();
// Each theme's built files are served under their own folder (/assets/bb-<theme>/…): browsers that cached
// upstream's colours under /assets/ (once served as immutable) cannot reuse them, and a theme switch reloads cleanly.
const THEME_VERSION = "3";
const themedPaths = (text, mode) => text.replace(/(["'`(]\/?)assets\/(?=[\w.-]+\.\w+)/g, `$1assets/bb${THEME_VERSION}-${mode}/`);
const LIGHT_CSS = `:root{color-scheme:light}`;

function indexHtml(mode) {
  const html = readFileSync(join(root, "index.html"), "utf8");
  return themedPaths(retheme(html, mode), mode).replace(/<head([^>]*)>/i, `<head$1><script src="/__breadboard/bridge.js"></script>`).replace(/<\/head>/i, `<style id="breadboard-theme">${THEME_CSS}${mode === "light" ? LIGHT_CSS : ""}</style></head>`);
}

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) createServer((request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (url.pathname === "/__breadboard/health") { response.writeHead(200, { "Content-Type": "application/json" }); return response.end('{"ok":true}'); }
  if (url.pathname === "/__breadboard/bridge.js") { response.writeHead(200, { ...HEADERS, "Content-Type": "text/javascript", "Cache-Control": "no-store" }); return response.end(bridge); }
  const themedAsset = /^\/assets\/bb\d+-(light|dark)\//.exec(url.pathname);
  const mode = themedAsset?.[1] ?? (url.searchParams.get("theme") === "light" ? "light" : "dark");
  const path = themedAsset ? `/assets/${url.pathname.slice(themedAsset[0].length)}` : url.pathname;
  let file;
  try { file = normalize(join(root, decodeURIComponent(path))); } catch { response.writeHead(400); return response.end(); }
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403); return response.end(); }
  const isFile = existsSync(file) && statSync(file).isFile();
  // SPA fallback, as upstream's netlify.toml does; index.html always carries the bridge.
  if (!isFile || file === join(root, "index.html")) {
    if (extname(path) && !isFile) { response.writeHead(404, HEADERS); return response.end(); }
    response.writeHead(200, { ...HEADERS, "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
    return response.end(indexHtml(mode));
  }
  const ext = extname(file).toLowerCase();
  if (ext === ".css" || ext === ".js" || ext === ".mjs") {
    const key = `${mode}:${file}`;
    if (!themed.has(key)) themed.set(key, Buffer.from(themedPaths(retheme(readFileSync(file, "utf8"), mode), mode)));
    const body = themed.get(key);
    response.writeHead(200, { ...HEADERS, "Content-Type": TYPES[ext], "Content-Length": body.length, "Cache-Control": "no-cache" });
    return response.end(body);
  }
  response.writeHead(200, { ...HEADERS, "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "Content-Length": statSync(file).size,
    "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => console.log(`timeline-studio listening on http://127.0.0.1:${port}`));
