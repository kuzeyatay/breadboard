import * as fs from "node:fs";
import { app } from "electron";
import { AppLifecycle } from "./app-lifecycle";
import * as path from "node:path";
import { parseStartupOptions } from "./startup-options";
import { repoRootFromModuleDir } from "./path-resolver";
import { registerAppAssetScheme } from "./app-assets";

registerAppAssetScheme();

const options = parseStartupOptions(process.argv);
if (options.forceDev && !options.qaMode) {
  // The dev launcher (scripts/dev.mjs) loads these, but an app started any
  // other way (a bare Breadboard.exe, a relaunch) got none of them, and the
  // Runtime then refused to start VLM OCR ("Runtime job control failed" on
  // every upload). Same order and precedence as the launcher: the existing
  // environment wins, then the root .env, then the dashboard's .env.local.
  const repoRoot = repoRootFromModuleDir(__dirname);
  for (const file of [
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "dashboard", ".env.local"),
  ]) {
    try {
      if (fs.existsSync(file)) process.loadEnvFile(file);
    } catch (error) {
      console.error(`[breadboard-desktop] could not load ${file}:`, error);
    }
  }
}
if (options.userDataDir) app.setPath("userData", options.userDataDir);
if (options.qaDownloadsDir) {
  fs.mkdirSync(options.qaDownloadsDir, { recursive: true });
  app.setPath("downloads", options.qaDownloadsDir);
}
if (process.platform === "win32") app.setAppUserModelId("com.breadboard.desktop");
const lifecycle = new AppLifecycle(
  __dirname,
  options.forceDev,
  options.qaMode,
  options.qaServiceProfile,
);

void lifecycle.run().catch((error: unknown) => {
  // A failure this early has no window to report into; write to stderr and
  // exit non-zero so the OS shows the crash instead of a silent zombie.
  console.error("[breadboard-desktop] fatal startup error:", error);
  process.exit(1);
});
