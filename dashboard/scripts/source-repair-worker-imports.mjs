import fs from "node:fs";
import path from "node:path";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

let installed = false;
/** Called after native launch validation, before any task source is imported. */
export function registerSourceRepairWorkerImports(env = process.env) {
  if (installed) return;
  const baseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const dataRoot = env.BREADBOARD_DATA_DIR?.trim();
  if (!dataRoot || !fs.existsSync(path.join(baseRoot, ".git"))) return;
  if (env.BREADBOARD_SOURCE_REPAIR_READY !== "1") {
    try {
      if (JSON.parse(fs.readFileSync(path.join(baseRoot, ".runtime/source-repair-installation.json"), "utf8")).version !== 1) return;
    } catch { return; }
  }
  installed = true;
  let release;
  try {
    const require = createRequire(path.join(baseRoot, "package.json"));
    const { selectedSourceRepairRelease } = require(path.join(baseRoot, "desktop/src/shared/source-repair.ts"));
    release = selectedSourceRepairRelease(dataRoot, baseRoot);
    env.BREADBOARD_SOURCE_REPAIR_READY = "1";
  } catch (error) {
    env.BREADBOARD_SOURCE_REPAIR_READY = "0";
    console.error(`[source-repair] Worker release unavailable; using base source: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!release) return;
  const original = path.join(baseRoot, "dashboard/src"), candidate = path.join(release.root, "dashboard/src");
  env.BREADBOARD_SOURCE_RELEASE_ID = release.id;
  registerHooks({
    // A load hook also covers workers whose own alias resolver short-circuits
    // resolution (office, visualizer, and vendor-aware workers). Module ids
    // stay consistent; every import of the original source reads this release.
    load(url, context, nextLoad) {
      if (!url.startsWith("file:")) return nextLoad(url, context);
      const relative = path.relative(original, fileURLToPath(url));
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return nextLoad(url, context);
      return nextLoad(pathToFileURL(path.join(candidate, relative)).href, context);
    },
  });
}
