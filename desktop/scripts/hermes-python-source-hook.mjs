import fs from "node:fs";
import path from "node:path";

// No default source tree: a bare embedded `python -m hermes_cli.main` must
// fail, not silently run the last app-services copy staged by a package build.
export const HERMES_SOURCE_HOOK = "import os, sys; _breadboard_hermes_source = os.environ.get('BREADBOARD_HERMES_SOURCE_ROOT'); sys.path.insert(0, _breadboard_hermes_source) if _breadboard_hermes_source else None\n";

export function ensureHermesSourceHook(pythonRoot) {
  const root = path.resolve(pythonRoot);
  const target = path.join(root, "Lib", "site-packages", "breadboard-hermes.pth");
  // This is executable startup configuration. Reject links/hardlinks rather
  // than following a redirected runtime directory or modifying a shared file.
  for (let entry = target; ; entry = path.dirname(entry)) {
    let stat;
    try { stat = fs.lstatSync(entry); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (stat) {
      if (stat.isSymbolicLink() || (entry === target && (!stat.isFile() || stat.nlink !== 1))) {
        throw new Error(`Unsafe Hermes source hook path: ${entry}`);
      }
    }
    if (entry === path.dirname(entry)) break;
  }
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === HERMES_SOURCE_HOOK) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, HERMES_SOURCE_HOOK, "utf8");
  return true;
}
