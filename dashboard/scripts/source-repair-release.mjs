import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// A packaged distribution has no source checkout and cannot self-patch. Keep
// that normal startup independent of developer-only controller sources.
export async function sourceRepairRelease(env = process.env) {
  const dataRoot = env.BREADBOARD_DATA_DIR?.trim();
  if (!dataRoot) return null;
  const baseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (!fs.existsSync(path.join(baseRoot, ".git"))) return null;
  env.BREADBOARD_SOURCE_REPAIR_READY = "1";
  try {
    const { selectedSourceRepairRelease } = await import(pathToFileURL(path.join(baseRoot, "desktop/src/shared/source-repair.ts")).href);
    return selectedSourceRepairRelease(dataRoot, baseRoot);
  }
  catch (error) {
    env.BREADBOARD_SOURCE_REPAIR_READY = "0";
    console.error(`[source-repair] Verified release unavailable; using the base build: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
