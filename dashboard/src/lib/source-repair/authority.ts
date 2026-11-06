import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type * as Authority from "../../../../desktop/src/shared/source-repair.ts";

/** Packaged installs do not carry a source checkout or automatic patch authority. */
export function sourceRepairAuthority(): typeof Authority | null {
  if (process.env.BREADBOARD_SOURCE_REPAIR_READY !== "1") return null;
  const cwd = process.cwd();
  const root = process.env.BREADBOARD_REPO_ROOT?.trim() || (fs.existsSync(path.join(cwd, ".git")) ? cwd : path.dirname(cwd));
  if (!fs.existsSync(path.join(root, ".git"))) return null;
  const require = createRequire(path.join(root, "package.json"));
  try { return require(path.join(root, "desktop/src/shared/source-repair.ts")) as typeof Authority; }
  catch { return null; }
}
