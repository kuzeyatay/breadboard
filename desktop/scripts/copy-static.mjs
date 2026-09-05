// Copies non-TypeScript startup assets into dist/ after tsc.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// TypeScript leaves output behind when a source file is removed. Clear the
// retired native-Firefox integration explicitly so an incremental local build
// cannot package it after the Chromium pivot.
for (const relative of [
  "dist/main/firefox-launcher.js",
  "dist/main/firefox-launcher.js.map",
  "dist/main/firefox-session.js",
  "dist/main/firefox-session.js.map",
  "dist/main/firefox-theme.js",
  "dist/main/firefox-theme.js.map",
  "dist/main/window-dock.js",
  "dist/main/window-dock.js.map",
  "dist/win32/window-dock.ps1",
]) {
  fs.rmSync(path.join(desktopRoot, relative), { force: true });
}

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

const clickyOverlayTarget = path.join(desktopRoot, "dist", "clicky-overlay");
fs.mkdirSync(clickyOverlayTarget, { recursive: true });
fs.copyFileSync(path.join(desktopRoot, "src", "clicky-overlay", "index.html"), path.join(clickyOverlayTarget, "index.html"));
