import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await import("./build-quartz-runtime.mjs");
// The static service and new publications must install the same reader. A
// self-contained copy keeps packaged services independent of source paths.
const readerBridgePath = path.join(dashboardRoot, "scripts/quartz-canonical-reader-bridge.mjs");
const readerBridge = "// Generated from quartz/quartz/components/scripts/canonicalReader.mjs. Do not edit by hand.\n" +
  await readFile(path.join(dashboardRoot, "../quartz/quartz/components/scripts/canonicalReader.mjs"), "utf8");
if (await readFile(readerBridgePath, "utf8").catch(error => {
  if (error.code === "ENOENT") return "";
  throw error;
}) !== readerBridge) await writeFile(readerBridgePath, readerBridge);
// Client components need the same reference format as Quartz, inside the
// dashboard's Turbopack root. Refresh it in every web and desktop build.
const generatedDirectory = path.join(dashboardRoot, "src/lib/generated");
await mkdir(generatedDirectory, { recursive: true });
await writeFile(
  path.join(generatedDirectory, "artifact-reference.ts"),
  "// Generated from ../quartz/quartz/util/artifactReference.ts. Do not edit by hand.\n" +
    await readFile(path.join(dashboardRoot, "../quartz/quartz/util/artifactReference.ts"), "utf8"),
);
await import("./build-quartz-editor.mjs");
await import("./build-quartz-settings.mjs");
await build({
  entryPoints: [path.join(dashboardRoot, "../quartz/quartz/reader.ts")],
  outfile: path.join(dashboardRoot, "src/lib/generated/quartz-reader.mjs"),
  bundle: true, platform: "node", format: "esm", minify: true,
  banner: { js: 'import { createRequire as readerRequire } from "node:module"; const require = readerRequire(import.meta.url);' },
  plugins: [{ name: "reader-without-site-assets", setup(builder) {
    builder.onResolve({ filter: /^(?:node:)?fs$/ }, () => ({ path: "fs", namespace: "runtime-builtin" }));
    builder.onLoad({ filter: /.*/, namespace: "runtime-builtin" }, () => ({
      contents: 'const fs = Reflect.apply(Reflect.get(process, "getBuiltinModule"), process, ["node:fs"]); export default fs;',
      loader: "js",
    }));
    builder.onLoad({ filter: /(?:\.scss|\.inline\.(?:ts|js))$/ }, () => ({ contents: "", loader: "text" }));
  } }],
});
console.log("[quartz] Canonical document renderer built.");

// PDF snapshots hydrate the same cards as Quartz, including its sandboxed
// canvas/SVG visualizers. Ship their assets with the worker, not a live site.
const quartzRoot = path.resolve(dashboardRoot, "../quartz");
const quartzRequire = createRequire(path.join(quartzRoot, "package.json"));
const { compile } = quartzRequire("sass");
const visualRuntime = await build({
  stdin: {
    contents: `import './quartz/components/scripts/breadboardVisual.inline.ts';
import './quartz/components/scripts/breadboardGeneratedVisual.inline.ts';`,
    resolveDir: quartzRoot,
  },
  bundle: true, write: false, platform: "browser", format: "iife", minify: true,
  plugins: [{ name: "raw-visual-runtime", setup(builder) {
    builder.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "raw" }));
    builder.onLoad({ filter: /.*/, namespace: "raw" }, async args => ({ contents: await readFile(args.path, "utf8"), loader: "text" }));
  } }],
});
const visualStyles = ["breadboardVisual", "breadboardGeneratedVisual"].map(name =>
  compile(path.join(quartzRoot, `quartz/components/styles/${name}.inline.scss`), { style: "compressed" }).css,
).join("\n");
await writeFile(path.join(generatedDirectory, "quartz-pdf-visuals.mjs"),
  `// Generated from Quartz visualizer assets. Do not edit.\nexport const script = ${JSON.stringify(visualRuntime.outputFiles[0].text)};\nexport const style = ${JSON.stringify(visualStyles)};\n`);
