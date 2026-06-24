// Regenerates every breadboard logo / icon asset from one master SVG.
// Run from the dashboard package: `node scripts/generate-logo.mjs`
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dashboard = path.resolve(__dirname, "..");
const repoRoot = path.resolve(dashboard, "..");

const HOLE = 2.6;
const NOTCHES = [26, 40, 60, 74];

function columns() {
  const step = (83 - 17) / 12;
  return Array.from({ length: 13 }, (_, i) => 17 + i * step);
}
function holes(rows) {
  const cols = columns();
  const out = [];
  for (const y of rows) for (const x of cols) out.push({ x, y });
  return out;
}

// Master breadboard. `bg` (optional) draws a rounded-square background for app icons.
function buildSvg({ stroke, bg }) {
  const allHoles = [...holes([32, 37, 42, 47]), ...holes([60, 65, 70, 75])];
  const bgRect = bg
    ? `<rect x="0" y="0" width="100" height="100" rx="20" fill="${bg}"/>`
    : "";
  const notchRects = NOTCHES.map(
    (y) =>
      `<rect x="4" y="${y - 3}" width="4.5" height="6" rx="1" fill="${stroke}"/>` +
      `<rect x="91.5" y="${y - 3}" width="4.5" height="6" rx="1" fill="${stroke}"/>`,
  ).join("");
  const holeRects = allHoles
    .map(
      (h) =>
        `<rect x="${(h.x - HOLE / 2).toFixed(2)}" y="${(h.y - HOLE / 2).toFixed(2)}" width="${HOLE}" height="${HOLE}" fill="${stroke}"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
${bgRect}
<g fill="none" stroke="${stroke}" stroke-linejoin="round">
  <rect x="8" y="14" width="84" height="72" rx="6" stroke-width="4"/>
  <rect x="15" y="20" width="70" height="7" rx="3" stroke-width="2.4"/>
  <rect x="15" y="79" width="70" height="7" rx="3" stroke-width="2.4"/>
  <line x1="12" y1="51.5" x2="88" y2="51.5" stroke-width="2.4" stroke-linecap="round"/>
  <line x1="12" y1="56.5" x2="88" y2="56.5" stroke-width="2.4" stroke-linecap="round"/>
</g>
${notchRects}
${holeRects}
</svg>`;
}

const ICON_SVG = buildSvg({ stroke: "#ffffff", bg: "#0b0b0f" });
const LOGO_SVG = buildSvg({ stroke: "#ffffff", bg: null });

function renderPng(svg, size) {
  return sharp(Buffer.from(svg), { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function buildIco(svg, sizes) {
  const pngs = [];
  for (const size of sizes) pngs.push({ size, buf: await renderPng(svg, size) });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

async function writePng(relPath, svg, size) {
  const target = path.resolve(repoRoot, relPath);
  fs.writeFileSync(target, await renderPng(svg, size));
  console.log("wrote", relPath);
}
async function writeIco(relPath, svg) {
  const target = path.resolve(repoRoot, relPath);
  fs.writeFileSync(target, await buildIco(svg, [16, 32, 48]));
  console.log("wrote", relPath);
}

async function main() {
  // App icons / favicons (white board on a dark rounded square)
  await writePng("dashboard/public/breadboard-icon-20260426.png", ICON_SVG, 512);
  await writePng("dashboard/public/breadboard-apple-icon-20260426.png", ICON_SVG, 180);
  await writePng("dashboard/src/app/icon.png", ICON_SVG, 512);
  await writePng("dashboard/src/app/apple-icon.png", ICON_SVG, 180);
  await writeIco("dashboard/public/breadboard-favicon-20260426.ico", ICON_SVG);
  await writeIco("dashboard/src/app/favicon.ico", ICON_SVG);

  // Quartz garden favicon source
  await writePng("quartz/quartz/static/icon.png", ICON_SVG, 512);

  // Standalone logo marks (white board, transparent)
  for (const rel of [
    "dashboard/public/breadboard-logo-20260426.png",
    "dashboard/public/breadboard-logo-mark-20260426.png",
    "dashboard/public/logo.png",
    "dashboard/public/logo-mark.png",
  ]) {
    await writePng(rel, LOGO_SVG, 256);
  }

  // Also write the master SVG for reference
  fs.writeFileSync(
    path.resolve(repoRoot, "dashboard/public/breadboard-logo.svg"),
    LOGO_SVG,
  );
  console.log("done");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
