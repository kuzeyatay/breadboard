// Copies non-TypeScript startup assets into dist/ after tsc.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(desktopRoot, "src", "startup");
const targetDir = path.join(desktopRoot, "dist", "startup");
fs.mkdirSync(targetDir, { recursive: true });
for (const file of [
  "index.html",
  "startup.css",
  "recovery.html",
  "recovery.css",
  "loading.html",
  "loading.css",
  "loading-scene.css",
  "theme.js",
  "breadboard-icon.svg",
  "intro.m4a",
]) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}
console.log("[copy-static] startup assets copied");

const overlaySourceDir = path.join(desktopRoot, "src", "computer-use-overlay");
const overlayTargetDir = path.join(desktopRoot, "dist", "computer-use-overlay");
fs.mkdirSync(overlayTargetDir, { recursive: true });
for (const file of ["index.html", "overlay.css", "overlay.js"]) {
  fs.copyFileSync(path.join(overlaySourceDir, file), path.join(overlayTargetDir, file));
}
console.log("[copy-static] computer-use overlay assets copied");
