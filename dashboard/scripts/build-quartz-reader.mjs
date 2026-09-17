import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Client components need the same reference format as Quartz, inside the
// dashboard's Turbopack root. Refresh it in every web and desktop build.
const generatedDirectory = path.join(dashboardRoot, "src/lib/generated");
await mkdir(generatedDirectory, { recursive: true });
await writeFile(
  path.join(generatedDirectory, "artifact-reference.ts"),
  "// Generated from ../quartz/quartz/util/artifactReference.ts. Do not edit by hand.\n" +
    await readFile(path.join(dashboardRoot, "../quartz/quartz/util/artifactReference.ts"), "utf8"),
);
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
