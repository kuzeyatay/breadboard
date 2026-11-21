// Builds GenOffice's Sheets, Slides, PDF and Markdown editors for Breadboard:
//   public/genoffice/<app>/   the upstream renderer (its own vite config) + preload.js
//   genoffice-host/<app>.cjs  the upstream main process, bundled for plain Node
//   genoffice-host/resources/ wasm and the xlsx sidecar the hosts load
// Needs an upstream checkout with dependencies installed (and the sidecar built
// with cargo): node scripts/build-genoffice-apps.mjs --upstream C:/tmp/genoffice-upstream [app...]
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";

export const OFFICE_APPS = Object.freeze(["markdown", "pdf", "sheets", "slides"]);

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostSource = path.join(dashboardRoot, "genoffice-host-src");
const hostOut = path.join(dashboardRoot, "genoffice-host");
const args = process.argv.slice(2);
const flag = args.indexOf("--upstream");
const upstream = path.resolve(flag >= 0 ? args[flag + 1] : process.env.GENOFFICE_UPSTREAM || path.join(dashboardRoot, "..", "genoffice"));
const apps = args.filter((value, index) => !value.startsWith("--") && index !== flag + 1);
const selected = apps.length ? apps : OFFICE_APPS;
if (!existsSync(path.join(upstream, "node_modules", "vite"))) throw new Error(`Run npm ci in ${upstream} first: its renderers build with its own vite.`);

const upstreamRequire = createRequire(path.join(upstream, "package.json"));
const { build: viteBuild } = await import(pathToFileURL(upstreamRequire.resolve("vite")).href);

/** md-asset:// image URLs become the session's asset route; see electron-renderer.ts. */
const markdownAssets = {
  name: "breadboard-md-asset",
  enforce: "pre",
  transform(code, id) {
    if (!id.replace(/\\/g, "/").endsWith("/renderer/editor/localImage.ts")) return null;
    const patched = code
      .replace("`md-asset://${", "`${globalThis.__genofficeAssetPrefix}${")
      .replaceAll("'md-asset://'", "globalThis.__genofficeAssetPrefix");
    if (patched === code) throw new Error("localImage.ts no longer matches the md-asset patch.");
    return patched;
  },
};

