// Copies non-TypeScript startup assets into dist/ after tsc.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await import("./build-adblocker.mjs");

// Reuse the production tab strip and browser navigation components without
// Next's route loader/hydration or the page's terminal and content bundles.
const { build } = await import(pathToFileURL(path.join(desktopRoot, "../dashboard/node_modules/esbuild/lib/main.js")).href);
// The desktop package excludes node_modules. Bundle the push transport and its
// encryption dependencies so installed builds receive the same support as dev.
await build({
  entryPoints: [path.join(desktopRoot, "src/main/web-push-client.ts")],
  outfile: path.join(desktopRoot, "dist/main/web-push-client.js"),
  bundle: true, platform: "node", format: "cjs", target: "node20", sourcemap: true,
  external: ["bufferutil", "utf-8-validate"],
});
const shellTarget = path.join(desktopRoot, "dist/window-shell");
fs.mkdirSync(shellTarget, { recursive: true });
const shellBundle = await build({
  entryPoints: ["index", "tab-group"].map(name => path.join(desktopRoot, `src/window-shell/${name}.tsx`)),
  outdir: shellTarget, bundle: true, minify: true, metafile: true,
  platform: "browser", format: "iife", jsx: "automatic",
  tsconfig: path.join(desktopRoot, "../dashboard/tsconfig.json"),
  nodePaths: [path.join(desktopRoot, "../dashboard/node_modules")],
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_BREADBOARD_PERF_TRACE": '"0"' },
});
fs.copyFileSync(path.join(desktopRoot, "src/window-shell/index.html"), path.join(shellTarget, "index.html"));
fs.copyFileSync(path.join(desktopRoot, "src/window-shell/tab-group.html"), path.join(shellTarget, "tab-group.html"));
fs.copyFileSync(path.join(desktopRoot, "src/window-shell/fonts.css"), path.join(shellTarget, "fonts.css"));
fs.cpSync(path.join(desktopRoot, "src/window-shell/fonts"), path.join(shellTarget, "fonts"), { recursive: true });
// The shared controls rely on Tailwind's reset AND utility classes. Stripping
// imports left native button borders/padding and unstyled toolbar controls.
// Scan only this bundle's source graph, not every dashboard route/vendor tree.
const dashboardModules = path.join(desktopRoot, "../dashboard/node_modules");
const { default: postcss } = await import(pathToFileURL(path.join(dashboardModules, "postcss/lib/postcss.mjs")).href);
const { default: tailwind } = await import(pathToFileURL(path.join(dashboardModules, "@tailwindcss/postcss/dist/index.mjs")).href);
const sourceFiles = Object.keys(shellBundle.metafile.inputs)
  .filter(file => !file.includes("node_modules") && /\.[jt]sx?$/.test(file))
  .map(file => `@source "${path.resolve(file).replaceAll("\\", "/")}";`).join("\n");
const globalsPath = path.join(desktopRoot, "../dashboard/src/app/globals.css");
const shellCss = fs.readFileSync(globalsPath, "utf8").replace(/^@source[^;]+;/gm, sourceFiles);
const compiledCss = await postcss([tailwind({ base: path.dirname(globalsPath), optimize: true })])
  .process(shellCss, { from: globalsPath });
fs.writeFileSync(path.join(shellTarget, "shell.css"), compiledCss.css + `
:root{--font-source-sans:"Source Sans 3",Arial,sans-serif;--font-schibsted:"Schibsted Grotesk",Arial,sans-serif;--font-sans:var(--font-source-sans)}
html,body{margin:0;padding:0;overflow:hidden;background:transparent;font-family:var(--font-source-sans)}
.shell-error{position:absolute;bottom:0;left:0;right:0;padding:4px 12px;background:var(--paper-surface,#faf7ef);color:var(--ink,#222);font-size:13px}.shell-error button{margin-left:8px;text-decoration:underline}
`);
console.log("[copy-static] persistent window shell bundled");

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
  "find-in-page.html",
  "find-in-page.css",
  "theme.js",
  "breadboard-icon.svg",
  "intro.m4a",
]) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}
console.log("[copy-static] startup assets copied");
await build({
  entryPoints: [path.join(sourceDir, "find-in-page.js")],
  outfile: path.join(targetDir, "find-in-page.js"),
  bundle: true, platform: "browser", format: "iife", target: "chrome130",
});

const overlaySourceDir = path.join(desktopRoot, "src", "computer-use-overlay");
const overlayTargetDir = path.join(desktopRoot, "dist", "computer-use-overlay");
fs.mkdirSync(overlayTargetDir, { recursive: true });
for (const file of ["index.html", "overlay.css", "overlay.js", "LICENSE.cua.txt"]) {
  fs.copyFileSync(path.join(overlaySourceDir, file), path.join(overlayTargetDir, file));
}
console.log("[copy-static] computer-use overlay assets copied");

const clickyOverlayTarget = path.join(desktopRoot, "dist", "clicky-overlay");
const recorderTarget = path.join(desktopRoot, "dist", "screen-recording");
fs.mkdirSync(recorderTarget, { recursive: true });
fs.copyFileSync(path.join(desktopRoot, "src", "screen-recording", "index.html"), path.join(recorderTarget, "index.html"));
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
  const dictationTarget = path.join(desktopRoot, "dist", "native", "windows-dictation.exe");
  for (const name of fs.readdirSync(path.dirname(dictationTarget))) {
    if (/^windows-dictation-\d+\.previous\.exe$/.test(name)) {
      try { fs.rmSync(path.join(path.dirname(dictationTarget), name)); } catch { /* Still running. */ }
    }
  }
  const dictationStaged = path.join(path.dirname(dictationTarget), `windows-dictation-${process.pid}.new.exe`);
  const dictationCompile = spawnSync(compiler, [
    "/nologo", "/target:exe", "/platform:x64", "/optimize+", `/out:${dictationStaged}`,
    ...references.map((reference) => `/reference:${reference}`),
    "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll",
    path.join(desktopRoot, "src", "native", "dictation-chord.cs"),
    path.join(desktopRoot, "src", "native", "dictation-accessibility.cs"),
      "/reference:Accessibility.dll",
    path.join(desktopRoot, "src", "native", "windows-dictation.cs"),
  ], { encoding: "utf8", windowsHide: true });
  if (dictationCompile.status !== 0) {
    fs.rmSync(dictationStaged, { force: true });
    throw new Error(`Could not build the Windows dictation helper. ${dictationCompile.stdout || dictationCompile.stderr}`);
  }
  // Windows permits renaming a running executable but cannot overwrite it.
  // Publish only a successfully compiled helper; the old image stays alive
  // until the app releases its hooks during a normal restart.
  const dictationPrevious = path.join(path.dirname(dictationTarget), `windows-dictation-${process.pid}.previous.exe`);
  if (fs.existsSync(dictationTarget)) fs.renameSync(dictationTarget, dictationPrevious);
  try { fs.renameSync(dictationStaged, dictationTarget); }
  catch (error) {
    if (fs.existsSync(dictationPrevious)) fs.renameSync(dictationPrevious, dictationTarget);
    throw error;
  }
  try { fs.rmSync(dictationPrevious, { force: true }); } catch { /* The running app still owns this image. */ }
  console.log("[copy-static] Windows dictation helper built");
}
