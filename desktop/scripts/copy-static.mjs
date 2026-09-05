// Copies non-TypeScript startup assets into dist/ after tsc.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

const nativeTarget = path.join(desktopRoot, "dist", "native", "windows-input.exe");
fs.rmSync(nativeTarget, { force: true });
if (process.platform === "win32") {
  const windowsRoot = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim() || "C:\\Windows";
  const compiler = [
    path.join(windowsRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(windowsRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!compiler) throw new Error("The Windows .NET Framework compiler for the input helper was not found.");
  const gacRoot = path.join(windowsRoot, "Microsoft.Net", "assembly", "GAC_MSIL");
  const references = ["UIAutomationClient", "UIAutomationTypes", "WindowsBase"].map((name) =>
    path.join(gacRoot, name, `v4.0_4.0.0.0__31bf3856ad364e35`, `${name}.dll`));
  const missingReference = references.find((candidate) => !fs.existsSync(candidate));
  if (missingReference) throw new Error(`The Windows input helper dependency is missing: ${missingReference}`);
  fs.mkdirSync(path.dirname(nativeTarget), { recursive: true });
  const compile = spawnSync(compiler, [
    "/nologo",
    "/target:exe",
    "/platform:x64",
    "/optimize+",
    `/out:${nativeTarget}`,
    ...references.map((reference) => `/reference:${reference}`),
    path.join(desktopRoot, "src", "native", "windows-input.cs"),
  ], { encoding: "utf8", windowsHide: true });
  if (compile.status !== 0 || !fs.existsSync(nativeTarget)) {
    throw new Error(`Could not build the Windows input helper. ${(compile.stdout || compile.stderr || "").trim()}`);
  }
  console.log("[copy-static] Windows input helper built");
}
