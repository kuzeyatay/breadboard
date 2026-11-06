import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FiltersEngine } from "@ghostery/adblocker";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = await import(pathToFileURL(path.join(root, "../dashboard/node_modules/esbuild/lib/main.js")).href);
const assets = path.join(root, "assets/adblocker");
const target = path.join(root, "dist/main");
fs.mkdirSync(target, { recursive: true });
// Compile the checked-in lists offline. Runtime never waits for a download.
const upstream = JSON.parse(fs.readFileSync(path.join(assets, "upstream.json"), "utf8"));
for (const { file, sha256 } of upstream.files) {
  if (createHash("sha256").update(fs.readFileSync(path.join(assets, file))).digest("hex") !== sha256) {
    throw new Error(`Ad blocker asset checksum mismatch: ${file}`);
  }
}
const filters = ["easylist.txt", "easyprivacy.txt", ...upstream.files.map(entry => entry.file).filter(file => file.endsWith(".txt"))]
  .map(file => fs.readFileSync(path.join(assets, file), "utf8")).join("\n");
const engine = FiltersEngine.parse(filters, {
  loadCosmeticFilters: true, loadExtendedSelectors: true, loadPreprocessors: true, enableCompression: true,
});
engine.updateEnv(new Map([["env_chromium", true], ["ext_ghostery", true]]));
engine.updateResources(fs.readFileSync(path.join(assets, "resources.json"), "utf8"), upstream.revision);
fs.writeFileSync(path.join(target, "adblocker.bin"), engine.serialize());
await build({
  entryPoints: [path.join(root, "src/main/browser-adblocker-engine.ts")],
  outfile: path.join(target, "browser-adblocker-engine.js"),
  bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true,
});
await build({
  entryPoints: [path.join(root, "src/preload/browser-adblocker-preload.ts")],
  outfile: path.join(root, "dist/preload/browser-adblocker-preload.js"),
  bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true,
  external: ["electron"],
});
console.log("[adblocker] bundled offline network, cosmetic, streaming and compatibility rules");