/** Inside Breadboard the editors' assistant is Bread (answering through ChatMock), not Genspark. */
const BREAD_MARK = `
export function GensparkMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  )
}
`;
const breadBranding = {
  name: "breadboard-bread-branding",
  enforce: "pre",
  transform(code, id) {
    const file = id.split("?")[0].replace(/\\/g, "/");
    if (file.includes("/node_modules/") || !/\.(tsx?|css)$/.test(file) || !code.includes("Genspark")) return null;
    let next = code.replace(/\bGenspark AI\b/g, "Bread").replace(/\bGenspark\b/g, "Bread");
    if (/export function GensparkMark\(/.test(next)) next = next.replace(/export function GensparkMark\(/, "function GensparkMarkUpstream(") + BREAD_MARK;
    return next;
  },
};

async function buildRenderer(app) {
  const appRoot = path.join(upstream, "apps", app), outDir = path.join(dashboardRoot, "public", "genoffice", app);
  await viteBuild({
    configFile: path.join(appRoot, "vite.renderer.config.ts"),
    root: path.join(appRoot, "src", "renderer"),
    base: "./",
    logLevel: "warn",
    plugins: [markdownAssets, breadBranding],
    build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 100_000, reportCompressedSize: false },
  });
  await esbuild({
    entryPoints: [path.join(appRoot, "src", "preload", "index.ts")],
    outfile: path.join(outDir, "preload.js"),
    bundle: true, minify: true, format: "iife", platform: "browser", target: ["chrome120"],
    alias: { electron: path.join(hostSource, "electron-renderer.ts") },
    absWorkingDir: upstream, logLevel: "warning",
  });
  // The preload must define window.<app>Api before the renderer's module script runs.
  const htmlPath = path.join(outDir, "index.html");
  const html = await readFile(htmlPath, "utf8");
  await writeFile(htmlPath, html.replace(/<head>/i, '<head>\n    <script src="./preload.js"></script>\n    <link rel="stylesheet" href="../office-frame.css" />'));
}

/** Sheets names a workbook after its private snapshot (a UUID); show the file the user opened. */
const sheetsWorkbookName = {
  name: "breadboard-sheets-name",
  setup(b) {
    b.onLoad({ filter: /[\\/]apps[\\/]sheets[\\/]src[\\/]main[\\/]sheets-main\.ts$/ }, async args => {
      const code = await readFile(args.path, "utf8");
      // Sources may be checked out with CRLF; match either line ending.
      const anchor = /( {6}\.\.\.opened,\r?\n)( {6}\/\/ The renderer-facing path)/;
      if (!anchor.test(code)) throw new Error("sheets-main.ts no longer matches the workbook-name patch.");
      return { contents: code.replace(anchor, "$1      name: basename(restoreTarget ?? path),\n$2"), loader: "ts" };
    });
  },
};

async function buildHost(app) {
  const outfile = path.join(hostOut, `${app}.cjs`);
  await esbuild({
    entryPoints: [path.join(hostSource, "host.ts")],
    outfile,
    bundle: true, minify: false, format: "cjs", platform: "node", target: ["node22"],
    alias: {
      electron: path.join(hostSource, "electron-main.ts"),
      "genoffice-app": path.join(hostSource, "apps", `${app}.ts`),
      "genoffice-upstream": upstream,
    },
    // Rollup-style ?asset imports only exist in the shell's menus; nothing here loads them.
    plugins: [sheetsWorkbookName, { name: "asset-query", setup(b) { b.onResolve({ filter: /\?asset$/ }, () => ({ path: "asset", namespace: "asset" })); b.onLoad({ filter: /.*/, namespace: "asset" }, () => ({ contents: "export default ''", loader: "js" })); } }],
    define: { "import.meta.url": "__genofficeImportMetaUrl", "import.meta.env": "{}" },
    banner: { js: 'const __genofficeImportMetaUrl = require("node:url").pathToFileURL(__filename).href;' },
    loader: { ".png": "dataurl", ".svg": "text", ".wasm": "file" },
    absWorkingDir: upstream, logLevel: "warning", legalComments: "none",
  });
  // esbuild names modules relative to the upstream checkout; the dashboard's own
  // files would otherwise carry this machine's home folder into the repository.
  const local = `${path.relative(upstream, dashboardRoot).split(path.sep).join("/")}/`;
  const code = await readFile(outfile, "utf8");
  await writeFile(outfile, code.split(local).join("breadboard-dashboard/"));
}

async function copyResources() {
  const resources = path.join(hostOut, "resources");
  await mkdir(path.join(resources, "wasm"), { recursive: true });
  await mkdir(path.join(resources, "native"), { recursive: true });
  const harfbuzz = path.dirname(upstreamRequire.resolve("harfbuzzjs"));
  const subset = [path.join(harfbuzz, "hb-subset.wasm"), path.join(harfbuzz, "harfbuzz-subset.wasm")].find(existsSync);
  await cp(upstreamRequire.resolve("@embedpdf/pdfium/pdfium.wasm"), path.join(resources, "wasm", "pdfium.wasm"));
  if (subset) await cp(subset, path.join(resources, "wasm", "hb-subset.wasm"));
  const exe = process.platform === "win32" ? "xlsx-sidecar.exe" : "xlsx-sidecar";
  const sidecar = path.join(upstream, "apps", "sheets", "native", "xlsx-engine", "target", "release", exe);
  if (!existsSync(sidecar)) throw new Error(`Build the Sheets engine first: cargo build --release in ${path.dirname(path.dirname(path.dirname(sidecar)))}`);
  await cp(sidecar, path.join(resources, "native", exe));
}

await mkdir(hostOut, { recursive: true });
for (const app of selected) {
  if (!OFFICE_APPS.includes(app)) throw new Error(`Unknown GenOffice app: ${app}`);
  console.log(`[genoffice] ${app}: renderer`);
  await buildRenderer(app);
  console.log(`[genoffice] ${app}: host`);
  await buildHost(app);
}
await copyResources();
// Provenance: the outputs must come from the same pin as the vendored Docs editor.
const pin = (await readFile(path.join(dashboardRoot, "..", "genoffice", "BREADBOARD_UPSTREAM_COMMIT"), "utf8")).trim();
const { execFileSync } = await import("node:child_process");
const head = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== pin) throw new Error(`GenOffice checkout is at ${head}; Breadboard pins ${pin}.`);
await writeFile(path.join(hostOut, "BREADBOARD_UPSTREAM_COMMIT"), `${pin}\n`);
for (const name of ["LICENSE", "NOTICE"]) await cp(path.join(upstream, name), path.join(hostOut, name));
await rm(path.join(hostOut, "assets"), { recursive: true, force: true });
console.log("[genoffice] done");
