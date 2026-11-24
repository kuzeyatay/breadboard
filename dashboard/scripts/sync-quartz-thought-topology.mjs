import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, readFile, writeFile } from "node:fs/promises";

import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dashboardDirectory = path.resolve(scriptDirectory, "..");
const quartzDirectory = path.resolve(dashboardDirectory, "..", "quartz");

const fontCss = await readFile(path.join(quartzDirectory, "quartz/components/styles/topologyFonts.css"), "utf8");
await build({
  absWorkingDir: quartzDirectory,
  entryPoints: ["quartz/components/scripts/thoughtTopologyViewer.ts"],
  outfile: path.join(
    dashboardDirectory,
    "src",
    "vendor",
    "quartz-thought-topology",
    "renderer.generated.js",
  ),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["d3", "katex", "pixi.js"],
  legalComments: "none",
  banner: {
    js: "// Generated from ../quartz/quartz/components/scripts/thoughtTopologyViewer.ts. Do not edit by hand.",
  },
});

await writeFile(path.join(dashboardDirectory, "src/vendor/quartz-thought-topology/viewer.css"),
  fontCss + await readFile(path.join(quartzDirectory, "quartz/components/styles/thoughtTopologyViewer.css"), "utf8"));


await copyFile(
  path.join(quartzDirectory, "quartz/components/scripts/topologyCommunities.ts"),
  path.join(dashboardDirectory, "src/vendor/quartz-thought-topology/communities.ts"),
);
