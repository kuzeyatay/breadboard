import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dashboardDirectory = path.resolve(scriptDirectory, "..");
const quartzDirectory = path.resolve(dashboardDirectory, "..", "quartz");

await build({
  absWorkingDir: quartzDirectory,
  entryPoints: ["quartz/components/scripts/thoughtTopologyRenderer.ts"],
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
    js: "// Generated from ../quartz/quartz/components/scripts/thoughtTopologyRenderer.ts. Do not edit by hand.",
  },
});
